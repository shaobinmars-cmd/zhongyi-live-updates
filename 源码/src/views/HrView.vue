<template>
  <div class="hr">
    <header class="hr-head">
      <div class="hr-title">
        人事 · 新人跟踪
        <span class="hr-sub">只做三件事：录入新人 → 分给运营 → 自动看离职率</span>
      </div>
      <div class="hr-actions">
        <n-button size="small" type="primary" ghost @click="openAdd">+ 手工录入新人</n-button>
        <n-select v-model:value="month" size="small" :options="monthOptions" style="width: 130px" @update:value="load" />
        <n-button size="small" @click="load">刷新</n-button>
        <n-button size="small" @click="exportCsv">导出数据</n-button>
        <n-button size="small" type="primary" @click="openImport">批量导入新人表</n-button>
      </div>
    </header>

    <!-- 自动指标：全部现算 -->
    <section class="metrics">
      <div class="metric">
        <div class="m-label">在职主播</div>
        <div class="m-value">{{ data?.onHand ?? '—' }}</div>
        <div class="m-hint">
          {{ data?.missingJoinDate ? `${data.missingJoinDate} 人还没填入司日期` : '档案齐全' }}
        </div>
      </div>
      <div class="metric">
        <div class="m-label">本月入职</div>
        <div class="m-value">{{ data?.joinedThisMonth ?? '—' }}</div>
        <div class="m-hint">{{ data?.month || '' }}</div>
      </div>
      <div class="metric">
        <div class="m-label">本月离职</div>
        <div class="m-value">{{ data?.leftThisMonth ?? '—' }}</div>
        <div class="m-hint">按离司日期统计</div>
      </div>
      <div class="metric strong">
        <div class="m-label">本月离职率</div>
        <div class="m-value">{{ data?.leaveRate ?? '—' }}<i>%</i></div>
        <div class="m-hint">离职 ÷（上月末在职 + 本月入职）</div>
      </div>
      <div class="metric">
        <div class="m-label">新人 60 天留存</div>
        <div class="m-value">{{ data?.retain60Rate ?? '—' }}<i>%</i></div>
        <div class="m-hint">观察窗足够的有 {{ data?.retain60Base ?? 0 }} 人</div>
      </div>
    </section>

    <!-- 新人跟踪：入职 60 天内的人 -->
    <section class="panel">
      <div class="panel-head">
        <b>入职 60 天内</b>
        <span class="hint">带教运营和赛道改完就生效，运营那边的孵化课表会同步跟着变；没有入司日期的不在这里出现</span>
      </div>
      <n-data-table
        :columns="joinerColumns"
        :data="data?.newJoiners || []"
        size="small"
        :bordered="false"
        max-height="calc(100vh - 430px)"
        :loading="loading"
      />
    </section>

    <!-- 按运营汇总 + 近三个月总体趋势 -->
    <section class="bottom">
      <div class="panel">
        <div class="panel-head"><b>各运营在手与流失</b><span class="hint">本月口径</span></div>
        <n-data-table :columns="opColumns" :data="data?.byOperator || []" size="small" :bordered="false" />
      </div>
      <div class="panel">
        <div class="panel-head"><b>近三个月总体趋势</b><span class="hint">入职 / 离职 / 期末在职</span></div>
        <div class="trend">
          <div v-for="m in trend3" :key="m.month" class="trend-col">
            <div class="trend-month">{{ m.month.slice(5) }} 月</div>
            <div class="bars">
              <div class="bar join" :style="{ height: barH(m.joined) + 'px' }" :title="'入职 ' + m.joined"></div>
              <div class="bar left" :style="{ height: barH(m.left) + 'px' }" :title="'离职 ' + m.left"></div>
            </div>
            <div class="trend-num">{{ m.onHandEnd }} 在 / {{ m.leaveRate }}%</div>
          </div>
        </div>
      </div>
    </section>

    <!-- 每个运营每个月的趋势 -->
    <section class="panel">
      <div class="panel-head">
        <b>每个运营 · 逐月趋势</b>
        <span class="hint">近三个月：入职 / 离职 / 离职率，括号为月末在职</span>
      </div>
      <n-data-table :columns="opMonthColumns" :data="data?.byOperatorMonthly || []" size="small" :bordered="false" />
    </section>

    <!-- 手工录入 -->
    <n-modal v-model:show="showAdd" preset="card" title="手工录一个新人" style="width: 460px">
      <div class="form">
        <div class="row"><span>主播姓名</span><n-input v-model:value="addForm.name" size="small" placeholder="必填" /></div>
        <div class="row"><span>带教运营</span><n-input v-model:value="addForm.operator" size="small" placeholder="运营名字，直接打字即可（新运营也能填）" /></div>
        <div class="row"><span>联系方式</span><n-input v-model:value="addForm.contact" size="small" placeholder="微信 / 电话，可空" /></div>
        <div class="row"><span>赛道</span><n-select v-model:value="addForm.track" size="small" :options="trackOptions" /></div>
        <div class="row"><span>入司日期</span><n-input v-model:value="addForm.joinDate" size="small" placeholder="2026-10-20" /></div>
        <div class="row"><span>开播日期</span><n-input v-model:value="addForm.firstLive" size="small" placeholder="首播日期，还没播就留空" /></div>
      </div>
      <template #footer>
        <div class="modal-footer">
          <n-button size="small" @click="showAdd = false">取消</n-button>
          <n-button size="small" type="primary" :loading="busy" @click="submitAdd">录入</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 批量导入：选文件 → 列映射 → 导入 -->
    <n-modal v-model:show="showImport" preset="card" title="批量导入新人表" style="width: 880px">
      <div v-if="!preview" class="import-empty">
        <div class="hint">支持 .xlsx / .xlsm / .csv / .tsv / .txt：飞书多维表格「导出为 Excel / CSV」后直接选这个文件即可（老版 .xls 请先另存为 .xlsx）</div>
        <n-button size="small" type="primary" @click="pickSheet">选择表格文件</n-button>
      </div>

      <div v-else class="import-body">
        <div class="import-top">
          <b>{{ preview.source }}</b>
          <span class="hint">读到 {{ preview.total }} 行数据，下面只预览前 30 行</span>
          <n-button size="tiny" @click="pickSheet">换一个文件</n-button>
        </div>

        <div class="mapping">
          <div v-for="f in fields" :key="f.key" class="map-row">
            <span class="map-label" :class="{ req: f.required }">{{ f.label }}</span>
            <n-select v-model:value="mapping[f.key]" size="tiny" :options="columnOptions" :placeholder="f.required ? '必须选一列' : '不用就留空'" clearable />
          </div>
          <div class="map-row">
            <span class="map-label">默认运营</span>
            <n-input v-model:value="defaultOperator" size="tiny" placeholder="表里没写运营时用这个（新运营直接打字）" />
          </div>
          <div class="map-row">
            <span class="map-label">默认赛道</span>
            <n-select v-model:value="defaultTrack" size="tiny" :options="trackOptions" />
          </div>
        </div>

        <n-data-table :columns="previewColumns" :data="previewRows" size="small" :bordered="false" max-height="260px" :scroll-x="900" />
        <div class="hint">同名视为同一个人，只补空字段，不会覆盖运营已经改过的内容。</div>
      </div>

      <template #footer>
        <div class="modal-footer">
          <span v-if="importResult" class="hint result">
            导入完成：新增 {{ importResult.added }}，更新 {{ importResult.updated }}，跳过 {{ importResult.skipped }}
          </span>
          <div class="spacer" />
          <n-button size="small" @click="showImport = false">关闭</n-button>
          <n-button size="small" type="primary" :disabled="!preview || mapping['主播'] == null" :loading="busy" @click="submitImport">开始导入</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref, type VNode } from 'vue'
import {
  NButton, NDataTable, NInput, NModal, NSelect, useMessage,
  type DataTableColumns, type SelectOption
} from 'naive-ui'

const api = () => (window as any).electronAPI
const msg = useMessage()

const loading = ref(false)
const busy = ref(false)
const data = ref<any>(null)
const month = ref('')
const tracks = ref<string[]>([])

const showAdd = ref(false)
const showImport = ref(false)
const importResult = ref<any>(null)

const preview = ref<any>(null)
const filePath = ref('')
const mapping = ref<Record<string, number | null>>({})
const defaultOperator = ref<string | null>(null)
const defaultTrack = ref<string | null>(null)

const fields = [
  { key: '主播', label: '主播姓名', required: true },
  { key: '带教运营', label: '带教运营', required: false },
  { key: '联系方式', label: '联系方式', required: false },
  { key: '赛道', label: '赛道', required: false },
  { key: '入司日期', label: '入司日期', required: false },
  { key: '首播日期', label: '开播日期（首播）', required: false }
]

function pad2(n: number) { return String(n).padStart(2, '0') }
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

const monthOptions = computed<SelectOption[]>(() => {
  const out: SelectOption[] = []
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const v = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
    out.push({ label: v, value: v })
  }
  return out
})

const operatorOptions = computed<SelectOption[]>(() =>
  (data.value?.operators || []).map((o: string) => ({ label: o, value: o }))
)
const trackOptions = computed<SelectOption[]>(() => tracks.value.map((t) => ({ label: t, value: t })))
const columnOptions = computed<SelectOption[]>(() =>
  (preview.value?.headers || []).map((h: string, i: number) => ({ label: `${i + 1}. ${h}`, value: i }))
)

/** 近三个月总体趋势（后端给 6 个月，这里只看最近 3 个） */
const trend3 = computed(() => (data.value?.trend || []).slice(-3))

/** 趋势柱：把最大数压到 42px 高，只为看相对关系 */
const trendMax = computed(() => {
  const t = trend3.value
  return Math.max(1, ...t.map((m: any) => Math.max(m.joined, m.left)))
})
function barH(v: number) { return v > 0 ? Math.max(3, Math.round((v / trendMax.value) * 42)) : 0 }

/** 每个运营逐月趋势表：列随近三个月动态生成 */
const opMonthColumns = computed<DataTableColumns<any>>(() => {
  const months: string[] = trend3.value.map((m: any) => m.month)
  const cols: DataTableColumns<any> = [{ title: '运营', key: 'operator', width: 110 }]
  months.forEach((mm, i) => {
    cols.push({
      title: `${mm.slice(5)} 月`,
      key: mm,
      minWidth: 170,
      render: (r: any) => {
        const s = r.stats?.[i]
        if (!s) return '—'
        return h('span', { class: 'op-month-cell' }, [
          h('span', { class: 'ok-text' }, `入 ${s.joined}`),
          h('span', { class: 'bad-text' }, `离 ${s.left}`),
          h('span', { class: 'muted' }, `${s.leaveRate}%（在 ${s.onHandEnd}）`)
        ])
      }
    })
  })
  return cols
})

const previewRows = computed(() =>
  (preview.value?.rows || []).map((r: string[], i: number) => {
    const o: any = { _i: i + 1 }
    ;(preview.value?.headers || []).forEach((h: string, j: number) => { o[h] = r[j] ?? '' })
    return o
  })
)
const previewColumns = computed<DataTableColumns<any>>(() => {
  const head: DataTableColumns<any> = [{ title: '#', key: '_i', width: 44 }]
  for (const h of (preview.value?.headers || [])) head.push({ title: h, key: h, width: 130, ellipsis: { tooltip: true } })
  return head
})

async function load() {
  loading.value = true
  try {
    data.value = await api().hrOverview(month.value || undefined)
    if (!month.value && data.value?.month) month.value = data.value.month
  } catch (e: any) {
    msg.error('读取人事数据失败：' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function loadTracks() {
  try {
    const r = await api().incubateTracks()
    tracks.value = Object.keys(r?.tracks || {})
    defaultTrack.value = r?.defaultTrack || null
  } catch { /* 读不到就只留空选项，不影响其它功能 */ }
}

// 导出人事数据：花名册（主播学籍全表）+ 各运营月度趋势，打包成一个 CSV 下载
function csvCell(v: any) { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
async function exportCsv() {
  try {
    const roster = await api().incubateList('主播学籍')
    const lines: string[] = []
    lines.push('【花名册】')
    const cols = ['主播', '带教运营', '赛道', '联系方式', '入司日期', '首播日期', '离司日期', '是否正常开播', '配合意愿']
    lines.push(cols.join(','))
    for (const r of roster) lines.push(cols.map((c) => csvCell(r[c])).join(','))
    const trend = data.value?.byOperatorMonthly || []
    if (trend.length) {
      lines.push('', '【各运营月度趋势】')
      const tcols = Object.keys(trend[0])
      lines.push(tcols.join(','))
      for (const r of trend) lines.push(tcols.map((c) => csvCell(r[c])).join(','))
    }
    // 带 BOM，Excel 打开不乱码
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `人事数据_${month.value || '全部'}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    msg.success('已导出人事数据 CSV')
  } catch (e: any) {
    msg.error('导出失败：' + (e?.message || e))
  }
}

async function assign(row: any, patch: any) {
  try {
    await api().incubateUpdateStreamer(row.主播, patch)
    await load()
  } catch (e: any) {
    msg.error('修改失败：' + (e?.message || e))
  }
}

async function depart(row: any) {
  try {
    const r = await api().incubateDepartStreamer(row.主播, todayStr())
    msg.success(`${row.主播} 已按 ${r?.date || todayStr()} 记离司`)
    await load()
  } catch (e: any) {
    msg.error('记录离司失败：' + (e?.message || e))
  }
}

async function restore(row: any) {
  try {
    await api().incubateRestoreStreamer(row.主播)
    msg.success(`${row.主播} 已恢复在职`)
    await load()
  } catch (e: any) {
    msg.error('恢复失败：' + (e?.message || e))
  }
}

const joinerColumns = computed<DataTableColumns<any>>(() => [
  { title: '主播', key: '主播', width: 104, ellipsis: { tooltip: true } },
  {
    title: '带教运营', key: '带教运营', width: 118,
    render: (r) => h(NSelect, {
      value: r.带教运营 || null, options: operatorOptions.value, size: 'tiny', filterable: true, tag: true,
      placeholder: '未分配', style: 'width: 108px',
      'onUpdate:value': (v: string) => assign(r, { operator: v || '' })
    })
  },
  {
    title: '赛道', key: '赛道', width: 118,
    render: (r) => h(NSelect, {
      value: r.赛道 || null, options: trackOptions.value, size: 'tiny', style: 'width: 108px',
      'onUpdate:value': (v: string) => assign(r, { track: v || '' })
    })
  },
  { title: '入司', key: '入司日期', width: 104 },
  { title: '入职第几天', key: 'days', width: 92, render: (r) => `第 ${r.days} 天` },
  { title: '首播', key: '首播日期', width: 104, render: (r) => r.首播日期 || '未开播' },
  {
    title: '状态', key: '状态', width: 88,
    render: (r) => h('span', { class: ['pill', r.状态 === '已离司' ? 'bad' : r.状态 === '待开播' ? 'warn' : 'ok'] }, r.状态)
  },
  {
    title: '操作', key: 'act', width: 92,
    render: (r): VNode => r.状态 === '已离司'
      ? h(NButton, { size: 'tiny', quaternary: true, type: 'primary', onClick: () => restore(r) }, { default: () => '恢复在职' })
      : h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => depart(r) }, { default: () => '记离司' })
  }
])

const opColumns: DataTableColumns<any> = [
  { title: '运营', key: 'operator', width: 120 },
  { title: '在手主播', key: 'onHand', width: 100 },
  { title: '本月入职', key: 'joined', width: 100 },
  { title: '本月离职', key: 'left', width: 100 },
  { title: '离职率', key: 'leaveRate', render: (r) => `${r.leaveRate}%` }
]

const addForm = ref({ name: '', operator: '', contact: '', track: '', joinDate: todayStr(), firstLive: '' })

function openAdd() {
  addForm.value = {
    name: '',
    operator: defaultOperator.value || '',
    contact: '',
    track: defaultTrack.value || '',
    joinDate: todayStr(),
    firstLive: ''
  }
  showAdd.value = true
}

async function submitAdd() {
  if (!addForm.value.name.trim()) { msg.warning('请先填主播姓名'); return }
  busy.value = true
  try {
    const r = await api().hrAddOne(addForm.value)
    msg.success(`已录入：新增 ${r.added}，更新 ${r.updated}`)
    showAdd.value = false
    await load()
  } catch (e: any) {
    msg.error('录入失败：' + (e?.message || e))
  } finally {
    busy.value = false
  }
}

function openImport() {
  preview.value = null
  filePath.value = ''
  importResult.value = null
  mapping.value = {}
  showImport.value = true
}

/** 表头里认得出就自动选上，认不出就留空让人事自己点 */
function guess(headers: string[], words: string[]): number | null {
  for (let i = 0; i < headers.length; i++) {
    if (words.some((w) => headers[i].includes(w))) return i
  }
  return null
}

async function pickSheet() {
  try {
    const p = await api().hrPickSheet()
    if (!p) return
    const pv = await api().hrSheetPreview(p)
    filePath.value = p
    preview.value = pv
    importResult.value = null
    const hs: string[] = pv.headers || []
    mapping.value = {
      主播: guess(hs, ['主播', '姓名', '名字', '昵称', '艺名']),
      带教运营: guess(hs, ['运营', '带教', '归属']),
      联系方式: guess(hs, ['联系', '电话', '微信', '手机']),
      赛道: guess(hs, ['赛道', '方向', '类型', '品类']),
      入司日期: guess(hs, ['入司', '入职', '到岗', '加入']),
      首播日期: guess(hs, ['首播', '开播', '首场'])
    }
  } catch (e: any) {
    msg.error('读表失败：' + (e?.message || e))
  }
}

async function submitImport() {
  if (!filePath.value) return
  busy.value = true
  try {
    const map: Record<string, number> = {}
    for (const f of fields) {
      const v = mapping.value[f.key]
      if (v != null) map[f.key] = v
    }
    importResult.value = await api().hrImportApply(filePath.value, map, {
      operator: defaultOperator.value || '',
      track: defaultTrack.value || ''
    })
    msg.success(`导入完成：新增 ${importResult.value.added}，更新 ${importResult.value.updated}`)
    await load()
  } catch (e: any) {
    msg.error('导入失败：' + (e?.message || e))
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await loadTracks()
  await load()
})
</script>

<style scoped>
.hr {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px 16px;
  overflow: auto;
  height: 100%;
}

.hr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.hr-title {
  font-size: var(--fs-h1);
  font-weight: 700;
  color: var(--ink);
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.hr-sub {
  font-size: var(--fs-meta);
  font-weight: 400;
  color: var(--ink-4);
}

.hr-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
}

.metric {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: 12px 14px;
  box-shadow: var(--shadow-panel);
}

.metric.strong {
  border-color: var(--pulse-accent);
  background: linear-gradient(180deg, rgba(11, 118, 190, 0.06), transparent);
}

.m-label {
  font-size: var(--fs-meta);
  color: var(--ink-4);
}

.m-value {
  font-family: var(--font-num);
  font-size: 26px;
  font-weight: 700;
  color: var(--ink);
  line-height: 1.2;
  margin: 4px 0 2px;
}

.metric.strong .m-value {
  color: var(--pulse-deep);
}

.m-value i {
  font-size: 14px;
  font-style: normal;
  margin-left: 2px;
}

.m-hint {
  font-size: var(--fs-micro);
  color: var(--ink-4);
}

.panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: 12px 14px;
  box-shadow: var(--shadow-panel);
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.panel-head b {
  font-size: var(--fs-h3);
  color: var(--ink);
}

.hint {
  font-size: var(--fs-micro);
  color: var(--ink-4);
}

.bottom {
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: 12px;
}

.trend {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  align-items: end;
}

.op-month-cell {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  font-family: var(--font-num);
}

.ok-text { color: var(--ok); }
.bad-text { color: var(--bad); }

.trend-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.trend-month {
  font-size: var(--fs-micro);
  color: var(--ink-3);
}

.bars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 44px;
}

.bar {
  width: 12px;
  border-radius: 3px 3px 0 0;
}

.bar.join {
  background: var(--pulse-accent);
}

.bar.left {
  background: var(--bad);
}

.trend-num {
  font-size: var(--fs-micro);
  color: var(--ink-4);
  font-family: var(--font-num);
}

.pill {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: var(--fs-micro);
  border: 1px solid var(--line-2);
  color: var(--ink-3);
}

.pill.ok { border-color: var(--ok); color: var(--ok); }
.pill.warn { border-color: var(--warn); color: var(--warn); }
.pill.bad { border-color: var(--bad); color: var(--bad); }

.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form .row {
  display: grid;
  grid-template-columns: 88px 1fr;
  align-items: center;
  gap: 10px;
}

.form .row span {
  font-size: var(--fs-meta);
  color: var(--ink-3);
}

.modal-footer {
  display: flex;
  align-items: center;
  gap: 10px;
}

.modal-footer .spacer { flex: 1; }
.result { color: var(--ok); }

.import-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px 0;
}

.import-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.import-top {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mapping {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px 14px;
  padding: 10px 12px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
}

.map-row {
  display: grid;
  grid-template-columns: 78px 1fr;
  align-items: center;
  gap: 8px;
}

.map-label {
  font-size: var(--fs-meta);
  color: var(--ink-3);
}

.map-label.req::after {
  content: '*';
  color: var(--bad);
  margin-left: 2px;
}
</style>
