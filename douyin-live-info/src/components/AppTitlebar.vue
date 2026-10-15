<template>
  <div class="titlebar">
    <div class="titlebar-left">
      <div class="app-dot"></div>
    </div>
      <div class="titlebar-center">众艺传媒 · 抖音直播运营工具</div>
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
.titlebar {
  height: 38px;
  display: flex;
  align-items: center;
  background: #ffffff;
  border-bottom: 1px solid #ffffff;
  -webkit-app-region: drag;
  user-select: none;
}

.titlebar-left {
  width: 200px;
  display: flex;
  align-items: center;
  padding-left: 20px;
  gap: 8px;
}

.app-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: linear-gradient(135deg, #f97316, #ef4444);
  box-shadow: 0 0 8px rgba(249, 115, 22, 0.4);
}

.titlebar-center {
  flex: 1;
  text-align: center;
  font-size: 11px;
  color: #9aa1ab;
  letter-spacing: 0.5px;
}

.titlebar-controls {
  display: flex;
  -webkit-app-region: no-drag;
}

.titlebar-btn {
  width: 46px;
  height: 38px;
  border: none;
  background: transparent;
  color: #6b7280;
  font-family: 'Segoe MDL2 Assets';
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.titlebar-btn:hover {
  background: #ffffff;
  color: #a0a4b0;
}

.titlebar-btn-close:hover {
  background: #dc2626;
  color: white;
  border-radius: 0 0 8px 0;
}
</style>
