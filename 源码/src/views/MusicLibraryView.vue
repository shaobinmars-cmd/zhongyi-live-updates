<template>
  <div class="music-page">
    <header class="music-hero">
      <div>
        <h1>曲库</h1>
        <p>禁播清单和给主播准备的可播放歌曲分开存。运营可以建不同文件夹，也可以直接上传音频。</p>
      </div>
      <div class="music-stats">
        <div><b>{{ stats.total }}</b><span>当前文件夹</span></div>
        <div class="blocked"><b>{{ stats.blocked }}</b><span>抖音无版权</span></div>
        <div class="ok"><b>{{ stats.ok }}</b><span>可播放</span></div>
      </div>
    </header>

    <section class="folder-strip card">
      <button
        v-for="f in folders"
        :key="f.id"
        :class="['folder-chip', { active: folderId === f.id, system: f.system }]"
        @click="selectFolder(f.id)"
      >
        <span class="folder-icon">{{ f.system ? '⛔' : '📁' }}</span>
        <span>{{ f.name }}</span>
        <b>{{ f.count }}</b>
      </button>
      <n-button size="small" dashed type="primary" @click="openFolderAdd">+ 新建文件夹</n-button>
    </section>

    <section class="music-toolbar card">
      <n-input v-model:value="search" clearable placeholder="搜歌曲名、歌手、备注" style="width: 280px" />
      <n-select v-model:value="statusFilter" :options="statusOptions" style="width: 180px" />
      <n-button type="primary" :loading="importing" @click="importFile">导入歌单到当前文件夹</n-button>
      <n-button type="info" :loading="checking" @click="checkFile">批量检测能否播放</n-button>
      <n-button type="warning" ghost :loading="updatingBlocked" @click="updateBlockedList">更新禁播歌曲</n-button>
      <n-button :disabled="isBlockedFolder || !folderId" :loading="uploading" @click="uploadAudio">上传歌曲文件</n-button>
      <n-button @click="openAdd">+ 手动新增</n-button>
      <n-button quaternary @click="openAudioFolder">打开当前文件夹</n-button>
      <n-button v-if="selectedFolder && !selectedFolder.system" quaternary @click="openFolderEdit">重命名</n-button>
      <n-popconfirm v-if="selectedFolder && !selectedFolder.system" positive-text="删除文件夹" negative-text="取消" @positive-click="removeFolder">
        <template #trigger><n-button quaternary type="error">删除文件夹</n-button></template>
        只有空文件夹能删除，歌曲不会自动丢。
      </n-popconfirm>
    </section>

    <div class="rule-line">
      <span class="danger-rule">红色 = 抖音无版权，禁止播放</span>
      <span>当前：<b>{{ selectedFolder?.name || '未选择' }}</b></span>
      <span>支持 XLSX / CSV 歌单，也支持 MP3 / WAV / M4A / FLAC / AAC / OGG / OPUS / WMA / APE / AIFF / AMR 等音频文件</span>
      <span class="format-note">酷狗、QQ音乐等下载的普通 MP3/FLAC 可直接导入；酷狗加密的 .kgm/.kgma/.vpr 属于受保护格式，不支持破解，请先在播放器里下载为未加密格式</span>
    </div>

    <section class="card table-card">
      <div class="table-head">
        <b>{{ filtered.length }}</b>
        <span>首符合当前筛选</span>
      </div>
      <n-data-table
        size="small"
        :columns="columns"
        :data="filtered"
        :row-key="(r: any) => r.id"
        :max-height="'calc(100vh - 350px)'"
        virtual-scroll
      />
    </section>

    <n-modal v-model:show="showEdit" preset="card" :title="editing.id ? '修改歌曲' : '新增歌曲'" style="width: 600px">
      <div class="edit-grid">
        <label><span>文件夹</span><n-select v-model:value="editing.folderId" :options="folderOptions" /></label>
        <label><span>状态</span><n-select v-model:value="editing.status" :options="editStatusOptions" /></label>
        <label style="grid-column: 1 / -1"><span>歌曲名</span><n-input v-model:value="editing.title" placeholder="必填" /></label>
        <label><span>歌手</span><n-input v-model:value="editing.artist" placeholder="可留空" /></label>
        <label><span>备注</span><n-input v-model:value="editing.note" placeholder="例如：版权方下架、主播适合唱" /></label>
      </div>
      <template #footer>
        <div class="edit-actions">
          <n-button @click="showEdit = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="saveSong">保存</n-button>
        </div>
      </template>
    </n-modal>

    <n-modal v-model:show="showFolderEdit" preset="card" :title="folderEditing.id ? '重命名文件夹' : '新建文件夹'" style="width: 460px">
      <label class="single-field"><span>文件夹名称</span><n-input v-model:value="folderEditing.name" placeholder="例如：主播A、活动暖场、怀旧金曲" /></label>
      <template #footer>
        <div class="edit-actions">
          <n-button @click="showFolderEdit = false">取消</n-button>
          <n-button type="primary" :loading="folderSaving" @click="saveFolder">保存</n-button>
        </div>
      </template>
    </n-modal>

    <n-modal v-model:show="showCheck" preset="card" title="歌单检测结果" style="width: 980px">
      <div class="check-summary">
        <span>共 <b>{{ checkStats.count }}</b> 首</span>
        <span class="bad">不能播放 <b>{{ checkStats.blocked }}</b></span>
        <span class="warn">疑似禁播 <b>{{ checkStats.suspected }}</b></span>
        <span class="ok">未命中禁播库 <b>{{ checkStats.okCount }}</b></span>
      </div>
      <div class="check-tip">“未命中禁播库”只表示当前曲库没有匹配到，不代表绝对拥有版权，发布前仍建议按平台版权规则复核。</div>
      <n-data-table size="small" :columns="checkColumns" :data="checkResults" :max-height="480" virtual-scroll />
      <template #footer>
        <div class="edit-actions">
          <n-button @click="showCheck = false">关闭</n-button>
          <n-button type="primary" :disabled="isBlockedFolder || !folderId" :loading="savingCheck" @click="saveChecked">保存到当前文件夹</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import {
  NButton, NDataTable, NInput, NModal, NPopconfirm, NSelect, NTag,
  useMessage, type DataTableColumns, type SelectOption
} from 'naive-ui'

const BLOCKED = '__blocked__'
const api = () => (window as any).electronAPI
const msg = useMessage()
const rows = ref<any[]>([])
const folders = ref<any[]>([])
const stats = ref<any>({ total: 0, blocked: 0, ok: 0, unknown: 0 })
const folderId = ref(BLOCKED)
const search = ref('')
const statusFilter = ref('')
const importing = ref(false)
const updatingBlocked = ref(false)
const uploading = ref(false)
const checking = ref(false)
const savingCheck = ref(false)
const showCheck = ref(false)
const checkResults = ref<any[]>([])
const checkSource = ref('')
const saving = ref(false)
const folderSaving = ref(false)
const showEdit = ref(false)
const showFolderEdit = ref(false)
const editing = ref<any>({ id: '', folderId: BLOCKED, title: '', artist: '', status: 'blocked', note: '', source: '' })
const folderEditing = ref<any>({ id: '', name: '' })

const statusOptions: SelectOption[] = [
  { label: '全部状态', value: '' },
  { label: '抖音无版权（禁播）', value: 'blocked' },
  { label: '可播放', value: 'ok' },
  { label: '待确认', value: 'unknown' }
]
const editStatusOptions = statusOptions.slice(1)
const folderOptions = computed<SelectOption[]>(() => folders.value.map((f) => ({ label: f.name, value: f.id })))
const selectedFolder = computed(() => folders.value.find((f) => f.id === folderId.value) || null)
const isBlockedFolder = computed(() => folderId.value === BLOCKED)
const statusText = (s: string) => s === 'blocked' ? '抖音无版权' : s === 'ok' ? '可播放' : '待确认'
const statusType = (s: string) => s === 'blocked' ? 'error' : s === 'ok' ? 'success' : 'default'
const checkText = (s: string) => s === 'blocked' ? '不能播放' : s === 'suspected' ? '疑似禁播' : '未命中禁播库'
const checkType = (s: string) => s === 'blocked' ? 'error' : s === 'suspected' ? 'warning' : 'success'
const checkStats = computed(() => ({
  count: checkResults.value.length,
  blocked: checkResults.value.filter((r) => r.result === 'blocked').length,
  suspected: checkResults.value.filter((r) => r.result === 'suspected').length,
  okCount: checkResults.value.filter((r) => r.result === 'ok').length
}))

const filtered = computed(() => {
  const q = search.value.replace(/\s+/g, '').toLowerCase()
  return rows.value.filter((r) => {
    if (statusFilter.value && r.status !== statusFilter.value) return false
    if (!q) return true
    return `${r.title || ''}${r.artist || ''}${r.note || ''}`.replace(/\s+/g, '').toLowerCase().includes(q)
  })
})

const columns: DataTableColumns<any> = [
  { title: '歌曲名', key: 'title', width: 230, ellipsis: { tooltip: true } },
  { title: '歌手', key: 'artist', width: 150, ellipsis: { tooltip: true }, render: (r) => r.artist || '-' },
  {
    title: '状态', key: 'status', width: 136,
    render: (r) => h(NTag, { type: statusType(r.status) as any, size: 'small', bordered: false }, { default: () => statusText(r.status) })
  },
  { title: '备注', key: 'note', ellipsis: { tooltip: true }, render: (r) => r.note || (r.status === 'blocked' ? '抖音无版权，不能播放' : '') },
  { title: '来源', key: 'source', width: 170, ellipsis: { tooltip: true } },
  {
    title: '操作', key: 'ops', width: 200,
    render: (r) => h('div', { style: 'display:flex;gap:6px' }, [
      r.filePath ? h(NButton, { size: 'tiny', tertiary: true, onClick: () => openSong(r) }, { default: () => '播放' }) : null,
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => openEdit(r) }, { default: () => '修改' }),
      h(NPopconfirm, {
        positiveText: '删除', negativeText: '取消', onPositiveClick: () => removeSong(r)
      }, {
        trigger: () => h(NButton, { size: 'tiny', type: 'error', quaternary: true }, { default: () => '删除' }),
        default: () => `删除“${r.title}”？`
      })
    ].filter(Boolean))
  }
]

const checkColumns: DataTableColumns<any> = [
  { title: '歌曲名', key: 'title', width: 240, ellipsis: { tooltip: true } },
  { title: '歌手', key: 'artist', width: 150, ellipsis: { tooltip: true }, render: (r) => r.artist || '-' },
  {
    title: '检测结果', key: 'result', width: 136,
    render: (r) => h(NTag, { type: checkType(r.result) as any, size: 'small', bordered: false }, { default: () => checkText(r.result) })
  },
  { title: '匹配歌曲', key: 'matched', width: 220, ellipsis: { tooltip: true }, render: (r) => r.matchedTitle ? `${r.matchedTitle} / ${r.matchedArtist || '歌手未知'}` : '-' },
  { title: '说明', key: 'note', ellipsis: { tooltip: true } }
]

async function load(): Promise<void> {
  folders.value = await api().musicFolders()
  if (!folders.value.some((f) => f.id === folderId.value)) folderId.value = folders.value[0]?.id || BLOCKED
  const [list, s] = await Promise.all([
    api().musicList('', '', folderId.value),
    api().musicStats(folderId.value)
  ])
  rows.value = list || []
  stats.value = s || stats.value
}

function selectFolder(id: string): void {
  folderId.value = id
  load()
}

async function importFile(): Promise<void> {
  if (!folderId.value) return
  try {
    const file = await api().musicPickFile()
    if (!file) return
    importing.value = true
    const r = await api().musicImport(file, folderId.value)
    msg.success(r?.message || '歌单导入完成')
    await load()
  } catch (e: any) {
    msg.error('导入失败：' + (e?.message || e))
  } finally {
    importing.value = false
  }
}

async function updateBlockedList(): Promise<void> {
  try {
    const file = await api().musicPickFile()
    if (!file) return
    updatingBlocked.value = true
    const r = await api().musicImport(file, BLOCKED, true)
    msg.success(r?.message || '禁播歌曲已更新')
    folderId.value = BLOCKED
    await load()
  } catch (e: any) {
    msg.error('更新禁播歌曲失败：' + (e?.message || e))
  } finally {
    updatingBlocked.value = false
  }
}

async function checkFile(): Promise<void> {
  try {
    const file = await api().musicPickFile()
    if (!file) return
    checking.value = true
    checkSource.value = file
    const r = await api().musicCheckFile(file)
    checkResults.value = r?.results || []
    showCheck.value = true
    msg.success(`检测完成：不能播放 ${r?.blocked || 0}，疑似 ${r?.suspected || 0}，未命中 ${r?.okCount || 0}`)
  } catch (e: any) {
    msg.error('检测失败：' + (e?.message || e))
  } finally {
    checking.value = false
  }
}

async function saveChecked(): Promise<void> {
  if (!folderId.value || isBlockedFolder.value) { msg.warning('先切到一个运营文件夹再保存检测结果'); return }
  savingCheck.value = true
  try {
    const name = String(checkSource.value || '').split(/[\\/]/).pop() || '匹配检测'
    const r = await api().musicSaveCheck(checkResults.value, folderId.value, name)
    msg.success(`已保存到当前文件夹：新增 ${r?.added || 0}，更新 ${r?.updated || 0}`)
    showCheck.value = false
    await load()
  } catch (e: any) {
    msg.error('保存检测结果失败：' + (e?.message || e))
  } finally {
    savingCheck.value = false
  }
}

async function uploadAudio(): Promise<void> {
  if (!folderId.value || isBlockedFolder.value) { msg.warning('请先选择一个运营文件夹，不能往禁播清单上传音频'); return }
  try {
    const files = await api().musicPickAudio()
    if (!files?.length) return
    uploading.value = true
    const r = await api().musicUpload(files, folderId.value)
    msg.success(`已加入 ${r?.added || 0} 首${r?.skipped ? `，跳过 ${r.skipped} 个文件` : ''}`)
    await load()
  } catch (e: any) {
    msg.error('上传失败：' + (e?.message || e))
  } finally {
    uploading.value = false
  }
}

function openAdd(): void {
  editing.value = {
    id: '', folderId: folderId.value || BLOCKED, title: '', artist: '',
    status: isBlockedFolder.value ? 'blocked' : 'unknown', note: '', source: '手动添加'
  }
  showEdit.value = true
}

function openEdit(row: any): void {
  editing.value = { ...row }
  showEdit.value = true
}

async function saveSong(): Promise<void> {
  if (!String(editing.value.title || '').trim()) { msg.warning('歌曲名不能为空'); return }
  saving.value = true
  try {
    if (editing.value.id) await api().musicUpdate(editing.value.id, editing.value)
    else await api().musicAdd(editing.value)
    showEdit.value = false
    msg.success('已保存')
    await load()
  } catch (e: any) {
    msg.error('保存失败：' + (e?.message || e))
  } finally {
    saving.value = false
  }
}

async function removeSong(row: any): Promise<void> {
  try {
    await api().musicRemove(row.id)
    msg.success('已删除：' + row.title)
    await load()
  } catch (e: any) {
    msg.error('删除失败：' + (e?.message || e))
  }
}

function openFolderAdd(): void {
  folderEditing.value = { id: '', name: '' }
  showFolderEdit.value = true
}

function openFolderEdit(): void {
  if (!selectedFolder.value || selectedFolder.value.system) return
  folderEditing.value = { id: selectedFolder.value.id, name: selectedFolder.value.name }
  showFolderEdit.value = true
}

async function saveFolder(): Promise<void> {
  if (!String(folderEditing.value.name || '').trim()) { msg.warning('文件夹名称不能为空'); return }
  folderSaving.value = true
  try {
    if (folderEditing.value.id) {
      await api().musicFolderRename(folderEditing.value.id, folderEditing.value.name)
    } else {
      const f = await api().musicFolderAdd(folderEditing.value.name)
      folderId.value = f.id
    }
    showFolderEdit.value = false
    await load()
  } catch (e: any) {
    msg.error('保存文件夹失败：' + (e?.message || e))
  } finally {
    folderSaving.value = false
  }
}

async function removeFolder(): Promise<void> {
  if (!selectedFolder.value || selectedFolder.value.system) return
  try {
    await api().musicFolderRemove(selectedFolder.value.id)
    folderId.value = BLOCKED
    msg.success('文件夹已删除')
    await load()
  } catch (e: any) {
    msg.error('删除失败：' + (e?.message || e))
  }
}

async function openSong(row: any): Promise<void> {
  try { await api().musicOpenSong(row.id) } catch (e: any) { msg.error('打开失败：' + (e?.message || e)) }
}

async function openAudioFolder(): Promise<void> {
  if (!folderId.value) { msg.warning('先选择文件夹'); return }
  try { await api().musicOpenFolder(folderId.value) } catch (e: any) { msg.error('打开失败：' + (e?.message || e)) }
}

onMounted(load)
</script>

<style scoped>
.music-page { height: calc(100vh - 74px); overflow: auto; padding: 18px 22px; color: var(--ink-2); }
.music-hero { display: flex; align-items: center; justify-content: space-between; gap: 22px; padding: 22px 26px; border-radius: 18px; background: linear-gradient(110deg,var(--pulse-deep),var(--pulse-accent) 58%,var(--pulse-deep)); color: white; box-shadow: 0 12px 30px rgba(5,82,125,.2); }
.music-hero h1 { margin: 0 0 6px; font-size: 26px; letter-spacing: .5px; }
.music-hero p { margin: 0; color: rgba(255,255,255,.82); font-size: 13px; }
.music-stats { display: flex; gap: 12px; flex-shrink: 0; }
.music-stats > div { min-width: 108px; padding: 10px 14px; border-radius: 12px; background: rgba(255,255,255,.13); border: 1px solid rgba(255,255,255,.18); display: flex; flex-direction: column; }
.music-stats b { font-family: var(--font-num); font-size: 24px; line-height: 1.1; }
.music-stats span { font-size: 11px; color: rgba(255,255,255,.76); margin-top: 4px; }
.music-stats .blocked { background: rgba(239,78,78,.22); }
.music-stats .ok { background: rgba(43,216,192,.18); }
.folder-strip { margin-top: 14px; padding: 12px 14px; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.folder-chip { border: 1px solid var(--pulse-soft); background: var(--surface); border-radius: 999px; padding: 7px 12px; display: flex; align-items: center; gap: 7px; color: var(--pulse-deep); cursor: pointer; font: inherit; }
.folder-chip b { font-family: var(--font-num); min-width: 20px; text-align: right; color: var(--pulse-accent); }
.folder-chip.active { background: var(--pulse-soft); border-color: var(--pulse-accent); color: var(--pulse-deep); box-shadow: 0 0 0 2px rgba(11,118,190,.08); }
.folder-chip.system { border-color: var(--line-2); background: var(--bad-soft); }
.folder-icon { font-size: 14px; }
.music-toolbar { margin-top: 12px; padding: 14px 16px; display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.rule-line { margin: 10px 2px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; color: var(--ink-3); font-size: 12px; }
.danger-rule { color: var(--bad); font-weight: 700; }
.table-card { padding: 14px 16px; }
.table-head { display: flex; align-items: baseline; gap: 7px; margin-bottom: 10px; }
.table-head b { font-family: var(--font-num); font-size: 22px; color: var(--pulse-accent); }
.table-head span { color: var(--ink-3); font-size: 12px; }
.edit-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.edit-grid label, .single-field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--ink-3); }
.edit-actions { display: flex; justify-content: flex-end; gap: 8px; }
.check-summary { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.check-summary span { padding: 7px 12px; border-radius: 999px; background: var(--pulse-soft); border: 1px solid var(--pulse-soft); font-size: 12px; }
.check-summary b { font-family: var(--font-num); font-size: 17px; margin-left: 4px; }
.check-summary .bad { background: var(--bad-soft); border-color: var(--bad-soft); color: var(--bad); }
.check-summary .warn { background: var(--warn-soft); border-color: var(--line-2); color: var(--brand); }
.check-summary .ok { background: var(--pulse-soft); border-color: var(--line-2); color: var(--pulse-deep); }
.check-tip { margin-bottom: 10px; color: var(--brand); background: var(--warn-soft); border: 1px solid var(--line-2); border-radius: 8px; padding: 8px 10px; font-size: 12px; }
.format-note { flex-basis:100%; color:var(--brand); background:var(--warn-soft); border:1px solid var(--line-2); border-radius:8px; padding:6px 9px; line-height:1.5; }
</style>
