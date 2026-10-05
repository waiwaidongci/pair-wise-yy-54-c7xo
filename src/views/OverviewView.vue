<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuery } from '@vue/apollo-composable'
import { SCHEME_QUERY } from '../graphql'
import { useSchemeStore } from '../store/scheme'

const store = useSchemeStore()
const { result, error } = useQuery(SCHEME_QUERY)
void result

const reconfirmCount = computed(() => store.commentsView.filter((item) => item.state === '待重新确认').length)
const noticeCount = computed(() => store.notices.length)
const stats = computed(() => [
  { label: '施工阶段', value: store.current.stages.length, note: `${store.unconfirmedStages.length} 个阶段待确认` },
  { label: '生效冲突', value: store.conflicts.filter((item) => item.level === '高').length, note: '需阶段确认前解决' },
  { label: '当前有效意见', value: `${store.validAcceptedCount}/${store.current.comments.length}`, note: reconfirmCount.value ? `${reconfirmCount.value} 条因修订失效待重签` : '全部锚定当前修订' },
  { label: '当前修订 / 通告', value: `R${store.revisionNo} / ${noticeCount.value}`, note: noticeCount.value ? '通告在修订链上可回溯' : '意见收齐后方可发布' },
])

const unitRows = computed(() => ['建设', '交通', '公交', '应急'].map((unit) => {
  const items = store.commentsView.filter((item) => item.comment.unit === unit)
  const reconfirm = items.filter((item) => item.state === '待重新确认').length
  const pending = items.filter((item) => item.state === '待处理').length
  const returned = items.filter((item) => item.state === '已退回').length
  if (reconfirm > 0) return { unit, label: `${reconfirm} 条待重签`, color: 'orange', note: `锚点修订后条件变化，仅该单位需重新确认（另有待处理 ${pending} 条）` }
  if (pending > 0) return { unit, label: '待处理', color: 'orange', note: `${pending} 条意见尚未处理` }
  if (returned > 0 && items.length === returned) return { unit, label: '已退回', color: 'red', note: '意见已退回，等待方案修改' }
  return { unit, label: '当前有效', color: 'green', note: items.length ? `意见锚定 R${items[0].comment.confirmedRev ?? 1}，后续修订未触及` : '暂无意见' }
}))

const mergeReport = ref<{ mergedRevs: number; replayed: number; conflicts: string[] } | null>(null)
function reconnect() { mergeReport.value = store.reconnect() }
</script>

<template>
  <section class="page-head">
    <div><p class="eyebrow">建设 · 交通 · 公交 · 应急 — 共用一条修订链</p><h1>封路方案协调总览</h1><p>围挡范围、时间、绕行或控制条件变化只作废旧锚点意见；通告依据明确修订号，历史版本随时可查。</p></div>
    <a-space>
      <a-button @click="$router.push('/review')">公开通告预览</a-button>
      <a-button v-if="!store.offline" status="warning" @click="store.simulateServerRevision()">模拟离线</a-button>
      <template v-else>
        <a-button @click="store.peerRevision()">模拟协同端提交修订</a-button>
        <a-button status="success" type="primary" @click="reconnect">恢复联网 · 按修订号合并</a-button>
      </template>
    </a-space>
  </section>

  <a-alert v-if="store.offline" type="warning" class="mb16"
    title="离线模式：本地修订继续编号保存；可模拟协同端产生分叉，恢复联网后按修订号合并；无修订号的旧数据自动迁移为初始版本。" />
  <a-alert v-if="mergeReport" type="success" class="mb16" closable @close="mergeReport = null">
    <template #title>合并完成：并入协同端 {{ mergeReport.mergedRevs }} 条修订，本地 {{ mergeReport.replayed }} 条修订按补丁重放，意见确认锚点已重映射到新编号。</template>
    <div v-if="mergeReport.conflicts.length" style="margin-top:6px"><a-tag v-for="(item, index) in mergeReport.conflicts" :key="index" color="red" style="margin:2px">{{ item }}</a-tag></div>
  </a-alert>
  <a-alert v-if="error" type="error" title="GraphQL 请求异常，已使用本地草案" class="mb16" />

  <div class="metrics"><article v-for="item in stats" :key="item.label" class="card metric"><span>{{ item.label }}</span><strong>{{ item.value }}</strong><small>{{ item.note }}</small></article></div>
  <div class="grid-2">
    <article class="card">
      <div class="panel-head"><div><h2>施工阶段时间轴</h2><p>未确认阶段单列；确认状态按当前修订派生</p></div><a-tag :color="store.allStagesConfirmed ? 'green' : 'orange'">{{ store.allStagesConfirmed ? '全部已确认' : `${store.unconfirmedStages.length} 阶段待确认` }}</a-tag></div>
      <a-table :data="store.current.stages" :pagination="false" row-key="id" @row-click="(row: any) => { store.selectedStageId = row.id; $router.push('/map') }">
        <template #columns>
          <a-table-column title="阶段" data-index="name" />
          <a-table-column title="时间" :width="190"><template #cell="{ record }">{{ record.start }} → {{ record.end }}</template></a-table-column>
          <a-table-column title="车道方案" data-index="lanes" />
          <a-table-column title="确认状态" :width="110">
            <template #cell="{ record }">
              <a-tooltip :content="(store.stageStates[record.id]?.reasons || []).join('；') || '当前修订下意见全部有效'">
                <a-tag :color="store.stageStates[record.id]?.confirmed ? 'green' : 'orange'">{{ store.stageStates[record.id]?.confirmed ? '已确认' : '待确认' }}</a-tag>
              </a-tooltip>
            </template>
          </a-table-column>
        </template>
      </a-table>
    </article>
    <article class="card">
      <div class="panel-head"><div><h2>规则检测结果</h2><p>按影响等级排序</p></div><a-tag color="red">{{ store.conflicts.filter((item) => item.level === '高').length }} 高风险</a-tag></div>
      <div v-for="item in store.conflicts" :key="item.id" class="conflict" :class="item.level === '高' ? 'red' : 'amber'"><div><b>{{ item.title }}</b><small>{{ item.segmentId }}</small></div><a-tag :color="item.level === '高' ? 'red' : 'orange'">{{ item.level }}</a-tag><p>{{ item.detail }}</p><a-button size="mini" type="text" @click="store.selectedStageId = item.segmentId; $router.push('/map')">定位路段</a-button></div>
    </article>
  </div>
  <div class="grid-2 mt16">
    <article class="card">
      <div class="panel-head"><div><h2>会签单位与意见有效性</h2><p>只有锚点被修订触及的意见才失效，其他单位不返工</p></div><a-button type="text" @click="$router.push('/review')">进入会签</a-button></div>
      <div v-for="row in unitRows" :key="row.unit" class="agency"><span>{{ row.unit }}</span><div class="agency-main"><b>{{ row.unit }}单位</b><small>{{ row.note }}</small></div><a-tag :color="row.color">{{ row.label }}</a-tag></div>
    </article>
    <article class="card">
      <div class="panel-head"><div><h2>修订链（最近 5 条）</h2><p>施工修订、会签确认与公开通告共用编号</p></div><a-button size="mini" type="text" @click="$router.push('/review')">查看全部</a-button></div>
      <div v-for="entry in [...store.chain].reverse().slice(0, 5)" :key="entry.rev" class="chain-row">
        <b>R{{ entry.rev }}</b>
        <a-tag size="small" :color="entry.type === 'notice' ? 'arcoblue' : entry.merged ? 'purple' : entry.migrated ? 'gray' : 'green'">{{ entry.type === 'notice' ? '通告' : '修订' }}</a-tag>
        <span class="chain-summary">{{ entry.summary }}</span><small>{{ entry.author }} · {{ entry.at }}</small>
      </div>
    </article>
  </div>
</template>

<style scoped>
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px}.metric{padding:17px;border-left:4px solid #2563eb}.metric span,.metric small{display:block;color:#667085}.metric strong{display:block;font-size:26px;margin:7px 0 2px}.grid-2{display:grid;grid-template-columns:1.4fr .8fr;gap:16px}.panel-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}.panel-head h2{font-size:17px;margin:0 0 4px}.panel-head p{color:#7a8798;font-size:13px;margin:0}.conflict{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:12px;margin-bottom:9px;border-radius:6px}.conflict.red{background:#fff1f2;border-left:3px solid #e11d48}.conflict.amber{background:#fff7ed;border-left:3px solid #f59e0b}.conflict>div{min-width:210px}.conflict b,.conflict small{display:block}.conflict small{color:#7a8798;margin-top:3px}.conflict p{width:100%;margin:0;color:#475569}.mt16{margin-top:16px}.agency{display:flex;align-items:center;gap:10px;padding:11px 12px;border:1px solid #e7ebf1;border-radius:7px;margin-bottom:8px}.agency>span{display:grid;place-items:center;width:35px;height:35px;border-radius:7px;background:#eff6ff;color:#2563eb;font-weight:800}.agency b,.agency small{display:block}.agency small{color:#7a8798;margin-top:3px;font-size:12px}.agency-main{flex:1}.chain-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #edf0f5;font-size:13px}.chain-row b{color:#2563eb;min-width:34px}.chain-summary{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chain-row small{color:#94a3b8}
@media(max-width:1050px){.metrics{grid-template-columns:1fr 1fr}.grid-2{grid-template-columns:1fr}}@media(max-width:600px){.metrics{grid-template-columns:1fr}}
</style>
