<script setup lang="ts">
import { t } from '../i18n'
import { useBoardSelection } from '../utils/useBoardSelection'
// -*- coding: utf-8 -*-
/** ② 辅助·Blender：选分镜 JSON → 生成 Blender 构建脚本 → 发 Blender MCP 构建存盘 .blend；产物卡片（打开/CLI 渲染/代码查看）。 */
import { ref, computed, watch } from 'vue'
import { runGeneric, openBlend, fetchText, mediaUrl, ApiError, deleteFile } from '../api'
import { app, projectFiles, materialVideos, toast, loadBasics } from '../stores/app'
import { trackJob } from '../stores/jobs'
import { icons } from '../components/icons'
import StyledSelect from '../components/StyledSelect.vue'
import DelBadge from '../components/DelBadge.vue'
import EmptyState from '../components/EmptyState.vue'

const GLOW = 'rgba(34,211,238,0.35)'

const storyboard = ref('')
const phase = ref<'idle' | 'genscript' | 'build'>('idle')
const envLoading = ref(false)
const genScript = ref('')

const boards = computed(() => projectFiles('分镜', /\.json$/i))
watch([boards, storyboard], () => {
  // 分镜选择由 useBoardSelection 统一恢复。 // // 默认选最后一个分镜（含项目切换回填）
}, { immediate: true })

/** Blender MCP 未连时的统一提示。 */
function mcpToast(msg: string) {
  if (/MCP|9876/i.test(msg)) {
    toast(t('views.white3d.mcpOffline'), 'err', 4000)
  } else {
    toast(msg, 'err', 4000)
  }
}

/** 删除当前对比选中的 3D 渲染视频。 */
async function delCmp() {
  if (!app.current || !cmpVideo.value) return
  if (!confirm(t('views.white.deleteConfirm', { name: cmpVideo.value.split('/').pop() }))) return
  try {
    await deleteFile(app.current, cmpVideo.value.replace(`projects/${app.current}/`, ''))
    toast(t('views.white.deleted'), 'ok')
    await loadBasics()
  } catch (e) {
    toast(e instanceof Error ? e.message : t('common.deleteFailed'), 'err')
  }
}

async function generate() {
  if (!app.current || !storyboard.value) {
    toast(t('views.white.needBoard'), 'err')
    return
  }
  phase.value = 'genscript'
  genScript.value = ''
  try {
    const r = await runGeneric({ step: 'blender_previs', args: [`projects/${app.current}/分镜/${storyboard.value}`] })
    // 契约形态 A：同步生成成功，返回 {ok, gen_script} → 接着发 blender_build
    if (r.ok && r.gen_script) {
      genScript.value = r.gen_script
      phase.value = 'build'
      const b = await runGeneric({ step: 'blender_build', args: [r.gen_script] })
      if (!b.id) throw new Error(b.err || t('views.white3d.buildNotStarted'))
      const j = await trackJob(b.id, t('views.white3d.buildJob', { name: storyboard.value }))
      if (j.success) { toast(t('views.white3d.buildDoneSaved'), 'ok'); await loadBasics() }
      else mcpToast(j.err || t('views.white3d.buildFailed'))
      return
    }
    // 契约形态 B（当前 server.py）：一步合并任务 {ok, id}（生成脚本 + 发 MCP）
    if (r.ok && r.id) {
      phase.value = 'build'
      const j = await trackJob(r.id, t('views.white3d.sceneJob', { name: storyboard.value }))
      const m = (j.out || '').match(/(?:已生成脚本[:：]|Generated script:)\s*(.+)/)
      if (m) genScript.value = m[1].trim()
      if (j.success) { toast(t('views.white3d.scriptBuildDone'), 'ok'); await loadBasics() }
      else mcpToast(j.err || t('views.white3d.jobFailed'))
      return
    }
    throw new Error(r.err || t('views.white3d.scriptFailed'))
  } catch (e) {
    const msg = e instanceof ApiError || e instanceof Error ? e.message : t('views.white3d.unknownError')
    mcpToast(msg)
  } finally {
    phase.value = 'idle'
  }
}

async function genEnv() {
  if (!app.current || !storyboard.value) {
    toast(t('views.white.needBoard'), 'err')
    return
  }
  envLoading.value = true
  try {
    const r = await runGeneric({ step: 'scene_env', args: [`projects/${app.current}/分镜/${storyboard.value}`] })
    if (!r.id) throw new Error(r.err || t('views.depth.notStarted'))
    const j = await trackJob(r.id, t('views.white3d.envJob', { name: storyboard.value }))
    if (j.success) { toast(t('views.white3d.envDone'), 'ok', 5000) }
    else throw new Error(j.err || t('views.white3d.envFailed'))
  } catch (e) {
    toast(e instanceof Error ? e.message : t('views.white3d.envFailed'), 'err')
  } finally {
    envLoading.value = false
  }
}

/* ---------- 产物 ---------- */
interface Prod {
  sub: string
  file: string
  path: string
}

function products(re: RegExp): Prod[] {
  const out: Prod[] = []
  for (const sub of ['白模3D', '根目录']) {
    for (const f of projectFiles(sub)) {
      if (re.test(f)) {
        out.push({
          sub,
          file: f,
          path: `projects/${app.current}/${sub === '根目录' ? '' : sub + '/'}${f}`
        })
      }
    }
  }
  return out
}

const blends = computed(() => products(/\.blend$/i))
const videos = computed(() => products(/\.mp4$/i))
const scripts = computed(() => products(/^(gen|build)_[^/]*\.py$/i))
const hasProducts = computed(() => blends.value.length + videos.value.length + scripts.value.length > 0)

/* ---------- 原片 vs 3D 白模 对比 ---------- */
const srcVideo = ref('')
const srcOptions = computed(() => materialVideos().map((v) => v.rel))
watch([srcOptions, srcVideo], () => {
  if ((!srcVideo.value || !srcOptions.value.includes(srcVideo.value)) && srcOptions.value.length) srcVideo.value = srcOptions.value.at(-1) || ''
}, { immediate: true })

const cmpVideo = ref('')
const cmpOptions = computed(() => videos.value.map((v) => v.path))
const cmpLabels = computed(() => Object.fromEntries(videos.value.map((v) => [v.path, `${v.file}（${v.sub}）`])))
watch([cmpOptions, cmpVideo], () => {
  // 默认选最新一个（同名字典序最大；即最近一次生成的产物）
  if ((!cmpVideo.value || !cmpOptions.value.includes(cmpVideo.value)) && cmpOptions.value.length) {
    cmpVideo.value = cmpOptions.value[cmpOptions.value.length - 1]
  }
}, { immediate: true })

/* 双播放器联动：播放/暂停/拖动互相同步（带防递归锁） */
const leftEl = ref<HTMLVideoElement | null>(null)
const rightEl = ref<HTMLVideoElement | null>(null)
let syncing = false
function syncFrom(src: 'l' | 'r') {
  if (syncing) return
  const a = src === 'l' ? leftEl.value : rightEl.value
  const b = src === 'l' ? rightEl.value : leftEl.value
  if (!a || !b) return
  syncing = true
  try {
    if (Math.abs(a.currentTime - b.currentTime) > 0.15) b.currentTime = a.currentTime
    if (a.paused) b.pause()
    else b.play().catch(() => {})
  } finally {
    setTimeout(() => (syncing = false), 60)
  }
}

/* ---------- 产物操作 ---------- */
const opening = ref<Record<string, boolean>>({})
const rendering = ref<Record<string, boolean>>({})

async function openLocal(p: Prod) {
  opening.value[p.path] = true
  try {
    const r = await openBlend(p.path)
    toast(t('views.white3d.opened', { name: r.opened || p.file }), 'ok')
  } catch (e) {
    toast(e instanceof Error ? e.message : t('views.white3d.openFailed'), 'err')
  } finally {
    opening.value[p.path] = false
  }
}

async function renderCli(p: Prod) {
  rendering.value[p.path] = true
  try {
    const r = await runGeneric({ step: 'blender_render', args: [p.path] })
    if (!r.id) throw new Error(r.err || t('views.white3d.renderNotStarted'))
    toast(t('views.white3d.renderStarted', { id: r.id }), 'ok')
    const j = await trackJob(r.id, t('views.white3d.renderJob', { name: p.file }))
    if (j.success) { toast(t('views.white3d.renderDone'), 'ok'); await loadBasics() }
    else toast(j.err || t('views.white3d.renderFailed'), 'err')
  } catch (e) {
    toast(e instanceof Error ? e.message : t('common.startFailed'), 'err')
  } finally {
    rendering.value[p.path] = false
  }
}

const codeView = ref<{ path: string; text: string } | null>(null)
const codeLoading = ref(false)

async function viewCode(p: Prod) {
  codeLoading.value = true
  codeView.value = { path: p.path, text: '' }
  try {
    codeView.value = { path: p.path, text: await fetchText(p.path) }
  } catch {
    toast(t('views.white3d.codeFailed'), 'err')
    codeView.value = null
  } finally {
    codeLoading.value = false
  }
}

async function resendBuild(p: Prod) {
  try {
    const r = await runGeneric({ step: 'blender_build', args: [p.path] })
    if (!r.id) throw new Error(r.err || t('views.white3d.buildNotStarted'))
    toast(t('views.white3d.sent', { name: p.file }), 'ok')
    const j = await trackJob(r.id, t('views.white3d.buildJob', { name: p.file }))
    if (j.success) toast(t('views.white3d.buildDone'), 'ok')
    else mcpToast(j.err || t('views.white3d.buildFailed'))
  } catch (e) {
    mcpToast(e instanceof Error ? e.message : t('views.white3d.sendFailed'))
  }
}

watch(() => app.current, () => {
  storyboard.value = ''
  genScript.value = ''
  srcVideo.value = ''
})
useBoardSelection(storyboard, boards, 'white3d')
</script>

<template>
  <div class="page">
    <header class="mb-6">
      <h1 class="grad-text text-2xl font-black">{{ $t('nav.white3d') }}</h1>
      <p class="mt-1 text-xs text-slate-500">
        {{ $t('views.white3d.lead') }}
      </p>
      <p class="mt-1 rounded-lg bg-cyan-400/10 px-3 py-1.5 text-xs-plus text-cyan-300">
        {{ $t('views.white3d.dialogueOnly') }}
      </p>
    </header>

    <!-- 参数条 -->
    <div class="glass mb-5 flex flex-wrap items-end gap-3 p-4">
      <label class="min-w-64 text-xs text-slate-400">
        {{ $t('views.white.boardLabel') }}
        <StyledSelect v-model="storyboard" class="mt-1" :options="boards" :storage-key="`wb.${app.current}.white3d.board`" :placeholder="$t('views.white.pickBoard')" />
      </label>
      <button class="btn" :disabled="phase !== 'idle' || !storyboard" @click="generate">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path :d="icons.wand" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {{ phase === 'genscript' ? $t('views.white3d.genScript') : phase === 'build' ? $t('views.white3d.sending') : $t('views.white3d.gen3d') }}
      </button>
      <button class="btn btn-ghost" :disabled="envLoading || !storyboard"
        :title="$t('views.white3d.envTitle')"
        @click="genEnv">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4L12 3zM19 15l.9 2.3L22 18l-2.1.7L19 21l-.9-2.3L16 18l2.1-.7L19 15z" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {{ envLoading ? $t('views.white3d.envRunning') : $t('views.white3d.envBtn') }}
      </button>
      <div v-if="phase !== 'idle'" class="flex items-center gap-2 text-xs text-cyan-300">
        <svg class="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M12 3a9 9 0 1 0 9 9" stroke-linecap="round" />
        </svg>
        {{ phase === 'genscript' ? $t('views.white3d.stage1') : $t('views.white3d.stage2') }}
      </div>
    </div>

    <!-- 生成脚本回显 -->
    <div v-if="genScript" class="glass mb-5 flex items-center gap-2 px-4 py-2.5 text-xs">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2">
        <path :d="icons.terminal" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span class="text-slate-500">{{ $t('views.white3d.scriptLabel') }}</span>
      <code class="truncate text-cyan-300" :title="genScript">{{ genScript }}</code>
    </div>

    <!-- 原片 vs 3D 白模 对比（有渲染视频时默认展开） -->
    <section v-if="app.current && videos.length" class="glass mb-5 p-4">
      <h3 class="mb-3 flex items-center gap-2 text-xs font-bold text-slate-400">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2">
          <path :d="icons.film" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {{ $t('views.white3d.compare') }}
      </h3>
      <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div class="overflow-hidden rounded-xl border border-line-soft bg-black/40">
          <video
            ref="leftEl"
            :src="srcVideo ? mediaUrl(srcVideo) : ''"
            controls
            class="aspect-video w-full bg-black"
            preload="metadata"
            @play="syncFrom('l')"
            @pause="syncFrom('l')"
            @seeked="syncFrom('l')"
          ></video>
          <div class="flex items-center gap-2 px-3 py-2">
            <span class="rounded-full bg-amber-400/10 px-2 py-0.5 text-2xs font-bold text-amber-300">{{ $t('views.white.original') }}</span>
            <span class="min-w-0 flex-1 truncate text-xs-plus text-slate-400" :title="srcVideo">
              {{ srcVideo ? srcVideo.split('/').pop() : $t('views.white.noMaterial') }}
            </span>
          </div>
        </div>
        <div class="overflow-hidden rounded-xl border border-line-soft bg-black/40">
          <video
            ref="rightEl"
            :src="cmpVideo ? mediaUrl(cmpVideo) : ''"
            controls
            class="aspect-video w-full bg-black"
            preload="metadata"
            @play="syncFrom('r')"
            @pause="syncFrom('r')"
            @seeked="syncFrom('r')"
          ></video>
          <div class="flex items-center gap-2 px-3 py-2">
            <span class="rounded-full bg-cyan-400/10 px-2 py-0.5 text-2xs font-bold text-cyan-300">{{ $t('views.white3d.grey3d') }}</span>
            <StyledSelect
              v-if="cmpOptions.length > 1"
              v-model="cmpVideo"
              class="min-w-0 flex-1"
              :options="cmpOptions"
              :labels="cmpLabels"
            />
            <span v-else class="min-w-0 flex-1 truncate text-xs-plus text-slate-400" :title="cmpVideo">{{ cmpVideo.split('/').pop() }}</span>
            <button
              class="btn btn-danger btn-sm shrink-0"
              :title="$t('views.white3d.deleteCmp', { name: cmpVideo.split('/').pop() })"
              @click="delCmp"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path :d="icons.trash" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </div>
      </div>
    </section>

    <EmptyState v-if="!app.current" :title="$t('common.pickProjectFirst')" />

    <!-- 产物区 -->
    <section v-else>
      <h3 class="mb-2 text-xs font-bold text-slate-500">{{ $t('views.white3d.products') }}</h3>
      <div v-if="!hasProducts" class="glass p-12 text-center">
        <svg class="mx-auto mb-3 opacity-40" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="1.5">
          <path :d="icons.box3d" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <p class="text-sm text-slate-300">{{ $t('views.white3d.noProducts') }}</p>
        <p class="mt-2 text-xs text-slate-500">
          {{ $t('views.white3d.noProductsHint') }}<br />
          {{ $t('views.white3d.needMcp') }}
        </p>
      </div>

      <div v-else class="space-y-6">
        <!-- .blend -->
        <div v-if="blends.length">
          <h4 class="mb-2 text-2xs font-bold text-cyan-400">{{ $t('views.white3d.blends', { n: blends.length }) }}</h4>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <article
              v-for="p in blends"
              :key="p.path"
              class="glass glass-hover group relative p-3"
              :style="{ '--glow': GLOW }"
            >
              <DelBadge :path="p.path.replace(`projects/${app.current}/`, '')" :label="p.file" />
              <div class="mb-2 flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2">
                  <path :d="icons.box3d" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <span class="min-w-0 flex-1 truncate text-sm font-bold text-slate-100" :title="p.path">{{ p.file }}</span>
                <span class="shrink-0 rounded-full bg-cyan-400/10 px-2 py-0.5 text-2xs text-cyan-300">{{ p.sub }}</span>
              </div>
              <div class="flex gap-2">
                <button class="btn btn-sm flex-1 justify-center" :disabled="opening[p.path]" @click="openLocal(p)">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path :d="icons.play" stroke-linejoin="round" />
                  </svg>
                  {{ opening[p.path] ? $t('views.white3d.opening') : $t('views.white3d.openLocal') }}
                </button>
                <button class="btn btn-ghost btn-sm flex-1 justify-center" :disabled="rendering[p.path]" @click="renderCli(p)">
                  <svg v-if="rendering[p.path]" class="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M12 3a9 9 0 1 0 9 9" stroke-linecap="round" />
                  </svg>
                  <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path :d="icons.film" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                  {{ rendering[p.path] ? $t('views.white.rendering') : $t('views.white3d.cliRender') }}
                </button>
              </div>
            </article>
          </div>
        </div>

        <!-- gen_*.py -->
        <div v-if="scripts.length">
          <h4 class="mb-2 text-2xs font-bold text-cyan-400">{{ $t('views.white3d.scripts', { n: scripts.length }) }}</h4>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <article
              v-for="p in scripts"
              :key="p.path"
              class="glass glass-hover group relative cursor-pointer p-3"
              :style="{ '--glow': GLOW }"
              @click="viewCode(p)"
            >
              <DelBadge :path="p.path.replace(`projects/${app.current}/`, '')" :label="p.file"
                @deleted="(path) => { if (codeView?.path === 'projects/' + app.current + '/' + path) codeView = null }" />
              <div class="flex items-center gap-2">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2">
                  <path :d="icons.terminal" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <span class="min-w-0 flex-1 truncate text-xs font-bold text-slate-200" :title="p.path">{{ p.file }}</span>
              </div>
              <div class="mt-2 flex items-center justify-between gap-2">
                <span class="text-2xs text-slate-500">{{ $t('views.white3d.viewCode') }}</span>
                <button
                  class="btn btn-ghost btn-sm"
                  @click.stop="resendBuild(p)"
                >{{ $t('views.white3d.sendBlender') }}</button>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>

    <!-- 代码弹窗 -->
    <Teleport to="body">
      <div
        v-if="codeView"
        class="overlay p-6"
        @click.self="codeView = null"
      >
        <div class="glass modal-h flex w-full max-w-2xl flex-col p-4">
          <div class="mb-2 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2">
              <path :d="icons.terminal" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <code class="min-w-0 flex-1 truncate text-xs text-cyan-300" :title="codeView.path">{{ codeView.path }}</code>
            <button class="text-slate-500 hover:text-slate-200" @click="codeView = null">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path :d="icons.close" stroke-linecap="round" />
              </svg>
            </button>
          </div>
          <pre class="log-tail flex-1 overflow-auto rounded-lg bg-black/40 p-3">{{ codeLoading ? $t('views.white3d.reading') : codeView.text }}</pre>
        </div>
      </div>
    </Teleport>
  </div>
</template>

