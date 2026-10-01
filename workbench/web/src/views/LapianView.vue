<script setup lang="ts">
import { t, te, vocab, type VocabKind } from '../i18n'
// -*- coding: utf-8 -*-
/** ① 拉片解构：生成 / 版本时间线 / 解构表格编辑 / 导出（md + 分镜脚本 xlsx）/ 重新生成。 */
import { ref, computed, watch, nextTick } from 'vue'
import {
  fetchAnalysisList, fetchAnalysis, saveAnalysis, deleteAnalysis, runAnalysis, exportAnalysisXlsx,
  runAnalysisAi, reshotShots, whiteFromAnalysis, fetchWhiteBoard, fetchAnalysisXlsxView,
  mergeAnalysisLines, fetchEnvConfig, fmtT, mediaUrl, buildKnowledge, fetchKnowledge,
  type Analysis, type AnalysisMeta, type AnalysisShot, type Vendor, type WhiteBoard
} from '../api'
import { app, materialVideos, projectFiles, loadBasics, toast } from '../stores/app'
import { useRouter } from 'vue-router'
import { trackJob } from '../stores/jobs'
import OverlayViewer from '../components/OverlayViewer.vue'
import UploadButton from '../components/UploadButton.vue'
import StyledSelect from '../components/StyledSelect.vue'
import { icons } from '../components/icons'
import EmptyState from '../components/EmptyState.vue'
import { SHOT_SIZES, CAMERA_MOVES, ANGLES, TRANSITIONS } from '../constants'

const versions = ref<AnalysisMeta[]>([])
const currentName = ref('')
const analysis = ref<Analysis | null>(null)
/** 显式脏标记：编辑入口置 true（替代全量 JSON.stringify 对比），加载/保存成功置 false。 */
const dirty = ref(false)
function markDirty() {
  dirty.value = true
}

/* 可增删列表（镜内台词）稳定 key：加载时补 _uid，保存前剔除（后端不落该字段）。 */
let uidSeq = 0
const nextUid = () => `u${Date.now().toString(36)}_${++uidSeq}`
function ensureDialogueUids(a: Analysis | null) {
  for (const s of a?.shots || []) for (const d of s.dialogue || []) if (!d._uid) d._uid = nextUid()
}
/** 保存载荷：剔除前端辅助字段 _uid（validate 系脚本虽容忍未知字段，仍保持落盘干净）。 */
function analysisPayload(): Analysis {
  const a = analysis.value!
  return {
    ...a,
    shots: (a.shots || []).map((s) =>
      s.dialogue ? { ...s, dialogue: s.dialogue.map((d) => { const c = { ...d }; delete c._uid; return c }) } : s
    )
  }
}
const loading = ref(false)
const running = ref(false)
const notFound = ref(false)

/* 解构 → 白模分镜桥接：分镜/<版本名>.json 存在即已关联 */
const router = useRouter()
const genWhiteBusy = ref(false)
const whiteBoard = computed(() => {
  if (!currentName.value) return ''
  const fn = `${currentName.value}.json`
  return projectFiles('分镜', /\.json$/i).includes(fn) ? fn : ''
})

/** 把全部拉片成果归纳成经验卡片（自动卡；用户卡片不受影响）。创作时这些卡自动垫上下文。 */
const kbBusy = ref(false)
async function precipitate() {
  kbBusy.value = true
  try {
    const before = await fetchKnowledge()
    await buildKnowledge()
    setTimeout(async () => {
      try {
        const after = await fetchKnowledge()
        const delta = (after.skills?.length || 0) - (before.skills?.length || 0)
        toast(t('views.lapian.precipitated', { n: after.skills?.length || 0, added: Math.max(0, delta) }), 'ok', 6000)
      } catch (e) {
        // 二次统计失败不能当成功报：否则卡片其实没落库，页面却提示"已沉淀"
        toast(t('views.lapian.statsFailed', { err: e instanceof Error ? e.message : t('views.lapian.unknownError') }), 'err', 6000)
      } finally {
        kbBusy.value = false
      }
    }, 2500)
  } catch (e) {
    toast(e instanceof Error ? e.message : t('views.lapian.precipitateFailed'), 'err')
    kbBusy.value = false
  }
}

async function genWhiteBoard() {
  if (!app.current || !currentName.value) return
  genWhiteBusy.value = true
  try {
    const r = await whiteFromAnalysis({ project: app.current, analysis: currentName.value })
    const job = await trackJob(r.id, t('views.lapian.job.white'))
    if (!job.success) throw new Error(job.err || t('views.lapian.whiteFailed'))
    await loadBasics()
    if (viewTab.value === 'json') loadWbJson()   // 正在看 JSON 页签：刷新内容
    toast(t('views.lapian.whiteDone'), 'ok', 4000)
  } catch (e) {
    toast(e instanceof Error ? e.message : t('views.lapian.genFailed'), 'err')
  } finally {
    genWhiteBusy.value = false
  }
}

function goWhite() {
  localStorage.setItem('wb.white.board', whiteBoard.value)
  router.push('/white')
}

/* ---------- 版本产物在线看（二级页签）：白模分镜 JSON / 分镜脚本 xlsx / analysis.md ---------- */
type ViewTab = 'edit' | 'json' | 'xlsx' | 'md'
const viewTab = ref<ViewTab>('edit')
const VIEW_TABS: { key: ViewTab }[] = [{ key: 'edit' }, { key: 'json' }, { key: 'xlsx' }, { key: 'md' }]
const camLabel = (cam?: string) => (cam && te('views.lapian.cam.' + cam) ? t('views.lapian.cam.' + cam) : cam || '—')
/** Подписи для StyledSelect с контролируемыми словарями: значения остаются китайскими (данные), показываем перевод. */
const vocabLabels = (kind: VocabKind, list: readonly string[]) => Object.fromEntries(list.map((v) => [v, vocab(kind, v)]))

const wbJson = ref<WhiteBoard | null>(null)
const wbJsonLoading = ref(false)
const wbJsonRaw = ref(false)

async function loadWbJson() {
  wbJson.value = null
  if (!app.current || !whiteBoard.value) return
  wbJsonLoading.value = true
  try {
    wbJson.value = await fetchWhiteBoard(app.current, whiteBoard.value)
  } catch (e) {
    toast(e instanceof Error ? e.message : t('views.lapian.jsonReadFailed'), 'err')
  } finally {
    wbJsonLoading.value = false
  }
}

const wbActors = computed(() =>
  Object.entries(wbJson.value?.actors || {}).map(([aid, a]) => ({
    aid,
    name: a.name || aid,
    color: `rgb(${(a.shirt || [120, 120, 130]).join(',')})`
  }))
)
const wbShotLines = computed(() => (wbJson.value?.shots || []).reduce((n, s) => n + (s.lines?.length || 0), 0))
function wbActorName(aid?: string | null): string {
  if (!aid) return ''
  return wbJson.value?.actors?.[aid]?.name || aid
}
function wbActorColor(aid?: string | null): string {
  const s = aid ? wbJson.value?.actors?.[aid]?.shirt : null
  return s ? `rgb(${s.join(',')})` : '#94a3b8'
}

const xlsxSheets = ref<{ title: string; rows: string[][] }[] | null>(null)
const xlsxLoading = ref(false)

async function loadXlsxView() {
  if (!app.current || !currentName.value) return
  xlsxLoading.value = true
  try {
    try {
      xlsxSheets.value = (await fetchAnalysisXlsxView(app.current, currentName.value)).sheets
    } catch (e) {
      if (e instanceof Error && 'status' in e && (e as { status: number }).status === 404) {
        const g = await exportAnalysisXlsx(app.current, currentName.value) as any   // 未导出过：先生成（job）再读
        if (g?.job && g.id) await trackJob(g.id, t('views.lapian.job.xlsx'))
        xlsxSheets.value = (await fetchAnalysisXlsxView(app.current, currentName.value)).sheets
      } else {
        throw e
      }
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : t('views.lapian.xlsxReadFailed'), 'err')
  } finally {
    xlsxLoading.value = false
  }
}

const mdText = ref('')
const mdLoading = ref(false)

async function loadMdText() {
  if (!app.current || !currentName.value) return
  mdLoading.value = true
  try {
    const r = await fetch(mediaUrl(`projects/${app.current}/拉片/${currentName.value}/analysis.md`))
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    mdText.value = await r.text()
  } catch {
    mdText.value = ''
    toast(t('views.lapian.mdMissing'), 'err')
  } finally {
    mdLoading.value = false
  }
}

watch(viewTab, (t) => {
  if (t === 'json' && !wbJson.value) loadWbJson()
  if (t === 'xlsx' && !xlsxSheets.value) loadXlsxView()
  if (t === 'md' && !mdText.value) loadMdText()
})
watch(currentName, () => {
  viewTab.value = 'edit'
  wbJson.value = null
  wbJsonRaw.value = false
  xlsxSheets.value = null
  mdText.value = ''
})

// 工具条：源视频一律取当前项目 拉片素材/
const video = ref('')
const newName = ref('')
const note = ref('')
/** AI 解构开关（no_ai = !useAi）；默认随可用 vision 厂商自动决定，用户手动改过则不覆盖。 */
const useAi = ref(false)
const aiVendor = ref<Vendor | null>(null)
const aiTouched = ref(false)
const minDur = ref(2.0)
const thresh = ref(13)
const workers = ref(4)
const advOpen = ref(false)

const materialList = computed(() => materialVideos())
const videoOptions = computed(() => materialList.value.map((v) => v.rel))
const videoLabels = computed(() => Object.fromEntries(materialList.value.map((v) => [v.rel, v.file])))
watch([videoOptions, video], () => {
  if (!video.value && videoOptions.value.length) video.value = videoOptions.value.at(-1) || '' // 默认选最后一个素材视频（含项目切换回填）
}, { immediate: true })

/** 探测可用 vision 厂商（enabled + vision 模型非空 + key 掩码非空），决定 AI 开关默认值。 */
async function loadAiVendor() {
  try {
    const cfg = await fetchEnvConfig()
    aiVendor.value =
      (cfg.vendors || []).find(
        (v) => v.enabled && (v.models?.vision || '') !== '' && (v.api_key || '') !== ''
      ) || null
  } catch {
    aiVendor.value = null
  }
  if (!aiTouched.value) useAi.value = !!aiVendor.value
}

async function loadVersions() {
  if (!app.current) return
  try {
    versions.value = await fetchAnalysisList(app.current)
    notFound.value = false
  } catch (e) {
    if (e instanceof Error && 'status' in e && (e as { status: number }).status === 404) {
      versions.value = []
      notFound.value = true
    } else {
      toast(t('views.lapian.versionsFailed'), 'err')
    }
  }
}

let loadSeq = 0
async function loadVersion(name: string) {
  if (!app.current || !name) return
  const seq = ++loadSeq
  const project = app.current
  loading.value = true
  try {
    const result = await fetchAnalysis(project, name)
    if (seq !== loadSeq || project !== app.current) return
    ensureDialogueUids(result)
    analysis.value = result
    currentName.value = name
    dirty.value = false
  } catch {
    if (seq === loadSeq && project === app.current) toast(t('views.lapian.loadFailed'), 'err')
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

watch(currentName, (n) => (newName.value = n))

async function runRegen() {
  const mv = materialList.value.find((v) => v.rel === video.value)
  if (!app.current || !mv) {
    toast(t('views.lapian.pickVideo'), 'err')
    return
  }
  running.value = true
  try {
    const name = newName.value.trim() || undefined
    const r = await runAnalysis({
      project: app.current,
      video: mv.abs,
      ...(name ? { name } : {}),
      note: note.value.trim() || undefined,
      no_ai: !useAi.value,
      min_dur: Number(minDur.value) || 2.0,
      thresh: Number(thresh.value) || 13,
      workers: Math.max(1, Math.min(Number(workers.value) || 4, 16))
    })
    toast(t('common.jobStarted', { what: t('views.lapian.what.analysis'), id: r.id }), 'ok')
    const j = await trackJob(r.id, t('views.lapian.job.analysis', { name: name || '' }).trim())
    if (j.success) {
      toast(t('views.lapian.analysisDone'), 'ok')
      await loadVersions()
      // 自动选中新版本并加载（后端返回 name 优先，否则取创建时间最新）
      const latest =
        (r.name && versions.value.find((v) => v.name === r.name)) ||
        [...versions.value].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]
      if (latest) await loadVersion(latest.name)
    } else {
      toast(t('views.lapian.analysisFailed'), 'err')
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : t('common.startFailed'), 'err')
  } finally {
    running.value = false
  }
}

async function save() {
  if (!app.current || !currentName.value || !analysis.value) return
  try {
    await saveAnalysis(app.current, currentName.value, analysisPayload())
    dirty.value = false
    mdText.value = ''   // analysis.md 已重生成，重进页签时刷新
    toast(t('views.lapian.saved'), 'ok')
  } catch (e) {
    toast(e instanceof Error ? e.message : t('common.saveFailed'), 'err')
  }
}

async function removeVersion(name: string) {
  if (!app.current || !confirm(t('views.lapian.confirmDelete', { name }))) return
  try {
    await deleteAnalysis(app.current, name)
    toast(t('views.lapian.deleted'), 'ok')
    if (currentName.value === name) {
      analysis.value = null
      currentName.value = ''
      dirty.value = false
    }
    await loadVersions()
  } catch {
    toast(t('common.deleteFailed'), 'err')
  }
}

async function exportMd() {
  if (!app.current || !currentName.value) return
  const rel = `projects/${app.current}/拉片/${currentName.value}/analysis.md`
  try {
    const r = await fetch(mediaUrl(rel))
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
  } catch {
    toast(t('views.lapian.mdMissing'), 'err')
    return
  }
  const a = document.createElement('a')
  a.href = mediaUrl(rel)
  a.download = `${currentName.value}_analysis.md`
  a.click()
  toast(t('views.lapian.mdDownload'), 'ok')
}

/** 导出分镜脚本 xlsx（/api/analysis/export 同步生成 → mediaUrl 下载）。 */
const exportingXlsx = ref(false)
async function exportXlsx() {
  if (!app.current || !currentName.value) return
  exportingXlsx.value = true
  try {
    const r = await exportAnalysisXlsx(app.current, currentName.value) as any
    if (r?.job && r.id) { const j = await trackJob(r.id, t('views.lapian.job.xlsx')); if (!j.success) throw new Error(j.err || t('views.lapian.exportFailed')) }
    const file = r.file || `projects/${app.current}/拉片/${currentName.value}/${currentName.value}_分镜脚本.xlsx`
    xlsxSheets.value = null   // 导出后失效 xlsx 页签缓存
    const a = document.createElement('a')
    a.href = mediaUrl(file)
    a.download = file.split('/').pop() || '分镜脚本.xlsx'
    a.click()
    toast(t('views.lapian.xlsxExported', { file: a.download }), 'ok')
  } catch (e) {
    toast(e instanceof Error ? e.message : t('views.lapian.exportFailed'), 'err')
  } finally {
    exportingXlsx.value = false
  }
}

/* ---------- AI 填充 / 单镜重识 / 台词同步 ---------- */
const aiFilling = ref(false)
const linesMerging = ref(false)

/** 把台词页合并的台词脚本并入当前版本 dialogue（无 AI，秒级；台词/归属更新后点这个）。 */
async function syncLines() {
  if (!app.current || !currentName.value) return
  linesMerging.value = true
  try {
    const r = await mergeAnalysisLines(app.current, currentName.value) as any
    if (r?.job && r.id) { const j = await trackJob(r.id, t('views.lapian.job.syncLines')); if (!j.success) throw new Error(j.err || t('views.lapian.syncFailed')) }
    toast(t('views.lapian.linesMerged'), 'ok')
    await loadVersion(currentName.value)
    mdText.value = ''   // analysis.md 已重生成，重进页签时刷新
  } catch (e) {
    toast(e instanceof Error ? e.message : t('views.lapian.syncFailed'), 'err')
  } finally {
    linesMerging.value = false
  }
}

/** 对当前版本跑 AI 填充：only_empty=true 只填空镜，false 全部重识（二次确认）。 */
async function aiFill(onlyEmpty: boolean) {
  if (!app.current || !currentName.value) {
    toast(t('views.lapian.pickVersion'), 'err')
    return
  }
  if (
    !onlyEmpty &&
    !confirm(t('views.lapian.confirmRefill', { name: currentName.value, n: shots.value.length }))
  ) {
    return
  }
  aiFilling.value = true
  try {
    const r = await runAnalysisAi({ project: app.current, name: currentName.value, only_empty: onlyEmpty })
    toast(t('common.jobStarted', { what: t('views.lapian.what.aiFill'), id: r.id }), 'ok')
    const j = await trackJob(r.id, onlyEmpty ? t('views.lapian.job.fillEmpty') : t('views.lapian.job.refillAll'))
    if (j.success) {
      toast(t('views.lapian.aiFillDone'), 'ok')
      await loadVersion(currentName.value)
    } else {
      toast(t('views.lapian.aiFillFailed'), 'err')
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : t('common.startFailed'), 'err')
  } finally {
    aiFilling.value = false
  }
}

/** 单镜重新识别（reshot）：按钮转圈 + trackJob，完成后刷新当前版本并滚动回该镜。 */
const reshotBusy = ref<Record<string, boolean>>({})

async function reshotOne(shot: AnalysisShot) {
  if (!app.current || !currentName.value || !shot.id || reshotBusy.value[shot.id]) return
  reshotBusy.value = { ...reshotBusy.value, [shot.id]: true }
  try {
    const r = await reshotShots({ project: app.current, name: currentName.value, shots: [shot.id] })
    toast(t('views.lapian.reshotStarted', { id: r.id, shot: shot.id }), 'ok')
    const j = await trackJob(r.id, t('views.lapian.job.reshot', { shot: shot.id }))
    if (j.success) {
      toast(t('views.lapian.reshotDone', { shot: shot.id }), 'ok')
      await loadVersion(currentName.value)
      await nextTick()
      document.getElementById(`shot-${shot.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } else {
      toast(t('views.lapian.reshotFailed'), 'err')
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : t('common.startFailed'), 'err')
  } finally {
    const rest = { ...reshotBusy.value }
    delete rest[shot.id]
    reshotBusy.value = rest
  }
}

/** 后端默认命名（server.py /api/analysis/run：分析_%Y%m%d_%H%M%S，同名预检追加 _vN）。 */
const DEFAULT_NAME_RE = /^分析_\d{8}_\d{6}(_v\d+)?$/

function regeneratePlus() {
  if (currentName.value) {
    if (DEFAULT_NAME_RE.test(currentName.value)) {
      newName.value = ''   // 默认时间戳名：留空让后端自动命名，避免 +1 出怪名
    } else {
      const m = currentName.value.match(/^(.*?)(\d+)$/)
      newName.value = m ? m[1] + (Number(m[2]) + 1) : currentName.value + '_v2'
    }
  }
  runRegen()
}

/* ---------- 镜头编辑 ---------- */
const shots = computed(() => analysis.value?.shots || [])

/** no-ai 生成的版本（engine 缺省/none）：只有切点+关键帧，提示可开 AI 重跑。 */
const isNoAiVersion = computed(
  () => !!analysis.value && (!analysis.value.engine || analysis.value.engine === 'none')
)

/** 空字段镜头（无任何分析内容）→ 视觉弱化。 */
function shotEmpty(shot: AnalysisShot): boolean {
  return (
    !shot.shot_size &&
    !shot.camera_move &&
    !shot.angle &&
    !shot.lighting &&
    !shot.action &&
    !shot.story &&
    !shot.prompt_cn &&
    !(shot.dialogue && shot.dialogue.length)
  )
}

function addDialogue(shot: AnalysisShot) {
  if (!shot.dialogue) shot.dialogue = []
  shot.dialogue.push({ speaker: '角色A', text: '', t_in: shot.t_in, t_out: shot.t_out, _uid: nextUid() })
  markDirty()
}
function removeDialogue(shot: AnalysisShot, i: number) {
  shot.dialogue?.splice(i, 1)
  markDirty()
}

/* ---------- 关键帧 lightbox ---------- */
const lbVisible = ref(false)
const lbIndex = ref(0)
const lbImages = ref<string[]>([])

function openKf(shot: AnalysisShot, i: number) {
  lbImages.value = (shot.keyframes || []).map((k) =>
    mediaUrl(`projects/${app.current}/拉片/${currentName.value}/${k}`)
  )
  lbIndex.value = i
  lbVisible.value = true
}

function kfUrl(_shot: AnalysisShot, k: string) {
  return mediaUrl(`projects/${app.current}/拉片/${currentName.value}/${k}`)
}

const engineColor = (e?: string) =>
  e === 'ai' || e === 'glm' ? 'linear-gradient(110deg,#e879f9,#a78bfa)' : 'linear-gradient(110deg,#22d3ee,#34d399)'

watch(() => app.current, () => {
  analysis.value = null
  currentName.value = ''
  video.value = ''
  dirty.value = false
  loadVersions()
  loadAiVendor()
}, { immediate: true })
</script>

<template>
  <div class="page">
    <header class="mb-6">
      <h1 class="grad-text text-2xl font-black">{{ $t('views.lapian.title') }}</h1>
      <p class="mt-1 text-xs text-slate-500">{{ $t('views.lapian.intro') }}</p>
      <button class="btn btn-ghost mt-2" :disabled="kbBusy"
        :title="$t('views.lapian.precipitateTitle')"
        @click="precipitate">
        {{ kbBusy ? $t('views.lapian.precipitating') : $t('views.lapian.precipitate') }}
      </button>
    </header>

    <!-- 工具条 -->
    <div class="glass mb-6 flex flex-wrap items-end gap-3 p-4">
      <label class="min-w-56 flex-1 text-xs text-slate-400">
        {{ $t('common.srcVideo') }}
        <StyledSelect
          v-model="video"
          class="mt-1"
          :options="videoOptions"
          :labels="videoLabels"
          :storage-key="`wb.${app.current}.lapian.video`"
          :placeholder="$t('common.pickVideo')"
        />
      </label>
      <UploadButton @uploaded="loadBasics" />
      <p v-if="app.current && !materialList.length" class="mb-2 rounded-lg bg-amber-400/10 px-3 py-1.5 text-xs-plus text-amber-300">
        {{ $t('views.lapian.noMaterial') }}
      </p>
      <label class="w-44 text-xs text-slate-400">
        {{ $t('views.lapian.name') }}
        <input v-model="newName" class="input mt-1" :placeholder="$t('views.lapian.namePh')" />
      </label>
      <label class="w-52 flex-1 text-xs text-slate-400">
        {{ $t('views.lapian.note') }}
        <input v-model="note" class="input mt-1" :placeholder="$t('views.lapian.notePh')" />
      </label>
      <div class="pb-1 text-xs">
        <label class="flex cursor-pointer items-center gap-1.5 text-slate-300">
          <input v-model="useAi" type="checkbox" class="accent-cyan-400" @change="aiTouched = true" />
          {{ $t('views.lapian.useAi') }}
        </label>
        <div class="mt-0.5 min-h-4">
          <p v-if="useAi && aiVendor" class="text-2xs text-cyan-300/80">{{ $t('views.lapian.willUse', { label: aiVendor.label, model: aiVendor.models?.vision }) }}</p>
          <p v-else-if="!aiVendor" class="text-2xs text-slate-500">{{ $t('views.lapian.needVision') }}</p>
        </div>
      </div>
      <button class="btn" :disabled="running || !app.current" @click="runRegen">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path :d="icons.bolt" stroke-linecap="round" stroke-linejoin="round"/></svg>
        {{ running ? $t('views.lapian.running') : $t('views.lapian.run') }}
      </button>
      <button
        class="btn btn-ghost btn-sm"
        :disabled="linesMerging || !currentName"
        :title="$t('views.lapian.syncTitle')"
        @click="syncLines"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path :d="icons.chat" stroke-linecap="round" stroke-linejoin="round"/></svg>
        {{ linesMerging ? $t('views.lapian.syncing') : $t('views.lapian.job.syncLines') }}
      </button>
      <button
        class="btn btn-ghost btn-sm"
        :disabled="aiFilling || !currentName"
        :title="$t('views.lapian.fillTitle')"
        @click="aiFill(true)"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path :d="icons.wand" stroke-linecap="round" stroke-linejoin="round"/></svg>
        {{ aiFilling ? $t('views.lapian.filling') : $t('views.lapian.job.fillEmpty') }}
      </button>
      <button
        class="btn btn-ghost btn-sm"
        :disabled="aiFilling || !currentName"
        :title="$t('views.lapian.refillTitle')"
        @click="aiFill(false)"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path :d="icons.refresh" stroke-linecap="round" stroke-linejoin="round"/></svg>
        {{ $t('views.lapian.job.refillAll') }}
      </button>
      <button class="btn btn-ghost btn-sm" @click="advOpen = !advOpen">{{ $t('views.lapian.advanced') }} {{ advOpen ? '▴' : '▾' }}</button>
    </div>

    <!-- 高级参数（折叠） -->
    <div v-if="advOpen" class="glass mb-6 flex flex-wrap items-end gap-4 p-4 text-xs text-slate-400">
      <label class="w-24">
        {{ $t('views.lapian.minDur') }}
        <input v-model.number="minDur" type="number" step="0.1" min="0" class="input mt-1 tabular-nums" />
      </label>
      <label class="w-24">
        {{ $t('views.lapian.thresh') }}
        <input v-model.number="thresh" type="number" step="1" min="1" class="input mt-1 tabular-nums" />
      </label>
      <label class="w-24" :title="$t('views.lapian.workersTitle')">
        {{ $t('views.lapian.workers') }}
        <input v-model.number="workers" type="number" step="1" min="1" max="16" class="input mt-1 tabular-nums" />
      </label>
      <p class="pb-2 text-2xs text-slate-500">{{ $t('views.lapian.advHint') }}</p>
    </div>

    <EmptyState v-if="!app.current" :title="$t('common.pickProjectFirst')" />

    <div v-else class="flex gap-5">
      <!-- 版本时间线 -->
      <aside class="w-60 shrink-0">
        <h3 class="mb-2 text-xs font-bold text-slate-500">{{ $t('views.lapian.versions') }}</h3>
        <div v-if="notFound || !versions.length" class="glass p-4 text-center text-xs text-slate-500">
          {{ $t('views.lapian.noVersions1') }}<br />{{ $t('views.lapian.noVersions2') }}
        </div>
        <div v-else class="relative space-y-2 pl-4">
          <div class="absolute bottom-2 left-[5px] top-2 w-px bg-gradient-to-b from-fuchsia-500/60 to-cyan-500/40"></div>
          <button
            v-for="v in versions"
            :key="v.name"
            class="glass relative block w-full p-3 text-left transition hover:border-fuchsia-400/40"
            :class="{ 'ring-1 ring-fuchsia-400/60': currentName === v.name }"
            :style="{ '--glow': 'rgba(232,121,249,0.35)' }"
            @click="loadVersion(v.name)"
          >
            <span class="absolute -left-[15.5px] top-4 h-2.5 w-2.5 rounded-full border-2 border-base" :style="{ background: v.engine === 'ai' ? '#e879f9' : '#22d3ee' }"></span>
            <div class="flex items-center justify-between gap-2">
              <span class="truncate text-sm font-bold text-slate-100">{{ v.name }}</span>
              <span
                class="shrink-0 rounded-full px-1.5 py-0.5 text-2xs font-bold text-slate-950"
                :style="{ background: engineColor(v.engine) }"
              >{{ v.engine || 'cut' }}</span>
            </div>
            <div class="mt-1 text-2xs text-slate-500">
              {{ v.created_at || '' }} · {{ $t('common.shots', { n: v.shot_count ?? '?' }) }}
              <template v-if="v.first_t !== undefined && v.last_t !== undefined">
                · {{ fmtT(v.first_t) }}–{{ fmtT(v.last_t) }}
              </template>
            </div>
            <div v-if="v.note" class="mt-1 truncate text-2xs text-fuchsia-300/70">{{ v.note }}</div>
            <button
              class="btn-danger absolute bottom-2 right-2 rounded-md p-0.5 transition"
              :title="$t('views.lapian.deleteVersion')"
              @click.stop="removeVersion(v.name)"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path :d="icons.trash" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </button>
        </div>
      </aside>

      <!-- 主区 -->
      <section class="min-w-0 flex-1">
        <div v-if="loading" class="glass p-10 text-center text-sm text-slate-500">{{ $t('views.lapian.loading') }}</div>

        <div v-else-if="!analysis" class="glass p-12 text-center">
          <svg class="mx-auto mb-3 opacity-40" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#e879f9" stroke-width="1.5"><path :d="icons.clapper" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <p class="text-sm text-slate-300">{{ $t('views.lapian.nothingLoaded') }}</p>
          <p class="mt-2 text-xs leading-relaxed text-slate-500">
            {{ $t('views.lapian.guide1') }}<br />
            {{ $t('views.lapian.guide2') }}<br />
            {{ $t('views.lapian.guide3') }}
          </p>
        </div>

        <template v-else>
          <!-- 操作条 -->
          <div class="mb-4 flex items-center gap-2">
            <span class="pop-in rounded-lg bg-fuchsia-400/10 px-3 py-1.5 text-sm font-bold text-fuchsia-300">{{ currentName }}</span>
            <span class="text-xs text-slate-500">{{ $t('views.lapian.shotsEngine', { n: shots.length, engine: analysis.engine || 'cut' }) }}</span>
            <span v-if="dirty" class="pop-in rounded-full bg-amber-400/15 px-2 py-0.5 text-2xs font-bold text-amber-300">{{ $t('views.lapian.dirty') }}</span>
            <div class="flex-1"></div>
            <button class="btn btn-ghost btn-sm" @click="exportMd">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path :d="icons.download" stroke-linecap="round" stroke-linejoin="round"/></svg>
              {{ $t('views.lapian.exportMd') }}
            </button>
            <button class="btn btn-ghost btn-sm" :disabled="exportingXlsx" @click="exportXlsx">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path :d="icons.download" stroke-linecap="round" stroke-linejoin="round"/></svg>
              {{ exportingXlsx ? $t('views.lapian.exporting') : $t('views.lapian.exportXlsx') }}
            </button>
            <button class="btn btn-ghost btn-sm" @click="regeneratePlus">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path :d="icons.refresh" stroke-linecap="round" stroke-linejoin="round"/></svg>
              {{ $t('views.lapian.regenPlus') }}
            </button>
            <button class="btn btn-sm" :disabled="!dirty" @click="save">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path :d="icons.save" stroke-linecap="round" stroke-linejoin="round"/></svg>
              {{ $t('views.lapian.saveChanges') }}
            </button>
          </div>

          <!-- 二级页签：镜头编辑 / 白模分镜 JSON / 分镜脚本 xlsx / analysis.md -->
          <div class="mb-4 flex flex-wrap items-center gap-1 border-b border-line">
            <button
              v-for="t in VIEW_TABS"
              :key="t.key"
              class="rounded-t-lg px-3 py-1.5 text-xs font-bold transition"
              :class="viewTab === t.key ? 'chip-active' : 'chip'"
              @click="viewTab = t.key"
            >{{ $t('views.lapian.tab.' + t.key) }}</button>
            <span class="flex-1"></span>
            <button
              v-if="whiteBoard"
              class="btn btn-ghost btn-sm mb-1"
              :title="$t('views.lapian.regenWhiteTitle')"
              :disabled="genWhiteBusy"
              @click="genWhiteBoard"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path :d="icons.refresh" stroke-linecap="round" stroke-linejoin="round"/></svg>
              {{ genWhiteBusy ? $t('common.generating') : $t('views.lapian.regenWhite') }}
            </button>
            <button
              v-if="whiteBoard"
              class="btn btn-sm mb-1"
              :title="$t('views.lapian.linkedBoard', { name: whiteBoard })"
              @click="goWhite"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path :d="icons.cube" stroke-linecap="round" stroke-linejoin="round"/></svg>
              {{ $t('views.lapian.goRender') }}
            </button>
            <button
              v-else
              class="btn btn-sm mb-1"
              :title="$t('views.lapian.genWhiteTitle')"
              :disabled="genWhiteBusy"
              @click="genWhiteBoard"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path :d="icons.cube" stroke-linecap="round" stroke-linejoin="round"/></svg>
              {{ genWhiteBusy ? $t('common.generating') : $t('views.lapian.genWhite') }}
            </button>
          </div>

          <!-- 页签：白模分镜 JSON（分镜/<版本名>.json 在线看） -->
          <div v-if="viewTab === 'json'">
            <div v-if="!whiteBoard" class="glass p-10 text-center">
              <p class="text-sm text-slate-300">{{ $t('views.lapian.noWhite') }}</p>
              <p class="mt-2 text-xs text-slate-500">{{ $t('views.lapian.noWhiteHint', { name: currentName }) }}</p>
            </div>
            <div v-else-if="wbJsonLoading" class="glass p-10 text-center text-sm text-slate-500">{{ $t('views.lapian.readingJson') }}</div>
            <template v-else-if="wbJson">
              <div class="glass mb-3 flex flex-wrap items-center gap-3 p-3">
                <div class="min-w-0">
                  <p class="truncate text-sm font-bold text-slate-200">{{ wbJson.title || whiteBoard }}</p>
                  <p class="mt-0.5 text-2xs text-slate-500">
                    分镜/{{ whiteBoard }} · {{ wbJson.w }}×{{ wbJson.h }} @{{ wbJson.fps }}fps ·
                    {{ $t('views.lapian.jsonMeta', { shots: wbJson.shots?.length || 0, lines: wbShotLines }) }}
                  </p>
                </div>
                <div class="flex flex-wrap items-center gap-1.5">
                  <span
                    v-for="a in wbActors"
                    :key="a.aid"
                    class="flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-2xs text-slate-300"
                    :title="`actor id: ${a.aid}`"
                  >
                    <i class="h-2 w-2 rounded-full" :style="{ background: a.color }"></i>{{ a.name }}
                  </span>
                </div>
                <span class="flex-1"></span>
                <button class="btn btn-ghost btn-sm" @click="wbJsonRaw = !wbJsonRaw">{{ wbJsonRaw ? $t('views.lapian.tableView') : $t('views.lapian.rawJson') }}</button>
              </div>
              <pre v-if="wbJsonRaw" class="glass max-h-[32rem] overflow-auto p-4 text-xs-plus leading-relaxed text-slate-300">{{ JSON.stringify(wbJson, null, 1) }}</pre>
              <div v-else class="glass max-h-[32rem] overflow-auto px-2 pb-2">
                <table class="tbl-view">
                  <thead>
                    <tr>
                      <th>{{ $t('views.lapian.col.id') }}</th>
                      <th>{{ $t('views.lapian.col.dur') }}</th>
                      <th>{{ $t('views.lapian.col.cam') }}</th>
                      <th>{{ $t('views.lapian.col.move') }}</th>
                      <th>{{ $t('views.lapian.col.lines') }}</th>
                      <th>{{ $t('views.lapian.col.action') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="s in wbJson.shots" :key="s.id">
                      <td class="font-black text-sky-300">{{ s.id }}</td>
                      <td class="tabular-nums text-slate-400">{{ (s.dur || 0).toFixed(1) }}s</td>
                      <td class="text-slate-400">{{ camLabel(s.cam) }}</td>
                      <td class="whitespace-nowrap text-slate-500">{{ vocab('cameraMove', s.move) || '—' }}</td>
                      <td>
                        <div v-for="(L, li) in (s.lines || []).slice(0, 3)" :key="li" class="truncate" :style="{ color: wbActorColor(L.speaker) }">
                          【{{ wbActorName(L.speaker) || '?' }}】{{ L.line }}
                        </div>
                        <span v-if="(s.lines || []).length > 3" class="text-2xs text-slate-500">{{ $t('views.lapian.moreLines', { n: (s.lines || []).length }) }}</span>
                      </td>
                      <td class="max-w-56 text-slate-500"><span class="line-clamp-2">{{ s.action || '—' }}</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </div>

          <!-- 页签：分镜脚本 xlsx 在线看 -->
          <div v-if="viewTab === 'xlsx'">
            <div v-if="xlsxLoading" class="glass p-10 text-center text-sm text-slate-500">{{ $t('views.lapian.readingXlsx') }}</div>
            <template v-else-if="xlsxSheets">
              <div v-for="sh in xlsxSheets" :key="sh.title" class="mb-4">
                <h4 class="mb-1.5 text-xs font-bold text-slate-400">
                  {{ sh.title }} <span class="font-normal text-slate-500">{{ $t('views.lapian.rows', { n: Math.max(0, sh.rows.length - 1) }) }}</span>
                </h4>
                <div class="glass max-h-[28rem] overflow-auto px-2 pb-2">
                  <table class="tbl-view">
                    <thead>
                      <tr>
                        <th v-for="(c, ci) in sh.rows[0] || []" :key="ci" class="whitespace-normal">{{ c }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(row, ri) in sh.rows.slice(1)" :key="ri">
                        <td v-for="(c, ci) in row" :key="ci" class="max-w-64 text-slate-300"><span class="line-clamp-2">{{ c }}</span></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </template>
          </div>

          <!-- 页签：analysis.md 在线看 -->
          <div v-if="viewTab === 'md'">
            <div v-if="mdLoading" class="glass p-10 text-center text-sm text-slate-500">{{ $t('views.lapian.readingMd') }}</div>
            <pre v-else-if="mdText" class="glass max-h-[32rem] overflow-auto whitespace-pre-wrap p-4 text-xs-plus leading-relaxed text-slate-300">{{ mdText }}</pre>
            <div v-else class="glass p-10 text-center text-sm text-slate-500">{{ $t('views.lapian.mdNotFound') }}</div>
          </div>

          <!-- 页签：镜头编辑（原有内容） -->
          <div v-show="viewTab === 'edit'">
          <div v-if="isNoAiVersion" class="mb-4 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
            {{ $t('views.lapian.noAiNote') }}
          </div>

          <!-- 镜头表格 -->
          <div class="space-y-3">
            <article
              v-for="(shot, si) in shots"
              :id="`shot-${shot.id || si}`"
              :key="shot.id || si"
              class="glass glass-hover p-4"
              :class="{ 'opacity-60': shotEmpty(shot) }"
              :style="{ '--glow': 'rgba(232,121,249,0.3)' }"
            >
              <div class="flex flex-wrap gap-4">
                <!-- 关键帧（竖排，给右侧字段让出宽度） -->
                <div class="flex shrink-0 flex-col gap-1.5">
                  <button
                    v-for="(kf, ki) in (shot.keyframes || []).slice(0, 3)"
                    :key="ki"
                    class="group/kf relative h-16 w-28 overflow-hidden rounded-lg border border-line"
                    @click="openKf(shot, ki)"
                  >
                    <img :src="kfUrl(shot, kf)" class="h-full w-full object-cover transition-transform duration-300 group-hover/kf:scale-110" loading="lazy" :alt="$t('views.lapian.kfAlt')" />
                    <span class="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover/kf:bg-black/30 group-hover/kf:opacity-100">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path :d="icons.play" stroke-linejoin="round"/></svg>
                    </span>
                  </button>
                  <div v-if="!(shot.keyframes || []).length" class="flex h-16 w-28 items-center justify-center rounded-lg border border-dashed border-line text-2xs text-slate-500">{{ $t('views.lapian.noKf') }}</div>
                </div>

                <!-- 字段 -->
                <div class="min-w-0 flex-1">
                  <div class="mb-2 flex flex-wrap items-center gap-2">
                    <span class="rounded-md bg-white/5 px-2 py-0.5 text-xs font-black tracking-wider text-fuchsia-300">{{ shot.id || 'S' + (si + 1) }}</span>
                    <span class="tabular-nums text-xs font-semibold text-cyan-300">{{ fmtT(shot.t_in) }} – {{ fmtT(shot.t_out) }}</span>
                    <span class="text-2xs text-slate-500">{{ $t('views.lapian.durS', { d: (shot.duration ?? (shot.t_out - shot.t_in)).toFixed(1) }) }}</span>
                    <span v-if="shotEmpty(shot)" class="rounded-full bg-slate-500/15 px-2 py-0.5 text-2xs font-bold text-slate-500">{{ $t('views.lapian.pending') }}</span>
                    <span v-if="shotEmpty(shot)" class="text-2xs text-slate-500">{{ $t('views.lapian.reshotHint') }}</span>
                    <span class="flex-1"></span>
                    <button
                      class="shrink-0 text-slate-500 transition hover:text-cyan-300"
                      :class="{ 'animate-spin': reshotBusy[shot.id || ''] }"
                      :disabled="reshotBusy[shot.id || '']"
                      :title="$t('views.lapian.reshotTitle')"
                      @click="reshotOne(shot)"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path :d="icons.wand" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                  </div>

                  <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <label class="text-2xs text-slate-500">
                      {{ $t('views.lapian.f.size') }}
                      <StyledSelect v-model="shot.shot_size" class="mt-0.5" :options="SHOT_SIZES" :labels="vocabLabels('shotSize', SHOT_SIZES)" @change="markDirty" />
                    </label>
                    <label class="text-2xs text-slate-500">
                      {{ $t('views.lapian.f.move') }}
                      <StyledSelect v-model="shot.camera_move" class="mt-0.5" :options="CAMERA_MOVES" :labels="vocabLabels('cameraMove', CAMERA_MOVES)" @change="markDirty" />
                    </label>
                    <label class="text-2xs text-slate-500">
                      {{ $t('views.lapian.f.angle') }}
                      <StyledSelect v-model="shot.angle" class="mt-0.5" :options="ANGLES" :labels="vocabLabels('angle', ANGLES)" @change="markDirty" />
                    </label>
                    <label class="text-2xs text-slate-500">
                      {{ $t('views.lapian.f.transition') }}
                      <StyledSelect v-model="shot.transition" class="mt-0.5" :options="TRANSITIONS" :labels="vocabLabels('transition', TRANSITIONS)" :placeholder="vocab('transition', '无')" @change="markDirty" />
                    </label>
                  </div>

                  <div class="mt-2 grid grid-cols-1 gap-2">
                    <label class="text-2xs text-slate-500">
                      {{ $t('views.lapian.f.lighting') }}
                      <input v-model="shot.lighting" class="input mt-0.5" :placeholder="$t('views.lapian.lightingPh')" @input="markDirty" />
                    </label>
                    <label class="text-2xs text-slate-500">
                      {{ $t('views.lapian.f.action') }}
                      <textarea v-model="shot.action" class="textarea mt-0.5" rows="2" :placeholder="$t('views.lapian.actionPh')" @input="markDirty"></textarea>
                    </label>
                    <label class="text-2xs text-slate-500">
                      {{ $t('views.lapian.f.story') }}
                      <textarea v-model="shot.story" class="textarea mt-0.5" rows="2" :placeholder="$t('views.lapian.storyPh')" @input="markDirty"></textarea>
                    </label>
                    <label class="text-2xs text-slate-500">
                      {{ $t('views.lapian.f.prompt') }}
                      <textarea v-model="shot.prompt_cn" class="textarea mt-0.5" rows="2" :placeholder="$t('views.lapian.promptPh')" @input="markDirty"></textarea>
                    </label>
                  </div>

                  <!-- 台词气泡 -->
                  <div class="mt-2">
                    <div class="mb-1 flex items-center justify-between">
                      <span class="text-2xs text-slate-500">{{ $t('views.lapian.dialogueN', { n: shot.dialogue?.length || 0 }) }}</span>
                      <button class="btn btn-ghost btn-sm" @click="addDialogue(shot)">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path :d="icons.plus" stroke-linecap="round"/></svg>
                        {{ $t('views.lapian.addLine') }}
                      </button>
                    </div>
                    <div v-if="shot.dialogue?.length" class="space-y-1.5">
                      <div
                        v-for="(d, di) in shot.dialogue"
                        :key="d._uid || di"
                        class="flex items-center gap-2 rounded-lg border border-line-soft bg-black/25 p-2"
                      >
                        <span
                          v-if="d.span === 'overlap'"
                          class="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 text-2xs text-amber-300"
                          :title="$t('views.lapian.overlapTitle', { event: d.event || '?' })"
                        >{{ $t('views.lapian.overlap') }}</span>
                        <input v-model="d.speaker" class="input w-20 shrink-0" :title="$t('views.lapian.speakerTitle')" :placeholder="$t('views.lapian.speakerPh')" @input="markDirty" />
                        <input v-model="d.text" class="input flex-1" :placeholder="$t('views.lapian.textPh')" @input="markDirty" />
                        <input
                          v-model.number="d.t_in" type="number" step="0.1" min="0"
                          class="input w-16 shrink-0 tabular-nums" :title="$t('views.lapian.tIn')" @input="markDirty"
                        />
                        <input
                          v-model.number="d.t_out" type="number" step="0.1" min="0"
                          class="input w-16 shrink-0 tabular-nums" :title="$t('views.lapian.tOut')" @input="markDirty"
                        />
                        <button class="btn-danger shrink-0 rounded-md p-0.5 transition" @click="removeDialogue(shot, di)">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path :d="icons.trash" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          </div>
          </div>
        </template>
      </section>
    </div>

    <OverlayViewer
      :images="lbImages"
      :index="lbIndex"
      :visible="lbVisible"
      @close="lbVisible = false"
      @update-index="lbIndex = $event"
    />
  </div>
</template>
