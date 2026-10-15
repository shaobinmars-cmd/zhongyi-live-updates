<template>
  <div
    class="td-page"
    :class="{ 'drag-over': dragging }"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <div class="td-head">
      <div>
        <h2 class="page-title">拆解直播间</h2>
        <div class="page-sub">选中录制 → 本地引擎出「拆解素材包」→ 发给 AI 出复盘</div>
      </div>
      <div :class="['engine-chip', engineOk ? 'ok' : 'bad']">
        <span class="dot"></span>
        <span v-if="engineOk">引擎就绪</span>
        <span v-else>引擎未就绪</span>
      </div>
    </div>

    <div v-if="!engineOk" class="card warn-card">
      <div class="warn-title">拆解引擎没找到</div>
      <div class="warn-body">
        引擎目录里需要有 <code>python-embed\python.exe</code> 和 <code>直播拆解工具.py</code>。
        <div v-if="engine && engine.root" class="warn-path">当前查找目录：{{ engine.root }}</div>
      </div>
    </div>

    <!-- 环境状态条：装到任何一台电脑上，缺什么一眼就能看到 -->
    <!-- 实时信号栏：本页唯一“用力”的地方，其余一律保持安静 -->
    <div :class="['rail', envWorst]">
      <div class="live">
        <span class="live-dot"></span>
        <span class="live-text">运行中</span>
      </div>

      <div class="stat">
        <span class="stat-num num">{{ pendingCount }}</span>
        <span class="stat-label">待拆解</span>
      </div>
      <div class="stat">
        <span class="stat-num num">{{ doneCount }}</span>
        <span class="stat-label">已出包</span>
      </div>

      <span class="rail-divider"></span>
      <span class="rail-summary">{{ envSummary }}</span>

      <div class="rail-chips">
        <span
          v-for="it in env.items"
          :key="it.key"
          :class="['rail-chip', it.level]"
          :title="it.detail + (it.fix ? '　→ ' + it.fix : '')"
        >{{ it.title }}</span>
      </div>

      <button class="link-btn" :disabled="envBusy" @click="recheckEnv">
        {{ envBusy ? '检查中…' : '重新检查' }}
      </button>
    </div>

    <div v-if="envProblems.length" class="env-detail">
      <div v-for="p in envProblems" :key="p.key" :class="['env-problem', p.level]">
        <span class="env-problem-title">{{ p.title }}</span>
        <span class="env-problem-detail">{{ p.detail }}</span>
        <div v-if="p.fix" class="env-problem-fix">怎么处理：{{ p.fix }}</div>
      </div>
    </div>

    <div class="td-grid">
      <!-- 左：素材 + 运行 -->
      <div class="td-col">
        <div class="zone">
          <div class="zone-head">
            <span class="zone-num num">1</span>
            <span class="zone-title">选素材</span>
            <span class="zone-hint">手机/相机录的也行</span>
            <button class="link-btn" :disabled="loadingList" @click="refreshList">
              {{ loadingList ? '刷新中…' : '刷新' }}
            </button>
          </div>

          <div v-if="recordings.length === 0" class="empty-line">还没有找到可拆解的录制</div>
          <div v-else class="rec-list">
            <div
              v-for="rec in recordings"
              :key="rec.path"
              :class="['rec-item', { active: input === rec.path }]"
              @click="selectRecording(rec)"
            >
              <div class="rec-main">
                <div class="rec-name">{{ rec.name }}</div>
                <div class="rec-meta">
                  {{ rec.kind === 'dir' ? '目录' : '文件' }} · {{ humanSize(rec.sizeBytes) }} · {{ humanTime(rec.mtime) }}
                </div>
              </div>
              <span v-if="rec.analyzed" class="rec-tag">已拆解</span>
            </div>
          </div>

          <div class="pick-row">
            <n-button size="small" type="primary" ghost @click="pickFile">选视频文件</n-button>
            <n-button size="small" @click="pickDir">选整个目录</n-button>
          </div>
          <div class="pick-hint">
            手机、相机录的视频也能拆 —— 点「选视频文件」，或者把视频直接拖进这个窗口。
            多个视频放同一个文件夹里，选那个目录，会按文件名顺序合并后再分析。
          </div>
          <n-input
            v-model:value="input"
            size="small"
            placeholder="也可以把文件/目录路径粘在这里，回车"
            @keyup.enter="loadPacket()"
          />
        </div>

        <div class="zone">
          <div class="zone-head">
            <span class="zone-num num">2</span>
            <span class="zone-title">转写设置</span>
          </div>

          <div class="run-row">
            <div class="run-label">转写模型</div>
            <n-select
              v-model:value="model"
              size="small"
              :disabled="running"
              :options="modelOptions"
              style="width: 100%"
            />
          </div>
          <div class="model-hint">{{ modelHint }}</div>

          <div class="run-row">
            <div class="run-label">上下文预算</div>
            <n-input-number
              v-model:value="limitInput"
              size="small"
              :min="2000"
              :max="400000"
              :step="2000"
              style="width: 100%"
              @blur="onLimitChange"
            />
          </div>
          <div class="model-hint">
            素材包超过这个 token 数就自动拆成多份（改完自动重切）
          </div>

          <div class="run-row">
            <div class="run-label">转写设备</div>
            <n-select v-model:value="device" size="small" :options="deviceOptions" style="width: 100%" />
          </div>
          <div class="model-hint">{{ deviceHint }}</div>

          <div class="run-actions">
            <n-button
              v-if="!running"
              type="primary"
              size="small"
              :disabled="!input"
              @click="onStart"
            >开始拆解</n-button>
            <n-button v-else type="error" size="small" @click="onStop">停止</n-button>
            <span v-if="running" class="stage-text">
              <span class="spinner"></span>{{ stage || '运行中' }}
            </span>
            <span v-else-if="stage" class="stage-text done">{{ stage }}</span>
          </div>

          <div v-if="error" class="err-text">{{ error }}</div>

        </div>

        <div class="zone compare-zone">
          <div class="zone-head">
            <span class="zone-num num">3</span>
            <span class="zone-title">双场对比</span>
            <span class="panel-sub">A 对标 / B 自家</span>
          </div>

          <div class="run-row">
            <div class="run-label">A 对标</div>
            <n-select v-model:value="compareA" size="small" :options="recOptions" placeholder="选对标主播的场次" style="width: 100%" />
          </div>
          <div class="run-row">
            <div class="run-label">B 自家</div>
            <n-select v-model:value="compareB" size="small" :options="recOptions" placeholder="选自家主播的场次" style="width: 100%" />
          </div>

          <div class="run-actions">
            <n-button
              size="small"
              type="primary"
              :disabled="!compareA || !compareB"
              :loading="comparing"
              @click="onCompare"
            >生成对比素材包</n-button>
          </div>
          <div class="model-hint">两边都要先拆解过；生成后到右边「双场对比」页签看结果</div>
          <div v-if="compareError" class="err-text">{{ compareError }}</div>
        </div>

      </div>

      <!-- 右：日志 / 素材包 / 分片 -->
      <div class="td-col right workspace">
        <div class="tabs">
          <button :class="['tab', { active: tab === 'log' }]" @click="tab = 'log'">运行日志</button>
          <button :class="['tab', { active: tab === 'packet' }]" @click="tab = 'packet'">
            拆解素材包<span v-if="packet" class="tab-dot"></span>
          </button>
          <button :class="['tab', { active: tab === 'split' }]" @click="tab = 'split'">
            喂给 AI<span v-if="splitBadge" class="tab-badge">{{ splitBadge }}</span>
          </button>
          <button :class="['tab', { active: tab === 'compare' }]" @click="tab = 'compare'">
            双场对比<span v-if="compareResult" class="tab-badge">{{ compareResult.split ? compareResult.parts.length : 1 }}</span>
          </button>
          <button :class="['tab', { active: tab === 'batch' }]" @click="tab = 'batch'">
            批量<span v-if="batch.total" class="tab-badge">{{ batch.total }}</span>
          </button>
        </div>

        <div v-show="tab === 'log'" class="log-wrap">
          <div v-if="logs.length === 0" class="empty-line">还没有日志，选一个录制点「开始拆解」</div>
          <pre v-else ref="logEl" class="log">{{ logs.join('\n') }}</pre>
        </div>

        <div v-show="tab === 'packet'" class="packet-wrap">
          <div v-if="!packet" class="empty-line">这一场还没有拆解过</div>
          <template v-else>
            <div class="packet-actions">
              <n-button size="tiny" type="primary" @click="onExport">导出素材包</n-button>
              <n-button size="tiny" @click="onCopy">{{ copied ? '已复制' : '复制全文' }}</n-button>
              <n-button size="tiny" type="info" :loading="aiBusy" @click="onAnalyze">AI 分析</n-button>
              <n-button v-if="aiBusy" size="tiny" type="warning" @click="onCancelAnalyze">停止分析</n-button>
              <n-button v-if="aiReportPath" size="tiny" @click="openTarget(aiReportPath)">打开分析报告</n-button>
              <n-button size="tiny" @click="openTarget(packet.workDir)">打开输出目录</n-button>
              <span class="packet-meta">
                网格图 {{ packet.grids.length }} 张
                <template v-if="packet.offlineDraft"> · 有离线草稿</template>
                <template v-if="aiStage"> · {{ aiStage }}</template>
              </span>
            </div>
            <pre class="packet">{{ packet.content }}</pre>
          </template>
        </div>

        <div v-show="tab === 'split'" class="split-wrap">
          <div v-if="!split" class="empty-line">这一场还没有拆解过</div>
          <template v-else>
            <div class="split-head">
              <span :class="['split-badge', split.split ? 'warn' : 'ok']">
                {{ split.split ? `已切成 ${split.parts.length} 份` : '未超预算' }}
              </span>
              <span class="split-note">{{ split.note }}</span>
              <n-button size="tiny" :disabled="!split.split" @click="onExportParts">导出分片</n-button>
            </div>

            <div v-if="split.split" class="part-list">
              <div
                v-for="p in split.parts"
                :key="p.index"
                :class="['part-item', { active: selectedPart === p.index }]"
                @click="selectedPart = p.index"
              >
                <span class="part-idx">{{ p.index }}/{{ p.total }}</span>
                <span class="part-range">{{ p.timeRange }}</span>
                <span class="part-tok">{{ p.tokens }} tok</span>
                <button class="link-btn" @click.stop="onCopyPart(p)">复制</button>
              </div>
            </div>

            <pre v-if="split.split" class="packet">{{ previewPart }}</pre>
            <div v-else class="empty-line">
              这场没超预算，直接把素材包整份发给 AI 就行。
            </div>
          </template>
        </div>

        <div v-show="tab === 'compare'" class="split-wrap">
          <div v-if="!compareResult" class="empty-line">
            选 A（对标）和 B（自家）两场已拆解的录制，点「生成对比素材包」
          </div>
          <template v-else>
            <div class="split-head">
              <span class="split-badge warn">
                {{ compareResult.split ? `已切成 ${compareResult.parts.length} 份` : '整份' }}
              </span>
              <span class="split-note">{{ compareResult.note }}</span>
              <n-button size="tiny" @click="onExportCompare">导出本份</n-button>
            </div>

            <div v-if="compareResult.parts.length > 1" class="part-list">
              <div
                v-for="p in compareResult.parts"
                :key="p.index"
                :class="['part-item', { active: comparePartIdx === p.index }]"
                @click="comparePartIdx = p.index"
              >
                <span class="part-idx">{{ p.index }}/{{ p.total }}</span>
                <span class="part-range">A {{ p.rangeA }} · B {{ p.rangeB }}</span>
                <span class="part-tok">{{ p.tokens }} tok</span>
                <button class="link-btn" @click.stop="onCopyComparePart(p)">复制</button>
              </div>
            </div>

            <pre class="packet">{{ comparePart ? comparePart.content : '' }}</pre>
          </template>
        </div>

        <div v-show="tab === 'batch'" class="split-wrap">
          <div class="tab-tools">
            <n-button size="tiny" type="primary" :disabled="batchRunning" @click="onBatchAll">把当前列表里未处理的全部排队</n-button>
            <n-button size="tiny" :disabled="!batchRunning" @click="onBatchStop">停止</n-button>
            <n-button size="tiny" :disabled="batchRunning || !batch.total" @click="onBatchClear">清空</n-button>
          </div>
          <div v-if="!batch.items.length" class="empty-line">
            点左边的「全部未处理的」，把当前列出的录制排队拆完
          </div>
          <template v-else>
            <div class="split-head">
              <span class="split-badge warn">{{ batch.done }}/{{ batch.total }} 完成</span>
              <span class="split-note">一个跑完再跑下一个（转写吃 CPU，串行最稳）</span>
              <n-button size="tiny" :disabled="!batch.done" @click="onBatchExport">全部导出</n-button>
            </div>
            <div class="part-list batch-list">
              <div v-for="it in batch.items" :key="it.path" class="part-item batch-item">
                <span :class="['batch-dot', statusClass(it.status)]"></span>
                <span class="part-range">{{ it.name }}</span>
                <span class="part-tok">{{ it.status }}<template v-if="it.message"> · {{ it.message }}</template></span>
                <button v-if="it.status === '完成'" class="link-btn" @click.stop="openBatch(it)">查看</button>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { NInput, NButton, NSelect, NInputNumber, useMessage } from 'naive-ui'
import { useTeardownStore } from '../stores/teardown'

const td = useTeardownStore()
const message = useMessage()

const tab = ref<'log' | 'packet' | 'split' | 'compare' | 'batch'>('log')
const copied = ref(false)
const logEl = ref<HTMLElement | null>(null)
const selectedPart = ref(1)
const dragging = ref(false)

// ---- 环境自检（装到新电脑上先看这个）----
const env = ref<any>({ ok: true, items: [], checkedAt: 0 })
const envBusy = ref(false)
const envProblems = computed(() => (env.value.items || []).filter((i: any) => i.level !== 'ok'))
// 信号栏上的两个数：还有几场没拆、已经出了几个包
const pendingCount = computed(() => recordings.value.filter((r: any) => !r.analyzed).length)
const doneCount = computed(() => recordings.value.filter((r: any) => r.analyzed).length)
const envWorst = computed(() => {
  const items = env.value.items || []
  if (items.some((i: any) => i.level === 'bad')) return 'bad'
  if (items.some((i: any) => i.level === 'warn')) return 'warn'
  return 'ok'
})
const envSummary = computed(() => {
  const items = env.value.items || []
  const bad = items.filter((i: any) => i.level === 'bad').length
  const warn = items.filter((i: any) => i.level === 'warn').length
  if (!env.value.checkedAt) return '正在检查运行环境…'
  if (bad) return `有 ${bad} 项必须先解决，否则拆解会失败`
  if (warn) return `有 ${warn} 项需要注意（不致命）`
  return '环境正常，可以开始'
})

async function recheckEnv() {
  envBusy.value = true
  try {
    env.value = await (window as any).electronAPI.envCheck(td.model)
  } catch { /* ignore */ } finally {
    envBusy.value = false
  }
}

const input = computed({
  get: () => td.input,
  set: (v: string) => { td.input = v }
})
const model = computed({
  get: () => td.model,
  set: (v: string) => { td.model = v }
})
const limitInput = ref(td.contextLimit)

// ---- AI 分析：把素材包直接发给设置页里配好的 AI 接口 ----
const aiBusy = ref(false)
const aiStage = ref('')
const aiReportPath = ref('')
const api = () => (window as any).electronAPI

async function onAnalyze() {
  if (!input.value) { message.warning('先选一个录制'); return }
  aiBusy.value = true
  aiStage.value = '准备中…'
  try {
    const res = await api().aiAnalyze(input.value)
    if (res && res.ok) {
      aiReportPath.value = res.reportPath || ''
      aiStage.value = res.note || '完成'
      message.success('AI 分析完成：' + (res.note || ''))
    } else {
      aiStage.value = ''
      message.error(res?.note || '分析失败')
    }
  } catch (ex: any) {
    aiStage.value = ''
    message.error('分析失败: ' + (ex?.message || ex))
  } finally {
    aiBusy.value = false
  }
}

/** 中途停止：已经跑完的片会保存到「AI分析报告.md」 */
async function onCancelAnalyze() {
  try {
    await api().aiCancel()
    aiStage.value = '正在停止…'
  } catch { /* ignore */ }
}
const running = computed(() => td.running)
const stage = computed(() => td.stage)
const error = computed(() => td.error)
const logs = computed(() => td.logs)
const packet = computed(() => td.packet)
const recordings = computed(() => td.recordings)
const loadingList = computed(() => td.loadingList)
const engine = computed(() => td.engine)
const engineOk = computed(() => !!engine.value?.ok)
const split = computed(() => packet.value?.split || null)

const recOptions = computed(() =>
  recordings.value.map((r: any) => ({ label: r.name, value: r.path }))
)
const compareA = computed({
  get: () => td.compareA,
  set: (v: string) => { td.compareA = v }
})
const compareB = computed({
  get: () => td.compareB,
  set: (v: string) => { td.compareB = v }
})
const compareResult = computed(() => td.compareResult)
const comparing = computed(() => td.comparing)
const compareError = computed(() => td.compareError)
const comparePartIdx = ref(1)
const comparePart = computed(() => {
  const r = compareResult.value
  if (!r || !r.parts) return null
  return r.parts.find((p: any) => p.index === comparePartIdx.value) || r.parts[0]
})

const batch = computed(() => td.batch)
const batchRunning = computed(() => !!td.batch?.running)

function statusClass(s: string) {
  if (s === '完成') return 'ok'
  if (s === '失败') return 'bad'
  if (s === '拆解中') return 'busy'
  return 'idle'
}

const splitBadge = computed(() => {
  const s = packet.value?.split
  if (!s) return ''
  return s.split ? String(s.parts.length) : '1'
})

const previewPart = computed(() => {
  const s = split.value
  if (!s || !s.split) return ''
  const p = s.parts.find((x: any) => x.index === selectedPart.value) || s.parts[0]
  return p?.content || ''
})

const modelOptions = [
  { label: 'tiny · 75MB · 约 5 分钟/小时 · 中文一般', value: 'tiny' },
  { label: 'base · 145MB · 约 8 分钟/小时 · 中文一般', value: 'base' },
  { label: 'small · 460MB · 约 17 分钟/小时 · 日常够用（默认）', value: 'small' },
  { label: 'medium · 1.5GB · 约 60 分钟/小时 · 明显更准，建议 16G 内存', value: 'medium' },
  { label: 'large-v3 · 3.1GB · 约 150 分钟/小时 · 最准，建议 32G 内存', value: 'large-v3' }
]

const modelHint = computed(() => {
  const m = td.model
  const info: Record<string, string> = {
    tiny: '模型 75MB · 转写约 5 分钟/小时 · 中文一般 —— 内存小/救急用',
    base: '模型 145MB · 约 8 分钟/小时 · 比 tiny 好一点',
    small: '模型 460MB · 约 17 分钟/小时 · 中文够用，日常默认',
    medium: '模型 1.5GB · 约 60 分钟/小时 · 中文明显更准（专有名词/方言错得少），建议 16G 内存',
    'large-v3': '模型 3.1GB · 约 150 分钟/小时 · 最准，建议 32G 内存'
  }
  const cached = engine.value?.models || []
  const tail = cached.includes(m) ? '　✓ 已在本机，离线可用' : '　（首次使用要联网下载）'
  return (info[m] || '') + tail
})

// ---- 转写设备 ----
const device = computed({
  get: () => td.device,
  set: (v: string) => { td.setDevice(v); recheckEnv() }
})
const deviceOptions = [
  { label: 'CPU（默认，最稳）', value: 'cpu' },
  { label: 'GPU（要本机装了 CUDA，快 3-4 倍）', value: 'cuda' },
  { label: '自动（这台有 CUDA 就用 GPU）', value: 'auto' }
]
const deviceHint = computed(() => {
  if (td.device === 'cpu') return '固定用 CPU。包里没带 CUDA 库，这是最省事、最不会出错的选择。'
  return '需要这台电脑装了 CUDA（cublas + cudnn）且显卡驱动够新。没装的话会自动回退 CPU —— 不会失败，但也不会变快。'
})

function humanSize(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function humanTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function refreshList() { await td.refreshRecordings() }
function selectRecording(rec: any) { td.selectRecording(rec) }
function loadPacket() { td.loadPacket() }
async function pickFile() { await td.pickFile() }
async function pickDir() { await td.pickDir() }

/** 把视频/文件夹拖进窗口就能拆（手机、相机录的也行） */
function onDrop(e: DragEvent) {
  dragging.value = false
  const f = e.dataTransfer?.files?.[0]
  if (!f) return
  // Electron 32 起 File.path 没了，得走 webUtils；拿不到再退回 path
  let p = ''
  try { p = (window as any).electronAPI.getFilePath(f) || '' } catch { p = '' }
  if (!p) p = (f as any).path || ''
  if (!p) { message.warning('没拿到文件路径，用「选视频文件」试试'); return }
  td.input = p
  td.loadPacket(p)
  message.success('已选中：' + f.name)
}
function openTarget(p: string) { td.openTarget(p) }

async function onLimitChange() {
  const v = Number(limitInput.value)
  if (!v || v < 2000) { limitInput.value = td.contextLimit; return }
  const s = await td.applyLimit(v)
  if (s) message.success(s.split ? `已按 ${v} token 重切为 ${s.parts.length} 份` : '没超预算，不用分片')
}

async function onStart() {
  tab.value = 'log'
  await td.start()
}

async function onStop() { await td.stop() }

async function onExport() {
  const r = await td.exportPacket()
  if (r?.success) message.success('素材包已导出：' + r.path)
  else if (r?.error && r.error !== 'Cancelled') message.error(r.error)
}

async function onExportParts() {
  const r = await td.exportParts()
  if (r?.success) message.success(`已导出 ${r.count} 份到：${r.dir}`)
  else if (r?.error && r.error !== 'Cancelled') message.error(r.error)
}

async function onCopy() {
  const ok = await td.copyText(packet.value?.content || '')
  if (ok) {
    copied.value = true
    message.success('已复制，可以直接发给 AI')
    setTimeout(() => { copied.value = false }, 2000)
  } else {
    message.warning('还没有素材包内容')
  }
}

async function onCopyPart(p: any) {
  const ok = await td.copyText(p.content)
  if (ok) message.success(`第 ${p.index}/${p.total} 份已复制（${p.timeRange}）`)
}

async function onCompare() {
  const r = await td.runCompare()
  if (r) {
    comparePartIdx.value = 1
    tab.value = 'compare'
    message.success(r.split ? `已生成 ${r.parts.length} 份对比素材包` : '对比素材包已生成（整份）')
  } else if (td.compareError) {
    message.error(td.compareError)
  }
}

async function onCopyComparePart(p: any) {
  const ok = await td.copyText(p.content)
  if (ok) message.success(`对比第 ${p.index}/${p.total} 份已复制`)
}

async function onExportCompare() {
  const p = comparePart.value
  if (!p) return
  const r = await td.exportCompare(p)
  if (r?.success) message.success('已导出：' + r.path)
  else if (r?.error && r.error !== 'Cancelled') message.error(r.error)
}

async function onBatchAll() {
  const entries = recordings.value.map((r: any) => ({ path: r.path, name: r.name, analyzed: r.analyzed }))
  if (!entries.length) { message.warning('没有可拆解的录制'); return }
  const r = await td.startBatch(entries, true)
  if (r?.error) { message.error(r.error); return }
  tab.value = 'batch'
  message.success(r?.added ? `已入队 ${r.added} 场，开始排队拆解` : '没有新的场次（都已拆解过）')
}

async function onBatchStop() {
  await td.stopBatch()
  message.info('已停止批量拆解')
}

async function onBatchClear() {
  await td.clearBatch()
}

async function onBatchExport() {
  const r = await td.exportBatch()
  if (r?.success) message.success(`已导出 ${r.count} 个场次到：${r.dir}`)
  else if (r?.error && r.error !== 'Cancelled') message.error(r.error)
}

function openBatch(it: any) {
  td.input = it.path
  td.loadPacket(it.path).then(() => { tab.value = 'packet' })
}

watch(() => logs.value.length, async () => {
  if (tab.value !== 'log') return
  await nextTick()
  if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
})

watch(() => packet.value, (v) => {
  if (!v) return
  selectedPart.value = 1
  tab.value = v.split?.split ? 'split' : 'packet'
})

watch(() => td.contextLimit, (v) => { limitInput.value = v })

// 换模型会影响「内存够不够 / 模型下没下」，顺手重查一次
watch(() => td.model, () => { recheckEnv() })

onMounted(async () => {
  td.setupListeners()
  // 每次进页面先清掉旧的（否则来回切页会越叠越多）
  api().removeAiListeners()
  api().onAiProgress((p: any) => { if (p && p.stage) aiStage.value = p.stage })
  await td.refreshConfig()
  limitInput.value = td.contextLimit
  await td.refreshEngine()
  await recheckEnv()
  await refreshList()
  await td.hydrate()
})

onUnmounted(() => { /* 监听器全局保留，切页不丢进度 */ })
</script>

<style scoped>
.td-page {
  padding: 16px 20px 20px;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.td-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 14px;
  flex-shrink: 0;
}

.page-sub { font-size: 11px; color: #9aa1ab; margin-top: 4px; }

.engine-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  padding: 5px 10px;
  border-radius: 20px;
  border: 1px solid #d8dbe0;
  color: #6b7280;
}
.engine-chip.ok { color: #10b981; border-color: rgba(16, 185, 129, 0.3); }
.engine-chip.bad { color: #ef4444; border-color: rgba(239, 68, 68, 0.3); }
.engine-chip .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

.warn-card { padding: 14px 16px; margin-bottom: 12px; border-color: rgba(239, 68, 68, 0.3); }
.warn-title { font-size: 13px; font-weight: 600; color: #ef4444; margin-bottom: 6px; }
.warn-body { font-size: 11px; color: #6b7280; line-height: 1.7; }
.warn-body code { background: #f4f5f7; padding: 1px 5px; border-radius: 4px; color: #f97316; }
.warn-path { color: #9aa1ab; margin-top: 4px; word-break: break-all; }

.td-grid {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: 12px;
  flex: 1;
  min-height: 0;
}

.td-col { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.td-col.right { overflow: hidden; }
.td-col:not(.right) { overflow-y: auto; }

/* 每张卡按自己的内容高度排，不要自动撑高 ——
   否则卡片多了以后第一张被压扁，内容会溢出叠到下一张上 */
.panel { padding: 14px; display: flex; flex-direction: column; flex: 0 0 auto; }
.panel-sub { font-size: 10px; color: #9aa1ab; }

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.panel-title { font-size: 12px; font-weight: 600; color: #374151; }

.link-btn {
  background: none;
  border: none;
  color: #f97316;
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
  flex-shrink: 0;
}
.link-btn:disabled { color: #9aa1ab; cursor: default; }

.rec-list { max-height: 190px; overflow-y: auto; margin: 0 -4px; }

.rec-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s ease;
}
.rec-item:hover { background: rgba(249, 115, 22, 0.05); }
.rec-item.active { background: rgba(249, 115, 22, 0.1); border-color: rgba(249, 115, 22, 0.3); }

.rec-main { flex: 1; min-width: 0; }
.rec-name {
  font-size: 12px;
  color: #374151;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rec-meta { font-size: 10px; color: #9aa1ab; margin-top: 2px; }
.rec-tag {
  font-size: 10px;
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: 10px;
  padding: 1px 6px;
  flex-shrink: 0;
}

.alt-row { display: flex; gap: 6px; margin-top: 10px; }
.alt-row :deep(.n-input) { flex: 1; }

.run-row { display: flex; align-items: center; gap: 10px; margin-bottom: 2px; }
.run-label { font-size: 11px; color: #6b7280; flex-shrink: 0; width: 62px; }
.model-hint { font-size: 10px; color: #9aa1ab; margin: 4px 0 12px 72px; }

.run-actions { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
.stage-text { font-size: 11px; color: #f97316; display: inline-flex; align-items: center; gap: 6px; }
.stage-text.done { color: #10b981; }

.spinner {
  width: 10px;
  height: 10px;
  border: 2px solid rgba(249, 115, 22, 0.3);
  border-top-color: #f97316;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.err-text {
  font-size: 11px;
  color: #ef4444;
  margin-top: 8px;
  line-height: 1.6;
  word-break: break-all;
}

.empty-line {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #9aa1ab;
  padding: 20px;
  text-align: center;
}

.tabs {
  display: flex;
  gap: 4px;
  padding: 12px 14px 0;
  background: var(--surface-2);
  border-bottom: 1px solid #e6e8ec;
  flex-shrink: 0;
}

.tab {
  background: none;
  border: none;
  color: #6b7280;
  font-size: 12px;
  padding: 8px 12px;
  cursor: pointer;
  font-family: inherit;
  border-bottom: 2px solid transparent;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.tab.active { color: #f97316; border-bottom-color: #f97316; font-weight: 600; }
.tab-dot { width: 6px; height: 6px; border-radius: 50%; background: #10b981; }
.tab-badge {
  font-size: 10px;
  background: rgba(249, 115, 22, 0.18);
  color: #f97316;
  border-radius: 8px;
  padding: 0 5px;
  line-height: 15px;
}

.log-wrap { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.log {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: 12px 14px;
  font-family: var(--font-num);
  font-size: 11px;
  line-height: 1.7;
  color: var(--ink-2);
  white-space: pre-wrap;
  word-break: break-all;
}

.packet-wrap { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.packet-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid #e6e8ec;
  flex-shrink: 0;
}
.packet-meta { font-size: 10px; color: #9aa1ab; margin-left: auto; }

.packet {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: 14px;
  font-family: var(--font);
  font-size: 11px;
  line-height: 1.8;
  color: var(--ink-2);
  white-space: pre-wrap;
  word-break: break-all;
}

.split-wrap { flex: 1; min-height: 0; display: flex; flex-direction: column; }

.split-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid #e6e8ec;
  flex-shrink: 0;
}

.split-badge {
  font-size: 10px;
  border-radius: 10px;
  padding: 2px 8px;
  flex-shrink: 0;
  border: 1px solid transparent;
}
.split-badge.warn { color: #f97316; background: rgba(249, 115, 22, 0.12); border-color: rgba(249, 115, 22, 0.3); }
.split-badge.ok { color: #10b981; background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.25); }

.split-note {
  font-size: 10px;
  color: #6b7280;
  flex: 1;
  min-width: 0;
}

.part-list {
  max-height: 176px;
  overflow-y: auto;
  padding: 6px 8px;
  border-bottom: 1px solid #e6e8ec;
  flex-shrink: 0;
}

.part-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 11px;
  border: 1px solid transparent;
}
.part-item:hover { background: rgba(249, 115, 22, 0.05); }
.part-item.active { background: rgba(249, 115, 22, 0.1); border-color: rgba(249, 115, 22, 0.3); }

.part-idx { color: #6b7280; width: 34px; flex-shrink: 0; }
.part-range { color: #374151; flex: 1; min-width: 0; }
.part-tok { color: #9aa1ab; flex-shrink: 0; }

.batch-box { margin-top: 12px; padding-top: 12px; border-top: 1px solid #e6e8ec; }
.batch-head { font-size: 11px; color: #6b7280; margin-bottom: 8px; }
.batch-actions { display: flex; gap: 6px; }
.batch-status { font-size: 10px; color: #f97316; margin-top: 8px; line-height: 1.6; }
.batch-status.muted { color: #9aa1ab; }
.batch-list { max-height: 260px; }
.batch-item { cursor: default; }
.batch-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.batch-dot.ok { background: #10b981; }
.batch-dot.bad { background: #ef4444; }
.batch-dot.busy { background: #f97316; }
.batch-dot.idle { background: #9aa1ab; }
.batch-item .part-tok { max-width: 46%; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.pick-row { display: flex; gap: 8px; margin-top: 10px; }
.pick-hint { font-size: 10px; color: #9aa1ab; line-height: 1.7; margin: 8px 0; }

/* 把视频拖进窗口时的提示框 */
.td-page.drag-over::after {
  content: '把视频拖到这里松手，就能拆';
  position: fixed;
  inset: 8px;
  border: 2px dashed #f97316;
  border-radius: 12px;
  background: rgba(249, 115, 22, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #f97316;
  font-size: 14px;
  pointer-events: none;
  z-index: 40;
}

/* ---------------- 环境状态条 ---------------- */
.env-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid #e6e8ec;
  background: #ffffff;
  margin-bottom: 10px;
  flex-shrink: 0;
}
.env-bar.ok { border-color: rgba(16, 185, 129, 0.3); }
.env-bar.warn { border-color: rgba(249, 115, 22, 0.35); }
.env-bar.bad { border-color: rgba(239, 68, 68, 0.45); background: rgba(239, 68, 68, 0.06); }
.env-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.env-bar.ok .env-dot { background: #10b981; }
.env-bar.warn .env-dot { background: #f97316; }
.env-bar.bad .env-dot { background: #ef4444; }
.env-summary { font-size: 12px; color: #374151; flex-shrink: 0; }
.env-chips { display: flex; gap: 6px; flex: 1; min-width: 0; overflow: hidden; }
.env-chip {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 10px;
  border: 1px solid #d8dbe0;
  color: #6b7280;
  white-space: nowrap;
}
.env-chip.ok { color: #10b981; border-color: rgba(16, 185, 129, 0.25); }
.env-chip.warn { color: #f97316; border-color: rgba(249, 115, 22, 0.3); }
.env-chip.bad { color: #ef4444; border-color: rgba(239, 68, 68, 0.35); background: rgba(239, 68, 68, 0.08); }

.env-detail { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; flex-shrink: 0; }
.env-problem { padding: 8px 12px; border-radius: 8px; font-size: 11px; line-height: 1.7; background: #ffffff; border-left: 3px solid #f97316; }
.env-problem.bad { border-left-color: #ef4444; background: rgba(239, 68, 68, 0.07); }
.env-problem-title { color: #1f2328; font-weight: 600; margin-right: 6px; }
.env-problem-detail { color: #6b7280; }
.env-problem-fix { color: #f97316; margin-top: 4px; }

/* ---------------- 顶部实时信号栏（本页的视觉主角） ---------------- */
.rail {
  display: flex;
  align-items: center;
  gap: 18px;
  height: var(--rail-h);
  padding: 0 18px;
  border-radius: var(--r-lg);
  background: linear-gradient(120deg, #fffdfb 0%, var(--surface) 42%, #f6fbff 100%);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-panel);
  margin-bottom: 12px;
  flex-shrink: 0;
}
.rail.warn { border-color: rgba(255, 106, 26, 0.35); }
.rail.bad { border-color: rgba(240, 68, 56, 0.45); }

.live { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.live-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 0 0 rgba(18, 183, 106, 0.45);
  animation: live-pulse 2.2s ease-out infinite;
}
.rail.warn .live-dot { background: var(--warn); }
.rail.bad .live-dot { background: var(--bad); }
@keyframes live-pulse {
  0% { box-shadow: 0 0 0 0 rgba(18, 183, 106, 0.45); }
  70% { box-shadow: 0 0 0 9px rgba(18, 183, 106, 0); }
  100% { box-shadow: 0 0 0 0 rgba(18, 183, 106, 0); }
}
.live-text { font-size: 12px; color: var(--ink-2); font-weight: 600; letter-spacing: 0.4px; }

.stat { display: flex; align-items: baseline; gap: 6px; }
.stat-num { font-size: 24px; font-weight: 700; color: var(--ink); line-height: 1; }
.stat-label { font-size: 10px; color: var(--ink-4); }

.rail-divider { width: 1px; height: 24px; background: var(--line); flex-shrink: 0; }
.rail-summary { font-size: 12px; color: var(--ink-2); flex-shrink: 0; }
.rail-chips { display: flex; gap: 6px; flex: 1; min-width: 0; overflow: hidden; }
.rail-chip {
  font-size: 10px;
  padding: 3px 9px;
  border-radius: 20px;
  border: 1px solid var(--line);
  color: var(--ink-3);
  background: var(--surface-2);
  white-space: nowrap;
}
.rail-chip.ok { color: var(--ok); border-color: rgba(18, 183, 106, 0.25); background: rgba(18, 183, 106, 0.06); }
.rail-chip.warn { color: var(--brand); border-color: rgba(255, 106, 26, 0.3); background: var(--brand-soft); }
.rail-chip.bad { color: var(--bad); border-color: rgba(240, 68, 56, 0.35); background: rgba(240, 68, 56, 0.07); }

/* 尊重系统的“减少动画”设置 */

/* ---------------- 左栏：三个步骤，按角色分开 ----------------
   区域一（选素材）= 主区域：白底 + 投影，最重
   区域二、三（参数设置）= 浅底 + 无投影，一眼看出是“参数”不是“内容”
   这样三块各自有身份，不会读成一堆同样的卡片 */
.zone {
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-panel);
  flex: 0 0 auto;
}
.zone:not(:first-child) {
  background: var(--surface-2);
  box-shadow: none;
}

.zone-head {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 12px;
}
.zone-num {
  width: 22px;
  height: 22px;
  border-radius: 7px;
  background: var(--brand-soft);
  color: var(--brand);
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
/* 对比区域用信号青，和“实时/分析”这条线呼应 */
.compare-zone .zone-num { background: rgba(0, 180, 216, 0.12); color: var(--signal); }
.zone-title { font-size: 13px; font-weight: 700; color: var(--ink); letter-spacing: 0.2px; }
.zone-hint { font-size: 10px; color: var(--ink-4); }
.zone-head .link-btn { margin-left: auto; }

/* ---------------- 右栏：工作区，比左栏高一层 ---------------- */
.workspace {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-panel);
  overflow: hidden;
}
/* 顶边一条橙→青的细线：一看到就知道这里是“出结果的地方” */
.workspace::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, var(--brand), var(--signal));
}
.workspace .tabs { margin-top: 2px; }
@media (prefers-reduced-motion: reduce) {
  .live-dot { animation: none; }
}

/* 页签自带操作区 */
.tab-tools { padding: 10px 14px; border-bottom: 1px solid #e6e8ec; flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; }
.tab-tools-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tab-tools .model-hint { margin: 0; }

/* 窗口窄的时候把右栏放到下面，避免被挤到看不见 */
@media (max-width: 1000px) {
  .td-grid { grid-template-columns: 1fr; }
  .td-col.right { min-height: 300px; }
}
</style>
