<script setup lang="ts">
// -*- coding: utf-8 -*-
/**
 * ① 第一步「全剧最小单元」卡片：剧本/一句话 → 生成最小单元 → 体检 → 锚定。
 * 锚定之后，第二步逐集扩写才吃这套设定（后端 expand 注入），② 素材生成改为投影。
 * 产物分落各既有 json 包：剧本/大纲.json 加厚、剧本/埋线.json、素材/{人物,场景,道具}.json 设定层。
 */
import { ref, computed, watch } from 'vue'
import {
  fetchUnits, buildUnits, anchorUnits, editUnits,
  type UnitsBundle, type UnitForeshadow, type UnitEpisode,
} from '../api'
import { toast } from '../stores/app'
import { trackJob } from '../stores/jobs'
import { t } from '../i18n'

const props = defineProps<{ project: string }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const bundle = ref<UnitsBundle | null>(null)
const open = ref(false)
const busy = ref('')
const tab = ref<'arcs' | 'episodes' | 'threads' | 'assets' | 'index'>('arcs')
const arcSize = ref(6)
const threadsDraft = ref<UnitForeshadow[]>([])
const assetDraft = ref<Record<string, string>>({})

const report = computed(() => bundle.value?.report)
const errs = computed(() => report.value?.errors || [])
const warns = computed(() => report.value?.warnings || [])
const arcs = computed(() => bundle.value?.outline?.arcs || [])
const rules = computed(() => bundle.value?.outline?.rules || [])
const taboos = computed(() => bundle.value?.outline?.taboos || [])
const episodes = computed(() => bundle.value?.episodes || [])
const anchored = computed(() => !!bundle.value?.anchored)
/** 反查索引行：素材 → 首次出场/关键集/所属段/牵连伏笔/受影响分镜（全部派生，不写回档案） */
const indexRows = computed(() => Object.values(bundle.value?.index || {})
  .sort((a, b) => (a.ref || '').localeCompare(b.ref || '')))

/* ---------- 素材设定：横向选实体（一屏能看完谁有设定谁没有），点开才出字段表 ---------- */
const assetKind = ref<'人物' | '场景' | '道具'>('人物')
const assetPick = ref('')
type AssetField = { key: string; wide?: boolean }
const CHAR_FIELDS: AssetField[] = [
  { key: 'bio_arc' },
  { key: 'bio_language' },
  { key: 'bio_crack' },
  { key: 'bio_pressure' },
  { key: 'bio_address' },
]
const SCENE_FIELDS: AssetField[] = [
  { key: 'spatial_limit' },
  { key: 'action_slots' },
]
const PROP_FIELDS: AssetField[] = [{ key: 'usage_boundary' }]

type AssetRow = { ref: string; name: string; fields: Record<string, string>; note?: string }

function fieldText(kind: '人物' | '场景' | '道具', refStr: string, key: string): string {
  const draftKey = `${refStr}#${key}`
  if (assetDraft.value[draftKey] !== undefined) return assetDraft.value[draftKey]
  const b = bundle.value
  if (!b) return ''
  if (kind === '人物') {
    const row = (b.bios || []).find(r => r.ref === refStr) as Record<string, unknown> | undefined
    return String(row?.[key] ?? '')
  }
  const row = (kind === '场景' ? b.scene_limits : b.prop_boundaries).find(r => r.ref === refStr) as Record<string, unknown> | undefined
  const raw = row?.[key]
  if (Array.isArray(raw)) return raw.join('；')
  return String(raw ?? '')
}

const assetRows = computed<AssetRow[]>(() => {
  const b = bundle.value
  if (!b) return []
  if (assetKind.value === '人物') {
    return (b.bios || []).map(r => ({
      ref: r.ref, name: r.name,
      note: (r.states || []).length ? t('components.storyUnits.states', { n: r.states!.length }) : '',
      fields: Object.fromEntries(CHAR_FIELDS.map(f => [f.key, fieldText('人物', r.ref, f.key)])),
    }))
  }
  const list = assetKind.value === '场景' ? (b.scene_limits || []) : (b.prop_boundaries || [])
  const fields = assetKind.value === '场景' ? SCENE_FIELDS : PROP_FIELDS
  return list.map(r => ({
    ref: r.ref, name: r.name,
    fields: Object.fromEntries(fields.map(f => [f.key, fieldText(assetKind.value, r.ref, f.key)])),
  }))
})

const assetFields = computed<AssetField[]>(() =>
  assetKind.value === '人物' ? CHAR_FIELDS : assetKind.value === '场景' ? SCENE_FIELDS : PROP_FIELDS)

const assetCurrent = computed<AssetRow | null>(() =>
  assetRows.value.find(r => r.ref === assetPick.value) || assetRows.value[0] || null)

/** 已填 complete 与否只统计"有没有值"，用来在横条上标色，不判内容对错 */
const filledCount = (row: AssetRow) => Object.values(row.fields).filter(v => String(v || '').trim()).length

watch(assetKind, () => { assetPick.value = '' })
watch(bundle, () => { if (!assetPick.value) assetPick.value = assetRows.value[0]?.ref || '' })

/** 集号 → 分段名，供分集表显示"这段要完成什么" */
const arcOf = (ep: UnitEpisode) => arcs.value.find(a => a.id === ep.arc_id)

function refName(refStr: string): string {
  const hit = [...(bundle.value?.bios || []), ...(bundle.value?.scene_limits || []),
    ...(bundle.value?.prop_boundaries || [])].find(r => r.ref === refStr)
  return hit?.name || refStr
}

async function load() {
  if (!props.project) return
  try {
    bundle.value = await fetchUnits(props.project)
    threadsDraft.value = JSON.parse(JSON.stringify(bundle.value.foreshadows || []))
    assetDraft.value = {}
  } catch (e) {
    toast(e instanceof Error ? t('components.storyUnits.loadFailedMsg', { err: e.message }) : t('components.storyUnits.loadFailed'), 'err', 6000)
  }
}
watch(() => props.project, load, { immediate: true })
watch(bundle, b => { if (b) threadsDraft.value = JSON.parse(JSON.stringify(b.foreshadows || [])) })

/** op 为稳定操作 id（busy 比较用），显示名走 i18n，切换语言不影响按钮状态 */
async function run(op: string, fn: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = op
  const label = t('components.storyUnits.op.' + op)
  try {
    await fn()
    toast(t('components.storyUnits.opDone', { op: label }), 'ok', 4000)
    await load()
    emit('changed')   // 父页同步刷新分集列表（分集加厚条目与正文状态都变了）
  } catch (e) {
    toast(e instanceof Error ? t('components.storyUnits.opFailedMsg', { op: label, err: e.message }) : t('components.storyUnits.opFailed', { op: label }), 'err', 7000)
  } finally {
    busy.value = ''
  }
}

const doBuild = (thenAnchor = false, stage: 'all' | 'entity' = 'all') => run(
  stage === 'entity' ? 'entity' : (thenAnchor ? 'buildAnchor' : 'build'), async () => {
    const r = await buildUnits({ project: props.project, arc_size: arcSize.value, anchor: thenAnchor, stage })
    const j = await trackJob(r.id, t('components.storyUnits.jobLabel'))
    if (!j.success) throw new Error(j.err || t('components.storyUnits.buildFailed'))
  })

const doAnchor = () => run('anchor', async () => {
  const r = await anchorUnits(props.project)
  if (!r.ok) throw new Error(t('components.storyUnits.anchorBlocked', { n: r.errors?.length || 0, first: r.errors?.[0]?.message || '' }))
})

async function saveThreads() {
  await run('saveThreads', async () => {
    const r = await editUnits({ project: props.project, kind: 'threads', foreshadows: threadsDraft.value })
    if (!r.ok) throw new Error(r.err || t('components.storyUnits.saveFailed'))
    const blocked = (r.report?.errors || []).filter(e => e.path.startsWith('foreshadows'))
    if (blocked.length) toast(t('components.storyUnits.threadsBlocked', { n: blocked.length }), 'info', 7000)
  })
}

async function saveAsset(refStr: string, field: string, lock: boolean) {
  const value = assetDraft.value[`${refStr}#${field}`]
  if (value === undefined) return
  await run('saveAsset', async () => {
    const [kind, id] = refStr.replace('@', '').split(':')
    const zone = kind === 'character' ? '人物' : kind === 'scene' ? '场景' : '道具'
    const r = await editUnits({ project: props.project, kind: 'asset', zone, id,
      fields: { [field]: value }, lock: lock ? [field] : [] })
    if (!r.ok) throw new Error(r.err || t('components.storyUnits.saveFailed'))
    if (r.rejected?.length) toast(t('components.storyUnits.rejected', { list: r.rejected.join(t('common.listSep')) }), 'info', 6000)
  })
}
</script>

<template>
  <section class="glass mb-5 p-4">
    <button class="flex w-full items-center gap-2 text-left" @click="open = !open">
      <span class="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-400/15 text-xs font-black text-cyan-300">{{ $t('components.storyUnits.badge') }}</span>
      <h3 class="text-sm font-bold text-slate-200">{{ $t('components.storyUnits.title') }}</h3>
      <span v-if="anchored" class="rounded bg-emerald-400/15 px-2 py-0.5 text-2xs text-emerald-300">
        {{ $t('components.storyUnits.anchored', { rev: bundle?.anchor_rev }) }}
      </span>
      <span v-else class="rounded bg-slate-400/15 px-2 py-0.5 text-2xs text-slate-400">{{ $t('components.storyUnits.notAnchored') }}</span>
      <span v-if="errs.length" class="rounded bg-rose-400/15 px-2 py-0.5 text-2xs text-rose-300">
        {{ $t('components.storyUnits.blocking', { n: errs.length }) }}
      </span>
      <span v-else-if="warns.length" class="rounded bg-amber-400/15 px-2 py-0.5 text-2xs text-amber-300">
        {{ $t('components.storyUnits.todo', { n: warns.length }) }}
      </span>
      <span class="text-xs-plus text-slate-500">
        {{ $t('components.storyUnits.summary') }}
      </span>
      <span class="ml-auto text-xs text-slate-500">{{ open ? $t('components.storyUnits.collapse') : $t('components.storyUnits.expand') }}</span>
    </button>

    <div v-if="open" class="mt-3 border-t border-line-soft pt-3">
      <div class="flex flex-wrap items-center gap-3">
        <button class="btn btn-sm" :disabled="!!busy" @click="doBuild(false)">
          {{ busy === 'build' ? $t('components.storyUnits.generatingLog') : $t('components.storyUnits.buildBtn') }}
        </button>
        <button class="btn btn-sm" :disabled="!!busy" @click="doBuild(true)">{{ $t('components.storyUnits.buildAnchorBtn') }}</button>
        <button class="btn btn-sm" :disabled="!!busy || !bundle?.episodes?.length" @click="doBuild(false, 'entity')"
          :title="$t('components.storyUnits.entityTitle')">{{ $t('components.storyUnits.entityBtn') }}</button>
        <button class="btn btn-sm" :disabled="!!busy || !bundle?.episodes?.length" @click="doAnchor">{{ $t('components.storyUnits.anchorBtn') }}</button>
        <label class="text-xs text-slate-400">{{ $t('components.storyUnits.arcSize') }}
          <input v-model.number="arcSize" type="number" min="1" max="20" class="input mt-1 w-16" />
        </label>
        <span class="text-2xs text-slate-500">
          {{ $t('components.storyUnits.buildHint') }}
        </span>
      </div>

      <div v-if="errs.length || warns.length" class="mt-3 rounded bg-slate-500/5 p-2 text-2xs">
        <div v-for="e in errs.slice(0, 12)" :key="e.path + e.code" class="text-rose-300">
          ✗ {{ $t('components.storyUnits.issue', { path: e.path, msg: e.message }) }}
        </div>
        <div v-for="w in warns.slice(0, 6)" :key="w.path + w.code" class="text-amber-300">
          ! {{ $t('components.storyUnits.issue', { path: w.path, msg: w.message }) }}
        </div>
      </div>

      <div class="mt-3 flex gap-2 text-xs">
        <button v-for="t in ([['arcs', arcs.length], ['episodes', episodes.length],
          ['threads', threadsDraft.length], ['assets', (bundle?.bios?.length || 0) + (bundle?.scene_limits?.length || 0) + (bundle?.prop_boundaries?.length || 0)],
          ['index', indexRows.length]] as const)"
          :key="t[0]" class="rounded px-2 py-1"
          :class="tab === t[0] ? 'bg-cyan-400/15 text-cyan-200' : 'text-slate-400 hover:text-slate-200'"
          @click="tab = t[0] as typeof tab">{{ $t('components.storyUnits.tab.' + t[0], { n: t[1] }) }}</button>
      </div>

      <!-- 分段与规则 -->
      <div v-if="tab === 'arcs'" class="mt-3 space-y-3 text-xs">
        <p v-if="!arcs.length" class="text-slate-500">{{ $t('components.storyUnits.noArcs') }}</p>
        <table v-else class="w-full text-2xs">
          <tbody>
            <tr v-for="a in arcs" :key="a.id" class="border-t border-line-soft align-top">
              <td class="py-1 pr-2 font-bold text-slate-300">{{ a.id }}</td>
              <td class="pr-2 text-slate-400">{{ a.ep_from }}~{{ a.ep_to }}</td>
              <td class="pr-2 text-slate-200">{{ a.goal }}</td>
              <td class="text-slate-500">{{ $t('components.storyUnits.release', { list: (a.release || []).join($t('common.semiSep')) }) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="rules.length">
          <h4 class="font-bold text-slate-300">{{ $t('components.storyUnits.rules') }}</h4>
          <p v-for="r in rules" :key="r.id" class="text-2xs text-slate-400">
            <b class="text-slate-300">{{ r.id }}</b> {{ r.text }}
            <span v-if="r.check_hint" class="text-slate-500">{{ $t('components.storyUnits.violation', { hint: r.check_hint }) }}</span>
          </p>
        </div>
        <div v-if="taboos.length">
          <h4 class="font-bold text-slate-300">{{ $t('components.storyUnits.taboos') }}</h4>
          <p v-for="t in taboos" :key="t.id" class="text-2xs text-slate-400">
            <b class="text-rose-300">{{ t.id }}</b> {{ t.rule }}
            <span class="text-slate-500">{{ $t('components.storyUnits.detect', { list: (t.detect || []).join($t('common.listSep')) || $t('components.storyUnits.noDetect') }) }}</span>
          </p>
        </div>
      </div>

      <!-- 分集加厚 -->
      <div v-else-if="tab === 'episodes'" class="mt-3 overflow-x-auto text-2xs">
        <p v-if="!episodes.length" class="text-slate-500">{{ $t('components.storyUnits.noEpisodes') }}</p>
        <table v-else class="w-full">
          <thead class="text-slate-500">
            <tr><th class="py-1 text-left">{{ $t('components.storyUnits.col.ep') }}</th><th class="text-left">{{ $t('components.storyUnits.col.arcGoal') }}</th><th class="text-left">{{ $t('components.storyUnits.col.beats') }}</th>
              <th class="text-left">{{ $t('components.storyUnits.col.plant') }}</th><th class="text-left">{{ $t('components.storyUnits.col.pay') }}</th><th class="text-left">{{ $t('components.storyUnits.col.refs') }}</th><th class="text-left">{{ $t('components.storyUnits.col.text') }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="e in episodes" :key="e.id" class="border-t border-line-soft align-top">
              <td class="py-1 pr-2 font-bold text-slate-200">{{ e.id }}</td>
              <td class="pr-2 text-slate-400">{{ e.arc_id }}<span class="text-slate-500"> {{ arcOf(e)?.goal || '' }}</span></td>
              <td class="pr-2 text-slate-300">{{ (e.beats || []).join(' → ') || '—' }}</td>
              <td class="pr-2 text-cyan-300">{{ (e.fs_plant || []).join($t('common.listSep')) || '—' }}</td>
              <td class="pr-2 text-emerald-300">{{ (e.fs_pay || []).join($t('common.listSep')) || '—' }}</td>
              <td class="pr-2 text-slate-400">
                {{ (e.cast_refs || []).length }}·{{ (e.scene_refs || []).length }}·{{ (e.key_asset_refs || []).length }}
                <div v-if="e.state_derive?.length" class="text-slate-500">
                  {{ e.state_derive.map(d => `${refName(d.ref)}→${d.label || d.state_id}`).join($t('common.semiSep')) }}
                </div>
              </td>
              <td :class="e.has_text ? 'text-emerald-300' : 'text-slate-500'">
                {{ e.has_text ? $t('components.storyUnits.chars', { n: e.text_len }) : $t('components.storyUnits.notWritten') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 埋线表（可编辑） -->
      <div v-else-if="tab === 'threads'" class="mt-3 text-2xs">
        <p v-if="!threadsDraft.length" class="text-slate-500">
          {{ $t('components.storyUnits.noThreads') }}
        </p>
        <template v-else>
          <table class="w-full">
            <thead class="text-slate-500">
              <tr><th class="py-1 text-left">id</th><th class="text-left">{{ $t('components.storyUnits.col.what') }}</th><th class="text-left">{{ $t('components.storyUnits.col.setIn') }}</th>
                <th class="text-left">{{ $t('components.storyUnits.col.payIn') }}</th><th class="text-left">{{ $t('components.storyUnits.col.deps') }}</th><th class="text-left">{{ $t('components.storyUnits.col.status') }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="f in threadsDraft" :key="f.id" class="border-t border-line-soft align-top">
                <td class="py-1 pr-2 font-bold text-slate-300">{{ f.id }}</td>
                <td class="pr-2">
                  <input v-model="f.plant" class="input w-full" />
                </td>
                <td class="pr-2"><input v-model="f.set_in" class="input w-14" /></td>
                <td class="pr-2"><input v-model="f.pay_in" class="input w-14" /></td>
                <td class="pr-2 text-slate-400">{{ (f.refs || []).map(refName).join($t('common.listSep')) || '—' }}</td>
                <td><input v-model="f.status" class="input w-24" placeholder="open|paid|needs_review" /></td>
              </tr>
            </tbody>
          </table>
          <button class="btn btn-sm mt-2" :disabled="!!busy" @click="saveThreads">{{ $t('components.storyUnits.saveThreads') }}</button>
        </template>
        <div v-if="bundle?.hooks?.length" class="mt-4">
          <h4 class="text-xs font-bold text-slate-300">{{ $t('components.storyUnits.hooks') }}</h4>
          <p v-for="h in bundle.hooks" :key="h.id" class="text-slate-400">
            <b class="text-slate-300">{{ h.ep }}</b> {{ h.beat }}
            <span class="text-slate-500">— {{ h.question }}</span>
          </p>
        </div>
      </div>

      <!-- 素材设定层：横向选实体（不铺开占页面），点开才出该实体的字段表 -->
      <div v-else-if="tab === 'assets'" class="mt-3 text-2xs">
        <p v-if="!assetRows.length" class="text-slate-500">
          {{ $t('components.storyUnits.noAssets') }}
        </p>
        <template v-else>
          <div class="mb-2 flex gap-2 text-xs">
            <button v-for="k in (['人物', '场景', '道具'] as const)" :key="k" class="rounded px-2 py-1"
              :class="assetKind === k ? 'bg-cyan-400/15 text-cyan-200' : 'text-slate-400 hover:text-slate-200'"
              @click="assetKind = k">
              {{ $t('components.storyUnits.kind.' + k) }} {{ k === '人物' ? (bundle?.bios?.length || 0) : k === '场景' ? (bundle?.scene_limits?.length || 0) : (bundle?.prop_boundaries?.length || 0) }}
            </button>
          </div>
          <div class="flex max-h-32 flex-wrap gap-1 overflow-y-auto rounded border border-line-soft p-2">
            <button v-for="row in assetRows" :key="row.ref" class="rounded px-2 py-0.5 leading-5"
              :class="assetCurrent?.ref === row.ref ? 'bg-cyan-400/20 text-cyan-100'
                : (filledCount(row) ? 'bg-emerald-400/10 text-emerald-200' : 'bg-slate-500/10 text-slate-400')"
              :title="row.ref" @click="assetPick = row.ref">
              {{ row.name }}<span v-if="row.note" class="ml-1 text-slate-500">{{ row.note }}</span>
            </button>
          </div>
          <table v-if="assetCurrent" class="mt-2 w-full">
            <thead class="text-slate-500">
              <tr><th class="py-1 text-left">{{ $t('components.storyUnits.col.field') }}</th><th class="text-left">{{ $t('components.storyUnits.col.value') }}</th><th class="w-28"></th></tr>
            </thead>
            <tbody>
              <tr v-for="f in assetFields" :key="f.key" class="border-t border-line-soft align-top">
                <td class="w-44 py-1 pr-2 text-slate-400">{{ $t('components.storyUnits.field.' + f.key) }}</td>
                <td class="pr-2">
                  <input :value="assetCurrent.fields[f.key]" class="input w-full"
                    @input="assetDraft[`${assetCurrent.ref}#${f.key}`] = ($event.target as HTMLInputElement).value" />
                </td>
                <td class="text-right">
                  <button class="btn btn-sm" :disabled="!!busy" @click="saveAsset(assetCurrent.ref, f.key, true)">{{ $t('components.storyUnits.saveLock') }}</button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="assetCurrent" class="mt-1 text-slate-500">
            {{ $t('components.storyUnits.filled', { ref: assetCurrent.ref, n: filledCount(assetCurrent), total: assetFields.length }) }}
            {{ $t('components.storyUnits.lockNote') }}
          </p>
        </template>
      </div>

      <!-- 反查索引：改这条设定会牵连哪几集／哪几张分镜（派生，不写回素材档案） -->
      <div v-else class="mt-3 overflow-x-auto text-2xs">
        <p v-if="!indexRows.length" class="text-slate-500">{{ $t('components.storyUnits.noIndex') }}</p>
        <table v-else class="w-full">
          <thead class="text-slate-500">
            <tr><th class="py-1 text-left">{{ $t('components.storyUnits.col.asset') }}</th><th class="text-left">{{ $t('components.storyUnits.col.firstEp') }}</th><th class="text-left">{{ $t('components.storyUnits.col.keyEps') }}</th>
              <th class="text-left">{{ $t('components.storyUnits.col.arc') }}</th><th class="text-left">{{ $t('components.storyUnits.col.foreshadows') }}</th><th class="text-left">{{ $t('components.storyUnits.col.boards') }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in indexRows" :key="row.ref" class="border-t border-line-soft align-top">
              <td class="py-1 pr-2 text-slate-200">{{ refName(row.ref) }}<div class="text-slate-500">{{ row.ref }}</div></td>
              <td class="pr-2 text-cyan-300">{{ row.first_ep || '—' }}</td>
              <td class="pr-2 text-slate-300">{{ (row.key_eps || []).join($t('common.listSep')) || '—' }}</td>
              <td class="pr-2 text-slate-400">{{ (row.arcs || []).join($t('common.listSep')) || '—' }}</td>
              <td class="pr-2 text-amber-300">{{ (row.foreshadows || []).join($t('common.listSep')) || '—' }}</td>
              <td class="text-slate-400">{{ (row.used_by_boards || []).join($t('common.listSep')) || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="indexRows.length" class="mt-2 text-slate-500">
          {{ $t('components.storyUnits.indexNote') }}
        </p>
      </div>

      <div class="mt-3 text-2xs text-slate-500">
        {{ $t('components.storyUnits.cli') }}<code>python workbench/tools/story_units.py check|anchor|index|gaps|block {{ project }}</code>
        {{ $t('components.storyUnits.unanchor') }}
      </div>
    </div>
  </section>
</template>
