<script setup lang="ts">
// -*- coding: utf-8 -*-
/** 登录/首次设置管理员口令（N85）。未配置口令时展示设置模式。 */
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchAuthStatus, authSetup, authLogin, markAuthed } from '../api'
import { startJobDiscovery } from '../stores/jobs'
import { t } from '../i18n'

const route = useRoute(), router = useRouter()
const configured = ref(true), password = ref(''), confirm = ref('')
const busy = ref(false), error = ref('')
const isSetup = ref(false)

onMounted(async () => {
  isSetup.value = route.query.mode === 'setup'
  try {
    const s = await fetchAuthStatus()
    configured.value = s.configured
    if (s.authed) { router.replace('/'); return }
    if (!s.configured) isSetup.value = true
  } catch { /* 状态读取失败按登录模式展示 */ }
})

async function submit() {
  error.value = ''
  if (isSetup.value && password.value !== confirm.value) { error.value = t('views.login.mismatch'); return }
  busy.value = true
  try {
    if (isSetup.value) await authSetup(password.value)
    else await authLogin(password.value)
    markAuthed()          // SPA 内跳转不刷新模块：复位静默闸并恢复任务轮询
    startJobDiscovery()
    router.replace('/')
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('views.login.failed')
  } finally { busy.value = false }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-[#0b111c] px-4">
    <div class="w-full max-w-sm">
      <div class="mb-6 text-center">
        <div class="grad-text text-2xl font-black tracking-widest">{{ $t('app.brand') }}</div>
        <p class="mt-2 text-xs text-slate-500">{{ isSetup ? $t('views.login.setupHint') : $t('views.login.loginHint') }}</p>
      </div>
      <form class="glass space-y-4 p-6" @submit.prevent="submit">
        <label class="block text-xs text-slate-400">{{ $t('views.login.password') }}
          <input v-model="password" type="password" class="input mt-1" autofocus :placeholder="$t('views.login.minLen')" required />
        </label>
        <label v-if="isSetup" class="block text-xs text-slate-400">{{ $t('views.login.confirm') }}
          <input v-model="confirm" type="password" class="input mt-1" required />
        </label>
        <p v-if="error" class="rounded-lg bg-rose-400/10 px-3 py-2 text-xs text-rose-300">{{ error }}</p>
        <button class="btn w-full" :disabled="busy || !password">{{ busy ? $t('views.login.busy') : isSetup ? $t('views.login.setupBtn') : $t('views.login.loginBtn') }}</button>
        <p class="text-center text-[10px] leading-relaxed text-slate-600">{{ $t('views.login.storage') }}</p>
      </form>
    </div>
  </div>
</template>
