<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { app, projectFiles, toast } from '../stores/app'
import { getJSON, mediaUrl } from '../api'
import { trackJob } from '../stores/jobs'
import { studioPost, submitStudioJob } from '../utils/productionStudio'
import { useBoardSelection } from '../utils/useBoardSelection'
import { t, te } from '../i18n'

interface State {id: string; label: string; image?: string}
interface Variant {voice_asset_id: string; revision: number; name: string; state?: string}
interface Voice {id: string; revision: number; name: string; voice_id: string; sample: string; tts_verified: boolean; derived_from?: string; character_id?: string; origin?: string; vendor_id?: string; description?: string}
interface Actor {id: string; name: string; voice?: string; voice_binding?: {voice_asset_id: string; revision: number}; voice_variants?: Variant[]; states?: State[]}
interface Catalog {voice_id: string; voice_name?: string; description?: string[]; category: string; preview_audio?: string}

const actors = ref<Actor[]>([]), voices = ref<Voice[]>([]), catalog = ref<Catalog[]>([])
const actorId = ref(''), search = ref('')
const description = ref(''), preview = ref(t('views.voices.previewText')), voiceName = ref('')
const busy = ref(false), error = ref(''), board = ref('')
const stateSel = ref<Record<string, string>>({})
const fileInput = ref<HTMLInputElement | null>(null), uploading = ref(false)
const actor = computed(() => actors.value.find(a => a.id === actorId.value))
const speechVoice = ref('')
watch(actorId, () => { speechVoice.value = ''; syncStateSel() })
function syncStateSel() {
  const map: Record<string, string> = {}
  for (const s of actor.value?.states || []) map[s.id] = actor.value?.voice_variants?.find(v => v.state === s.id)?.voice_asset_id || ''
  stateSel.value = map
}
const boards = computed(() => projectFiles('分镜', /\.json$/))
useBoardSelection(board, boards, 'voices')
watch(board, name => { if (app.current && name) localStorage.setItem(`wb.${app.current}.voices.board`, name) })
const originLabel = (o?: string) => o && te('views.voices.origin.' + o) ? t('views.voices.origin.' + o) : t('views.voices.local')
interface VendorLite {id: string; label?: string; enabled?: boolean; models?: Record<string, string>; endpoints?: Record<string, string>}
const speechVendors = ref<VendorLite[]>([]), speechVendor = ref('minimax')
watch(speechVendor, v => { if (v && app.current) localStorage.setItem(`wb.${app.current}.voices.speechVendor`, v) })
async function loadSpeechVendors() {
  try {
    const r = await getJSON<{vendors: VendorLite[]}>('/api/env/config')
    speechVendors.value = (r.vendors || []).filter(v => v.enabled && ((v.models?.speech) || (v.endpoints?.speech)))
    const saved = app.current ? localStorage.getItem(`wb.${app.current}.voices.speechVendor`) || '' : ''
    if (!speechVendors.value.some(v => v.id === speechVendor.value)) speechVendor.value = speechVendors.value.some(v => v.id === saved) ? saved : 'minimax'
  } catch { /* 环境配置不可用时保持 MiniMax */ }
}
async function cloneVoice(v: Voice) {
  if (!app.current) return
  try { await submit('voice_clone', {voice_asset_id: v.id, preview_text: preview.value}) } catch (e) { error.value = String(e) }
}
async function load() {
  const project = app.current; if (!project) return
  try {
    const r = await getJSON<{characters: Actor[]; voices: Voice[]; catalog: Catalog[]}>(`/api/studio/voices?project=${encodeURIComponent(project)}`)
    if (project !== app.current) return
    actors.value = r.characters; voices.value = r.voices; catalog.value = r.catalog
    if (!actors.value.some(a => a.id === actorId.value)) actorId.value = actors.value[0]?.id || ''
    if (!boards.value.includes(board.value)) board.value = boards.value[0] || ''
    syncStateSel()
  } catch (e) { error.value = String(e) }
}
async function submit(action: string, extra: Record<string, unknown> = {}, recover = false, vendorId = 'minimax') {
  const project = app.current
  const body = {project, action, vendor_id: vendorId, ...extra}
  busy.value = true; error.value = ''
  try {
    const r = await submitStudioJob(body, recover)
    if (r.id) {
      const result = await trackJob(r.id, t('views.voices.jobLabel'))
      if (!result.success) throw new Error(result.err || t('views.voices.jobFailed'))
    }
    if (app.current === project) await load()
  } catch (e) { error.value = String(e) } finally { busy.value = false }
}
async function bindGlobal(v: Voice) {
  if (!actor.value) return
  try { await studioPost('voice-bind', {project: app.current, character_id: actorId.value, voice_asset_id: v.id, revision: v.revision}); await load(); toast(t('views.voices.boundGlobal', { voice: v.name, actor: actor.value.name }), 'ok') }
  catch (e) { error.value = String(e) }
}
async function bindState(stateId: string) {
  const voiceId = stateSel.value[stateId] || ''
  try {
    await studioPost('voice-bind', {project: app.current, character_id: actorId.value, state: stateId, voice_asset_id: voiceId})
    await load(); toast(voiceId ? t('views.voices.stateBound') : t('views.voices.followDefault'), 'ok')
  } catch (e) { error.value = String(e) }
}
async function uploadVoice(f: Event) {
  const input = f.target as HTMLInputElement; const file = input.files?.[0]; input.value = ''
  const project = app.current
  if (!file || !project) return
  uploading.value = true; error.value = ''
  try {
    const r = await fetch(`/api/voice/upload?project=${encodeURIComponent(project)}&name=${encodeURIComponent(file.name)}`,
      {method: 'POST', headers: {'Content-Type': 'application/octet-stream'}, body: file})
    const data = await r.json()
    if (!r.ok) throw new Error(data.err || t('common.uploadFailed'))
    toast(t('views.voices.uploaded', { name: data.voice.name }), 'ok'); await load()
  } catch (e) { error.value = String(e) } finally { uploading.value = false }
}
function stateVoiceName(stateId: string) {
  const vid = actor.value?.voice_variants?.find(v => v.state === stateId)?.voice_asset_id
  return vid ? voices.value.find(v => v.id === vid)?.name || vid : ''
}
function url(path: string) { return mediaUrl(`projects/${app.current}/${path}`) }
watch(() => app.current, () => { void load(); void loadSpeechVendors() }, {immediate: true})
</script>

<template>
  <div class="page-wide">
    <header class="mb-5"><h1 class="grad-text text-2xl font-black">{{ $t('nav.voices') }}</h1><p class="mt-1 text-sm text-slate-400">{{ $t('views.voices.lead') }}</p></header>
    <p v-if="error" role="alert" class="mb-4 rounded-lg bg-rose-950/50 p-3 text-rose-200">{{ error }}</p>
    <div class="grid items-start gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
      <aside class="glass space-y-2 p-3"><h2 class="mb-4 text-sm font-bold">{{ $t('views.voices.actors') }}</h2><button v-for="a in actors" :key="a.id" class="block w-full rounded-xl border p-3 text-left" :class="a.id === actorId ? 'border-sky-400/50 bg-sky-900/20' : 'border-white/10'" @click="actorId = a.id"><b>{{ a.name }}</b><small class="mt-1 block text-slate-300">{{ a.voice_binding ? $t('views.voices.boundGlobalShort') : $t('views.voices.unbound') }}<template v-if="a.states?.length"> · {{ $t('views.voices.statesN', { n: a.states.length }) }}</template></small></button><p class="text-sm text-slate-400">{{ $t('views.voices.narrationNote') }}</p></aside>
      <main class="space-y-5">
        <div class="grid items-start gap-5 xl:grid-cols-2">
          <section class="glass space-y-3 p-4">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="font-bold text-sky-200">{{ $t('views.voices.cloudLib') }}</h2>
              <span class="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-slate-300" :title="$t('views.voices.minimaxTitle')">MiniMax</span>
              <button class="btn btn-sm" :disabled="busy" @click="submit('voice_catalog')">{{ catalog.length ? $t('views.voices.refetch') : $t('views.voices.fetchDefault') }}</button>
            </div>
            <p class="text-sm text-slate-400">{{ $t('views.voices.cloudNote') }}</p>
            <div class="flex gap-2"><input v-model="search" class="voice-input" :placeholder="$t('views.voices.searchPh')" /><button class="btn btn-sm btn-ghost shrink-0" :disabled="busy" @click="submit('recover', {}, true)">{{ $t('views.voices.recover') }}</button></div>
            <div class="max-h-[430px] space-y-2 overflow-auto pr-1">
              <article v-for="v in catalog.filter(c => `${c.voice_name} ${c.voice_id} ${c.description?.join(' ')}`.includes(search))" :key="v.voice_id" class="rounded-lg border border-white/10 p-3">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0"><b class="text-sm">{{ v.voice_name || v.voice_id }}</b><p class="truncate text-xs text-slate-400" :title="v.description?.join($t('common.semiSep'))">{{ v.description?.join($t('common.semiSep')) }}</p></div>
                  <button v-if="!v.preview_audio" class="btn btn-sm shrink-0" :disabled="busy" @click="submit('voice_sample', {voice_id: v.voice_id, name: v.voice_name, preview_text: preview})">{{ $t('views.voices.genPreview') }}</button>
                </div>
                <audio v-if="v.preview_audio" :src="v.preview_audio" controls preload="none" class="mt-2 w-full" />
              </article>
              <p v-if="!catalog.length" class="text-xs text-slate-500">{{ $t('views.voices.notFetched') }}</p>
            </div>
          </section>
          <section class="glass space-y-3 p-4">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="font-bold text-sky-200">{{ $t('views.voices.localLib') }}</h2>
              <input ref="fileInput" type="file" accept=".mp3,.wav,.m4a,.ogg,.flac" class="hidden" @change="uploadVoice" />
              <button class="btn btn-sm" :disabled="uploading" @click="fileInput?.click()">{{ uploading ? $t('common.uploading') : $t('views.voices.uploadFile') }}</button>
              <span class="text-xs text-slate-500">{{ $t('views.voices.count', { n: voices.length }) }}</span>
            </div>
            <div class="max-h-[520px] space-y-3 overflow-auto pr-1">
              <article v-for="v in voices" :key="v.id" class="rounded-xl border border-white/10 p-3">
                <div class="flex items-center gap-2"><b class="text-sm">{{ v.name }} · r{{ v.revision }}</b>
                  <span class="rounded px-1.5 py-0.5 text-[10px]" :class="v.origin === 'upload' ? 'bg-emerald-900/60 text-emerald-200' : v.origin === 'voice_design' ? 'bg-violet-900/60 text-violet-200' : 'bg-sky-900/60 text-sky-200'">{{ originLabel(v.origin) }}</span>
                  <span v-if="v.tts_verified" class="rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] text-slate-300">{{ $t('views.voices.ttsVerified') }}</span>
                </div>
                <p class="mt-1 text-xs text-slate-500">{{ v.voice_id || $t('views.voices.noVoiceId') }}</p>
                <p class="truncate text-[11px] text-slate-600" :title="v.sample">{{ v.sample }}</p>
                <audio :src="url(v.sample)" controls preload="none" class="my-2 w-full" />
                <div class="flex flex-wrap gap-2">
                  <button class="btn btn-sm" :disabled="!actor || busy || actor.voice_binding?.voice_asset_id === v.id" @click="bindGlobal(v)">{{ actor?.voice_binding?.voice_asset_id === v.id ? $t('views.voices.isDefault') : $t('views.voices.setDefault', { name: actor?.name || $t('views.voices.character') }) }}</button>
                  <button v-if="!v.voice_id" class="btn btn-sm btn-ghost" :disabled="busy" :title="$t('views.voices.cloneTitle')" @click="cloneVoice(v)">{{ $t('views.voices.clone') }}</button>
                </div>
                <p v-if="v.origin === 'voice_clone'" class="mt-2 text-xs text-amber-300">{{ v.description || $t('views.voices.cloneNote') }}</p>
                <p v-if="v.derived_from" class="mt-2 text-xs text-sky-300">{{ $t('views.voices.derived', { name: actors.find(a => a.id === v.character_id)?.name }) }}</p>
              </article>
              <p v-if="!voices.length" class="text-xs text-slate-500">{{ $t('views.voices.emptyLib') }}</p>
            </div>
          </section>
        </div>
        <section class="glass space-y-3 p-4">
          <h2 class="font-bold text-sky-200">{{ $t('views.voices.perState') }} <span class="text-sm font-normal text-slate-400">{{ actor?.name || $t('views.voices.pickActor') }}</span></h2>
          <p v-if="!actor?.states?.length" class="text-xs text-slate-500">{{ $t('views.voices.noStates') }}</p>
          <div v-for="s in actor?.states || []" :key="s.id" class="grid items-center gap-3 rounded-xl border border-white/10 p-3 md:grid-cols-[120px_minmax(0,1fr)_auto]">
            <div class="flex h-[90px] items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/30">
              <img v-if="s.image" :src="url(s.image)" class="h-full w-full object-contain" :alt="s.label" />
              <span v-else class="text-[11px] text-slate-600">{{ $t('views.voices.noStateImg') }}</span>
            </div>
            <div class="min-w-0">
              <b class="text-sm">{{ s.label }}</b>
              <p class="text-xs" :class="stateVoiceName(s.id) ? 'text-emerald-300' : 'text-slate-500'">{{ stateVoiceName(s.id) ? $t('views.voices.current', { name: stateVoiceName(s.id) }) : $t('views.voices.followingDefault') }}</p>
              <select v-model="stateSel[s.id]" class="voice-input mt-2"><option value="">{{ $t('views.voices.followOpt') }}</option><option v-for="v in voices" :key="v.id" :value="v.id">{{ v.name }} · r{{ v.revision }}</option></select>
            </div>
            <button class="btn btn-sm" :disabled="busy" @click="bindState(s.id)">{{ stateSel[s.id] ? $t('views.voices.bindState') : $t('views.voices.resetDefault') }}</button>
          </div>
        </section>
        <section class="glass space-y-3 p-4">
          <h2 class="font-bold text-sky-200">{{ $t('views.voices.design') }} <span class="text-xs font-normal text-slate-500">{{ $t('views.voices.designHint') }}</span></h2>
          <div class="grid gap-3 md:grid-cols-2">
            <input v-model="voiceName" class="voice-input" :placeholder="$t('views.voices.voiceName')" />
            <input v-model="preview" class="voice-input" :placeholder="$t('views.voices.previewPh')" />
          </div>
          <textarea v-model="description" class="voice-input" rows="3" :placeholder="$t('views.voices.descPh')"></textarea>
          <button class="btn" :disabled="busy || !description.trim()" @click="submit('voice_design', {description, name: voiceName, preview_text: preview})">{{ $t('views.voices.designBtn') }}</button>
        </section>
        <details class="glass p-4">
          <summary class="cursor-pointer text-sm font-bold text-slate-300">{{ $t('views.voices.dubbing') }}</summary>
          <div class="mt-3 space-y-3">
            <label class="block text-xs text-slate-400">{{ $t('views.voices.vendorLabel') }}<select v-model="speechVendor" class="voice-input mt-2"><option v-for="v in speechVendors" :key="v.id" :value="v.id">{{ v.label || v.id }}{{ v.id === 'minimax' ? '' : $t('views.voices.openaiCompat') }}</option></select></label>
            <label class="block text-xs text-slate-400">{{ $t('views.voices.voiceThisRun') }}<select v-model="speechVoice" class="voice-input mt-2" :disabled="speechVendor !== 'minimax'"><option value="">{{ speechVendor !== 'minimax' ? $t('views.voices.vendorDefault') : $t('views.voices.seriesDefault') }}</option><option v-for="v in actor?.voice_variants || []" :key="v.voice_asset_id" :value="v.voice_asset_id">{{ v.name }}{{ v.state ? $t('views.voices.stateTag') : '' }}</option></select></label>
            <div class="flex flex-wrap gap-2"><select v-model="board" class="voice-input max-w-xs"><option v-for="b in boards" :key="b">{{ b }}</option></select><button class="btn" :disabled="busy || !board || (speechVendor === 'minimax' && !actor?.voice_binding)" @click="submit('speech', {board, character_id: actorId, voice_asset_id: speechVoice || undefined}, false, speechVendor)">{{ $t('views.voices.genLines') }}</button></div>
            <p class="text-sm text-slate-400">{{ $t('views.voices.genNote') }}</p>
          </div>
        </details>
      </main>
    </div>
  </div>
</template>

<style scoped>.voice-input{width:100%;min-height:40px;border:1px solid #ffffff30;border-radius:8px;background:#0a1522;color:#e2e8f0;padding:10px;font-size:14px;line-height:1.5}.voice-input:focus{outline:2px solid #38bdf8;outline-offset:1px}textarea.voice-input{min-height:104px}</style>
