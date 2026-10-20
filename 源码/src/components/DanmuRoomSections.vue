<template>
  <div class="room-sections">
    <div v-if="!groups.length" class="room-sections-empty">{{ empty }}</div>

    <div v-for="g in groups" :key="g.roomId" class="room-section">
      <div class="room-section-head">
        <span class="room-section-dot" :style="{ background: dotColor(g.roomId) }"></span>
        <span class="room-section-name">{{ g.nickname }}</span>
        <span class="room-section-rid">{{ g.roomId }}</span>
        <span class="room-section-count">{{ g.messages.length }} 条</span>
      </div>
      <div class="room-section-body">
        <DanmuList :messages="g.messages" :show-room="false" :empty="empty" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import DanmuList from './DanmuList.vue'
import type { DanmuMessage } from '../types'

defineProps<{
  /** 已按直播间分好组的数据 */
  groups: { roomId: string; nickname: string; messages: DanmuMessage[] }[]
  empty: string
}>()

/** 每个直播间一个固定颜色，扫一眼就知道换房间了 */
function dotColor(roomId: string): string {
  const colors = ['#f97316', '#22d3ee', '#10b981', '#ef4444', '#a855f7', '#eab308', '#3b82f6']
  let h = 0
  for (let i = 0; i < roomId.length; i++) h = roomId.charCodeAt(i) + ((h << 5) - h)
  return colors[Math.abs(h) % colors.length]
}
</script>

<style scoped>
.room-sections { display: flex; flex-direction: column; gap: 12px; padding: 4px; }
.room-sections-empty { text-align: center; color: var(--ink-2); font-size: 13px; padding: 40px 0; }

.room-section {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  overflow: hidden;
}

.room-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--pulse-soft);
  border-bottom: 1px solid var(--line);
  position: sticky;
  top: 0;
  z-index: 1;
}

.room-section-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.room-section-name { font-size: 12px; font-weight: 700; color: var(--ink); }
.room-section-rid { font-size: 10px; color: var(--ink-4); }
.room-section-count { font-size: 10px; color: var(--pulse-accent); margin-left: auto; }

.room-section-body { padding: 2px 4px 6px; }

/* 让整页滚动，而不是每个房间各滚各的 */
.room-section-body :deep(.danmu-list) {
  height: auto;
  overflow: visible;
}
</style>
