<template>
  <n-config-provider :theme-overrides="themeOverrides">
    <n-message-provider>
      <n-dialog-provider>
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
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { NConfigProvider, NDialogProvider, NMessageProvider, type GlobalThemeOverrides } from 'naive-ui'
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

  const api = (window as any).electronAPI
  // 联网复查授权（吐销名单）：查得到就按名单执行，断网就放行 —— 不能让运营当场干不了活。
  // 启动后主进程每 30 分钟还会自己再查一次。
  try {
    await api.licenseRecheck()
    const st = await api.licenseStatus()
    if (!st?.licensed) licensed.value = false
  } catch { /* 联网失败不影响已有授权 */ }

  // 运行中被管理员停用：立刻退回激活页
  api.removeLicenseListeners()
  api.onLicenseRevoked(() => { licensed.value = false })
})

function navigate(path: string) {
  router.push(path)
}

const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#1f4e8a',
    primaryColorHover: '#265f9f',
    primaryColorPressed: '#173d6d',
    primaryColorSuppl: '#3a6fb5',
    borderRadius: '10px',
    fontFamily:
      "'ZY Sans SC', 'Noto Sans SC', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', 'PingFang SC', system-ui, sans-serif",
    borderColor: '#e4eaf1',
    dividerColor: '#e4eaf1'
  },
  DataTable: {
    tdColor: '#ffffff',
    thColor: '#f4f7fb',
    borderColor: '#e4eaf1',
    thTextColor: '#4a5d73',
    tdTextColor: '#1e2d3d'
  },
  Input: {
    color: '#ffffff',
    borderColor: '#d6dde6',
    colorFocus: '#ffffff'
  },
  Tabs: {
    tabTextColorLine: '#4a5d73',
    tabTextColorActiveLine: '#1f4e8a',
    barColor: '#1f4e8a'
  },
  Button: {
    borderRadiusMedium: '8px',
    borderRadiusSmall: '6px'
  },
  InternalSelection: {
    color: '#ffffff',
    borderColor: '#d6dde6'
  }
}
</script>

<style>
/*
   众艺传媒 · 抖音直播运营工具 —— 主题：冷律（Cool Pulse）
   一条深青蓝→亮青的“律动带”放在最顶部的品牌栏（全站唯一的大胆处），
   下面收着：冰蓝白底 + 白卡片 + 冷墨字。
   全站只用一套冷色三角：深青蓝（可点/选中）/ 电光青（数据）/ 薄荷（状态）；
   唯一暖色留给众艺 Logo 与「直播中」，不再新增第三套强调色。
   字体：内置 Noto Sans SC 可变字体（100–900 全字重），运营电脑不装字体也是同一副字。
*/
@font-face {
  font-family: 'ZY Sans SC';
  src: url('./assets/fonts/NotoSansSC-VF.ttf') format('truetype');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}

:root {
  --rail-h: 50px;
  --side-w: 212px;

  /* 商务稳重的靛蓝品牌栏：顶部渐浅 → 底部稳重 */
  --rail-top: #2a4f7a;
  --rail: #1c3d62;
  --close-hover: #c0392b;

  /* 墨色（商务克制）：正文 / 次要 / 提示 / 极淡 */
  --ink: #10233a;
  --ink-2: #263b54;
  --ink-3: #4a5d73;
  --ink-4: #6b7d90;

  /* 冷蓝灰的面与线 */
  --bg: #f4f6f9;
  --surface: #ffffff;
  --surface-2: #f6f8fb;
  --line: #e4eaf1;
  --line-2: #d6dde6;

  /* 主色：靛蓝（商务） */
  --pulse-accent: #1f4e8a;
  --pulse-deep: #173d6d;
  --pulse-blue: #265f9f;
  --pulse-cyan: #3a87c4;
  --pulse-mint: #2a9d8f;
  --pulse-line: linear-gradient(100deg, #173d6d 0%, #1f4e8a 34%, #265f9f 74%, #3a87c4 100%);
  --pulse-soft: rgba(31, 78, 138, 0.08);
  --pulse-violet: var(--pulse-accent);

  /* 语义四色：固定不混用（软色给浅底标签/提示条） */
  --signal: #2a9d8f;
  --ok: #167a4a;
  --warn: #b4830c;
  --bad: #c0392b;
  --ok-soft: rgba(22, 122, 74, 0.12);
  --warn-soft: rgba(180, 131, 12, 0.14);
  --bad-soft: rgba(192, 57, 43, 0.12);

  /* 字阶（中文界面）：正文 13.5 / 小字 12 / 极小 11 / 小标题 14 / 面板 16 / 页面标题 20 */
  --fs-body: 13.5px;
  --fs-meta: 12px;
  --fs-micro: 11px;
  --fs-h3: 14px;
  --fs-h2: 16px;
  --fs-h1: 20px;
  --lh-body: 1.62;
  --lh-tight: 1.35;

  --r-sm: 6px;
  --r-md: 10px;
  --r-lg: 14px;
  /* 内置字体排在第一，运营电脑没装中文黑体也能保证同一副字 */
  --font: 'ZY Sans SC', 'Noto Sans SC', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', 'PingFang SC', system-ui, sans-serif;
  /* 数字/房间号用 Bahnschrift（Windows 自带的 DIN 风），数据台的气质靠它 */
  --font-num: 'Bahnschrift', 'DIN Alternate', 'Consolas', monospace;
  --shadow-panel: 0 1px 2px rgba(12, 31, 46, 0.04), 0 8px 24px rgba(16, 80, 120, 0.07);
  --shadow-raised: 0 6px 18px rgba(16, 80, 120, 0.1);
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body,
#app {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg);
  color: var(--ink);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  letter-spacing: 0.01em;
  font-family: var(--font);
  -webkit-app-region: no-drag;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

.boot {
  width: 100%;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-4);
  font-size: 12px;
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
  grid-template-columns: var(--side-w) 1fr;
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
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #cfddea;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #a8c0d4;
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

.muted { color: var(--ink-4); }
.secondary { color: var(--ink-3); }
.accent { color: var(--pulse-accent); }
/* 数字统一用等宽数据字体，房间号/时长/大小一眼成列 */
.num { font-family: var(--font-num); font-variant-numeric: tabular-nums; letter-spacing: 0.2px; }
.small { font-size: var(--fs-micro); }

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--ink-4);
  gap: 10px;
}

.empty-icon { font-size: 36px; color: var(--line-2); }

.page-title {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.2px;
  color: var(--ink);
  line-height: var(--lh-tight);
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
  background: var(--surface);
  border-radius: 1px;
}

.loading-bar-inner {
  width: 30%;
  height: 100%;
  background: var(--pulse-line);
  border-radius: 1px;
  animation: loading-slide 1.2s ease-in-out infinite;
}
</style>
