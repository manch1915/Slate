<script setup lang="ts">
import { t } from '../i18n'
// -*- coding: utf-8 -*-
/** 环境：本机运行环境检测（python/ffmpeg/blender/MCP/依赖包） + AI 厂商配置（厂商卡片 + 五能力槽编辑/拉取模型/测试/增删/整体保存）。 */
import { ref, computed, onMounted, watch, onBeforeUnmount } from 'vue'
import {
  fetchEnv, fetchEnvConfig, saveEnvConfig, testProvider, fetchEnvModels, fetchComfyWorkflows,
  MODEL_SLOTS, type EnvInfo, type Vendor, type ModelSlot, type TestResult
} from '../api'
import { toast } from '../stores/app'
import { fetchStudioSettings, saveStudioSettings } from '../utils/productionStudio'
import StyledSelect from '../components/StyledSelect.vue'
import EnvironmentInstaller from '../components/EnvironmentInstaller.vue'
import ChromeUseEnvironment from '../components/ChromeUseEnvironment.vue'
import MediaGatewayEnvironment from '../components/MediaGatewayEnvironment.vue'
import { icons } from '../components/icons'
import { visibleVendors } from '../utils/providerVisibility'

const GLOW = 'rgba(245,158,11,0.35)'

const emptyModels = (): Record<ModelSlot, string> => ({ text: '', vision: '', image: '', image_edit: '', video: '', music: '', speech: '' })

/** 豆包 Agent Plan 语音：独立 Key 可选；端点与 Resource-Id 固定在后端。 */
const SPEECH_EXTRA_KEYS = computed(() => [
  { key: 'speech_api_key', label: t('views.env.speechKey'), secret: true, ph: t('views.env.speechKeyPh') }
] as const)
const extraDrafts = ref<Record<string, Record<string, string>>>({})
const hasSpeechExtra = (v: Vendor) => v.id === 'doubao'

/* ---------- 单价配置（用量计费；随「保存全部」走 saveEnvConfig 落盘） ---------- */
const pricingOpen = ref<Record<string, boolean>>({})
/** 可配价的能力槽与字段：text/vision=每百万 token 输入/输出；image/image_edit=每张；video=每秒；speech/music=每次 */
const PRICING_FIELDS: Record<ModelSlot, string[]> = {
  text: ['input', 'output'], vision: ['input', 'output'], image: ['per_image'], image_edit: ['per_image'],
  video: ['per_second'], speech: ['per_call'], music: ['per_call']
}
const PRICING_SLOTS = computed<{ key: ModelSlot; label: string; fields: { f: string; label: string }[] }[]>(() =>
  (Object.keys(PRICING_FIELDS) as ModelSlot[]).map((key) => ({
    key, label: t('api.slot.' + key),
    fields: PRICING_FIELDS[key].map((f) => ({ f, label: t('views.env.price.' + f) }))
  })))
/** 只给已填模型的能力槽渲染价格输入。 */
const pricingSlotsOf = (v: Vendor) => PRICING_SLOTS.value.filter((s) => (v.models?.[s.key] || '').trim() !== '')
/** 读价：优先当前模型名键，回落 "*" 通配键。 */
function pricingVal(v: Vendor, kind: ModelSlot, field: string): string {
  const table = (v.pricing as Record<string, Record<string, Record<string, number>>> | undefined)?.[kind]
  if (!table) return ''
  const model = (v.models?.[kind] || '').trim()
  const val = (model && table[model]?.[field]) ?? table['*']?.[field]
  return val === undefined || val === null ? '' : String(val)
}
/** 写价：以当前槽位模型名为键；清空即删除该字段（服务端空 pricing 不清旧值）。 */
function setPricingVal(v: Vendor, kind: ModelSlot, field: string, raw: string) {
  const model = (v.models?.[kind] || '').trim() || '*'
  const pricing = (v.pricing ??= {}) as unknown as Record<string, Record<string, Record<string, number>>>
  const table = (pricing[kind] ??= {})
  const rate = (table[model] ??= {})
  const n = parseFloat(raw)
  if (raw.trim() === '' || Number.isNaN(n)) {
    delete rate[field]
    if (!Object.keys(rate).length) delete table[model]
  } else {
    rate[field] = n
  }
}

/* ---------- 本机环境 ---------- */
const env = ref<EnvInfo | null>(null)
const detecting = ref(false)
/* 制作默认：V 分组目标生成时长（8/15/30s），分组合法性与主流模型提交能力对齐 */
const defaultDuration = ref(15)
const durationSaving = ref(false)
async function loadStudioSettings() { try { defaultDuration.value = (await fetchStudioSettings()).default_video_duration } catch { /* 保持默认 */ } }
async function saveDuration() {
  durationSaving.value = true
  try { const r = await saveStudioSettings({ default_video_duration: Number(defaultDuration.value) }); defaultDuration.value = r.default_video_duration; toast(t('views.env.studioSaved'), 'ok') }
  catch (e) { toast(e instanceof Error ? e.message : t('common.saveFailed'), 'err') }
  finally { durationSaving.value = false }
}

async function detect() {
  detecting.value = true
  try {
    env.value = await fetchEnv()
  } catch {
    toast(t('views.env.detectFailed'), 'err')
  } finally {
    detecting.value = false
  }
}

const pkgList = computed(() => Object.entries(env.value?.packages || {}))

/* ---------- 厂商 ---------- */
const vendors = ref<Vendor[]>([])
const displayedVendors = computed(() => visibleVendors(vendors.value))
const loadingConfig = ref(false)
const expanded = ref('')
const keyDrafts = ref<Record<string, string>>({})
const testing = ref<Record<string, boolean>>({})
const testResults = ref<Record<string, { ok: boolean; text: string }>>({})
const saving = ref(false)

/** ComfyUI 生图 API 工作流清单；视频 H3 使用内置工作流，不从这里选择。 */
const comfyWorkflows = ref<{ path: string; name: string; refs?: number[]; has_negative?: boolean; has_save_image?: boolean; error?: string }[]>([])
const loadingComfyWorkflows = ref(false)
const comfyWorkflowMsg = ref('')

async function loadComfyWorkflows() {
  loadingComfyWorkflows.value = true
  try {
    const r = await fetchComfyWorkflows()
    comfyWorkflows.value = r.workflows || []
    comfyWorkflowMsg.value = r.err || ''
  } catch (e) {
    comfyWorkflowMsg.value = e instanceof Error ? e.message : t('views.env.wfFailed')
  } finally {
    loadingComfyWorkflows.value = false
  }
}
/** 新增厂商弹窗 */
const addVisible = ref(false)
const addForm = ref({ id: '', label: '', base_url: '' })

/** 每卡原始快照（id → 规范化 JSON），用于「未保存」徽标；新增卡无快照 = 未保存。 */
const pristineMap = ref<Record<string, string>>({})
const pristineListSig = ref('')

const dirty = computed(() => JSON.stringify(canonical(vendors.value)) !== pristineListSig.value)
const autoSaveNote = ref('')
let autoSaveTimer: ReturnType<typeof setTimeout> | undefined
function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  if (loadingConfig.value || !dirty.value) return
  autoSaveNote.value = t('views.env.autoPending')
  autoSaveTimer = setTimeout(autoSave, 800)
}
async function autoSave() {
  if (loadingConfig.value || !dirty.value) return
  if (saving.value) { scheduleAutoSave(); return }
  const signature = JSON.stringify(canonical(vendors.value))
  const payload = JSON.parse(signature) as Vendor[]
  saving.value = true
  autoSaveNote.value = t('common.saving')
  let succeeded = false
  try {
    await saveEnvConfig(payload)
    pristineListSig.value = signature
    pristineMap.value = Object.fromEntries(payload.map(v => [v.id, JSON.stringify(v)]))
    autoSaveNote.value = t('views.env.autoSaved')
    succeeded = true
  } catch (e) { autoSaveNote.value = t('views.env.autoFailed', { err: e instanceof Error ? e.message : t('views.env.retry') }) }
  finally { saving.value = false }
  if (succeeded && dirty.value) scheduleAutoSave()
}
watch(() => JSON.stringify(canonical(vendors.value)), scheduleAutoSave)
onBeforeUnmount(() => { if (autoSaveTimer) clearTimeout(autoSaveTimer); void autoSave() })

/** 比较/提交用规范化：api_key 以草稿为准（空 = 保留旧值）；models 五键补全；
 *  extra 密钥类取草稿（空 = 保留，绝不回传掩码），非密钥类取卡片当前值（可清空）。 */
function canonical(list: Vendor[]): unknown[] {
  return list.map((v) => ({
    ...v,
    api_key: keyDrafts.value[v.id] ?? '',
    base_url: v.base_url ?? '',
    note: v.note ?? '',
    models: { ...emptyModels(), ...(v.models || {}) },
    extra: hasSpeechExtra(v)
      ? { ...(v.extra || {}), speech_api_key: extraDrafts.value[v.id]?.speech_api_key ?? '' }
      : v.extra
  }))
}

function cardCanonical(v: Vendor): unknown {
  return canonical([v])[0]
}

/** 单卡是否有未保存改动。 */
function cardDirty(v: Vendor): boolean {
  return pristineMap.value[v.id] !== JSON.stringify(cardCanonical(v))
}

/** 卡片当前草稿：测试/拉取用未落盘值；api_key 没动过传空串，后端回落已落盘 key。 */
function draftOf(v: Vendor) {
  return {
    base_url: v.base_url ?? '',
    api_key: keyDrafts.value[v.id] ?? '',
    models: { ...emptyModels(), ...(v.models || {}) }, endpoints: v.endpoints || {}, extra: v.extra || {}
  }
}

async function loadConfig() {
  loadingConfig.value = true
  try {
    const r = await fetchEnvConfig({ includeHidden: true })
    vendors.value = (r.vendors || []).map((v) => ({
      ...v,
      models: { ...emptyModels(), ...(v.models || {}) },
      extra: { ...(v.extra || {}) }
    }))
    keyDrafts.value = {}
    extraDrafts.value = {}
    // 快照须在 keyDrafts 清空后取（草稿为空串 ≡ 保留旧 key）
    pristineListSig.value = JSON.stringify(canonical(vendors.value))
    pristineMap.value = Object.fromEntries(vendors.value.map((v) => [v.id, JSON.stringify(cardCanonical(v))]))
  } catch {
    toast(t('views.env.vendorsFailed'), 'err')
  } finally {
    loadingConfig.value = false
  }
}

function toggleExpand(id: string) {
  expanded.value = expanded.value === id ? '' : id
}

function openAdd() {
  addForm.value = { id: '', label: '', base_url: '' }
  addVisible.value = true
}

function submitAdd() {
  const id = addForm.value.id.trim()
  if (!id) {
    toast(t('views.env.needId'), 'err')
    return
  }
  if (vendors.value.some((v) => v.id === id)) {
    toast(t('views.env.idExists'), 'err')
    return
  }
  vendors.value.unshift({
    id,
    label: addForm.value.label.trim() || id,
    base_url: addForm.value.base_url.trim(),
    api_key: '',
    enabled: true,
    models: emptyModels(),
    extra: id === 'local-comfyui' ? { workflow_path: '', image_edit_workflow_path: '' } : undefined
  })
  keyDrafts.value[id] = ''
  addVisible.value = false
  expanded.value = id
  toast(t('views.env.added'), 'ok')
}

function removeVendor(v: Vendor) {
  if (!confirm(t('views.env.deleteConfirm', { name: v.label || v.id }))) return
  vendors.value = vendors.value.filter((x) => x.id !== v.id)
  delete keyDrafts.value[v.id]
  delete extraDrafts.value[v.id]
}

async function submitAll(fromCard: boolean) {
  saving.value = true
  try {
    await saveEnvConfig(canonical(vendors.value) as Vendor[])
    toast(fromCard ? t('views.env.savedAll') : t('views.env.vendorsSaved'), 'ok')
    await loadConfig()
  } catch (e) {
    toast(e instanceof Error ? e.message : t('common.saveFailed'), 'err')
  } finally {
    saving.value = false
  }
}

const saveAll = () => submitAll(false)
/** 卡片「保存」：语义是保存此厂商，实现走全量提交（接口无单卡保存）。 */
const saveCard = () => submitAll(true)

/** 测试用 kind：卡片当前已填模型中 vision→text→image→video→music 第一个非空槽。 */
function primaryKind(v: Vendor): ModelSlot | undefined {
  const order: ModelSlot[] = ['vision', 'text', 'image', 'image_edit', 'video', 'music', 'speech']
  return order.find((k) => (v.models?.[k] || '').trim() !== '')
}

async function test(v: Vendor) {
  testing.value[v.id] = true
  testResults.value[v.id] = { ok: false, text: t('views.env.testing') }
  const t0 = Date.now()
  try {
    const r: TestResult = await testProvider({ id: v.id, kind: primaryKind(v), draft: draftOf(v) })
    if (r.ok) {
      const ms = r.latency_ms ?? Date.now() - t0
      testResults.value[v.id] = { ok: true, text: r.note ? t('views.env.testPassed', { note: r.note }) : t('views.env.connected', { ms }) }
    } else {
      testResults.value[v.id] = { ok: false, text: r.err || r.note || t('views.env.connFailed') }
    }
  } catch (e) {
    testResults.value[v.id] = { ok: false, text: e instanceof Error ? e.message : t('views.env.testReqFailed') }
  } finally {
    testing.value[v.id] = false
  }
}

/* ---------- 拉取模型（每能力槽一个按钮，结果全卡共享 datalist） ---------- */
const modelsMap = ref<Record<string, string[]>>({})
const fetchingModels = ref<Record<string, boolean>>({})
const modelMsgs = ref<Record<string, { ok: boolean; text: string }>>({})

async function fetchModels(v: Vendor, slot: ModelSlot) {
  fetchingModels.value[v.id] = true
  modelMsgs.value[v.id] = { ok: true, text: t('views.env.fetching', { slot: MODEL_SLOTS.find((s) => s.key === slot)?.label || slot }) }
  try {
    const d = draftOf(v)
    const r = await fetchEnvModels({ id: v.id, draft: { base_url: d.base_url, api_key: d.api_key } })
    if (r.ok && r.models?.length) {
      modelsMap.value[v.id] = r.models
      modelMsgs.value[v.id] = { ok: true, text: t('views.env.fetched', { n: r.models.length }) }
      toast(t('views.env.fetchedToast', { n: r.models.length }), 'ok')
    } else {
      modelMsgs.value[v.id] = { ok: false, text: r.err || t('views.env.noModels') }
    }
  } catch (e) {
    modelMsgs.value[v.id] = { ok: false, text: e instanceof Error ? e.message : t('views.env.fetchFailed') }
  } finally {
    fetchingModels.value[v.id] = false
  }
}

onMounted(() => {
  void loadStudioSettings()
  detect()
  loadConfig()
  loadComfyWorkflows()
})
</script>

<template>
  <div class="page">
    <header class="mb-6">
      <h1 class="grad-text text-2xl font-black">{{ $t('nav.env') }}</h1>
      <p class="mt-1 text-xs text-slate-500">{{ $t('views.env.lead') }}</p>
    </header>

    <ChromeUseEnvironment />
    <MediaGatewayEnvironment />

    <EnvironmentInstaller @installed="detect" />
    <!-- 制作默认：V 分组目标生成时长 -->
    <section class="glass mb-5 p-5" :style="{ '--glow': 'rgba(251,191,36,0.22)' }">
      <div class="mb-3 flex items-center gap-2">
        <h3 class="text-xs font-bold tracking-wider text-slate-500">{{ $t('views.env.studioDefaults') }}</h3>
      </div>
      <div class="flex flex-wrap items-end gap-3">
        <label class="text-[10px] text-slate-500">{{ $t('views.env.defaultDuration') }}
          <select v-model.number="defaultDuration" class="input mt-1 w-36">
            <option :value="8">{{ $t('views.env.d8') }}</option>
            <option :value="15">{{ $t('views.env.d15') }}</option>
            <option :value="30">{{ $t('views.env.d30') }}</option>
          </select>
        </label>
        <button class="btn" :disabled="durationSaving" @click="saveDuration">{{ durationSaving ? $t('common.saving') : $t('common.save') }}</button>
        <p class="flex-1 text-[10px] leading-relaxed text-slate-500">{{ $t('views.env.durationHint') }}</p>
      </div>
    </section>

    <!-- 上半：本机环境 -->
    <section class="glass mb-5 p-5" :style="{ '--glow': GLOW }">
      <div class="mb-4 flex items-center gap-2">
        <h3 class="text-xs font-bold text-slate-500">{{ $t('views.env.localEnv') }}</h3>
        <div class="flex-1"></div>
        <button class="btn btn-ghost btn-sm" :disabled="detecting" @click="detect">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path :d="icons.refresh" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          {{ detecting ? $t('views.blender.detecting') : $t('views.blender.redetect') }}
        </button>
      </div>

      <div v-if="!env && detecting" class="p-10 text-center text-sm text-slate-500">{{ $t('views.blender.detecting') }}</div>
      <div v-else-if="!env" class="p-10 text-center text-sm text-slate-500">{{ $t('views.env.envUnavailable') }}</div>

      <template v-else>
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <!-- Python -->
          <div class="rounded-xl border border-line-soft bg-black/25 p-3">
            <div class="mb-1 text-2xs tracking-wider text-slate-500">PYTHON</div>
            <div class="flex items-center gap-2">
              <span class="h-2 w-2 rounded-full" :class="env.python ? 'bg-emerald-400' : 'bg-rose-400'"></span>
              <span class="text-sm font-bold text-slate-100">{{ env.python || $t('views.env.notFound') }}</span>
            </div>
          </div>
          <!-- ffmpeg -->
          <div class="rounded-xl border border-line-soft bg-black/25 p-3">
            <div class="mb-1 text-2xs tracking-wider text-slate-500">FFMPEG</div>
            <div class="flex items-center gap-2">
              <span class="h-2 w-2 rounded-full" :class="env.ffmpeg ? 'bg-emerald-400' : 'bg-rose-400'"></span>
              <span class="truncate text-xs text-slate-300" :title="env.ffmpeg || ''">{{ env.ffmpeg || $t('views.env.notFound') }}</span>
            </div>
          </div>
          <!-- Blender -->
          <div class="rounded-xl border border-line-soft bg-black/25 p-3">
            <div class="mb-1 text-2xs tracking-wider text-slate-500">BLENDER</div>
            <div class="flex items-center gap-2">
              <span class="h-2 w-2 rounded-full" :class="env.blender ? 'bg-emerald-400' : 'bg-rose-400'"></span>
              <span class="truncate text-xs text-slate-300" :title="env.blender || ''">{{ env.blender || $t('views.env.notFound') }}</span>
            </div>
          </div>
          <!-- Blender MCP -->
          <div class="rounded-xl border border-line-soft bg-black/25 p-3">
            <div class="mb-1 text-2xs tracking-wider text-slate-500">BLENDER MCP</div>
            <div class="flex items-center gap-2">
              <span class="h-2 w-2 rounded-full" :class="env.mcp ? 'bg-emerald-400 pulse-dot' : 'bg-rose-400'"></span>
              <span class="text-sm font-bold" :class="env.mcp ? 'text-emerald-300' : 'text-rose-300'">
                {{ env.mcp ? $t('views.blender.online') : $t('views.blender.offline') }}
              </span>
              <span class="text-2xs text-slate-500">127.0.0.1:9876</span>
            </div>
          </div>
        </div>

        <!-- 依赖包 -->
        <h4 class="mb-2 mt-4 text-2xs font-bold text-slate-500">{{ $t('views.env.pyDeps') }}</h4>
        <div class="overflow-hidden rounded-xl border border-line-soft">
          <table class="w-full text-left text-xs">
            <thead>
              <tr class="bg-white/5 text-slate-500">
                <th class="px-3 py-2 font-semibold">{{ $t('views.env.pkg') }}</th>
                <th class="px-3 py-2 font-semibold">{{ $t('views.env.status') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="[name, ver] in pkgList" :key="name" class="border-t border-line-soft bg-black/20">
                <td class="px-3 py-1.5 font-mono text-slate-300">{{ name }}</td>
                <td class="px-3 py-1.5">
                  <span
                    v-if="ver !== $t('views.env.missing')"
                    class="rounded-full bg-emerald-400/10 px-2 py-0.5 font-semibold text-emerald-300"
                  >{{ ver }}</span>
                  <span v-else class="rounded-full bg-rose-400/10 px-2 py-0.5 font-semibold text-rose-300">{{ $t('views.env.missing') }}</span>
                </td>
              </tr>
              <tr v-if="!pkgList.length" class="border-t border-line-soft bg-black/20">
                <td colspan="2" class="px-3 py-3 text-center text-slate-500">{{ $t('views.env.noDeps') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>

    <!-- 下半：AI 厂商 -->
    <section class="glass p-5" :style="{ '--glow': GLOW }">
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <h3 class="text-xs font-bold text-slate-500">{{ $t('views.env.vendors') }}</h3>
        <span v-if="dirty" class="pop-in rounded-full bg-amber-400/15 px-2 py-0.5 text-2xs font-bold text-amber-300">
          {{ $t('views.env.unsaved') }}
        </span>
        <div class="flex-1"></div>
        <button class="btn btn-ghost btn-sm" @click="openAdd">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path :d="icons.plus" stroke-linecap="round" />
          </svg>
          {{ $t('views.env.addVendor') }}
        </button>
        <button class="btn" :disabled="!dirty || saving" @click="saveAll">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path :d="icons.save" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          {{ saving ? $t('common.saving') : $t('views.env.saveAll') }}
        </button>
      </div>

      <div v-if="loadingConfig" class="p-10 text-center text-sm text-slate-500">{{ $t('views.env.loadingVendors') }}</div>

      <div v-else-if="!vendors.length" class="p-8 text-center">
        <p class="text-sm text-slate-300">{{ $t('views.env.noVendors') }}</p>
        <p class="mt-2 text-xs text-slate-500">{{ $t('views.env.autoNote') }}{{ autoSaveNote }}</p>
      </div>

      <div v-else class="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <article
          v-for="v in displayedVendors"
          :key="v.id"
          class="glass glass-hover p-3"
          :class="{ 'ring-1 ring-amber-400/50': expanded === v.id }"
          :style="{ '--glow': GLOW }"
        >
          <!-- 卡片头 -->
          <div class="flex cursor-pointer items-center gap-2.5" @click="toggleExpand(v.id)">
            <span
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-950"
              style="background: linear-gradient(130deg, #f59e0b, #fbbf24)"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path :d="icons.server" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-bold text-slate-100">{{ v.label || v.id }}</div>
              <div class="truncate text-2xs text-slate-500">{{ v.base_url || $t('views.env.noBaseUrl') }}</div>
              <div v-if="v.note" class="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-amber-200/70">{{ v.note }}</div>
            </div>
            <!-- 已配置能力槽小圆点 -->
            <div class="hidden shrink-0 gap-1 sm:flex" :title="$t('views.env.slotsConfigured')">
              <span
                v-for="s in MODEL_SLOTS"
                :key="s.key"
                class="h-2 w-2 rounded-full"
                :style="{ background: v.models?.[s.key] ? s.color : 'rgba(148,163,184,0.2)' }"
              ></span>
            </div>
            <span class="shrink-0 rounded-full px-2 py-0.5 text-2xs font-bold" :class="v.enabled?'bg-emerald-500/20 text-emerald-300':'bg-slate-500/15 text-slate-400'">{{ v.enabled?$t('views.env.enabledDot'):$t('views.env.disabledTag') }}</span>
            <span
              v-if="cardDirty(v)"
              class="pop-in shrink-0 rounded-full bg-amber-400/20 px-2 py-0.5 text-2xs font-bold text-amber-300"
              :title="$t('views.env.dirtyTitle')"
            >{{ $t('views.env.unsavedTag') }}</span>
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"
              class="shrink-0 transition-transform duration-200"
              :class="{ 'rotate-90': expanded === v.id }"
            >
              <path :d="icons.chevronR" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </div>

          <!-- 展开编辑 -->
          <div v-if="expanded === v.id" class="mt-3 space-y-2 border-t border-line-soft pt-3">
            <div class="grid grid-cols-2 gap-2">
              <label class="text-2xs text-slate-500">
                {{ $t('views.env.vendorId') }}
                <input :value="v.id" class="input mt-0.5 font-mono opacity-60" disabled />
              </label>
              <label class="text-2xs text-slate-500">
                {{ $t('views.env.name') }}
                <input v-model="v.label" class="input mt-0.5" :placeholder="$t('views.env.labelPh')" />
              </label>
              <label class="col-span-2 text-2xs text-slate-500">
                Base URL
                <input v-model="v.base_url" class="input mt-0.5 font-mono" placeholder="https://api.example.com" />
              </label>
              <div v-if="v.id === 'local-comfyui'" class="col-span-2 rounded-xl border border-cyan-400/15 bg-cyan-400/5 p-2.5 text-2xs">
                <div class="flex items-center gap-2 text-cyan-200">
                  <span class="font-bold">{{ $t('views.env.comfy') }}</span>
                  <span class="text-2xs text-slate-500">{{ $t('views.env.comfyScope') }}</span>
                  <button class="btn btn-ghost ml-auto !px-2 !py-1 text-2xs" :disabled="loadingComfyWorkflows" @click.stop="loadComfyWorkflows">
                    {{ loadingComfyWorkflows ? $t('views.billing.refreshing') : $t('views.env.refreshList') }}
                  </button>
                </div>
                <label class="mt-2 block text-2xs text-slate-400">{{ $t('views.env.genWf') }}
                  <select v-model="v.extra!.workflow_path" class="input mt-1 w-full font-mono text-2xs">
                    <option value="">{{ $t('views.env.genAuto') }}</option>
                    <option v-for="wf in comfyWorkflows" :key="'gen-'+wf.path" :value="wf.path">
                      {{ wf.path }} · {{ $t('views.env.refSlots', { n: wf.refs?.length || 0 }) }}{{ wf.error ? $t('views.env.fileError') : '' }}
                    </option>
                  </select>
                  <input v-model="v.extra!.workflow_path" class="input mt-1 font-mono text-2xs"
                    :placeholder="$t('views.env.wfPathPh')" />
                </label>
                <label class="mt-2 block text-2xs text-slate-400">{{ $t('views.env.editWf') }}
                  <select v-model="v.extra!.image_edit_workflow_path" class="input mt-1 w-full font-mono text-2xs">
                    <option value="">{{ $t('views.env.editAuto') }}</option>
                    <option v-for="wf in comfyWorkflows" :key="'edit-'+wf.path" :value="wf.path">
                      {{ wf.path }} · {{ $t('views.env.refSlots', { n: wf.refs?.length || 0 }) }}{{ wf.error ? $t('views.env.fileError') : '' }}
                    </option>
                  </select>
                  <input v-model="v.extra!.image_edit_workflow_path" class="input mt-1 font-mono text-2xs"
                    :placeholder="$t('views.env.editWfPh')" />
                </label>
                <p class="mt-1.5 leading-relaxed text-slate-400">
                  <i18n-t keypath="views.env.comfyHowto" tag="span">
                    <template #dir><span class="font-mono text-cyan-300">workbench/workflows</span></template>
                    <template #node><span class="font-mono text-cyan-300">LoadImage.image</span></template>
                    <template #refs><span class="font-mono text-cyan-300">&#123;&#123;ref1&#125;&#125;</span>, <span class="font-mono text-cyan-300">&#123;&#123;ref2&#125;&#125;</span></template>
                    <template #neg><span class="font-mono text-cyan-300">&#123;&#123;negative&#125;&#125;</span></template>
                  </i18n-t>
                </p>
                <p class="mt-1 leading-relaxed text-amber-300/80">
                  {{ $t('views.env.videoSlotNote') }}
                </p>
                <p v-if="comfyWorkflowMsg" class="mt-1 text-rose-300">{{ comfyWorkflowMsg }}</p>
                <p v-if="!loadingComfyWorkflows && !comfyWorkflows.length" class="mt-1 text-amber-300/80">{{ $t('views.env.noWf') }}</p>
              </div>
              <label v-if="v.id !== 'local-comfyui' && v.id !== 'chatgpt-queue'" class="col-span-2 text-2xs text-slate-500">
                API Key
                <input
                  v-model="keyDrafts[v.id]"
                  type="password"
                  class="input mt-0.5 font-mono"
                  :placeholder="v.api_key ? $t('views.env.keySaved', { key: v.api_key }) : 'sk-…'"
                />
              </label>
            </div>

            <p v-if="v.id === 'chatgpt-queue'" class="text-xs text-sky-300"><a href="https://github.com/leeguooooo/image-use" target="_blank" rel="noopener" :title="$t('views.env.imageUseTitle')">{{ $t('components.chromeUse.provider') }}</a> · {{ $t('views.env.serial') }}</p>
              <label v-if="v.models.video && v.extra" class="block text-xs text-slate-400">{{ $t('views.env.videoProfile') }}
                <input v-model="v.extra.video_profile" class="input mt-1" :placeholder="$t('views.env.profilePh')" />
                <span class="text-2xs">{{ $t('views.env.profileNote') }}</span>
              </label>
              <label v-if="v.id === 'minimax'" class="block text-xs text-slate-400">{{ $t('views.env.voiceIdLabel') }}
              <input class="input mt-1" :value="v.extra?.voice_id || ''" :placeholder="$t('views.env.voiceIdPh')" @input="(v.extra ??= {}).voice_id = ($event.target as HTMLInputElement).value" />
            </label>
            <a v-if="v.documentation_url" :href="v.documentation_url" target="_blank" rel="noopener" class="text-xs text-sky-300">{{ $t('views.env.docs') }}</a>
            <!-- 豆包 Agent Plan 语音配置 -->
            <div v-if="hasSpeechExtra(v)" class="rounded-xl border border-amber-400/15 bg-amber-400/5 p-2.5">
              <div class="mb-1.5 text-2xs font-bold text-amber-300">{{ $t('views.env.doubaoSpeech') }}</div>
              <p class="text-2xs leading-relaxed text-slate-400">
                TTS：/api/v3/plan/tts/unidirectional · Resource-Id seed-tts-2.0<br />
                ASR：/api/v3/plan/sauc/bigmodel_nostream · Resource-Id volc.seedasr.sauc.duration
              </p>
              <label v-for="f in SPEECH_EXTRA_KEYS" :key="f.key" class="mt-2 block text-2xs text-slate-500">
                {{ f.label }}
                <input :value="extraDrafts[v.id]?.[f.key] ?? ''" type="password" class="input mt-0.5 font-mono"
                  :placeholder="v.extra?.[f.key] ? $t('views.env.keySavedShort') : f.ph"
                  @input="(extraDrafts[v.id] ??= {})[f.key] = ($event.target as HTMLInputElement).value" />
              </label>
              <p class="mt-1.5 text-2xs text-slate-500">{{ $t('views.env.doubaoFixed') }}</p>
            </div>

            <!-- 六能力槽：生图与改图分开，避免模型/工作流串用 -->
            <div>
              <div class="mb-1 text-2xs text-slate-500">{{ $t('views.env.slotsTitle') }}</div>
              <div class="space-y-1.5">
                <div v-for="s in MODEL_SLOTS" :key="s.key" class="flex items-center gap-1.5">
                  <span
                    class="w-14 shrink-0 rounded-md px-1.5 py-1 text-center text-2xs font-bold"
                    :style="{ color: s.color, background: `${s.color}1a` }"
                  >{{ s.label }}</span>
                  <StyledSelect
                    v-model="v.models[s.key]"
                    class="flex-1"
                    :class="{ 'opacity-50': !v.models[s.key] }"
                    :options="modelsMap[v.id] || []"
                    :placeholder="$t('views.env.notSet')"
                  />
                  <button
                    class="btn btn-ghost shrink-0 !px-2 !py-1.5 text-2xs"
                    :disabled="fetchingModels[v.id]"
                    :title="$t('views.env.fetchTitle')"
                    @click="fetchModels(v, s.key)"
                  >
                    <svg v-if="fetchingModels[v.id]" class="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <path d="M12 3a9 9 0 1 0 9 9" stroke-linecap="round" />
                    </svg>
                    <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path :d="icons.download" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                    {{ $t('views.env.fetch') }}
                  </button>
                </div>
              </div>
              <div
                v-if="modelMsgs[v.id]"
                class="mt-1.5 rounded-lg px-2.5 py-1.5 text-xs-plus font-semibold"
                :class="modelMsgs[v.id].ok ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'"
              >
                {{ modelMsgs[v.id].text }}
              </div>
              <p class="mt-1 text-2xs text-slate-500">{{ $t('views.env.saveNote') }}</p>
              <p v-if="v.id==='doubao'" class="mt-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-200">{{ $t('views.env.doubaoVideo') }}</p>
            </div>

            <!-- 单价配置（用量计费）：按已配置模型的能力槽渲染价格输入 -->
            <div class="rounded-xl border border-line-soft bg-black/20 p-2.5">
              <button class="flex w-full items-center gap-1.5 text-2xs font-bold text-slate-400" @click="pricingOpen[v.id] = !pricingOpen[v.id]">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                  class="transition-transform duration-200" :class="{ 'rotate-90': pricingOpen[v.id] }">
                  <path :d="icons.chevronR" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                {{ $t('views.env.pricing') }}
                <span class="ml-auto font-normal text-slate-600">{{ pricingSlotsOf(v).length ? $t('views.env.priceEmpty') : $t('views.env.modelFirst') }}</span>
              </button>
              <div v-if="pricingOpen[v.id]" class="mt-2 space-y-1.5">
                <label class="block text-2xs text-slate-500">{{ $t('views.env.currency') }}
                  <input :value="v.pricing?.currency || 'CNY'" class="input mt-0.5 w-24"
                    @input="(v.pricing ??= {}).currency = ($event.target as HTMLInputElement).value || 'CNY'" />
                </label>
                <div v-for="s in pricingSlotsOf(v)" :key="s.key" class="flex items-start gap-1.5">
                  <span class="mt-1.5 w-14 shrink-0 rounded-md bg-white/5 px-1.5 py-1 text-center text-2xs font-bold text-slate-300">{{ s.label }}</span>
                  <label v-for="f in s.fields" :key="f.f" class="flex-1 text-2xs text-slate-500">
                    {{ f.label }}
                    <input :value="pricingVal(v, s.key, f.f)" type="number" step="any" min="0" class="input mt-0.5" :placeholder="$t('views.env.noBilling')"
                      @input="setPricingVal(v, s.key, f.f, ($event.target as HTMLInputElement).value)" />
                  </label>
                </div>
                <p class="text-2xs leading-relaxed text-slate-600">{{ $t('views.env.priceNote') }}</p>
              </div>
            </div>

            <div class="flex items-center gap-2 pt-1">
              <label class="flex cursor-pointer items-center gap-1.5 text-xs text-slate-300">
                <input v-model="v.enabled" type="checkbox" class="accent-amber-400" />
                {{ $t('views.env.enable') }}
              </label>
              <div class="flex-1"></div>
              <button
                class="btn btn-sm"
                :disabled="saving"
                :title="$t('views.env.saveTitle')"
                @click="saveCard"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path :d="icons.save" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                {{ saving ? $t('common.saving') : $t('common.save') }}
              </button>
              <button class="btn btn-ghost btn-sm" :disabled="testing[v.id]" @click="test(v)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path :d="icons.bolt" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                {{ testing[v.id] ? $t('views.env.testingShort') : $t('views.env.testConn') }}
              </button>
              <button class="btn btn-danger btn-sm" @click="removeVendor(v)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path :d="icons.trash" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                {{ $t('views.env.deleteBtn') }}
              </button>
            </div>

            <div
              v-if="testResults[v.id]"
              class="rounded-lg px-2.5 py-1.5 text-xs-plus font-semibold"
              :class="testResults[v.id].ok ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'"
            >
              {{ testResults[v.id].text }}
            </div>
          </div>
        </article>
      </div>
    </section>

    <!-- 新增厂商弹窗 -->
    <Teleport to="body">
      <div
        v-if="addVisible"
        class="overlay p-6"
        @click.self="addVisible = false"
      >
        <div class="glass w-full max-w-md p-5" :style="{ '--glow': GLOW }">
          <h3 class="mb-3 text-base font-bold text-slate-100">{{ $t('views.env.addVendor') }}</h3>
          <label class="mb-1 block text-2xs text-slate-500">{{ $t('views.env.idUnique') }}</label>
          <input v-model="addForm.id" class="input font-mono" :placeholder="$t('views.env.idPh')" />
          <label class="mb-1 mt-3 block text-2xs text-slate-500">{{ $t('views.env.name') }}</label>
          <input v-model="addForm.label" class="input" :placeholder="$t('views.env.namePh')" />
          <label class="mb-1 mt-3 block text-2xs text-slate-500">Base URL</label>
          <input v-model="addForm.base_url" class="input font-mono" placeholder="https://api.example.com" />
          <div class="mt-5 flex justify-end gap-2">
            <button class="btn btn-ghost" @click="addVisible = false">{{ $t('common.cancel') }}</button>
            <button class="btn" :disabled="!addForm.id.trim()" @click="submitAdd">{{ $t('views.env.add') }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>


