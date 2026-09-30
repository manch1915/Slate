/** 本机画廊隐藏索引，不删除后端任务或文件。状态变化后自动重新显示。 */
type Entry = { id?: string; status: string; created_at?: string; started_at?: string; updated_at?: string; outputs?: string[]; note?: string; gallery_hidden_status?: string }
export type HiddenEntries = Record<string, string>
const DAY = 24 * 60 * 60 * 1000
const failures = new Set(['error', 'failed', 'abnormal', 'cancelled', 'canceled', 'interrupted', 'timeout'])

export function isAbnormal(item: Entry, now = Date.now()): boolean {
  if (failures.has(item.status)) return true
  if (item.status === 'done') return !item.outputs?.length
  if (!['running', 'generating'].includes(item.status)) return false
  const started = Date.parse(item.started_at || item.created_at || '')
  return Number.isFinite(started) && now - started > DAY
}
function fingerprint(item: Entry): string {
  return JSON.stringify([item.status, item.created_at, item.started_at, item.updated_at, item.outputs, item.note])
}
export function visibleEntries<T extends Entry>(items: T[], hidden: HiddenEntries): T[] {
  // 历史批次清理仅作用于当时的状态；任务后续完成后自动重新显示。
  return items.filter(item => item.gallery_hidden_status !== item.status && (!item.id || hidden[item.id] !== fingerprint(item)))
}
export function hideAbnormal(items: Entry[], hidden: HiddenEntries, now = Date.now()): HiddenEntries {
  const next = { ...hidden }
  for (const item of items) if (item.id && isAbnormal(item, now)) next[item.id] = fingerprint(item)
  return next
}
export function readHidden(raw: string | null): HiddenEntries {
  try {
    const value = JSON.parse(raw || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string')) as HiddenEntries
  } catch { return {} }
}
