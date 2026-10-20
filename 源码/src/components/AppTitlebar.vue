<template>
  <div class="titlebar">
    <div class="rail-brand">
      <div class="rail-mark" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
          <rect x="3" y="3" width="26" height="26" rx="5" stroke="currentColor" stroke-width="2.4" fill="none"/>
          <path d="M10 21 L16 10 L22 21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="16" cy="16" r="2.6" fill="currentColor"/>
        </svg>
      </div>
      <div class="rail-name">
        <span class="rail-org">众艺传媒</span>
        <span class="rail-sep"></span>
        <span class="rail-app">直播运营系统</span>
      </div>
    </div>
    <div class="titlebar-controls">
      <button class="titlebar-btn" @click="minimize">&#xE921;</button>
      <button class="titlebar-btn" @click="maximize">&#xE922;</button>
      <button class="titlebar-btn titlebar-btn-close" @click="close">&#xE8BB;</button>
    </div>
  </div>
</template>

<script setup lang="ts">
const api = () => (window as any).electronAPI

function minimize() { api().windowMinimize?.() }
function maximize() { api().windowMaximize?.() }
function close() { api().windowClose?.() }
</script>

<style scoped>
/* 顶部品牌栏：商务稳重 —— 深靛蓝 + 克制的 Logo + 白字 */
.titlebar {
  height: var(--rail-h);
  display: flex;
  align-items: center;
  gap: 16px;
  padding-left: 18px;
  background: linear-gradient(180deg, var(--rail-top) 0%, var(--rail) 100%);
  -webkit-app-region: drag;
  user-select: none;
  position: relative;
  box-shadow: 0 1px 0 rgba(0,0,0,.06), 0 2px 8px rgba(12, 31, 46, 0.1);
}

/* 底部一条极淡的分割线，和内容区分开 */
.titlebar::after {
  content: '';
  position: absolute;
  left: 0; right: 0; bottom: -1px;
  height: 1px;
  background: rgba(255,255,255,0.08);
  pointer-events: none;
}

.rail-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

/* Logo：简洁方印 + 三角 + 圆点，去掉跳动感的"众"字 */
.rail-mark {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  flex-shrink: 0;
  background: rgba(255,255,255,0.12);
  border: 1px solid rgba(255,255,255,0.22);
  color: var(--surface);
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}

.rail-name {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.rail-org {
  font-size: 16px;
  font-weight: 700;
  color: var(--surface);
  letter-spacing: 0.8px;
  white-space: nowrap;
}

.rail-sep {
  width: 1px;
  height: 14px;
  background: rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
}

.rail-app {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.78);
  letter-spacing: 0.3px;
  white-space: nowrap;
}

.titlebar-controls {
  display: flex;
  height: 100%;
  margin-left: auto;
  -webkit-app-region: no-drag;
}

.titlebar-btn {
  width: 44px;
  height: 100%;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.88);
  font-family: 'Segoe MDL2 Assets';
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.titlebar-btn:hover {
  background: rgba(255, 255, 255, 0.14);
  color: var(--surface);
}

.titlebar-btn-close:hover {
  background: var(--close-hover);
  color: var(--surface);
}

@media (max-width: 880px) {
  .rail-app { display: none; }
  .rail-sep { display: none; }
}
</style>
