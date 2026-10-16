<template>
  <div class="inc-page">
    <div class="inc-header">
      <div>
        <h2 class="inc-title">孵化</h2>
        <div class="inc-subtitle">选主播 → 打五个分（+空档、收尾）→ 保存。通用能力项，任何赛道都这么填。</div>
      </div>
      <n-button size="small" @click="store.openDataDir()">打开数据目录</n-button>
    </div>

    <n-tabs v-model:value="tab" type="line" animated>
      <!-- ① 主播 -->
      <n-tab-pane name="streamer" tab="主播">
        <div class="picker">
          <n-input v-model:value="opFilter" size="small" placeholder="你的名字（带教运营）" style="width: 170px" @update:value="saveOpFilter" />
          <span class="switch-wrap">
            <n-switch v-model:value="onlyMine" size="small" @update:value="saveOnlyMine" />
            <span class="hint">只看我带的主播</span>
          </span>
          <n-select
            v-model:value="current"
            filterable
            clearable
            placeholder="输入名字搜索，或下拉选择主播"
            :options="streamerOptions"
            style="width: 300px"
            @update:value="(v: any) => onPick(v, true)"
          />
          <n-button size="small" @click="showImport = true">批量粘贴名单</n-button>
          <span class="hint">共 {{ filteredStreamers.length }} 个 · ↑↓ 切换（PgUp/PgDn 跳 10 个）· 回车开始填</span>
        </div>

        <div class="groups">
          <div v-for="g in groupChips" :key="g.key" class="chip" :class="[g.cls, { active: statusFilter === g.key }]" @click="toggleGroup(g.key)">
            <b>{{ g.count }}</b><span>{{ g.label }}</span>
          </div>
          <n-button v-if="statusFilter !== 'all'" size="tiny" quaternary @click="statusFilter = 'all'">显示全部</n-button>
        </div>
        <div v-if="statusFilter === 'today'" class="hint" style="margin: -2px 0 6px">
          正在看"今天还没填"的主播：填完保存后会自动从这个列表消失，接着下一个。
        </div>

        <div v-if="needAttention.length" class="watch">
          <span class="hint">今天该盯：</span>
          <n-button v-for="w in needAttention" :key="w.name" size="tiny" quaternary @click="pick(w.name)">
            {{ w.name }} <span :class="'dot ' + w.level">· {{ w.text }}</span>
          </n-button>
        </div>

        <div v-if="recent.length" class="recent">
          <span class="hint">最近：</span>
          <n-button v-for="r in recent" :key="r" size="tiny" quaternary @click="pick(r)">{{ r }}</n-button>
        </div>

        <div v-if="streamerNames.length === 0" class="empty">
          还没有主播 —— 点上面的「批量粘贴名单」，一行一个把主播加进来（也可以写 <code>主播名,运营名</code> 指定带教）。
        </div>
        <div v-else-if="!current" class="empty">先选一个主播 —— 30 个主播用上面的搜索框，打两个字就能定位；也可以 ↑↓ 直接翻。</div>

        <template v-else>
          <div class="card">
            <div class="card-head">
              <div class="who">
                <b>{{ current }}</b>
                <span class="tag" :class="verdictClass">{{ verdictText }}</span>
                <span class="hint">{{ operatorOf(current) ? '带教：' + operatorOf(current) : '' }}</span>
                <span class="hint">｜ 赛道</span>
                <n-select v-model:value="curTrack" :options="trackOptions" size="tiny" style="width: 140px" @update:value="changeTrack" />
                <span v-if="lastDate" class="hint">｜ 上次记录：{{ lastDate }}{{ lastIsToday ? '' : '（今天还没记）' }}</span>
              </div>
              <div class="hint">已录 {{ rowsOfCurrent.length }} 场<span v-if="lastAsset"> ｜ 最近在练：{{ lastAsset }}</span></div>
            </div>

            <!-- 通用能力五项 + 客观项 -->
            <div class="metrics">
              <div v-for="d in store.common" :key="d.key" class="metric">
                <span class="mlabel">{{ d.label }}</span>
                <n-select
                  v-if="d.kind === 'rate'"
                  v-model:value="values[d.key]"
                  size="small"
                  clearable
                  :placeholder="'选 1–5'"
                  :options="rateOptions(d.hint)"
                />
                <n-select
                  v-else-if="d.kind === 'bool'"
                  v-model:value="values[d.key]"
                  size="small"
                  clearable
                  placeholder="是/否"
                  :options="yesNo"
                />
                <n-input v-else v-model:value="values[d.key]" size="small" :placeholder="d.hint" />
              </div>
            </div>

            <!-- 赛道加测（可选） -->
            <div v-if="extras.length" class="extras">
              <n-button size="tiny" quaternary @click="showExtras = !showExtras">
                {{ showExtras ? '收起' : '展开' }}赛道加测项（{{ curTrack }}，可选）
              </n-button>
              <div v-if="showExtras" class="metrics" style="margin-top: 8px">
                <div v-for="d in extras" :key="d.key" class="metric">
                  <span class="mlabel">{{ d.label }}</span>
                  <n-select v-if="d.kind === 'bool'" v-model:value="values[d.key]" size="small" clearable placeholder="是/否" :options="yesNo" />
                  <n-input v-else v-model:value="values[d.key]" size="small" :placeholder="d.hint" />
                </div>
              </div>
            </div>

            <div class="actions">
              <n-button type="primary" @click="save">保存这一场</n-button>
              <n-button :disabled="!lastSession" @click="copyLast">复制上一场</n-button>
              <span class="hint">打不准的可以留空：留空不算错，也不算达标。1–5 分的口径见下方。</span>
            </div>
          </div>

          <div class="bar"><b>最近记录</b><n-button size="tiny" @click="refresh">刷新</n-button></div>
          <n-data-table :columns="sessionColumns" :data="recentSessions" size="small" :bordered="false" max-height="calc(100vh - 620px)" />

          <div class="rule">
            <div v-for="d in store.common" :key="d.key"><b>{{ d.label }}</b>：{{ d.hint }}</div>
          </div>
        </template>
      </n-tab-pane>

      <!-- ② 运营考核 -->
      <n-tab-pane name="score" tab="运营考核">
        <div class="bar">
          <n-input v-model:value="month" size="small" placeholder="月份，如 2026-10" style="width: 150px" />
          <n-button type="primary" size="small" @click="calc">算分</n-button>
          <span class="hint">只算三项：主播成长 45% ｜ 每日按时提交 35% ｜ 学习 20%</span>
        </div>
        <n-data-table :columns="scoreColumns" :data="store.scoreRows" size="small" :bordered="false" max-height="calc(100vh - 420px)" />
        <div class="rule">
          <div><b>主播成长 45%</b>＝40% 现状（名下主播本月所有场次按赛道合格线的达标率）＋ 60% 变化（每个主播本月最后一场 vs 第一场的单场得分；提升 20 分算满分、退 20 分算 0 分）</div>
          <div><b>每日按时提交 35%</b>＝（当天交的场次 ＋ 事后补交 × 0.5）÷ 应交场次；应交＝名下主播数 × 4 场/月（一周一场的最低线，不看录像）；五个分都打才算一次提交</div>
          <div><b>学习 20%</b>＝课表（月目标 10 条）、资产贡献（2 条）、周复盘（4 次）三项平均</div>
          <div>抽查门禁：本月抽查合格率 &lt;70% → 总分 ×0.8（没抽查不罚）；结论：<b>≥80 达标</b> ｜ <b>60–79 待改进</b> ｜ <b>&lt;60 不合格</b></div>
        </div>
      </n-tab-pane>

      <!-- ③ 资产与课表 -->
      <n-tab-pane name="asset" tab="资产与课表">
        <div class="bar">
          <n-select v-model:value="viewTable" :options="viewOptions" size="small" style="width: 180px" @update:value="loadView" />
          <n-button size="small" @click="doImport">从拆解产物导入</n-button>
          <n-button size="small" @click="store.exportCsv()">导出 CSV</n-button>
          <n-button size="small" @click="store.exportXlsx()">导出 Excel</n-button>
          <span class="hint">{{ store.rows.length }} 行</span>
        </div>
        <div class="card">
          <div class="row">
            <span class="switch-wrap">
              <n-switch v-model:value="useV5" size="small" @update:value="saveUseV5" />
              <span class="hint">AI 报告用 v5 孵化版结构（框架 → 可复制资产 → 30 天清单）｜ 默认关闭</span>
            </span>
            <n-button size="tiny" @click="copyInstruction">复制 v5 指令</n-button>
            <span class="hint">关闭时：拆解页的 AI 分析维持原样。</span>
          </div>
        </div>
        <n-data-table :columns="assetColumns" :data="store.rows" size="small" :bordered="false" max-height="calc(100vh - 470px)" />
        <div class="rule">
          <div>点「从拆解产物导入」后：<b>选那一场的 work 目录</b>（会自动往下找报告），或者<b>直接选报告那个 md 文件</b>都行。</div>
          <div>两种报告都认：① v5 格式（带 <code>XD-XX-001</code> 资产表和 <code>| D1 | … |</code> 课表）；② 普通分析报告（把「<b>话术库</b>」里的表格抽成资产、把「<b>SOP</b>」清单抽成课表，编号自动生成）。</div>
          <div v-for="(l, i) in store.logs.slice(0, 6)" :key="i" class="log">{{ l }}</div>
        </div>
      </n-tab-pane>
    </n-tabs>

    <!-- 批量粘贴名单 -->
    <n-modal v-model:show="showImport" preset="card" style="width: 560px" title="批量粘贴主播名单">
      <div class="rule"><div>一行一个主播；要指定带教运营/赛道就写 <code>主播名,运营名,赛道</code>（赛道可省）。重名自动合并。</div></div>
      <n-input v-model:value="importOp" size="small" placeholder="默认带教运营（可留空）" style="margin: 10px 0" />
      <n-input v-model:value="importText" type="textarea" :rows="10" placeholder="张三&#10;李四,小A,唱歌点歌&#10;王五,小B" />
      <template #footer>
        <div class="actions" style="justify-content: flex-end">
          <n-button size="small" @click="showImport = false">取消</n-button>
          <n-button size="small" type="primary" @click="doImportStreamers">导入</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref, watch } from 'vue'
import { NButton, NDataTable, NInput, NModal, NSelect, NSwitch, NTabPane, NTabs, useMessage, type DataTableColumns, type SelectOption } from 'naive-ui'
import { useIncubateStore } from '../stores/incubate'

const store = useIncubateStore()
const msg = useMessage()

type Level = 'ok' | 'warn' | 'bad' | 'none'
type Filter = 'all' | Level | 'today'

const tab = ref('streamer')
const month = ref(new Date().toISOString().slice(0, 7))
const viewTable = ref('资产库')
const viewOptions = [
  { label: '资产库', value: '资产库' },
  { label: '本周课表', value: '课表' }
]
const yesNo: SelectOption[] = [
  { label: '是', value: '是' },
  { label: '否', value: '否' }
]

const current = ref('')
const curTrack = ref('下单游戏')
const values = ref<Record<string, string>>({})
const showExtras = ref(false)
const opFilter = ref(localStorage.getItem('inc_operator') || '')
const onlyMine = ref(localStorage.getItem('inc_only_mine') !== '0')
const statusFilter = ref<Filter>('all')
const recent = ref<string[]>(JSON.parse(localStorage.getItem('inc_recent') || '[]'))
const showImport = ref(false)
const importText = ref('')
const importOp = ref(localStorage.getItem('inc_operator') || '')
const useV5 = ref(false)
const today = new Date().toISOString().slice(0, 10)

/** 1–5 分下拉：把 hint 里的锚点直接当选项，四个运营打分才一致 */
function rateOptions(hint: string): SelectOption[] {
  return hint.split('｜').map((s) => {
    const t = s.trim()
    const n = t.slice(0, 1)
    return { label: t, value: n }
  })
}

const trackOptions = computed<SelectOption[]>(() => store.trackNames().map((t) => ({ label: t, value: t })))
const extras = computed(() => store.extraDefsOf(curTrack.value))

const streamerNames = computed(() => {
  const roster = store.streamers.map((s: any) => String(s['主播'] || '').trim()).filter(Boolean)
  const fromSessions = store.sessions.map((r: any) => String(r['主播'] || '').trim()).filter(Boolean)
  return Array.from(new Set([...roster, ...fromSessions])).sort()
})

function operatorOf(name: string): string {
  const s = store.streamers.find((x: any) => String(x['主播'] || '').trim() === name)
  return s ? String(s['带教运营'] || '').trim() : ''
}

function statusOf(name: string): { level: Level; text: string; last: string; fails: string[] } {
  const list = store.sessionsOf(name)
  if (!list.length) return { level: 'none', text: '暂无记录', last: '', fails: [] }
  const last = list[list.length - 1]
  const track = String(last['赛道'] || '').trim() || store.trackOf(name)
  const ev = store.evaluate(track, last.values || {})
  return { level: ev.level, text: ev.text, last: String(last['日期'] || ''), fails: ev.fails }
}

const statusMap = computed(() => {
  const m = new Map<string, { level: Level; text: string; last: string; fails: string[] }>()
  for (const n of streamerNames.value) m.set(n, statusOf(n))
  return m
})

const scopeNames = computed(() => {
  const op = onlyMine.value ? opFilter.value.trim() : ''
  if (!op) return streamerNames.value
  const mine = new Set(store.streamers.filter((s: any) => String(s['带教运营'] || '').trim() === op).map((s: any) => String(s['主播'] || '').trim()))
  return streamerNames.value.filter((n) => mine.has(n) || !operatorOf(n))
})

function isTodayMissing(name: string): boolean {
  const s = statusMap.value.get(name)
  return !!s && !!s.last && s.last !== today
}

const groupCounts = computed(() => {
  const c = { ok: 0, warn: 0, bad: 0, none: 0, today: 0 }
  for (const n of scopeNames.value) {
    const s = statusMap.value.get(n)
    if (!s) continue
    c[s.level]++
    if (isTodayMissing(n)) c.today++
  }
  return c
})

const groupChips = computed(() => [
  { key: 'ok' as Filter, label: '达标', count: groupCounts.value.ok, cls: 'ok' },
  { key: 'warn' as Filter, label: '待改进', count: groupCounts.value.warn, cls: 'warn' },
  { key: 'bad' as Filter, label: '不合格', count: groupCounts.value.bad, cls: 'bad' },
  { key: 'today' as Filter, label: '今天没记录', count: groupCounts.value.today, cls: 'today' },
  { key: 'none' as Filter, label: '还没记录', count: groupCounts.value.none, cls: 'none' }
])

function toggleGroup(k: Filter) {
  statusFilter.value = statusFilter.value === k ? 'all' : k
}

const filteredStreamers = computed(() => {
  const f = statusFilter.value
  if (f === 'all') return scopeNames.value
  if (f === 'today') return scopeNames.value.filter(isTodayMissing)
  return scopeNames.value.filter((n) => statusMap.value.get(n)?.level === f)
})

const streamerOptions = computed<SelectOption[]>(() =>
  filteredStreamers.value.map((n) => ({ label: operatorOf(n) ? `${n}（${operatorOf(n)}）` : n, value: n }))
)

const needAttention = computed(() => {
  const order: Record<Level, number> = { bad: 0, warn: 1, none: 2, ok: 9 }
  return filteredStreamers.value
    .map((n) => {
      const s = statusMap.value.get(n)!
      const miss = s.fails.length ? `缺 ${s.fails.join('/')}` : s.level === 'none' ? '还没开始记录' : ''
      const notToday = s.last && s.last !== today ? '今天未记录' : ''
      return { name: n, level: s.level, text: [s.text, miss, notToday].filter(Boolean).join(' · ') }
    })
    .filter((x) => x.level !== 'ok')
    .sort((a, b) => order[a.level] - order[b.level])
    .slice(0, 12)
})

function saveOpFilter() {
  localStorage.setItem('inc_operator', opFilter.value.trim())
}
function saveOnlyMine() {
  localStorage.setItem('inc_only_mine', onlyMine.value ? '1' : '0')
}

const rowsOfCurrent = computed(() => (current.value ? store.sessionsOf(current.value) : []))
const recentSessions = computed(() => rowsOfCurrent.value.slice(-12).reverse())
const lastSession = computed(() => (rowsOfCurrent.value.length ? rowsOfCurrent.value[rowsOfCurrent.value.length - 1] : null))
const lastDate = computed(() => String((lastSession.value as any)?.['日期'] || ''))
const lastIsToday = computed(() => lastDate.value === today)
const verdictText = computed(() => (current.value ? statusMap.value.get(current.value)?.text || '暂无记录' : '暂无记录'))
const verdictClass = computed(() => {
  const lv: Level = current.value ? statusMap.value.get(current.value)?.level || 'none' : 'none'
  return lv === 'ok' ? 'ok' : lv === 'bad' ? 'bad' : lv === 'warn' ? 'warn' : ''
})

const lastAsset = computed(() => {
  const rows = store.schedule.filter((r: any) => String(r['主播'] || '').trim() === current.value)
  if (!rows.length) return ''
  const r: any = rows[0]
  return [r['资产编号'], r['今天练什么']].filter(Boolean).join(' ')
})

function blankValues() {
  const v: Record<string, string> = {}
  for (const d of store.common) v[d.key] = ''
  for (const d of extras.value) v[d.key] = ''
  values.value = v
}

/** 名单非空但还没选人时，自动选第一个（新机器/刚导入名单时不至于空白） */
function ensureSelection() {
  if (!current.value && filteredStreamers.value.length) {
    current.value = filteredStreamers.value[0]
    onPick(current.value, false)
  }
}

function pick(name: string) {
  current.value = name
  onPick(name, true)
}

function onPick(name: string, addRecent = true) {
  if (!name) return
  curTrack.value = store.trackOf(name)
  blankValues()
  if (addRecent) {
    recent.value = [name, ...recent.value.filter((x) => x !== name)].slice(0, 6)
    localStorage.setItem('inc_recent', JSON.stringify(recent.value))
  }
}

function changeTrack(track: string) {
  if (!current.value) return
  store.updateStreamerTrack(current.value, track).catch(() => { /* 档案里没有这人就算了 */ })
  blankValues()
}

function moveCursor(delta: number) {
  const list = filteredStreamers.value
  if (!list.length) return
  const i = list.indexOf(current.value)
  const next = i === -1 ? (delta > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, i + delta))
  current.value = list[next]
  onPick(list[next], false)
}

function commitPick() {
  if (!current.value) return
  onPick(current.value, true)
}

function onKey(e: KeyboardEvent) {
  if (tab.value !== 'streamer') return
  const el = e.target as HTMLElement | null
  const tag = (el?.tagName || '').toLowerCase()
  if (tag === 'input' || tag === 'textarea' || el?.isContentEditable) return
  if (e.key === 'ArrowDown') { e.preventDefault(); moveCursor(1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveCursor(-1) }
  else if (e.key === 'PageDown') { e.preventDefault(); moveCursor(10) }
  else if (e.key === 'PageUp') { e.preventDefault(); moveCursor(-10) }
  else if (e.key === 'Enter') { e.preventDefault(); commitPick() }
}

const metricKeys = computed(() => store.common.filter((d) => d.kind === 'rate').map((d) => d.key))

const sessionColumns = computed<DataTableColumns<any>>(() => {
  const cols: DataTableColumns<any> = [{ title: '日期', key: '日期', width: 105 }]
  for (const d of store.common) {
    if (d.key === '最长空档秒' || d.key === '收尾完成') continue
    cols.push({
      title: d.label.replace(' 使用熟练度', '').replace('熟练度', ''),
      key: 'k_' + d.key,
      width: 78,
      render: (row: any) => String((row.values || {})[d.key] ?? '')
    })
  }
  cols.push({ title: '空档', key: 'k_最长空档秒', width: 66, render: (row: any) => String((row.values || {})['最长空档秒'] ?? '') })
  cols.push({ title: '收尾', key: 'k_收尾完成', width: 66, render: (row: any) => String((row.values || {})['收尾完成'] ?? '') })
  cols.push({ title: '赛道', key: '赛道', width: 100 })
  cols.push({
    title: '操作',
    key: 'ops',
    width: 84,
    render: (row: any) => h(NButton, { size: 'tiny', type: 'error', ghost: true, onClick: () => remove(row['日期']) }, { default: () => '删除' })
  })
  return cols
})

const scoreColumns = computed<DataTableColumns<any>>(() => [
  { title: '运营', key: '运营', width: 86 },
  { title: '主播', key: '主播数', width: 56 },
  { title: '应交', key: '应交场次', width: 56 },
  { title: '按时/补交', key: '按时提交', width: 84, render: (row: any) => `${row['按时提交']} / ${row['补交']}` },
  { title: '按时率', key: '按时率', width: 62 },
  { title: '成长', key: '成长分', width: 56 },
  { title: '学习', key: '学习分', width: 56 },
  { title: '得分', key: '得分', width: 56 },
  { title: '结论', key: '结论', width: 76 },
  { title: '说明', key: '说明', minWidth: 240 }
])

const assetColumns = computed<DataTableColumns<any>>(() => {
  const cols = store.schema[viewTable.value] || []
  return cols.map((c) => ({ title: c, key: c, ellipsis: c === '内容' || c === '证明了什么' }))
})

async function save() {
  if (!current.value) return msg.warning('先选主播')
  const filled = Object.values(values.value).filter((v) => String(v ?? '').trim() !== '').length
  if (filled === 0) return msg.warning('至少填一项再保存')
  try {
    await store.ensureStreamer(current.value, curTrack.value, opFilter.value.trim())
    await store.saveSession({
      日期: today,
      运营: opFilter.value.trim(),
      主播: current.value,
      赛道: curTrack.value,
      values: { ...values.value }
    })
    msg.success('已保存：' + current.value)
    blankValues()
  } catch (e: any) {
    msg.error('保存失败：' + (e?.message || e))
  }
}

function copyLast() {
  const s: any = lastSession.value
  if (!s) return msg.warning('这个主播还没有上一场')
  const v: Record<string, string> = {}
  for (const d of store.allDefsOf(curTrack.value)) {
    const val = (s.values || {})[d.key]
    v[d.key] = val === undefined || val === null ? '' : String(val)
  }
  values.value = v
  msg.info('已照上一场填好，改完点「保存这一场」')
}

async function remove(date: string) {
  try {
    await store.removeSession(current.value, date)
    msg.success('已删除 ' + date)
  } catch (e: any) {
    msg.error('删除失败：' + (e?.message || e))
  }
}

async function refresh() {
  await store.loadSessions()
  await store.loadStreamers()
  await store.loadSchedule()
}

async function calc() {
  try {
    const rows = await store.score(month.value)
    msg[rows.length ? 'success' : 'warning'](rows.length ? `已算出 ${rows.length} 人的考核` : '这个月还没有记录')
  } catch (e: any) {
    msg.error('算分失败：' + (e?.message || e))
  }
}

async function loadView(v: string) {
  await store.switchTable(String(v))
}

async function doImport() {
  const dir = await store.browseDir()
  if (!dir) return
  try {
    const r = await store.importDir(dir)
    msg.success(r?.message || '导入完成')
  } catch (e: any) {
    msg.error('导入失败：' + (e?.message || e))
  }
}

async function doImportStreamers() {
  if (!importText.value.trim()) return msg.warning('先粘名单')
  try {
    const r: any = await store.importStreamers(importText.value, importOp.value.trim())
    msg.success(`名册导入：新增 ${r?.added ?? 0}、更新 ${r?.updated ?? 0}`)
    ensureSelection()
    showImport.value = false
    importText.value = ''
  } catch (e: any) {
    msg.error('导入失败：' + (e?.message || e))
  }
}

async function loadUseV5() {
  try {
    const cfg = await (window as any).electronAPI.teardownConfigGet()
    useV5.value = cfg?.useV5 === true
  } catch { /* 读不到就当关闭 */ }
}

async function saveUseV5() {
  try {
    await (window as any).electronAPI.teardownConfigSet({ useV5: useV5.value })
    msg.success(useV5.value ? '已开启：AI 报告走 v5 结构' : '已关闭：AI 报告维持原样')
    store.log(useV5.value ? 'AI 报告结构：v5（孵化版）' : 'AI 报告结构：原样')
  } catch (e: any) {
    msg.error('保存失败：' + (e?.message || e))
  }
}

async function copyInstruction() {
  try {
    const text = await (window as any).electronAPI.incubateInstruction()
    await navigator.clipboard.writeText(String(text || ''))
    msg.success('v5 指令已复制，可直接贴给任何 AI')
  } catch (e: any) {
    msg.error('复制失败：' + (e?.message || e))
  }
}

watch(extras, () => {
  for (const d of store.extraDefsOf(curTrack.value)) {
    if (!(d.key in values.value)) values.value[d.key] = ''
  }
})

onMounted(async () => {
  await store.loadTracks()
  await store.loadSchema()
  await store.loadStreamers()
  await store.loadSessions()
  await store.loadSchedule()
  await store.switchTable(viewTable.value)
  await loadUseV5()
  blankValues()
  if (recent.value.length && !current.value) pick(recent.value[0])
  ensureSelection()
  window.addEventListener('keydown', onKey)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
})
</script>

<style scoped>
/* 孵化页跟随全局浅色主题：白卡片 + 墨色字 + 紫罗兰交互色，深色遗留全部收掉 */
.inc-page { padding: 18px 22px; color: var(--ink-2); }
.inc-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 8px; }
.inc-title { font-size: var(--fs-h1); font-weight: 700; letter-spacing: -0.2px; margin: 0 0 4px; color: var(--ink); }
.inc-subtitle { font-size: var(--fs-meta); color: var(--ink-3); }
.picker { display: flex; align-items: center; gap: 10px; margin: 10px 0 6px; flex-wrap: wrap; }
.switch-wrap { display: flex; align-items: center; gap: 6px; }
.groups { display: flex; align-items: center; gap: 8px; margin: 6px 0; flex-wrap: wrap; }
.chip { display: flex; align-items: baseline; gap: 6px; padding: 4px 10px; background: var(--surface); border: 1px solid var(--line-2); border-radius: 999px; cursor: pointer; user-select: none; transition: background-color 0.15s ease, border-color 0.15s ease; }
.chip b { font-size: 15px; }
.chip span { font-size: 12px; color: var(--ink-3); }
.chip.ok { border-color: rgba(18, 183, 106, 0.35); background: rgba(18, 183, 106, 0.06); } .chip.ok b { color: var(--ok); }
.chip.warn { border-color: rgba(245, 158, 11, 0.35); background: rgba(245, 158, 11, 0.07); } .chip.warn b { color: #f59e0b; }
.chip.bad { border-color: rgba(240, 68, 56, 0.35); background: rgba(240, 68, 56, 0.06); } .chip.bad b { color: var(--bad); }
.chip.today { border-color: rgba(0, 198, 216, 0.42); background: rgba(0, 198, 216, 0.08); } .chip.today b { color: #0093b5; }
.chip.none b { color: var(--ink-4); }
.chip.active { border-color: rgba(11, 118, 190, 0.4); background: rgba(11, 118, 190, 0.1); }
.watch { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 6px 0 4px; }
.dot.warn { color: #f59e0b; } .dot.bad { color: var(--bad); } .dot.none { color: var(--ink-4); }
.recent { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; flex-wrap: wrap; }
/* 填报卡：浅色卡面 + 左侧紫罗兰色带，是这一页唯一的强调 */
.card { position: relative; overflow: hidden; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); padding: 14px 14px 14px 18px; margin: 8px 0 12px; box-shadow: var(--shadow-panel); }
.card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--pulse-line); }
.card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap; gap: 8px; }
.who { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.who b { font-size: 16px; color: var(--ink); }
.tag { font-size: 12px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--surface-2); color: var(--ink-3); }
.tag.ok { border-color: rgba(18, 183, 106, 0.4); background: rgba(18, 183, 106, 0.08); color: var(--ok); }
.tag.warn { border-color: rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.08); color: #b45309; }
.tag.bad { border-color: rgba(240, 68, 56, 0.4); background: rgba(240, 68, 56, 0.08); color: var(--bad); }
.metrics { display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 10px; margin: 6px 0; }
.metric { display: flex; flex-direction: column; gap: 5px; }
.mlabel { font-size: 12px; color: var(--ink-3); }
.extras { margin: 6px 0; }
.actions { display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
.hint { font-size: 12px; color: var(--ink-4); }
.bar { display: flex; align-items: center; gap: 10px; margin: 12px 0 8px; flex-wrap: wrap; }
.empty { margin: 30px 0; font-size: 13px; color: var(--ink-4); }
.rule { margin-top: 12px; font-size: 12px; color: var(--ink-3); line-height: 1.9; }
.rule code { background: rgba(11, 118, 190, 0.09); padding: 1px 5px; border-radius: 4px; color: var(--pulse-accent); }
.log { font-family: var(--font-num); color: var(--ink-4); }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
</style>
