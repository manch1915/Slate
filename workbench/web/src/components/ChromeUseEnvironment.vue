<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { t } from '../i18n'
const state = ref<Record<string, any>>({})
const message = ref('')
async function refresh() {
  try {
    const response = await fetch('/api/env/chrome-use')
    const data = await response.json()
    if (!response.ok) throw new Error(data.err || t('components.chromeUse.checkFailed'))
    state.value = data.status
  } catch (e) { message.value = String(e) }
}
async function copy() {
  try { await navigator.clipboard.writeText(state.value.install_command); message.value = t('components.chromeUse.copied') }
  catch { message.value = t('components.chromeUse.copyManual') }
}
onMounted(refresh)
</script>
<template>
  <section class="glass mb-5 p-5">
    <div class="flex flex-wrap items-center gap-3">
      <h3 class="font-bold text-sky-200">ChatGPT · chrome-use</h3>
      <span :class="state.installed ? 'text-emerald-300' : 'text-amber-300'">{{ state.installed ? $t('components.chromeUse.installed') : $t('components.chromeUse.notInstalled') }}</span>
      <button class="btn btn-sm" @click="refresh">{{ $t('components.chromeUse.recheck') }}</button>
      <a class="text-xs text-sky-300" href="https://github.com/leeguooooo/image-use" target="_blank" rel="noopener" :title="$t('components.chromeUse.providerTitle')">{{ $t('components.chromeUse.provider') }}</a>
    </div>
    <p class="my-3 text-xs leading-relaxed text-slate-400">{{ $t('components.chromeUse.intro') }}</p>
    <div class="flex flex-wrap gap-2">
      <button class="btn btn-sm" :disabled="!state.install_command" @click="copy">{{ $t('components.chromeUse.copyCmd') }}</button>
      <a class="btn btn-sm" :href="state.extension_url" target="_blank" rel="noopener">{{ $t('components.chromeUse.installExt') }}</a>
      <a class="btn btn-sm" :href="state.extension_download" target="_blank" rel="noopener">{{ $t('components.chromeUse.downloadExt') }}</a>
      <a class="btn btn-sm" href="https://chatgpt.com/" target="_blank" rel="noopener">{{ $t('components.chromeUse.openChatgpt') }}</a>
    </div>
    <pre class="my-3 overflow-auto rounded-lg bg-black/20 p-3 text-xs text-sky-200 select-all">{{ state.install_command }}</pre>
    <p class="text-xs text-slate-500">{{ state.note }} {{ $t('components.chromeUse.afterInstall') }}</p>
    <p v-if="state.verification?.note" class="mt-2 text-xs text-amber-200">{{ $t('components.chromeUse.verified', { note: state.verification.note }) }}</p>
    <p v-if="message" class="mt-2 text-xs text-amber-200">{{ message }}</p>
  </section>
</template>
