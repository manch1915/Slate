<script setup lang="ts">
import { computed, watch } from 'vue'
import type { VideoCapability, VideoSettingsValue } from '../utils/videoSettings'
const props = defineProps<{capability?: VideoCapability; modelValue: VideoSettingsValue}>()
const emit = defineEmits<{ 'update:modelValue': [VideoSettingsValue] }>()
import { t, te } from '../i18n'
const modeName = (mode: string) => te('components.videoSettings.mode.' + mode) ? t('components.videoSettings.mode.' + mode) : mode
const frame = computed(() => ['first_frame','first_last','last_frame'].includes(props.modelValue.mode || ''))
function update(patch: Partial<VideoSettingsValue>) { emit('update:modelValue', {...props.modelValue,...patch}) }
watch(() => [props.capability, props.modelValue.mode], () => {
  const cap = props.capability; if (!cap?.known) return
  const value = {...props.modelValue}
  if (!cap.modes.includes(value.mode || '')) value.mode = cap.default_mode
  if (!cap.resolutions.includes(value.resolution || '')) value.resolution = cap.resolutions[0]
  if (cap.frame_adaptive && ['first_frame','first_last','last_frame'].includes(value.mode || '')) value.ratio = 'adaptive'
  else if (!cap.ratios.includes(value.ratio || '')) value.ratio = cap.ratios[0]
  if (!cap.audio_output) delete value.generate_audio
  if (!cap.seed) delete value.seed
  if (JSON.stringify(value) !== JSON.stringify(props.modelValue)) emit('update:modelValue',value)
}, {immediate:true})
</script>

<template>
  <section class="space-y-3 rounded-xl border border-sky-400/20 bg-sky-950/10 p-3 text-xs">
    <b class="text-sky-200">{{ $t('components.videoSettings.title') }}</b>
    <p v-if="!capability?.known" class="text-amber-300">{{ $t('components.videoSettings.unknown') }}</p>
    <template v-else>
      <label class="block">{{ $t('components.videoSettings.modeLabel') }}<select :value="modelValue.mode" @change="update({mode:($event.target as HTMLSelectElement).value})"><option v-for="mode in capability.modes" :key="mode" :value="mode">{{ modeName(mode) }}</option></select></label>
      <div class="grid grid-cols-2 gap-2">
        <label>{{ $t('components.videoSettings.resolution') }}<select :value="modelValue.resolution" @change="update({resolution:($event.target as HTMLSelectElement).value})"><option v-for="r in capability.resolutions" :key="r" :value="r">{{ r === 'workflow' ? $t('components.videoSettings.workflow') : r }}</option></select></label>
        <label>{{ $t('components.videoSettings.ratio') }}<select :value="modelValue.ratio" :disabled="frame && capability.frame_adaptive" @change="update({ratio:($event.target as HTMLSelectElement).value})"><option v-if="frame && capability.frame_adaptive" value="adaptive">{{ $t('components.videoSettings.followFrames') }}</option><option v-for="r in capability.ratios" :key="r">{{ r }}</option></select></label>
      </div>
      <label v-if="capability.audio_output" class="block"><input type="checkbox" :checked="modelValue.generate_audio ?? true" @change="update({generate_audio:($event.target as HTMLInputElement).checked})" /> {{ $t('components.videoSettings.audio') }}</label>
      <label v-if="capability.seed" class="block">{{ $t('components.videoSettings.seed') }}<input type="number" :value="modelValue.seed" min="-1" max="2147483647" @change="update({seed:($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : undefined})" /></label>
      <p class="text-slate-400">{{ $t('components.videoSettings.duration', { min: capability.min_duration, max: capability.max_duration }) }} · {{ modelValue.mode === 'reference' ? $t('components.videoSettings.refLimits', { img: capability.max_refs, audio: capability.max_audio, video: capability.max_video }) : $t('components.videoSettings.frameOnly') }}</p>
      <p v-if="capability.transport === 'public_url'" class="text-amber-200">{{ $t('components.videoSettings.publicUrl') }}</p>
      <p v-if="frame" class="text-slate-400">{{ $t('components.videoSettings.frameNote') }}</p>
    </template>
  </section>
</template>

<style scoped>
select{display:block;width:100%;margin-top:5px;border:1px solid #ffffff20;border-radius:7px;padding:8px;background:#101a27;color:#dbe5f2}select:disabled{opacity:.6}
</style>
