<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { createChatGPTRun, fetchChatGPTRun, controlChatGPTRun } from '../api'
import { toast } from '../stores/app'
import { t, te } from '../i18n'
import { toChatGPTRunView, type ChatGPTRun } from '../utils/chatgptRun'
const props=withDefaults(defineProps<{project:string;jobIds:string[];disabled?:boolean;compact?:boolean}>(),{disabled:false,compact:false})
const emit=defineEmits<{completed:[];changed:[run:ChatGPTRun]}>()
const run=ref<ChatGPTRun|null>(null),token=ref(''),message=ref(''),busy=ref(false)
const active=computed(()=>!!run.value && !['done','cancelled','failed'].includes(run.value.status))
const view=computed(()=>run.value?toChatGPTRunView(run.value):null)
const phaseLabel=computed(()=>{const p=view.value?.phase||'';return te('components.chatgpt.phase.'+p)?t('components.chatgpt.phase.'+p):p})
const key=()=>`previs.image-use.${props.project}`
let timer:ReturnType<typeof setInterval>|undefined
let refreshing=false
const TERMINAL=['done','cancelled','failed']
function stopPolling(){if(timer){clearInterval(timer);timer=undefined}}
function ensurePolling(){if(!timer)timer=setInterval(refresh,2000)}
async function refresh(){
 if(!run.value || refreshing)return
 const project=props.project,id=run.value.run_id
 refreshing=true
 try{
  const current=(await fetchChatGPTRun(project,id)).run
  if(project!==props.project || run.value?.run_id!==id)return
  const prev=run.value.status
  const done=current.status==='done' && prev!=='done'
  run.value=current;emit('changed',current);if(done)emit('completed')
  // 终态汇入统一任务通知（右下角 toast，与后端 job 通知同一通道），不再只在面板里静默变化
  if(TERMINAL.includes(current.status) && !TERMINAL.includes(prev)){
    const imported=(current as unknown as {imported_count?:number}).imported_count
    const total=(current as unknown as {total_count?:number}).total_count
    const scope=(current as unknown as {job_count?:number}).job_count ?? total ?? ''
    if(current.status==='done') toast(scope!==''?t('components.chatgpt.toastDoneCount',{imported:imported ?? '?',total:scope}):t('components.chatgpt.toastDone'),'ok')
    else if(current.status==='failed') toast(t('components.chatgpt.toastFailed',{reason:current.pause_reason || t('components.chatgpt.toastFailedFallback')}),'err',8000)
    else if(current.status==='cancelled') toast(t('components.chatgpt.toastCancelled'),'info',6000)
  }
  // 队列跑完/取消/失败后再每 2s 打一次 /api 是纯浪费（且会话过期时静默失败、页面看着像坏了）
  if(TERMINAL.includes(current.status))stopPolling()
 }catch(e){message.value=String(e)}finally{refreshing=false}
}
async function start(ids?:string[]){
 if(active.value || busy.value)return false
 const selected=[...new Set(ids?.length?ids:props.jobIds)]
 if(!selected.length)return false
 busy.value=true;message.value=''
 try{
  const current=(await createChatGPTRun({project:props.project,job_ids:selected,options:{vision_validation:false,auto_import:true}})).run
  run.value=current;token.value=current.run_token || ''
  localStorage.setItem(key(),JSON.stringify({id:current.run_id,token:token.value}))
  ensurePolling();emit('changed',current);return true
 }catch(e){message.value=String(e);return false}finally{busy.value=false}
}
async function control(action:'pause'|'resume'|'cancel'){
 if(!run.value || !token.value)return
 try{
  run.value=(await controlChatGPTRun(props.project,run.value.run_id,token.value,action)).run
  ensurePolling()
  message.value=action==='resume'?t('components.chatgpt.resuming'):t('components.chatgpt.stopRequested')
 }catch(e){message.value=String(e)}
}
watch(()=>props.project,async()=>{
 run.value=null;token.value='';message.value=''
 const project=props.project,storageKey=key()
 try{
  const raw=localStorage.getItem(storageKey) || sessionStorage.getItem(storageKey)
  const saved=JSON.parse(raw || 'null')
  if(saved){
   const restored=(await fetchChatGPTRun(project,saved.id)).run
   if(project!==props.project)return
   token.value=saved.token;run.value=restored
   localStorage.setItem(storageKey,JSON.stringify(saved))
   sessionStorage.removeItem(storageKey)
  }
 }catch{}
},{immediate:true})
onMounted(()=>{ensurePolling()})
onBeforeUnmount(()=>{if(timer)clearInterval(timer)})
defineExpose({start,refresh})
</script>
<template>
 <section class="my-3 rounded-xl border border-sky-400/20 bg-sky-400/5 p-3 text-xs">
  <div class="flex flex-wrap items-center gap-2">
   <strong class="text-sky-200">{{ $t('components.chatgpt.title') }}</strong>
   <a href="https://github.com/leeguooooo/image-use" target="_blank" rel="noopener" :title="$t('components.chatgpt.serviceTitle')" class="text-slate-400">image-use ↗</a>
   <button class="btn btn-sm" :disabled="disabled || busy || active || !jobIds.length" @click="start()">{{busy?$t('components.chatgpt.starting'):$t('components.chatgpt.start',{n:jobIds.length})}}</button>
   <button v-if="active" class="btn btn-sm" @click="control('pause')">{{ $t('components.chatgpt.pause') }}</button>
   <button v-if="run?.status==='paused' || (active && run?.worker_active===false)" class="btn btn-sm" @click="control('resume')">{{ $t('components.chatgpt.resume') }}</button>
   <button v-if="active" class="btn btn-sm" @click="control('cancel')">{{ $t('components.chatgpt.cancel') }}</button>
  </div>
  <p class="mt-2 text-slate-400">{{ $t('components.chatgpt.hint') }}</p>
  <p v-if="view" class="mt-2 text-sky-200">{{phaseLabel}} · {{$t('components.chatgpt.progress',{done:view.completed,total:view.total})}} · {{run?.current_attempt?.job_id}}</p>
  <p v-if="run?.stop_requested" class="mt-2 text-amber-200">{{ $t('components.chatgpt.stopState',{what:run.stop_requested==='cancel'?$t('components.chatgpt.cancel'):$t('components.chatgpt.pause')}) }}</p>
  <p v-if="run?.pause_reason" class="mt-2 text-amber-200">{{run.pause_reason}}</p>
  <p v-if="message" class="mt-2 text-amber-200">{{message}}</p>
 </section>
</template>
