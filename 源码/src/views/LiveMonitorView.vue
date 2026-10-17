<template>
  <div class="live-page">
    <div class="live-head">
      <div>
        <h2 class="live-title">直播监播</h2>
        <div class="live-sub">多平台直播链接、录制和弹幕在一个页面处理。抖音弹幕需要登录；其他平台先支持公开信号录制，弹幕按平台另行接入。</div>
      </div>
      <div class="live-pills">
        <span class="pill"><b>{{ roomList.results.length }}</b> 个直播间</span>
        <span class="pill connected"><b>{{ danmuStore.connectedRoomCount }}</b> 个弹幕连接</span>
        <span class="pill recording"><b>{{ recordStore.recordingCount }}</b> 个录制中</span>
      </div>
    </div>

    <div class="card add-card">
      <div class="add-row">
        <n-select v-model:value="roomList.platform" :options="platformOptions" size="small" style="width: 160px" />
        <n-input
          v-model:value="roomList.urlText"
          type="textarea"
          :autosize="{ minRows: 1, maxRows: 3 }"
          placeholder="每行一个直播/回放链接。抖音、B站、TikTok、快手、小红书都可以。"
          :disabled="roomList.isLoading"
        />
        <n-button type="primary" :loading="roomList.isLoading" @click="roomList.fetchRooms()">识别并加入</n-button>
        <n-button :disabled="roomList.isLoading" @click="importLinks">导入 TXT</n-button>
      </div>
      <div class="add-tools">
        <div class="platform-chips">
          <button v-for="p in filterOptions" :key="p.value" :class="['platform-chip', { active: roomList.platformFilter === p.value }]" @click="roomList.platformFilter = p.value">
            {{ p.label }} <b>{{ p.count }}</b>
          </button>
        </div>
        <div class="all-actions">
          <n-button size="tiny" @click="recordStore.recordAll()" :disabled="roomList.results.length === 0">开始未录的</n-button>
          <n-button size="tiny" type="error" ghost @click="recordStore.stopAll()" :disabled="recordStore.recordingCount === 0">停止全部</n-button>
          <n-button size="tiny" @click="connectAll">全部连接弹幕</n-button>
          <n-button size="tiny" tertiary @click="danmuStore.disconnectAll()" :disabled="danmuStore.connectedRoomCount === 0">全部断开</n-button>
          <n-button size="tiny" tertiary @click="roomList.clear()" :disabled="roomList.results.length === 0">清空列表</n-button>
        </div>
      </div>
    </div>

    <div class="card overall-board">
      <div class="overall-head"><b>整体运行状态</b><span>所有直播间的实时录制和弹幕总览</span></div>
      <div class="overall-kpis">
        <div><span>直播中</span><b>{{ onlineCount }}</b></div>
        <div><span>录制中</span><b>{{ recordStore.recordingCount }}</b></div>
        <div><span>弹幕连接</span><b>{{ danmuStore.connectedRoomCount }}</b></div>
        <div><span>异常</span><b :class="{ bad: abnormalCount > 0 }">{{ abnormalCount }}</b></div>
      </div>
      <div v-if="overallRooms.length" class="overall-rooms">
        <div v-for="it in overallRooms" :key="it.room.enterRoomId || it.room.url" :class="['overall-room', { active: it.rec?.isActive }]">
          <span :class="['platform-badge', it.room.platform || 'douyin']">{{ it.room.platformLabel || platformLabel(it.room.platform) }}</span>
          <b>{{ it.room.nickname || '待解析' }}</b>
          <span :class="['overall-rec', { on: it.rec?.isActive }]">{{ it.rec?.isActive ? '录制中' : '未录制' }}</span>
          <span class="overall-meta">{{ it.rec?.isActive ? `${it.rec.durationText} · ${it.rec.sizeText}` : (it.room.error ? '链接异常' : liveStateText(it.room)) }}</span>
        </div>
      </div>
      <div v-else class="overall-empty">加入直播间后，这里会显示每个房间是否正在录制、录了多久、文件多大。</div>
    </div>

    <div class="live-main">
      <section class="card room-panel">
        <div class="panel-head">
          <div><b>直播间列表</b><span>{{ roomList.statusMessage || '点一行，右侧看这个直播间的弹幕和录制状态' }}</span></div>
          <n-button size="tiny" @click="refreshRooms" :loading="roomList.isLoading">刷新</n-button>
        </div>
        <n-data-table
          v-if="roomList.filteredResults.length"
          :columns="columns"
          :data="roomList.filteredResults"
          :row-props="rowProps"
          :bordered="false"
          size="small"
          :pagination="false"
          :max-height="420"
        />
        <div v-else class="empty-panel">
          <div class="empty-icon">◌</div>
          <b>还没有匹配的直播间</b>
          <span>上面选平台、粘贴链接后点「识别并加入」</span>
        </div>
      </section>

      <aside class="right-column">
        <section class="card selected-card">
          <template v-if="selected">
            <div class="selected-head">
              <div class="avatar" :style="{ background: avatarGradient(selected.enterRoomId || selected.url) }">{{ (selected.nickname || '?').charAt(0) }}</div>
              <div class="selected-name-wrap">
                <b>{{ selected.nickname || '待解析直播间' }}</b>
                <span>{{ selected.platformLabel || platformLabel(selected.platform) }} · {{ selected.enterRoomId || '链接已加入' }}</span>
              </div>
              <span :class="['state-chip', liveStateClass(selected)]">{{ liveStateText(selected) }}</span>
            </div>
            <div class="selected-actions">
              <n-button size="small" @click="openRoom(selected)">打开链接</n-button>
              <n-button size="small" :type="isConnected(selected) ? 'error' : 'primary'" :ghost="!isConnected(selected)" :disabled="(selected.platform || 'douyin') !== 'douyin'" @click="toggleConnect(selected)">
                {{ isConnected(selected) ? '断开弹幕' : '连接弹幕' }}
              </n-button>
              <n-button size="small" :type="isRecording(selected) ? 'error' : 'success'" :ghost="!isRecording(selected)" @click="toggleRecord(selected)">
                {{ isRecording(selected) ? '停止录制' : '开始录制' }}
              </n-button>
            </div>
            <div v-if="selectedRecording" class="record-strip">
              <span class="record-dot"></span><b>正在录制</b>
              <span>{{ selectedRecording.durationText }} · {{ selectedRecording.sizeText }}</span>
            </div>
            <div class="selected-note">
              {{ (selected.platform || 'douyin') === 'douyin'
                ? '抖音弹幕通过网页登录态采集；登录失效后点「连接弹幕」重新连接。'
                : `${platformLabel(selected.platform)} 当前支持录制；弹幕需要平台登录态和协议适配，暂不冒充抖音通道。` }}
            </div>
          </template>
          <div v-else class="empty-panel small"><b>先选一个直播间</b><span>选中后这里会显示弹幕和录制控制</span></div>
        </section>

        <section class="card message-card">
          <div class="panel-head">
            <div><b>当前直播间弹幕</b><span>按直播间隔离，不会串台</span></div>
            <span class="message-count">{{ selectedMessages.length }} 条</span>
          </div>
          <DanmuRoomSections v-if="selected" :groups="selectedGroups" empty="连接弹幕后，这里会实时显示消息" />
          <div v-else class="empty-panel small"><span>选中一个直播间后查看消息</span></div>
        </section>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h } from 'vue'
import { NButton, NDataTable, NInput, NSelect, useMessage, type DataTableColumns } from 'naive-ui'
import { useDanmuStore } from '../stores/danmu'
import { useRecordStore } from '../stores/record'
import { useRoomListStore } from '../stores/room-list'
import DanmuRoomSections from '../components/DanmuRoomSections.vue'

const API = () => (window as any).electronAPI
const message = useMessage()
const danmuStore = useDanmuStore()
const recordStore = useRecordStore()
const roomList = useRoomListStore()

const platformOptions = [
  { label: '自动识别平台', value: 'auto' },
  { label: '抖音', value: 'douyin' },
  { label: 'B站', value: 'bilibili' },
  { label: 'TikTok', value: 'tiktok' },
  { label: '快手', value: 'kuaishou' },
  { label: '小红书', value: 'xiaohongshu' },
  { label: '其他平台', value: 'other' }
]
const platformLabels: Record<string, string> = {
  douyin: '抖音', bilibili: 'B站', tiktok: 'TikTok', kuaishou: '快手', xiaohongshu: '小红书', other: '其他平台'
}
function platformLabel(p: string) { return platformLabels[p] || platformLabels.other }

const filterOptions = computed(() => {
  const count = (p: string) => roomList.results.filter((r: any) => p === 'all' || (r.platform || 'douyin') === p).length
  return [
    { label: '全部', value: 'all', count: count('all') },
    { label: '抖音', value: 'douyin', count: count('douyin') },
    { label: 'B站', value: 'bilibili', count: count('bilibili') },
    { label: 'TikTok', value: 'tiktok', count: count('tiktok') },
    { label: '快手', value: 'kuaishou', count: count('kuaishou') },
    { label: '小红书', value: 'xiaohongshu', count: count('xiaohongshu') },
    { label: '其他', value: 'other', count: count('other') }
  ]
})

const selected = computed(() => roomList.selectedRoom)
const overallRooms = computed(() => roomList.results.map((room: any) => ({ room, rec: recordStore.recordingItems.find((i: any) => i.roomId === room.enterRoomId) })))
const onlineCount = computed(() => roomList.results.filter((r: any) => !r.error && r.roomStatus !== 2).length)
const abnormalCount = computed(() => roomList.results.filter((r: any) => !!r.error || String(recordStore.recordingItems.find((i: any) => i.roomId === r.enterRoomId)?.statusText || '').includes('失败')).length)
const selectedRecording = computed(() => selected.value ? recordStore.recordingItems.find((i: any) => i.roomId === selected.value?.enterRoomId) : null)
const selectedMessages = computed(() => selected.value ? danmuStore.allMessages.filter((m: any) => m.roomId === selected.value?.enterRoomId).slice(0, 200) : [])
const selectedGroups = computed(() => selected.value ? [{ roomId: selected.value.enterRoomId, nickname: selected.value.nickname, messages: selectedMessages.value }] : [])

function isConnected(room: any) { return !!room?.enterRoomId && danmuStore.connectedRoomIds.has(room.enterRoomId) }
function isRecording(room: any) { return !!room?.enterRoomId && !!recordStore.recordingItems.find((i: any) => i.roomId === room.enterRoomId && i.isActive) }
function liveStateText(room: any) {
  if (room?.error) return '解析失败'
  if (room?.roomStatus === 2) return '未开播'
  return '直播中'
}
function liveStateClass(room: any) {
  if (room?.error) return 'bad'
  return room?.roomStatus === 2 ? 'idle' : 'live'
}
function avatarGradient(id: string) {
  const colors = ['linear-gradient(135deg,#0b76be,#00c2d1)', 'linear-gradient(135deg,#007f91,#42d8c7)', 'linear-gradient(135deg,#5067d8,#22b8cf)', 'linear-gradient(135deg,#e67e22,#f2b705)']
  let n = 0
  for (let i = 0; i < (id || '').length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0
  return colors[n % colors.length]
}

const columns: DataTableColumns<any> = [
  {
    title: '直播间', key: 'name', minWidth: 210,
    render: (row: any) => h('div', { class: 'name-cell' }, [
      h('span', { class: 'platform-badge ' + (row.platform || 'douyin') }, row.platformLabel || platformLabel(row.platform)),
      h('div', { class: 'name-copy' }, [
        h('b', row.nickname || '待解析主播'),
        h('span', [h('em', { class: 'table-status ' + liveStateClass(row) }, liveStateText(row)), h('i', ' · '), row.title || row.url])
      ])
    ])
  },
  {
    title: '操作', key: 'actions', width: 270,
    render: (row: any) => h('div', { class: 'row-actions' }, [
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => openRoom(row) }, { default: () => '链接' }),
      h(NButton, { size: 'tiny', quaternary: true, type: isConnected(row) ? 'error' : 'primary', disabled: (row.platform || 'douyin') !== 'douyin', onClick: () => toggleConnect(row) }, { default: () => (row.platform || 'douyin') !== 'douyin' ? '弹幕未接' : isConnected(row) ? '断开弹幕' : '连接弹幕' }),
      h(NButton, { size: 'tiny', quaternary: true, type: isRecording(row) ? 'error' : 'success', onClick: () => toggleRecord(row) }, { default: () => isRecording(row) ? '停止录制' : '开始录制' }),
      h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => removeRoom(row) }, { default: () => '删除' })
    ])
  }
]

function rowProps(row: any) {
  return {
    style: row === roomList.selectedRoom ? 'background:#edf8fd;cursor:pointer' : 'cursor:pointer',
    onClick: () => { roomList.selectRoom(row); danmuStore.selectRoom(row) }
  }
}

async function toggleConnect(room: any) {
  if ((room.platform || 'douyin') !== 'douyin') return message.warning('其他平台弹幕需要各自登录态和协议适配，当前先支持多平台录制。')
  if (isConnected(room)) await danmuStore.disconnectRoom(room.enterRoomId)
  else await danmuStore.connectRoom(room.enterRoomId, room.nickname, 'douyin')
}

async function toggleRecord(room: any) {
  if (isRecording(room)) await recordStore.stopOne(room.enterRoomId)
  else await recordStore.recordOne(room)
}

async function connectAll() {
  await danmuStore.connectAll(roomList.results)
  const other = roomList.results.filter((r: any) => (r.platform || 'douyin') !== 'douyin').length
  if (other) message.info(`抖音弹幕已连接；${other} 个其他平台暂未接入弹幕`)
}

async function openRoom(room: any) {
  if (room?.url) await API().openExternal(room.url)
}

async function removeRoom(room: any) {
  if (isRecording(room)) await recordStore.stopOne(room.enterRoomId)
  if (isConnected(room)) await danmuStore.disconnectRoom(room.enterRoomId)
  if (selected.value === room) roomList.selectRoom(null)
  roomList.selectedRoom = room
  roomList.deleteSelected()
}

async function refreshRooms() {
  await roomList.fetchRooms()
}

function importLinks() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.txt'
  input.onchange = async (e: any) => {
    const file = e.target.files?.[0]
    if (file) roomList.urlText = await file.text()
  }
  input.click()
}
</script>

<style scoped>
.live-page { height:100%; overflow-y:auto; padding:18px 22px 22px; }
.live-head { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; margin-bottom:12px; }
.live-title { margin:0 0 4px; font-size:var(--fs-h1); color:var(--ink); letter-spacing:-.2px; }
.live-sub { color:var(--ink-3); font-size:12px; line-height:1.6; max-width:760px; }
.live-pills { display:flex; gap:7px; flex-wrap:wrap; justify-content:flex-end; }
.pill { border:1px solid var(--line-2); background:#fff; border-radius:999px; padding:6px 10px; color:var(--ink-3); font-size:11px; }
.pill b { color:var(--pulse-accent); font-size:14px; margin-right:2px; }
.pill.connected b { color:var(--ok); } .pill.recording b { color:#ef6c4d; }
.card { background:var(--surface); border:1px solid var(--line); border-radius:14px; box-shadow:var(--shadow-panel); }
.add-card { padding:12px 14px; margin-bottom:12px; }
.add-row { display:flex; gap:8px; align-items:stretch; }
.add-row :deep(.n-input) { flex:1; }
.add-tools { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:9px; flex-wrap:wrap; }
.platform-chips, .all-actions { display:flex; gap:5px; flex-wrap:wrap; }
.platform-chip { border:1px solid var(--line-2); background:#fff; color:var(--ink-3); border-radius:999px; padding:4px 9px; cursor:pointer; font:11px var(--font); }
.platform-chip b { color:var(--ink-4); margin-left:2px; }
.platform-chip.active { border-color:var(--pulse-accent); color:var(--pulse-accent); background:var(--pulse-soft); }
.live-main { display:grid; grid-template-columns:minmax(520px,1.5fr) minmax(310px,.9fr); gap:12px; align-items:start; }
.overall-board { padding:11px 14px; margin-bottom:12px; }
.overall-head { display:flex; align-items:baseline; gap:9px; margin-bottom:8px; } .overall-head b { color:var(--ink); font-size:13px; } .overall-head span { color:var(--ink-4); font-size:11px; }
.overall-kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:7px; margin-bottom:9px; } .overall-kpis div { display:flex; align-items:baseline; justify-content:space-between; border-radius:8px; background:#f7fbfd; border:1px solid #e5eef4; padding:7px 9px; } .overall-kpis span { color:var(--ink-4); font-size:10px; } .overall-kpis b { color:var(--pulse-accent); font-size:18px; line-height:1; } .overall-kpis b.bad { color:var(--bad); }
.overall-rooms { display:flex; gap:6px; overflow-x:auto; padding-bottom:2px; } .overall-room { min-width:185px; display:flex; align-items:center; gap:6px; flex-wrap:wrap; border:1px solid var(--line); border-radius:8px; padding:7px 9px; background:#fff; } .overall-room.active { border-color:#f5b69f; background:#fff8f5; } .overall-room b { min-width:0; max-width:88px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; color:var(--ink-2); } .overall-rec { font-size:9px; color:var(--ink-4); } .overall-rec.on { color:#d4542c; font-weight:700; } .overall-meta { flex-basis:100%; width:100%; font-size:9px; color:var(--ink-4); } .overall-empty { color:var(--ink-4); font-size:11px; padding:4px 0 2px; }
.room-panel { padding:12px 14px; min-height:420px; }
.panel-head { display:flex; justify-content:space-between; gap:10px; align-items:center; margin-bottom:9px; }
.panel-head > div { display:flex; align-items:baseline; gap:9px; flex-wrap:wrap; }
.panel-head b { font-size:13px; color:var(--ink); }
.panel-head span { color:var(--ink-4); font-size:11px; }
.name-cell { display:flex; align-items:center; gap:7px; min-width:0; }
.name-copy { display:flex; flex-direction:column; min-width:0; gap:1px; }
.name-copy b { color:var(--ink); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.name-copy span { color:var(--ink-4); font-size:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.name-copy em { font-style:normal; font-weight:600; } .name-copy i { font-style:normal; color:var(--ink-4); }
.row-actions { display:flex; align-items:center; gap:1px; flex-wrap:wrap; }
.platform-badge { border-radius:5px; padding:2px 5px; font-size:10px; flex-shrink:0; background:#eef5fb; color:#0b76be; }
.platform-badge.bilibili { background:#fff0f4; color:#e84a72; } .platform-badge.tiktok { background:#f2f2f2; color:#303030; } .platform-badge.kuaishou { background:#fff2e8; color:#ef6c00; } .platform-badge.xiaohongshu { background:#fff0f2; color:#df3355; } .platform-badge.other { background:#f2f4f7; color:#657384; }
.table-status { font-size:11px; font-weight:600; }
.table-status.live { color:var(--ok); } .table-status.idle { color:var(--ink-4); } .table-status.bad { color:var(--bad); }
.right-column { display:flex; flex-direction:column; gap:12px; min-width:0; }
.selected-card { padding:14px; }
.selected-head { display:flex; gap:9px; align-items:center; }
.avatar { width:38px; height:38px; border-radius:11px; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:800; }
.selected-name-wrap { min-width:0; flex:1; display:flex; flex-direction:column; gap:2px; }
.selected-name-wrap b { color:var(--ink); font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.selected-name-wrap span { color:var(--ink-4); font-size:10px; }
.state-chip { padding:3px 7px; border-radius:999px; font-size:10px; }
.state-chip.live { color:var(--ok); background:rgba(18,183,106,.09); } .state-chip.idle { color:var(--ink-4); background:var(--surface-2); } .state-chip.bad { color:var(--bad); background:rgba(240,68,56,.08); }
.selected-actions { display:flex; gap:6px; margin-top:12px; flex-wrap:wrap; }
.record-strip { display:flex; align-items:center; gap:7px; margin-top:11px; padding:7px 9px; border-radius:8px; background:#fff5f0; color:#b24d2c; font-size:11px; }
.record-dot { width:6px; height:6px; border-radius:50%; background:#ef6c4d; }
.selected-note { margin-top:10px; color:var(--ink-4); font-size:10px; line-height:1.6; }
.message-card { padding:12px 14px; min-height:220px; }
.message-count { color:var(--pulse-accent)!important; }
.empty-panel { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; min-height:320px; color:var(--ink-4); font-size:12px; }
.empty-panel.small { min-height:120px; }
.empty-panel b { color:var(--ink-3); font-size:13px; }
.empty-icon { font-size:30px; color:#b8cbd9; }
@media (max-width:980px) { .live-main { grid-template-columns:1fr; } .live-head { flex-direction:column; } .live-pills { justify-content:flex-start; } }
</style>
