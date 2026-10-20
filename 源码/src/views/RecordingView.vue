<template>
  <div class="recording-page">
    <div class="rec-header">
      <div>
        <h2 class="rec-title">录制管理</h2>
        <div class="rec-subtitle">
          <span class="subtitle-text">直播流录制与保存</span>
          <span v-if="recordStore.recordingCount > 0" class="subtitle-highlight">{{ recordStore.recordingCount }} 个任务进行中</span>
        </div>
      </div>
      <div class="rec-badge">
        <span :class="['rec-badge-dot', { active: recordStore.recordingCount > 0 }]"></span>
        <span class="rec-badge-text">{{ recordStore.recordingCount > 0 ? '录制中' : '待命' }}</span>
      </div>
    </div>

    <div v-if="recordStore.isDurationVisible" class="stats-row">
      <div class="stat-card">
        <div class="stat-glow" style="background: radial-gradient(circle at 50% 0%, rgba(249,115,22,0.12), transparent 70%)"></div>
        <div class="stat-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="var(--pulse-accent)" stroke-width="1.8"/><circle cx="12" cy="12" r="4" fill="var(--pulse-accent)"/></svg>
        </div>
        <div class="stat-value" style="color: var(--pulse-accent)">{{ recordStore.recordingCount }}</div>
        <div class="stat-label">活跃任务</div>
      </div>
      <div class="stat-card">
        <div class="stat-glow" style="background: radial-gradient(circle at 50% 0%, rgba(34,211,238,0.12), transparent 70%)"></div>
        <div class="stat-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="var(--pulse-cyan)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="stat-value" style="color: var(--pulse-cyan)">{{ totalSize }}</div>
        <div class="stat-label">总文件大小</div>
      </div>
      <div class="stat-card">
        <div class="stat-glow" style="background: radial-gradient(circle at 50% 0%, rgba(16,185,129,0.12), transparent 70%)"></div>
        <div class="stat-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="var(--ok)" stroke-width="1.8"/><path d="M12 6v6l4 2" stroke="var(--ok)" stroke-width="1.8" stroke-linecap="round"/></svg>
        </div>
        <div class="stat-value" style="color: var(--ok)">{{ activeCount }} / {{ recordStore.recordingItems.length }}</div>
        <div class="stat-label">进行 / 总计</div>
      </div>
    </div>

    <div class="card controls-card">
      <div class="controls-left">
        <n-button
          v-if="recordStore.recordingCount > 0"
          type="error"
          @click="recordStore.stopAll()"
        >
          <template #icon>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
          </template>
          停止全部录制
        </n-button>
        <n-button
          v-else
          type="success"
          @click="recordStore.recordAll()"
        >
          <template #icon>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>
          </template>
          全部录制
        </n-button>
      </div>
      <span class="status-text">{{ recordStore.danmuStatus }}</span>
    </div>

    <!-- 单个直播间：每个房间一行，可以只录这一个 -->
    <div class="card room-pick-card">
      <div class="pick-head">
        <span class="pick-title">直播间（可以只录其中一个）</span>
        <span class="pick-hint">{{ roomListStore.results.length ? '点右边按钮单独录这一个，不影响其它房间' : '先去「直播间」页添加直播间' }}</span>
      </div>
      <div v-if="roomListStore.results.length" class="pick-list">
        <div v-for="room in roomListStore.results" :key="room.url || room.enterRoomId" class="pick-item">
          <div class="rec-avatar" :style="{ background: avatarGradient(room.enterRoomId || room.url) }">
            {{ (room.nickname || '?').charAt(0) }}
          </div>
          <div class="pick-info">
            <div class="pick-name">{{ room.nickname || ('房间 ' + (room.enterRoomId || '未解析')) }}</div>
            <div class="pick-meta">
              <span class="pick-rid">{{ room.enterRoomId || '还没解析出房间号' }}</span>
              <span :class="['pick-state', stateClass(room)]">{{ stateText(room) }}</span>
              <span v-if="isRecording(room.enterRoomId)" class="pick-live-status">{{ statusTextOf(room.enterRoomId) }}</span>
            </div>
          </div>
          <n-button
            size="small"
            :type="isRecording(room.enterRoomId) ? 'error' : 'primary'"
            :ghost="!isRecording(room.enterRoomId)"
            :disabled="!room.enterRoomId"
            :loading="busyRoom === room.enterRoomId"
            @click="toggleRoom(room)"
          >
            {{ isRecording(room.enterRoomId) ? '停止录制' : '开始录制' }}
          </n-button>
        </div>
      </div>
      <div v-else class="pick-empty">还没有直播间：先去「直播间」页粘贴房间地址</div>
    </div>

    <div v-if="recordStore.isDurationVisible" class="recording-list">
      <div
        v-for="item in recordStore.recordingItems"
        :key="item.roomId"
        :class="['card', 'rec-item', { 'rec-item-active': item.isActive }]"
      >
        <div :class="['rec-stripe', { active: item.isActive, stopped: !item.isActive }]"></div>
        <div class="rec-avatar" :style="{ background: avatarGradient(item.roomId) }">
          {{ item.nickname.charAt(0) || '?' }}
        </div>
        <div class="rec-info">
          <div class="rec-name">{{ item.nickname }}</div>
          <div class="rec-room-id">房间 {{ item.roomId }}</div>
        </div>
        <div class="rec-stat-group">
          <div class="rec-stat">
            <div class="stat-label">时长</div>
            <div class="stat-value stat-accent">{{ item.durationText }}</div>
          </div>
          <div class="rec-stat">
            <div class="stat-label">大小</div>
            <div class="stat-value stat-info">{{ item.sizeText }}</div>
          </div>
        </div>
        <div class="rec-status-area">
          <span v-if="item.isActive" class="rec-pulse-dot"></span>
          <span :class="['rec-status-text', { active: item.isActive, error: item.statusText.includes('异常') }]">
            {{ item.statusText }}
          </span>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="var(--line-2)" stroke-width="1.5"/>
          <circle cx="12" cy="12" r="4" fill="var(--line-2)"/>
        </svg>
      </div>
      <div class="empty-title">暂无录制任务</div>
      <div class="empty-hint">在「直播间」页面连接直播间后，点击「全部录制」开始</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton } from 'naive-ui'
import { useRecordStore } from '../stores/record'
import { useRoomListStore } from '../stores/room-list'
import { formatFileSize } from '../utils/format'

const recordStore = useRecordStore()
const roomListStore = useRoomListStore()

/** 哪个房间的按钮正在请求中（防连点） */
const busyRoom = ref('')

function isRecording(roomId: string): boolean {
  if (!roomId) return false
  return recordStore.recordingItems.some((i: any) => i.roomId === roomId && i.isActive)
}

function statusTextOf(roomId: string): string {
  return recordStore.recordingItems.find((i: any) => i.roomId === roomId)?.statusText || ''
}

function stateText(room: any): string {
  if (room.error) return '解析失败'
  if (room.roomStatus === 2) return '未开播'
  return '已开播'
}

function stateClass(room: any): string {
  if (room.error) return 'bad'
  return room.roomStatus === 2 ? 'idle' : 'live'
}

async function toggleRoom(room: any): Promise<void> {
  busyRoom.value = room.enterRoomId
  try {
    if (isRecording(room.enterRoomId)) await recordStore.stopOne(room.enterRoomId)
    else await recordStore.recordOne(room)
  } finally {
    busyRoom.value = ''
  }
}

const activeCount = computed(() => recordStore.recordingItems.filter((i: any) => i.isActive).length)

const totalSize = computed(() => {
  let bytes = 0
  for (const item of recordStore.recordingItems) {
    const match = item.sizeText.match(/[\d.]+/)
    if (!match) continue
    const num = parseFloat(match[0])
    if (item.sizeText.includes('GB')) bytes += num * 1024 * 1024 * 1024
    else if (item.sizeText.includes('MB')) bytes += num * 1024 * 1024
    else if (item.sizeText.includes('KB')) bytes += num * 1024
    else bytes += num
  }
  return formatFileSize(bytes)
})

function avatarGradient(roomId: string): string {
  const colors = [
    'linear-gradient(135deg, #f97316, #ef4444)',
    'linear-gradient(135deg, #fbbf24, #f97316)',
    'linear-gradient(135deg, #ef4444, #ec4899)',
    'linear-gradient(135deg, #22d3ee, #3b82f6)',
    'linear-gradient(135deg, #10b981, #06b6d4)'
  ]
  let hash = 0
  for (let i = 0; i < roomId.length; i++) hash = roomId.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}
</script>

<style scoped>
.recording-page { padding: 20px 24px 24px; overflow-y: auto; height: 100%; }

.rec-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.rec-title { font-size: var(--fs-h1); font-weight: 700; letter-spacing: -0.2px; color: var(--ink); }

.rec-subtitle {
  display: flex;
  gap: 16px;
  margin-top: 4px;
}

.subtitle-text { font-size: var(--fs-meta); color: var(--ink-4); }
.subtitle-highlight { font-size: var(--fs-meta); color: var(--pulse-accent); }

.rec-badge {
  background: var(--surface);
  border: 1px solid var(--line-2);
  border-radius: 8px;
  padding: 8px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.rec-badge-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ink-4);
}

.rec-badge-dot.active {
  background: var(--bad);
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.5);
  animation: badge-pulse 2s ease-in-out infinite;
}

@keyframes badge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.rec-badge-text { font-size: 12px; font-weight: 500; color: var(--ink-3); }

.stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}

.stat-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 20px 16px;
  text-align: center;
  position: relative;
  overflow: hidden;
  transition: transform 0.2s, box-shadow 0.2s;
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.stat-glow {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 60px;
  pointer-events: none;
}

.stat-icon {
  position: relative;
  z-index: 1;
  margin-bottom: 8px;
  display: flex;
  justify-content: center;
}

.stat-value {
  position: relative;
  z-index: 1;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.5px;
}

.stat-label {
  position: relative;
  z-index: 1;
  font-size: 11px;
  color: var(--ink-4);
  margin-top: 4px;
  font-weight: 500;
}

.controls-card {
  padding: 12px 18px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.status-text { font-size: 11px; color: var(--ink-4); }

.recording-list { display: flex; flex-direction: column; gap: 8px; }

.rec-item {
  display: flex;
  align-items: center;
  padding: 16px 18px;
  gap: 14px;
  position: relative;
  overflow: hidden;
  transition: transform 0.2s, box-shadow 0.2s;
}

.rec-item:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}

.rec-item-active {
  border-color: rgba(249, 115, 22, 0.15);
}

.rec-stripe {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--line-2);
}

.rec-stripe.active {
  background: linear-gradient(180deg, var(--pulse-accent), var(--bad));
  box-shadow: 0 0 8px rgba(249, 115, 22, 0.3);
}

.rec-stripe.stopped {
  background: var(--line-2);
}

.rec-avatar {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.rec-info { flex: 1; min-width: 0; }

.rec-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rec-room-id {
  font-size: 11px;
  color: var(--ink-4);
  margin-top: 2px;
}

.rec-stat-group { display: flex; gap: 8px; }

.rec-stat {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 14px;
  text-align: center;
  min-width: 85px;
}

.stat-label {
  font-size: 9px;
  color: var(--ink-4);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 500;
}

.stat-value { font-size: 15px; font-weight: 700; margin-top: 2px; }
.stat-accent { color: var(--pulse-accent); }
.stat-info { color: var(--pulse-cyan); }

.rec-status-area {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.rec-pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ok);
  animation: rec-pulse 1.5s ease-in-out infinite;
}

@keyframes rec-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 4px rgba(16, 185, 129, 0.5); }
  50% { opacity: 0.3; box-shadow: none; }
}

.rec-status-text { font-size: 11px; font-weight: 500; color: var(--ink-3); }
.rec-status-text.active { color: var(--ok); }
.rec-status-text.error { color: var(--bad); }

.empty-state { padding: 60px 0; }

.room-pick-card { padding: 14px 18px; margin-bottom: 12px; }
.pick-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
.pick-title { font-size: 13px; font-weight: 700; color: var(--ink); }
.pick-hint { font-size: 11px; color: var(--ink-4); }
.pick-list { display: flex; flex-direction: column; gap: 6px; }
.pick-item {
  display: flex; align-items: center; gap: 12px;
  background: var(--pulse-soft); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px;
}
.pick-info { flex: 1; min-width: 0; }
.pick-name { font-size: 13px; font-weight: 600; color: var(--ink); }
.pick-meta { display: flex; align-items: center; gap: 8px; margin-top: 3px; }
.pick-rid { font-size: 10px; color: var(--ink-4); }
.pick-state { font-size: 10px; padding: 1px 7px; border-radius: 8px; }
.pick-state.live { background: rgba(16, 185, 129, 0.12); color: var(--ok); }
.pick-state.idle { background: rgba(154, 161, 171, 0.15); color: var(--ink-3); }
.pick-state.bad { background: rgba(239, 68, 68, 0.12); color: var(--bad); }
.pick-live-status { font-size: 10px; color: var(--pulse-accent); }
.pick-empty { font-size: 12px; color: var(--ink-4); padding: 10px 0 4px; }

.empty-icon { margin-bottom: 8px; }

.empty-title { font-size: 14px; color: var(--ink-4); font-weight: 500; }
.empty-hint { font-size: 12px; color: var(--ink-4); margin-top: 4px; }
</style>
