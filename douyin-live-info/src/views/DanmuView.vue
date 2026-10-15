<template>
  <div class="danmu-page">
    <div class="card danmu-header">
      <div>
        <div class="danmu-title">{{ danmuStore.danmuTitle }}</div>
        <div class="danmu-room">{{ danmuStore.danmuRoom }}</div>
      </div>
      <div class="danmu-status-area">
        <span class="danmu-count">{{ danmuStore.danmuCountText }}</span>
        <span :class="['status-dot', { green: danmuStore.connectedRoomCount > 0, red: danmuStore.danmuStatus.includes('失败') }]"></span>
        <span class="danmu-status-text">{{ danmuStore.danmuStatus }}</span>
      </div>
    </div>

    <div class="card danmu-content">
    <div :class="['card', 'danmu-login', { warn: !loginState.loggedIn }]">
      <div class="login-badge">{{ loginState.loggedIn ? '✓' : '!' }}</div>
      <div class="login-text">
        <div class="login-title">{{ loginState.loggedIn ? '抖音已登录，弹幕通道正常' : '还没登录抖音，弹幕收不到' }}</div>
        <div class="login-desc">
          {{ loginState.loggedIn
            ? '登录态保存在本机，关掉软件再打开也不用重新登。'
            : '抖音只给已登录的网页端推送弹幕。点右边按钮，用你们自己的抖音号扫码登录一次就行。' }}
        </div>
      </div>
      <n-button size="small" :type="loginState.loggedIn ? 'default' : 'primary'" :loading="loggingIn" @click="doLogin">
        {{ loginState.loggedIn ? '更换账号' : '立即登录抖音' }}
      </n-button>
    </div>

      <div v-if="danmuStore.connectedRoomCount > 1" class="room-filter-bar">
        <span class="filter-label">房间筛选:</span>
        <div class="filter-chips">
          <button
            :class="['filter-chip', { active: danmuStore.filterRoomId === '' }]"
            @click="danmuStore.filterRoomId = ''"
          >全部</button>
          <button
            v-for="opt in danmuStore.filterRoomOptions"
            :key="opt.roomId"
            :class="['filter-chip', { active: danmuStore.filterRoomId === opt.roomId }]"
            @click="danmuStore.filterRoomId = opt.roomId"
          >{{ opt.nickname }}</button>
        </div>
      </div>

      <n-tabs v-model:value="danmuStore.selectedTab" type="line" animated>
        <n-tab-pane name="all" tab="全部">
          <DanmuList :messages="danmuStore.filteredAllMessages" :show-room="danmuStore.connectedRoomCount > 1" empty="暂无消息，连接直播间后将实时显示" />
        </n-tab-pane>
        <n-tab-pane name="chat" tab="弹幕">
          <DanmuList :messages="danmuStore.filteredChatMessages" :show-room="danmuStore.connectedRoomCount > 1" empty="暂无弹幕消息" />
        </n-tab-pane>
        <n-tab-pane name="gift" tab="礼物">
          <DanmuList :messages="danmuStore.filteredGiftMessages" :show-room="danmuStore.connectedRoomCount > 1" empty="暂无礼物消息" />
        </n-tab-pane>
        <n-tab-pane name="like" tab="点赞">
          <DanmuList :messages="danmuStore.filteredLikeMessages" :show-room="danmuStore.connectedRoomCount > 1" empty="暂无点赞消息" />
        </n-tab-pane>
        <n-tab-pane name="member" tab="进入">
          <DanmuList :messages="danmuStore.filteredMemberMessages" :show-room="danmuStore.connectedRoomCount > 1" empty="暂无进入消息" />
        </n-tab-pane>
        <n-tab-pane name="social" tab="关注">
          <DanmuList :messages="danmuStore.filteredSocialMessages" :show-room="danmuStore.connectedRoomCount > 1" empty="暂无关注消息" />
        </n-tab-pane>
        <n-tab-pane name="history" tab="历史">
          <div class="history-header">
            <span class="history-hint">双击卡片查看历史弹幕记录</span>
            <n-button size="tiny" tertiary @click="danmuStore.clearDatabase()">清空记录</n-button>
          </div>
          <div v-if="danmuStore.historyRooms.length > 0" class="history-cards">
            <div v-for="room in danmuStore.historyRooms" :key="room.roomId" class="history-card" @dblclick="openHistory(room)">
              <div class="history-name">{{ room.nickname || `房间 ${room.roomId}` }}</div>
              <div class="history-meta">
                <span class="accent">{{ room.messageCount }} 条消息</span>
                <span class="history-time">{{ room.lastActive }}</span>
              </div>
            </div>
          </div>
          <div v-else class="empty-inline">暂无历史记录</div>
        </n-tab-pane>
      </n-tabs>
    </div>

    <n-modal v-model:show="showHistory" preset="card" style="width: 90%; max-width: 900px; max-height: 640px;" :title="historyTitle">
      <div class="history-filters">
        <n-radio-group v-model:value="historyFilter" size="small" @update:value="loadHistoryMessages">
          <n-radio-button value="">全部</n-radio-button>
          <n-radio-button value="Chat">弹幕</n-radio-button>
          <n-radio-button value="Gift">礼物</n-radio-button>
          <n-radio-button value="Like">点赞</n-radio-button>
          <n-radio-button value="Member">进入</n-radio-button>
          <n-radio-button value="Social">关注</n-radio-button>
        </n-radio-group>
        <n-input v-model:value="historyKeyword" size="small" placeholder="搜索内容..." style="width: 200px" @update:value="loadHistoryMessages" />
        <n-input v-model:value="historyUsername" size="small" placeholder="筛选用户名..." style="width: 200px" @update:value="loadHistoryMessages" />
      </div>
      <div class="history-list">
        <div v-for="msg in historyMessages" :key="msg.id" class="history-row">
          <span class="history-row-time">{{ msg.time }}</span>
          <span :class="['history-tag', `tag-${msg.type.toLowerCase()}`]">{{ typeLabel(msg.type) }}</span>
          <span class="history-line">{{ msg.displayLine }}</span>
        </div>
      </div>
      <div class="history-footer">
        <span class="history-info">{{ historyMessages.length }} 条记录</span>
        <div class="export-btns">
          <n-button size="tiny" tertiary :loading="exporting" @click="exportData('csv')">导出 CSV</n-button>
          <n-button size="tiny" tertiary :loading="exporting" @click="exportData('json')">导出 JSON</n-button>
        </div>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { NTabs, NTabPane, NModal, NRadioGroup, NRadioButton, NInput, NButton, useMessage } from 'naive-ui'
import { useDanmuStore } from '../stores/danmu'
import { useRoomListStore } from '../stores/room-list'
import DanmuList from '../components/DanmuList.vue'
import type { RoomInfo } from '../types'

const message = useMessage()

const danmuStore = useDanmuStore()
const roomListStore = useRoomListStore()

const showHistory = ref(false)
const historyTitle = ref('')
const historyRoomId = ref('')
const historyFilter = ref('')
const historyKeyword = ref('')
const historyUsername = ref('')
const historyMessages = ref<any[]>([])
const exporting = ref(false)

// 抖音登录态（抖音只给已登录的网页端推弹幕）
const loginState = ref<{ loggedIn: boolean }>({ loggedIn: false })
const loggingIn = ref(false)
let loginTimer: ReturnType<typeof setInterval> | null = null

const api = () => (window as any).electronAPI

onMounted(() => {
  if (danmuStore.selectedTab === 'history') danmuStore.loadHistory()
  refreshLoginState()
  loginTimer = setInterval(refreshLoginState, 30000)
})

onUnmounted(() => {
  if (loginTimer) clearInterval(loginTimer)
  loginTimer = null
})

async function refreshLoginState() {
  try {
    loginState.value = await api().danmuLoginState()
  } catch { /* 查不到就当没登录，不影响其它功能 */ }
}

async function doLogin() {
  loggingIn.value = true
  try {
    const res = await api().danmuLogin()
    if (res && res.ok) message.success('抖音登录成功，弹幕通道已重新连接')
    else message.info(res?.message || '登录窗口已关闭')
  } catch (ex: any) {
    message.error('打开登录窗口失败: ' + (ex.message || '未知错误'))
  } finally {
    loggingIn.value = false
    await refreshLoginState()
  }
}

watch(() => danmuStore.selectedTab, (val) => {
  if (val === 'history') danmuStore.loadHistory()
})

async function openHistory(room: RoomInfo) {
  historyRoomId.value = room.roomId
  historyTitle.value = room.nickname || `房间 ${room.roomId}`
  historyFilter.value = ''
  historyKeyword.value = ''
  historyUsername.value = ''
  showHistory.value = true
  await loadHistoryMessages()
}

async function loadHistoryMessages() {
  historyMessages.value = await danmuStore.getMessages(
    historyRoomId.value,
    historyFilter.value || undefined,
    historyKeyword.value || undefined,
    historyUsername.value || undefined
  )
}

function typeLabel(type: string): string {
  const map: Record<string, string> = { Chat: '弹幕', Gift: '礼物', Like: '点赞', Member: '进入', Social: '关注', Stats: '统计' }
  return map[type] || type
}

async function exportData(format: 'csv' | 'json') {
  exporting.value = true
  try {
    const res = await api().dbExportMessages(
      historyRoomId.value, historyTitle.value,
      historyFilter.value || undefined,
      historyKeyword.value || undefined,
      historyUsername.value || undefined,
      format
    )
    if (res.success) {
      message.success(`已导出 ${res.count} 条记录`)
    }
  } catch (ex: any) {
    message.error('导出失败: ' + (ex.message || '未知错误'))
  } finally {
    exporting.value = false
  }
}
</script>

<style scoped>
.danmu-page { padding: 16px 20px 20px; display: flex; flex-direction: column; gap: 10px; min-height: 0; flex: 1; }

.danmu-header {
  padding: 12px 18px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.danmu-title { font-size: 14px; font-weight: 700; color: #1f2328; }
.danmu-room { font-size: 11px; color: #9aa1ab; margin-top: 2px; }

.danmu-status-area { display: flex; align-items: center; gap: 8px; }
.danmu-count { font-size: 11px; color: #9aa1ab; }

.danmu-login {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  border-left: 4px solid #10b981;
}

.danmu-login.warn {
  border-left-color: #f97316;
  background: linear-gradient(90deg, rgba(249, 115, 22, 0.08), #ffffff 55%);
}

.login-badge {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: #ffffff;
  background: #10b981;
  flex-shrink: 0;
}

.danmu-login.warn .login-badge { background: #f97316; }

.login-text { flex: 1; min-width: 0; }
.login-title { font-size: 13px; font-weight: 700; color: #1f2328; }
.login-desc { font-size: 11px; color: #6b7280; margin-top: 3px; line-height: 1.5; }
.danmu-status-text { font-size: 12px; color: #6b7280; }

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #d8dbe0;
}

.status-dot.green {
  background: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.4);
}

.status-dot.red {
  background: #ef4444;
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.4);
}

.danmu-content { flex: 1; min-height: 0; padding: 0 10px 10px; overflow: hidden; display: flex; flex-direction: column; }

.danmu-content :deep(.n-tabs) {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.danmu-content :deep(.n-tabs-pane-wrapper) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.danmu-content :deep(.n-tab-pane) {
  height: 100%;
  overflow-y: auto;
}

.room-filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 4px;
  border-bottom: 1px solid #e6e8ec;
  flex-shrink: 0;
}

.filter-label {
  font-size: 11px;
  color: #6b7280;
  flex-shrink: 0;
}

.filter-chips {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  flex: 1;
}

.filter-chip {
  border: 1px solid #d8dbe0;
  background: transparent;
  color: #6b7280;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
  font-family: inherit;
}

.filter-chip:hover {
  border-color: #f97316;
  color: #a0a4b0;
}

.filter-chip.active {
  background: rgba(249, 115, 22, 0.12);
  border-color: #f97316;
  color: #f97316;
  font-weight: 500;
}

.history-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; }
.history-hint { font-size: 11px; color: #9aa1ab; }

.history-cards { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px; }

.history-card {
  background: #ffffff;
  border: 1px solid #d8dbe0;
  border-radius: 8px;
  padding: 12px 16px;
  cursor: pointer;
  transition: border-color 0.2s;
}

.history-card:hover {
  border-color: #f97316;
}

.history-name { font-size: 13px; font-weight: 600; color: #1f2328; margin-bottom: 4px; }
.history-meta { display: flex; gap: 12px; font-size: 10px; }
.history-time { color: #9aa1ab; }

.empty-inline {
  text-align: center;
  color: #9aa1ab;
  padding: 24px;
  font-size: 13px;
}

.history-filters { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.history-list { max-height: 400px; overflow-y: auto; }

.history-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid #e6e8ec;
}

.history-row-time { font-size: 11px; color: #9aa1ab; }

.history-tag {
  font-size: 10px;
  color: white;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
}

.tag-chat { background: #9aa1ab; }
.tag-gift { background: #f97316; }
.tag-like { background: #ef4444; }
.tag-member { background: #10b981; }
.tag-social { background: #3b82f6; }
.tag-stats { background: #6b7280; }

.history-line { font-size: 12px; color: #c0c2c8; }
.history-info { font-size: 11px; color: #9aa1ab; }
.history-footer { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; }
.export-btns { display: flex; gap: 6px; }
</style>
