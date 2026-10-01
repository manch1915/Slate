// -*- coding: utf-8 -*-
/** Добавляет Accept-Language с текущим языком интерфейса ко всем запросам на свой сервер.
 *  Одна точка вместо правки каждого fetch (api.ts, компоненты, загрузки файлов);
 *  явно переданный заголовок не перезаписывается, внешние адреса не трогаются. */
import { backendLanguage } from './index'

function sameOrigin(input: RequestInfo | URL): boolean {
  const raw = input instanceof Request ? input.url : String(input)
  try {
    return new URL(raw, window.location.href).origin === window.location.origin
  } catch {
    return false
  }
}

export function installFetchLanguage(): void {
  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!sameOrigin(input)) return nativeFetch(input, init)
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (!headers.has('Accept-Language')) headers.set('Accept-Language', backendLanguage())
    return nativeFetch(input, { ...init, headers })
  }
}
