// -*- coding: utf-8 -*-
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { i18n } from './i18n'
import { installFetchLanguage } from './i18n/fetchLanguage'
import './styles/main.css'

installFetchLanguage()

createApp(App).use(i18n).use(router).mount('#app')
