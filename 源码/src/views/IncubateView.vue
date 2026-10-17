<template>
  <div class="inc-page">
    <div class="inc-header">
      <div>
        <h2 class="inc-title">孵化</h2>
        <div class="inc-subtitle">导入 AI 拆解报告 → 自动生成 60 天培训计划 → 每天填一次孵化反馈；页面下方可打五个分。</div>
      </div>
      <n-button size="small" @click="store.openDataDir()">打开数据目录</n-button>
    </div>

    <n-tabs v-model:value="tab" type="line" animated>
      <!-- ⓪ 培训计划：导入 AI 报告 → 60 天计划 → 每日反馈（运营主入口） -->
      <n-tab-pane name="plan" tab="主播跟踪">
        <div class="plan-wrap">
          <section class="inc-block inc-base-block">
          <div class="blk-head blk-base-head">① 基础信息</div>
          <div class="plan-import">
            <div class="plan-import-title">① 选主播 + 导入 AI 拆解报告</div>
            <div class="plan-import-row">
              <n-select v-model:value="planStreamer" :options="planStreamerOptions" filterable clearable placeholder="选主播（可打字搜）" style="width: 220px" @update:value="onPlanStreamer" />
              <n-button type="primary" ghost @click="showImport = true">+ 添加主播</n-button>
              <n-input v-model:value="opFilter" placeholder="运营名字（带教）" style="width: 150px" @update:value="onOperatorName" />
              <n-select v-model:value="planTrack" :options="trackOptions" placeholder="赛道（导入后自动带出）" style="width: 180px" />
              <input type="date" v-model="planStart" class="date-input" title="计划开始日期" />
              <n-button type="primary" :loading="planBusy" @click="importAndGenerate">{{ planStreamer === ALL_PLAN ? '导入报告并批量生成' : '导入报告并生成 60 天计划' }}</n-button>
              <n-button @click="showPaste = true">粘贴报告</n-button>
              <n-button quaternary @click="justGenerate">{{ planStreamer === ALL_PLAN ? '批量重新生成' : '只重新生成计划' }}</n-button>
            </div>
            <div class="plan-hint">支持 .md / .txt / Word(.docx/.doc) / WPS(.wps/.rtf)；也可以把文件拖进来，或点「粘贴报告」贴全文。</div>
            <div class="plan-import-row" style="margin-top: 10px">
              <span class="hint">只看我带的主播</span>
              <n-switch v-model:value="onlyMine" size="small" @update:value="saveOnlyMine" />
              <label class="field"><span>入司日期</span><input type="date" v-model="profile['入司日期']" class="date-input" /></label>
              <label class="field"><span>首播日期</span><input type="date" v-model="profile['首播日期']" class="date-input" /></label>
              <label class="field"><span>离司日期</span><input type="date" v-model="profile['离司日期']" class="date-input" /></label>
              <label class="field"><span>固定休息日</span><n-select v-model:value="profile['固定休息日']" :options="restOptions" placeholder="不固定" style="width: 150px" /></label>
              <label class="field"><span>是否正常开播</span><n-select v-model:value="profile['是否正常开播']" :options="airOptions" placeholder="请选择" style="width: 150px" /></label>
              <label class="field"><span>配合程度</span><n-select v-model:value="profile['配合意愿']" :options="willOptions" placeholder="请选择" style="width: 140px" /></label>
              <n-button :disabled="!planStreamer || planStreamer === ALL_PLAN" :loading="profileBusy" @click="saveProfile">保存主播档案</n-button>
            </div>
            <div class="leave-row">
              <b>请假登记</b>
              <label class="field"><span>开始</span><input type="date" v-model="profile['请假开始日期']" class="date-input" /></label>
              <label class="field"><span>结束</span><input type="date" v-model="profile['请假结束日期']" class="date-input" /></label>
              <n-input v-model:value="profile['请假原因']" size="small" placeholder="原因（可留空）" style="width: 170px" />
              <span class="hint">请假日期不排课、不计完成率，也不会进入今天该盯</span>
            </div>
            <div class="groups" style="margin-top: 10px">
              <div v-for="g in groupChips" :key="g.key" class="chip" :class="[g.cls, { active: statusFilter === g.key }]" @click="toggleGroup(g.key)">
                <b>{{ g.count }}</b><span>{{ g.label }}</span>
              </div>
              <n-button v-if="statusFilter !== 'all'" size="tiny" quaternary @click="statusFilter = 'all'">显示全部</n-button>
            </div>
            <div v-if="needAttention.length" class="watch" style="margin-top: 8px">
              <div class="watch-title">今天该盯</div>
              <div v-for="w in needAttention" :key="w.name" class="watch-item" :class="w.level" @click="pick(w.name)">
                <span class="watch-name">{{ w.name }}</span>
                <span class="watch-text">{{ w.text }}</span>
              </div>
            </div>
            <div class="plan-drop" @dragover.prevent @drop.prevent="onDropReport">把 AI 报告文件拖到这里（或点上面的按钮）</div>
          </div>
          </section>

          <template v-if="planInfo">
            <section class="inc-block inc-today-block">
            <div class="blk-head blk-today-head">② 今日的工作</div>
            <div class="plan-head">
              <div class="plan-head-left">
                <b>{{ planStreamer }}</b>
                <span class="pill">{{ planInfo.plan?.赛道 || planTrack || '未定赛道' }}</span>
                <span class="pill">{{ planInfo.dayIndex > 0 ? `第 ${Math.min(planInfo.dayIndex, 60)} / 60 天` : '尚未开始' }}</span>
                <span class="pill on">{{ planInfo.phase }}</span>
                <span class="pill rest">{{ planInfo.plan?.['固定休息日'] ? '休息：' + planInfo.plan['固定休息日'] : '休息日未固定' }}</span>
                <span v-if="onLeaveToday" class="pill leave">请假中</span>
                <span v-if="profile['离司日期']" class="pill departed">已离司 {{ profile['离司日期'] }}</span>
              </div>
              <div class="plan-head-right">开始 {{ planInfo.plan?.开始日期 }} · 来源 {{ planInfo.plan?.报告来源 }}</div>
            </div>

            <div class="phase-cards">
              <div v-for="p in (planInfo.phases || [])" :key="p.key" class="phase-card" :class="{ on: planInfo.dayIndex >= p.from && planInfo.dayIndex <= p.to }" @click="pickPhase(p)">
                <div class="phase-name">{{ p.label }}</div>
                <div class="phase-goal">{{ p.goal }}</div>
              </div>
            </div>

            <div class="sec-head today-head">今天 · 第 {{ planInfo.dayIndex }} 天 · {{ planInfo.phase }}</div>
            <div v-if="onLeaveToday" class="leave-card">
              <div class="today-title">今天请假/停播</div>
              <div class="today-main">不安排训练，不计完成率</div>
              <div class="today-line">请假原因：{{ planInfo.leaveReason || profile['请假原因'] || '未填写' }}；复工后沿用原课表继续。</div>
            </div>
            <div :class="['today-card', { rest: /休息/.test(String(todayTask?.['今天练什么'] || '')) }]" v-else-if="todayTask">
              <div class="today-title">今天练什么 · {{ todayTask['日期'] }}</div>
              <div class="today-main">{{ todayTask['今天练什么'] }}</div>
              <div class="today-line"><b>怎么练：</b>{{ todayTask['怎么练'] }}</div>
              <div class="today-line"><b>验收：</b>{{ todayTask['验收'] }}</div>
            </div>
            <div class="today-card" v-else>
              <div class="today-title">今天没有对应课表</div>
              <div class="today-line">检查开始日期，或点「只重新生成计划」。</div>
            </div>

            <div class="fb-card">
              <div class="today-title">今天孵化结果（运营填）</div>
              <div class="fb-row">
                <n-select v-model:value="fb['完成情况']" :options="fbOptions" style="width: 130px" />
                <n-input v-model:value="fb['数据结果']" placeholder="数据结果：最长空档 2 秒 / 点名 18 次 / 出单 3 单" />
                <n-input v-model:value="fb['运营']" placeholder="运营名字" style="width: 140px" />
              </div>
              <div class="fb-row">
                <n-input v-model:value="fb['问题']" type="textarea" :rows="2" placeholder="遇到的问题 / 卡点" />
                <n-input v-model:value="fb['明日计划']" type="textarea" :rows="2" placeholder="明天怎么调整" />
                <n-button type="primary" :loading="fbBusy" @click="saveFb">保存今日反馈</n-button>
              </div>
            </div>

            </section>
            <section class="inc-block inc-all-block">
            <div class="blk-head blk-all-head">③ 全部课表与记录</div>
            <div class="week-card">
              <div class="week-head">本周课表（所有主播的今日任务）</div>
              <div class="week-tools">
                <span>按周一到周日展开，每个主播只显示本周该练的课</span>
                <n-button size="tiny" type="primary" ghost @click="showAllCourses">查看当前主播全部 60 天</n-button>
              </div>
              <n-data-table size="small" :columns="weekColumns" :data="weekTasks" :max-height="240" virtual-scroll />
            </div>
            <div class="plan-table-title">最近反馈（全部主播）</div>
            <div class="plan-filter">
              <n-select v-model:value="feedbackScope" :options="feedbackScopeOptions" style="width: 180px" />
            </div>
            <n-data-table size="small" :columns="fbColumns" :data="feedbackList" :max-height="240" virtual-scroll />
            <div class="sec-divider"></div>
            <div class="plan-table-title schedule-title">60 天课表</div>
            <div class="plan-filter">
              <n-select v-model:value="dayPhase" :options="dayPhaseOptions" style="width: 220px" />
            </div>
            <n-data-table class="schedule-table" size="small" :columns="dayColumns" :data="filteredPlanDays" :max-height="300" virtual-scroll />
            </section>
          </template>
          <div v-else-if="planStreamer === ALL_PLAN" class="plan-empty">已选择“全部主播”。导入报告后点上面的「导入报告并批量生成」，会按每个主播自己的赛道分别生成 60 天课表。</div>
          <div v-else class="plan-empty">还没有计划：选好主播、导入 AI 报告，点「导入报告并生成 60 天计划」。</div>
        </div>
      
          <details class="advanced-block">
            <summary>补充工具：今日五项评分（可选，点这里展开）</summary>
          <div class="track-daily">
            <div class="sec-title">今日打分（可选：这一场五个分）</div>
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
          <div class="watch-title">今天该盯</div>
          <div class="watch-list">
            <n-button
              v-for="w in needAttention"
              :key="w.name"
              :class="['watch-item', w.level]"
              size="small"
              quaternary
              @click="pick(w.name)"
            >
              <span class="watch-name">{{ w.name }}</span>
              <span class="watch-text">{{ w.text }}</span>
            </n-button>
          </div>
        </div>

        <div v-if="recent.length" class="recent">
          <span class="hint">最近：</span>
          <n-button v-for="r in recent" :key="r" size="tiny" quaternary @click="pick(r)">{{ r }}</n-button>
        </div>

        <div v-if="streamerNames.length === 0" class="empty">
          还没有主播 —— 点最上面的「+ 添加主播」，一行一个把主播加进来（也可以写 <code>主播名,运营名</code> 指定带教）。
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
      
          </div>
          </details>
</n-tab-pane>

      

      <!-- ② 运营考核 -->
      <n-tab-pane name="score" tab="运营区域">
        <div class="bar">
          <n-input v-model:value="month" size="small" placeholder="月份，如 2026-10" style="width: 150px" />
          <n-button type="primary" size="small" @click="calc">算分</n-button>
          <span class="hint">只算三项：主播成长 40% ｜ 学习 40% ｜ 每日按时提交 20%</span>
        </div>
        <n-data-table :columns="scoreColumns" :data="store.scoreRows" size="small" :bordered="false" max-height="calc(100vh - 420px)" />
        <div class="rule">
          <div><b>主播成长 40%</b>＝40% 现状（名下主播本月所有场次按赛道合格线的达标率）＋ 60% 变化（每个主播本月最后一场 vs 第一场的单场得分；提升 20 分算满分、退 20 分算 0 分）</div>
          <div><b>每日按时提交 20%</b>＝（当天交的场次 ＋ 事后补交 × 0.5）÷ 应交场次；应交＝名下主播数 × 4 场/月（一周一场的最低线，不看录像）；五个分都打才算一次提交</div>
          <div><b>学习 40%</b>＝课表（月目标 10 条）、资产贡献（2 条）、周复盘（4 次）三项平均</div>
          <div>抽查门禁：本月抽查合格率 &lt;70% → 总分 ×0.8（没抽查不罚）；结论：<b>≥80 达标</b> ｜ <b>60–79 待改进</b> ｜ <b>&lt;60 不合格</b></div>
        </div>
      </n-tab-pane>

      <!-- ③ 资产与课表 -->
      <n-tab-pane name="asset" tab="知识库">
        <div class="bar">
          <n-select v-model:value="viewTable" :options="viewOptions" size="small" style="width: 180px" @update:value="loadView" />
          <n-button size="small" type="primary" @click="doImport">导入报告文件</n-button>
          <n-button size="small" @click="doImportDir">选 work 目录</n-button>
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
          <div>运营平时用「导入报告文件」直接选那个 .md；只有当报告散在一场 work 目录里时，才用「选 work 目录」让它自己找。</div>
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

    <!-- 粘贴 AI 报告 → 生成 60 天计划 -->
    <n-modal v-model:show="showPaste" preset="card" style="width: 760px" title="粘贴 AI 拆解报告">
      <div class="rule"><div>把 AI 分析报告的全文粘进来（.md 内容即可）。导入后会自动生成 60 天计划。</div></div>
      <n-input v-model:value="pasteText" type="textarea" :rows="16" placeholder="粘贴报告全文…" style="margin-top: 8px" />
      <template #footer>
        <div class="actions" style="justify-content: flex-end">
          <n-button size="small" @click="showPaste = false">取消</n-button>
          <n-button size="small" type="primary" :loading="planBusy" @click="doPasteImport">导入并生成计划</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref, watch } from 'vue'
import { NButton, NDataTable, NDatePicker, NInput, NModal, NSelect, NSwitch, NTabPane, NTabs, useMessage, type DataTableColumns, type SelectOption } from 'naive-ui'
import { useIncubateStore } from '../stores/incubate'

const store = useIncubateStore()
const msg = useMessage()
const api = () => (window as any).electronAPI

type Level = 'ok' | 'warn' | 'bad' | 'none'
type Filter = 'all' | Level | 'today'

const tab = ref('plan')
const month = ref(new Date().toISOString().slice(0, 7))
const viewTable = ref('资产库')
const viewOptions = [
  { label: '资产库', value: '资产库' },
  { label: '本周课表', value: '课表' }
  ,{ label: '案例库（可直接打开视频和报告）', value: '案例库' }
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
const today = (() => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` })()

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

// ================= 培训计划：导入 AI 报告 → 60 天计划 → 每日反馈 =================
function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const planStreamer = ref('')
const ALL_PLAN = '__all__'
const planTrack = ref('')
const planStart = ref(localDate())
const planInfo = ref<any>(null)
const planBusy = ref(false)
const fbBusy = ref(false)
const showPaste = ref(false)
const pasteText = ref('')
const dayPhase = ref('all')
const fb = ref<Record<string, string>>({
  完成情况: '完成', 数据结果: '', 问题: '', 明日计划: '', 运营: localStorage.getItem('inc_operator') || '', 今日任务: ''
})

const airOptions: SelectOption[] = [
  { label: '正常开播', value: '是' }, { label: '未正常开播', value: '否' }, { label: '待定', value: '待定' }
]
const willOptions: SelectOption[] = [
  { label: '① 极配合', value: '极配合' }, { label: '② 配合', value: '配合' },
  { label: '③ 一般', value: '一般' }, { label: '④ 消极', value: '消极' }, { label: '⑤ 不配合', value: '不配合' }
]
const restOptions: SelectOption[] = [
  { label: '不固定休息日', value: '' },
  { label: '每周日休息', value: '周日' }, { label: '每周一休息', value: '周一' }, { label: '每周二休息', value: '周二' },
  { label: '每周三休息', value: '周三' }, { label: '每周四休息', value: '周四' }, { label: '每周五休息', value: '周五' }, { label: '每周六休息', value: '周六' }
]
const profile = ref<Record<string, string>>({ 入司日期: '', 首播日期: '', 离司日期: '', 固定休息日: '', 请假开始日期: '', 请假结束日期: '', 请假原因: '', 是否正常开播: '', 配合意愿: '' })
const profileBusy = ref(false)
function loadProfile(name: string) {
  const s = store.streamers.find((x: any) => String(x['主播'] || '').trim() === name)
  profile.value = {
    入司日期: String(s?.['入司日期'] || ''), 首播日期: String(s?.['首播日期'] || ''), 离司日期: String(s?.['离司日期'] || ''),
    固定休息日: String(s?.['固定休息日'] || ''),
    请假开始日期: String(s?.['请假开始日期'] || ''),
    请假结束日期: String(s?.['请假结束日期'] || ''),
    请假原因: String(s?.['请假原因'] || ''),
    是否正常开播: String(s?.['是否正常开播'] || ''), 配合意愿: String(s?.['配合意愿'] || '')
  }
}
async function saveProfile() {
  if (!planStreamer.value) return msg.warning('先选主播')
  const ls = String(profile.value['请假开始日期'] || '').trim()
  const le = String(profile.value['请假结束日期'] || ls).trim()
  if (ls && le && le < ls) return msg.warning('请假结束日期不能早于开始日期')
  if (ls && !profile.value['请假结束日期']) profile.value['请假结束日期'] = ls
  if (planStreamer.value === ALL_PLAN) return msg.warning('全部主播模式下不能统一保存档案，请先选具体主播。')
  profileBusy.value = true
  try {
    await store.saveStreamerProfile(planStreamer.value, { ...profile.value })
    msg.success('主播档案已保存')
  } catch (e: any) { msg.error('保存失败：' + (e?.message || e)) } finally { profileBusy.value = false }
}

// 顶部主播下拉也跟随“只看我带的主播”和状态筛选
const allFeedback = ref<any[]>([])
const feedbackScope = ref('all')
const feedbackScopeOptions: SelectOption[] = [
  { label: '全部主播', value: 'all' },
  { label: '我带的主播', value: 'mine' },
  { label: '当前主播', value: 'current' }
]
async function loadAllFeedback() {
  try {
    const rows = await api().incubateList('孵化反馈')
    allFeedback.value = (rows || []).sort((a: any, b: any) => String(b['日期'] || '').localeCompare(String(a['日期'] || '')))
  } catch { /* ignore */ }
}
const feedbackList = computed(() => {
  if (feedbackScope.value === 'mine' && opFilter.value.trim()) return allFeedback.value.filter((r: any) => String(r['运营'] || '').trim() === opFilter.value.trim())
  if (feedbackScope.value === 'current' && planStreamer.value) return allFeedback.value.filter((r: any) => String(r['主播'] || '').trim() === planStreamer.value)
  return allFeedback.value
})
function pickPhase(p: any) {
  dayPhase.value = p.from === 1 ? '1-7' : p.from === 8 ? '8-30' : p.from === 31 ? '31-60' : 'all'
  const el = document.querySelector('.plan-filter')
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
function showAllCourses() {
  if (!planInfo.value && planStreamer.value !== ALL_PLAN) return msg.warning('先选一个主播并生成计划')
  dayPhase.value = 'all'
  const el = document.querySelector('.schedule-title')
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
const weekTasks = ref<any[]>([])
const weekColumns: DataTableColumns<any> = [
  { title: '日期', key: '日期', width: 108 },
  { title: '主播', key: '主播', width: 110 },
  { title: '赛道', key: '赛道', width: 90 },
  { title: '第几天', key: '天', width: 70 },
  { title: '今天练什么', key: '今天练什么', ellipsis: { tooltip: true } },
  { title: '验收', key: '验收', width: 220, ellipsis: { tooltip: true } }
]
async function loadWeekTasks() {
  try {
    const plans = await api().incubateList('培训计划')
    const rows = await api().incubateList('课表')
    const roster = await api().incubateList('主播学籍')
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const monday = new Date(today)
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
    const out: any[] = []
    const names = new Set<string>()
    for (const p of plans || []) {
      const name = String(p['主播'] || '').trim()
      const start = new Date(String(p['开始日期'] || '') + 'T00:00:00')
      if (!name || isNaN(start.getTime()) || names.has(name)) continue
      names.add(name)
      for (let offset = 0; offset < 7; offset++) {
        const d = new Date(monday)
        d.setDate(monday.getDate() + offset)
        const idx = Math.floor((d.getTime() - start.getTime()) / 86400000) + 1
        if (idx < 1 || idx > 60) continue
        const row = (rows || []).find((r: any) => String(r['主播'] || '').trim() === name && String(r['日期']) === `D${idx}`)
        const person = (roster || []).find((r: any) => String(r['主播'] || '').trim() === name)
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
        const leaveEnd = String(person?.['请假结束日期'] || person?.['请假开始日期'] || '')
        if (person?.['请假开始日期'] && leaveEnd && ds >= String(person['请假开始日期']) && ds <= leaveEnd) {
          out.push({ _sort: d.getTime(), 日期: `${week} ${d.getMonth() + 1}/${d.getDate()}`, 主播: name, 赛道: p['赛道'] || '', 天: `D${idx}`, 今天练什么: `请假${person['请假原因'] ? '：' + person['请假原因'] : ''}`, 验收: '不计完成率，不催课' })
          continue
        }
        if (!row) continue
        out.push({ _sort: d.getTime(), 日期: `${week} ${d.getMonth() + 1}/${d.getDate()}`, 主播: name, 赛道: p['赛道'] || '', 天: `D${idx}`, 今天练什么: row['今天练什么'] || '', 验收: row['验收'] || '' })
      }
    }
    weekTasks.value = out.sort((a, b) => Number(a._sort) - Number(b._sort) || String(a['主播']).localeCompare(String(b['主播'])))
  } catch { /* ignore */ }
}

const planStreamerOptions = computed<SelectOption[]>(() => [
  { label: '全部主播（批量生成课表）', value: ALL_PLAN },
  ...filteredStreamers.value.map((n) => ({ label: operatorOf(n) ? `${n}（${operatorOf(n)}）` : n, value: n }))
])
const fbOptions: SelectOption[] = [
  { label: '完成', value: '完成' },
  { label: '部分完成', value: '部分完成' },
  { label: '未完成', value: '未完成' },
  { label: '今日休息', value: '休息' },
  { label: '今天未开播', value: '未开播' },
  { label: '请假/停播', value: '请假' },
  { label: '设备故障', value: '设备故障' },
  { label: '平台问题', value: '平台问题' },
  { label: '临时停播', value: '临时停播' }
]
const dayPhaseOptions: SelectOption[] = [
  { label: '全部 60 天', value: 'all' },
  { label: '1-7 天 起号基础', value: '1-7' },
  { label: '8-30 天 能力成型', value: '8-30' },
  { label: '31-60 天 实战冲刺', value: '31-60' }
]

const todayTask = computed(() => {
  const idx = Number(planInfo.value?.dayIndex || 0)
  if (!idx) return null
  const key = `D${Math.min(Math.max(idx, 1), 60)}`
  return store.planDays.find((r: any) => String(r['日期']) === key) || null
})

const onLeaveToday = computed(() => {
  const start = String(planInfo.value?.leaveStart || profile.value['请假开始日期'] || '')
  const end = String(planInfo.value?.leaveEnd || profile.value['请假结束日期'] || '')
  const end2 = end || start
  return !!start && !!end2 && today >= start && today <= end2
})

const filteredPlanDays = computed(() => {
  const all = store.planDays
  if (dayPhase.value === 'all') return all
  const [a, b] = dayPhase.value.split('-').map(Number)
  return all.filter((r: any) => { const n = Number(String(r['日期']).slice(1)); return n >= a && n <= b })
})

const dayColumns: DataTableColumns<any> = [
  { title: '天', key: '日期', width: 64 },
  { title: '今天练什么', key: '今天练什么', ellipsis: { tooltip: true } },
  { title: '验收', key: '验收', width: 260, ellipsis: { tooltip: true } }
]
const fbColumns: DataTableColumns<any> = [
  { title: '日期', key: '日期', width: 100 },
  { title: '主播', key: '主播', width: 110 },
  { title: '完成', key: '完成情况', width: 80 },
  { title: '数据结果', key: '数据结果', ellipsis: { tooltip: true } },
  { title: '问题', key: '问题', ellipsis: { tooltip: true } },
  { title: '明日计划', key: '明日计划', ellipsis: { tooltip: true } }
]

async function loadPlanFor(name: string) {
  if (!name) { planInfo.value = null; return }
  if (name === ALL_PLAN) { planInfo.value = null; return }
  const r = await store.loadPlan(name)
  planInfo.value = r
  if (r?.plan?.['赛道']) planTrack.value = String(r.plan['赛道'])
  if (r?.plan?.['开始日期']) planStart.value = String(r.plan['开始日期'])
  else if (r?.plan && !r.plan['开始日期']) planStart.value = localDate()
  fb.value['今日任务'] = todayTask.value ? String(todayTask.value['今天练什么']) : ''
  fb.value['完成情况'] = onLeaveToday.value ? '请假' : (todayTask.value && /休息/.test(String(todayTask.value['今天练什么'] || '')) ? '休息' : '完成')
  const todayStr = localDate()
  const exist = (r?.feedback || []).find((x: any) => String(x['日期']) === todayStr)
  if (exist) {
    fb.value['完成情况'] = String(exist['完成情况'] || '完成')
    fb.value['数据结果'] = String(exist['数据结果'] || '')
    fb.value['问题'] = String(exist['问题'] || '')
    fb.value['明日计划'] = String(exist['明日计划'] || '')
    fb.value['运营'] = String(exist['运营'] || fb.value['运营'])
  }
}

async function onPlanStreamer(name: string) {
  planStreamer.value = name || ''
  if (!name) { planInfo.value = null; return }
  if (name === ALL_PLAN) {
    planInfo.value = null
    planTrack.value = ''
    current.value = ''
    return
  }
  planTrack.value = store.trackOf(name) || store.defaultTrack
  loadProfile(name)
  // 下方“今日打分”区也用同一个主播，避免选两次
  current.value = name
  curTrack.value = planTrack.value
  blankValues()
  await loadPlanFor(name)
}

async function importFileAndGenerate(filePath: string) {
  planBusy.value = true
  try {
    const imp: any = await store.importDir(filePath)
    if (imp?.track) planTrack.value = String(imp.track)
    if (!planStreamer.value) {
      msg.warning('报告导入了；选一个主播，再点「只重新生成计划」')
      return
    }
    await doGenerate()
    msg.success(imp?.message || '已导入并生成计划')
  } catch (e: any) {
    msg.error('导入失败：' + (e?.message || e))
  } finally { planBusy.value = false }
}

async function importAndGenerate() {
  const p = await store.pickReport()
  if (!p) return
  await importFileAndGenerate(p)
}

async function onDropReport(e: DragEvent) {
  const f = e.dataTransfer?.files?.[0]
  if (!f) return
  const p = (window as any).electronAPI.getFilePath(f)
  if (!p) return msg.warning('没拿到文件路径，请用「导入报告」按钮')
  await importFileAndGenerate(p)
}

async function justGenerate() {
  await doGenerate()
}

async function generateTargets() {
  const targets = planStreamer.value === ALL_PLAN ? filteredStreamers.value.slice() : [planStreamer.value]
  if (!targets.length) throw new Error('还没有主播，先点「+ 添加主播」')
  let done = 0
  for (const name of targets) {
    if (!name) continue
    await store.generatePlan({
      streamer: name,
      track: planStreamer.value === ALL_PLAN ? (store.trackOf(name) || planTrack.value || store.defaultTrack) : planTrack.value,
      restDay: planStreamer.value === ALL_PLAN
        ? String(store.streamers.find((s: any) => String(s['主播'] || '').trim() === name)?.['固定休息日'] || '')
        : String(profile.value['固定休息日'] || ''),
      leaveStart: planStreamer.value === ALL_PLAN
        ? String(store.streamers.find((s: any) => String(s['主播'] || '').trim() === name)?.['请假开始日期'] || '')
        : String(profile.value['请假开始日期'] || ''),
      leaveEnd: planStreamer.value === ALL_PLAN
        ? String(store.streamers.find((s: any) => String(s['主播'] || '').trim() === name)?.['请假结束日期'] || '')
        : String(profile.value['请假结束日期'] || ''),
      leaveReason: planStreamer.value === ALL_PLAN
        ? String(store.streamers.find((s: any) => String(s['主播'] || '').trim() === name)?.['请假原因'] || '')
        : String(profile.value['请假原因'] || ''),
      startDate: planStart.value,
      source: planInfo.value?.plan?.['报告来源'] || 'AI 拆解报告'
    })
    done++
    if (targets.length > 1) msg.info(`正在生成：${done}/${targets.length} ${name}`)
  }
  return done
}

async function doGenerate() {
  if (!planStreamer.value) return msg.warning('先选主播')
  planBusy.value = true
  try {
    const n = await generateTargets()
    await loadWeekTasks()
    if (planStreamer.value !== ALL_PLAN) await loadPlanFor(planStreamer.value)
    msg.success(planStreamer.value === ALL_PLAN ? `已为 ${n} 个主播批量生成 60 天计划` : '已生成计划')
  } catch (e: any) {
    msg.error('生成失败：' + (e?.message || e))
  } finally { planBusy.value = false }
}

async function doPasteImport() {
  if (!pasteText.value.trim()) return msg.warning('先把报告内容贴进来')
  planBusy.value = true
  try {
    const imp: any = await store.importReportText(pasteText.value, '粘贴的报告')
    if (imp?.track) planTrack.value = String(imp.track)
    showPaste.value = false
    pasteText.value = ''
    if (planStreamer.value) await doGenerate()
    msg.success((imp?.message || '已导入') + (planStreamer.value ? '' : '；再选主播点「只重新生成计划」'))
  } catch (e: any) {
    msg.error('导入失败：' + (e?.message || e))
  } finally { planBusy.value = false }
}

async function saveFb() {
  if (!planStreamer.value) return msg.warning('先选主播')
  fbBusy.value = true
  try {
    await store.saveFeedback({
      日期: localDate(), 主播: planStreamer.value, 今日任务: fb.value['今日任务'] || '',
      完成情况: fb.value['完成情况'], 数据结果: fb.value['数据结果'], 问题: fb.value['问题'],
      明日计划: fb.value['明日计划'], 运营: fb.value['运营']
    })
    await loadAllFeedback()
    await loadPlanFor(planStreamer.value)
    msg.success('今日反馈已保存')
  } catch (e: any) {
    msg.error('保存失败：' + (e?.message || e))
  } finally { fbBusy.value = false }
}

function onLeaveNow(name: string): boolean {
  const s = store.streamers.find((x: any) => String(x['主播'] || '').trim() === name)
  const start = String(s?.['请假开始日期'] || '')
  const end = String(s?.['请假结束日期'] || '')
  return !!start && !!end && today >= start && today <= end
}

function onRestNow(name: string): boolean {
  const s = store.streamers.find((x: any) => String(x['主播'] || '').trim() === name)
  const rest = String(s?.['固定休息日'] || '')
  return !!rest && rest === ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date().getDay()]
}

const needAttention = computed(() => {
  const order: Record<Level, number> = { bad: 0, warn: 1, none: 2, ok: 9 }
  return filteredStreamers.value
    .filter((n) => !onLeaveNow(n) && !onRestNow(n))
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
function onOperatorName(v: string) {
  opFilter.value = v
  saveOpFilter()
  fb.value['运营'] = v
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

const showTop = ref(false)
function scroller(): HTMLElement | null {
  const el = document.querySelector('.inc-page') as HTMLElement | null
  return el || (document.scrollingElement as HTMLElement | null)
}
function scrollTop() { const el = scroller(); if (el) el.scrollTo({ top: 0, behavior: 'smooth' }) }
function onScroll() { const el = scroller(); showTop.value = !!el && el.scrollTop > 300 }

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

async function openCaseFolder(row: any) {
  const dir = String(row?.['来源目录'] || '').trim()
  if (!dir) return msg.warning('这个旧案例没记录来源目录；以后新导入的报告会自动带上。')
  const ok = await api().teardownOpen(dir)
  if (!ok) msg.error('打不开这个目录，可能已经被移动或删除：' + dir)
}

const assetColumns = computed<DataTableColumns<any>>(() => {
  const cols = store.schema[viewTable.value] || []
  const out: DataTableColumns<any> = cols.map((c) => ({ title: c, key: c, ellipsis: c === '内容' || c === '证明了什么' || c === '来源目录' }))
  if (viewTable.value === '案例库') {
    out.push({
      title: '打开',
      key: '打开',
      width: 92,
      render: (row: any) => h(NButton, {
        size: 'tiny', type: 'primary', ghost: true,
        disabled: !String(row['来源目录'] || '').trim(),
        onClick: () => openCaseFolder(row)
      }, { default: () => '打开文件夹' })
    })
  }
  return out
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
  // 只选报告文件（Windows 上不能和“选文件夹”共用一个对话框）
  const dir = await store.pickReport()
  if (!dir) return
  try {
    const r = await store.importDir(dir)
    msg.success(r?.message || '导入完成')
  } catch (e: any) {
    msg.error('导入失败：' + (e?.message || e))
  }
}

async function doImportDir() {
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
  planStreamer.value = current.value || filteredStreamers.value[0] || ''
  await loadAllFeedback()
  await loadWeekTasks()
  if (planStreamer.value) {
    planStart.value = localDate()
    planTrack.value = store.trackOf(planStreamer.value)
    loadProfile(planStreamer.value)
    await loadPlanFor(planStreamer.value)
  }
  window.addEventListener('keydown', onKey)
  scroller()?.addEventListener('scroll', onScroll)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  scroller()?.removeEventListener('scroll', onScroll)
})
</script>

<style scoped>
/* 孵化页跟随全局浅色主题：白卡片 + 墨色字 + 紫罗兰交互色，深色遗留全部收掉 */
.inc-page { padding: 18px 22px; color: var(--ink-2); font-size: 14px; }
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
.card { position: relative; overflow: hidden; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); padding: 18px 18px 18px 20px; margin: 10px 0 14px; box-shadow: var(--shadow-panel); }
.card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--pulse-line); }
.card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap; gap: 8px; }
.who { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.who b { font-size: 16px; color: var(--ink); }
.tag { font-size: 12px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--surface-2); color: var(--ink-3); }
.tag.ok { border-color: rgba(18, 183, 106, 0.4); background: rgba(18, 183, 106, 0.08); color: var(--ok); }
.tag.warn { border-color: rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.08); color: #b45309; }
.tag.bad { border-color: rgba(240, 68, 56, 0.4); background: rgba(240, 68, 56, 0.08); color: var(--bad); }
.metrics { display: grid; grid-template-columns: repeat(2, minmax(200px, 1fr)); gap: 14px 18px; margin: 10px 0; }
.metric { display: flex; flex-direction: column; gap: 5px; }
.mlabel { font-size: 13.5px; font-weight: 600; color: #374151; }
.extras { margin: 6px 0; }
.actions { display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
.hint { font-size: 12px; color: var(--ink-4); }

/* 「今天该盯」：一个人一个小卡片，字大一号，一眼看得出来是几个人 */
.watch { margin-bottom: 10px; }
.watch-title { font-size: 14px; font-weight: 700; color: #1f2328; margin-bottom: 6px; }
.watch-list { display: flex; flex-wrap: wrap; gap: 8px; }
.watch-item {
  padding: 6px 12px; border-radius: 10px; height: auto;
  border: 1px solid #e6e8ec; background: #fff;
  border-left: 4px solid #d8dbe0;
}
.watch-item:hover { border-color: #f97316; box-shadow: 0 3px 12px rgba(0, 0, 0, 0.08); }
/* n-button 默认是横排居中，这里改成上下两行，名字大、状态小 */
.watch-item :deep(.n-button__content) {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
}
.watch-item.warn { border-left-color: #f97316; }
.watch-item.bad { border-left-color: #ef4444; }
.watch-item.idle { border-left-color: #d8dbe0; }
.watch-name { font-size: 15px; font-weight: 700; color: #1f2328; line-height: 1.3; }
.watch-text { font-size: 12px; color: #6b7280; line-height: 1.3; }
.bar { display: flex; align-items: center; gap: 10px; margin: 12px 0 8px; flex-wrap: wrap; }
.empty { margin: 30px 0; font-size: 13px; color: var(--ink-4); }
.rule { margin-top: 12px; font-size: 12px; color: var(--ink-3); line-height: 1.9; }
.rule code { background: rgba(11, 118, 190, 0.09); padding: 1px 5px; border-radius: 4px; color: var(--pulse-accent); }
.log { font-family: var(--font-num); color: var(--ink-4); }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

/* ---------- 培训计划（导入 → 60 天 → 每日反馈） ---------- */
.plan-wrap { display: flex; flex-direction: column; gap: 12px; }
.inc-block { border:1px solid var(--line); border-radius:16px; padding:14px 16px 16px; margin: 0; box-shadow:var(--shadow-panel); }
.inc-base-block { background:linear-gradient(160deg,#f0f9ff 0%,#ffffff 55%,#f7fcff 100%); border-color:#cfe8f6; }
.inc-today-block { background:linear-gradient(160deg,#effcf8 0%,#ffffff 58%,#f7fffc 100%); border-color:#c8eee4; }
.inc-all-block { background:linear-gradient(160deg,#f6f4ff 0%,#ffffff 58%,#fbfaff 100%); border-color:#ded9f5; }
.inc-block .blk-head { margin-top:0; }
.plan-import { background: #fff; border: 1px solid #e6e8ec; border-radius: 12px; padding: 14px 16px; }
.plan-import-title { font-weight: 700; margin-bottom: 10px; color: #1f2328; }
.plan-import-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.leave-row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:10px; padding:9px 11px; border-radius:9px; background:#f4fbf8; border:1px solid #d7f0e7; }
.leave-row b { font-size:12px; color:#167a67; }
.plan-hint { margin-top: 8px; font-size: 12px; color: #6b7280; }
.plan-drop { margin-top: 10px; border: 1.5px dashed #c7d2fe; border-radius: 10px; padding: 14px; text-align: center; color: #64748b; font-size: 13px; background: #f8faff; }
.plan-head { display: flex; justify-content: space-between; gap: 10px; align-items: center; flex-wrap: wrap; }
.plan-head-left { display: flex; gap: 8px; align-items: center; }
.plan-head-right { font-size: 12px; color: #6b7280; }
.pill { display: inline-block; padding: 2px 9px; border-radius: 999px; background: #eef2ff; color: #4338ca; font-size: 12px; }
.pill.on { background: #dcfce7; color: #15803d; }
.phase-cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.phase-card { border: 1px solid #e6e8ec; border-radius: 12px; padding: 10px 12px; background: #fff; }
.phase-card.on { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12); }
.phase-name { font-weight: 700; font-size: 13px; color: #1f2328; }
.phase-goal { font-size: 12px; color: #6b7280; margin-top: 4px; line-height: 1.5; }
.today-card, .fb-card { background: #fff; border: 1px solid #e6e8ec; border-radius: 12px; padding: 14px 16px; }
.today-title { font-weight: 700; font-size: 13px; color: #1f2328; margin-bottom: 8px; }
.today-main { font-size: 15px; font-weight: 700; color: #111827; margin-bottom: 6px; }
.today-line { font-size: 13px; color: #374151; line-height: 1.7; }
.fb-row { display: flex; gap: 10px; margin-bottom: 8px; align-items: stretch; }
.plan-table-title { font-weight: 700; font-size: 13px; margin-top: 4px; }
.plan-filter { margin-bottom: 6px; }
.plan-empty { margin: 36px auto; color: #6b7280; font-size: 13px; text-align: center; }
.blk-head { margin: 24px 0 12px; padding: 11px 15px; border-radius: 11px; font-size: 16px; font-weight: 800; letter-spacing: .2px; border-left: 5px solid transparent; box-shadow: 0 2px 8px rgba(16, 80, 120, .05); }
.blk-base-head { background: linear-gradient(90deg, #dff3ff, #f2fbff); color: #075985; border-left-color: #0b76be; }
.blk-today-head { background: linear-gradient(90deg, #dcfced, #f2fff9); color: #08765f; border-left-color: #0f9d82; }
.blk-all-head { background: linear-gradient(90deg, #eee9ff, #f8f5ff); color: #5b3d9a; border-left-color: #8065c8; }
.week-card { background: #fff; border: 1px solid #dbe3ea; border-radius: 12px; padding: 12px 14px; margin-bottom: 14px; }
.week-head { font-size: 14px; font-weight: 700; color: #334155; margin-bottom: 8px; }
.week-tools { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; color: var(--ink-3); font-size: 12px; }
.advanced-block { margin-top: 16px; background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 10px 14px; }
.advanced-block > summary { cursor: pointer; color: var(--pulse-accent); font-weight: 700; font-size: 13px; }
.advanced-block .track-daily { border-top: 0; margin-top: 10px; padding-top: 0; }
.pill.departed { background: #f3f4f6; color: #6b7280; text-decoration: line-through; }
.pill.rest { background:#ecfdf5; color:#0f766e; }
.pill.leave { background:#fff7ed; color:#b45309; }
/* 整页滚轮/滑条 */
.inc-page { height: calc(100vh - 56px); overflow-y: auto; padding-right: 18px; }
.inc-page::-webkit-scrollbar { width: 10px; }
.inc-page::-webkit-scrollbar-thumb { background: #c1c7d0; border-radius: 6px; }
.inc-page::-webkit-scrollbar-track { background: transparent; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #6b7280; }
.field { min-width: 170px; }
.date-input { height: 34px; border: 1px solid #dcdfe6; border-radius: 6px; padding: 0 10px; width: 170px; font-size: 14px; color: #1f2328; background: #fff; }
.to-top { position: fixed; right: 28px; bottom: 28px; z-index: 50; background: #0b76be; color: #fff; padding: 10px 16px; border-radius: 999px; cursor: pointer; box-shadow: 0 6px 18px rgba(11,118,190,.35); font-size: 13px; }
.to-top:hover { background: #095f99; }
/* 今天该盯：红色重点条 */
.watch { background: #fff1f0; border: 1px solid #ffa39e; border-radius: 12px; padding: 10px 14px; }
.watch-title { color: #cf1322; font-weight: 800; font-size: 14px; margin-bottom: 6px; }
.watch-item { cursor: pointer; }
.watch-item:hover { background: #ffe7e6; }
.track-daily { border-top: 1px dashed #e5e7eb; margin-top: 16px; padding-top: 16px; }
.sec-title { font-size: 15px; font-weight: 700; color: #1f2328; margin-bottom: 10px; }
/* 表格字大一点、行高一点，不费眼 */
.inc-page :deep(.n-data-table .n-data-table-td),
.inc-page :deep(.n-data-table .n-data-table-th) { font-size: 13px; padding-top: 9px; padding-bottom: 9px; }
/* 今天 与 60 天课表：强区分 */
.today-head { color: #1d4ed8; font-size: 16px; font-weight: 800; margin: 18px 0 10px; padding-left: 10px; border-left: 4px solid #2563eb; }
.today-card { background: #e8f2ff !important; border: 1px solid #93c5fd !important; border-left: 7px solid #1d4ed8 !important; border-radius: 14px !important; padding: 18px 20px !important; box-shadow: 0 2px 10px rgba(29,78,216,.08); }
.today-card.rest { background:#ecfdf5 !important; border-color:#99f6e4 !important; border-left-color:#0f9d82 !important; }
.leave-card { background:#fffaf0 !important; border:1px solid #fed7aa !important; border-left:7px solid #f59e0b !important; border-radius:14px !important; padding:18px 20px !important; }
.fb-card { background: #ecf8ff !important; border: 1px solid #7dd3fc !important; border-left: 7px solid #0284c7 !important; border-radius: 14px !important; padding: 18px 20px !important; margin-top: 14px; }
.schedule-title { background: #e2e8f0; color: #334155; padding: 10px 14px; border-radius: 10px; font-size: 15px; margin: 10px 0 8px; }
.sec-divider { height: 1px; background: #e5e7eb; margin: 22px 0 16px; }
.schedule-table { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px; }
.schedule-table .n-data-table-th { background: #eef2f7 !important; }
</style>
