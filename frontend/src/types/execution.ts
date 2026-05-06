export type ExecutionState =
  | 'CREATED' | 'RUNNING' | 'PAUSED' | 'RESTARTED'
  | 'KILLING' | 'SUCCESS' | 'WARNING' | 'FAILED' | 'KILLED'

export interface ExecutionRow {
  id: string
  namespace: string
  flowId: string
  state: ExecutionState
  startDate: string | null
  endDate: string | null
}

export interface TaskRunRow {
  id: string
  taskId: string
  state: ExecutionState
  startDate: string | null
  endDate: string | null
}

export interface ExecutionDetail extends ExecutionRow {
  inputs: Record<string, unknown>
  taskRuns: TaskRunRow[]
}

export interface ExecutionPage {
  total: number
  page: number
  size: number
  results: ExecutionRow[]
}

export interface HourlyBucket {
  hour: string
  success: number
  failed: number
  running: number
  killed: number
  warning: number
}

export interface SummaryData {
  totalToday: number
  successRate: number
  runningNow: number
  failedToday: number
  hourly: HourlyBucket[]
}

export interface RetriggerResponse {
  newExecutionId: string
  originalExecutionId: string
  triggeredBy: string
  triggeredAt: string
}

export interface FlowRow {
  namespace: string
  flowId: string
  lastRunDate: string | null
  executionCount: number
}

export interface FlowDetail {
  namespace: string
  flowId: string
}

export interface FlowInput {
  id: string
  type: string
}

export interface TriggerResponse {
  newExecutionId: string
  triggeredBy: string
  triggeredAt: string
}
