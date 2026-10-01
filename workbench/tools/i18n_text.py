# -*- coding: utf-8 -*-
"""Язык сообщений бэкенда (en / ru / zh).

Исходный текст в коде остаётся китайским и служит ключом каталога, как в gettext:
    tr("项目不存在")
    tr("读取资产引用失败：{err}", err=scrub_err(exc))
(функция называется tr, а не _: в server.py `_` уже используется как служебная переменная.)
Переводы лежат в tools/locales/<lang>.json ({"китайский текст": "перевод"}).
Нет перевода или язык zh — возвращается исходный текст, поэтому поведение по умолчанию
и тесты, проверяющие китайские сообщения, не меняются.

Язык запроса задаёт сервер (Accept-Language → set_lang) в начале обработки запроса.
Подпроцессы задач получают его через переменную окружения SLATE_LANG.
Строки, которые фронтенд разбирает по шаблону (PROGRESS, DEPTH ->, 已生成脚本…), через tr() не пропускать.
"""
import contextvars
import json
import os
import threading

SUPPORTED = ("zh", "en", "ru")
DEFAULT = "zh"
ENV_KEY = "SLATE_LANG"
_LOCALES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "locales")

_current = contextvars.ContextVar("slate_lang", default=None)
_catalogs = {}
_lock = threading.Lock()


def normalize(code):
    """'ru-RU' / 'en' / 'zh-CN' → 'ru' / 'en' / 'zh'; неизвестное → None."""
    base = str(code or "").strip().lower().replace("_", "-").split("-")[0]
    return base if base in SUPPORTED else None


def parse_accept_language(header):
    """Первый поддерживаемый язык из Accept-Language с учётом q-весов; иначе DEFAULT."""
    ranked = []
    for i, part in enumerate(str(header or "").split(",")):
        piece = part.strip()
        if not piece:
            continue
        tag, _sep, params = piece.partition(";")
        q = 1.0
        for param in params.split(";"):
            name, _eq, value = param.strip().partition("=")
            if name == "q":
                try:
                    q = float(value)
                except ValueError:
                    q = 0.0
        code = normalize(tag)
        if code and q > 0:
            ranked.append((-q, i, code))
    return sorted(ranked)[0][2] if ranked else DEFAULT


def set_lang(code):
    """Язык текущего контекста (запроса). Возвращает токен для reset_lang."""
    return _current.set(normalize(code) or DEFAULT)


def reset_lang(token):
    _current.reset(token)


def current_lang():
    return _current.get() or normalize(os.environ.get(ENV_KEY)) or DEFAULT


def subprocess_env(env=None, lang=None):
    """Копия окружения для подпроцесса задачи с SLATE_LANG = язык запроса."""
    out = dict(os.environ if env is None else env)
    out[ENV_KEY] = normalize(lang) or current_lang()
    return out


def _catalog(lang):
    with _lock:
        if lang not in _catalogs:
            data = {}
            try:
                with open(os.path.join(_LOCALES_DIR, lang + ".json"), encoding="utf-8") as f:
                    data = json.load(f)
            except (OSError, ValueError):
                data = {}
            _catalogs[lang] = data
        return _catalogs[lang]


def tr(text, lang=None, **params):
    """Перевод китайского исходного текста на язык запроса; {name} подставляются из params."""
    code = normalize(lang) or current_lang()
    message = text if code == DEFAULT else (_catalog(code).get(text) or text)
    return message.format(**params) if params else message

