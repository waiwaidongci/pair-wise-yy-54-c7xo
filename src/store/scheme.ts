import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { ClosureStage, DetourRoute, SegmentComment, Scheme, RevisionRecord } from '../types'

const STORAGE_KEY = 'yy54-road-scheme-v1'

function now() { return new Date().toISOString() }
function clone<T>(value: T): T { return structuredClone(value) }

const seedStages: ClosureStage[] = [
  { id: 'ST-01', name: '第一阶段 · 东半幅围挡', start: '2026-10-08', end: '2026-10-22', lanes: '双向 4 车道收窄为 2 车道', status: '条件通过', revision: 5, route: [[121.470,31.228],[121.482,31.231],[121.496,31.235]] },
  { id: 'ST-02', name: '第二阶段 · 路口夜间施工', start: '2026-10-23', end: '2026-11-05', lanes: '22:00–05:00 全封闭', status: '待协商', revision: 7, route: [[121.496,31.235],[121.508,31.238],[121.516,31.242]] },
  { id: 'ST-03', name: '第三阶段 · 西半幅恢复', start: '2026-11-06', end: '2026-11-18', lanes: '西侧公交专用道临时占用', status: '退回', revision: 4, route: [[121.452,31.224],[121.462,31.226],[121.470,31.228]] },
]

const seedDetours: DetourRoute[] = [
  { id: 'DR-01', name: '江海大道—滨河路绕行', distance: 4.8, extraMinutes: 11, revision: 5, coordinates: [[121.470,31.228],[121.478,31.214],[121.502,31.218],[121.516,31.242]] },
  { id: 'DR-02', name: '云河路辅道保通', distance: 2.3, extraMinutes: 6, revision: 5, coordinates: [[121.452,31.224],[121.462,31.219],[121.496,31.235]] },
]

const seedComments: SegmentComment[] = [
  { id: 'CM-41', segmentId: 'ST-01', unit: '公交', author: '顾敏', content: '17 路、806 路临时站点与云河路站距离 680 米，超过老年乘客可接受步行距离。', condition: '需在江海大道口增设临时站并配置导乘人员。', status: '待处理', authoredRevision: 6 },
  { id: 'CM-42', segmentId: 'ST-02', unit: '应急', author: '夏川', content: '夜间全封闭期间，区域急救中心南门通道被切断。', condition: '保留 4 米应急通道，路口导改每 15 分钟巡查一次。', status: '已接受', authoredRevision: 5, confirmedRevision: 5 },
  { id: 'CM-43', segmentId: 'ST-03', unit: '交通', author: '郑航', content: '公交专用道占用导致高峰小时延误增加 19 分钟，超过方案阈值。', condition: '缩减围挡 1.5 米并调整信号配时。', status: '已退回', authoredRevision: 4 },
]

function buildSeed(): Scheme {
  const stages = clone(seedStages)
  const detours = clone(seedDetours)
  const comments = clone(seedComments)
  const snapshot = { stages: clone(stages), detours: clone(detours), comments: clone(comments) }
  const revisions: RevisionRecord[] = [
    { number: 5, time: '今天 14:50', author: '交通组', summary: '补充江海大道信号配时和现场疏导岗位', snapshot: clone(snapshot) },
    { number: 6, time: '今天 16:10', author: '公交组', summary: '提交临时站点与线路绕行方案', snapshot: clone(snapshot) },
    { number: 7, time: '今天 16:22', author: '建设组', summary: '调整第二阶段夜间全封闭范围，保留急救通道', snapshot: clone(snapshot) },
  ]
  return {
    id: 'RC-2026-0918', project: '云河路快速化改造', contractor: '市政建设集团第三工程处', area: '云河路 / 江海大道',
    version: 7, revisions, stages, detours, comments,
  }
}

export const useSchemeStore = defineStore('scheme', () => {
  const scheme = ref<Scheme>(buildSeed())
  const selectedStageId = ref('ST-01')
  const selectedCommentId = ref('CM-41')
  const drawing = ref(false)
  const draftRoute = ref<[number, number][]>([])
  const history = ref<string[]>([])

  const selectedStage = computed(() => scheme.value.stages.find((item) => item.id === selectedStageId.value))
  const selectedComment = computed(() => scheme.value.comments.find((item) => item.id === selectedCommentId.value))

  const conflicts = computed(() => [
    ...(scheme.value.stages.some((stage) => stage.id === 'ST-02') ? [{ id: 'CF-01', level: '高', segmentId: 'ST-02', title: '相邻雨污分流工程时间重叠', detail: '10 月 26–30 日江海大道东段同步占用慢车道，建议错峰 4 天。' }] : []),
    { id: 'CF-02', level: '高', segmentId: 'ST-02', title: '救护通道中断风险', detail: '夜间全封闭将切断区域急救中心南门，必须保留 4 米应急通道。' },
    { id: 'CF-03', level: '中', segmentId: 'ST-01', title: '公交站点覆盖缺口', detail: '17 路与 806 路临时站距现状站 680 米，已超过 500 米阈值。' },
    { id: 'CF-04', level: '中', segmentId: 'ST-03', title: '绕行延误超阈值', detail: '高峰绕行新增 19 分钟，超过方案设定的 15 分钟阈值。' },
  ])

  const dirty = computed(() => history.value.length > 0)

  // ---- 修订链 / 意见有效性 ----
  function stageRevision(stageId: string): number {
    return scheme.value.stages.find((stage) => stage.id === stageId)?.revision ?? 0
  }
  /** 意见已接受但其锚定阶段在确认后又变更 → 失效，需重新确认 */
  function isCommentStale(comment: SegmentComment | undefined): boolean {
    if (!comment || comment.status !== '已接受' || comment.confirmedRevision === undefined) return false
    return comment.confirmedRevision < stageRevision(comment.segmentId)
  }
  /** 当前有效意见：已接受且未失效 */
  function isCommentValid(comment: SegmentComment | undefined): boolean {
    return !!comment && comment.status === '已接受' && !isCommentStale(comment)
  }
  const staleComments = computed(() => scheme.value.comments.filter((comment) => isCommentStale(comment)))
  const pendingComments = computed(() => scheme.value.comments.filter((comment) => comment.status === '待处理'))
  /** 未确认阶段：存在意见未收齐（待处理 / 失效 / 已退回）的阶段 */
  const unconfirmedStages = computed(() => {
    const ids = new Set<string>()
    for (const comment of scheme.value.comments) {
      if (!isCommentValid(comment)) ids.add(comment.segmentId)
    }
    return scheme.value.stages.filter((stage) => ids.has(stage.id))
  })
  /** 收齐当前有效意见：所有意见均为已接受且未失效 */
  const allConfirmed = computed(() => scheme.value.comments.every((comment) => isCommentValid(comment)))

  // ---- 持久化 ----
  function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(scheme.value)) }

  function commit() { history.value.push(JSON.stringify(scheme.value)); persist() }

  /** 推进一条修订链：version +1，写入带快照的修订记录。不写撤销栈，撤销栈由调用方在变更前写入 */
  function commitRevision(summary: string, author = '建设组'): number {
    scheme.value.version += 1
    const number = scheme.value.version
    const record: RevisionRecord = {
      number, time: now(), author, summary,
      snapshot: { stages: clone(scheme.value.stages), detours: clone(scheme.value.detours), comments: clone(scheme.value.comments) },
    }
    scheme.value.revisions.push(record)
    persist()
    return number
  }

  function restore() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Scheme
    if (!parsed.revisions || parsed.revisions.length === 0) migrateToInitial(parsed)
    scheme.value = parsed
  }

  /** 旧数据没有修订号 → 迁移到初始版本 v1 */
  function migrateToInitial(data: Scheme) {
    data.version = 1
    data.stages.forEach((stage) => { stage.revision = 1 })
    data.detours.forEach((route) => { route.revision = 1 })
    data.comments.forEach((comment) => {
      comment.authoredRevision = 1
      if (comment.status === '已接受') comment.confirmedRevision = 1
      else comment.confirmedRevision = undefined
    })
    data.revisions = [{
      number: 1, time: now(), author: '系统',
      summary: '旧数据无修订号，迁移至初始版本',
      snapshot: { stages: clone(data.stages), detours: clone(data.detours), comments: clone(data.comments) },
    }]
  }

  /** 离线恢复：按修订号合并。远端新用远端，本地新用本地，相同则合并修订链 */
  function mergeWithRemote(remote: Scheme): { merged: Scheme; reason: string } {
    const local = scheme.value
    if (remote.version > local.version) return { merged: remote, reason: `远端修订 v${remote.version} 较新，已采用远端数据` }
    if (local.version > remote.version) return { merged: local, reason: `本地修订 v${local.version} 较新，保留本地数据` }
    const byNumber = new Map<number, RevisionRecord>()
    for (const record of local.revisions) byNumber.set(record.number, record)
    for (const record of remote.revisions) if (!byNumber.has(record.number)) byNumber.set(record.number, record)
    const merged: Scheme = { ...local, revisions: [...byNumber.values()].sort((a, b) => a.number - b.number) }
    return { merged, reason: `修订号相同（v${local.version}），已合并双方修订链` }
  }

  /** 模拟离线恢复：拉取远端并按修订号合并 */
  function recoverOffline(): string {
    const remote = buildSeed()
    const { merged, reason } = mergeWithRemote(remote)
    scheme.value = merged
    persist()
    return reason
  }

  // ---- 编辑动作 ----
  function startDraw() { drawing.value = true; draftRoute.value = [] }
  function addPoint(point: [number, number]) { if (drawing.value) draftRoute.value.push(point) }
  function finishDraw() {
    if (draftRoute.value.length >= 2) {
      const stage = selectedStage.value
      if (stage) {
        commit()
        stage.route = [...draftRoute.value]
        stage.status = '待协商'
        stage.revision = scheme.value.version + 1
        commitRevision(`调整阶段 ${stage.id} 封路范围`)
      }
    }
    drawing.value = false
    draftRoute.value = []
  }
  function updateStage(patch: Partial<ClosureStage>) {
    const stage = selectedStage.value
    if (!stage) return
    commit()
    Object.assign(stage, patch)
    stage.status = '待协商'
    stage.revision = scheme.value.version + 1
    commitRevision(`更新阶段 ${stage.id} 施工条件`)
  }
  function resolveComment(id: string, status: SegmentComment['status']) {
    const comment = scheme.value.comments.find((item) => item.id === id)
    if (!comment) return
    commit()
    comment.status = status
    if (status === '已接受') comment.confirmedRevision = scheme.value.version + 1
    else comment.confirmedRevision = undefined
    commitRevision(status === '已接受' ? `确认会签意见 ${id}` : `退回会签意见 ${id}`)
  }
  function undo() {
    const previous = history.value.pop()
    if (previous) { scheme.value = JSON.parse(previous); persist() }
  }
  watch(selectedStageId, () => {})
  restore()

  return {
    scheme, selectedStageId, selectedCommentId, selectedStage, selectedComment,
    drawing, draftRoute, conflicts, dirty,
    staleComments, pendingComments, unconfirmedStages, allConfirmed,
    isCommentStale, isCommentValid,
    startDraw, addPoint, finishDraw, updateStage, resolveComment,
    mergeWithRemote, recoverOffline, undo,
  }
})
