// -*- coding: utf-8 -*-
/** ChatGPT 浏览器运行的前端纯视图模型。完成口径只认服务端 imported。 */

export interface ChatGPTRunAttempt {
  attempt_id: string
  job_id: string
  phase: string
  missing_refs?: string[]
  result?: Record<string, unknown> | null
}

export interface ChatGPTRun {
  run_id: string
  project?: string
  status: string
  pause_reason?: string
  job_ids: string[]
  batches: string[][]
  cursor: number
  revision: number
  counts: { total: number; imported: number; remaining: number }
  current_attempt?: ChatGPTRunAttempt | null
  updated_at?: string
  options?: { vision_validation?: boolean; auto_import?: boolean }
  worker_active?: boolean
  stop_requested?: string
  run_token?: string
}

export interface ChatGPTRunView {
  completed: number
  total: number
  remaining: number
  percent: number
  currentBatch: number
  batches: number
  /** 运行状态码（ready / generating / …），显示文案由组件按 i18n 翻译 */
  phase: string
  /** 服务端给出的原因（原样显示）；为空时看 reasonCode */
  actionableReason: string
  reasonCode: '' | 'missing_refs' | 'needs_review'
  missingRefs: string[]
  tone: 'idle' | 'running' | 'success' | 'warning' | 'danger'
}

type JobLike = { id: string; status: string }

export function freezeQueuedJobIds(jobs: JobLike[], selectedIds: string[], limit = 20): string[] {
  const queued = new Set(jobs.filter((job) => job.status === 'queued').map((job) => job.id))
  const frozen: string[] = []
  for (const id of selectedIds) {
    if (queued.has(id) && !frozen.includes(id)) frozen.push(id)
  }
  if (frozen.length > limit) throw new Error(`At most ${limit} jobs per run`)
  return frozen
}

export function toChatGPTRunView(run: ChatGPTRun): ChatGPTRunView {
  const total = Number(run.counts?.total ?? run.job_ids.length)
  const completed = Number(run.counts?.imported ?? run.cursor ?? 0)
  const remaining = Number(run.counts?.remaining ?? Math.max(0, total - completed))
  const percent = total ? Math.max(0, Math.min(100, Math.round(completed / total * 100))) : 0
  const batches = run.batches?.length || Math.max(1, Math.ceil(total / 10))
  const currentBatch = total === 0 ? 0 : Math.min(batches, Math.floor(Math.min(completed, Math.max(0, total - 1)) / 10) + 1)
  const status = String(run.status || 'ready')
  const tone: ChatGPTRunView['tone'] = status === 'done' ? 'success'
    : ['needs_review', 'waiting_dependencies', 'paused'].includes(status) ? 'warning'
      : ['failed', 'cancelled'].includes(status) ? 'danger'
        : ['ready'].includes(status) ? 'idle' : 'running'
  const actionableReason = String(run.pause_reason || '')
  const reasonCode: ChatGPTRunView['reasonCode'] = actionableReason ? ''
    : status === 'waiting_dependencies' ? 'missing_refs'
      : status === 'needs_review' ? 'needs_review' : ''
  return {
    completed,
    total,
    remaining,
    percent,
    currentBatch,
    batches,
    phase: status,
    actionableReason,
    reasonCode,
    missingRefs: run.current_attempt?.missing_refs || [],
    tone,
  }
}
