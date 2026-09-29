<script setup lang="ts">
import { ref } from 'vue'
import { trackJob } from '../stores/jobs'
import { toast } from '../stores/app'
import { t } from '../i18n'
const emit = defineEmits<{ installed: [] }>()
const selected = ref(['base'])
const busy = ref(false)
const log = ref('')
const choices = [
  { id: 'base' },
  { id: 'depth' },
  { id: 'chatgpt' },
]
async function install() {
  busy.value = true
  log.value = ''
  try {
    const response = await fetch('/api/env/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groups: selected.value }) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.err || t('components.envInstaller.submitFailed'))
    toast(t('components.envInstaller.submitted'), 'ok')
    const result = await trackJob(data.id, t('components.envInstaller.jobLabel'))
    log.value = result.out || result.err || t('components.envInstaller.finished')
    emit('installed')
  } catch (error) { toast(String(error), 'err'); log.value = String(error) }
  finally { busy.value = false }
}
</script>
<template>
  <section class="glass mb-5 p-5">
    <h3 class="font-bold text-sky-200">{{ $t('components.envInstaller.title') }}</h3>
    <p class="my-3 text-xs leading-relaxed text-slate-400">{{ $t('components.envInstaller.intro') }}</p>
    <div class="flex flex-wrap gap-4">
      <label v-for="choice in choices" :key="choice.id" class="flex items-center gap-2 text-sm">
        <input v-model="selected" type="checkbox" :value="choice.id" :disabled="busy">{{ $t('components.envInstaller.' + choice.id) }}
      </label>
    </div>
    <button class="btn mt-4" :disabled="busy || !selected.length" @click="install">{{ busy ? $t('components.envInstaller.installing') : $t('components.envInstaller.install') }}</button>
    <pre v-if="log" class="mt-3 max-h-60 overflow-auto whitespace-pre-wrap text-xs">{{ log }}</pre>
  </section>
</template>
