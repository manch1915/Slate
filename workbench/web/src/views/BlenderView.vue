<script setup lang="ts">
// -*- coding: utf-8 -*-
/** Blender 安装与配置：状态自检 + 安装指引（Blender / Blender MCP）+ 工作台一键流程说明。 */
import { ref, computed, onMounted } from 'vue'
import { fetchEnv, type EnvInfo } from '../api'
import { toast } from '../stores/app'
import { icons } from '../components/icons'
import { t } from '../i18n'

const GLOW = 'rgba(251,146,60,0.35)'

const env = ref<EnvInfo | null>(null)
const detecting = ref(false)

async function detect() {
  detecting.value = true
  try {
    env.value = await fetchEnv()
  } catch {
    toast(t('views.blender.detectFailed'), 'err')
  } finally {
    detecting.value = false
  }
}

onMounted(detect)

const FLOW = computed(() => (['①', '②', '③', '④'] as const).map((n, i) => ({
  n, t: t(`views.blender.flow${i + 1}.t`), d: t(`views.blender.flow${i + 1}.d`)
})))
</script>

<template>
  <div class="page">
    <header class="mb-6">
      <h1 class="grad-text text-2xl font-black">{{ $t('views.blender.title') }}</h1>
      <p class="mt-1 text-xs text-slate-500">{{ $t('views.blender.lead') }}</p>
    </header>

    <!-- 顶部状态卡 -->
    <section class="glass mb-5 flex flex-wrap items-center gap-4 p-5" :style="{ '--glow': GLOW }">
      <template v-if="env">
        <div class="flex items-center gap-2.5">
          <span
            class="flex h-10 w-10 items-center justify-center rounded-xl text-white"
            :style="{ background: env.blender ? 'linear-gradient(130deg,#fb923c,#fbbf24)' : 'linear-gradient(130deg,#475569,#334155)' }"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path :d="icons.box3d" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
          <div>
            <div class="text-2xs tracking-wider text-slate-500">BLENDER</div>
            <div class="max-w-72 truncate text-sm font-bold" :class="env.blender ? 'text-slate-100' : 'text-rose-300'">
              {{ env.blender || $t('views.blender.notInstalled') }}
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2.5">
          <span class="h-2.5 w-2.5 rounded-full" :class="env.mcp ? 'bg-emerald-400 pulse-dot' : 'bg-rose-400'"></span>
          <div>
            <div class="text-2xs tracking-wider text-slate-500">BLENDER MCP</div>
            <div class="text-sm font-bold" :class="env.mcp ? 'text-emerald-300' : 'text-rose-300'">
              {{ env.mcp ? $t('views.blender.online') : $t('views.blender.offline') }} · 127.0.0.1:9876
            </div>
          </div>
        </div>
      </template>
      <div v-else class="text-sm text-slate-500">{{ detecting ? $t('views.blender.detecting') : $t('views.blender.unavailable') }}</div>
      <div class="flex-1"></div>
      <button class="btn btn-ghost btn-sm" :disabled="detecting" @click="detect">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path :d="icons.refresh" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {{ detecting ? $t('views.blender.detecting') : $t('views.blender.redetect') }}
      </button>
    </section>

    <!-- 步骤 1：安装 Blender -->
    <section class="glass glass-hover mb-5 p-5" :style="{ '--glow': GLOW }">
      <div class="flex items-start gap-4">
        <span
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-black text-slate-950"
          style="background: linear-gradient(130deg, #fb923c, #fbbf24)"
        >1</span>
        <div class="min-w-0 flex-1">
          <h2 class="text-base font-bold text-slate-100">{{ $t('views.blender.step1') }}</h2>
          <p class="mt-1.5 text-xs leading-relaxed text-slate-400">
            <i18n-t keypath="views.blender.step1a" tag="span">
              <template #link><a class="mx-1 font-semibold text-orange-300 underline" href="https://www.blender.org/download/" target="_blank" rel="noopener">blender.org/download</a></template>
              <template #path><code class="rounded bg-orange-400/10 px-1.5 py-0.5 font-mono text-orange-200">J:\Blender 5.2\blender.exe</code></template>
            </i18n-t>
          </p>
          <p class="mt-1.5 text-xs leading-relaxed text-slate-500">
            {{ $t('views.blender.step1b') }}
          </p>
        </div>
      </div>
    </section>

    <!-- 步骤 2：安装 Blender MCP -->
    <section class="glass glass-hover mb-5 p-5" :style="{ '--glow': GLOW }">
      <div class="flex items-start gap-4">
        <span
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-black text-slate-950"
          style="background: linear-gradient(130deg, #fbbf24, #fde68a)"
        >2</span>
        <div class="min-w-0 flex-1">
          <h2 class="text-base font-bold text-slate-100">{{ $t('views.blender.step2') }}</h2>
          <p class="mt-1.5 text-xs leading-relaxed text-slate-400">
            <i18n-t keypath="views.blender.step2a" tag="span">
              <template #link><a class="mx-1 font-semibold text-orange-300 underline" href="https://github.com/ahujasid/blender-mcp" target="_blank" rel="noopener">github.com/ahujasid/blender-mcp</a></template>
              <template #cmd><code class="rounded bg-orange-400/10 px-1 font-mono text-orange-200">uvx blender-mcp</code></template>
            </i18n-t>
          </p>
          <ol class="mt-3 space-y-2.5">
            <li class="flex items-start gap-2.5">
              <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-400/15 text-2xs font-black text-orange-300">①</span>
              <p class="text-xs leading-relaxed text-slate-400">
                <i18n-t keypath="views.blender.step2s1" tag="span">
                  <template #prefs><b class="text-slate-200">Edit &gt; Preferences &gt; Add-ons</b></template>
                  <template #install><b class="text-slate-200">Install from Disk…</b></template>
                  <template #addon><code class="rounded bg-orange-400/10 px-1 font-mono text-orange-200">addon.py</code></template>
                </i18n-t>
              </p>
            </li>
            <li class="flex items-start gap-2.5">
              <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-400/15 text-2xs font-black text-orange-300">②</span>
              <p class="text-xs leading-relaxed text-slate-400">
                <i18n-t keypath="views.blender.step2s2" tag="span">
                  <template #n><b class="text-slate-200">N</b></template>
                  <template #panel><b class="text-slate-200">BlenderMCP</b></template>
                  <template #connect><b class="text-slate-200">Connect to Claude</b></template>
                  <template #noClaude><b class="text-orange-300">{{ $t('views.blender.noClaude') }}</b></template>
                </i18n-t>
              </p>
            </li>
            <li class="flex items-start gap-2.5">
              <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-400/15 text-2xs font-black text-orange-300">③</span>
              <p class="text-xs leading-relaxed text-slate-400">
                {{ $t('views.blender.step2s3') }}
              </p>
            </li>
          </ol>
        </div>
      </div>
    </section>

    <!-- 步骤 3：工作台怎么用它 -->
    <section class="glass glass-hover p-5" :style="{ '--glow': GLOW }">
      <div class="flex items-start gap-4">
        <span
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-black text-slate-950"
          style="background: linear-gradient(130deg, #f97316, #fb923c)"
        >3</span>
        <div class="min-w-0 flex-1">
          <h2 class="text-base font-bold text-slate-100">{{ $t('views.blender.step3') }}</h2>
          <p class="mt-1.5 text-xs leading-relaxed text-slate-400">
            <i18n-t keypath="views.blender.step3a" tag="span">
              <template #page><RouterLink to="/white3d" class="mx-1 font-semibold text-orange-300 underline">{{ $t('nav.white3d') }}</RouterLink></template>
            </i18n-t>
          </p>
          <div class="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <div
              v-for="f in FLOW"
              :key="f.n"
              class="rounded-xl border border-line-soft bg-black/25 p-3"
            >
              <div class="text-sm font-black text-orange-300">{{ f.n }} {{ f.t }}</div>
              <p class="mt-1 text-xs-plus leading-relaxed text-slate-500">{{ f.d }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

