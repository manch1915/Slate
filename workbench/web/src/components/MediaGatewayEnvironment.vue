<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { toast } from '../stores/app'
import { t } from '../i18n'
const base = ref(''), ttl = ref(86400), busy = ref(false)
onMounted(async () => {
  try {
    const r = await fetch('/api/media-gateway'); if (!r.ok) throw new Error(t('components.mediaGateway.loadFailed'))
    const cfg = await r.json(); base.value = cfg.base_url; ttl.value = cfg.ttl_seconds
  } catch(e) {toast(String(e),'err')}
})
async function save() {
  busy.value = true
  try {
    const r = await fetch('/api/media-gateway',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base_url:base.value,ttl_seconds:ttl.value})})
    const cfg = await r.json(); if (!r.ok) throw new Error(cfg.err || t('components.mediaGateway.saveFailed'))
    base.value = cfg.base_url; toast(t('components.mediaGateway.saved'),'ok')
  } catch(e) {toast(String(e),'err')} finally {busy.value=false}
}
</script>
<template>
  <section class="glass space-y-3 p-5">
    <h3 class="font-bold text-amber-200">{{ $t('components.mediaGateway.title') }}</h3>
    <label class="block text-sm">{{ $t('components.mediaGateway.baseLabel') }}<input v-model="base" class="input mt-2 w-full" placeholder="https://media.example.com:443/previs" /></label>
    <label class="block text-sm">{{ $t('components.mediaGateway.ttlLabel') }}<input v-model.number="ttl" class="input ml-2" type="number" min="3600" max="604800" /></label>
    <p class="text-xs text-slate-400">{{ $t('components.mediaGateway.generated', { base: base || $t('components.mediaGateway.basePlaceholder') }) }}</p>
    <p class="text-xs text-amber-200">{{ $t('components.mediaGateway.warning') }}</p>
    <button class="btn" :disabled="busy" @click="save">{{ busy ? $t('components.mediaGateway.saving') : $t('components.mediaGateway.save') }}</button>
  </section>
</template>
