// -*- coding: utf-8 -*-
import { createRouter, createWebHistory } from 'vue-router'
import { t } from './i18n'

export const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('./views/LoginView.vue'),
    meta: { title: 'nav.login', c1: '#22d3ee', c2: '#818cf8', icon: 'home' }
  },
  {
    path: '/',
    name: 'home',
    component: () => import('./views/HomeView.vue'),
    meta: { title: 'nav.home', c1: '#22d3ee', c2: '#818cf8', icon: 'home' }
  },
  {
    path: '/lapian',
    name: 'lapian',
    component: () => import('./views/LapianView.vue'),
    meta: { title: 'nav.lapian', c1: '#e879f9', c2: '#f472b6', icon: 'clapper' }
  },
  {
    path: '/lines',
    name: 'lines',
    component: () => import('./views/LinesView.vue'),
    meta: { title: 'nav.lines', c1: '#fbbf24', c2: '#fb923c', icon: 'chat' }
  },
  {
    path: '/frames',
    name: 'frames',
    component: () => import('./views/FramesView.vue'),
    meta: { title: 'nav.frames', c1: '#34d399', c2: '#22d3ee', icon: 'frames' }
  },
  {
    path: '/depth',
    name: 'depth',
    component: () => import('./views/DepthView.vue'),
    meta: { title: 'nav.depth', c1: '#a78bfa', c2: '#818cf8', icon: 'wave' }
  },
  {
    path: '/acting',
    name: 'acting',
    component: () => import('./views/ActingView.vue'),
    meta: { title: 'nav.acting', c1: '#f59e0b', c2: '#ec4899', icon: 'user' }
  },
  {
    path: '/white',
    name: 'white',
    component: () => import('./views/WhiteView.vue'),
    meta: { title: 'nav.white', c1: '#38bdf8', c2: '#34d399', icon: 'cube' }
  },
  {
    path: '/white3d',
    name: 'white3d',
    component: () => import('./views/White3dView.vue'),
    meta: { title: 'nav.white3d', c1: '#22d3ee', c2: '#818cf8', icon: 'box3d' }
  },
  {
    path: '/studio',
    name: 'studio',
    component: () => import('./views/StudioView.vue'),
    meta: { title: 'nav.studio', c1: '#ec4899', c2: '#f472b6', icon: 'chat' }
  },
  {
    path: '/studio/shots',
    name: 'studioShots',
    component: () => import('./views/StudioShotsView.vue'),
    meta: { title: 'nav.studioShots', c1: '#f472b6', c2: '#e879f9', icon: 'clapper' }
  },
  {
    path: '/studio/asset',
    name: 'studioAsset',
    component: () => import('./views/StudioAssetView.vue'),
    meta: { title: 'nav.studioAsset', c1: '#a78bfa', c2: '#ec4899', icon: 'box3d' }
  },
  {
    path: '/studio/asset/voices', name: 'voiceAssets', component: () => import('./views/VoiceAssetsView.vue'),
    meta: { title: 'nav.voices', c1: '#a78bfa', c2: '#ec4899', icon: 'box3d' }
  },
  {
    path: '/studio/redo', name: 'shotRedo', component: () => import('./views/ShotRedoView.vue'),
    meta: { title: 'nav.shotRedo', c1: '#f472b6', c2: '#a78bfa', icon: 'frames' }
  },
  {
    path: '/create/free', name: 'freeCreate', component: () => import('./views/CreateView.vue'),
    meta: { title: 'nav.free', c1: '#a78bfa', c2: '#ec4899', icon: 'clapper' }
  },
  {
    path: '/blender',
    name: 'blender',
    component: () => import('./views/BlenderView.vue'),
    meta: { title: 'nav.blender', c1: '#fb923c', c2: '#fbbf24', icon: 'wrench' }
  },
  {
    path: '/explain',
    name: 'explain',
    component: () => import('./views/ExplainView.vue'),
    meta: { title: 'nav.explain', c1: '#a78bfa', c2: '#e879f9', icon: 'book' }
  },
  {
    path: '/skills',
    name: 'skills',
    component: () => import('./views/SkillsView.vue'),
    meta: { title: 'nav.skills', c1: '#8b5cf6', c2: '#ec4899', icon: 'book' }
  },
  {
    path: '/env',
    name: 'env',
    component: () => import('./views/EnvView.vue'),
    meta: { title: 'nav.env', c1: '#f59e0b', c2: '#fbbf24', icon: 'server' }
  },
  {
    path: '/billing',
    name: 'billing',
    component: () => import('./views/BillingView.vue'),
    meta: { title: 'nav.billing', c1: '#34d399', c2: '#22d3ee', icon: 'chart' }
  },
  {
    path: '/package',
    name: 'package',
    component: () => import('./views/PackageView.vue'),
    meta: { title: 'nav.package', c1: '#22d3ee', c2: '#6ee7b7', icon: 'box3d' }
  },
  {
    path: '/create',
    name: 'create',
    component: () => import('./views/ProductionStudioView.vue'),
    meta: { title: 'nav.create', c1: '#ec4899', c2: '#f472b6', icon: 'wand' }
  }
]

export const router = createRouter({
  history: createWebHistory(),
  routes
})

/** meta.title 存的是 i18n 键；切换语言时 App 会调用 applyDocTitle 重算。 */
export function applyDocTitle(key = router.currentRoute.value.meta.title as string | undefined) {
  document.title = `${key ? t(key) : ''} · ${t('app.docTitle')}`
}

router.afterEach((to) => applyDocTitle(to.meta.title as string | undefined))
