<script setup lang="ts">
// -*- coding: utf-8 -*-
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { LOCALES, setLocale, type Locale } from './i18n'
import { applyDocTitle } from './router'
import ParticleBg from './components/ParticleBg.vue'
import JobDrawer from './components/JobDrawer.vue'
import { icons } from './components/icons'
import { loadBasics, app, toasts, selectProject, currentProject, toast } from './stores/app'
import { fetchAuthStatus, authLogout, checkUpdate, applyUpdate, rollbackUpdate, restartServer, authReady, isGuest, type UpdateCheck } from './api'

const route = useRoute()
const { t, locale } = useI18n()
watch(locale, () => applyDocTitle())
const router = useRouter()
/* 登录页不渲染工作台外壳（N85） */
const showShell = computed(() => route.path !== '/login')

/* GitHub 更新检查（N86）：左下角指示器，1 小时轮询 */
const update = ref<UpdateCheck | null>(null)
const updateOpen = ref(false)
const updateBusy = ref(false)
let updateTimer = 0
async function refreshUpdate(force = false) {
  if (route.path === '/login') return
  try { update.value = await checkUpdate(force) } catch { /* 未登录/网络失败静默，下轮再试 */ }
}
function startUpdatePoll() {
  void refreshUpdate()
  updateTimer = window.setInterval(() => void refreshUpdate(), 60 * 60 * 1000)
}
async function doUpdate() {
  updateBusy.value = true
  try {
    const r = await applyUpdate()
    if (!r.updated) { toast(r.note || t('app.update.upToDate'), 'info'); return }
    // F06：含前端源码改动时先提示手动重建 dist（dist 不入库），由用户决定何时重启
    if (r.needs_build) {
      toast(t('app.update.needsBuild'), 'err', 12000)
      return
    }
    toast(t('app.update.restarting'), 'ok', 6000)
    setTimeout(() => void restartServer(), 800)
  } catch (e) { toast(e instanceof Error ? e.message : t('app.update.failed'), 'err', 6000) }
  finally { updateBusy.value = false }
}
async function doRollback() {
  if (!confirm(t('app.update.rollbackConfirm'))) return
  updateBusy.value = true
  try {
    const r = await rollbackUpdate()
    toast(t('app.update.rolledBack', { ref: r.rolled_back_to }), 'ok', 6000)
    setTimeout(() => void restartServer(), 800)
  } catch (e) { toast(e instanceof Error ? e.message : t('app.update.rollbackFailed'), 'err', 6000) }
  finally { updateBusy.value = false }
}
async function doLogout() {
  try { await authLogout() } catch { /* 会话可能已失效 */ }
  location.href = '/login'
}
/* 认证守卫：已配置口令且未登录 → 登录页（服务端已 302，这里兜底直链场景） */
onMounted(async () => {
  try {
    const s = await fetchAuthStatus()
    if (!s.authed) {
      if (route.path !== '/login') router.replace('/login')
      return                       // 未登录：不轮询更新、不拉业务数据
    }
    startUpdatePoll()
  } catch { /* /login 页自身 */ }
})
onBeforeUnmount(() => window.clearInterval(updateTimer))
const theme = computed(() => ({
  c1: (route.meta.c1 as string) || '#22d3ee',
  c2: (route.meta.c2 as string) || '#818cf8'
}))

const navItems = [
  { key: 'home', to: '/', icon: 'home', group: '' },
  { key: 'studio', to: '/studio', icon: 'chat', group: 'make' },
  { key: 'studioAsset', to: '/studio/asset', icon: 'box3d', group: 'make' },
  { key: 'studioShots', to: '/studio/shots', icon: 'clapper', group: 'make' },
  { key: 'voices', to: '/studio/asset/voices', icon: 'wave', group: 'make' },
  { key: 'acting', to: '/acting', icon: 'user', group: 'make' },
  { key: 'package', to: '/package', icon: 'box3d', group: 'make' },
  { key: 'create', to: '/create', icon: 'wand', group: 'make' },
  { key: 'free', to: '/create/free', icon: 'wand', group: 'make' },
  { key: 'lapian', to: '/lapian', icon: 'clapper', group: 'lapian' },
  { key: 'lines', to: '/lines', icon: 'chat', group: 'lapian' },
  { key: 'frames', to: '/frames', icon: 'frames', group: 'lapian' },
  { key: 'depth', to: '/depth', icon: 'wave', group: 'lapian' },
  { key: 'explain', to: '/explain', icon: 'book', group: 'lapian' },
  { key: 'white', to: '/white', icon: 'cube', group: 'system' },
  { key: 'white3d', to: '/white3d', icon: 'box3d', group: 'system' },
  { key: 'skills', to: '/skills', icon: 'book', group: 'system' },
  { key: 'env', to: '/env', icon: 'server', group: 'system' },
  { key: 'billing', to: '/billing', icon: 'chart', group: 'system' }
]

watch(
  theme,
  (t) => {
    const el = document.documentElement
    el.style.setProperty('--accent', t.c1)
    el.style.setProperty('--c1', t.c1)
    el.style.setProperty('--c2', t.c2)
  },
  { immediate: true }
)

const toastColor = { ok: '#34d399', err: '#f87171', info: '#38bdf8' } as const

/* /login 页不发业务请求（未登录时全是 401 噪音）；进入工作台后再加载 */
// 挂载竞态：等首次认证结论再拉基础数据，未登录直链时一个 401 都不打
onMounted(() => { void authReady.then((a) => { if (a && showShell.value) void loadBasics() }) })
watch(showShell, (v) => { if (v && !isGuest()) void loadBasics() })
</script>

<template>
  <ParticleBg />
  <div class="relative z-10 flex h-full">
    <!-- 侧边栏（登录页隐藏；路由出口必须常驻，否则 /login 无处渲染） -->
    <aside
      v-if="showShell"
      class="flex w-64 shrink-0 flex-col border-r border-line-soft bg-black/30 backdrop-blur-xl"
    >
      <div class="px-5 pb-4 pt-6">
        <div class="flex items-center gap-2.5">
          <div
            class="flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-lg"
            :style="{ background: `linear-gradient(130deg, ${theme.c1}, ${theme.c2})` }"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path :d="icons.film" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div>
            <div class="text-sm font-extrabold tracking-wide text-slate-100">{{ t('app.brand') }}</div>
            <div class="text-2xs tracking-[0.2em] text-slate-500">SLATE · PREVIS WORKBENCH</div>
          </div>
        </div>
      </div>

      <nav class="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3" :aria-label="t('app.navAria')">
        <template v-for="r in navItems" :key="r.key">
          <div v-if="r.group && r.group !== (navItems[navItems.indexOf(r)-1]?.group || '')"
            class="mt-3 mb-1 px-3 text-2xs font-black tracking-[0.25em] text-slate-500">{{ t('nav.groups.' + r.group) }}</div>
          <RouterLink
          :to="r.to"
          v-slot="{ isActive, navigate }"
          custom
        >
          <button
            class="group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-all duration-200"
            :class="isActive
              ? 'font-bold text-white shadow-lg'
              : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'"
            :style="isActive ? { background: `linear-gradient(110deg, color-mix(in srgb, ${theme.c1} 26%, transparent), color-mix(in srgb, ${theme.c2} 14%, transparent))`, boxShadow: `inset 2px 0 0 ${theme.c1}` } : {}"
            @click="navigate"
          >
            <svg
              width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2"
              :style="isActive ? { color: theme.c1 } : {}"
              class="transition-transform duration-200 group-hover:scale-110"
            ><path :d="icons[r.icon]" stroke-linecap="round" stroke-linejoin="round"/></svg>
            {{ t('nav.' + r.key) }}
          </button>
        </RouterLink>
        </template>
      </nav>

      <!-- 当前项目 -->
      <div class="border-t border-line-soft p-3">
        <label class="mb-1 block text-2xs text-slate-500">{{ t('app.currentProject') }}</label>
        <select class="select" :value="app.current" @change="selectProject(($event.target as HTMLSelectElement).value)">
          <option value="" disabled>{{ t('app.pickProject') }}</option>
          <option v-for="p in app.projects" :key="p.name" :value="p.name">{{ p.name }}</option>
        </select>
        <div v-if="currentProject" class="mt-2 truncate text-2xs text-slate-500" :title="currentProject.name">
          projects/{{ currentProject.name }}/
        </div>
      </div>

      <!-- GitHub 更新检查（左下角，1 小时轮询）+ 退出登录 -->
      <div class="mt-auto border-t border-white/5 p-3 text-[11px]">
        <div v-if="update?.supported" class="mb-2">
          <button class="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 hover:bg-white/5" @click="updateOpen = !updateOpen">
            <span class="h-1.5 w-1.5 rounded-full" :class="update.behind ? 'bg-amber-400' : (update.ahead ? 'bg-sky-400' : 'bg-emerald-400')"></span>
            <span :class="update.behind ? 'text-amber-300' : (update.ahead ? 'text-sky-300' : 'text-slate-500')">
              {{ update.behind ? t('app.update.behind', { n: update.behind }) : (update.ahead ? t('app.update.ahead', { n: update.ahead }) : t('app.update.latest')) }}
            </span>
          </button>
          <div v-if="updateOpen && update.behind" class="mt-1 space-y-1 rounded-lg bg-black/40 p-2">
            <div v-for="c in update.commits" :key="c" class="truncate font-mono text-slate-400" :title="c">{{ c }}</div>
            <button class="btn btn-sm w-full" :disabled="updateBusy" @click="doUpdate">{{ t('app.update.pull') }}</button>
            <button class="btn btn-ghost btn-sm w-full" :disabled="updateBusy" :title="t('app.update.rollbackTitle')" @click="doRollback">{{ t('app.update.rollback') }}</button>
          </div>
        </div>
        <div class="flex items-center justify-between gap-2">
          <button class="text-slate-600 hover:text-slate-300" @click="doLogout">{{ t('app.logout') }}</button>
          <select class="rounded bg-transparent text-slate-500 hover:text-slate-300 focus:outline-none" :aria-label="t('app.language')" :title="t('app.language')"
            :value="locale" @change="setLocale(($event.target as HTMLSelectElement).value as Locale)">
            <option v-for="l in LOCALES" :key="l.code" :value="l.code" class="bg-slate-900">{{ l.label }}</option>
          </select>
        </div>
      </div>
    </aside>

    <!-- 主区 -->
    <main :class="showShell ? 'flex-1 overflow-y-auto' : 'flex-1 overflow-y-auto p-4'">
      <RouterView v-slot="{ Component }">
        <!-- 页面可能包含 Teleport/多根节点（创作页的 OverlayViewer），不包 Transition，
             避免 Vue 在多根组件切换时停留在离场状态。 -->
        <component :is="Component" :key="route.path" />
      </RouterView>
    </main>
  </div>

  <JobDrawer v-if="showShell" />

  <!-- Toast -->
  <Teleport to="body">
    <div aria-live="polite" class="pointer-events-none fixed left-1/2 top-5 z-[10000] flex max-h-[85vh] w-[min(90vw,720px)] -translate-x-1/2 flex-col items-center gap-2 overflow-y-auto">
      <TransitionGroup name="fade-slide">
        <div
          v-for="t in toasts"
          :key="t.id"
          :role="t.kind === 'err' ? 'alert' : 'status'"
          class="glass pointer-events-auto flex max-w-full items-center gap-2 whitespace-pre-wrap break-words px-4 py-2 text-sm font-semibold text-slate-100"
          :style="{ boxShadow: `0 8px 30px -8px ${toastColor[t.kind]}`, borderColor: `${toastColor[t.kind]}55` }"
        >
          <span class="h-2 w-2 rounded-full" :style="{ background: toastColor[t.kind] }" />
          {{ t.text }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

