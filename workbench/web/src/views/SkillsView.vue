<script setup lang="ts">
import { t, te } from '../i18n'
// -*- coding: utf-8 -*-
/** Skill 中心：影视创作垂直 skill 库（拆剧本/导演风格/生图风格），SKILL.md 格式，编辑即下次运行生效 */
import { ref, computed, onMounted } from 'vue'
import { getJSON, postJSON, fetchSkillText, saveSkill, fetchKnowledge, saveCard, deleteCard, buildKnowledge, type KnowledgeSkill, type UserCard, type SkillItem } from '../api'
interface AnyItem extends SkillItem { overridden?: boolean; text?: string }
import { toast } from '../stores/app'
import { trackJob } from '../stores/jobs'
import StyledSelect from '../components/StyledSelect.vue'

const skills = ref<AnyItem[]>([])
const autoCards = ref<KnowledgeSkill[]>([])
const userCards = ref<UserCard[]>([])
const cardEditing = ref<Partial<UserCard> | null>(null)
const cardForm = ref({ skill: '', trigger: '', prescription: '', example: '' })
const loading = ref(false)
const cat = ref('全部')
const detail = ref<AnyItem | null>(null)
const editText = ref('')
const saving = ref(false)
const createVisible = ref(false)
const newName = ref('')
const newCat = ref('导演风格')
const newTarget = ref('storyboard')
const newDesc = ref('')
const newText = ref('')

// 类别 slug→中文标签：内置库里 3 类落中文、acting 落 slug，直接比字符串会让该类永远筛不出、
// 徽标也显示成英文；环节徽标的三元式曾把 acting/assets/… 一律兜成「剧本」。
const CAT_LABELS:Record<string,string> = { directing:'导演风格', 'image-style':'生图风格', script:'拆剧本', acting:'演员表演' }
const CAT_SLUGS:Record<string,string> = { '导演风格':'directing', '生图风格':'image-style', '拆剧本':'script', '演员表演':'acting' }
const catLabel=(c?:string)=>CAT_LABELS[String(c||'')] || String(c||'')
/** 类别显示名：内部值是中文标签（与后端 category 对齐），界面按语言显示 */
const catText=(zh:string)=>te('views.skills.cat.'+zh)?t('views.skills.cat.'+zh):zh
const targetLabel=(v?:string)=>{const k='views.skills.target.'+String(v||'');return te(k)?t(k):String(v||'')}
const targetClass=(t?:string)=> t==='storyboard' ? 'bg-sky-400/15 text-sky-300'
  : t==='image' ? 'bg-fuchsia-400/15 text-fuchsia-300'
  : t==='acting' ? 'bg-teal-400/15 text-teal-300' : 'bg-amber-400/15 text-amber-300'
const CATS = ['全部', '导演风格', '生图风格', '拆剧本', '演员表演', '系统提示词', '经验卡片']
const list = computed(() => skills.value.filter((s) => cat.value === '全部' || catLabel(s.category) === cat.value))

async function load() {
  loading.value = true
  try {
    skills.value = (await getJSON<{ skills: SkillItem[] }>('/api/skills')).skills || []
    const k = await fetchKnowledge()
    autoCards.value = k.skills || []
    userCards.value = k.cards || []
  }
  catch (e) { toast(e instanceof Error ? e.message : t('views.skills.loadFailed'), 'err') }
  finally { loading.value = false }
}
onMounted(load)

async function openDetail(s: AnyItem) {
  detail.value = s
  try {
    const r = await fetchSkillText(s.id)
    editText.value = r.text || ''
  } catch (e) { editText.value = ''; toast(e instanceof Error ? e.message : t('views.skills.textFailed'), 'err') }
}
async function resetSys() {
  if (!detail.value) return
  if (!confirm(t('views.skills.resetConfirm', { name: detail.value.name }))) return
  try {
    await postJSON('/api/skills/reset', { id: detail.value.id })
    toast(t('views.skills.resetDone'), 'ok')
    detail.value = null
    await load()
  } catch (e) { toast(e instanceof Error ? e.message : t('views.skills.resetFailed'), 'err') }
}
async function save() {
  if (!detail.value) return
  saving.value = true
  try {
    await saveSkill(detail.value.id, editText.value, detail.value.category === '系统提示词' ? 'system' : 'style')
    toast(t('views.skills.savedAuto'), 'ok')
    await load()
  } catch (e) { toast(e instanceof Error ? e.message : t('common.saveFailed'), 'err') }
  finally { saving.value = false }
}
async function toggle(s: SkillItem) {
  try {
    await postJSON('/api/skills/toggle', { id: s.id, enabled: !s.enabled })
    await load()
  } catch (e) { toast(e instanceof Error ? e.message : t('views.skills.toggleFailed'), 'err') }
}
async function remove(s: SkillItem) {
  if (!confirm(t('views.skills.deleteConfirm', { name: s.name }))) return
  try {
    const r = await postJSON<{ ok: boolean }>('/api/skills/delete', { id: s.id })
    if (!r.ok) { toast(t('views.skills.builtinNoDelete'), 'err'); return }
    toast(t('views.white.deleted'), 'ok'); detail.value = null; await load()
  } catch (e) { toast(e instanceof Error ? e.message : t('common.deleteFailed'), 'err') }
}
async function saveCardForm() {
  const f = cardForm.value
  if (!f.skill.trim() || !f.prescription.trim()) { toast(t('views.skills.cardRequired'), 'err'); return }
  try {
    await saveCard({ id: cardEditing.value?.id, skill: f.skill, trigger: f.trigger, prescription: f.prescription, example: f.example })
    toast(cardEditing.value?.id ? t('views.skills.cardUpdated') : t('views.skills.cardSaved'), 'ok')
    cardEditing.value = null
    await load()
  } catch (e) { toast(e instanceof Error ? e.message : t('views.skills.cardFailed'), 'err') }
}
async function removeCard(c: UserCard) {
  if (!confirm(t('views.skills.cardDeleteConfirm', { name: c.skill }))) return
  try {
    await deleteCard(c.id)
    await load()
  } catch (e) { toast(e instanceof Error ? e.message : t('common.deleteFailed'), 'err') }
}
/** 卡片→Skill：处方升级为可注入的风格 skill（拆剧本类） */
async function cardToSkill(c: UserCard | KnowledgeSkill) {
  const body = `创作手法指令（来自拉片经验卡片「${c.skill}」）：
- 触发场面：${(c.trigger || []).join('、')}
- 镜头处方：${c.prescription}
- 参考片例：${c.example || '（补充你的片例）'}

命中该场面的分镜/扩写必须按处方执行。`
  try {
    await postJSON('/api/skills/create', { category: 'script', name: c.skill, target: 'script', description: c.prescription.slice(0, 40), text: body })
    toast(t('views.skills.converted'), 'ok')
    await load()
  } catch (e) { toast(e instanceof Error ? e.message : t('views.skills.convertFailed'), 'err') }
}
const kbRebuilding = ref(false)
async function rebuildKb() {
  try {
    const r = await buildKnowledge()
    if (!r.id) throw new Error(r.err || t('views.depth.notStarted'))
    kbRebuilding.value = true
    toast(t('views.skills.kbRebuilding'), 'info')
    const j = await trackJob(r.id, t('views.skills.kbJob'))
    if (j.success) { toast(t('views.skills.kbDone'), 'ok'); await load() }
    else toast(t('views.skills.kbFailedLog'), 'err')
  } catch (e) { toast(e instanceof Error ? e.message : t('views.skills.kbFailed'), 'err') }
  finally { kbRebuilding.value = false }
}
async function create() {
  if (!newName.value.trim() || !newText.value.trim()) { toast(t('views.skills.createRequired'), 'err'); return }
  try {
    await postJSON('/api/skills/create', {
      category: CAT_SLUGS[newCat.value] || 'script', name: newName.value.trim(), target: newTarget.value,
      description: newDesc.value.trim(), text: newText.value
    })
    toast(t('views.skills.created'), 'ok')
    createVisible.value = false
    newName.value = ''; newDesc.value = ''; newText.value = ''
    await load()
  } catch (e) { toast(e instanceof Error ? e.message : t('views.skills.createFailed'), 'err') }
}
</script>

<template>
  <div class="page">
    <header class="mb-6">
      <h1 class="grad-text text-2xl font-black">{{ $t('nav.skills') }}</h1>
      <p class="mt-1 text-xs text-slate-500">
        {{ $t('views.skills.lead') }}
      </p>
    </header>

    <div class="mb-4 flex flex-wrap items-center gap-2">
      <button v-for="c in CATS" :key="c" class="rounded-lg px-3 py-1.5 text-xs font-bold transition"
        :class="cat === c ? 'chip-active' : 'chip'"
        @click="cat = c">{{ catText(c) }}</button>
      <span class="flex-1"></span>
      <button class="btn" @click="createVisible = true">{{ $t('views.skills.newSkill') }}</button>
    </div>

    <div v-if="loading" class="glass p-10 text-center text-sm text-slate-500">{{ $t('views.skills.loading') }}</div>
    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <div v-for="s in list" :key="s.id" class="glass glass-hover cursor-pointer p-3 text-left" role="button" tabindex="0"
        @click="openDetail(s)" @keydown.enter="openDetail(s)" @keydown.space.prevent="openDetail(s)">
        <div class="flex flex-wrap items-center gap-2">
          <b class="text-sm text-slate-100">{{ s.name }}</b>
          <span class="rounded bg-white/10 px-1.5 text-2xs text-slate-400">{{ catText(catLabel(s.category)) }}</span>
          <span class="rounded px-1.5 text-2xs"
            :class="targetClass(s.target)">
            {{ targetLabel(s.target) }}
          </span>
          <span v-if="s.category === '系统提示词'" class="rounded bg-cyan-400/15 px-1.5 text-2xs text-cyan-300">{{ catText('系统提示词') }}</span>
          <span v-if="(s as AnyItem).overridden" class="rounded bg-amber-400/15 px-1.5 text-2xs text-amber-300">{{ $t('views.skills.overridden') }}</span>
          <span v-if="!s.builtin && s.category !== '系统提示词'" class="rounded bg-violet-400/15 px-1.5 text-2xs text-violet-300">{{ $t('views.skills.custom') }}</span>
          <button type="button" class="ml-auto text-2xs" :class="s.enabled ? 'text-emerald-300' : 'text-slate-500'"
            @click.stop="toggle(s)">{{ s.enabled ? $t('views.skills.enabled') : $t('views.skills.disabled') }}</button>
        </div>
        <div class="mt-1.5 text-xs-plus text-slate-400">{{ s.description }}</div>
      </div>
    </div>

    <!-- 经验卡片（拉片沉淀层） -->
    <section v-if="cat === '全部' || cat === '经验卡片'" class="glass mt-5 p-4">
      <div class="mb-3 flex flex-wrap items-center gap-3">
        <h3 class="text-sm font-bold text-slate-200">{{ catText('经验卡片') }} <span class="text-xs-plus font-normal text-slate-500">{{ $t('views.skills.cardsHint') }}</span></h3>
        <span class="flex-1"></span>
        <button class="btn btn-ghost" :disabled="kbRebuilding" @click="rebuildKb">{{ kbRebuilding ? $t('views.skills.rebuilding') : $t('views.skills.rebuild') }}</button>
        <button class="btn" @click="cardEditing = {}; cardForm = { skill: '', trigger: '', prescription: '', example: '' }">{{ $t('views.skills.addCard') }}</button>
      </div>
      <p class="mb-3 text-xs-plus text-slate-500">
        <i18n-t keypath="views.skills.cardsIntro" tag="span">
          <template #bold><b class="text-violet-300">{{ $t('views.skills.userFirst') }}</b></template>
        </i18n-t>
      </p>
      <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        <div v-for="c in userCards" :key="c.id" class="rounded-lg border border-violet-400/30 bg-violet-400/5 p-2.5">
          <div class="flex flex-wrap items-center gap-1.5">
            <b class="text-sm text-violet-200">{{ c.skill }}</b>
            <span class="rounded bg-violet-400/20 px-1.5 text-2xs text-violet-300">{{ $t('views.skills.mine') }}</span>
          </div>
          <div class="mt-1 text-xs text-emerald-300/90">{{ c.prescription }}</div>
          <div class="mt-0.5 text-xs-plus text-slate-500">{{ $t('views.skills.trigger', { list: (c.trigger || []).join($t('common.listSep')) }) }}</div>
          <div class="mt-1.5 flex gap-1.5">
            <button class="btn btn-ghost btn-sm" @click="cardEditing = c; cardForm = { skill: c.skill, trigger: (c.trigger || []).join(','), prescription: c.prescription, example: c.example }">{{ $t('views.skills.edit') }}</button>
            <button class="btn btn-ghost btn-sm" @click="cardToSkill(c)">{{ $t('views.skills.toSkill') }}</button>
            <button class="btn btn-danger btn-sm" @click="removeCard(c)">{{ $t('common.delete') }}</button>
          </div>
        </div>
        <div v-for="c in autoCards" :key="c.id" class="rounded-lg bg-white/5 p-2.5">
          <div class="flex flex-wrap items-center gap-1.5">
            <b class="text-sm text-slate-100">{{ c.skill }}</b>
            <span class="rounded bg-white/10 px-1.5 text-2xs text-slate-400">{{ $t('views.skills.autoCount', { n: c.count }) }}</span>
          </div>
          <div class="mt-1 text-xs text-emerald-300/80">{{ c.prescription }}</div>
          <div class="mt-0.5 line-clamp-1 text-xs-plus text-slate-500">{{ $t('views.skills.example', { text: c.example }) }}</div>
          <button class="btn btn-ghost btn-sm mt-1.5" @click="cardToSkill(c)">{{ $t('views.skills.toSkill') }}</button>
        </div>
      </div>
      <!-- 卡片表单 -->
      <Teleport to="body">
        <div v-if="cardEditing" class="overlay" @click.self="cardEditing = null">
          <div class="glass w-full max-w-lg p-5">
            <h3 class="mb-3 text-sm font-bold text-slate-200">{{ cardEditing.id ? $t('views.skills.editCard') : $t('views.skills.newCard') }}</h3>
            <div class="grid grid-cols-2 gap-2">
              <label class="text-xs text-slate-400">{{ $t('views.skills.f.skill') }}
                <input v-model="cardForm.skill" class="input mt-1" :placeholder="$t('views.skills.ph.skill')" />
              </label>
              <label class="text-xs text-slate-400">{{ $t('views.skills.f.trigger') }}
                <input v-model="cardForm.trigger" class="input mt-1" :placeholder="$t('views.skills.ph.trigger')" />
              </label>
            </div>
            <label class="mt-2 block text-xs text-slate-400">{{ $t('views.skills.f.prescription') }}
              <textarea v-model="cardForm.prescription" rows="3" class="textarea mt-1 text-xs"
                :placeholder="$t('views.skills.ph.prescription')"></textarea>
            </label>
            <label class="mt-2 block text-xs text-slate-400">{{ $t('views.skills.f.example') }}
              <input v-model="cardForm.example" class="input mt-1" :placeholder="$t('views.skills.ph.example')" />
            </label>
            <div class="mt-3 flex justify-end gap-2">
              <button class="btn btn-ghost" @click="cardEditing = null">{{ $t('common.cancel') }}</button>
              <button class="btn" @click="saveCardForm">{{ $t('common.save') }}</button>
            </div>
          </div>
        </div>
      </Teleport>
    </section>

    <!-- 编辑抽屉 -->
    <Teleport to="body">
      <div v-if="detail" class="overlay-end" @click.self="detail = null">
        <div class="drawer-panel-wide flex flex-col">
          <div class="mb-3 flex items-center gap-3">
            <b class="text-lg text-slate-100">{{ detail.name }}</b>
            <span class="text-xs text-slate-500">{{ detail.id }} · {{ catText(catLabel(detail.category)) }} → {{ targetLabel(detail.target) }}</span>
            <button class="btn btn-ghost ml-auto" @click="detail = null">{{ $t('common.close') }}</button>
            <button v-if="detail.category === '系统提示词' && detail.overridden" class="btn btn-ghost text-amber-300" @click="resetSys">{{ $t('views.skills.resetBuiltin') }}</button>
            <button v-if="!detail.builtin && detail.category !== '系统提示词'" class="btn btn-danger" @click="remove(detail)">{{ $t('common.delete') }}</button>
            <button class="btn" :disabled="saving" @click="save">{{ saving ? $t('common.saving') : $t('views.skills.saveAuto') }}</button>
          </div>
          <p class="mb-2 text-xs-plus text-slate-500">
            <template v-if="detail.category === '系统提示词'">
              <i18n-t keypath="views.skills.sysHint" tag="span">
                <template #ph><code v-pre>{{knowledge}}</code></template>
              </i18n-t>
            </template>
            <template v-else>{{ $t('views.skills.styleHint') }}</template>
          </p>
          <textarea v-model="editText" class="textarea flex-1 w-full font-mono text-xs leading-relaxed" spellcheck="false"></textarea>
        </div>
      </div>
    </Teleport>

    <!-- 新建 -->
    <Teleport to="body">
      <div v-if="createVisible" class="overlay" @click.self="createVisible = false">
        <div class="glass w-full max-w-xl p-5">
          <h3 class="mb-3 text-sm font-bold text-slate-200">{{ $t('views.skills.newTitle') }}</h3>
          <div class="mb-2 grid grid-cols-2 gap-2">
            <label class="text-xs text-slate-400">{{ $t('views.skills.f.name') }}
              <input v-model="newName" class="input mt-1" :placeholder="$t('views.skills.ph.name')" />
            </label>
            <label class="text-xs text-slate-400">{{ $t('views.skills.f.cat') }}
              <StyledSelect v-model="newCat" class="mt-1" :options="['导演风格', '生图风格', '拆剧本', '演员表演']" :labels="Object.fromEntries(['导演风格', '生图风格', '拆剧本', '演员表演'].map((c) => [c, catText(c)]))" storage-key="wb.skills.new.cat" />
            </label>
            <label class="text-xs text-slate-400">{{ $t('views.skills.f.target') }}
              <StyledSelect v-model="newTarget" class="mt-1" :options="['storyboard', 'image', 'script', 'acting']" :labels="Object.fromEntries(['storyboard', 'image', 'script', 'acting'].map((v) => [v, targetLabel(v) + ' · ' + v]))" storage-key="wb.skills.new.target" />
            </label>
            <label class="text-xs text-slate-400">{{ $t('views.skills.f.desc') }}
              <input v-model="newDesc" class="input mt-1" />
            </label>
          </div>
          <textarea v-model="newText" rows="8" class="textarea w-full font-mono text-xs leading-relaxed"
            :placeholder="$t('views.skills.ph.text')"></textarea>
          <div class="mt-3 flex justify-end gap-2">
            <button class="btn btn-ghost" @click="createVisible = false">{{ $t('common.cancel') }}</button>
            <button class="btn" @click="create">{{ $t('views.home.create') }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
