export type StageStatus = '待协商' | '条件通过' | '已批准' | '退回'

/** 会签意见的存储状态；“待重新确认”由修订链派生，不落库 */
export type CommentStatus = '待处理' | '已接受' | '已退回'
export type DerivedCommentState = CommentStatus | '待重新确认'

/** 修订影响面：围挡几何 / 时间 / 控制条件（车道与疏导）/ 绕行 / 纯名称信息 */
export type ChangeAspect = 'geometry' | 'time' | 'control' | 'detour' | 'meta'

export type ChainEntryType = 'revision' | 'notice'

export interface ClosureStage {
  id: string
  name: string
  start: string
  end: string
  lanes: string
  status: StageStatus
  route: [number, number][]
}

export interface DetourRoute {
  id: string
  name: string
  distance: number
  extraMinutes: number
  /** 绕行所服务的施工阶段，绕行条件变化时据此定位受影响的会签意见 */
  stageId: string
  coordinates: [number, number][]
}

export interface CommentAuditLog {
  at: string
  action: DerivedCommentState
  rev: number
}

export interface SegmentComment {
  id: string
  segmentId: string
  unit: '建设' | '交通' | '公交' | '应急'
  author: string
  content: string
  condition?: string
  status: CommentStatus
  /** 意见最近一次被确认时锚定的修订号；旧数据迁移时置为初始修订号 */
  confirmedRev?: number
  logs: CommentAuditLog[]
}

/** 方案内容的全量快照，挂在每条链条目上，保证历史版本可直接查看 */
export interface SchemeSnapshot {
  id: string
  project: string
  contractor: string
  area: string
  stages: ClosureStage[]
  detours: DetourRoute[]
  comments: SegmentComment[]
}

export interface ChangeRecord {
  stageIds: string[]
  detourIds: string[]
  aspects: ChangeAspect[]
  summary: string
}

/** 离线产生分叉时用于在对端基线上重放的结构化补丁 */
export interface ContentPatch {
  stageId?: string
  stagePatch?: Partial<ClosureStage>
  detourId?: string
  detourPatch?: Partial<DetourRoute>
}

export interface NoticePayload {
  noticeId: string
  title: string
  body: string
  issuedAt: string
  /** 通告单列的、当时尚未确认的阶段 */
  unconfirmedStages: string[]
}

export interface ChainEntry {
  rev: number
  type: ChainEntryType
  author: string
  at: string
  summary: string
  changes?: ChangeRecord
  patch?: ContentPatch
  notice?: NoticePayload
  migrated?: boolean
  merged?: boolean
  /** 条目来源唯一标识：断网前的共同条目为空；分叉后各端各自生成，用于合并时识别共同前缀 */
  clientId?: string
  snapshot: SchemeSnapshot
}

export interface PersistedState {
  chain: ChainEntry[]
  offline: boolean
  /** 断网瞬间的服务端链副本，离线期间协同方的修订只落在该副本上 */
  serverCopy: ChainEntry[] | null
}
