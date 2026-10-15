import { defineStore } from 'pinia'
import { ref } from 'vue'

const api = () => (window as any).electronAPI

const MAX_UI_LINES = 2000

export const useTeardownStore = defineStore('teardown', () => {
  // 引擎
  const engine = ref<any>(null)

  // 可选素材
  const recordings = ref<any[]>([])
  const loadingList = ref(false)

  // 当前任务
  const input = ref('')
  const model = ref('small')
  const running = ref(false)
  const stage = ref('')
  const logs = ref<string[]>([])
  const error = ref('')
  const startedAt = ref(0)
  const finishedAt = ref(0)

  // 产出
  const packet = ref<any>(null)
  const showPacket = ref(false)

  // 上下文预算（token）：素材包超过它就自动分片
  const contextLimit = ref(24000)
  // 转写设备：cpu / cuda / auto
  const device = ref('cpu')
  const splitting = ref(false)

  // 双场对比：A = 对标主播，B = 自家主播
  const compareA = ref('')
  const compareB = ref('')
  const compareResult = ref<any>(null)
  const comparing = ref(false)
  const compareError = ref('')

  // 批量拆解队列
  const batch = ref<any>({ items: [], running: false, done: 0, total: 0, currentName: '' })

  let listenersReady = false

  function appendLine(line: string) {
    logs.value.push(line)
    if (logs.value.length > MAX_UI_LINES) {
      logs.value.splice(0, logs.value.length - MAX_UI_LINES)
    }
  }

  function setupListeners() {
    if (listenersReady) return
    listenersReady = true

    api().onTeardownLog((line: string) => appendLine(line))
    api().onBatchUpdate((d: any) => { batch.value = d })

    api().onTeardownState((s: any) => {
      running.value = !!s.running
      stage.value = s.stage || ''
      error.value = s.error || ''
      startedAt.value = s.startedAt || 0
      finishedAt.value = s.finishedAt || 0
      if (s.packetPath) {
        loadPacket().catch(() => { /* ignore */ })
      }
    })
  }

  function removeListeners() {
    api().removeTeardownListeners()
    listenersReady = false
  }

  async function refreshEngine() {
    engine.value = await api().teardownEngineStatus()
    return engine.value
  }

  async function refreshBatch() {
    batch.value = await api().batchState()
    return batch.value
  }

  /** 把列表里还没拆解过的场次全部入队（也可传入全部） */
  async function startBatch(entries: any[], skipAnalyzed = true) {
    const r = await api().batchAdd(entries, model.value, skipAnalyzed)
    if (r) batch.value = r
    return r
  }

  async function stopBatch() {
    batch.value = await api().batchStop()
  }

  async function clearBatch() {
    batch.value = await api().batchClear()
  }

  async function exportBatch() {
    return api().batchExport()
  }

  async function refreshConfig() {
    const cfg = await api().teardownConfigGet()
    if (cfg?.contextLimit) contextLimit.value = cfg.contextLimit
    if (cfg?.whisperDevice) device.value = cfg.whisperDevice
  }

  /** 改预算后重新分片 */
  async function applyLimit(v: number) {
    contextLimit.value = v
    await api().teardownConfigSet({ contextLimit: v })
    if (!input.value) return null
    splitting.value = true
    try {
      const s = await api().teardownResplit(input.value, v)
      if (packet.value) packet.value = { ...packet.value, split: s }
      return s
    } finally {
      splitting.value = false
    }
  }

  async function exportParts() {
    return api().teardownExportParts(input.value)
  }

  /** 生成对比素材包（A 对标 / B 自家） */
  async function runCompare() {
    compareError.value = ''
    if (!compareA.value || !compareB.value) { compareError.value = 'A 和 B 都要选一场录制'; return null }
    if (compareA.value === compareB.value) { compareError.value = 'A 和 B 不能选同一场'; return null }
    comparing.value = true
    try {
      const r = await api().teardownCompare(compareA.value, compareB.value, contextLimit.value)
      if (r?.error) { compareError.value = r.error; compareResult.value = null; return null }
      compareResult.value = r
      return r
    } catch (ex: any) {
      compareError.value = ex?.message || '生成失败'
      return null
    } finally {
      comparing.value = false
    }
  }

  async function exportCompare(part: any) {
    const name = String(part?.fileName || '对比素材包').replace(/\.md$/i, '')
    return api().teardownExportCompare(part?.content || '', name)
  }

  /** 改转写设备（立即存盘） */
  async function setDevice(v: string) {
    device.value = v
    await api().teardownConfigSet({ whisperDevice: v })
  }

  async function copyText(text: string) {
    if (!text) return false
    await navigator.clipboard.writeText(text)
    return true
  }

  async function refreshRecordings() {
    loadingList.value = true
    try {
      recordings.value = await api().teardownList()
    } finally {
      loadingList.value = false
    }
  }

  /** 页面挂载时把主进程里的状态接回来（切页不丢进度） */
  async function hydrate() {
    const s = await api().teardownGetState()
    if (!s) return
    running.value = !!s.running
    stage.value = s.stage || ''
    error.value = s.error || ''
    startedAt.value = s.startedAt || 0
    finishedAt.value = s.finishedAt || 0
    if (Array.isArray(s.lines) && s.lines.length) logs.value = s.lines.slice(-MAX_UI_LINES)
    if (s.input && !input.value) input.value = s.input
    if (s.model) model.value = s.model
    if (s.input) await loadPacket(s.input)
  }

  async function loadPacket(target?: string) {
    const src = target || input.value
    if (!src) { packet.value = null; return null }
    packet.value = await api().teardownPacket(src)
    return packet.value
  }

  async function start() {
    if (!input.value.trim()) { error.value = '先选一个录制文件或目录'; return }
    error.value = ''
    logs.value = []
    packet.value = null
    showPacket.value = false
    const s = await api().teardownStart(input.value.trim(), model.value)
    if (s) {
      running.value = !!s.running
      stage.value = s.stage || ''
      error.value = s.error || ''
    }
  }

  async function stop() {
    const s = await api().teardownStop()
    if (s) { running.value = !!s.running; stage.value = s.stage || '' }
  }

  async function pickFile() {
    const p = await api().teardownBrowse('file')
    if (p) { input.value = p; await loadPacket(p) }
  }

  async function pickDir() {
    const p = await api().teardownBrowse('dir')
    if (p) { input.value = p; await loadPacket(p) }
  }

  function selectRecording(rec: any) {
    input.value = rec.path
    packet.value = rec.analyzed ? packet.value : null
    loadPacket(rec.path).catch(() => { /* ignore */ })
  }

  async function exportPacket() {
    const r = await api().teardownExport(input.value)
    return r
  }

  async function openTarget(target: string) {
    return api().teardownOpen(target)
  }

  async function copyPacket() {
    const text = packet.value?.content || ''
    if (!text) return false
    await navigator.clipboard.writeText(text)
    return true
  }

  return {
    engine, recordings, loadingList,
    input, model, running, stage, logs, error, startedAt, finishedAt,
    packet, showPacket,
    setupListeners, removeListeners, refreshEngine, refreshRecordings,
    hydrate, loadPacket, start, stop, pickFile, pickDir, selectRecording,
    contextLimit, splitting,
    device, setDevice,
    compareA, compareB, compareResult, comparing, compareError, runCompare, exportCompare,
    batch, refreshBatch, startBatch, stopBatch, clearBatch, exportBatch,
    refreshConfig, applyLimit, exportParts, copyText,
    exportPacket, openTarget, copyPacket
  }
})
