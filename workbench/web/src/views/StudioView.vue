<script setup lang="ts">
import { t } from '../i18n'
// -*- coding: utf-8 -*-
/** ① 剧本分集：文本输入框 → LLM 分集（多集剧本），支持逐集查看明细（钩子/落点/梗概/原文） */
import { ref, computed, watch } from 'vue'
import {
  fetchScriptData, importScript, scriptEpisodes, scriptOverview, scriptExpand, deleteScriptEpisode,
  fetchBrief, saveBrief,
  type ScriptBundle, type Episode, type ProductionBrief
} from '../api'
import { app, toast } from '../stores/app'
import { trackJob } from '../stores/jobs'
import { pendingEpisodeIds } from '../utils/scriptEpisodes'
import EmptyState from '../components/EmptyState.vue'
import StoryUnitsCard from '../components/StoryUnitsCard.vue'
import StyleSelect from '../components/StyleSelect.vue'
import StyledSelect from '../components/StyledSelect.vue'

const data = ref<ScriptBundle | null>(null)
const loading = ref(false)
const scriptText = ref('')
const busy = ref(false)
const detail = ref<Episode | null>(null)
const mode = ref<'import' | 'idea'>('import')
const idea = ref('')
const epsN = ref(6)
const expanding = ref('')
const epDeleting = ref('')

/* ---------- 制作规格（E05）：剧本/brief.json 的编辑表单；保存即被大纲/扩写/生图/成片链路消费 ---------- */
const briefOpen = ref(true)
const briefSaving = ref(false)
const briefForm = ref({
  episode_minutes: 3 as number,
  total_episodes: '' as string | number,
  aspect_ratio: '16:9',
  genre_tone: '',
  dialogue_density: '中',
  max_characters: '' as string | number,
  max_scenes: '' as string | number,
})

function fillBriefForm(b: ProductionBrief) {
  briefForm.value = {
    episode_minutes: b.episode_minutes ?? 3,
    total_episodes: b.total_episodes ?? '',
    aspect_ratio: b.aspect_ratio || '16:9',
    genre_tone: b.genre_tone || '',
    dialogue_density: b.dialogue_density || '中',
    max_characters: b.max_characters ?? '',
    max_scenes: b.max_scenes ?? '',
  }
}

/** 可空数字字段：空串 = 恢复默认（后端按 None 删键）。 */
const nullIfEmpty = (v: string | number) => (v === '' || v === null || v === undefined ? null : Number(v))

async function saveBriefForm() {
  if (!app.current || briefSaving.value) return
  briefSaving.value = true
  try {
    const r = await saveBrief(app.current, {
      episode_minutes: Number(briefForm.value.episode_minutes),
      total_episodes: nullIfEmpty(briefForm.value.total_episodes),
      aspect_ratio: briefForm.value.aspect_ratio,
      genre_tone: briefForm.value.genre_tone,
      dialogue_density: briefForm.value.dialogue_density,
      max_characters: nullIfEmpty(briefForm.value.max_characters),
      max_scenes: nullIfEmpty(briefForm.value.max_scenes),
    })
    fillBriefForm(r.brief)
    toast(t('views.studio.briefSaved'), 'ok', 4500)
  } catch (e) {
    toast(e instanceof Error ? e.message : t('views.studio.briefSaveFailed'), 'err', 6000)
  } finally {
    briefSaving.value = false
  }
}

/** 删除分集：只删分集清单并解除资产来源标签；资产、图片和已生成产物保留。 */
async function deleteEpisode(e: Episode) {
  if (!app.current || epDeleting.value) return
  const label = e.title ? t('views.studio.epLabel', { id: e.id, title: e.title }) : e.id
  if (!window.confirm(t('views.studio.confirmDelete', { label }))) return
  epDeleting.value = e.id
  try {
    const result = await deleteScriptEpisode(app.current, e.id)
    const unlinked = result.assets_unlinked || 0
    if (detail.value?.id === e.id) detail.value = null
    await load()
    toast(unlinked ? t('views.studio.deletedUnlinked', { label: result.episode || label, n: unlinked }) : t('views.studio.deleted', { label: result.episode || label }), 'ok', 5000)
  } catch (err) {
    toast(err instanceof Error ? err.message : t('views.studio.deleteFailed'), 'err', 6000)
  } finally {
    epDeleting.value = ''
  }
}

const episodes = computed(() => data.value?.episodes || [])
const scriptMode = computed(() => (data.value as any)?.script_mode || (episodes.value.some((e) => e.text) ? 'generated' : 'imported'))
const scriptReadonly = computed(() => scriptMode.value === 'generated')

let loadSeq = 0
async function load() {
  if (!app.current) return
  const seq = ++loadSeq
  loading.value = true
  try {
    const next = await fetchScriptData(app.current)
    // 连切项目时旧响应不得覆盖新项目：曾出现"编辑器显示 A 剧本、保存写进 B 项目"
    if (seq !== loadSeq) return
    data.value = next
    scriptText.value = next.script || ''
    try {
      // 制作规格接口不可用时（旧后端/缺 brief.py）不影响剧本页其余功能
      const b = await fetchBrief(app.current)
      if (seq !== loadSeq) return
      fillBriefForm(b.brief)
    } catch { /* 保持表单默认值 */ }
  } catch (e) {
    if (seq === loadSeq) toast(e instanceof Error ? e.message : t('views.studio.loadFailed'), 'err')
  } finally { if (seq === loadSeq) loading.value = false }
}
watch(() => app.current, load, { immediate: true })

async function run(label: string, fn: () => Promise<{ id?: number; err?: string }>) {
  busy.value = true
  try {
    const r = await fn()
    if (!r.id) { toast(t('views.studio.jobDone', { label }), 'ok', 4000); await load(); return }  // 同步接口（importScript）无任务 id，抛错即失败
    const j = await trackJob(r.id, label)
    if (j.success) { toast(t('views.studio.jobDone', { label }), 'ok', 4000); await load() }
    else throw new Error(j.err || t('views.studio.jobFailed', { label }))
  } catch (e) {
    toast(e instanceof Error ? e.message : t('views.studio.jobFailed', { label }), 'err', 6000)
  } finally { busy.value = false }
}
const save = () => run(t('views.studio.job.import'), async () => { await importScript({ project: app.current!, text: scriptText.value }); return { id: 0 } })
const doEps = () => run(t('views.studio.job.episodes'), () => scriptEpisodes(app.current!))
const doOverview = (episode?: string) => run(episode ? t('views.studio.job.overviewOne', { ep: episode }) : t('views.studio.job.overview'), () => scriptOverview(app.current!, episode))

function epSlice(e: Episode): string {
  if (e.text) return e.text
  return (data.value?.script || '').slice(e.char_start ?? 0, e.char_end ?? undefined)
}
/** 从0生成：构想 → 大纲（写 分集.json）；episode 给定则扩写该集原文 */
async function expandOne(episode: string): Promise<void> {
  if (!app.current) throw new Error(t('views.studio.pickProject'))
  const r = await scriptExpand({ project: app.current, idea: idea.value || undefined, eps: epsN.value, episode })
  if (!r.id) throw new Error(r.err || t('views.studio.jobNotStarted'))
  const j = await trackJob(r.id, t('views.studio.job.expand', { ep: episode }))
  if (!j.success) throw new Error(j.err || t('views.studio.epFailed', { ep: episode }))
}

async function doExpand(episode?: string) {
  if (!app.current || busy.value || expanding.value) return
  if (episode) expanding.value = episode
  else busy.value = true
  try {
    if (episode) {
      await expandOne(episode)
      toast(t('views.studio.expanded', { ep: episode }), 'ok', 4000)
    } else {
      const r = await scriptExpand({ project: app.current, idea: idea.value || undefined, eps: epsN.value })
      if (!r.id) throw new Error(r.err || t('views.studio.jobNotStarted'))
      const j = await trackJob(r.id, t('views.studio.job.outline'))
      if (!j.success) throw new Error(j.err || t('views.studio.outlineFailed'))
      toast(t('views.studio.outlineDone'), 'ok', 4000)
    }
    await load()
  } catch (e) {
    toast(e instanceof Error ? e.message : t('views.studio.genFailed'), 'err', 6000)
  } finally {
    expanding.value = ''; busy.value = false
  }
}

const pendingEpisodes = computed(() => pendingEpisodeIds(episodes.value))
const allExpandProgress = ref({ done: 0, total: 0 })
const allExpandLabel = computed(() => {
  if (expanding.value === '__all__') {
    return t('views.studio.allProgress', { done: allExpandProgress.value.done, total: allExpandProgress.value.total })
  }
  return pendingEpisodes.value.length
    ? t('views.studio.allStart', { n: pendingEpisodes.value.length })
    : t('views.studio.allDone')
})

/** 一键生成全部未扩写分集；逐集排队避免多个进程覆盖同一份分集.json。 */
async function doExpandAll() {
  if (!app.current || busy.value || expanding.value) return
  const pending = pendingEpisodeIds(episodes.value)
  if (!pending.length) {
    toast(t('views.studio.nothingPending'), 'info', 4500)
    return
  }
  busy.value = true
  expanding.value = '__all__'
  allExpandProgress.value = { done: 0, total: pending.length }
  const failures: string[] = []
  let done = 0
  try {
    for (const episode of pending) {
      try {
        await expandOne(episode)
      } catch (e) {
        const message = e instanceof Error ? e.message : t('views.studio.genFailed')
        failures.push(t('views.studio.epError', { ep: episode, msg: message }))
        // 缺少构想属于全局前置条件，继续请求只会重复失败。
        if (message.includes('缺少创作构想') || message.includes('Missing creative brief')) break
      } finally {
        done += 1
        allExpandProgress.value = { done, total: pending.length }
      }
    }
    await load()
    const success = done - failures.length
    if (failures.length) {
      toast(t('views.studio.allPartial', { ok: success, failed: failures.length, list: failures.slice(0, 2).join(t('common.semiSep')) }), 'err', 7000)
    } else {
      toast(t('views.studio.allFinished', { n: success }), 'ok', 5000)
    }
  } finally {
    expanding.value = ''
    busy.value = false
  }
}
</script>

<template>
  <div class="page">
    <header class="mb-6">
      <h1 class="grad-text text-2xl font-black">{{ $t('views.studio.title') }}</h1>
      <p class="mt-1 text-xs text-slate-500">{{ $t('views.studio.intro') }}
        <span v-if="data?.script_rev" class="ml-2 rounded-full bg-white/5 px-2 py-0.5 text-2xs text-slate-400"
          :title="$t('views.studio.revTitle')">{{ $t('views.studio.rev', { rev: data.script_rev }) }}</span>
      </p>
    </header>

    <EmptyState v-if="!app.current" :title="$t('common.pickProjectFirst')" :hint="$t('views.studio.emptyHint')" />

    <template v-else>
      <!-- 文本输入：双模式（导入已有剧本 / 一段话从0生成） -->
      <section class="glass mb-5 p-4">
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <span class="flex h-6 w-6 items-center justify-center rounded-full bg-pink-400/15 text-xs font-black text-pink-300">1</span>
          <h3 class="text-sm font-bold text-slate-200">{{ $t('views.studio.source') }}</h3>
          <button class="rounded-lg px-3 py-1 text-xs font-bold transition"
            :class="mode === 'import' ? 'chip-active' : 'chip'"
            @click="mode = 'import'">{{ $t('views.studio.modeImport') }}</button>
          <button class="rounded-lg px-3 py-1 text-xs font-bold transition"
            :class="mode === 'idea' ? 'chip-active' : 'chip'"
            @click="mode = 'idea'">{{ $t('views.studio.modeIdea') }}</button>
          <span class="flex-1"></span>
          <span v-if="mode === 'import'" class="text-xs-plus text-slate-500">{{ $t('views.studio.chars', { n: scriptText.length }) }}</span>
        </div>

        <div v-if="mode === 'import'">
          <div v-if="scriptReadonly" class="mb-2 rounded-lg bg-violet-400/10 px-3 py-1.5 text-xs-plus text-violet-200">
            {{ $t('views.studio.readonlyNote') }}
          </div>
          <div class="mb-2 flex justify-end gap-2">
            <button class="btn btn-ghost" :disabled="busy || scriptReadonly || scriptText === (data?.script || '')" @click="save">
              {{ scriptReadonly ? $t('views.studio.cantSave') : $t('views.studio.saveScript') }}
            </button>
            <button class="btn" :disabled="busy || scriptText.length < 80" @click="doEps">
              {{ busy ? $t('views.studio.splitting') : $t('views.studio.job.episodes') }}
            </button>
          </div>
          <textarea v-model="scriptText" rows="8" class="textarea w-full font-mono text-xs leading-relaxed"
            :readonly="scriptReadonly"
            :placeholder="$t('views.studio.scriptPh')"></textarea>
        </div>

        <div v-else>
          <div class="mb-2 flex flex-wrap items-end gap-3">
            <label class="w-24 text-xs text-slate-400">{{ $t('views.studio.epsN') }}
              <input v-model.number="epsN" type="number" min="1" max="30" class="input mt-1" />
            </label>
            <button class="btn" :disabled="busy || idea.trim().length < 5" @click="doExpand()">
              {{ busy ? $t('views.studio.outlining') : $t('views.studio.genOutline') }}
            </button>
            <span class="text-xs-plus text-slate-500">{{ $t('views.studio.ideaHint') }}</span>
          </div>
          <textarea v-model="idea" rows="5" class="textarea w-full text-xs leading-relaxed"
            :placeholder="$t('views.studio.ideaPh')"></textarea>
        </div>
      </section>

      <!-- 制作规格（E05）：单集时长/画幅/编剧风格/对白密度等制片决策，保存即被大纲/扩写/生图链路消费 -->
      <section class="glass mb-5 p-4">
        <button class="flex w-full items-center gap-2 text-left" @click="briefOpen = !briefOpen">
          <span class="flex h-6 w-6 items-center justify-center rounded-full bg-pink-400/15 text-xs font-black text-pink-300">{{ $t('views.studio.briefBadge') }}</span>
          <h3 class="text-sm font-bold text-slate-200">{{ $t('views.studio.brief') }}</h3>
          <span class="text-xs-plus text-slate-500">{{ $t('views.studio.briefNote') }}</span>
          <span class="ml-auto text-xs text-slate-500">{{ briefOpen ? $t('views.studio.collapse') : $t('views.studio.expand') }}</span>
        </button>
        <div v-if="briefOpen" class="mt-3 border-t border-line-soft pt-3">
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label class="text-xs text-slate-400">{{ $t('views.studio.epMinutes') }}
              <input v-model.number="briefForm.episode_minutes" type="number" min="0.5" max="10" step="0.5" class="input mt-1" />
            </label>
            <label class="text-xs text-slate-400">{{ $t('views.studio.totalEps') }}
              <input v-model="briefForm.total_episodes" type="number" min="1" max="200" step="1" class="input mt-1" :placeholder="$t('views.studio.unlimited')" />
            </label>
            <label class="text-xs text-slate-400">{{ $t('views.studio.density') }}
              <StyledSelect v-model="briefForm.dialogue_density" :options="['低', '中', '高']" :labels="{ 低: $t('views.studio.densityOpt.low'), 中: $t('views.studio.densityOpt.mid'), 高: $t('views.studio.densityOpt.high') }" class="mt-1" />
            </label>
            <label class="text-xs text-slate-400">{{ $t('views.studio.aspect') }}
              <StyledSelect v-model="briefForm.aspect_ratio" :options="['16:9', '9:16', '1:1', '4:3']" class="mt-1" />
            </label>
            <label class="text-xs text-slate-400">{{ $t('views.studio.maxChars') }}
              <input v-model="briefForm.max_characters" type="number" min="1" step="1" class="input mt-1" :placeholder="$t('views.studio.unlimited')" />
            </label>
            <label class="text-xs text-slate-400">{{ $t('views.studio.maxScenes') }}
              <input v-model="briefForm.max_scenes" type="number" min="1" step="1" class="input mt-1" :placeholder="$t('views.studio.unlimited')" />
            </label>
            <div class="text-xs text-slate-400">
              <StyleSelect target="script" :label="$t('views.studio.styleLabel')" :hint="$t('views.studio.styleHint')" />
              <p class="mt-1 text-2xs text-slate-500">{{ $t('views.studio.shotStyleNote') }}</p>
            </div>
            <label class="text-xs text-slate-400 sm:col-span-2">{{ $t('views.studio.tone') }}
              <input v-model="briefForm.genre_tone" type="text" maxlength="200" class="input mt-1" :placeholder="$t('views.studio.tonePh')" />
            </label>
          </div>
          <div class="mt-3 flex flex-wrap items-center gap-3">
            <button class="btn btn-sm" :disabled="briefSaving" @click="saveBriefForm">
              {{ briefSaving ? $t('common.saving') : $t('views.studio.saveBrief') }}
            </button>
            <span class="text-2xs text-slate-500">{{ $t('views.studio.briefEffect') }}</span>
          </div>
        </div>
      </section>

      <!-- ① 第一步：先出全剧最小单元并锚定，第二步逐集扩写才吃它（未锚定=行为与改造前一致） -->
      <StoryUnitsCard :project="app.current || ''" @changed="load" />

      <!-- 分集列表（多集剧本） -->
      <section class="glass p-4">
        <div class="mb-3 flex flex-wrap items-center gap-3">
          <span class="flex h-6 w-6 items-center justify-center rounded-full bg-pink-400/15 text-xs font-black text-pink-300">2</span>
          <h3 class="text-sm font-bold text-slate-200">{{ $t('views.studio.episodes', { n: episodes.length }) }}</h3>
          <span class="flex-1 text-xs-plus text-slate-500">{{ $t('views.studio.episodesHint') }}</span>
          <button class="btn btn-sm" :disabled="busy || !!expanding || !pendingEpisodes.length" @click="doExpandAll">
            {{ allExpandLabel }}
          </button>
        </div>
        <div v-if="expanding === '__all__'" class="mb-3 rounded-lg border border-pink-400/20 bg-pink-400/5 px-3 py-2 text-xs-plus text-pink-200">
          {{ $t('views.studio.writingAll', { done: allExpandProgress.done, total: allExpandProgress.total }) }}
        </div>
        <div v-if="!episodes.length" class="py-10 text-center text-sm text-slate-500">{{ $t('views.studio.noEpisodes') }}</div>
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div v-for="e in episodes" :key="e.id" class="glass glass-hover p-3">
            <button class="block w-full text-left" @click="detail = e">
              <div class="flex items-center gap-2">
                <span class="rounded bg-pink-400/15 px-2 py-0.5 text-xs font-black text-pink-300">{{ e.id }}</span>
                <b class="text-sm text-slate-100">{{ e.title }}</b>
                <span class="ml-auto text-2xs text-slate-500">{{ e.duration_min ?? '?' }}min</span>
              </div>
              <div class="mt-1.5 line-clamp-2 text-xs-plus text-slate-400">{{ e.summary }}</div>
            </button>
            <div class="mt-2 flex items-center gap-2 border-t border-line-soft pt-2">
              <button class="btn btn-ghost btn-sm" :disabled="busy || !!expanding" @click="doExpand(e.id)">
                {{ expanding === e.id ? $t('views.studio.expanding') : e.text ? $t('views.studio.reExpand') : $t('views.studio.expandEp') }}
              </button>
              <button class="btn btn-ghost btn-sm" :disabled="busy || !!expanding || !e.text" :title="$t('views.studio.overviewTitle')" @click.stop="doOverview(e.id)">{{ $t('views.studio.updateOverview') }}</button>
              <span v-if="e.text" class="text-2xs text-emerald-300">{{ $t('views.studio.expandedChars', { n: e.text.length }) }}</span>
              <button
                class="btn btn-danger btn-sm ml-auto"
                :disabled="busy || !!expanding || epDeleting === e.id"
                :title="$t('views.studio.deleteTitle')"
                @click="deleteEpisode(e)"
              >{{ epDeleting === e.id ? $t('views.studio.deleting') : $t('common.delete') }}</button>
            </div>
          </div>
        </div>
      </section>

      <!-- 集明细抽屉 -->
      <Teleport to="body">
        <div v-if="detail" class="overlay-end" @click.self="detail = null">
          <div class="drawer-panel">
            <div class="mb-4 flex items-center gap-3">
              <span class="rounded bg-pink-400/15 px-2 py-0.5 text-sm font-black text-pink-300">{{ detail.id }}</span>
              <b class="text-lg text-slate-100">{{ detail.title }}</b>
              <span class="text-xs text-slate-500">{{ $t('views.studio.detailMeta', { dur: detail.duration_min ?? '?', n: epSlice(detail).length }) }}</span>
              <button class="btn btn-ghost ml-auto" @click="detail = null">{{ $t('common.close') }}</button>
            </div>
            <div class="space-y-3 text-sm">
              <div class="rounded-lg bg-white/5 p-3"><b class="text-sky-300">{{ $t('views.studio.hook') }}</b><p class="mt-1 text-slate-300">{{ detail.hook }}</p></div>
              <div class="rounded-lg bg-white/5 p-3"><b class="text-amber-300">{{ $t('views.studio.cliff') }}</b><p class="mt-1 text-slate-300">{{ detail.cliff }}</p></div>
              <div class="rounded-lg bg-white/5 p-3"><b class="text-emerald-300">{{ $t('views.studio.synopsis') }}</b><p class="mt-1 text-slate-300">{{ detail.summary }}</p></div>
              <div v-if="detail.cast_refs?.length || detail.scene_refs?.length || detail.key_asset_refs?.length" class="rounded-lg bg-cyan-400/5 p-3">
                <b class="text-cyan-300">{{ $t('views.studio.index') }}</b>
                <div v-if="detail.cast_refs?.length" class="mt-2 text-xs-plus text-slate-300">{{ $t('views.studio.cast', { list: detail.cast_refs.join($t('common.listSep')) }) }}</div>
                <div v-if="detail.scene_refs?.length" class="mt-1 text-xs-plus text-slate-300">{{ $t('views.studio.scenes', { list: detail.scene_refs.join($t('common.listSep')) }) }}</div>
                <div v-if="detail.key_asset_refs?.length" class="mt-1 text-xs-plus text-slate-300">{{ $t('views.studio.keyAssets', { list: detail.key_asset_refs.join($t('common.listSep')) }) }}</div>
              </div>
              <div class="rounded-lg bg-white/5 p-3"><b class="text-slate-300">{{ $t('views.studio.source2') }}</b>
                <pre class="mt-2 whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-400">{{ epSlice(detail) }}</pre>
              </div>
            </div>
            <p class="mt-4 text-xs-plus text-slate-500">{{ $t('views.studio.next') }}</p>
          </div>
        </div>
      </Teleport>
    </template>
  </div>
</template>

