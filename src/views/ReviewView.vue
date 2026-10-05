<script setup lang="ts">
import { computed, ref } from 'vue'
import { Message, Modal } from '@arco-design/web-vue'
import { useMutation } from '@vue/apollo-composable'
import { COMMENTS_MUTATION } from '../graphql'
import { useSchemeStore } from '../store/scheme'
import type { SegmentComment } from '../types'

const store = useSchemeStore()
const { mutate } = useMutation(COMMENTS_MUTATION)
const previewVisible = ref(false)
const noticeViewRev = ref<number | null>(null)

const preview = computed(() => store.previewNotice())

const stateColor: Record<string, string> = { 待处理: 'orange', 已接受: 'green', 已退回: 'red', 待重新确认: 'orangered' }

/** 历史查看时展示该时点快照中的意见及时点状态；否则展示当前意见 */
const listComments = computed(() => {
  if (store.viewedEntry && store.isViewingHistory) {
    const rev = store.viewedEntry.rev
    return store.viewedEntry.snapshot.comments.map((comment) => ({ comment, state: store.commentStateAt(comment, rev) }))
  }
  return store.commentsView
})

const shownComment = computed(() => listComments.value.find((item) => item.comment.id === store.selectedCommentId) ?? listComments.value[0] ?? null)

const chainDesc = computed(() => [...store.chain].reverse())

function aspectLabel(aspect: string): string {
  return { geometry: '围挡范围', time: '时间', control: '控制条件', detour: '绕行', meta: '名称信息' }[aspect] ?? aspect
}

function resolve(comment: SegmentComment, status: '已接受' | '已退回') {
  store.resolveComment(comment.id, status)
  void mutate({ id: comment.id, status })
  Message.success(status === '已接受' ? `意见已接受并锚定 R${store.revisionNo}，后续仅在锚点再被修订时失效` : '意见已退回，审计记录已追加')
}
function reconfirm(comment: SegmentComment) {
  store.resolveComment(comment.id, '已接受')
  void mutate({ id: comment.id, status: '已接受' })
  Message.success(`${comment.unit}单位已按 R${store.revisionNo} 重新确认，其他单位无需返工`)
}

function publishNotice() {
  if (!store.allStagesConfirmed) {
    Message.warning('仍有阶段未取得当前有效意见，通告暂不能发布')
    return
  }
  const payload = store.issueNotice()
  if (payload) {
    previewVisible.value = false
    noticeViewRev.value = null
    Message.success(`通告已生成并入修订链 R${store.revisionNo}，依据修订明确标注`)
    Modal.info({
      title: payload.title,
      content: () => payload.body,
      okText: '下载通告文本',
      onOk: () => store.downloadNotice(store.revisionNo),
    })
  }
}
</script>

<template>
  <section class="page-head compact">
    <div><p class="eyebrow">条件会签 · 修订链 · 公开通告</p><h1>意见确认与通告发布</h1><p>意见只随自身锚点修订失效；通告收齐当前有效意见后才生成，未确认阶段单列，历史版本可查看。</p></div>
    <a-space>
      <a-button @click="previewVisible = true">通告预览</a-button>
      <a-tooltip :content="store.allStagesConfirmed ? `依据当前 R${store.revisionNo} 发布` : '尚有阶段未确认'">
        <a-button type="primary" :disabled="!store.allStagesConfirmed || store.isViewingHistory" @click="publishNotice">收齐有效意见 · 生成通告</a-button>
      </a-tooltip>
    </a-space>
  </section>

  <a-alert v-if="store.isViewingHistory" type="info" class="mb16" :title="`正在查看 R${store.viewedEntry?.rev} 历史快照（${store.viewedEntry?.type === 'notice' ? '通告版本' : '方案修订'}），会签操作已锁定`">
    <template #action><a-button size="mini" type="primary" @click="store.viewRevision(null)">回到当前 R{{ store.revisionNo }}</a-button></template>
  </a-alert>

  <a-alert v-if="!store.allStagesConfirmed && !store.isViewingHistory" type="warning" class="mb16"
    :title="`以下 ${store.unconfirmedStages.length} 个阶段在当前修订下未确认，通告将其单列且不予发布：`">
    <div class="unconfirmed">
      <div v-for="stage in store.unconfirmedStages" :key="stage.id" class="unconfirmed-item"><b>{{ stage.id }} {{ stage.name }}</b><span v-for="(reason, i) in store.stageStates[stage.id].reasons" :key="i">· {{ reason }}</span></div>
    </div>
  </a-alert>

  <div class="review-grid">
    <article class="card">
      <div class="panel-head"><div><h2>会签意见</h2><p>原意见不覆盖，处理动作入审计链</p></div><a-tag color="orangered">{{ listComments.filter((i) => i.state === '待重新确认').length }} 待重签</a-tag></div>
      <button v-for="item in listComments" :key="item.comment.id" class="comment" :class="{ active: shownComment?.comment.id === item.comment.id }" @click="store.selectedCommentId = item.comment.id">
        <div class="comment-head"><span>{{ item.comment.unit }}</span><b>{{ item.comment.author }}</b><a-tag :color="stateColor[item.state]">{{ item.state }}</a-tag></div>
        <p>{{ item.comment.content }}</p>
        <small v-if="item.comment.condition">条件：{{ item.comment.condition }}</small>
        <em>锚点 {{ item.comment.segmentId }} · 确认于 R{{ item.comment.confirmedRev ?? 1 }}<template v-if="item.state === '待重新确认'"> · 被 R{{ store.invalidatedByRev(item.comment) }} 作废</template></em>
      </button>
    </article>

    <div class="middle">
      <article class="card" v-if="shownComment">
        <div class="panel-head"><div><h2>意见处理</h2><p>{{ shownComment.comment.segmentId }} · {{ shownComment.comment.unit }}单位 · {{ shownComment.comment.author }}</p></div><a-tag :color="stateColor[shownComment.state]">{{ shownComment.state }}</a-tag></div>
        <div class="condition"><b>意见说明</b><p>{{ shownComment.comment.content }}</p><b>要求条件</b><p>{{ shownComment.comment.condition || '无附加条件' }}</p></div>
        <div class="logs">
          <b>审计记录</b>
          <div v-if="!shownComment.comment.logs.length" class="log-empty">尚无处理动作</div>
          <div v-for="(log, index) in shownComment.comment.logs" :key="index" class="log"><a-tag size="small" :color="stateColor[log.action]">{{ log.action }}</a-tag><span>R{{ log.rev }}</span><small>{{ log.at }}</small></div>
        </div>
        <a-space v-if="!store.isViewingHistory">
          <a-button status="danger" :disabled="shownComment.state === '已退回'" @click="resolve(shownComment.comment, '已退回')">退回方案</a-button>
          <a-button v-if="shownComment.state === '待重新确认'" type="primary" status="warning" @click="reconfirm(shownComment.comment)">按当前修订重新确认</a-button>
          <a-button v-else type="primary" :disabled="shownComment.state !== '待处理'" @click="resolve(shownComment.comment, '已接受')">接受条件</a-button>
        </a-space>
      </article>

      <article class="card">
        <div class="panel-head"><div><h2>通告版本</h2><p>通告本身是修订链条目，依据修订号可追溯</p></div><a-tag :color="store.notices.length ? 'arcoblue' : 'gray'">{{ store.notices.length }} 份</a-tag></div>
        <div v-if="!store.notices.length" class="notice-empty">尚未发布通告：收齐各单位当前有效意见后才可生成。</div>
        <div v-for="entry in [...store.notices].reverse()" :key="entry.rev" class="notice-item">
          <div class="notice-head"><b>{{ entry.notice?.noticeId }}</b><a-button size="mini" type="text" @click="noticeViewRev = entry.rev">查看</a-button><a-button size="mini" type="text" @click="store.downloadNotice(entry.rev)">下载</a-button></div>
          <small>{{ entry.at }} · {{ entry.author }} · {{ entry.summary }}</small>
        </div>
        <a-modal v-if="noticeViewRev != null" :visible="true" :footer="false" :width="640" @cancel="noticeViewRev = null">
          <pre class="notice-text">{{ store.chain.find((e) => e.rev === noticeViewRev)?.notice?.body }}</pre>
        </a-modal>
      </article>
    </div>

    <article class="card chain-card">
      <div class="panel-head"><div><h2>修订链 R1–R{{ store.revisionNo }}</h2><p>修订、会签、通告共用一条编号链</p></div><a-tag v-if="store.offline" color="orange">离线中</a-tag></div>
      <a-timeline>
        <a-timeline-item v-for="entry in chainDesc" :key="entry.rev" :dot-color="entry.type === 'notice' ? '#165dff' : entry.merged ? '#7c3aed' : '#16a34a'">
          <button class="chain-entry" :class="{ active: store.viewingRev === entry.rev }" @click="store.viewRevision(entry.rev === store.revisionNo ? null : entry.rev)">
            <div class="chain-line"><b>R{{ entry.rev }}</b><a-tag size="small" :color="entry.type === 'notice' ? 'arcoblue' : 'green'">{{ entry.type === 'notice' ? '通告' : '修订' }}</a-tag><a-tag v-if="entry.migrated" size="small" color="gray">迁移</a-tag><a-tag v-if="entry.merged" size="small" color="purple">合并</a-tag></div>
            <p>{{ entry.summary }}</p>
            <small>{{ entry.author }} · {{ entry.at }}</small>
            <div v-if="entry.changes?.aspects.length" class="aspects"><a-tag v-for="aspect in [...new Set(entry.changes.aspects)]" :key="aspect" size="small" color="orange">{{ aspectLabel(aspect) }}</a-tag></div>
          </button>
        </a-timeline-item>
      </a-timeline>
    </article>
  </div>

  <a-modal v-model:visible="previewVisible" title="公开通告预览" :ok-text="store.allStagesConfirmed ? '确认生成通告' : '暂不能发布'" :ok-button-props="{ disabled: !store.allStagesConfirmed }" @ok="publishNotice">
    <a-alert :type="preview.ready ? 'success' : 'warning'" :title="preview.ready ? `当前全部阶段会签齐备，通告将依据 R${store.revisionNo} 生成` : '未确认阶段已单列，补齐后才可发布'" class="mb16" />
    <pre class="notice-text">{{ preview.body }}</pre>
  </a-modal>
</template>

<style scoped>
.review-grid{display:grid;grid-template-columns:minmax(300px,.9fr) minmax(340px,1.05fr) minmax(300px,.9fr);gap:16px;align-items:start}.middle{display:grid;gap:16px}.panel-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px}.panel-head h2{font-size:17px;margin:0 0 4px}.panel-head p{color:#7a8798;font-size:12px;margin:0}.unconfirmed{display:grid;gap:6px;margin-top:4px}.unconfirmed-item{display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:13px}.unconfirmed-item span{color:#9a3412}.comment{display:block;width:100%;text-align:left;border:1px solid #e7ebf1;background:#fff;border-radius:7px;padding:13px;margin-bottom:9px;color:inherit;cursor:pointer}.comment:hover,.comment.active{border-color:#2563eb;background:#f5f8ff}.comment-head{display:flex;align-items:center;gap:8px}.comment-head>span{display:grid;place-items:center;width:36px;height:36px;border-radius:6px;background:#eef2f7;font-weight:800}.comment-head b{flex:1}.comment p{margin:9px 0 5px;color:#475569}.comment small,.comment em{display:block;color:#7a8798}.comment em{margin-top:6px;font-style:normal;font-size:12px}.condition p{color:#475569}.logs{margin:14px 0;padding:12px;background:#f8fafc;border-radius:7px}.logs>b{display:block;margin-bottom:8px;font-size:13px}.log,.log-empty{display:flex;align-items:center;gap:10px;font-size:13px;padding:3px 0}.log span{color:#2563eb;font-weight:700;min-width:36px}.log small{color:#94a3b8}.log-empty{color:#94a3b8}.notice-empty{color:#94a3b8;font-size:13px;padding:8px 0}.notice-item{padding:10px;border:1px solid #edf0f5;border-radius:7px;margin-bottom:8px}.notice-head{display:flex;justify-content:space-between;align-items:center}.notice-item small{color:#7a8798;display:block;margin-top:4px}.notice-text{white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:13px;line-height:1.7;margin:0;max-height:52vh;overflow:auto}.chain-card{max-height:calc(100vh - 170px);overflow:auto}.chain-entry{display:block;width:100%;text-align:left;background:transparent;border:0;padding:6px 8px;border-radius:6px;cursor:pointer}.chain-entry:hover,.chain-entry.active{background:#f5f8ff}.chain-line{display:flex;align-items:center;gap:6px}.chain-line b{color:#2563eb}.chain-entry p{margin:5px 0 2px;font-size:13px;color:#334155}.chain-entry small{color:#94a3b8;font-size:12px}.aspects{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px}
@media(max-width:1200px){.review-grid{grid-template-columns:1fr 1fr}.chain-card{grid-column:1/-1;max-height:none}}@media(max-width:800px){.review-grid{grid-template-columns:1fr}}
</style>
