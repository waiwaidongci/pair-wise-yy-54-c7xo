import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  ChainEntry,
  ChangeAspect,
  ClosureStage,
  CommentAuditLog,
  CommentStatus,
  ContentPatch,
  NoticePayload,
  PersistedState,
  SchemeSnapshot,
  SegmentComment,
} from '../types'

const STORAGE_KEY = 'yy54-road-scheme-v2'
const LEGACY_STORAGE_KEY = 'yy54-road-scheme-v1'

const STAGE_ASPECTS: ChangeAspect[] = ['geometry', 'time', 'control']

const seedSnapshot: SchemeSnapshot = {
  id: 'RC-2026-0918', project: '云河路快速化改造', contractor: '市政建设集团第三工程处', area: '云河路 / 江海大道',
  stages: [
    { id: 'ST-01', name: '第一阶段 · 东半幅围挡', start: '2026-10-08', end: '2026-10-22', lanes: '双向 4 车道收窄为 2 车道', status: '条件通过', route: [[121.470, 31.228], [121.482, 31.231], [121.496, 31.235]] },
    { id: 'ST-02', name: '第二阶段 · 路口夜间施工', start: '2026-10-23', end: '2026-11-05', lanes: '22:00–05:00 全封闭', status: '待协商', route: [[121.496, 31.235], [121.508, 31.238], [121.516, 31.242]] },
    { id: 'ST-03', name: '第三阶段 · 西半幅恢复', start: '2026-11-06', end: '2026-11-18', lanes: '西侧公交专用道临时占用', status: '退回', route: [[121.452, 31.224], [121.462, 31.226], [121.470, 31.228]] },
  ],
  detours: [
    { id: 'DR-01', name: '江海大道—滨河路绕行', distance: 4.8, extraMinutes: 11, stageId: 'ST-02', coordinates: [[121.470, 31.228], [121.478, 31.214], [121.502, 31.218], [121.516, 31.242]] },
    { id: 'DR-02', name: '云河路辅道保通', distance: 2.3, extraMinutes: 6, stageId: 'ST-01', coordinates: [[121.452, 31.224], [121.462, 31.219], [121.496, 31.235]] },
  ],
  comments: [
    { id: 'CM-41', segmentId: 'ST-01', unit: '公交', author: '顾敏', content: '17 路、806 路临时站点与云河路站距离 680 米，超过老年乘客可接受步行距离。', condition: '需在江海大道口增设临时站并配置导乘人员。', status: '待处理', logs: [] },
    { id: 'CM-42', segmentId: 'ST-02', unit: '应急', author: '夏川', content: '夜间全封闭期间，区域急救中心南门通道被切断。', condition: '保留 4 米应急通道，路口导改每 15 分钟巡查一次。', status: '已接受', logs: [{ at: '2026-10-04 09:31', action: '已接受', rev: 1 }] },
    { id: 'CM-43', segmentId: 'ST-03', unit: '交通', author: '郑航', content: '公交专用道占用导致高峰小时延误增加 19 分钟，超过方案阈值。', condition: '缩减围挡 1.5 米并调整信号配时。', status: '已退回', logs: [{ at: '2026-10-04 11:08', action: '已退回', rev: 1 }] },
  ],
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

let clientSeq = 0
function localClientId(): string {
  clientSeq += 1
  return `local-${Date.now().toString(36)}-${clientSeq}`
}

/** 旧版本地数据（无修订号）迁移：整体作为初始修订 R1，全部意见锚定 R1 */
function migrateLegacy(raw: string): PersistedState | null {
  try {
    const old = JSON.parse(raw) as Partial<SchemeSnapshot> & { version?: number }
    if (!old || !Array.isArray(old.stages) || !Array.isArray(old.comments)) return null
    const snapshot: SchemeSnapshot = {
      id: old.id ?? seedSnapshot.id,
      project: old.project ?? seedSnapshot.project,
      contractor: old.contractor ?? seedSnapshot.contractor,
      area: old.area ?? seedSnapshot.area,
      stages: clone(old.stages),
      detours: clone(old.detours ?? []),
      comments: old.comments.map((comment) => ({ ...comment, logs: comment.logs ?? [], confirmedRev: 1 })),
    }
    const entry: ChainEntry = {
      rev: 1,
      type: 'revision',
      author: '系统迁移',
      at: nowText(),
      summary: `旧版草案 v${old.version ?? '?'} 迁移至初始修订 R1，全部会签意见锚定 R1`,
      changes: { stageIds: snapshot.stages.map((s) => s.id), detourIds: snapshot.detours.map((d) => d.id), aspects: ['geometry', 'time', 'control', 'detour'], summary: '历史数据迁移' },
      migrated: true,
      snapshot,
    }
    return { chain: [entry], offline: false, serverCopy: null }
  } catch {
    return null
  }
}

function seedState(): PersistedState {
  const snapshot = clone(seedSnapshot)
  snapshot.comments.forEach((comment) => { comment.confirmedRev = 1 })
  const entry: ChainEntry = {
    rev: 1,
    type: 'revision',
    author: '建设组',
    at: '2026-10-04 16:22',
    summary: '初始封路方案：三段施工围挡、两条绕行路线，各单位会签意见锚定本修订',
    changes: { stageIds: snapshot.stages.map((s) => s.id), detourIds: snapshot.detours.map((d) => d.id), aspects: ['geometry', 'time', 'control', 'detour'], summary: '初始方案' },
    snapshot,
  }
  return { chain: [entry], offline: false, serverCopy: null }
}

function load(): PersistedState {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw) {
    try {
      const state = JSON.parse(raw) as PersistedState
      if (Array.isArray(state.chain) && state.chain.length > 0) return state
    } catch { /* fall through */ }
  }
  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
  if (legacy) {
    const migrated = migrateLegacy(legacy)
    if (migrated) return migrated
  }
  return seedState()
}

function persistState(state: PersistedState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ chain: state.chain, offline: state.offline, serverCopy: state.serverCopy }))
}

/** 修订是否影响指定阶段的意见锚点（含挂在该阶段上的绕行） */
function revisionAffects(entry: ChainEntry, segmentId: string): boolean {
  if (entry.type !== 'revision' || !entry.changes) return false
  if (entry.changes.stageIds.includes(segmentId)) return true
  return entry.changes.detourIds.some((detourId) => {
    const detour = entry.snapshot.detours.find((d) => d.id === detourId)
    return detour?.stageId === segmentId
  })
}

/** 在指定修订的快照上重放内容补丁，用于离线分叉合并 */
function applyPatch(snapshot: SchemeSnapshot, patch: ContentPatch): ChangeAspect[] {
  const aspects: ChangeAspect[] = []
  if (patch.stageId && patch.stagePatch) {
    const stage = snapshot.stages.find((s) => s.id === patch.stageId)
    if (stage) {
      if ('route' in patch.stagePatch) aspects.push('geometry')
      if ('start' in patch.stagePatch || 'end' in patch.stagePatch) aspects.push('time')
      if ('lanes' in patch.stagePatch) aspects.push('control')
      if ('name' in patch.stagePatch) aspects.push('meta')
      Object.assign(stage, patch.stagePatch)
    }
  }
  if (patch.detourId && patch.detourPatch) {
    const detour = snapshot.detours.find((d) => d.id === patch.detourId)
    if (detour) { aspects.push('detour'); Object.assign(detour, patch.detourPatch) }
  }
  return aspects
}

export const useSchemeStore = defineStore('scheme', () => {
  const initial = load()
  const chain = ref<ChainEntry[]>(initial.chain)
  const offline = ref(initial.offline)
  const serverCopy = ref<ChainEntry[] | null>(initial.serverCopy)
  if (!localStorage.getItem(STORAGE_KEY)) persistState(initial)
  const selectedStageId = ref('ST-01')
  const selectedCommentId = ref('CM-41')
  const viewingRev = ref<number | null>(null)
  const drawing = ref(false)
  const draftRoute = ref<[number, number][]>([])

  const current = computed<SchemeSnapshot>(() => chain.value[chain.value.length - 1].snapshot)
  const revisionNo = computed(() => Math.max(...chain.value.map((entry) => entry.rev)))
  const revisions = computed(() => chain.value.filter((entry) => entry.type === 'revision'))
  const notices = computed(() => chain.value.filter((entry) => entry.type === 'notice'))

  /** 查看历史版本时的只读快照；null 表示查看当前版本 */
  const viewedEntry = computed(() => {
    if (viewingRev.value == null) return chain.value[chain.value.length - 1]
    return chain.value.find((entry) => entry.rev === viewingRev.value) ?? null
  })
  const isViewingHistory = computed(() => viewingRev.value != null && viewingRev.value !== currentRevisionNo())
  function currentRevisionNo() { return revisionNo.value }

  /** 意见在当前链头部的派生状态：确认修订之后又有影响其锚点的修订 → 待重新确认 */
  function commentState(comment: SegmentComment): CommentStatus | '待重新确认' {
    return commentStateAt(comment, revisionNo.value)
  }

  /** 意见在指定修订号时点的状态，用于历史版本查看 */
  function commentStateAt(comment: SegmentComment, maxRev: number): CommentStatus | '待重新确认' {
    const confirmedRev = comment.confirmedRev ?? 1
    if (comment.status === '已接受') {
      const invalidated = chain.value.some((entry) => entry.rev > confirmedRev && entry.rev <= maxRev && revisionAffects(entry, comment.segmentId))
      if (invalidated) return '待重新确认'
    }
    return comment.status
  }

  /** 使意见失效的第一条修订，供界面提示“被哪一版作废” */
  function invalidatedByRev(comment: SegmentComment): number | null {
    const confirmedRev = comment.confirmedRev ?? 1
    const hit = chain.value.find((entry) => entry.rev > confirmedRev && revisionAffects(entry, comment.segmentId))
    return hit ? hit.rev : null
  }

  const commentsView = computed(() => current.value.comments.map((comment) => ({ comment, state: commentState(comment) })))

  /** 阶段确认：该阶段及其关联绕行、锚定该阶段的已接受意见，最新修订号一致且无会签阻塞 */
  function stageConfirmedRev(stageId: string): number {
    let rev = 1
    for (const entry of chain.value) {
      if (entry.type === 'revision' && revisionAffects(entry, stageId)) rev = entry.rev
    }
    return rev
  }
  function stageState(stageId: string): { confirmed: boolean; pending: boolean; reasons: string[] } {
    const rev = stageConfirmedRev(stageId)
    const reasons: string[] = []
    const blocking = current.value.comments.filter((comment) => comment.segmentId === stageId)
    for (const comment of blocking) {
      const state = commentState(comment)
      if (state === '待处理') reasons.push(`${comment.unit}单位意见待处理`)
      if (state === '待重新确认') reasons.push(`${comment.unit}单位意见因 R${comment.confirmedRev} 后修订需重新确认`)
      if (state === '已退回') reasons.push(`${comment.unit}单位已退回，待修改方案`)
    }
    return { confirmed: reasons.length === 0, pending: reasons.length > 0, reasons }
  }
  const stageStates = computed(() => Object.fromEntries(current.value.stages.map((stage) => [stage.id, stageState(stage.id)])))
  const unconfirmedStages = computed(() => current.value.stages.filter((stage) => stageStates.value[stage.id].pending))
  const allStagesConfirmed = computed(() => unconfirmedStages.value.length === 0)
  const validAcceptedCount = computed(() => current.value.comments.filter((c) => commentState(c) === '已接受').length)

  const selectedStage = computed(() => current.value.stages.find((item) => item.id === selectedStageId.value))
  const selectedComment = computed(() => current.value.comments.find((item) => item.id === selectedCommentId.value))

  const conflicts = computed(() => [
    ...(current.value.stages.some((stage) => stage.id === 'ST-02') ? [{ id: 'CF-01', level: '高', segmentId: 'ST-02', title: '相邻雨污分流工程时间重叠', detail: '10 月 26–30 日江海大道东段同步占用慢车道，建议错峰 4 天。' }] : []),
    { id: 'CF-02', level: '高', segmentId: 'ST-02', title: '救护通道中断风险', detail: '夜间全封闭将切断区域急救中心南门，必须保留 4 米应急通道。' },
    { id: 'CF-03', level: '中', segmentId: 'ST-01', title: '公交站点覆盖缺口', detail: '17 路与 806 路临时站距现状站 680 米，已超过 500 米阈值。' },
    { id: 'CF-04', level: '中', segmentId: 'ST-03', title: '绕行延误超阈值', detail: '高峰绕行新增 19 分钟，超过方案设定的 15 分钟阈值。' },
  ])

  function persist() {
    const state: PersistedState = { chain: chain.value, offline: offline.value, serverCopy: serverCopy.value }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }

  /** 方案内容修订：新修订只让受影响阶段的意见失效，其余单位意见不动 */
  function appendRevision(author: string, summary: string, changes: NonNullable<ChainEntry['changes']>, patch?: ContentPatch) {
    const snapshot = clone(current.value)
    if (patch) applyPatch(snapshot, patch)
    const rev = revisionNo.value + 1
    chain.value.push({ rev, type: 'revision', author, at: nowText(), summary, changes: clone(changes), patch: patch ? clone(patch) : undefined, clientId: localClientId(), snapshot })
    persist()
  }

  function describeAspects(aspects: ChangeAspect[]): string {
    const labels: Record<ChangeAspect, string> = { geometry: '围挡范围', time: '时间', control: '控制条件', detour: '绕行', meta: '名称信息' }
    return aspects.filter((a) => a !== 'meta').map((a) => labels[a]).join('、') || '名称信息'
  }

  function changeOf(patch: Partial<ClosureStage> | Partial<import('../types').DetourRoute>, aspects: ChangeAspect[], stageId: string, detourId?: string): NonNullable<ChainEntry['changes']> {
    return {
      stageIds: detourId ? [] : [stageId],
      detourIds: detourId ? [detourId] : [],
      aspects,
      summary: describeAspects(aspects),
    }
  }

  function startDraw() { drawing.value = true; draftRoute.value = [] }
  function addPoint(point: [number, number]) { if (drawing.value) draftRoute.value.push(point) }
  function cancelDraw() { drawing.value = false; draftRoute.value = [] }
  function finishDraw(author = '建设组') {
    if (draftRoute.value.length >= 2 && selectedStage.value) {
      const stage = selectedStage.value
      const patch: ContentPatch = { stageId: stage.id, stagePatch: { route: [...draftRoute.value], status: '待协商' } }
      appendRevision(author, `${stage.id} 围挡范围重绘（${draftRoute.value.length} 个控制点）`, changeOf(patch.stagePatch!, ['geometry'], stage.id), patch)
    }
    drawing.value = false
    draftRoute.value = []
  }

  function updateStage(patch: Partial<ClosureStage>, author = '建设组') {
    const stage = selectedStage.value
    if (!stage) return
    const aspects: ChangeAspect[] = []
    if ('route' in patch) aspects.push('geometry')
    if ('start' in patch || 'end' in patch) aspects.push('time')
    if ('lanes' in patch) aspects.push('control')
    if ('name' in patch) aspects.push('meta')
    if (aspects.length === 0) return
    const fullPatch: ContentPatch = { stageId: stage.id, stagePatch: { ...patch, ...(aspects.some((a) => STAGE_ASPECTS.includes(a)) ? { status: '待协商' as const } : {}) } }
    appendRevision(author, `${stage.id} 修改${describeAspects(aspects)}`, changeOf(patch, aspects, stage.id), fullPatch)
  }

  function updateDetour(detourId: string, patch: Partial<import('../types').DetourRoute>, author = '建设组') {
    const detour = current.value.detours.find((d) => d.id === detourId)
    if (!detour) return
    const fullPatch: ContentPatch = { detourId, detourPatch: patch }
    appendRevision(author, `${detour.name} 绕行条件调整`, { stageIds: [], detourIds: [detourId], aspects: ['detour'], summary: '绕行' }, fullPatch)
  }

  /** 会签动作：进入审计记录；重新确认时把锚点更新到当前修订号 */
  function resolveComment(id: string, status: CommentStatus, author?: string) {
    const snapshot = clone(current.value)
    const comment = snapshot.comments.find((item) => item.id === id)
    if (!comment) return
    comment.status = status
    if (status === '已接受') comment.confirmedRev = revisionNo.value
    const log: CommentAuditLog = { at: nowText(), action: status, rev: revisionNo.value + 1 }
    comment.logs = [...comment.logs, log]
    const actor = author ?? `${comment.unit}单位`
    chain.value.push({
      rev: revisionNo.value + 1,
      type: 'revision',
      author: actor,
      at: nowText(),
      summary: `${comment.unit}单位（${comment.author}）${status}意见 ${comment.id}${status === '已接受' ? `，确认锚定 R${comment.confirmedRev}` : ''}`,
      changes: { stageIds: [], detourIds: [], aspects: [], summary: '会签确认' },
      clientId: localClientId(),
      snapshot,
    })
    persist()
  }

  /** 收齐当前有效意见后才能生成通告；未确认阶段单列；通告本身是链上条目，历史通告可查看 */
  function issueNotice(): NoticePayload | null {
    if (!allStagesConfirmed.value) return null
    const snapshot = clone(current.value)
    const units = [...new Set(snapshot.comments.map((c) => c.unit))]
    const body = [
      `${snapshot.project} 施工封路公开通告`,
      `方案编号：${snapshot.id}　依据修订：R${revisionNo.value}`,
      `范围：${snapshot.area}`,
      '',
      ...snapshot.stages.map((stage) => `${stage.start} 至 ${stage.end}｜${stage.name}｜${stage.lanes}`),
      '',
      '绕行建议：',
      ...snapshot.detours.map((route) => `${route.name}（${route.distance} km），增加约 ${route.extraMinutes} 分钟`),
      '',
      `本通告依据修订 R${revisionNo.value} 发布，经 ${units.join('、')} 单位当前有效意见全部确认。后续方案修订以新版本通告为准。`,
    ].join('\n')
    const payload: NoticePayload = {
      noticeId: `NT-${snapshot.id}-R${revisionNo.value}`,
      title: `${snapshot.project} 施工封路公开通告（R${revisionNo.value}）`,
      body,
      issuedAt: nowText(),
      unconfirmedStages: [],
    }
    chain.value.push({ rev: revisionNo.value + 1, type: 'notice', author: '建设组', at: nowText(), summary: `依据 R${revisionNo.value} 生成公开通告，全部 ${snapshot.stages.length} 个阶段会签齐备`, notice: payload, clientId: localClientId(), snapshot })
    persist()
    return payload
  }

  function previewNotice(): { ready: boolean; body: string; unconfirmed: { id: string; name: string; reasons: string[] }[] } {
    const snapshot = current.value
    const unconfirmed = unconfirmedStages.value.map((stage) => ({ id: stage.id, name: stage.name, reasons: stageStates.value[stage.id].reasons }))
    const body = [
      `${snapshot.project} 施工封路公告（预览）`,
      `依据修订：R${revisionNo.value}`,
      '',
      ...(allStagesConfirmed.value
        ? [...snapshot.stages.map((stage) => `${stage.start} 至 ${stage.end}｜${stage.name}｜${stage.lanes}`), '', '绕行建议：', ...snapshot.detours.map((route) => `${route.name}，增加约 ${route.extraMinutes} 分钟`)]
        : ['【暂不能发布】以下阶段尚未完成当前修订下的会签确认，已单列：', '', ...unconfirmed.flatMap((stage) => [`· ${stage.id} ${stage.name}`, ...stage.reasons.map((reason) => `    - ${reason}`)])]),
    ].join('\n')
    return { ready: allStagesConfirmed.value, body, unconfirmed }
  }

  function downloadNotice(rev: number) {
    const entry = chain.value.find((item) => item.rev === rev && item.type === 'notice')
    if (!entry?.notice) return
    const blob = new Blob([entry.notice.body], { type: 'text/plain;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${entry.notice.noticeId}.txt`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  function viewRevision(rev: number | null) { viewingRev.value = rev }

  /* ---------------- 离线与按修订号合并 ---------------- */

  /** 模拟协同方在离线期间提交了一条修订（落在 serverCopy 上），用于演示恢复合并 */
  function simulateServerRevision() {
    if (offline.value) return
    offline.value = true
    serverCopy.value = clone(chain.value)
    persist()
  }
  function peerRevision() {
    if (!offline.value || !serverCopy.value) return
    const base = clone(serverCopy.value[serverCopy.value.length - 1].snapshot)
    const stage = base.stages.find((s) => s.id === 'ST-02')
    if (!stage) return
    stage.lanes = `${stage.lanes}；协同方补充 22:30 后限速 30 km/h`
    const lanes = stage.lanes
    const nextRev = Math.max(...serverCopy.value.map((e) => e.rev)) + 1
    serverCopy.value.push({
      rev: nextRev, type: 'revision', author: '交通组（协同端）', at: nowText(),
      summary: 'ST-02 增加夜间限速 30 km/h 控制条件',
      changes: { stageIds: ['ST-02'], detourIds: [], aspects: ['control'], summary: '控制条件' },
      patch: { stageId: 'ST-02', stagePatch: { lanes } },
      clientId: `peer-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`,
      snapshot: base,
    })
    persist()
  }

  /**
   * 离线恢复：按修订号合并。
   * 本地与服务端从共同基线分叉——服务端独有条目（编号更高）整体并入，
   * 本地独有内容修订以补丁方式重放到合并后的头部；冲突时保留本地值并标注。
   * 会签意见按条目 id 取最新动作，重新锚定到合并后的影响修订号。
   */
  function reconnect(): { mergedRevs: number; replayed: number; conflicts: string[] } | null {
    if (!offline.value || !serverCopy.value) return null
    const local = chain.value
    const server = serverCopy.value

    // 离线期间两侧都从同一快照连续追加、编号会撞车；
    // 断网前的共同条目均无 clientId，分叉后各端条目带来源唯一标识，据此切出共同基线。
    let prefixLen = 0
    while (
      prefixLen < Math.min(local.length, server.length)
      && !local[prefixLen].clientId
      && !server[prefixLen].clientId
    ) prefixLen += 1
    const serverOnly = server.slice(prefixLen)
    const localOnly = local.slice(prefixLen)

    const merged: ChainEntry[] = server.slice(0, prefixLen).map((entry) => clone(entry))
    // 服务端独有条目直接并入
    for (const entry of serverOnly) merged.push(clone(entry))

    // 本地独有修订：在合并头部快照上重放补丁
    let head = clone(merged[merged.length - 1].snapshot)
    let replayed = 0
    const conflictNotes: string[] = []
    // 记录本地旧修订号与合并后新链条目对应关系，用于重锚意见 confirmedRev
    const replayedEntries: { oldRev: number; entry: ChainEntry }[] = []
    for (const entry of localOnly) {
      if (entry.type === 'notice') continue // 旧基线通告作废，意见齐备后重新发布
      if (entry.patch) {
        const aspects = applyPatch(head, entry.patch)
        const sameStage = !!entry.patch.stageId && serverOnly.some((s) => s.changes?.stageIds.includes(entry.patch!.stageId!) && s.changes!.aspects.some((a) => entry.changes?.aspects.includes(a)))
        const sameDetour = !!entry.patch.detourId && serverOnly.some((s) => s.changes?.detourIds.includes(entry.patch!.detourId!))
        if (sameStage || sameDetour) conflictNotes.push(`本地 R${entry.rev} 与协同端修改落在同一处（${entry.patch.stageId ?? entry.patch.detourId}），已保留本地值，请人工核对`)
        const nextRev = merged.length + 1
        const replayedEntry: ChainEntry = {
          rev: nextRev, type: 'revision', author: `${entry.author}（离线重放）`, at: entry.at,
          summary: entry.summary,
          changes: { ...clone(entry.changes!), aspects: aspects.length ? aspects : entry.changes!.aspects },
          patch: clone(entry.patch),
          merged: true,
          clientId: `merge-${entry.clientId ?? localClientId()}`,
          snapshot: clone(head),
        }
        merged.push(replayedEntry)
        replayedEntries.push({ oldRev: entry.rev, entry: replayedEntry })
        replayed += 1
      } else {
        // 无补丁的本地条目（会签动作）：把意见状态合并进头部
        for (const localComment of entry.snapshot.comments) {
          const target = head.comments.find((c) => c.id === localComment.id)
          if (!target) { head.comments.push(clone(localComment)); continue }
          const localLast = localComment.logs[localComment.logs.length - 1]
          const targetLast = target.logs[target.logs.length - 1]
          if (localLast && (!targetLast || localLast.at >= targetLast.at)) {
            target.status = localComment.status
            target.logs = localComment.logs
            target.confirmedRev = localComment.confirmedRev
          }
        }
        const replayedEntry: ChainEntry = {
          rev: merged.length + 1, type: 'revision', author: entry.author, at: entry.at, summary: `离线期间会签动作合并：${entry.summary}`,
          changes: { stageIds: [], detourIds: [], aspects: [], summary: '离线会签合并' },
          merged: true,
          clientId: `merge-${entry.clientId ?? localClientId()}`,
          snapshot: clone(head),
        }
        merged.push(replayedEntry)
        replayedEntries.push({ oldRev: entry.rev, entry: replayedEntry })
        replayed += 1
      }
    }

    // 合并前记录旧编号，随后重排为连续编号
    const oldRevs = merged.map((entry) => entry.rev)
    merged.forEach((entry, index) => { entry.rev = index + 1 })

    // 分叉后两侧编号会重复，意见锚点不能按编号统一映射：
    // 对每条已接受意见，找到它“最后一次接受动作”所在的合并条目，锚到该条目的新编号。
    const acceptedConfirmRev = new Map<string, number>()
    for (const entry of merged) {
      if (entry.type !== 'revision' || entry.patch) continue
      for (const comment of entry.snapshot.comments) {
        if (comment.status !== '已接受' || comment.confirmedRev == null) continue
        const lastLog = comment.logs[comment.logs.length - 1]
        if (lastLog && lastLog.action === '已接受') {
          acceptedConfirmRev.set(comment.id, entry.rev)
        }
      }
    }
    const revMap = new Map<number, number>()
    oldRevs.forEach((oldRev, index) => revMap.set(oldRev, index + 1))
    for (const comment of head.comments) {
      const actionRev = acceptedConfirmRev.get(comment.id)
      comment.confirmedRev = actionRev ?? (comment.confirmedRev != null ? revMap.get(comment.confirmedRev) ?? comment.confirmedRev : comment.confirmedRev)
    }
    // 头部条目替换为重锚后的最终快照
    merged[merged.length - 1].snapshot = clone(head)

    chain.value = merged
    offline.value = false
    serverCopy.value = null
    persist()
    return { mergedRevs: serverOnly.length, replayed, conflicts: conflictNotes }
  }

  return {
    chain, offline, revisions, notices, revisionNo, current, viewingRev, viewedEntry, isViewingHistory,
    selectedStageId, selectedCommentId, selectedStage, selectedComment, drawing, draftRoute,
    commentsView, commentState, commentStateAt, invalidatedByRev, stageStates, stageConfirmedRev, unconfirmedStages, allStagesConfirmed, validAcceptedCount, conflicts,
    startDraw, addPoint, cancelDraw, finishDraw, updateStage, updateDetour, resolveComment,
    issueNotice, previewNotice, downloadNotice, viewRevision,
    simulateServerRevision, peerRevision, reconnect,
  }
})
