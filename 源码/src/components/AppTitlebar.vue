<template>
  <div class="titlebar">
    <div class="rail-brand">
      <div class="rail-mark">众</div>
      <div class="rail-name">
        <span class="rail-org">众艺传媒</span>
        <span class="rail-sep"></span>
        <span class="rail-app">抖音直播运营工具</span>
      </div>
    </div>
    <div class="rail-pulse" aria-hidden="true">
      <span style="height: 9px"></span>
      <span style="height: 15px"></span>
      <span style="height: 22px"></span>
      <span style="height: 12px"></span>
      <span style="height: 18px"></span>
      <span style="height: 10px"></span>
      <span style="height: 24px"></span>
      <span style="height: 14px"></span>
      <span style="height: 20px"></span>
      <span style="height: 11px"></span>
      <span style="height: 17px"></span>
      <span style="height: 8px"></span>
      <span style="height: 19px"></span>
      <span style="height: 13px"></span>
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
/* 顶部品牌栏：全站唯一的“大胆之处” —— 深青蓝→亮青的律动带 */
.titlebar {
  height: var(--rail-h);
  display: flex;
  align-items: center;
  gap: 16px;
  padding-left: 14px;
  background: linear-gradient(104deg, #0a4f8f 0%, #0e7dc0 22%, #12a6d6 50%, #00c2d1 76%, #0e9fb5 100%);
  -webkit-app-region: drag;
  user-select: none;
  position: relative;
  overflow: hidden;
  box-shadow: 0 2px 10px rgba(12, 70, 110, 0.16);
}

/* 右上方一团柔光：让律动带有光感，但不压在文字上 */
.titlebar::after {
  content: '';
  position: absolute;
  right: 150px;
  top: -110px;
  width: 340px;
  height: 220px;
  background: radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.3), transparent 68%);
  pointer-events: none;
}

/* 右端压一层很淡的暗色，保证最小/最大化/关闭三个白图标看得清 */
.titlebar::before {
  content: '';
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 260px;
  background: linear-gradient(90deg, rgba(6, 46, 72, 0), rgba(6, 46, 72, 0.22));
  pointer-events: none;
}

.rail-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  z-index: 1;
}

/* 众艺标志：暖橙→玫红，压在冷色律动带上，是唯一的暖色重音 */
.rail-mark {
  width: 44px;
  height: 44px;
  border-radius: 13px;
  flex-shrink: 0;
  background: linear-gradient(135deg, #ffa63d 0%, #ff6a1a 46%, #ff2d6f 100%);
  color: #fff;
  font-size: 25px;
  font-weight: 700;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 5px 14px rgba(200, 50, 40, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.5);
}

.rail-name {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.rail-org {
  font-size: 21px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.rail-sep {
  width: 1px;
  height: 20px;
  background: rgba(255, 255, 255, 0.38);
  flex-shrink: 0;
}

.rail-app {
  font-size: 16.5px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.93);
  letter-spacing: 0.35px;
  white-space: nowrap;
}

/* 律动条：14 根白柱，进页面时从低到高地立起来一次（只这一次，不循环） */
.rail-pulse {
  margin-left: auto;
  height: 26px;
  display: flex;
  align-items: center;
  gap: 5px;
  opacity: 0.58;
  z-index: 1;
}

.rail-pulse span {
  width: 2px;
  border-radius: 2px;
  background: #ffffff;
  transform-origin: center;
  animation: rail-rise 0.55s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.rail-pulse span:nth-child(1) { animation-delay: 0ms; }
.rail-pulse span:nth-child(2) { animation-delay: 35ms; }
.rail-pulse span:nth-child(3) { animation-delay: 70ms; }
.rail-pulse span:nth-child(4) { animation-delay: 105ms; }
.rail-pulse span:nth-child(5) { animation-delay: 140ms; }
.rail-pulse span:nth-child(6) { animation-delay: 175ms; }
.rail-pulse span:nth-child(7) { animation-delay: 210ms; }
.rail-pulse span:nth-child(8) { animation-delay: 245ms; }
.rail-pulse span:nth-child(9) { animation-delay: 280ms; }
.rail-pulse span:nth-child(10) { animation-delay: 315ms; }
.rail-pulse span:nth-child(11) { animation-delay: 350ms; }
.rail-pulse span:nth-child(12) { animation-delay: 385ms; }
.rail-pulse span:nth-child(13) { animation-delay: 420ms; }
.rail-pulse span:nth-child(14) { animation-delay: 455ms; }

@keyframes rail-rise {
  from { transform: scaleY(0.12); opacity: 0; }
  to { transform: scaleY(1); opacity: 1; }
}

.titlebar-controls {
  display: flex;
  height: 100%;
  -webkit-app-region: no-drag;
  z-index: 2;
}

.titlebar-btn {
  width: 46px;
  height: 100%;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.94);
  font-family: 'Segoe MDL2 Assets';
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.titlebar-btn:hover {
  background: rgba(255, 255, 255, 0.22);
  color: #ffffff;
}

.titlebar-btn-close:hover {
  background: #ff4d6e;
  color: #ffffff;
}

/* 窗口变窄时先收起律动条，标题不能被挤掉 */
@media (max-width: 940px) {
  .rail-pulse { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .rail-pulse span { animation: none; }
}
</style>
