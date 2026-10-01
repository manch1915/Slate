<script setup lang="ts">
import { t, vocab } from '../i18n'
import { useBoardSelection } from '../utils/useBoardSelection'
// -*- coding: utf-8 -*-
/** ② 分镜生成：按集生成分镜（知识注入）→ 逐镜明细；生成拍摄资料包 → 包明细 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  fetchScriptData, fetchWhiteBoard, fetchCreate, scriptStoryboard,
  previewKnowledge, saveStoryboardShots, exportStoryboardXlsx, deleteStoryboard, compileActingPrompt, runActing, fetchEnvConfig,
  rebuildProductionPrompts, rebuildProductionEpisode, fetchStoryboardRevision,
  mediaUrl, type ScriptBundle, type WhiteBoard, type KnowledgeSkill, type CreateItem
} from '../api'
import { isRevisionConflict, overwriteAllowed } from '../utils/boardRevision'
import { sceneLabel, speakerName } from '../utils/assetNames'
import { app, projectFiles, toast, currentProject } from '../stores/app'
import { trackJob } from '../stores/jobs'
import StyledSelect from '../components/StyledSelect.vue'
import StyleSelect from '../components/StyleSelect.vue'
import Versions from '../components/Versions.vue'
import EmptyState from '../components/EmptyState.vue'
import { icons } from '../components/icons'

interface Shot {
  id: string; dur: number; cam?: string; fov?: number; pos?: number[]; look?: number[]
  shot_size?: string; camera_move?: string; angle?: string; transition?: string
  scene?: string; speaker?: string; action?: string; prompt?: string; move?: string
  content?: string; sound?: string; lighting?: string; rig?: string; lens?: string
  lines?: { at: number; dur?: number; speaker: string; line: string }[]
  scene_ref?: string; actor_refs?: string[]; prop_refs?: string[]; asset_refs?: string[]
  prompt_image?: string; prompt_video?: string; prompt_grid?: string; prompt_revisions?: Record<string, string>
  asset_revisions?: Record<string, number>; prompt_version?: string
}
const data = ref<ScriptBundle | null>(null)
const episodes = computed(() => data.value?.episodes || [])
const episodeReady = (episode: { text?: string }) => Boolean(String(episode.text || '').trim())
const readyEpisodes = computed(() => episodes.value.filter(episodeReady))
const readyEpisodeIds = computed(() => readyEpisodes.value.map((episode) => episode.id))
const allReadySelected = computed(() => readyEpisodeIds.value.length > 0
  && readyEpisodeIds.value.every((id) => epsSel.value.includes(id)))
const epsSel = ref<string[]>([])
function toggleEp(id: string) {
  epsTouched.value = true
  const i = epsSel.value.indexOf(id)
  if (i >= 0) epsSel.value.splice(i, 1)
  else epsSel.value.push(id)
}
function toggleAllEpisodes() {
  epsTouched.value = true
  epsSel.value = allReadySelected.value ? [] : [...readyEpisodeIds.value]
}
const router = useRouter()
const busy = ref('')
const boards = ref<string[]>([])
const board = ref('')
const boardRev = ref<number | null>(null)
/** 剧本修订号（①剧本分集每次变更 +1）；分镜低于它说明是旧剧本生成的。 */
const scriptRev = computed(() => Number(data.value?.script_rev || 0))
const boardStale = computed(() => boardRev.value !== null && scriptRev.value > boardRev.value)
/** 分镜文件自身的 revision：③ 是整组回写，回写必须带它，否则会把 ⑦/⑤ 期间的改动静默盖掉。
 *  与上面的 boardRev（= 剧本 script_rev）不是一回事，别混用。 */
const boardFileRev = ref('')
/** 分镜自带的名字表（板内 actors）：台词列显示名字时优先用它，与 xlsx 导出同源。 */
const boardActors = ref<Record<string, { name?: string }>>({})
/** 非空 = 上一次保存被服务端判为过期基线拒掉；表格内容仍留在页面上，等用户决策。 */
const boardConflict = ref('')
const overwriteConfirmed = ref(false)
let boardLoadSeq = 0
const shots = ref<Shot[]>([])
const shotOutputs = ref<Record<string, { status: CreateItem['status']; count: number; image?: string }>>({})
const detail = ref<Shot | null>(null)
const actingPrompt = ref('')
const actingCompiling = ref(false)
const vendors = ref<{ id: string; label?: string; enabled: boolean; models?: Record<string, string> }[]>([])
const actingVendor = computed(() => vendors.value.find((v) => v.enabled && v.models?.text) || null)
const chars = computed(() => data.value?.characters?.characters || [])
const scenesMap = computed<Record<string, string>>(() => {
  const rows = (data.value as any)?.scenes?.scenes || []
  return Object.fromEntries(rows.map((r: any) => [r.id || r.name || '', r.name || r.id || '']).filter(([k]: any) => k))
})
const scenesAssets = computed(() => (data.value as any)?.scenes?.scenes || [])
/** 场景列：scene_ref 场景名优先；room/field 是对话契约的预设地形（军帐室内/野外战场），翻译成中文展示 */
function sceneCell(s: Shot): { label: string; cls: string; title: string } {
  const label = sceneLabel(s, scenesMap.value, { field: t('views.shots.sceneField'), room: t('views.shots.sceneRoom') })   // 取值规则与 xlsx 的 scene_cell() 同源
  const ref = String(s.scene_ref || '').replace(/^@scene:/, '')
  if (ref) return { label, cls: 'bg-violet-400/15 text-violet-300', title: t('views.shots.sceneAsset', { ref }) }
  if (s.scene === 'field') return { label, cls: 'bg-amber-400/15 text-amber-300', title: t('views.shots.fieldTitle') }
  if (s.scene === 'room') return { label, cls: 'bg-white/10 text-slate-400', title: t('views.shots.roomTitle') }
  return { label: '—', cls: 'bg-white/5 text-slate-500', title: t('views.shots.noSceneSet') }
}

async function load() {
  if (!app.current) return
  try { data.value = await fetchScriptData(app.current) } catch { data.value = null }
  try { vendors.value = (await fetchEnvConfig()).vendors || [] } catch { vendors.value = [] }
  boards.value = (projectFiles('分镜') || []).filter((f) => f.endsWith('.json') && f.startsWith('剧本_') && !f.includes('/') && !f.startsWith('.'))

  if (board.value) void loadBoard()
}
async function loadBoard() {
  const seq = ++boardLoadSeq
  const project = app.current
  const name = board.value
  shots.value = []
  shotOutputs.value = {}
  boardRev.value = null
  boardFileRev.value = ''
  boardActors.value = {}
  boardConflict.value = ''
  overwriteConfirmed.value = false
  detail.value = null
  if (!project || !name) return
  try {
    const b: WhiteBoard = await fetchWhiteBoard(project, name)
    if (seq !== boardLoadSeq) return
    boardActors.value = (b.actors || {}) as Record<string, { name?: string }>
    shots.value = ((b.shots || []) as unknown as Shot[]).map(s => ({...s, prompt_image: s.prompt_image || s.prompt || '', dur: Number(s.dur) > 0 ? Number(s.dur) : 4}))
    boardRev.value = typeof b.script_rev === 'number' ? b.script_rev : null
  } catch {
    if (seq === boardLoadSeq) shots.value = []
  }
  // 乐观锁基线单独取：/api/white/board 是白模页共用的「原文件直出」，不能往里塞元信息；
  // 取不到基线时宁可让保存被 400 挡下，也不能退化成无锁整组覆盖。
  try {
    const r = await fetchStoryboardRevision(project, name)
    if (seq === boardLoadSeq) boardFileRev.value = r.revision || ''
  } catch {
    if (seq === boardLoadSeq) boardFileRev.value = ''
  }
  try {
    const created = await fetchCreate(project)
    if (seq !== boardLoadSeq) return
    const grouped: Record<string, CreateItem[]> = {}
    for (const item of created.items || []) {
      if (item.board !== name || !item.shot_id) continue
      ;(grouped[item.shot_id] ||= []).push(item)
    }
    const summary: typeof shotOutputs.value = {}
    for (const [shotId, items] of Object.entries(grouped)) {
      const latest = items[items.length - 1]
      const image = [...items].reverse().flatMap((item) =>
        item.type === 'image' ? (item.outputs || []).map((out) => outputPath(item, out)) : []
      )[0]
      summary[shotId] = { status: latest.status, count: items.length, image }
    }
    shotOutputs.value = summary
  } catch {
    if (seq === boardLoadSeq) shotOutputs.value = {}
  }
}

function outputPath(item: CreateItem, output: string): string {
  const p = String(output || '').replace(/\\/g, '/')
  if (p.startsWith('projects/')) return p
  if (p.startsWith('创作/')) return `projects/${app.current}/${p}`
  return `projects/${app.current}/创作/${item.id}/${p}`
}

function shotOutput(s: Shot) {
  return shotOutputs.value[s.id]
}

function outputStatusLabel(status?: CreateItem['status']): string {
  if (status === 'done') return t('views.shots.out.done')
  if (status === 'error') return t('views.shots.out.error')
  if (status) return t('views.shots.out.running')
  return t('views.shots.out.none')
}
watch([() => app.current, () => currentProject.value?.name], load, { immediate: true })
watch(board, loadBoard)

/** 一键多选：每个选中集各起一个任务（并行跑，互不等待）；未选=全本单任务 */
const sbRunning = ref<string[]>([])
const kbHits = ref<KnowledgeSkill[]>([])
const viewTab = ref<'grid' | 'cards'>('grid')
/** 汇总表格全屏：默认随页面流展示全部行；全屏=fixed overlay 一眼看全（Esc 或按钮退出） */
const gridFullscreen = ref(false)
function onGridKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && gridFullscreen.value) gridFullscreen.value = false
}
onMounted(() => window.addEventListener('keydown', onGridKey))
onUnmounted(() => window.removeEventListener('keydown', onGridKey))
watch(viewTab, (tab) => {
  gridFullscreen.value = false
  if (tab === 'cards' && shots.value.length && !detail.value) detail.value = shots.value[0]
})
const gridDirty = ref(false)
const savingGrid = ref(false)
// 编辑计数：用于识别「保存请求在途期间用户又改了格子」——那时不得用服务端回读覆盖在途编辑
let gridEdits = 0
// 切分镜表必须复位脏标记：否则仍显示「有未保存修改」，点保存会把新表整组回写并生成多余 .versions 快照
watch(board, () => { gridDirty.value = false; gridEdits++; boardConflict.value = ''; overwriteConfirmed.value = false })

/** 汇总表格：行内编辑 内容/动作/声音/光影/三提示词（时长/器械/镜头只读，调整在⑦创作生成），整组回写（版本快照保护） */
function markDirty() { gridEdits++; gridDirty.value = true }
async function saveGrid() {
  if (!app.current || !board.value || !shots.value.length) return
  // 拿不到基线就不发写请求：整组回写一旦失去基线就退化成"最后写入者赢"，正是这次要堵的洞
  if (!boardFileRev.value) {
    boardConflict.value = t('views.shots.noBaseline')
    return
  }
  savingGrid.value = true
  const editsAtSave = gridEdits
  try {
    const r = await saveStoryboardShots(app.current, board.value, shots.value, boardFileRev.value)
    if (r.revision) boardFileRev.value = r.revision
    boardConflict.value = ''
    overwriteConfirmed.value = false
    toast(t('views.shots.savedShots', { n: r.shots }), 'ok')
    if (r.unit_warnings?.length) {
      // ① 锚定的创作禁区命中：只提醒不拦保存（分镜是给人改的工作件，拦了等于抽奖）
      const first = r.unit_warnings[0]
      toast(t('views.shots.tabooWarn', { n: r.unit_warnings.length, shot: first.shot_id, taboo: first.taboo_id, rule: first.rule }), 'info', 8000)
    }
    if (editsAtSave === gridEdits) { gridDirty.value = false; loadBoard() }
    else { gridDirty.value = true; toast(t('views.shots.editedDuringSave'), 'info') }
  } catch (e) {
    if (isRevisionConflict(e)) { boardConflict.value = t('views.shots.conflictNotice'); toast(t('views.shots.changedElsewhere'), 'err') }
    else toast(e instanceof Error ? e.message : t('common.saveFailed'), 'err')
  }
  finally { savingGrid.value = false }
}
/** 冲突后先看再决定：重载会丢页面未保存的编辑，所以只在用户显式点击时做。 */
async function reloadLatest() {
  boardConflict.value = ''
  overwriteConfirmed.value = false
  await loadBoard()
  toast(t('views.shots.reloaded'), 'info')
}
/** 「仍用我的版本覆盖」= 重取基线后立刻把页面这份整组写回（旧版仍进 .versions，可回滚）。 */
async function overwriteLatest() {
  if (!app.current || !board.value) return
  try {
    const r = await fetchStoryboardRevision(app.current, board.value)
    if (!overwriteAllowed(overwriteConfirmed.value, r.revision || '')) {
      toast(t('views.shots.tickFirst'), 'err'); return
    }
    boardFileRev.value = r.revision
    await saveGrid()
  } catch (e) { toast(e instanceof Error ? e.message : t('views.shots.baselineFailed'), 'err') }
}
async function doXlsx() {
  if (!app.current || !board.value) return
  try {
    const r = await exportStoryboardXlsx(app.current, board.value) as any
    if (r?.job && r.id) { const j = await trackJob(r.id, t('views.shots.job.xlsx')); if (!j.success) throw new Error(j.err || t('views.shots.exportFailed')) }
    r.file = r.file || `分镜/${board.value.replace(/\.json$/, '')}_分镜脚本.xlsx`
    const a = document.createElement('a')
    a.href = `/media?p=${encodeURIComponent(r.file)}`
    a.download = r.file.split('/').pop() || '分镜脚本.xlsx'
    a.click()
  } catch (e) { toast(e instanceof Error ? e.message : t('views.shots.exportFailed'), 'err') }
}
function linesOf(s: Shot): string {
  // 与 Excel 导出同口径：台词显示**名字**不是 id（板内 actors 优先，其次 ② 人物档案）
  return (s.lines || []).map((l) => `【${spk(l.speaker)}】${l.line}`).join(' / ')
}
/** 删除当前分镜（同名单镜 xlsx 一并删除；.versions 历史快照保留可恢复） */
async function removeBoard() {
  if (!app.current || !board.value) return
  if (!window.confirm(t('views.shots.confirmDelete', { name: board.value }))) return
  try {
    const r = await deleteStoryboard(app.current, board.value)
    if (!r.ok) throw new Error(r.err || t('common.deleteFailed'))
    toast(t('views.shots.deleted', { list: (r.deleted || []).join(t('common.listSep')) || board.value }), 'ok')
    board.value = ''
    await load()
  } catch (e) { toast(e instanceof Error ? e.message : t('common.deleteFailed'), 'err') }
}
/** 摄像机位（视角）可读描述：高度差+角度词+水平距离 */
function viewOf(s: Shot): string {
  const ang = s.angle || '平视'
  if (ang === '鸟瞰') return t('views.shots.view.top')
  let h = ''
  const pos = s.pos || [], look = s.look || []
  if (pos.length === 3 && look.length === 3) {
    const d = look[1] - pos[1]
    if (d > 0.8) h = t('views.shots.view.low')
    else if (d < -1.2) h = t('views.shots.view.high')
    else h = t('views.shots.view.eye')
  }
  const dist = pos.length === 3 && look.length === 3
    ? Math.hypot(look[0] - pos[0], look[2] - pos[2]).toFixed(1) : '?'
  return `${h || vocab('angle', ang)}·${dist}m`
}
const LENS_BY_SIZE: Record<string, string> = {
  '大特写': '100mm', '特写': '85mm', '近景': '85mm', '中近景': '50mm',
  '中景': '50mm', '全景': '35mm', '大全景': '24mm', '远景': '24mm', '大远景': '18mm'
}
const RIG_BY_MOVE: Record<string, string> = {
  '固定': '固定', '手持': '手持', '甩': '手持', '移': '滑轨', '轨道': '轨道',
  '环绕': '滑轨', '升降': '无人机', '无人机': '无人机', '推': '滑轨', '拉': '滑轨',
  '变焦': '固定', '跟': '稳定器', '斯坦尼康': '斯坦尼康'
}
/** 一键补默认：只为空白格填推断值（镜头焦距←景别、器械←运镜），不覆盖已填 */
function fillDefaults() {
  for (const s of shots.value) {
    if (!s.lens) s.lens = LENS_BY_SIZE[s.shot_size || ''] || '50mm'
    if (!s.rig) s.rig = RIG_BY_MOVE[s.camera_move || ''] || (s.camera_move ? '固定' : '')
  }
  markDirty()
  toast(t('views.shots.defaultsFilled'), 'info')
}

/** 垫上下文预览：按选中集的梗概+原文查将注入的知识卡片 */
async function loadPreview() {
  if (!episodes.value.length) { kbHits.value = []; return }
  const sel = epsSel.value.length ? episodes.value.filter((e) => epsSel.value.includes(e.id)) : episodes.value
  const text = sel.map((e) => `${e.summary || ''}${e.hook || ''}${e.text || ''}`).join(' ').slice(0, 800)
  if (!text.trim()) { kbHits.value = []; return }
  try { kbHits.value = (await previewKnowledge(text)).hits || [] } catch { kbHits.value = [] }
}
watch(epsSel, loadPreview)
watch(episodes, loadPreview, { immediate: true })
const epsTouched = ref(false)   // 用户手动改过选择后不再自动全选
watch(readyEpisodeIds, (ids) => {
  if (!epsTouched.value) { epsSel.value = [...ids]; return }   // 默认全选可生成集
  const valid = new Set(ids)
  const next = epsSel.value.filter((id) => valid.has(id))
  if (next.length !== epsSel.value.length) epsSel.value = next
}, { immediate: true })
async function doSb() {
  if (!app.current || busy.value) return
  const readyIds = new Set(readyEpisodeIds.value)
  const skipped = epsSel.value.filter((id) => !readyIds.has(id))
  const selected = epsSel.value.length ? epsSel.value.filter((id) => readyIds.has(id)) : []
  if (skipped.length) {
    epsSel.value = selected
    toast(t('views.shots.skipped', { list: skipped.join(t('common.listSep')) }), 'info', 5000)
  }
  const targets = selected.length ? selected : ['']
  sbRunning.value = targets.map((e) => e || t('views.shots.wholeScript'))
  const results = await Promise.allSettled(
    targets.map(async (ep) => {
      const r = await scriptStoryboard(app.current!, ep || undefined)
      if (!r.id) throw new Error(r.err || t('views.shots.jobNotStarted'))
      return trackJob(r.id, t('views.shots.job.board', { ep: ep || t('views.shots.wholeScript') }))
    })
  )
  const ok = results.filter((r) => r.status === 'fulfilled' && (r.value as { success?: boolean }).success).length
  const fail = results.length - ok
  const failures = results.flatMap((result) => {
    if (result.status === 'rejected') {
      return [result.reason instanceof Error ? result.reason.message : String(result.reason)]
    }
    const value = result.value as { success?: boolean; err?: string }
    return value.success ? [] : [value.err || t('views.shots.jobFailed')]
  })
  if (fail === 0) toast(t('views.shots.sbDone', { n: ok }), 'ok', 5000)
  else toast(t('views.shots.sbPartial', { ok, failed: fail, list: failures.slice(0, 2).join(t('common.semiSep')) }), 'err', 7000)
  sbRunning.value = []
  load()
}
/** 说话人显示名：板内 actors（分镜自带的名字表）优先，其次 ② 提炼的人物档案，最后才退回 id。
 *  与 `export_storyboard_xlsx.speaker_name` 同一条链（共用 utils/assetNames）。 */
function spk(id?: string) {
  return speakerName(id, boardActors.value, chars.value)
}

function goPackage() { router.push('/package') }

function boardEpisode(name: string): string {
  const match = String(name || '').match(/^剧本_(.+)\.json$/)
  const value = match?.[1] || ''
  return value && value !== '全本' ? value : ''
}
async function doRebuildPrompts() {
  if (!app.current || !board.value || busy.value) return
  busy.value = 'prompts'
  try {
    const r = await rebuildProductionPrompts({ project: app.current, episode: boardEpisode(board.value) || undefined })
    toast(t('views.shots.promptsUpdated', { n: r.updated_prompts || 0 }), 'ok', 5000)
    await loadBoard()
  } catch (e) { toast(e instanceof Error ? e.message : t('views.shots.rebuildFailed'), 'err', 6000) }
  finally { busy.value = '' }
}
async function doRebuildEpisode() {
  if (!app.current || !board.value || busy.value) return
  const episode = boardEpisode(board.value)
  if (!episode) { toast(t('views.shots.wholeNoEpisode'), 'info', 4500); return }
  busy.value = 'episode'
  try {
    const r = await rebuildProductionEpisode({ project: app.current, episode })
    toast(t('views.shots.episodeRebuilt', { ep: episode, n: r.updated_prompts || 0 }), 'ok', 5000)
    await loadBoard()
  } catch (e) { toast(e instanceof Error ? e.message : t('views.shots.episodeRebuildFailed'), 'err', 6000) }
  finally { busy.value = '' }
}
async function doActingPrompt(s: Shot) {
  if (!app.current || !board.value) return
  actingCompiling.value = true
  try {
    const r = await compileActingPrompt({ project: app.current, storyboard: board.value, shot_id: s.id, mode: 'stateful' })
    actingPrompt.value = r.prompt || ''
    toast(t('views.shots.actingCompiled'), 'ok', 3500)
  } catch (e) { toast(e instanceof Error ? e.message : t('views.shots.actingCompileFailed'), 'err') }
  finally { actingCompiling.value = false }
}
async function doRunActing(s: Shot) {
  if (!app.current || !board.value || !actingVendor.value) {
    toast(t('views.shots.needTextVendor'), 'err', 4500); return
  }
  busy.value = `acting:${s.id}`
  try {
    const r = await runActing({ project: app.current, storyboard: board.value, shot_id: s.id, vendor_id: actingVendor.value.id })
    if (!r.id) throw new Error(r.err || t('views.shots.actingNotStarted'))
    const j = await trackJob(r.id, t('views.shots.job.acting', { id: s.id }))
    if (!j.success) throw new Error(j.err || t('views.shots.actingFailed'))
    toast(t('views.shots.actingReady', { id: s.id }), 'ok', 5000)
    await loadBoard()
  } catch (e) { toast(e instanceof Error ? e.message : t('views.shots.actingFailed'), 'err', 6000) }
  finally { busy.value = '' }
}
useBoardSelection(board, boards, 'shots')
</script>

<template>
  <div class="page">
    <header class="mb-6">
      <h1 class="grad-text text-2xl font-black">{{ $t('views.shots.title') }}</h1>
      <p class="mt-1 text-xs text-slate-500">{{ $t('views.shots.intro') }}</p>
    </header>

    <EmptyState v-if="!app.current" :title="$t('common.pickProjectFirst')" />

    <template v-else>
      <!-- 生成分镜 -->
      <section class="glass mb-5 p-4">
        <!-- 行 0：集选择（独立分块 · 默认全选可生成集） -->
        <div class="mb-3 rounded-xl border border-pink-400/25 bg-pink-400/5 p-3">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="shrink-0 text-sm font-black text-pink-200">{{ $t('views.shots.pickEpisodes') }}</h3>
            <span class="shrink-0 text-xs text-slate-400">{{ $t('views.shots.episodesInfo', { ready: readyEpisodes.length, total: episodes.length }) }}</span>
            <span class="flex-1"></span>
            <button v-if="readyEpisodes.length" class="shrink-0 rounded-full px-2.5 py-0.5 text-2xs font-bold"
              :class="allReadySelected ? 'bg-pink-400/25 text-pink-200' : 'bg-white/10 text-slate-300 hover:bg-white/20'"
              @click="toggleAllEpisodes">
              {{ allReadySelected ? $t('views.shots.deselectAll') : $t('views.shots.selectReady') }}
            </button>
          </div>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <button v-for="e in episodes" :key="e.id" :disabled="!episodeReady(e)"
              class="rounded-full px-2.5 py-1 text-xs-plus font-bold transition disabled:cursor-not-allowed disabled:opacity-40"
              :class="epsSel.includes(e.id) ? 'chip-active' : 'chip'"
              :title="episodeReady(e) ? $t('views.shots.epReady') : $t('views.shots.epNotReady')"
              @click="episodeReady(e) && toggleEp(e.id)">{{ e.id }} {{ e.title }}<span v-if="!episodeReady(e)">{{ $t('views.shots.needsExpand') }}</span></button>
          </div>
          <p v-if="!readyEpisodes.length" class="mt-2 text-xs text-amber-300/80">{{ $t('views.shots.noReady') }}</p>
        </div>
        <!-- 行 1：生成分镜动作 -->
        <div class="flex flex-wrap items-center gap-2">
          <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pink-400/15 text-xs font-black text-pink-300">1</span>
          <h3 class="shrink-0 text-sm font-bold text-slate-200">{{ $t('views.shots.genBoard') }}</h3>
          <span v-if="epsSel.length" class="shrink-0 text-2xs text-slate-500">{{ $t('views.shots.willGenerate', { list: epsSel.join($t('common.listSep')) }) }}</span>
          <span class="flex-1"></span>
          <button class="btn shrink-0" :disabled="!!busy || !!sbRunning.length || !epsSel.length" @click="doSb" :title="$t('views.shots.genTitle')">
            {{ sbRunning.length ? $t('views.shots.generatingList', { list: sbRunning.join(' ') }) : epsSel.length > 1 ? $t('views.shots.genParallel', { n: epsSel.length }) : $t('views.shots.genLlm') }}
          </button>
        </div>
        <!-- 行 2：已有分镜与操作（槽位固定，控件底部对齐，不随上行换行偏移） -->
        <div class="mt-3 flex flex-wrap items-end gap-2 border-t border-line-soft pt-3">
          <label class="w-56 shrink-0 text-xs text-slate-400">{{ $t('views.shots.existing') }}
            <StyledSelect v-model="board" class="mt-1" :options="boards" :storage-key="`wb.${app.current}.shots.board`" :placeholder="$t('views.shots.pickPh')" />
          </label>
          <button class="btn shrink-0" :disabled="!board" :title="$t('views.shots.goPackageTitle')" @click="goPackage">{{ $t('views.shots.goPackage') }}</button>
          <button class="btn btn-ghost shrink-0" :disabled="!!busy || !board" @click="doRebuildPrompts" :title="$t('views.shots.promptsOnlyTitle')">{{ $t('views.shots.promptsOnly') }}</button>
          <button class="btn btn-ghost shrink-0" :disabled="!!busy || !board || !boardEpisode(board)" @click="doRebuildEpisode" :title="$t('views.shots.rebuildEpTitle')">{{ $t('views.shots.rebuildEp') }}</button>
          <Versions v-if="board" :path="`projects/${app.current}/分镜/${board}`" kind="file" @restored="loadBoard" />
          <span v-if="board && boardRev !== null"
            class="shrink-0 rounded-full px-2.5 py-0.5 text-2xs"
            :class="boardStale ? 'bg-amber-400/15 text-amber-200' : 'bg-white/5 text-slate-400'"
            :title="boardStale ? $t('views.shots.staleTitle', { script: scriptRev, board: boardRev }) : $t('views.shots.revTitle')">
            {{ $t('views.shots.basedOn', { rev: boardRev }) }}<template v-if="boardStale">{{ $t('views.shots.staleBadge', { rev: scriptRev }) }}</template>
          </span>
          <button v-if="board" class="btn btn-danger shrink-0 px-2" :title="$t('views.shots.deleteTitle')" @click="removeBoard">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path :d="icons.trash" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <span class="flex-1"></span>
          <StyleSelect target="storyboard" :label="$t('views.shots.directorStyle')" />
          <StyleSelect target="acting" :label="$t('views.shots.actingStyle')" />
        </div>
        <!-- 资产前置提示（非阻断）：scene_ref 是平面图/空间一致性链路的根基，提炼应在分镜生成之前 -->
        <div v-if="!chars.length || !scenesAssets.length" class="mb-3 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3 text-xs-plus leading-relaxed text-amber-200/90">
          <b>{{ $t('views.shots.assets.b1') }}</b>{{ $t('views.shots.assets.t1') }}<b>{{ $t('views.shots.assets.b2') }}</b>{{ $t('views.shots.assets.t2') }}
          <template v-if="shots.length">
            {{ $t('views.shots.assets.t3') }}<b>{{ $t('views.shots.assets.b3') }}</b>{{ $t('views.shots.assets.t4') }}
          </template>
          <template v-else>{{ $t('views.shots.assets.t5') }}</template>
        </div>
        <p v-if="!chars.length && false" class="mt-2 text-xs-plus text-amber-300/80"></p>
        <div v-if="kbHits.length" class="mt-2 flex flex-wrap items-center gap-1.5">
          <span class="text-2xs font-bold text-emerald-400/80">{{ $t('views.shots.kbCards') }}</span>
          <span v-for="h in kbHits" :key="h.id"
            class="rounded-full bg-emerald-400/10 px-2 py-0.5 text-2xs text-emerald-200"
            :title="h.prescription">
            {{ h.skill }}<span v-if="(h as any).source === 'user'" class="ml-1 text-violet-300">{{ $t('views.shots.mine') }}</span>
          </span>
        </div>
      </section>

      <!-- 分镜查看：汇总表格 / 逐镜明细 双 tab -->
      <section class="glass mb-5 p-4">
        <div class="mb-3 flex flex-wrap items-center gap-3">
          <span class="flex h-6 w-6 items-center justify-center rounded-full bg-pink-400/15 text-xs font-black text-pink-300">2</span>
          <button class="rounded-lg px-3 py-1 text-xs font-bold transition"
            :class="viewTab === 'grid' ? 'chip-active' : 'chip'"
            @click="viewTab = 'grid'">{{ $t('views.shots.tabGrid') }}</button>
          <button class="rounded-lg px-3 py-1 text-xs font-bold transition"
            :class="viewTab === 'cards' ? 'chip-active' : 'chip'"
            @click="viewTab = 'cards'">{{ $t('views.shots.tabCards') }}</button>
          <span class="text-xs-plus text-slate-500">{{ $t('common.shots', { n: shots.length }) }}</span>
          <span class="flex-1"></span>
          <template v-if="viewTab === 'grid'">
            <span v-if="gridDirty" class="text-xs-plus text-amber-300">{{ $t('views.shots.dirty') }}</span>
            <button class="btn btn-ghost" :disabled="!shots.length"
              @click="gridFullscreen = !gridFullscreen">{{ gridFullscreen ? $t('views.shots.exitFull') : $t('views.shots.full') }}</button>
            <button class="btn btn-ghost" :disabled="!shots.length" :title="$t('views.shots.fillTitle')"
              @click="fillDefaults">{{ $t('views.shots.fill') }}</button>
            <button class="btn btn-ghost" :disabled="savingGrid" @click="doXlsx">{{ $t('views.shots.exportExcel') }}</button>
            <button class="btn" :disabled="!gridDirty || savingGrid" @click="saveGrid">
              {{ savingGrid ? $t('common.saving') : $t('views.shots.saveChanges') }}
            </button>
          </template>
        </div>

        <!-- 乐观锁冲突：服务端判基线过期时，页面这份内容仍然留着，由用户对照或显式覆盖——绝不静默盖掉 ⑦/⑤ 的改动 -->
        <div v-if="boardConflict" class="mb-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-200">
          <b class="font-bold">{{ $t('views.shots.conflictHead') }}</b>
          <p class="mt-1 leading-relaxed">{{ boardConflict }}</p>
          <div class="mt-2 flex flex-wrap items-center gap-3">
            <label class="flex items-center gap-1.5 text-2xs">
              <input v-model="overwriteConfirmed" type="checkbox" /> {{ $t('views.shots.confirmMine') }}
            </label>
            <button class="btn btn-ghost" @click="reloadLatest">{{ $t('views.shots.reloadLatest') }}</button>
            <button class="btn" :disabled="!overwriteConfirmed || savingGrid" @click="overwriteLatest">{{ $t('views.shots.overwrite') }}</button>
          </div>
        </div>

        <!-- 汇总表格（Excel 式）：镜号/场景/景别/时长/机位视角/器械/镜头/运镜/内容/动作/声音/光影/台词/三提示词。
             时长/器械/镜头为只读——初稿由 LLM 生成，实际调整在⑦创作生成；其余列行内编辑，整组回写（版本快照保护）。 -->
        <div v-if="viewTab === 'grid'">
          <div v-if="!shots.length" class="py-10 text-center text-sm text-slate-500">{{ $t('views.shots.pickOrGen') }}</div>
          <div v-else :class="gridFullscreen ? 'fixed inset-0 z-50 overflow-auto bg-[#0a0e17] p-4' : 'overflow-x-auto rounded-lg border border-line'">
            <table class="tbl-view border-collapse">
              <thead>
                <tr>
                  <th class="sticky-col">{{ $t('views.shots.col.id') }}</th>
                  <th class="min-w-24">{{ $t('views.shots.col.scene') }}</th>
                  <th class="w-20">{{ $t('views.shots.col.size') }}</th>
                  <th class="w-16">{{ $t('views.shots.col.dur') }}</th>
                  <th>{{ $t('views.shots.col.view') }}</th>
                  <th>{{ $t('views.shots.col.rig') }}</th>
                  <th>{{ $t('views.shots.col.lens') }}</th>
                  <th>{{ $t('views.shots.col.move') }}</th>
                  <th class="min-w-40">{{ $t('views.shots.col.content') }}</th>
                  <th class="min-w-36">{{ $t('views.shots.col.action') }}</th>
                  <th class="min-w-28">{{ $t('views.shots.col.sound') }}</th>
                  <th class="min-w-28">{{ $t('views.shots.col.light') }}</th>
                  <th class="min-w-40">{{ $t('views.shots.col.lines') }}</th>
                  <th class="min-w-64">{{ $t('views.shots.col.promptImage') }}</th><th class="min-w-64">{{ $t('views.shots.col.promptVideo') }}</th><th class="min-w-64">{{ $t('views.shots.col.promptGrid') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in shots" :key="s.id">
                  <td class="sticky-col whitespace-nowrap font-black text-sky-300">{{ s.id }}</td>
                  <td class="whitespace-nowrap">
                    <span class="rounded px-1.5 py-0.5 text-2xs font-bold" :class="sceneCell(s).cls" :title="sceneCell(s).title">{{ sceneCell(s).label }}</span>
                  </td>
                  <!-- 景别：与 Excel 导出同列（原来只有 xlsx 有，两边口径对不上）；调整在逐镜明细/JSON -->
                  <td class="whitespace-nowrap text-slate-300">{{ vocab('shotSize', s.shot_size) || '—' }}</td>
                  <td class="text-center tabular-nums text-slate-200">{{ s.dur ?? 4 }}s</td>
                  <td class="whitespace-nowrap text-slate-400" :title="`${JSON.stringify(s.pos)} → ${JSON.stringify(s.look)}`">{{ viewOf(s) }}</td>
                  <td class="whitespace-nowrap text-slate-300">{{ s.rig || '—' }}</td>
                  <td class="whitespace-nowrap text-slate-300">{{ s.lens || '—' }}</td>
                  <td class="whitespace-nowrap text-slate-400">{{ vocab('cameraMove', s.camera_move) }}</td>
                  <td><textarea v-model="s.content" rows="2" class="cell-input text-slate-300" @input="markDirty"></textarea></td>
                  <td><textarea v-model="s.action" rows="2" class="cell-input text-slate-200" @input="markDirty"></textarea></td>
                  <td><textarea v-model="s.sound" rows="2" class="cell-input text-slate-400" @input="markDirty"></textarea></td>
                  <td><textarea v-model="s.lighting" rows="2" class="cell-input text-slate-400" @input="markDirty"></textarea></td>
                  <td class="max-w-56 text-slate-400">{{ linesOf(s) || '—' }}</td>
                  <td><textarea v-model="s.prompt_image" rows="3" class="cell-input text-slate-300" @input="markDirty"></textarea></td>
                  <td><textarea v-model="s.prompt_video" rows="3" class="cell-input text-slate-300" @input="markDirty"></textarea></td>
                  <td><textarea v-model="s.prompt_grid" rows="3" class="cell-input text-slate-300" @input="markDirty"></textarea></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 逐镜明细：左列表 + 右详情（主从布局，无弹窗） -->
        <div v-else>
          <div v-if="!shots.length" class="py-10 text-center text-sm text-slate-500">{{ $t('views.shots.pickOrGen') }}</div>
          <div v-else class="flex items-start gap-3">
            <!-- 左：镜头列表 -->
            <div class="modal-h-lg w-64 shrink-0 overflow-y-auto rounded-lg border border-line">
              <button v-for="s in shots" :key="s.id"
                class="flex w-full items-center gap-2 border-b border-line-soft px-2.5 py-2 text-left transition"
                :class="detail?.id === s.id ? 'bg-sky-400/10' : 'hover:bg-white/5'"
                @click="detail = s">
                <div class="h-9 w-14 shrink-0 overflow-hidden rounded border border-line bg-black/30">
                  <img v-if="shotOutput(s)?.image" :src="mediaUrl(shotOutput(s)!.image!)" class="h-full w-full object-cover" loading="lazy" :alt="$t('views.shots.refAlt', { id: s.id })" />
                  <div v-else class="flex h-full items-center justify-center text-2xs text-slate-600">{{ $t('views.shots.noImage') }}</div>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5">
                    <span class="font-black text-sky-300">{{ s.id }}</span>
                    <span class="truncate text-2xs text-slate-400">{{ s.move || vocab('shotSize', s.shot_size) }}</span>
                    <span class="ml-auto shrink-0 text-2xs tabular-nums text-slate-500">{{ s.dur }}s</span>
                  </div>
                  <div class="mt-0.5 truncate text-2xs text-slate-500">{{ s.action || s.prompt || $t('views.shots.noActionSummary') }}</div>
                </div>
              </button>
            </div>
            <!-- 右：镜详情 -->
            <div v-if="detail" class="modal-h-lg min-w-0 flex-1 overflow-y-auto rounded-lg border border-line p-3">
              <div class="mb-3 flex flex-wrap items-center gap-3">
                <span class="rounded bg-sky-400/15 px-2 py-0.5 text-sm font-black text-sky-300">{{ detail.id }}</span>
                <b class="text-base text-slate-100">{{ detail.move }}</b>
                <span class="text-xs text-slate-500">{{ detail.dur }}s · {{ detail.scene }}</span>
                <span class="text-2xs text-slate-500">{{ outputStatusLabel(shotOutput(detail)?.status) }}<span v-if="shotOutput(detail)?.count">{{ $t('views.shots.outputsN', { n: shotOutput(detail)?.count }) }}</span></span>
              </div>
              <details class="mb-3 rounded-lg border border-line-soft bg-black/15 px-2 py-1.5">
                <summary class="cursor-pointer text-2xs text-slate-500">{{ $t('views.shots.advanced') }}</summary>
                <div class="mt-2 flex flex-wrap items-center gap-2">
                  <button class="btn" :disabled="actingCompiling" @click="detail && doActingPrompt(detail)">
                    {{ actingCompiling ? $t('views.shots.compiling') : $t('views.shots.compileActing') }}
                  </button>
                  <button class="btn btn-ghost" :disabled="!!busy || !actingVendor" @click="detail && doRunActing(detail)">
                    {{ actingVendor ? $t('views.shots.genActing') : $t('views.shots.needText') }}
                  </button>
                  <span class="text-2xs text-slate-500">{{ $t('views.shots.actingNote') }}</span>
                </div>
              </details>
              <div class="space-y-3 text-xs">
                <!-- 字段与汇总表格同列：场景/时长(头)/机位/器械/镜头/运镜/内容/动作/声音/光影/台词/三提示词 -->
                <div class="grid grid-cols-2 gap-2">
                  <div class="rounded-lg bg-white/5 p-2.5"><b class="text-slate-400">{{ $t('views.shots.col.scene') }}</b>
                    <p class="mt-1"><span class="rounded px-1.5 py-0.5 text-2xs font-bold" :class="sceneCell(detail).cls" :title="sceneCell(detail).title">{{ sceneCell(detail).label }}</span></p></div>
                  <div class="rounded-lg bg-white/5 p-2.5"><b class="text-slate-400">{{ $t('views.shots.col.view') }}</b>
                    <p class="mt-1 text-slate-200" :title="`${JSON.stringify(detail.pos)} → ${JSON.stringify(detail.look)}`">{{ viewOf(detail) }}</p></div>
                  <div class="rounded-lg bg-white/5 p-2.5"><b class="text-slate-400">{{ $t('views.shots.col.rig') }}</b><p class="mt-1 text-slate-200">{{ detail.rig || '—' }}</p></div>
                  <div class="rounded-lg bg-white/5 p-2.5"><b class="text-slate-400">{{ $t('views.shots.col.lens') }}</b><p class="mt-1 text-slate-200">{{ detail.lens || '—' }}</p></div>
                  <div class="rounded-lg bg-white/5 p-2.5"><b class="text-slate-400">{{ $t('views.shots.sizeAngle') }}</b><p class="mt-1 text-slate-200">{{ vocab('shotSize', detail.shot_size) }} · {{ vocab('angle', detail.angle) }}</p></div>
                  <div class="rounded-lg bg-white/5 p-2.5"><b class="text-slate-400">{{ $t('views.shots.moveTrans') }}</b><p class="mt-1 text-slate-200">{{ vocab('cameraMove', detail.camera_move) }} · {{ vocab('transition', detail.transition) }}</p></div>
                  <div class="rounded-lg bg-white/5 p-2.5"><b class="text-slate-400">{{ $t('views.shots.camPos') }}</b><p class="mt-1 font-mono text-slate-200">{{ JSON.stringify(detail.pos) }}</p></div>
                  <div class="rounded-lg bg-white/5 p-2.5"><b class="text-slate-400">{{ $t('views.shots.lookAt') }}</b><p class="mt-1 font-mono text-slate-200">{{ JSON.stringify(detail.look) }}</p></div>
                </div>
                <div class="rounded-lg bg-white/5 p-2.5"><b class="text-slate-400">{{ $t('views.shots.col.content') }}</b><p class="mt-1 whitespace-pre-wrap text-slate-300">{{ detail.content || '—' }}</p></div>
                <div class="rounded-lg bg-white/5 p-2.5"><b class="text-emerald-300">{{ $t('views.shots.col.action') }}</b><p class="mt-1 whitespace-pre-wrap text-slate-300">{{ detail.action || '—' }}</p></div>
                <div class="rounded-lg bg-white/5 p-2.5"><b class="text-slate-400">{{ $t('views.shots.col.sound') }}</b><p class="mt-1 whitespace-pre-wrap text-slate-300">{{ detail.sound || '—' }}</p></div>
                <div class="rounded-lg bg-white/5 p-2.5"><b class="text-slate-400">{{ $t('views.shots.col.light') }}</b><p class="mt-1 whitespace-pre-wrap text-slate-300">{{ detail.lighting || '—' }}</p></div>
                <div class="rounded-lg bg-white/5 p-2.5"><b class="text-amber-300">{{ $t('views.shots.linesTrack') }}</b>
                  <div v-for="(L, i) in detail.lines || []" :key="i" class="mt-1 text-slate-300">
                    <span class="text-slate-500">at {{ L.at }}s</span> 【{{ spk(L.speaker) }}】{{ L.line }}
                  </div>
                  <div v-if="!detail.lines?.length" class="mt-1 text-slate-500">{{ $t('views.shots.noLines') }}</div>
                </div>
                <div class="rounded-lg bg-violet-400/5 p-2.5"><b class="text-violet-300">{{ $t('views.shots.col.promptImage') }}</b><p class="mt-1 whitespace-pre-wrap text-slate-300">{{ detail.prompt_image || detail.prompt || '—' }}</p></div>
                <div class="rounded-lg bg-sky-400/5 p-2.5"><b class="text-sky-300">{{ $t('views.shots.col.promptVideo') }}</b><p class="mt-1 whitespace-pre-wrap text-slate-300">{{ detail.prompt_video || $t('views.shots.notRebuilt') }}</p></div>
                <div class="rounded-lg bg-violet-400/5 p-2.5"><b class="text-violet-300">{{ $t('views.shots.col.promptGrid') }}</b><p class="mt-1 whitespace-pre-wrap text-slate-300">{{ detail.prompt_grid || $t('views.shots.pendingLlm') }}</p></div>
                <div v-if="detail.asset_refs?.length" class="rounded-lg bg-cyan-400/5 p-2.5"><b class="text-cyan-300">{{ $t('views.shots.linkedAssets') }}</b><p class="mt-1 break-all text-slate-300">{{ detail.asset_refs.join($t('common.listSep')) }}</p></div>
                <div v-if="detail.asset_revisions" class="rounded-lg bg-amber-400/5 p-2.5"><b class="text-amber-300">{{ $t('views.shots.assetRevs') }}</b><p class="mt-1 break-all text-slate-300">{{ Object.entries(detail.asset_revisions).map(([ref, rev]) => `${ref} v${rev}`).join(' · ') }}</p></div>
                <div class="rounded-lg bg-white/5 p-2.5"><b class="text-slate-400">{{ $t('views.shots.shotOutput') }}</b><img v-if="shotOutput(detail)?.image" :src="mediaUrl(shotOutput(detail)!.image!)" class="mt-2 aspect-video w-full rounded-md border border-line bg-black object-contain" loading="lazy" :alt="$t('views.shots.refAlt', { id: detail.id })" /></div>
                <div v-if="actingPrompt" class="rounded-lg bg-emerald-400/10 p-2.5"><b class="text-emerald-300">{{ $t('views.shots.actingResult') }}</b><p class="mt-1 whitespace-pre-wrap text-slate-300">{{ actingPrompt }}</p></div>
              </div>
            </div>
            <div v-else class="modal-h-lg flex-1 rounded-lg border border-dashed border-line p-6 text-center text-sm text-slate-500">{{ $t('views.shots.pickShotLeft') }}</div>
          </div>
        </div>
      </section>

    </template>

  </div>
</template>


