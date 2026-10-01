// -*- coding: utf-8 -*-
/** 界面多语言：zh 为源语言（键结构基准），en / ru 必须与之同构（typecheck 保证不缺键）。 */
import { createI18n } from 'vue-i18n'
import zh from './locales/zh/index'
import en from './locales/en/index'
import ru from './locales/ru/index'

export const LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' },
  { code: 'zh', label: '中文' }
] as const
export type Locale = (typeof LOCALES)[number]['code']

const STORAGE_KEY = 'wb.locale'
const HTML_LANG: Record<Locale, string> = { en: 'en', ru: 'ru', zh: 'zh-CN' }

function isLocale(v: unknown): v is Locale {
  return LOCALES.some((l) => l.code === v)
}

/** 优先级：用户手选（localStorage）→ 浏览器语言 → en */
function detectLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (isLocale(saved)) return saved
  for (const lang of navigator.languages || [navigator.language]) {
    const base = String(lang || '').toLowerCase().split('-')[0]
    if (isLocale(base)) return base
  }
  return 'en'
}

const initial = detectLocale()

export const i18n = createI18n({
  legacy: false,
  locale: initial,
  fallbackLocale: 'en',
  messages: { zh, en, ru }
})

/** 非组件代码（store / utils / api）里用的翻译函数 */
export const t = i18n.global.t
export const te = i18n.global.te

export function currentLocale(): Locale {
  return i18n.global.locale.value as Locale
}

/** Значение Accept-Language для запросов к бэкенду: по нему сервер выбирает язык сообщений. */
export function backendLanguage(): string {
  return HTML_LANG[currentLocale()]
}

export function setLocale(code: Locale) {
  i18n.global.locale.value = code
  localStorage.setItem(STORAGE_KEY, code)
  document.documentElement.lang = HTML_LANG[code]
}

document.documentElement.lang = HTML_LANG[initial]

export type VocabKind = 'shotSize' | 'cameraMove' | 'angle' | 'transition'

/** 受控词表（景别/运镜/角度/转场）的显示名：数据里存中文原值，界面按当前语言显示；未知值原样返回。 */
export function vocab(kind: VocabKind, value: string | undefined | null): string {
  const v = String(value ?? '')
  const key = `vocab.${kind}.${v}`
  return v && te(key) ? t(key) : v
}
