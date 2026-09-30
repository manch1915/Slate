<script setup lang="ts">
// -*- coding: utf-8 -*-
/** 用量计费：月份切换 + 总览卡片（调用数/成功率/预估费用）+ 厂商×能力表格 + 最近记录表。
 *  数据来自 workbench/billing/ledger.jsonl（append-only 账本，见 tools/billing.py）。 */
import { ref, computed, onMounted } from 'vue'
import { fetchBillingSummary, fetchBillingRecords, type BillingSummary, type BillingRecord } from '../api'
import { toast } from '../stores/app'
import { t, te } from '../i18n'

const GLOW = 'rgba(52,211,153,0.35)'

const month = ref('')            // '' = 全部月份；否则 YYYY-MM
const summary = ref<BillingSummary | null>(null)
const records = ref<BillingRecord[]>([])
const loading = ref(false)

/* 月份切换选项：当前月往前 12 个月 + 全部 */
const monthOptions = computed(() => {
  const out: { value: string; label: string }[] = [{ value: '', label: t('views.billing.allMonths') }]
  const d = new Date()
  for (let i = 0; i < 12; i++) {
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    out.push({ value: v, label: v })
    d.setMonth(d.getMonth() - 1)
  }
  return out
})

const kindLabel = (k: string) => (k && te('views.billing.kind.' + k) ? t('views.billing.kind.' + k) : k) || '—'

/** 币种分桶 → “¥1.23 / $0.45” 文本；空桶显示“—”。 */
function costText(cost: Record<string, number> | undefined): string {
  const entries = Object.entries(cost || {}).filter(([, v]) => v)
  if (!entries.length) return '—'
  return entries.map(([cur, v]) => `${cur === 'CNY' ? '¥' : cur + ' '}${v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`).join(' / ')
}

const successRate = computed(() => {
  const total = summary.value?.total
  if (!total || !total.calls) return '—'
  return ((total.ok / total.calls) * 100).toFixed(1) + '%'
})

function fmtUnits(r: BillingRecord): string {
  if (r.usage) return `${r.usage.prompt_tokens ?? 0}+${r.usage.completion_tokens ?? 0} tok`
  const u = r.units || {}
  if (u.images) return t('views.billing.images', { n: u.images })
  if (u.seconds) return `${u.seconds}s`
  if (u.chars) return t('views.billing.chars', { n: u.chars })
  return ''
}

async function load() {
  loading.value = true
  try {
    const [s, r] = await Promise.all([
      fetchBillingSummary(month.value || undefined),
      fetchBillingRecords(100, month.value || undefined)
    ])
    summary.value = s
    records.value = r.records || []
  } catch (e) {
    toast(e instanceof Error ? e.message : t('views.billing.loadFailed'), 'err')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="mb-6 flex flex-wrap items-end gap-3">
      <div>
        <h1 class="grad-text text-2xl font-black">{{ $t('views.billing.title') }}</h1>
        <p class="mt-1 text-xs text-slate-500">{{ $t('views.billing.lead') }}</p>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <select v-model="month" class="select w-36" @change="load">
          <option v-for="m in monthOptions" :key="m.value" :value="m.value">{{ m.label }}</option>
        </select>
        <button class="btn btn-ghost" :disabled="loading" @click="load">{{ loading ? $t('views.billing.refreshing') : $t('views.billing.refresh') }}</button>
      </div>
    </header>

    <!-- 总览卡片 -->
    <section class="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div class="glass p-4" :style="{ '--glow': GLOW }">
        <div class="text-2xs text-slate-500">{{ $t('views.billing.calls') }}</div>
        <div class="mt-1 text-2xl font-black text-slate-100">{{ summary?.total.calls ?? '—' }}</div>
        <div class="mt-0.5 text-2xs text-slate-500">{{ $t('views.billing.okFail', { ok: summary?.total.ok ?? 0, fail: summary?.total.fail ?? 0 }) }}</div>
      </div>
      <div class="glass p-4" :style="{ '--glow': GLOW }">
        <div class="text-2xs text-slate-500">{{ $t('views.billing.successRate') }}</div>
        <div class="mt-1 text-2xl font-black text-slate-100">{{ successRate }}</div>
        <div class="mt-0.5 text-2xs text-slate-500">{{ $t('views.billing.rateNote') }}</div>
      </div>
      <div class="glass p-4" :style="{ '--glow': GLOW }">
        <div class="text-2xs text-slate-500">{{ $t('views.billing.estCost') }}</div>
        <div class="mt-1 text-2xl font-black text-emerald-300">{{ costText(summary?.total.cost) }}</div>
        <div class="mt-0.5 text-2xs text-slate-500">{{ $t('views.billing.costNote') }}</div>
      </div>
    </section>

    <!-- 按厂商 × 能力 -->
    <section class="glass mb-5 p-4" :style="{ '--glow': GLOW }">
      <h2 class="mb-2 text-sm font-bold text-slate-200">{{ $t('views.billing.byVendor') }}</h2>
      <table v-if="summary?.groups.length" class="w-full text-xs">
        <thead>
          <tr class="text-left text-2xs text-slate-500">
            <th class="pb-1.5">{{ $t('views.billing.col.vendor') }}</th><th class="pb-1.5">{{ $t('views.billing.col.kind') }}</th>
            <th class="pb-1.5 text-right">{{ $t('views.billing.col.calls') }}</th><th class="pb-1.5 text-right">{{ $t('views.billing.col.ok') }}</th>
            <th class="pb-1.5 text-right">{{ $t('views.billing.col.fail') }}</th><th class="pb-1.5 text-right">{{ $t('views.billing.col.cost') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in summary.groups" :key="g.vendor + '/' + g.kind" class="border-t border-line-soft">
            <td class="py-1.5 font-mono text-slate-300">{{ g.vendor }}</td>
            <td class="py-1.5 text-slate-300">{{ kindLabel(g.kind) }}</td>
            <td class="py-1.5 text-right text-slate-300">{{ g.calls }}</td>
            <td class="py-1.5 text-right text-emerald-300">{{ g.ok }}</td>
            <td class="py-1.5 text-right" :class="g.fail ? 'text-rose-300' : 'text-slate-500'">{{ g.fail }}</td>
            <td class="py-1.5 text-right font-semibold text-slate-200">{{ costText(g.cost) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="text-xs text-slate-500">{{ $t('views.billing.noCalls') }}</p>
    </section>

    <!-- 最近记录 -->
    <section class="glass p-4" :style="{ '--glow': GLOW }">
      <h2 class="mb-2 text-sm font-bold text-slate-200">{{ $t('views.billing.recent', { n: records.length }) }}</h2>
      <div class="overflow-x-auto">
        <table v-if="records.length" class="w-full whitespace-nowrap text-xs">
          <thead>
            <tr class="text-left text-2xs text-slate-500">
              <th class="pb-1.5">{{ $t('views.billing.col.time') }}</th><th class="pb-1.5">{{ $t('views.billing.col.vendor') }}</th><th class="pb-1.5">{{ $t('views.billing.col.kind') }}</th>
              <th class="pb-1.5">{{ $t('views.billing.col.model') }}</th><th class="pb-1.5">{{ $t('views.billing.col.op') }}</th><th class="pb-1.5">{{ $t('views.billing.col.result') }}</th>
              <th class="pb-1.5 text-right">{{ $t('views.billing.col.cost') }}</th><th class="pb-1.5">{{ $t('views.billing.col.units') }}</th><th class="pb-1.5">{{ $t('views.billing.col.source') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in records" :key="r.ts + i" class="border-t border-line-soft">
              <td class="py-1.5 font-mono text-slate-400">{{ r.ts }}</td>
              <td class="py-1.5 font-mono text-slate-300">{{ r.vendor }}</td>
              <td class="py-1.5 text-slate-300">{{ kindLabel(r.kind) }}</td>
              <td class="max-w-40 truncate py-1.5 font-mono text-slate-400" :title="r.model">{{ r.model || '—' }}</td>
              <td class="py-1.5 font-mono text-slate-400">{{ r.op }}</td>
              <td class="py-1.5">
                <span v-if="r.ok" class="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-2xs font-bold text-emerald-300">{{ $t('views.billing.col.ok') }}</span>
                <span v-else class="rounded-full bg-rose-500/15 px-1.5 py-0.5 text-2xs font-bold text-rose-300" :title="r.error">{{ $t('views.billing.col.fail') }}</span>
              </td>
              <td class="py-1.5 text-right font-semibold" :class="r.cost ? 'text-slate-200' : 'text-slate-500'">
                {{ r.cost ? `${r.currency === 'CNY' ? '¥' : (r.currency || '') + ' '}${r.cost}` : (r.ok ? '—' : '0') }}
              </td>
              <td class="py-1.5 text-slate-400">{{ fmtUnits(r) }}</td>
              <td class="py-1.5 text-slate-500">{{ r.project || r.source || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="text-xs text-slate-500">{{ $t('views.billing.noRecords') }}</p>
      </div>
    </section>
  </div>
</template>
