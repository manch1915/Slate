<script setup lang="ts">
import { t, te } from '../i18n'
import { useBoardSelection } from '../utils/useBoardSelection'
// -*- coding: utf-8 -*-
/** 演员管理：角色卡、连续性记忆、镜头表演候选与显式应用。 */
import { ref, computed, watch, onMounted } from 'vue'
import {
  fetchActingContext, fetchActingCandidates, saveActingContext, prepareActing,
  runActing, applyActingCandidate, setActingLock, evaluateActing, fetchEnvConfig, compileActingPrompt,
  fetchActingEvals, type ActingContextResponse, type ActingCandidate, type ActingShot, type ActingEval, type Vendor
} from '../api'
import { app, toast, projectFiles, loadBasics } from '../stores/app'
import { trackJob } from '../stores/jobs'
import StyledSelect from '../components/StyledSelect.vue'
import StyleSelect from '../components/StyleSelect.vue'
import EmptyState from '../components/EmptyState.vue'

const boards = computed(() => projectFiles('分镜').filter((f) => f.startsWith('剧本_') && f.endsWith('.json')))
const board = ref('')
onMounted(() => { if (!app.projects.length) void loadBasics() })
const data = ref<ActingContextResponse | null>(null)
const candidates = ref<ActingCandidate[]>([])
const loading = ref(false)
const saving = ref(false)
const running = ref(false)
const runningShot = ref('')
const applying = ref('')
const evaluating = ref(false)
const preparing = ref(false)
const revision = ref('')
const selected = ref<Set<string>>(new Set())
const mode = ref<'style' | 'stateful'>('stateful')
const vendorId = ref('')
const vendors = ref<Vendor[]>([])
const preview = ref<{ shot_id: string; prompt: string; performance_used: boolean; asset_refs?: string[]; prompt_json?: Record<string, unknown> | null } | null>(null)
const evals = ref<ActingEval[]>([])
const latestEval = computed(() => evals.value[0] || null)
const total30 = (s: { total?: number | null }) => (s && typeof s.total === 'number' ? String(s.total) : '—')
let evalSeq = 0
async function loadEvals() {
  const request = ++evalSeq, project = app.current, name = board.value
  evals.value = []
  if (!project || !name) return
  try {
    const result = await fetchActingEvals(project, name)
    if (request === evalSeq && project === app.current && name === board.value) evals.value = result.evals || []
  } catch (e) { if (request === evalSeq) toast(e instanceof Error ? e.message : t('views.acting.evalsLoadFailed'), 'err') }
}

const actorCards = ref<Record<string, Record<string, unknown>>>({})
const memoryText = ref('')
let requestSeq = 0

/* 防丢稿：load() 后快照已保存值；触发整页 load() 的操作前检测脏编辑并确认 */
let savedCardsJson = '{}'
let savedNotes = ''
function contextDirty() {
  return JSON.stringify(actorCards.value) !== savedCardsJson || memoryText.value !== savedNotes
}
function confirmDiscardEdits() {
  return !contextDirty() || confirm(t('views.acting.unsaved'))
}
function snapshotContext() {
  savedCardsJson = JSON.stringify(actorCards.value)
  savedNotes = memoryText.value
}

const textVendors = computed(() => vendors.value.filter((v) => v.enabled && (v.models?.text || '')))
const vendorOptions = computed(() => textVendors.value.map((v) => v.id))
const vendorLabels = computed<Record<string, string>>(() =>
  Object.fromEntries(textVendors.value.map((v) => [v.id, (v.label || v.id) + ' · ' + (v.models?.text || '')]))
)
const shots = computed(() => data.value?.shots || [])
const selectableShots = computed(() => shots.value.filter((s) => !s.performance_locked && !!s.actor_ids?.length))
const allSelected = computed(() => selectableShots.value.length > 0 && selectableShots.value.every((s) => selected.value.has(s.id)))
const someSelected = computed(() => selected.value.size > 0 && !allSelected.value)
const actorEntries = computed(() => {
  const actors = data.value?.actors || {}
  if (Array.isArray(actors)) return actors.filter((x) => x.is_main !== false).map((x) => [String(x.id || ''), x] as [string, Record<string, unknown>])
  return Object.entries(actors).filter(([, actor]) => actor?.is_main !== false)
})

function statusLabel(status: string) {
  if (!status) return t('views.acting.status.pending')
  return te('views.acting.status.' + status) ? t('views.acting.status.' + status) : status
}
function statusClass(status: string) {
  return ({ ready: 'bg-emerald-400/15 text-emerald-300', locked: 'bg-amber-400/15 text-amber-300', stale: 'bg-orange-400/15 text-orange-300', invalid: 'bg-rose-400/15 text-rose-300', context_ready: 'bg-cyan-400/15 text-cyan-300' } as Record<string, string>)[status] || 'bg-white/5 text-slate-500'
}
function performanceSummary(s: ActingShot) {
  const p = s.performance as any
  const actors = p?.packet?.actors || p?.actors || []
  if (!Array.isArray(actors)) return ''
  return actors.flatMap((actor: any) => (actor?.beats || []).map((beat: any) => [beat?.intent, beat?.posture, beat?.gaze, beat?.gesture, beat?.expression].filter(Boolean).join('；'))).filter(Boolean).join(' · ')
}
function toggle(id: string) {
  if (!selectableShots.value.some((shot) => shot.id === id)) return
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}
function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(selectableShots.value.map((s) => s.id))
}
function card(id: string) {
  return actorCards.value[id] || (actorCards.value[id] = {
    personality: '', goal: '', relationship: '', expression_rules: '', arc_stage: '',
    source: '', locked_fields: []
  })
}
function field(id: string, key: string): string {
  const value = card(id)[key]
  return value == null ? '' : String(value)
}
function setField(id: string, key: string, value: string) {
  card(id)[key] = key === 'locked_fields'
    ? value.split(',').map((item) => item.trim()).filter(Boolean)
    : value
}
function contextPayload(): Record<string, unknown> {
  const base = (data.value?.context || {}) as Record<string, unknown>
  return { ...base, actor_cards: actorCards.value, notes: memoryText.value }
}

async function load() {
  const seq = ++requestSeq
  ++evalSeq; evals.value = []; candidates.value = []; preview.value = null; data.value = null; actorCards.value = {}; memoryText.value = ''; selected.value = new Set()
  if (!app.current || !board.value) { data.value = null; return }
  loading.value = true
  try {
    const result = await fetchActingContext(app.current, board.value)
    if (seq !== requestSeq || board.value !== result.board) return
    data.value = result
    revision.value = result.revision
    candidates.value = result.candidates || []
    const ctx = result.context || {}
    actorCards.value = (ctx.actor_cards as Record<string, Record<string, unknown>> || {})
    memoryText.value = String(ctx.notes || '')
    snapshotContext()
    selected.value = new Set(result.shots.filter((s) => !s.performance_locked && !!s.actor_ids?.length).map((s) => s.id))
    if (!vendorId.value && textVendors.value.length) vendorId.value = textVendors.value.at(-1)!.id
    void loadEvals()
  } catch (e) {
    if (seq === requestSeq) { data.value = null; toast(e instanceof Error ? e.message : t('views.acting.loadFailed'), 'err') }
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}
async function loadVendors() {
  try {
    vendors.value = (await fetchEnvConfig()).vendors || []
    if (!vendorId.value) vendorId.value = textVendors.value.at(-1)?.id || ''
  } catch { vendors.value = [] }
}
async function saveContext(notify = true) {
  if (!app.current || !board.value || !data.value) return
  saving.value = true
  try {
    const result = await saveActingContext({ project: app.current, storyboard: board.value, revision: revision.value, context: contextPayload() })
    revision.value = result.revision
    if (data.value) data.value.context = result.context
    snapshotContext()
    if (notify) toast(t('views.acting.contextSaved'), 'ok')
  } catch (e) {
    toast(e instanceof Error ? e.message : t('views.acting.contextSaveFailed'), 'err')
    await load()
  } finally { saving.value = false }
}
async function prepare() {
  if (!app.current || !board.value || !data.value) {
    toast(t('views.acting.pickBoard'), 'err'); return
  }
  if (preparing.value) return
  preparing.value = true
  const project = app.current, name = board.value
  try {
    const shotIds = Array.from(selected.value).filter((id) => selectableShots.value.some((shot) => shot.id === id))
    if (!shotIds.length) { toast(t('views.acting.pickLeadShot'), 'err'); return }
    const result = await prepareActing({ project: app.current, storyboard: board.value, shot_ids: shotIds, context: contextPayload(), vendor_id: vendorId.value || undefined })
    const job = await trackJob(result.id, t('views.acting.jobRead'))
    if (!job.success) throw new Error(job.err || t('views.acting.prepareJobFailed'))
    if (project !== app.current || name !== board.value) return
    await refreshCandidates()
    toast(t('views.acting.prepared'), 'ok')
  } catch (e) { toast(e instanceof Error ? e.message : t('views.acting.prepareFailed'), 'err') }
  finally { preparing.value = false }
}
async function runSelected() {
  const shotIds = Array.from(selected.value).filter((id) => selectableShots.value.some((shot) => shot.id === id))
  if (!app.current || !board.value || !vendorId.value || !shotIds.length) {
    toast(t('views.acting.pickShotsVendor'), 'err'); return
  }
  running.value = true
  try {
    // 先落盘当前角色卡/记忆，演员子进程会从正式分镜读取同一份上下文。
    if (data.value) await saveContext(false)
    for (const sid of shotIds) {
      runningShot.value = sid
      const result = await runActing({ project: app.current, storyboard: board.value, shot_id: sid, vendor_id: vendorId.value, mode: mode.value })
      if (!result.id) throw new Error(result.err || t('views.acting.jobNotStarted'))
      const job = await trackJob(result.id, t('views.acting.jobPerf', { id: sid }))
      if (!job.success) throw new Error(job.err || t('views.acting.shotFailed', { id: sid }))
    }
    toast(t('views.acting.generated'), 'ok')
    await refreshCandidates()
  } catch (e) { toast(e instanceof Error ? e.message : t('views.acting.runFailed'), 'err') }
  finally { running.value = false; runningShot.value = '' }
}
function canGenerate(s: ActingShot) {
  return !!app.current && !!board.value && !!vendorId.value && !s.performance_locked && !!s.actor_ids?.length
}
async function runOne(s: ActingShot) {
  if (!canGenerate(s) || running.value) return
  if (!confirmDiscardEdits()) return
  running.value = true
  runningShot.value = s.id
  try {
    if (data.value) await saveContext(false)
    const result = await runActing({ project: app.current!, storyboard: board.value, shot_id: s.id, vendor_id: vendorId.value, mode: mode.value })
    if (!result.id) throw new Error(result.err || t('views.acting.jobNotStarted'))
    const job = await trackJob(result.id, t('views.acting.jobPerf', { id: s.id }))
    if (!job.success) throw new Error(job.err || t('views.acting.shotFailed', { id: s.id }))
    toast(t('views.acting.oneGenerated', { id: s.id }), 'ok', 5000)
    await refreshCandidates()
    await load()
  } catch (e) { toast(e instanceof Error ? e.message : t('views.acting.runFailed'), 'err') }
  finally { running.value = false; runningShot.value = '' }
}
async function startEvaluation() {
  const shotIds = Array.from(selected.value).filter((id) => selectableShots.value.some((shot) => shot.id === id))
  if (!app.current || !board.value || !shotIds.length) {
    toast(t('views.acting.pickShot'), 'err'); return
  }
  evaluating.value = true
  try {
    const result = await evaluateActing({
      project: app.current, storyboard: board.value,
      shot_ids: shotIds, modes: ['baseline', 'style', 'stateful'], repeats: 2,
      vendor_id: vendorId.value || undefined
    })
    if (!result.id) throw new Error(result.err || t('views.acting.evalNotStarted'))
    const j = await trackJob(result.id, t('views.acting.evaluate'))
    if (j.success) { toast(t('views.acting.evalDone'), 'ok'); await loadEvals() }
    else toast(j.err || t('views.acting.evalFailedDrawer'), 'err')
  } catch (e) { toast(e instanceof Error ? e.message : t('views.acting.evalFailed'), 'err') }
  finally { evaluating.value = false }
}async function refreshCandidates() {
  const project = app.current, name = board.value, request = requestSeq
  if (!project || !name) return
  try {
    const result = await fetchActingCandidates(project, name)
    if (request === requestSeq && project === app.current && name === board.value) candidates.value = result.candidates || []
  } catch (e) { if (request === requestSeq) toast(e instanceof Error ? e.message : t('views.acting.candidatesLoadFailed'), 'err') }
}

async function compile(s: ActingShot) {
  if (!app.current || !board.value) return
  try {
    const r = await compileActingPrompt({ project: app.current, storyboard: board.value, shot_id: s.id, mode: mode.value, media_type: 'video' })
    preview.value = { shot_id: s.id, prompt: r.prompt, performance_used: r.performance_used, asset_refs: r.asset_refs || [], prompt_json: r.prompt_json || null }
  } catch (e) { toast(e instanceof Error ? e.message : t('views.acting.compileFailed'), 'err') }
}
async function lockShot(s: ActingShot) {
  if (!app.current || !board.value || !data.value) return
  if (!confirmDiscardEdits()) return
  try {
    const r = await setActingLock({ project: app.current, storyboard: board.value, shot_ids: [s.id], locked: !s.performance_locked, revision: revision.value })
    revision.value = r.revision
    toast(r.locked ? t('views.acting.lockedShot', { id: s.id }) : t('views.acting.unlockedShot', { id: s.id }), 'ok')
    await load()
  } catch (e) {
    toast(e instanceof Error ? e.message : t('views.acting.lockFailed'), 'err')
    await load()
  }
}async function apply(c: ActingCandidate) {
  if (!app.current || !board.value || !['performance', 'context'].includes(c.candidate_kind)) return
  if (!confirmDiscardEdits()) return
  applying.value = c.run_id
  try {
    const r = await applyActingCandidate({ project: app.current, storyboard: board.value, run_id: c.run_id, revision: revision.value })
    revision.value = r.revision
    toast(r.changed_shots.length ? t('views.acting.applied', { ids: r.changed_shots.join(t('common.listSep')) }) : t('views.acting.candidateDone'), 'ok')
    await load()
  } catch (e) {
    toast(e instanceof Error ? e.message : t('views.acting.applyFailed'), 'err')
    await load()
  } finally { applying.value = '' }
}

watch(() => [app.current, app.projects, boards.value.join('|')], () => {

  requestSeq++
  void loadVendors()
  if (board.value) void load()
  else data.value = null
}, { immediate: true })
watch(board, () => { requestSeq++; void load() })
useBoardSelection(board, boards, 'acting')
</script>

<template>
  <div class="page">
    <header class="mb-6">
      <h1 class="grad-text text-2xl font-black">{{ $t('views.acting.title') }}</h1>
      <p class="mt-1 text-xs text-slate-500">{{ $t('views.acting.intro') }}</p>
    </header>
    <EmptyState v-if="!app.current" :title="$t('common.pickProjectFirst')" />
    <template v-else>
      <div class="glass mb-4 flex flex-wrap items-end gap-3 p-4">
        <label class="text-xs text-slate-400">{{ $t('views.acting.board') }}
          <StyledSelect v-model="board" class="mt-1 min-w-56" :options="boards" :storage-key="`wb.${app.current}.acting.board`" :placeholder="$t('views.acting.pickBoardPh')" />
        </label>
        <StyleSelect target="acting" :label="$t('views.acting.styleLabel')" />
        <label class="text-xs text-slate-400">{{ $t('views.acting.vendor') }}
          <StyledSelect v-model="vendorId" class="mt-1 min-w-56" :options="vendorOptions" :labels="vendorLabels" :storage-key="`wb.${app.current}.acting.vendor`" :placeholder="$t('views.acting.pickPh')" />
        </label>
        <button class="btn" :disabled="saving || loading || !data" @click="() => saveContext()">{{ saving ? $t('common.saving') : $t('views.acting.saveContext') }}</button>
        <button class="btn btn-ghost" :disabled="!data || loading || preparing || !board" @click="prepare">{{ $t('views.acting.read') }}</button>
        <button class="btn btn-ghost" :disabled="running || !selected.size || !vendorId" @click="runSelected" :title="$t('views.acting.runTitle')">{{ running ? $t('common.generating') : $t('views.acting.run') }}</button>
        <button class="btn btn-ghost" :disabled="evaluating || !selected.size || !vendorId" @click="startEvaluation" :title="$t('views.acting.evalTitle')">{{ evaluating ? $t('views.acting.evaluating') : $t('views.acting.evaluate') }}</button>
      </div>

      <div v-if="latestEval" class="glass mb-4 p-4">
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <h2 class="text-sm font-bold text-slate-200">{{ $t('views.acting.evalHeading', { id: latestEval.experiment_id }) }}</h2>
          <span class="text-2xs text-slate-500">{{ $t('views.acting.evalLegend') }}</span>
        </div>
        <div v-if="latestEval.summary?.wins" class="mb-2 text-xs-plus text-slate-300">
          {{ $t('views.acting.wins') }}<b class="text-emerald-300">{{ (['A','B','C'] as const).map((k) => $t('views.acting.winItem', { k, n: latestEval.summary?.wins?.[k] || 0 })).join(' · ') }}</b>
          <span v-if="latestEval.summary?.avg_total" class="ml-3 text-slate-500">{{ $t('views.acting.avg') }} {{ (['A','B','C'] as const).map((k) => k + ' ' + (latestEval.summary?.avg_total?.[k] ?? '—')).join(' / ') }}</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs-plus">
            <thead class="text-slate-500">
              <tr><th class="py-1 pr-3">{{ $t('views.acting.colShot') }}</th><th class="py-1 pr-3">{{ $t('views.acting.colA') }}</th><th class="py-1 pr-3">{{ $t('views.acting.colB') }}</th><th class="py-1 pr-3">{{ $t('views.acting.colC') }}</th><th class="py-1 pr-3">{{ $t('views.acting.colBest') }}</th><th class="py-1">{{ $t('views.acting.colReason') }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="[sid, sc] in Object.entries(latestEval.scores)" :key="sid" class="border-t border-line-soft">
                <td class="py-1.5 pr-3 font-bold text-cyan-300">{{ sid }}</td>
                <td v-for="k in (['A','B','C'] as const)" :key="k" class="py-1.5 pr-3" :class="sc.best === k ? 'font-bold text-emerald-300' : 'text-slate-300'" :title="sc[k]?.reason || ''">
                  {{ total30(sc[k] || {}) }}<span v-if="sc[k]?.dims" class="ml-1 text-2xs text-slate-500">{{ sc[k]?.dims?.specificity }}/{{ sc[k]?.dims?.consistency }}/{{ sc[k]?.dims?.discipline }}</span>
                </td>
                <td class="py-1.5 pr-3">{{ sc.best || '—' }}</td>
                <td class="py-1.5 text-slate-400" :title="sc.reason">{{ sc.reason || '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="!Object.keys(latestEval.scores || {}).length" class="py-2 text-center text-xs-plus text-slate-500">{{ $t('views.acting.noScores') }}</div>
      </div>

      <div v-if="loading" class="glass p-10 text-center text-sm text-slate-500">{{ $t('views.acting.loading') }}</div>
      <div v-else-if="!data" class="glass p-10 text-center text-sm text-slate-500">{{ $t('views.acting.noBoards') }}</div>
      <div v-else class="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.8fr)]">
        <section class="space-y-4">
          <div class="glass p-4">
            <div class="mb-3 flex items-center gap-2">
              <h2 class="text-sm font-bold text-slate-200">{{ $t('views.acting.cardsTitle') }}</h2>
              <span class="text-2xs text-slate-500">{{ $t('views.acting.cardsNote') }}</span>
            </div>
            <p class="mb-3 text-xs-plus leading-5 text-slate-500">{{ $t('views.acting.cardsIntro') }}</p>
            <textarea v-model="memoryText" class="textarea mb-3 min-h-20" :placeholder="$t('views.acting.memoryPh')"></textarea>
            <div class="grid gap-3 md:grid-cols-2">
              <article v-for="[id, actor] in actorEntries" :key="id" class="rounded-xl border border-line bg-black/20 p-3">
                <div class="mb-2 flex items-center gap-2">
                  <b class="text-sm text-slate-100">{{ actor.name || id }}</b>
                  <span class="rounded bg-white/5 px-1.5 py-0.5 text-2xs text-slate-500">{{ id }}</span>
                </div>
                <div class="space-y-2">
                  <label v-for="item in [{k:'personality',n:$t('views.acting.f.personality')}, {k:'goal',n:$t('views.acting.f.goal')}, {k:'relationship',n:$t('views.acting.f.relationship')}, {k:'expression_rules',n:$t('views.acting.f.expression_rules')}, {k:'arc_stage',n:$t('views.acting.f.arc_stage')}]" :key="item.k" class="block text-2xs text-slate-500">
                    {{ item.n }}<input class="input mt-0.5 text-xs" :value="field(id, item.k)" @input="setField(id, item.k, ($event.target as HTMLInputElement).value)" />
                  </label>
                  <label class="block text-2xs text-slate-500">
                    {{ $t('views.acting.f.source') }}<input class="input mt-0.5 text-xs" :value="field(id, 'source')" @input="setField(id, 'source', ($event.target as HTMLInputElement).value)" :placeholder="$t('views.acting.sourcePh')" />
                  </label>
                  <label class="block text-2xs text-slate-500">
                    {{ $t('views.acting.f.locked_fields') }}<input class="input mt-0.5 text-xs" :value="field(id, 'locked_fields')" @input="setField(id, 'locked_fields', ($event.target as HTMLInputElement).value)" placeholder="personality,goal" />
                  </label>
                </div>
              </article>
            </div>
            <div v-if="!actorEntries.length" class="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs-plus leading-relaxed text-amber-200/80">
              {{ $t('views.acting.noLeads') }}
            </div>
          </div>

          <div class="glass p-4">
            <div class="mb-3 flex items-center gap-2">
              <h2 class="text-sm font-bold text-slate-200">{{ $t('views.acting.shotsTitle') }}</h2>
              <label class="ml-auto flex cursor-pointer items-center gap-1.5 text-2xs text-slate-400">
                <input type="checkbox" :checked="allSelected" :indeterminate="someSelected" @change="toggleAll" />{{ allSelected ? $t('views.acting.selectNone') : $t('views.acting.selectAll') }}
              </label>
            </div>
            <div class="space-y-2">
              <article v-for="s in shots" :key="s.id" class="rounded-xl border border-line bg-black/20 p-3">
                <div class="flex items-start gap-2">
                  <input class="mt-1" type="checkbox" :checked="selected.has(s.id)" :disabled="s.performance_locked || !s.actor_ids?.length" @change="toggle(s.id)" />
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <b class="text-xs text-cyan-300">{{ s.id }}</b>
                      <span class="text-2xs text-slate-500">{{ s.dur }}s</span>
                      <span class="rounded px-1.5 py-0.5 text-2xs" :class="statusClass(s.performance_status)">{{ statusLabel(s.performance_status) }}</span>
                      <span v-if="s.performance_check_error" class="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500"
                        :title="$t('views.acting.staleProbe', { err: s.performance_check_error })"></span>
                      <span class="flex-1"></span>
                      <button class="btn btn-sm" :disabled="running || !canGenerate(s)" @click="runOne(s)" :title="s.actor_ids?.length ? $t('views.acting.runOneTitle') : $t('views.acting.noLeadTitle')">
                        {{ runningShot === s.id ? $t('common.generating') : (s.performance_status === 'pending' ? $t('views.acting.genNew') : $t('views.acting.regen')) }}
                      </button>
                      <button class="btn btn-ghost btn-sm" @click="compile(s)">{{ mode === 'stateful' ? $t('views.acting.compileStateful') : $t('views.acting.compileStyle') }}</button>
                      <button class="btn btn-ghost btn-sm" @click="lockShot(s)">{{ s.performance_locked ? $t('views.acting.unlock') : $t('views.acting.lock') }}</button>
                    </div>
                    <div class="mt-1 flex flex-wrap items-center gap-1.5 text-2xs">
                      <span v-if="s.actor_names?.length" class="rounded bg-cyan-400/10 px-1.5 py-0.5 text-cyan-200">{{ $t('views.acting.leads', { names: s.actor_names.join($t('common.listSep')) }) }}</span>
                      <span v-else class="rounded bg-slate-400/10 px-1.5 py-0.5 text-slate-500">{{ $t('views.acting.noLeadActor') }}</span>
                    </div>
                    <p class="mt-1 text-xs-plus leading-relaxed text-slate-400">{{ s.action || s.prompt || '—' }}</p>
                    <p v-if="performanceSummary(s)" class="mt-1 rounded bg-emerald-400/5 px-2 py-1 text-2xs leading-relaxed text-emerald-200/80">{{ $t('views.acting.perf', { text: performanceSummary(s) }) }}</p>
                  </div>
                </div>
              </article>
            </div>
            <div v-if="preview" class="mt-3 rounded-lg border border-cyan-400/20 bg-cyan-500/5 p-3">
              <div class="mb-1 text-2xs text-cyan-300">{{ $t('views.acting.previewHead', { id: preview.shot_id, kind: preview.performance_used ? $t('views.acting.perfUsed') : $t('views.acting.basicBoard') }) }}</div>
               <div v-if="preview.asset_refs?.length" class="mb-2 flex flex-wrap gap-1">
                 <span v-for="ref in preview.asset_refs" :key="ref" class="rounded border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-2xs text-cyan-200">{{ ref }}</span>
               </div>
              <pre class="max-h-52 overflow-auto whitespace-pre-wrap text-xs-plus leading-relaxed text-slate-300">{{ preview.prompt }}</pre>
            </div>
          </div>
        </section>

        <aside class="glass p-4">
          <div class="mb-3 flex items-center gap-2">
            <h2 class="text-sm font-bold text-slate-200">{{ $t('views.acting.candidates') }}</h2>
            <span class="flex-1"></span>
            <button class="btn btn-ghost btn-sm" @click="refreshCandidates">{{ $t('common.refresh') }}</button>
          </div>
          <div class="mb-3 flex gap-1.5">
            <button v-for="m in [{k:'style',n:$t('views.acting.mode.style')}, {k:'stateful',n:$t('views.acting.mode.stateful')}]" :key="m.k" class="flex-1 rounded-lg border px-2 py-1.5 text-2xs" :class="mode === m.k ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-200' : 'border-line text-slate-500'" @click="mode = m.k as typeof mode">{{ m.n }}</button>
          </div>
          <div v-if="!candidates.length" class="py-10 text-center text-sm text-slate-500">{{ $t('views.acting.noCandidates') }}</div>
          <div v-for="c in candidates" :key="c.run_id" class="mb-2 rounded-lg border border-line bg-black/20 p-2.5">
            <div class="flex items-center gap-2">
              <b class="text-2xs text-slate-300">{{ c.candidate_kind === 'performance' ? $t('views.acting.kindPerf') : $t('views.acting.kindContext') }}</b>
              <span class="text-2xs text-slate-500">{{ c.status }}</span>
              <span class="flex-1"></span>
              <button class="btn btn-sm" :disabled="applying === c.run_id" @click="apply(c)">{{ applying === c.run_id ? $t('views.acting.applying') : $t('views.acting.apply') }}</button>
            </div>
            <div class="mt-1 text-2xs text-slate-500">{{ (c.shot_ids || []).join('、') }} · {{ c.created_at || '' }}</div>
          </div>
        </aside>
      </div>
    </template>
  </div>
</template>







