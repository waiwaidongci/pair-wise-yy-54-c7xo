export type StageStatus = '待协商' | '条件通过' | '已批准' | '退回'

export interface ClosureStage {
  id: string
  name: string
  start: string
  end: string
  lanes: string
  status: StageStatus
  route: [number, number][]
  /** 围挡范围 / 时间 / 车道等条件最后一次变更时的修订号 */
  revision: number
}

export interface DetourRoute {
  id: string
  name: string
  distance: number
  extraMinutes: number
  coordinates: [number, number][]
  /** 绕行路线最后一次变更时的修订号 */
  revision: number
}

export interface SegmentComment {
  id: string
  segmentId: string
  unit: '建设' | '交通' | '公交' | '应急'
  author: string
  content: string
  condition?: string
  status: '待处理' | '已接受' | '已退回'
  /** 意见提出时的修订号 */
  authoredRevision: number
  /** 最近一次确认（接受）时的修订号；未确认或已退回为空 */
  confirmedRevision?: number
}

/** 修订链上的一条记录，快照用于历史版本查看 */
export interface RevisionRecord {
  number: number
  time: string
  author: string
  summary: string
  snapshot: {
    stages: ClosureStage[]
    detours: DetourRoute[]
    comments: SegmentComment[]
  }
}

export interface Scheme {
  id: string
  project: string
  contractor: string
  area: string
  /** 当前修订号（修订链末位） */
  version: number
  /** 施工阶段、会签意见、公开通告共用的同一条修订链 */
  revisions: RevisionRecord[]
  stages: ClosureStage[]
  detours: DetourRoute[]
  comments: SegmentComment[]
}
