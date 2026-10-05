<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMutation } from '@vue/apollo-composable'
import { Message } from '@arco-design/web-vue'
import { COMMENTS_MUTATION } from '../graphql'
import { useSchemeStore } from '../store/scheme'
import type { SegmentComment } from '../types'

const store = useSchemeStore()
const { mutate } = useMutation(COMMENTS_MUTATION)
const viewingRevision = ref<number | null>(null)

const revisions = computed(() => [...store.scheme.revisions].reverse())
const viewingRecord = computed(() => store.scheme.revisions.find((record) => record.number === viewingRevision.value))

function resolve(id: string, status: '已接受' | '已退回') {
  store.resolveComment(id, status)
  void mutate({ id, status })
}

function tagColor(comment: SegmentComment) {
  if (store.isCommentStale(comment)) return 'purple'
  if (comment.status === '已接受') return 'green'
  if (comment.status === '已退回') return 'red'
  return 'orange'
}
function tagText(comment: SegmentComment) {
  if (store.isCommentStale(comment)) return '失效 · 需重新确认'
  if (comment.status === '已接受') return '已接受'
  if (comment.status === '已退回') return '已退回'
  return '待处理'
}

function exportNotice() {
  if (!store.allConfirmed) {
    Message.warning('仍有未收齐的有效意见，暂不能生成公开通告')
    return
  }
  const valid = store.scheme.comments.filter((comment) => store.isCommentValid(comment))
  const text = [
    `${store.scheme.project} 施工封路公开通告`,
    `范围：${store.scheme.area}`,
    `版本：v${store.scheme.version}（修订链 ${store.scheme.revisions.length} 条）`,
    '',
    '一、施工阶段',
    ...store.scheme.stages.map((stage) => `${stage.start} 至 ${stage.end}｜${stage.name}｜${stage.lanes}`),
    '',
    '二、绕行建议',
    ...store.scheme.detours.map((route) => `${route.name}，增加约 ${route.extraMinutes} 分钟`),
    '',
    '三、当前有效会签意见',
    ...valid.map((comment) => `[${comment.unit}] ${comment.author}：${comment.condition || comment.content}`),
    '',
    `本通告依据 v${store.scheme.version} 修订生成，由建设、交通、公交、应急单位联合确认。`,
  ].join('\n')
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `封路公开通告-${store.scheme.id}-v${store.scheme.version}.txt`
  link.click()
  URL.revokeObjectURL(link.href)
  Message.success('公开通告包已生成')
}

function recover() {
  const reason = store.recoverOffline()
  Message.success(`离线恢复完成：${reason}`)
}
</script>

<template>
  <section class="page-head compact">
    <div>
      <p class="eyebrow">条件会签与版本批复</p>
      <h1>路段意见与阶段审批</h1>
      <p>意见锚定具体路段与修订号；范围、时间或绕行一变，仅受影响意见失效并需重新确认，其他单位不返工。</p>
    </div>
    <a-space>
      <a-button @click="recover">离线恢复合并</a-button>
      <a-button type="primary" :disabled="!store.allConfirmed" @click="exportNotice">导出公开通告包</a-button>
    </a-space>
  </section>

  <a-alert v-if="!store.allConfirmed" type="warning" class="mb16"
    title="尚未收齐当前有效意见"
    :content="`${store.unconfirmedStages.length} 个阶段存在未收齐意见（${store.staleComments.length} 条失效需重确认、${store.pendingComments.length} 条待处理）；未确认阶段已单列，收齐后才能生成公开通告。`" />

  <div class="review-grid">
    <article class="card">
      <div class="panel-head">
        <div><h2>会签意见</h2><p>原意见不可覆盖，处理动作进入修订链</p></div>
        <a-tag color="orange">{{ store.scheme.comments.filter((item) => item.status === '待处理').length }} 待处理</a-tag>
      </div>
      <button v-for="comment in store.scheme.comments" :key="comment.id" class="comment" :class="{ active: store.selectedCommentId === comment.id }" @click="store.selectedCommentId = comment.id">
        <div class="comment-head">
          <span>{{ comment.unit }}</span><b>{{ comment.author }}</b>
          <a-tag :color="tagColor(comment)">{{ tagText(comment) }}</a-tag>
        </div>
        <p>{{ comment.content }}</p>
        <small v-if="comment.condition">条件：{{ comment.condition }}</small>
        <em>锚点 {{ comment.segmentId }} · 提出于 v{{ comment.authoredRevision }}<template v-if="comment.confirmedRevision"> · 确认于 v{{ comment.confirmedRevision }}</template></em>
      </button>
    </article>

    <div class="right">
      <article class="card">
        <div class="panel-head"><div><h2>阶段条件处理</h2><p>{{ store.selectedComment?.segmentId }} · {{ store.selectedComment?.unit }}</p></div></div>
        <div v-if="store.selectedComment" class="condition">
          <b>要求条件</b><p>{{ store.selectedComment.condition || '无附加条件' }}</p>
          <b>影响解释</b><p>{{ store.selectedComment.content }}</p>
          <a-alert v-if="store.isCommentStale(store.selectedComment)" type="warning" class="stale-tip"
            content="该意见锚定的阶段在确认后已变更，原确认失效，需重新确认。" />
        </div>
        <a-space>
          <a-button status="danger" :disabled="store.selectedComment?.status === '已退回'" @click="resolve(store.selectedComment!.id, '已退回')">退回方案</a-button>
          <a-button type="primary" :disabled="store.selectedComment?.status === '已接受' && !store.isCommentStale(store.selectedComment)" @click="resolve(store.selectedComment!.id, '已接受')">
            {{ store.isCommentStale(store.selectedComment) ? '重新确认' : '接受条件' }}
          </a-button>
        </a-space>
      </article>

      <article class="card">
        <div class="panel-head"><div><h2>未确认阶段</h2><p>存在未收齐意见（待处理 / 失效 / 退回）的阶段单列</p></div><a-tag :color="store.unconfirmedStages.length ? 'orange' : 'green'">{{ store.unconfirmedStages.length }} 个阶段</a-tag></div>
        <div v-if="store.unconfirmedStages.length === 0" class="empty-tip">所有阶段意见均已确认，可生成公开通告。</div>
        <div v-for="stage in store.unconfirmedStages" :key="stage.id" class="unconfirmed">
          <b>{{ stage.id }} · {{ stage.name }}</b>
          <small>{{ stage.start }} → {{ stage.end }} · v{{ stage.revision }}</small>
          <a-tag v-for="comment in store.scheme.comments.filter((c) => c.segmentId === stage.id)" :key="comment.id" color="orange">{{ comment.unit }} · {{ tagText(comment) }}</a-tag>
        </div>
      </article>

      <article class="card">
        <div class="panel-head"><div><h2>历史版本</h2><p>修订链留痕，可查看任一版本快照</p></div><a-tag color="blue">v{{ store.scheme.version }}</a-tag></div>
        <div class="version-list">
          <div v-for="record in revisions" :key="record.number" :class="{ selected: viewingRevision === record.number }" @click="viewingRevision = record.number">
            <b>v{{ record.number }} · {{ record.author }}</b>
            <small>{{ record.time }}</small>
            <p>{{ record.summary }}</p>
          </div>
        </div>
        <div v-if="viewingRecord" class="version-snapshot">
          <a-divider />
          <h3>v{{ viewingRecord.number }} 快照</h3>
          <small>阶段 {{ viewingRecord.snapshot.stages.length }} · 绕行 {{ viewingRecord.snapshot.detours.length }} · 意见 {{ viewingRecord.snapshot.comments.length }}</small>
          <div v-for="stage in viewingRecord.snapshot.stages" :key="stage.id" class="snapshot-row">
            <a-tag :color="stage.status === '已批准' ? 'green' : stage.status === '退回' ? 'red' : 'orange'">{{ stage.status }}</a-tag>
            <span>{{ stage.id }} · {{ stage.name }}</span>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.review-grid{display:grid;grid-template-columns:1fr 1.15fr;gap:16px}.right{display:grid;gap:16px;height:fit-content}.panel-head{display:flex;justify-content:space-between;margin-bottom:12px}.panel-head h2{font-size:17px;margin:0 0 4px}.panel-head p{color:#7a8798;font-size:12px;margin:0}.comment{display:block;width:100%;text-align:left;border:1px solid #e7ebf1;background:#fff;border-radius:7px;padding:13px;margin-bottom:9px;color:inherit;cursor:pointer}.comment:hover,.comment.active{border-color:#2563eb;background:#f5f8ff}.comment-head{display:flex;align-items:center;gap:8px}.comment-head>span{display:grid;place-items:center;width:36px;height:36px;border-radius:6px;background:#eef2f7;font-weight:800}.comment-head b{flex:1}.comment p{margin:9px 0 5px;color:#475569}.comment small,.comment em{display:block;color:#7a8798}.comment em{margin-top:6px;font-style:normal}.condition p{color:#475569}.stale-tip{margin-top:10px}.version-list>div{padding:11px;border:1px solid #edf0f5;border-radius:6px;margin-bottom:7px;cursor:pointer}.version-list>div.selected{border-color:#2563eb;background:#f5f8ff}.version-list b,.version-list small{display:block}.version-list small{color:#7a8798;margin-top:3px}.version-list p{margin:7px 0 0;color:#475569}.version-snapshot h3{font-size:14px;margin:0 0 6px}.version-snapshot small{color:#7a8798}.snapshot-row{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f1f4f8;font-size:13px}.unconfirmed{padding:10px;border:1px solid #fde68a;background:#fffbeb;border-radius:6px;margin-bottom:8px}.unconfirmed b{display:block}.unconfirmed small{display:block;color:#7a8798;margin:3px 0 6px}.empty-tip{color:#16a34a;font-size:13px;padding:8px 0}.mb16{margin-bottom:16px}
@media(max-width:980px){.review-grid{grid-template-columns:1fr}}
</style>
