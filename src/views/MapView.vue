<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl'
import { Message } from '@arco-design/web-vue'
import { useSchemeStore } from '../store/scheme'

const store = useSchemeStore()
const mapEl = ref<HTMLDivElement>()
let map: MapLibreMap | undefined
const layers = ref({ closure: true, detour: true, ambulance: true, bus: true, adjacent: true })

function addGeoSource(id: string, coordinates: [number, number][], color: string, dasharray?: number[]) {
  if (!map?.isStyleLoaded()) return
  if (map.getLayer(id)) { map.removeLayer(id); map.removeSource(id) }
  map.addSource(id, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } } })
  map.addLayer({ id, type: 'line', source: id, paint: { 'line-color': color, 'line-width': 5, 'line-opacity': .85, ...(dasharray ? { 'line-dasharray': dasharray } : {}) } })
}

function drawAll() {
  if (!map?.isStyleLoaded()) return
  const stage = store.current.stages.find((item) => item.id === store.selectedStageId)
  if (stage) addGeoSource('closure', stage.route, '#ef4444')
  store.current.detours.forEach((route, index) => addGeoSource(`detour-${index}`, route.coordinates, '#2563eb', [2, 2]))
  addGeoSource('ambulance', [[121.476, 31.216], [121.478, 31.228], [121.496, 31.235]], '#16a34a')
  addGeoSource('bus', [[121.466, 31.220], [121.480, 31.229], [121.502, 31.238]], '#d97706', [1, 1])
  addGeoSource('adjacent', [[121.502, 31.244], [121.514, 31.236], [121.524, 31.228]], '#7c3aed')
}
function toggleLayer(id: string, visible: boolean) { if (map?.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none') }
function fit() { const bounds = new maplibregl.LngLatBounds(); store.current.stages.flatMap((stage) => stage.route).forEach((point) => bounds.extend(point)); map?.fitBounds(bounds, { padding: 60 }) }

onMounted(async () => {
  await nextTick()
  map = new maplibregl.Map({
    container: mapEl.value!,
    style: { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] },
    center: [121.488, 31.23], zoom: 13,
  })
  map.addControl(new maplibregl.NavigationControl(), 'top-right')
  map.on('load', drawAll)
  map.on('click', (event) => store.addPoint([event.lngLat.lng, event.lngLat.lat]))
})
onBeforeUnmount(() => map?.remove())
watch(() => store.selectedStageId, () => { const stage = store.selectedStage; if (stage && map) { map.flyTo({ center: stage.route[0], zoom: 14 }); drawAll() } })
watch(() => store.revisionNo, () => drawAll())
watch(layers, () => {
  if (!map) return
  toggleLayer('closure', layers.value.closure)
  store.current.detours.forEach((_, index) => toggleLayer(`detour-${index}`, layers.value.detour))
  toggleLayer('ambulance', layers.value.ambulance)
  toggleLayer('bus', layers.value.bus)
  toggleLayer('adjacent', layers.value.adjacent)
}, { deep: true })

const affectedComments = computed(() => {
  const rev = store.revisionNo
  return store.commentsView
    .filter((item) => item.state === '待重新确认' && item.comment.segmentId === store.selectedStageId)
    .map((item) => ({ ...item, since: rev }))
})

function finish() {
  const before = new Set(store.commentsView.filter((item) => item.state === '已接受' && item.comment.segmentId === store.selectedStageId).map((item) => item.comment.id))
  store.finishDraw()
  const invalidated = [...before].filter((id) => store.commentState(store.current.comments.find((c) => c.id === id)!) === '待重新确认')
  if (invalidated.length) Message.warning(`R${store.revisionNo} 已生成：锚定本阶段的 ${invalidated.length} 条会签意见需相关单位重新确认，其他单位意见保持有效`)
  else Message.success(`R${store.revisionNo} 已生成，本阶段无已确认意见受影响`)
}
function update(patch: Parameters<typeof store.updateStage>[0]) {
  const before = new Set(store.commentsView.filter((item) => item.state === '已接受' && item.comment.segmentId === store.selectedStageId).map((item) => item.comment.id))
  store.updateStage(patch)
  const invalidated = [...before].filter((id) => store.commentState(store.current.comments.find((c) => c.id === id)!) === '待重新确认')
  if (invalidated.length) Message.warning(`R${store.revisionNo}：${invalidated.length} 条本阶段意见失效待重签，其余单位不返工`)
  else Message.success(`R${store.revisionNo} 已生成`)
}
function bumpDetour(id: string, delta: number) {
  const route = store.current.detours.find((item) => item.id === id)
  if (!route) return
  store.updateDetour(id, { extraMinutes: Math.max(0, route.extraMinutes + delta) })
}
</script>

<template>
  <section class="page-head compact">
    <div><p class="eyebrow">几何与时间联动 · 当前修订 R{{ store.revisionNo }}</p><h1>围挡范围与阶段地图</h1><p>围挡、时间、控制条件或绕行一变更即生成新修订；只有锚点被触及的单位意见需要重新确认。</p></div>
    <a-space>
      <a-button @click="store.startDraw" :status="store.drawing ? 'danger' : undefined" :disabled="store.isViewingHistory">{{ store.drawing ? `绘制中 · 已点 ${store.draftRoute.length} 个` : '绘制围挡路线' }}</a-button>
      <a-button v-if="store.drawing" @click="store.cancelDraw">取消</a-button>
      <a-button :disabled="!store.drawing" type="primary" @click="finish">完成绘制</a-button>
      <a-button @click="fit">定位全段</a-button>
    </a-space>
  </section>
  <a-alert v-if="store.isViewingHistory" type="info" class="mb16" title="正在查看历史修订快照（只读），表单与绘制已锁定；点击“回到当前”后可继续编辑。">
    <template #action><a-button size="mini" type="text" @click="store.viewRevision(null)">回到当前 R{{ store.revisionNo }}</a-button></template>
  </a-alert>
  <div class="toolbar card"><a-radio-group v-model="store.selectedStageId" type="button"><a-radio v-for="stage in store.current.stages" :key="stage.id" :value="stage.id">{{ stage.id }}</a-radio></a-radio-group><span class="spacer"></span><a-checkbox v-model="layers.closure">围挡</a-checkbox><a-checkbox v-model="layers.detour">绕行</a-checkbox><a-checkbox v-model="layers.ambulance">救护通道</a-checkbox><a-checkbox v-model="layers.bus">公交</a-checkbox><a-checkbox v-model="layers.adjacent">相邻工程</a-checkbox></div>
  <div class="map-grid">
    <div ref="mapEl" class="map"></div>
    <aside class="card inspector">
      <div class="panel-head"><div><h2>{{ store.selectedStage?.name }}</h2><p>{{ store.selectedStage?.start }} → {{ store.selectedStage?.end }} · 锚定修订 R{{ store.selectedStage ? store.stageConfirmedRev(store.selectedStage.id) : '-' }}</p></div><a-tag :color="store.selectedStage && store.stageStates[store.selectedStage.id]?.confirmed ? 'green' : 'orange'">{{ store.selectedStage ? (store.stageStates[store.selectedStage.id]?.confirmed ? '已确认' : '待确认') : '' }}</a-tag></div>
      <a-alert v-for="item in affectedComments" :key="item.comment.id" type="warning" class="reconfirm" :title="`${item.comment.unit}单位意见 ${item.comment.id} 已失效，需在会签页重新确认（原锚定 R${item.comment.confirmedRev}）`" />
      <a-form layout="vertical" :model="store.selectedStage || {}">
        <a-form-item label="车道 / 控制条件（变化仅影响本阶段意见）"><a-input :model-value="store.selectedStage?.lanes" :disabled="store.isViewingHistory" @change="(value: string) => update({ lanes: value })" /></a-form-item>
        <a-form-item label="阶段名称"><a-input :model-value="store.selectedStage?.name" :disabled="store.isViewingHistory" @change="(value: string) => update({ name: value })" /></a-form-item>
        <div class="two"><a-form-item label="开始"><a-date-picker style="width:100%" :model-value="store.selectedStage?.start" :disabled="store.isViewingHistory" @change="(value: any) => update({ start: value })" /></a-form-item><a-form-item label="结束"><a-date-picker style="width:100%" :model-value="store.selectedStage?.end" :disabled="store.isViewingHistory" @change="(value: any) => update({ end: value })" /></a-form-item></div>
      </a-form>
      <h3>关联绕行（绕行条件变化会使服务阶段的意见失效）</h3>
      <div v-for="route in store.current.detours" :key="route.id" class="detour">
        <div><b>{{ route.name }}</b><small>{{ route.distance }} km · 增加 {{ route.extraMinutes }} 分钟 · 服务 {{ route.stageId }}</small></div>
        <div class="detour-actions"><a-tag :color="route.extraMinutes > 10 ? 'orange' : 'green'">{{ route.extraMinutes > 10 ? '关注' : '可用' }}</a-tag><a-button size="mini" :disabled="store.isViewingHistory" @click="bumpDetour(route.id, -1)">-1 分</a-button><a-button size="mini" type="primary" :disabled="store.isViewingHistory" @click="bumpDetour(route.id, 1)">+1 分</a-button></div>
      </div>
      <a-divider />
      <h3>路段冲突</h3>
      <div v-for="item in store.conflicts.filter((conflict) => conflict.segmentId === store.selectedStageId)" :key="item.id" class="issue" :class="item.level === '高' ? 'red' : 'amber'"><b>{{ item.title }}</b><p>{{ item.detail }}</p></div>
    </aside>
  </div>
</template>

<style scoped>
.toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px;margin-bottom:14px}.spacer{flex:1}.map-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(330px,.65fr);gap:16px}.map{height:min(68vh,680px);min-height:420px;border-radius:8px;overflow:hidden}.inspector{height:fit-content}.panel-head{display:flex;justify-content:space-between}.panel-head h2{font-size:18px;margin:0 0 5px}.panel-head p{color:#7a8798;font-size:12px;margin:0}.two{display:grid;grid-template-columns:1fr 1fr;gap:8px}.inspector h3{font-size:14px;margin:18px 0 10px}.detour{display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid #edf0f5}.detour b,.detour small{display:block}.detour small{color:#7a8798;margin-top:4px}.detour-actions{display:flex;align-items:center;gap:6px}.reconfirm{margin-bottom:10px}.issue{padding:10px;border-radius:6px;margin-bottom:8px}.issue.red{background:#fff1f2}.issue.amber{background:#fff7ed}.issue p{margin:4px 0 0;color:#64748b;font-size:13px}
@media(max-width:1050px){.map-grid{grid-template-columns:1fr}.map{height:55vh}}
</style>
