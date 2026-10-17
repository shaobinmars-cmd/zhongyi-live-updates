import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import DashboardView from './views/DashboardView.vue'
import LiveRoomsView from './views/LiveRoomsView.vue'
import LiveMonitorView from './views/LiveMonitorView.vue'
import DanmuView from './views/DanmuView.vue'
import RecordingView from './views/RecordingView.vue'
import TeardownView from './views/TeardownView.vue'
import SettingsView from './views/SettingsView.vue'
import AboutView from './views/AboutView.vue'
import IncubateView from './views/IncubateView.vue'

import { useDanmuStore } from './stores/danmu'
import { useRecordStore } from './stores/record'
import { useTeardownStore } from './stores/teardown'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', component: DashboardView },
    { path: '/rooms', component: LiveRoomsView },
    { path: '/live', component: LiveMonitorView },
    { path: '/danmu', component: DanmuView },
    { path: '/recording', component: RecordingView },
    { path: '/teardown', component: TeardownView },
    { path: '/incubate', component: IncubateView },
    { path: '/settings', component: SettingsView },
    { path: '/about', component: AboutView }
  ]
})

const pinia = createPinia()
const app = createApp(App)
app.use(pinia)
app.use(router)

// Register IPC listeners immediately after Pinia is ready,
// before mount, so they work regardless of which page is active.
const danmuStore = useDanmuStore()
danmuStore.setupListeners()

const recordStore = useRecordStore()
recordStore.setupListeners()

const teardownStore = useTeardownStore()
teardownStore.setupListeners()

app.mount('#app')
