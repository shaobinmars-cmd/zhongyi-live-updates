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
    primaryColor: '#0B76BE',
    primaryColorHover: '#138FDB',
    primaryColorPressed: '#0A5FA8',
    primaryColorSuppl: '#00C2D1',
    borderRadius: '10px',
    fontFamily:
      "'ZY Sans SC', 'Noto Sans SC', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', 'PingFang SC', system-ui, sans-serif",
    borderColor: '#e2ebf4',
    dividerColor: '#e2ebf4'
  },
  DataTable: {
    tdColor: '#ffffff',
    thColor: '#f7fbff',
    borderColor: '#e2ebf4',
    thTextColor: '#56748a',
    tdTextColor: '#2c4658'
  },
  Input: {
    color: '#ffffff',
    borderColor: '#cfddea',
    colorFocus: '#ffffff'
  },
  Tabs: {
    tabTextColorLine: '#56748a',
    tabTextColorActiveLine: '#0B76BE',
    barColor: '#0B76BE'
  },
  Button: {
    borderRadiusMedium: '8px',
    borderRadiusSmall: '6px'
  },
  InternalSelection: {
    color: '#ffffff',
    borderColor: '#cfddea'
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
  --rail-h: 60px;
  --side-w: 212px;

  /* 冷墨四级：正文 / 次要 / 提示 / 极淡 */
  --ink: #0c1f2e;
  --ink-2: #2c4658;
  --ink-3: #56748a;
  --ink-4: #647f92;

  /* 冰蓝白的面与线 */
  --bg: #f2f7fb;
  --surface: #ffffff;
  --surface-2: #f7fbff;
  --line: #e2ebf4;
  --line-2: #cfddea;

  /* 冷色主调：深青蓝 → 电光青 → 薄荷 */
  --pulse-accent: #0b76be;
  --pulse-deep: #0a5fa8;
  --pulse-blue: #1e8fe0;
  --pulse-cyan: #00c2d1;
  --pulse-mint: #2bd8c0;
  --pulse-line: linear-gradient(100deg, #0a5fa8 0%, #1e8fe0 34%, #00c2d1 74%, #2bd8c0 100%);
  --pulse-soft: rgba(11, 118, 190, 0.1);
  --pulse-violet: var(--pulse-accent); /* 旧名保留，指向冷色主调 */

  /* 品牌暖色：只给 Logo 与「直播中」，是全站唯一的暖 */
  --brand: #ff6a1a;
  --brand-2: #ff3d77;
  --brand-soft: rgba(255, 106, 26, 0.1);

  /* 语义四色：固定不混用 */
  --signal: #00b8d4;
  --ok: #0fa97a;
  --warn: #f5a524;
  --bad: #ef4e4e;

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
