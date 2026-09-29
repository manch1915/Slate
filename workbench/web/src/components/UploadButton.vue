<script setup lang="ts">
// -*- coding: utf-8 -*-
/** 视频上传按钮：局域网/本机通用，直接 POST 文件流到 /api/import 落 拉片素材/ */
import { ref } from 'vue'
import { importVideo } from '../api'
import { app, toast, loadBasics } from '../stores/app'
import { t } from '../i18n'

const emit = defineEmits<{ (e: 'uploaded', path: string): void }>()
const input = ref<HTMLInputElement | null>(null)
const busy = ref(false)

async function onPick(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files?.length || !app.current) return
  busy.value = true
  try {
    for (const f of Array.from(files)) {
      const r = await importVideo(app.current, f.name, f)
      toast(t('components.upload.done', { name: f.name, path: r.path }), 'ok', 4000)
      emit('uploaded', r.path)
    }
    await loadBasics()
  } catch (err) {
    toast(err instanceof Error ? err.message : t('common.uploadFailed'), 'err', 6000)
  } finally {
    busy.value = false
    if (input.value) input.value.value = ''
  }
}
</script>

<template>
  <button class="btn btn-ghost btn-sm shrink-0" :disabled="busy || !app.current"
    :title="$t('components.upload.title', { project: app.current || '' })" @click="input?.click()">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 16V4m0 0L8 8m4-4l4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    {{ busy ? $t('common.uploading') : (app.current ? $t('components.upload.buttonTo', { project: app.current }) : $t('components.upload.button')) }}
  </button>
  <input ref="input" type="file" accept=".mp4,.mkv,.mov" multiple class="hidden" @change="onPick" />
</template>
