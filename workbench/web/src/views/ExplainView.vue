<script setup lang="ts">
// -*- coding: utf-8 -*-
/** ⑤ 镜头语言讲解：选解构版本 → 生成讲解（job）→ 拉 markdown 自渲染（每镜一节玻璃卡片）。 */
import { ref, computed, watch } from 'vue'
import {
  fetchAnalysisList, runExplain, fetchExplain, fetchExplainPreflight, fmtT, deleteFile,
  type AnalysisMeta, type ExplainPreflight
} from '../api'
import { app, toast, loadBasics } from '../stores/app'
import { trackJob } from '../stores/jobs'
import { renderMarkdown, splitSections } from '../utils/markdown'
import { icons } from '../components/icons'
import EmptyState from '../components/EmptyState.vue'
import { t } from '../i18n'

const GLOW = 'rgba(167,139,250,0.35)'

const versions = ref<AnalysisMeta[]>([])
const currentName = ref('')
const loadingList = ref(false)

/* ---------- 讲解文档 ---------- */
const md = ref('')
const hasDoc = ref(false)
const loadingDoc = ref(false)
const generating = ref(false)

const sections = computed(() => splitSections(md.value))

async function loadVersions() {
  if (!app.current) return
  loadingList.value = true
  try {
    versions.value = await fetchAnalysisList(app.current)
  } catch {
    versions.value = []
    toast(t('views.explain.listFailed'), 'err')
  } finally {
    loadingList.value = false
  }
}

let docSeq = 0
async function loadDoc(name: string) {
  if (!app.current || !name) return
  const seq = ++docSeq
  const project = app.current
  loadingDoc.value = true
  md.value = ''
  hasDoc.value = false
  try {
    const r = await fetchExplain(project, name)
    if (seq !== docSeq || project !== app.current || currentName.value !== name) return
    md.value = r.md || ''
    hasDoc.value = true
  } catch (e) {
    if (seq !== docSeq || project !== app.current) return
    if (e instanceof Error && 'status' in e && (e as { status: number }).status === 404) {
      // 尚无讲解，属正常 → 空状态引导
    } else {
      toast(t('views.explain.loadFailed'), 'err')
    }
  } finally {
    if (seq === docSeq) loadingDoc.value = false
  }
}

/* ---------- 前置态（讲解只读拉片产物，不重抽帧；AI 调用前先看依赖齐不齐） ---------- */
const pre = ref<ExplainPreflight | null>(null)

async function loadPreflight(name: string) {
  if (!app.current || !name) {
    pre.value = null
    return
  }
  try {
    pre.value = await fetchExplainPreflight(app.current, name)
  } catch {
    pre.value = null
  }
}

/** 删除当前版本讲解文档（可再生）。 */
async function delDoc() {
  if (!app.current || !currentName.value) return
  if (!confirm(t('views.explain.deleteConfirm', { name: currentName.value }))) return
  try {
    await deleteFile(app.current, `拉片/${currentName.value}/讲解.md`)
    toast(t('views.explain.deleted'), 'ok')
    md.value = ''
    hasDoc.value = false
    await loadBasics()
    await loadPreflight(currentName.value)
  } catch (e) {
    toast(e instanceof Error ? e.message : t('common.deleteFailed'), 'err')
  }
}

/** 前置态 chips：{文字, 颜色} 列表，模板直接渲染。 */
const preChips = computed(() => {
  const p = pre.value
  if (!p || !p.ok) return []
  const chips: { text: string; color: string; title?: string }[] = []
  chips.push({ text: t('views.explain.chip.data', { n: p.shot_count }), color: '#34d399' })
  const kfOk = (p.kf_disk ?? 0) >= (p.kf_total ?? 0)
  chips.push(
    kfOk
      ? { text: t('views.explain.chip.kfOk', { disk: p.kf_disk, total: p.kf_total }), color: '#34d399' }
      : {
          text: t('views.explain.chip.kfWarn', { disk: p.kf_disk, total: p.kf_total }),
          color: '#fbbf24',
          title: t('views.explain.chip.kfTitle')
        }
  )
  chips.push(
    p.vision_vendor
      ? { text: t('views.explain.chip.vision', { v: p.vision_vendor }), color: '#34d399' }
      : { text: t('views.explain.chip.noVision'), color: '#f87171', title: t('views.explain.chip.noVisionTitle') }
  )
  chips.push(
    p.has_doc
      ? { text: t('views.explain.chip.hasDoc', { time: p.doc_mtime }), color: '#38bdf8', title: t('views.explain.chip.overwrite') }
      : { text: t('views.explain.chip.noDoc'), color: '#64748b' }
  )
  return chips
})

async function generate() {
  if (!app.current || !currentName.value) {
    toast(t('views.explain.needVersion'), 'err')
    return
  }
  generating.value = true
  try {
    const r = await runExplain({ project: app.current, name: currentName.value })
    toast(t('views.explain.started', { id: r.id }), 'ok')
    const j = await trackJob(r.id, t('views.explain.jobLabel', { name: currentName.value }))
    if (j.success) {
      toast(t('views.explain.done'), 'ok')
      await loadDoc(currentName.value)
      await loadPreflight(currentName.value)
    } else {
      toast(t('views.explain.failed'), 'err')
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : t('common.startFailed'), 'err')
  } finally {
    generating.value = false
  }
}

watch(
  () => app.current,
  () => {
    currentName.value = ''
    md.value = ''
    hasDoc.value = false
    loadVersions()
  },
  { immediate: true }
)

watch(currentName, (n) => {
  if (n) {
    loadDoc(n)
    loadPreflight(n)
  } else {
    pre.value = null
  }
})
</script>

<template>
  <div class="page">
    <header class="mb-6">
      <h1 class="grad-text text-2xl font-black">{{ $t('nav.explain') }}</h1>
      <p class="mt-1 text-xs text-slate-500">{{ $t('views.explain.lead') }}</p>
    </header>

    <EmptyState v-if="!app.current" :title="$t('common.pickProjectFirst')" />

    <div v-else class="flex gap-5">
      <!-- 版本时间线（同拉页模式） -->
      <aside class="w-60 shrink-0">
        <h3 class="mb-2 text-xs font-bold text-slate-500">{{ $t('views.explain.versions') }}</h3>
        <div v-if="loadingList" class="glass p-4 text-center text-xs text-slate-500">{{ $t('views.explain.loadingVersions') }}</div>
        <div v-else-if="!versions.length" class="glass p-4 text-center text-xs text-slate-500">
          {{ $t('views.explain.noVersions') }}<br />{{ $t('views.explain.noVersionsHint') }}
        </div>
        <div v-else class="relative space-y-2 pl-4">
          <div class="absolute bottom-2 left-[5px] top-2 w-px bg-gradient-to-b from-violet-500/60 to-fuchsia-500/40"></div>
          <button
            v-for="v in versions"
            :key="v.name"
            class="glass relative block w-full p-3 text-left transition hover:border-violet-400/40"
            :class="{ 'ring-1 ring-violet-400/60': currentName === v.name }"
            :style="{ '--glow': GLOW }"
            @click="currentName = v.name"
          >
            <span
              class="absolute -left-[15.5px] top-4 h-2.5 w-2.5 rounded-full border-2 border-base"
              :style="{ background: currentName === v.name ? '#a78bfa' : '#475569' }"
            ></span>
            <div class="truncate text-sm font-bold text-slate-100">{{ v.name }}</div>
            <div class="mt-1 text-2xs text-slate-500">
              {{ v.created_at || '' }} · {{ $t('common.shots', { n: v.shot_count ?? '?' }) }}
              <template v-if="v.first_t !== undefined && v.last_t !== undefined">
                · {{ fmtT(v.first_t) }}–{{ fmtT(v.last_t) }}
              </template>
            </div>
          </button>
        </div>
      </aside>

      <!-- 主区 -->
      <section class="min-w-0 flex-1">
        <div class="mb-4 flex items-center gap-2">
          <span v-if="currentName" class="pop-in rounded-lg bg-violet-400/10 px-3 py-1.5 text-sm font-bold text-violet-300">
            {{ currentName }}
          </span>
          <div class="flex-1"></div>
          <button class="btn" :disabled="generating || !currentName || (pre?.ok === false)" @click="generate">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path :d="icons.bolt" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            {{ generating ? $t('common.generating') : pre?.has_doc ? $t('views.explain.regen') : $t('views.explain.gen') }}
          </button>
          <button
            v-if="pre?.has_doc"
            class="btn btn-danger btn-sm"
            :title="$t('views.explain.deleteTitle')"
            :disabled="generating"
            @click="delDoc"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path :d="icons.trash" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            {{ $t('views.explain.delete') }}
          </button>
        </div>

        <!-- 前置态：讲解只读拉片产物（analysis.json + 已抽关键帧），不做任何重抽帧 -->
        <div v-if="currentName && preChips.length" class="glass mb-4 flex flex-wrap items-center gap-2 px-3 py-2.5">
          <span class="text-2xs font-bold text-slate-500">{{ $t('views.explain.pre') }}</span>
          <span
            v-for="(c, i) in preChips"
            :key="i"
            class="rounded-full border px-2.5 py-0.5 text-2xs font-semibold"
            :style="{ color: c.color, borderColor: c.color + '44', background: c.color + '14' }"
            :title="c.title || ''"
          >{{ c.text }}</span>
          <span class="flex-1"></span>
          <span class="text-2xs text-slate-500">{{ $t('views.explain.preNote') }}</span>
        </div>

        <!-- 生成中 -->
        <div v-if="generating" class="glass flex flex-col items-center gap-3 p-16 text-center">
          <svg class="animate-spin" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2.5">
            <path d="M12 3a9 9 0 1 0 9 9" stroke-linecap="round" />
          </svg>
          <p class="text-sm text-slate-300">{{ $t('views.explain.running') }}</p>
          <p class="text-xs text-slate-500">{{ $t('views.explain.runningHint') }}</p>
        </div>

        <!-- 加载中 -->
        <div v-else-if="loadingDoc" class="glass p-16 text-center text-sm text-slate-500">{{ $t('views.explain.loadingDoc') }}</div>

        <!-- 空状态 -->
        <div v-else-if="!hasDoc" class="glass p-14 text-center">
          <svg class="mx-auto mb-3 opacity-40" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="1.5">
            <path :d="icons.book" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <p class="text-sm text-slate-300">
            {{ currentName ? $t('views.explain.noDoc') : $t('views.explain.pickVersion') }}
          </p>
          <p v-if="currentName" class="mt-2 text-xs leading-relaxed text-slate-500">
            {{ $t('views.explain.emptyHint') }}
          </p>
        </div>

        <!-- 讲解内容：每节一张玻璃卡片 -->
        <div v-else class="space-y-4">
          <article
            v-for="(sec, i) in sections"
            :key="i"
            class="glass glass-hover p-5"
            :style="{ '--glow': GLOW }"
          >
            <h2 v-if="sec.title" class="mb-2 flex items-center gap-2 text-base font-bold text-violet-200">
              <span class="h-3.5 w-1 rounded-full bg-gradient-to-b from-violet-400 to-fuchsia-400"></span>
              {{ sec.title }}
            </h2>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div class="md-body" v-html="renderMarkdown(sec.body)"></div>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* v-html 内容样式（白名单渲染，内容已转义） */
.md-body :deep(h1) { font-size: 1.25rem; font-weight: 800; color: #ede9fe; margin: 0.2rem 0 0.6rem; }
.md-body :deep(h2) { font-size: 1.05rem; font-weight: 700; color: #ddd6fe; margin: 0.8rem 0 0.4rem; }
.md-body :deep(h3),
.md-body :deep(h4) { font-size: 0.92rem; font-weight: 700; color: #c4b5fd; margin: 0.6rem 0 0.3rem; }
.md-body :deep(p) { font-size: 0.85rem; line-height: 1.75; color: #cbd5e1; margin: 0.3rem 0; }
.md-body :deep(ul),
.md-body :deep(ol) { margin: 0.35rem 0; padding-left: 1.3rem; font-size: 0.85rem; line-height: 1.7; color: #cbd5e1; }
.md-body :deep(ul) { list-style: disc; }
.md-body :deep(ol) { list-style: decimal; }
.md-body :deep(li) { margin: 0.15rem 0; }
.md-body :deep(strong) { color: #f5d0fe; font-weight: 700; }
.md-body :deep(em) { color: #a5b4fc; }
.md-body :deep(code) {
  background: rgba(167, 139, 250, 0.12);
  border: 1px solid rgba(167, 139, 250, 0.25);
  border-radius: 0.3rem;
  padding: 0.05rem 0.35rem;
  font-size: 0.78rem;
  color: #e9d5ff;
  font-family: 'Cascadia Code', Consolas, monospace;
}
.md-body :deep(a) { color: #67e8f9; text-decoration: underline; }
.md-body :deep(hr) { border: none; border-top: 1px solid rgba(148, 163, 184, 0.2); margin: 0.8rem 0; }
</style>
