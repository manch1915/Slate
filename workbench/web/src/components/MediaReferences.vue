<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from '../stores/app'
import { t } from '../i18n'
const props = defineProps<{project:string; kind:'audio'|'video'; modelValue:string; limit:number}>()
const emit = defineEmits<{'update:modelValue':[string]; change:[]}>()
const items = ref<{path:string;name:string}[]>([]), uploading = ref(false)
const title = computed(() => props.kind === 'audio' ? t('components.mediaRefs.audio') : t('components.mediaRefs.video'))
const lines = computed(() => props.modelValue.split(/\r?\n/).map(s=>s.trim()).filter(Boolean))
function update(value:string) {emit('update:modelValue',value);emit('change')}
function add(value:string) {
  if (!value) return
  if (lines.value.includes(value)) return
  if (lines.value.length >= props.limit) {toast(t('components.mediaRefs.limit', { title: title.value, n: props.limit }),'err');return}
  update([...lines.value,value].join('\n'))
}
async function load() {
  const project = props.project
  items.value = []
  if (!project) return
  try {
    const r = await fetch(`/api/reference-media?project=${encodeURIComponent(project)}&kind=${props.kind}`)
    const data = await r.json()
    if (!r.ok) throw new Error(data.err || t('components.mediaRefs.listFailed'))
    if (project === props.project) items.value = data.items
  } catch(e) {toast(String(e),'err')}
}
watch(() => [props.project,props.kind],load,{immediate:true})
async function upload(event:Event) {
  const input = event.target as HTMLInputElement, files = Array.from(input.files || [])
  input.value = ''
  if (!files.length) return
  if (files.length + lines.value.length > props.limit) {toast(t('components.mediaRefs.limit', { title: title.value, n: props.limit }),'err');return}
  const project = props.project
  uploading.value = true
  const uploaded:string[] = []
  try {
    for (const file of files) {
      const r = await fetch(`/api/reference-media/upload?project=${encodeURIComponent(project)}&kind=${props.kind}&name=${encodeURIComponent(file.name)}`,
        {method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file})
      const data = await r.json()
      if (!r.ok) throw new Error(data.err || t('common.uploadFailed'))
      uploaded.push(data.path)
    }
    toast(t('components.mediaRefs.uploaded', { title: title.value, n: uploaded.length }),'ok')
  } catch(e) {toast(t('components.mediaRefs.uploadFailed', { title: title.value, err: String(e) }),'err')}
  finally {
    if (project === props.project && uploaded.length) update([...lines.value,...uploaded].join('\n'))
    uploading.value = false
    await load()
  }
}
</script>
<template>
  <section class="space-y-2 rounded-lg border border-white/10 p-2">
    <b>{{ $t('components.mediaRefs.header', { title, n: lines.length, limit }) }}</b>
    <label class="block">{{ $t('components.mediaRefs.urls') }}<textarea class="control" rows="2" :value="modelValue" @change="update(($event.target as HTMLTextAreaElement).value)" /></label>
    <label class="btn block cursor-pointer text-center">{{ uploading ? $t('common.uploading') : $t('components.mediaRefs.uploadLocal') }}<input class="hidden" type="file" multiple :accept="kind === 'audio' ? 'audio/*' : 'video/*'" :disabled="uploading || !project" @change="upload" /></label>
    <select class="control" :disabled="uploading" @change="add(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value=''">
      <option value="">{{ $t('components.mediaRefs.pick') }}</option><option v-for="item in items" :key="item.path" :value="item.path">{{ item.path }}</option>
    </select>
    <p class="text-slate-400">{{ $t('components.mediaRefs.note') }}</p>
  </section>
</template>
