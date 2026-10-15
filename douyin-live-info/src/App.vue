<template>
  <n-config-provider :theme-overrides="themeOverrides">
    <n-message-provider>
      <div v-if="!checked" class="boot">正在校验授权…</div>
      <LicenseGate v-else-if="!licensed" @activated="onActivated" />
      <div v-else class="app-frame">
        <AppTitlebar />
        <div class="app-body">
          <AppSidebar :current="currentRoute" @navigate="navigate" />
          <div class="app-content">
            <router-view v-slot="{ Component }">
              <transition name="page" mode="out-in">
                <component :is="Component" />
              </transition>
            </router-view>
          </div>
        </div>
      </div>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { NConfigProvider, NMessageProvider, type GlobalThemeOverrides } from 'naive-ui'
import AppTitlebar from './components/AppTitlebar.vue'
import AppSidebar from './components/AppSidebar.vue'
import LicenseGate from './components/LicenseGate.vue'

const router = useRouter()
const route = useRoute()

const currentRoute = computed(() => route.path)

// 授权校验：没授权就先显示激活页，整个主界面不渲染
const checked = ref(false)
const licensed = ref(false)

function onActivated() {
  licensed.value = true
}

onMounted(async () => {
  try {
    const st = await (window as any).electronAPI.licenseStatus()
    licensed.value = !!st?.licensed
  } catch {
    licensed.value = false
  } finally {
    checked.value = true
  }
})

function navigate(path: string) {
  router.push(path)
}

const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#f97316',
    primaryColorHover: '#fb923c',
    primaryColorPressed: '#ea580c',
    borderRadius: '10px',
    fontFamily: 'Microsoft YaHei UI, system-ui, sans-serif',
    borderColor: '#d8dbe0',
    dividerColor: '#e6e8ec'
  },
  DataTable: {
    tdColor: '#ffffff',
    thColor: '#f7f8fa',
    borderColor: '#e6e8ec',
    thTextColor: '#6b7280',
    tdTextColor: '#374151'
  },
  Input: {
    color: '#ffffff',
    borderColor: '#d8dbe0',
    colorFocus: '#ffffff'
  },
  Tabs: {
    tabTextColorLine: '#6b7280',
    tabTextColorActiveLine: '#f97316',
    barColor: '#f97316'
  },
  Button: {
    borderRadiusMedium: '8px',
    borderRadiusSmall: '6px'
  },
  InternalSelection: {
    color: '#ffffff',
    borderColor: '#d8dbe0'
  }
}
</script>

<style>
/*
   众艺传媒 · 抖音直播运营工具 —— 主题：直播信号台（Live Signal）
   冷调近白底 + 电光橙（品牌色，来自公司图标）+ 信号青（实时/数据）。
   刻意不用「所有卡片同样圆角、同样阴影」的通用模板相，改按角色分三级。
*/
:root {
  /* 顶部信号栏：本设计的“大胆之处”，只在这一处用力 */
  --rail-h: 52px;
  --ink: #10131a;
  --ink-2: #3d4657;
  --ink-3: #6b7688;
  --ink-4: #9aa3b2;
  --bg: #f4f6fb;
  --surface: #ffffff;
  --surface-2: #f8fafd;
  --line: #e3e8f0;
  --line-2: #cfd7e3;
  --brand: #ff6a1a;
  --brand-soft: rgba(255, 106, 26, 0.1);
  --signal: #00b4d8;
  --ok: #12b76a;
  --warn: #f79009;
  --bad: #f04438;
  --r-sm: 6px;
  --r-md: 10px;
  --r-lg: 14px;
  --font: 'HarmonyOS Sans SC', 'MiSans', 'Source Han Sans SC', 'OPPO Sans', 'Microsoft YaHei UI', system-ui, sans-serif;
  /* 数字/房间号用 Bahnschrift（Windows 自带的 DIN 风），数据台的气质靠它 */
  --font-num: 'Bahnschrift', 'DIN Alternate', 'Consolas', monospace;
  --shadow-panel: 0 1px 2px rgba(16, 19, 26, 0.04), 0 8px 24px rgba(16, 19, 26, 0.05);
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
.boot {
  width: 100%;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9aa1ab;
  font-size: 12px;
}

  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font);
  -webkit-app-region: no-drag;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

.app-frame {
  display: grid;
  grid-template-rows: auto 1fr;
  width: 100%;
  height: 100vh;
  overflow: hidden;
}

.app-body {
  display: grid;
  grid-template-columns: 200px 1fr;
  overflow: hidden;
  min-height: 0;
}

.app-content {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  min-width: 0;
}

.app-content > * {
  flex: 1;
  min-height: 0;
}

::-webkit-scrollbar {
  width: 5px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #d8dbe0;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #9aa1ab;
}

.page-enter-active,
.page-leave-active {
  transition: opacity 0.2s ease;
}

.page-enter-from,
.page-leave-to {
  opacity: 0;
}

.card {
  background: var(--surface);
  border-radius: var(--r-lg);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-panel);
}

.muted { color: #9aa1ab; }
.secondary { color: #6b7280; }
.accent { color: var(--brand); }
/* 数字统一用等宽数据字体，房间号/时长/大小一眼成列 */
.num { font-family: var(--font-num); font-variant-numeric: tabular-nums; letter-spacing: 0.2px; }
.small { font-size: 11px; }

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: #9aa1ab;
  gap: 10px;
}

.empty-icon { font-size: 36px; color: #d8dbe0; }

.page-title {
  font-size: 18px;
  font-weight: 700;
  color: #1f2328;
  margin-bottom: 4px;
}

@keyframes loading-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}

.loading-bar {
  height: 2px;
  width: 100%;
  overflow: hidden;
  background: #ffffff;
  border-radius: 1px;
}

.loading-bar-inner {
  width: 30%;
  height: 100%;
  background: linear-gradient(90deg, #f97316, #ef4444);
  border-radius: 1px;
  animation: loading-slide 1.2s ease-in-out infinite;
}
</style>
