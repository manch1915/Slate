// -*- coding: utf-8 -*-
// Сгенерировано из мастер-словаря: zh / en / ru держим синхронно.
import type zh from '../zh/api'

export default {
  notLoggedIn: 'Вход не выполнен',
  cancelled: 'Отменено',
  timeout: 'Превышено время ожидания (>{s} с): {url}',
  slot: {
    text: 'Текст',
    vision: 'Зрение',
    image: 'Изображения',
    image_edit: 'Правка изображений',
    video: 'Видео',
    music: 'Музыка',
    speech: 'Речь'
  },
  runControlFailed: 'Не удалось управлять запуском ({status})',
  importFailed: 'Ошибка импорта ({status})',
  noVersion: 'У задачи нет номера версии: {file}'
} satisfies typeof zh
