<template>
  <div class="inc-page">
    <div class="inc-header">
      <div>
        <h2 class="inc-title">主播孵化</h2>
        <div class="inc-subtitle">先选主播并导入 AI 报告，再按“今日工作”执行；全部课表、反馈和评分都集中在这一页。</div>
      </div>
      <n-button class="header-action" size="small" @click="store.openDataDir()">打开数据目录</n-button>
    </div>

    <n-tabs v-model:value="tab" type="line" animated>
      <!-- ⓪ 培训计划：导入 AI 报告 → 60 天计划 → 每日反馈（运营主入口） -->
      <n-tab-pane name="plan" tab="主播跟踪">
        <div class="plan-wrap">
          <section class="inc-block inc-command-block">
            <header class="section-heading section-heading-setup">
              <span class="section-role role-setup">设置区</span>
              <div class="section-heading-copy">
                <h3>主播工作台</h3>
                <p>选主播、维护档案，再导入报告生成计划</p>
              </div>
            </header>
            <div class="command-grid">
              <div class="command-main">
                <div class="control-block">
                  <div class="control-heading"><b>选择当前主播</b><span>下方档案、评分和今日任务会自动跟随这里的选择</span></div>
                  <div class="selector-row selector-row-main">
                    <label class="control-field current-streamer-field">
                      <span>当前主播</span>
                      <n-select v-model:value="planStreamer" :options="planStreamerOptions" filterable clearable placeholder="选择或搜索主播" @update:value="onPlanStreamer" />
                    </label>
                    <label class="control-field">
                      <span>带教运营</span>
                      <n-input v-model:value="opFilter" placeholder="填写运营名字" @update:value="onOperatorName" />
                    </label>
                    <n-button class="add-streamer-btn" type="primary" ghost @click="openAddStreamer">+ 添加主播</n-button>
                  </div>
                  <div class="selector-row selector-row-settings">
                    <label class="control-field">
                      <span>训练赛道</span>
                      <n-select v-model:value="planTrack" :options="trackOptions" placeholder="选择赛道" @update:value="onPlanTrackChanged" />
                    </label>
                    <label class="control-field">
                      <span>计划开始日期</span>
                      <input type="date" v-model="planStart" class="date-input" title="计划开始日期" />
                    </label>
                    <label class="inline-switch plan-switch"><n-switch v-model:value="onlyMine" size="small" @update:value="saveOnlyMine" /> 只看我带的</label>
                  </div>
                </div>
                <div class="control-block action-control-block">
                  <div class="control-heading"><b>导入报告并生成计划</b><span>完整报告会自动生成 60 天课表；已有课表也可单独补充运营课程</span></div>
                  <div class="action-row">
                    <n-button type="primary" :loading="planBusy" @click="importAndGenerate">{{ planStreamer === ALL_PLAN ? '导入报告并批量生成' : '导入报告并生成 60 天计划' }}</n-button>
                    <n-button @click="showPaste = true">粘贴报告</n-button>
                    <n-button tertiary @click="justGenerate">{{ planStreamer === ALL_PLAN ? '批量重新生成' : '只重新生成计划' }}</n-button>
                    <span class="action-divider" />
                    <n-button class="custom-course-btn" type="primary" ghost :disabled="!planStreamer || planStreamer === ALL_PLAN" @click="openCustomCourse">+ 运营加课</n-button>
                  </div>
                  <div class="plan-drop plan-drop-top" role="button" tabindex="0" @click="importAndGenerate" @keydown.enter.prevent="importAndGenerate" @dragenter.prevent @dragover.prevent @drop.prevent.stop="onDropReport">
                    <b>把 AI 报告文件拖到这里</b>
                    <span>支持 Markdown、TXT、Word、WPS；也可以点击直接选择文件</span>
                  </div>
                </div>
              </div>
              <div v-if="needAttention.length" class="watch-dock">
                <div class="watch-title">今日该盯 · 点名字直接带出资料</div>
                <div class="watch-list">
                  <button v-for="w in needAttention" :key="w.name" :class="['watch-item', w.level]" @click="openWatchStreamer(w.name)">
                    <span class="watch-name">{{ w.name }}</span>
                    <span class="watch-text">{{ w.text }}</span>
                  </button>
                </div>
              </div>
            </div>

            <div class="selected-hero">
              <div class="hero-name-wrap">
                <span>当前主播</span>
                <b>{{ planStreamerName }}</b>
                <em>{{ planTrack || '未选赛道' }}</em>
              </div>
              <div class="hero-info">
                <span>运营：{{ operatorOf(planStreamer) || opFilter || '未填写' }}</span>
                <span v-if="planInfo">D{{ Math.min(planInfo.dayIndex, 60) }} / 60</span>
                <span v-if="planInfo">{{ planInfo.phase }}</span>
                <span v-if="profile['离司日期']" class="hero-danger">已离司 {{ profile['离司日期'] }}</span>
              </div>
            </div>

            <div class="top-score-card">
              <div class="top-score-head">
                <b>今日五项评分</b>
                <span>{{ planStreamerName }} · 输入后自动保存</span>
                <i>{{ autoSaveText }}</i>
              </div>
              <div class="top-score-grid">
                <label v-for="d in topScoreDefs" :key="d.key">
                  <span>{{ d.label }}</span>
                  <n-select v-model:value="values[d.key]" size="small" clearable placeholder="选择 1–5" :options="rateOptions(d.hint)" />
                </label>
              </div>
            </div>
            <div class="basic-profile-card">
              <div class="basic-profile-head">
                <div class="basic-profile-title">
                  <b>基础档案</b>
                  <span>以下信息只属于当前主播</span>
                </div>
                <div class="profile-summary">
                  <span><i>入司</i><b>{{ profile['入司日期'] || '未填' }}</b></span>
                  <span><i>首播</i><b>{{ profile['首播日期'] || '未填' }}</b></span>
                  <span><i>开播</i><b>{{ profile['是否正常开播'] || '未填' }}</b></span>
                  <span><i>配合</i><b>{{ profile['配合意愿'] || '未填' }}</b></span>
                </div>
                <div class="profile-actions">
                  <n-button size="small" type="primary" :loading="profileBusy" :disabled="!planStreamer || planStreamer === ALL_PLAN" @click="saveProfile">保存基础档案</n-button>
                  <n-button size="small" type="primary" ghost :disabled="!planStreamer || planStreamer === ALL_PLAN" @click="openEditStreamer">修改主播资料</n-button>
                  <n-button size="small" tertiary @click="showProfile = !showProfile">{{ showProfile ? '收起档案' : '展开/编辑档案' }}</n-button>
                </div>
              </div>
              <div v-show="showProfile" class="basic-profile-grid">
                <label><span>入司日期</span><input type="date" v-model="profile['入司日期']" class="date-input" /></label>
                <label><span>首播日期</span><input type="date" v-model="profile['首播日期']" class="date-input" /></label>
                <label><span>离司日期</span><input type="date" v-model="profile['离司日期']" class="date-input" /></label>
                <label><span>固定休息日</span><n-select v-model:value="profile['固定休息日']" :options="restOptions" size="small" /></label>
                <label><span>是否正常开播</span><n-select v-model:value="profile['是否正常开播']" :options="airOptions" size="small" /></label>
                <label><span>配合程度</span><n-select v-model:value="profile['配合意愿']" :options="willOptions" size="small" /></label>
              </div>
              <div v-show="showProfile" class="basic-leave-row">
                <b>请假登记</b>
                <label><span>开始</span><input type="date" v-model="profile['请假开始日期']" class="date-input" /></label>
                <label><span>结束</span><input type="date" v-model="profile['请假结束日期']" class="date-input" /></label>
                <n-input v-model:value="profile['请假原因']" size="small" placeholder="请假原因（可留空）" style="width: 190px" />
                <n-button v-if="profile['离司日期']" size="small" type="success" ghost :disabled="!planStreamer || planStreamer === ALL_PLAN" :loading="statusBusy" @click="restoreCurrentStreamer">恢复在职</n-button>
                <n-popconfirm v-else positive-text="标记离司" negative-text="取消" @positive-click="departCurrentStreamer">
                  <template #trigger><n-button size="small" type="warning" ghost :disabled="!planStreamer || planStreamer === ALL_PLAN" :loading="statusBusy">标记离司</n-button></template>
                  将保留全部历史，只记录离司日期。
                </n-popconfirm>
              </div>
              <div class="basic-status-row">
                <div v-for="g in groupChips" :key="g.key" class="chip" :class="[g.cls, { active: statusFilter === g.key }]" @click="toggleGroup(g.key)">
                  <b>{{ g.count }}</b><span>{{ g.label }}</span>
                </div>
                <n-button v-if="statusFilter !== 'all'" size="tiny" quaternary @click="statusFilter = 'all'">显示全部</n-button>
              </div>
            </div>
          </section>
          <section v-if="false" class="inc-block inc-base-block">
          <div class="block-streamer-name">① 基础档案 <b>{{ planStreamerName }}</b></div>
          <div class="blk-head blk-base-head">① 基础信息</div>
          <div class="plan-import">
            <div v-if="false" class="plan-import-title">① 选主播 + 导入 AI 拆解报告</div>
            <div v-if="false" class="plan-import-row">
              <n-select v-model:value="planStreamer" :options="planStreamerOptions" filterable clearable placeholder="选主播（可打字搜）" style="width: 220px" @update:value="onPlanStreamer" />
              <n-button type="primary" ghost @click="openAddStreamer">+ 添加主播</n-button>
              <n-input v-model:value="opFilter" placeholder="运营名字（带教）" style="width: 150px" @update:value="onOperatorName" />
              <n-select v-model:value="planTrack" :options="trackOptions" placeholder="赛道（选择后立即保存）" style="width: 180px" @update:value="onPlanTrackChanged" />
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
              <n-button v-if="profile['离司日期']" type="success" ghost :disabled="!planStreamer || planStreamer === ALL_PLAN" :loading="statusBusy" @click="restoreCurrentStreamer">恢复在职</n-button>
              <n-popconfirm
                v-else
                positive-text="标记离司"
                negative-text="取消"
                @positive-click="departCurrentStreamer"
              >
                <template #trigger>
                  <n-button type="warning" ghost :disabled="!planStreamer || planStreamer === ALL_PLAN" :loading="statusBusy">标记离司</n-button>
                </template>
                将保留“{{ planStreamer }}”的全部历史数据，只把离司日期记为 {{ profile['离司日期'] || today }}。以后可自动计入离职率，也可以恢复在职。
              </n-popconfirm>
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
            <div v-if="false" class="watch" style="margin-top: 8px">
              <div class="watch-title">今天该盯</div>
              <div v-for="w in needAttention" :key="w.name" class="watch-item" :class="w.level" @click="pick(w.name)">
                <span class="watch-name">{{ w.name }}</span>
                <span class="watch-text">{{ w.text }}</span>
              </div>
            </div>
            <div v-if="false" class="plan-drop" role="button" tabindex="0" @click="importAndGenerate" @keydown.enter.prevent="importAndGenerate" @dragenter.prevent @dragover.prevent @drop.prevent.stop="onDropReport">
              <b>把 AI 报告文件拖到这里</b>
              <span>支持 Markdown、TXT、Word、WPS；也可以点击这里直接选文件</span>
            </div>
          </div>
          </section>

          <template v-if="planInfo">
            <section class="inc-block inc-today-block">
            <header class="section-heading section-heading-today">
              <span class="section-role role-today">执行区</span>
              <div class="section-heading-copy">
                <h3>今日工作</h3>
                <p>只处理当前主播今天要完成的任务和结果反馈</p>
              </div>
              <span class="section-person-mini">{{ planStreamerName }}</span>
            </header>
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

            <div class="today-head-row">
              <div class="sec-head today-head">今天 · 第 {{ planInfo.dayIndex }} 天 · {{ planInfo.phase }}</div>
              <n-button size="small" type="primary" ghost :disabled="planStreamer === ALL_PLAN" @click="openCustomCourse">+ 添加运营课程</n-button>
            </div>
            <div v-if="onLeaveToday" class="leave-card">
              <div class="today-title">今天请假/停播</div>
              <div class="today-main">不安排训练，不计完成率</div>
              <div class="today-line">请假原因：{{ planInfo.leaveReason || profile['请假原因'] || '未填写' }}；复工后沿用原课表继续。</div>
            </div>
            <div :class="['today-card', { rest: /休息/.test(String(todayAiTask?.['今天练什么'] || '')) }]" v-else-if="todayAiTask">
              <div class="today-title">AI 计划 · {{ todayAiTask['日期'] }}</div>
              <div class="today-main">{{ todayAiTask['今天练什么'] }}</div>
              <div class="today-line"><b>怎么练：</b>{{ todayAiTask['怎么练'] }}</div>
              <div class="today-line"><b>验收：</b>{{ todayAiTask['验收'] }}</div>
            </div>
            <div class="today-card" v-else-if="!todayCustomTasks.length">
              <div class="today-title">今天没有对应课表</div>
              <div class="today-line">检查开始日期，或点「只重新生成计划」。</div>
            </div>
            <div v-if="todayCustomTasks.length && !onLeaveToday" class="today-card custom-course-card">
              <div class="today-title">运营额外安排 · {{ todayCustomTasks.length }} 项</div>
              <div v-for="c in todayCustomTasks" :key="c.id" class="custom-course-row">
                <div>
                  <div class="custom-course-name">{{ c['今天练什么'] }}</div>
                  <div v-if="c['怎么练']" class="today-line"><b>怎么练：</b>{{ c['怎么练'] }}</div>
                  <div v-if="c['验收']" class="today-line"><b>验收：</b>{{ c['验收'] }}</div>
                </div>
                <n-button size="tiny" type="primary" quaternary @click="editCustomCourse(c)">修改</n-button>
                <n-popconfirm positive-text="删除" negative-text="保留" @positive-click="deleteCustomCourse(c)">
                  <template #trigger><n-button size="tiny" type="error" quaternary>删除</n-button></template>
                  只删除这条运营课程，AI 60 天计划不受影响。
                </n-popconfirm>
              </div>
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

            <div class="fb-card hw-card">
              <div class="today-title">主播作业<span v-if="hwTodayLabel" class="hw-today-chip">{{ hwTodayLabel }}</span>（图片 / 视频 / Word 等文件，或飞书链接，只属当前主播）</div>
              <div class="fb-row">
                <input type="date" v-model="hwDate" class="date-input" style="max-width: 148px" title="作业归属哪天（默认今天）" />
                <span v-if="hwDateDayLabel" class="hw-day-hint">{{ hwDateDayLabel }}</span>
                <n-input v-model:value="hwTitle" placeholder="作业标题（可空，默认取文件名）" style="max-width: 230px" />
                <n-input v-model:value="hwNote" placeholder="备注（可空）" style="max-width: 200px" />
                <n-button type="primary" ghost :disabled="!canHomework" :loading="hwBusy" @click="pickHomework">上传作业文件</n-button>
              </div>
              <div class="fb-row">
                <n-input v-model:value="hwLink" placeholder="飞书等链接（https://…），回车直接登记" @keyup.enter="addHwLink" />
                <n-button :disabled="!canHomework || !hwLink.trim()" @click="addHwLink">登记链接</n-button>
              </div>
              <div v-if="store.homeworkRows.length" class="hw-list">
                <div v-for="w in store.homeworkRows" :key="w.id" class="hw-item">
                  <span :class="['hw-type', { link: w['类型'] === '链接' }]">{{ w['类型'] }}</span>
                  <span class="hw-name" :title="w['文件名'] || w['链接']">{{ w['标题'] }}</span>
                  <span class="hw-date">{{ w['日期'] }}</span>
                  <span v-if="hwDayLabel(w)" class="hw-day" :title="hwDayLabel(w)">{{ hwDayLabel(w) }}</span>
                  <span v-if="w['备注']" class="hw-note">{{ w['备注'] }}</span>
                  <n-button size="tiny" tertiary type="primary" @click="openHw(w)">打开</n-button>
                  <n-popconfirm positive-text="删除" negative-text="保留" @positive-click="removeHw(w)">
                    <template #trigger><n-button size="tiny" tertiary type="error">删</n-button></template>
                    {{ w['类型'] === '链接' ? '删除这条登记记录' : '删除记录，存档的文件也会一起删掉' }}，确认？
                  </n-popconfirm>
                </div>
              </div>
              <div v-else class="hw-empty">还没有作业：主播交的图片、视频、Word 点「上传作业文件」；飞书文档/多维表格粘链接登记。</div>
            </div>

            </section>
            <section class="inc-block inc-all-block">
            <header class="section-heading section-heading-all">
              <span class="section-role role-all">档案区</span>
              <div class="section-heading-copy">
                <h3>全部课表与记录</h3>
                <p>查本周安排、历史反馈和完整 60 天训练计划</p>
              </div>
              <span class="section-person-mini">{{ planStreamerName }}</span>
            </header>
            <div class="week-card">
              <div class="week-head">本周课表（所有主播的今日任务）</div>
              <div class="week-tools">
                <span>按周一到周日展开，每个主播只显示本周该练的课</span>
                <label class="week-focus"><n-switch v-model:value="weekFocus" size="small" /> 只看今天该盯与当前主播</label>
                <n-button size="tiny" type="primary" ghost @click="showAllCourses">查看当前主播全部 60 天</n-button>
              </div>
              <n-data-table size="small" :columns="weekColumns" :data="displayWeekTasks" :row-props="weekRowProps" :max-height="280" virtual-scroll />
              <div v-if="selectedWeekTask" class="week-detail">
                <div class="week-detail-head"><b>{{ selectedWeekTask['主播'] }}</b><span>{{ selectedWeekTask['日期'] }} · {{ selectedWeekTask['赛道'] }} · {{ selectedWeekTask['来源'] }}</span></div>
                <div><b>今天练什么：</b>{{ selectedWeekTask['今天练什么'] }}</div>
                <div><b>验收标准：</b>{{ selectedWeekTask['验收'] || '暂无' }}</div>
              </div>
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
      
          <details v-if="false" class="advanced-block">
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
          <span class="hint">运营不用在这里填表——每天到「主播跟踪」填五项评分和今日反馈，月底点「算分」自动出结果。三块算总分：主播成长 40 分 ｜ 学习 40 分 ｜ 按时提交 20 分。点运营名字，直接跳到「主播跟踪」只看他带的主播。</span>
        </div>
        <n-data-table :columns="scoreColumns" :data="store.scoreRows" size="small" :bordered="false" max-height="calc(100vh - 420px)" />
        <div class="rule">
          <div><b>主播成长 40 分</b>：看两件事。① 名下主播这个月的场次有多少达到赛道合格线（占 16 分）；② 每个主播本月最后一场比第一场进步多少（占 24 分）——进步 20 分拿满，不进步拿一半，退步 20 分不得分。</div>
          <div><b>学习 40 分</b>：三件事各占三分之一，按月数数量——课表完成 10 条、给知识库贡献 2 条资料、写 4 次周复盘，完成几成算几成分。</div>
          <div><b>按时提交 20 分</b>：每个主播每月至少交 4 场评分（约一周一场）。当天交算 1 次，事后补交只算半次；五个分项都打分才算交了一次。应交次数 ＝ 在职主播数 × 4。</div>
          <div><b>抽查</b>：本月抽查合格率不到 70%，总分打八折；没抽查不罚。<b>结论：80 分以上达标 ｜ 60–79 待改进 ｜ 60 以下不合格</b></div>
        </div>
      </n-tab-pane>

      <!-- ③ 知识库：库模式 —— 按类别查资料，按主播过滤，一键生成该主播的标准孵化手册 -->
      <n-tab-pane name="asset" tab="知识库">
        <div class="bar">
          <div class="lib-cats">
            <button
              v-for="c in libCats"
              :key="c.value"
              :class="['lib-cat', { active: viewTable === c.value }]"
              @click="switchLibCat(c.value)"
            >{{ c.label }}</button>
          </div>
          <n-select v-model:value="libStreamer" :options="libStreamerOptions" size="small" style="width: 150px" placeholder="按主播查" />
          <n-button size="small" type="primary" :disabled="!libStreamer" :loading="manualBusy" @click="generateManual">生成标准孵化手册</n-button>
          <n-button v-if="viewTable === '话术库' || viewTable === 'PK玩法库'" size="small" type="warning" ghost :loading="importBusy" @click="importKnowledgeFile">一键导入资料</n-button>
          <template v-if="viewTable !== '话术库'">
            <n-button size="small" @click="store.exportCsv()">导出 CSV</n-button>
            <n-button size="small" @click="store.exportXlsx()">导出 Excel</n-button>
          </template>
          <n-button v-else size="small" type="primary" ghost @click="openScriptEdit()">+ 添加话术</n-button>
        </div>
        <div class="lib-hint hint">{{ libHint }}</div>

        <!-- 话术库：按对话场景分区的卡片，主播照着念 -->
        <template v-if="viewTable === '话术库'">
          <div class="mindset-filter">
            <button
              v-for="c in scriptScenes"
              :key="c"
              :class="['mindset-chip', { active: scriptScene === c }]"
              @click="scriptScene = c"
            >{{ c }}</button>
            <n-input v-model:value="scriptKw" size="small" clearable placeholder="搜游客说的话 / 回复方案…" style="width: 220px; margin-left: auto" />
          </div>
          <div class="mindset-list">
            <div v-for="s in scriptShown" :key="s.id" class="mindset-card">
              <div class="mindset-card-head">
                <span class="mindset-cat">{{ s['场景'] || '未分类' }}</span>
                <b class="mindset-q">游客说：{{ s['游客说'] }}</b>
                <span class="mindset-ops">
                  <n-button size="tiny" tertiary @click="openScriptEdit(s)">改</n-button>
                  <n-popconfirm positive-text="删除" negative-text="取消" @positive-click="removeScript(s)">
                    <template #trigger><n-button size="tiny" tertiary type="error">删</n-button></template>
                    删掉这条就恢复不了，确认？
                  </n-popconfirm>
                </span>
              </div>
              <div class="mindset-block">
                <div class="mindset-label">回复方案 · 主播照着念</div>
                <div class="mindset-text">{{ s['回复方案'] }}</div>
              </div>
              <div v-if="s['出处']" class="script-source">出处：{{ s['出处'] }}</div>
            </div>
            <div v-if="!scriptShown.length" class="empty-state" style="padding: 40px 0">
              <div class="empty-icon">🫥</div>
              <div>{{ scriptKw || scriptScene !== '全部' ? '没有匹配的话术，换个关键词或场景' : '话术库是空的，点右上角「+ 添加话术」' }}</div>
            </div>
            <div v-else-if="scriptShown.length < scriptTotal" style="padding: 10px 0 18px; text-align: center">
              <n-button size="small" @click="scriptLimit += 200">加载更多（已显示 {{ scriptShown.length }} / {{ scriptTotal }} 条）</n-button>
            </div>
          </div>
        </template>

        <!-- 资产库 / 课表 / 案例库：数据表 -->
        <template v-else>
          <div v-if="viewTable === '资产库'" class="bar">
            <n-button size="small" type="primary" @click="doImport">导入报告文件</n-button>
            <n-button size="small" @click="doImportDir">选 work 目录</n-button>
            <n-button size="tiny" @click="copyInstruction">复制 v5 指令</n-button>
            <span class="hint">{{ libRows.length }} 行</span>
          </div>
          <n-data-table :columns="assetColumns" :data="libRows" size="small" :bordered="false" max-height="calc(100vh - 480px)" />
          <div v-if="viewTable === '资产库'" class="rule">
            <div>运营平时用「导入报告文件」直接选那个 .md；只有当报告散在一场 work 目录里时，才用「选 work 目录」让它自己找。</div>
            <div>两种报告都认：① v5 格式（带 <code>XD-XX-001</code> 资产表和 <code>| D1 | … |</code> 课表）；② 普通分析报告（把「<b>话术库</b>」里的表格抽成资产、把「<b>SOP</b>」清单抽成课表，编号自动生成）。</div>
            <div v-for="(l, i) in store.logs.slice(0, 6)" :key="i" class="log">{{ l }}</div>
          </div>
        </template>
      </n-tab-pane>

      <!-- ④ 心态调整：多方心态方案 —— 主播/运营/管理者，各找各的场景 -->
      <n-tab-pane name="mindset" tab="心态调整">
        <div class="mindset-head">
          <div class="mindset-title">
            <b>心态问题库 · 多方方案</b>
            <span>主播闹情绪找「主播」，运营有压力找「运营」，管理端自己犯愁找「管理者」——先选对象，再对场景，照着说、带着做。</span>
          </div>
          <n-button type="primary" ghost size="small" @click="openMindsetEdit()">+ 添加一条</n-button>
        </div>
        <div class="mindset-roles">
          <button
            v-for="r in mindsetRoleTabs"
            :key="r"
            :class="['mindset-role-tab', `role-${r}`, { active: mindsetRole === r }]"
            @click="mindsetRole = r"
          >{{ r === '全部' ? '全部对象' : r }}</button>
        </div>
        <div class="mindset-filter">
          <button
            v-for="c in mindsetCategories"
            :key="c"
            :class="['mindset-chip', { active: mindsetCat === c }]"
            @click="mindsetCat = c"
          >{{ c }}</button>
          <n-input v-model:value="mindsetKw" size="small" clearable placeholder="搜索问题或回复…" style="width: 200px; margin-left: auto" />
        </div>
        <div class="mindset-list">
          <div v-for="m in mindsetShown" :key="m.id" class="mindset-card">
            <div class="mindset-card-head">
              <span :class="['mindset-role', `role-${m['对象'] || '主播'}`]">{{ m['对象'] || '主播' }}</span>
              <span class="mindset-cat">{{ m['分类'] || '未分类' }}</span>
              <b class="mindset-q">{{ m['问题'] }}</b>
              <span class="mindset-ops">
                <n-button size="tiny" tertiary @click="openMindsetEdit(m)">改</n-button>
                <n-popconfirm positive-text="删除" negative-text="取消" @positive-click="removeMindset(m)">
                  <template #trigger><n-button size="tiny" tertiary type="error">删</n-button></template>
                  删掉这条就恢复不了，确认？
                </n-popconfirm>
              </span>
            </div>
            <div class="mindset-block">
              <div class="mindset-label">{{ mindsetReplyLabel(m) }}</div>
              <div class="mindset-text">{{ m['疏导回复'] }}</div>
            </div>
            <div class="mindset-block action">
              <div class="mindset-label">{{ mindsetActionLabel(m) }}</div>
              <div class="mindset-text">{{ m['应对动作'] }}</div>
            </div>
          </div>
          <div v-if="!mindsetShown.length" class="empty-state" style="padding: 40px 0">
            <div class="empty-icon">🫥</div>
            <div>{{ mindsetKw || mindsetCat !== '全部' || mindsetRole !== '全部' ? '没有匹配的内容，换个关键词、分类或对象' : '还没有内容，点右上角「+ 添加一条」' }}</div>
          </div>
        </div>
      </n-tab-pane>
    </n-tabs>

    <!-- 心态调整：添加/修改 -->
    <n-modal v-model:show="showMindset" preset="card" style="width: 640px" :title="mindsetForm.id ? '修改这条' : '添加一条心态问题'">
      <div class="rule"><div>先选「对象」：主播=运营照着说；运营=管理端照着说；管理者=自己想通照着做。「应对动作」都要写说完之后立刻做的事。</div></div>
      <div class="custom-form">
        <label class="field"><span>对象（这条给谁用）</span>
          <n-select v-model:value="mindsetForm.对象" :options="mindsetRoleOptions" />
        </label>
        <label class="field"><span>分类</span>
          <n-select v-model:value="mindsetForm.分类" :options="mindsetCatOptions" filterable tag placeholder="选择或输入新分类" />
        </label>
        <label class="field" style="grid-column: 1 / -1"><span>问题 / 场景</span>
          <n-input v-model:value="mindsetForm.问题" placeholder="例如：播了一周还是个位数在线，觉得没希望" />
        </label>
        <label class="field" style="grid-column: 1 / -1"><span>疏导回复（照着说 / 自己想通）</span>
          <n-input v-model:value="mindsetForm.疏导回复" type="textarea" :rows="4" placeholder="口语化、能直接念；管理者对象就写给自己想通的理" />
        </label>
        <label class="field" style="grid-column: 1 / -1"><span>应对动作（说完立刻做）</span>
          <n-input v-model:value="mindsetForm.应对动作" type="textarea" :rows="3" placeholder="写具体、马上能做的事" />
        </label>
      </div>
      <template #footer>
        <div class="actions" style="justify-content: flex-end">
          <n-button size="small" @click="showMindset = false">取消</n-button>
          <n-button size="small" type="primary" :loading="mindsetBusy" @click="saveMindset">保存</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 话术库：添加/修改一条话术 -->
    <n-modal v-model:show="showScript" preset="card" style="width: 620px" :title="scriptForm.id ? '修改这条话术' : '添加一条话术'">
      <div class="rule"><div>「游客说」写触发例句（弹幕原话或场景），「回复方案」写主播照着念的话，括号里的词按自己情况替换。</div></div>
      <div class="custom-form">
        <label class="field"><span>场景</span>
          <n-select v-model:value="scriptForm.场景" :options="scriptSceneOptions" filterable tag placeholder="选择或输入新场景" />
        </label>
        <label class="field"><span>出处（可空）</span>
          <n-input v-model:value="scriptForm.出处" placeholder="如：接话破冰 / 对答如流 / 自创" />
        </label>
        <label class="field" style="grid-column: 1 / -1"><span>游客说（触发例句）</span>
          <n-input v-model:value="scriptForm.游客说" placeholder="例如：你真美 / 主播多大了 / （新游客进场没说话）" />
        </label>
        <label class="field" style="grid-column: 1 / -1"><span>回复方案（主播照着念）</span>
          <n-input v-model:value="scriptForm.回复方案" type="textarea" :rows="4" placeholder="口语化、能直接念；括号里的词主播按自己情况替换" />
        </label>
      </div>
      <template #footer>
        <div class="actions" style="justify-content: flex-end">
          <n-button size="small" @click="showScript = false">取消</n-button>
          <n-button size="small" type="primary" :loading="scriptBusy" @click="saveScript">保存</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 标准孵化手册：预览 + 复制/导出 -->
    <n-modal v-model:show="showManual" preset="card" style="width: 860px" :title="manualTitle">
      <div class="rule"><div>{{ manualNote }}</div></div>
      <n-input v-model:value="manualText" type="textarea" :rows="24" readonly style="margin-top: 8px" />
      <template #footer>
        <div class="actions" style="justify-content: flex-end">
          <n-button size="small" @click="copyManual">复制全文</n-button>
          <n-button size="small" type="primary" @click="exportManual">导出 .md 文件</n-button>
          <n-button size="small" @click="showManual = false">关闭</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 添加一个主播：与人事同一份档案、同一条写入规则（同名=同一人，只补不冲） -->
    <n-modal v-model:show="showAddOne" preset="card" style="width: 560px" title="添加一个主播">
      <div class="rule"><div>和人事录入的是同一份档案：同名视为同一个人，已有档案会自动补齐空字段，不会重复建档；人事页也能立刻看到这个人。</div></div>
      <div class="custom-form" style="margin-top: 10px">
        <label class="field"><span>主播姓名 *</span><n-input v-model:value="addOneForm.name" placeholder="主播姓名" @keydown.enter="doAddOne" /></label>
        <label class="field"><span>带教运营</span><n-input v-model:value="addOneForm.operator" placeholder="谁来带这个主播" /></label>
        <label class="field"><span>联系方式</span><n-input v-model:value="addOneForm.contact" placeholder="微信 / 电话，可空" /></label>
        <label class="field"><span>训练赛道</span><n-select v-model:value="addOneForm.track" :options="trackOptions" placeholder="选择赛道" /></label>
        <label class="field"><span>入司日期</span><input type="date" v-model="addOneForm.joinDate" class="date-input" /></label>
        <label class="field"><span>开播日期</span><input type="date" v-model="addOneForm.firstLive" class="date-input" /></label>
      </div>
      <div class="plan-hint" style="margin-top: 12px">入司日期建议当天就填，离职率和 60 天留存都靠它算。一次要加多人？<a style="color: var(--pulse-accent); cursor: pointer" @click="switchToBatch">用批量粘贴名单</a></div>
      <template #footer>
        <div class="actions" style="justify-content: flex-end">
          <n-button size="small" @click="showAddOne = false">取消</n-button>
          <n-button size="small" type="primary" :loading="addOneBusy" @click="doAddOne">添加主播</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 批量粘贴名单 -->
    <n-modal v-model:show="showImport" preset="card" style="width: 600px" title="添加主播（可一次加多人）">
      <div class="rule"><div>每行一个主播。只填主播名也可以；需要指定时写 <code>主播名,运营名,赛道</code>。重名不会重复创建。</div></div>
      <n-input v-model:value="importOp" size="small" placeholder="默认带教运营（可留空）" style="margin: 10px 0" />
      <n-select v-model:value="importTrack" :options="trackOptions" placeholder="新主播默认赛道" style="margin-bottom: 10px" />
      <div class="plan-hint" style="margin: -2px 0 10px">上面两项只作为本次新增主播的默认值；名单里单独写了运营或赛道，以名单为准。</div>
      <n-input v-model:value="importText" type="textarea" :rows="8" placeholder="张三&#10;李四,小A,唱歌点歌&#10;王五,小B" />
      <template #footer>
        <div class="actions" style="justify-content: flex-end">
          <n-button size="small" @click="showImport = false">取消</n-button>
          <n-button size="small" type="primary" @click="doImportStreamers">添加这些主播</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 修改或删除误填主播 -->
    <n-modal v-model:show="showEditStreamer" preset="card" style="width: 680px" title="修改或删除主播">
      <div class="edit-streamer-note">
        <b>只处理填错或重复建档</b>
        <span>改名、换运营、换赛道会同步该主播已有的评分、课表、反馈和培训计划。正常离职请用“标记离司”，这样离职率不会丢。</span>
      </div>
      <div class="edit-streamer-grid">
        <label class="field"><span>主播姓名</span><n-input v-model:value="editStreamerForm.name" placeholder="填写正确的主播姓名" /></label>
        <label class="field"><span>带教运营</span><n-input v-model:value="editStreamerForm.operator" placeholder="填写带教运营" /></label>
        <label class="field"><span>训练赛道</span><n-select v-model:value="editStreamerForm.track" :options="trackOptions" placeholder="选择赛道" /></label>
      </div>
      <div class="delete-streamer-zone">
        <div>
          <b>删除错误主播</b>
          <span>只用于误建或重复。会删除该主播的档案、评分、课表、反馈和 60 天计划；电脑里的录像、拆解素材和报告文件不会删除。</span>
        </div>
        <n-popconfirm positive-text="确认删除" negative-text="取消" @positive-click="deleteCurrentStreamer">
          <template #trigger><n-button type="error" ghost :loading="deleteStreamerBusy">删除这个错误主播</n-button></template>
          删除后不能撤销。正常离职的主播请不要删除，改用“标记离司”。
        </n-popconfirm>
      </div>
      <template #footer>
        <div class="edit-streamer-footer">
          <n-button size="small" @click="showEditStreamer = false">取消</n-button>
          <n-button size="small" type="primary" :loading="editStreamerBusy" @click="saveStreamerIdentity">保存修改</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 运营自定义计划 -->

    <n-modal v-model:show="showCustomCourse" preset="card" style="width: 680px" :title="customCourse.id ? '修改运营自定义计划' : '添加运营自定义计划'">
      <div class="rule"><div>给 <b>{{ planStreamer }}</b> 追加一节课程。它会和 AI 计划同时显示，不覆盖原来的 60 天课表。</div></div>
      <div class="custom-form">
        <label class="field"><span>上课日期</span><input type="date" v-model="customCourse.日期" class="date-input" /></label>
        <label class="field" style="grid-column: 1 / -1"><span>今天练什么</span><n-input v-model:value="customCourse.今天练什么" placeholder="例如：话术加练 20 分钟" /></label>
        <label class="field" style="grid-column: 1 / -1"><span>怎么练</span><n-input v-model:value="customCourse.怎么练" type="textarea" :rows="3" placeholder="例如：开场三句练 10 遍；直播中每 5 分钟用一次封闭提问" /></label>
        <label class="field" style="grid-column: 1 / -1"><span>验收标准</span><n-input v-model:value="customCourse.验收" type="textarea" :rows="3" placeholder="例如：脱稿完成；直播回放中至少出现 8 次；运营抽查通过" /></label>
      </div>
      <template #footer>
        <div class="actions" style="justify-content: flex-end">
          <n-button size="small" @click="showCustomCourse = false">取消</n-button>
          <n-button size="small" type="primary" :loading="customBusy" @click="saveCustomCourse">{{ customCourse.id ? '保存修改' : '添加计划' }}</n-button>
        </div>
      </template>
    </n-modal>

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
import { computed, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { NButton, NDataTable, NDatePicker, NInput, NModal, NPopconfirm, NSelect, NSwitch, NTabPane, NTabs, useDialog, useMessage, type DataTableColumns, type SelectOption } from 'naive-ui'
import { useIncubateStore } from '../stores/incubate'

const store = useIncubateStore()
const msg = useMessage()
const dialog = useDialog()
const api = () => (window as any).electronAPI

type Level = 'ok' | 'warn' | 'bad' | 'none'
type Filter = 'all' | Level | 'today'

const tab = ref('plan')
const month = ref(new Date().toISOString().slice(0, 7))
const viewTable = ref('资产库')
// 知识库·库模式：五个资料类别 + 按主播过滤 + 生成标准孵化手册
const libCats = [
  { label: '资产库', value: '资产库' },
  { label: '话术库', value: '话术库' },
  { label: 'PK玩法库', value: 'PK玩法库' },
  { label: '课表', value: '课表' },
  { label: '案例库', value: '案例库' }
]
const libStreamer = ref('')
const libStreamerOptions = computed<SelectOption[]>(() => [
  { label: '全部主播', value: '' },
  ...store.streamers
    .map((s: any) => String(s['主播'] || '').trim())
    .filter(Boolean)
    .map((n: string) => ({ label: n, value: n }))
])
const yesNo: SelectOption[] = [
  { label: '是', value: '是' },
  { label: '否', value: '否' }
]

const current = ref('')
const curTrack = ref('下单游戏')
const values = ref<Record<string, string>>({})
let autoSavePaused = true
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
const showExtras = ref(false)
const opFilter = ref(localStorage.getItem('inc_operator') || '')
const onlyMine = ref(localStorage.getItem('inc_only_mine') !== '0')
const statusFilter = ref<Filter>('all')
const recent = ref<string[]>(JSON.parse(localStorage.getItem('inc_recent') || '[]'))
const showImport = ref(false)
const showEditStreamer = ref(false)
const editStreamerBusy = ref(false)
const deleteStreamerBusy = ref(false)
const editStreamerForm = ref({ oldName: '', name: '', operator: '', track: '' })
const importText = ref('')
const importOp = ref(localStorage.getItem('inc_operator') || '')
const importTrack = ref('下单游戏')
const showAddOne = ref(false)
const addOneBusy = ref(false)
const addOneForm = ref({ name: '', operator: '', contact: '', track: '', joinDate: '', firstLive: '' })
const statusBusy = ref(false)
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

function isDeparted(name: string): boolean {
  const s = store.streamers.find((x: any) => String(x['主播'] || '').trim() === name)
  return !!String(s?.['离司日期'] || '').trim()
}

function streamerLabel(name: string): string {
  const op = operatorOf(name)
  return [name, op ? `（${op}）` : '', isDeparted(name) ? ' · 已离司' : ''].join('')
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
  filteredStreamers.value.map((n) => ({ label: streamerLabel(n), value: n }))
)

// ================= 培训计划：导入 AI 报告 → 60 天计划 → 每日反馈 =================
function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const planStreamer = ref('')
const autoSaveText = ref('等待输入')
const planStreamerName = computed(() => planStreamer.value === ALL_PLAN ? '全部主播' : (planStreamer.value || '未选择主播'))
const topScoreDefs = computed(() => store.common.filter((d: any) => d.kind === 'rate').slice(0, 5))
const ALL_PLAN = '__all__'
const planTrack = ref('')
const planStart = ref(localDate())
const planInfo = ref<any>(null)
const planBusy = ref(false)
const fbBusy = ref(false)
const showPaste = ref(false)
const pasteText = ref('')
const showCustomCourse = ref(false)
const customBusy = ref(false)
const customCourse = ref({ id: 0, 日期: '', 今天练什么: '', 怎么练: '', 验收: '' })
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
const showProfile = ref(false)
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
    await store.saveStreamerProfile(planStreamer.value, { ...profile.value, 赛道: planTrack.value || store.defaultTrack })
    showProfile.value = false
    msg.success('主播档案已保存')
  } catch (e: any) { msg.error('保存失败：' + (e?.message || e)) } finally { profileBusy.value = false }
}

async function onPlanTrackChanged(track: string) {
  planTrack.value = track || ''
  if (!track || !planStreamer.value || planStreamer.value === ALL_PLAN) return
  try {
    await store.updateStreamerTrack(planStreamer.value, track)
    msg.success(`赛道已保存：${track}`)
  } catch (e: any) {
    msg.error('赛道保存失败：' + (e?.message || e))
  }
}

async function departCurrentStreamer() {
  const name = String(planStreamer.value || '').trim()
  if (!name || name === ALL_PLAN) return msg.warning('请先选择一个具体主播')
  const date = String(profile.value['离司日期'] || today).trim() || today
  statusBusy.value = true
  try {
    await store.departStreamer(name, date)
    profile.value['离司日期'] = date
    await Promise.all([loadAllFeedback(), loadWeekTasks()])
    msg.success(`已标记离司：${name}（${date}）`)
  } catch (e: any) {
    msg.error('标记离司失败：' + (e?.message || e))
  } finally {
    statusBusy.value = false
  }
}

async function restoreCurrentStreamer() {
  const name = String(planStreamer.value || '').trim()
  if (!name || name === ALL_PLAN) return msg.warning('请先选择一个具体主播')
  statusBusy.value = true
  try {
    await store.restoreStreamer(name)
    profile.value['离司日期'] = ''
    await Promise.all([loadAllFeedback(), loadWeekTasks()])
    msg.success(`已恢复在职：${name}`)
  } catch (e: any) {
    msg.error('恢复在职失败：' + (e?.message || e))
  } finally {
    statusBusy.value = false
  }
}

function openEditStreamer() {
  const name = String(planStreamer.value || '').trim()
  if (!name || name === ALL_PLAN) return msg.warning('请先选择一个具体主播')
  const roster = store.streamers.find((x: any) => String(x['主播'] || '').trim() === name)
  editStreamerForm.value = {
    oldName: name,
    name,
    operator: String(roster?.['带教运营'] || opFilter.value || ''),
    track: store.trackOf(name) || store.defaultTrack
  }
  showEditStreamer.value = true
}

async function saveStreamerIdentity() {
  const form = editStreamerForm.value
  const oldName = String(form.oldName || '').trim()
  const nextName = String(form.name || '').trim()
  if (!oldName) return msg.warning('没有选中要修改的主播')
  if (!nextName) return msg.warning('主播姓名不能为空')
  editStreamerBusy.value = true
  try {
    const r: any = await store.updateStreamerIdentity(oldName, { name: nextName, operator: form.operator, track: form.track })
    recent.value = recent.value.map((x) => x === oldName ? r.name : x)
    localStorage.setItem('inc_recent', JSON.stringify(recent.value))
    if (planStreamer.value === oldName || current.value === oldName) {
      planStreamer.value = r.name
      current.value = r.name
      planTrack.value = r.track
      curTrack.value = r.track
      loadProfile(r.name)
      await Promise.all([loadPlanFor(r.name), loadTodayScores(r.name), loadWeekTasks(), loadAllFeedback()])
    } else {
      await Promise.all([loadWeekTasks(), loadAllFeedback()])
    }
    showEditStreamer.value = false
    msg.success(oldName === r.name ? '主播资料已修改' : `已改名：${oldName} → ${r.name}`)
  } catch (e: any) {
    msg.error('修改失败：' + (e?.message || e))
  } finally {
    editStreamerBusy.value = false
  }
}

async function deleteCurrentStreamer() {
  const name = String(editStreamerForm.value.oldName || '').trim()
  if (!name) return msg.warning('没有选中要删除的主播')
  deleteStreamerBusy.value = true
  try {
    await store.deleteStreamer(name)
    showEditStreamer.value = false
    recent.value = recent.value.filter((x) => x !== name)
    localStorage.setItem('inc_recent', JSON.stringify(recent.value))
    planStreamer.value = ''
    current.value = ''
    planInfo.value = null
    loadProfile('')
    ensureSelection()
    const next = String(filteredStreamers.value[0] || '')
    if (next) await onPlanStreamer(next)
    await Promise.all([loadWeekTasks(), loadAllFeedback()])
    msg.success(`已删除错误主播：${name}。录像、素材包和报告文件未删除。`)
  } catch (e: any) {
    msg.error('删除失败：' + (e?.message || e))
  } finally {
    deleteStreamerBusy.value = false
  }
}

function openCustomCourse() {
  if (!planStreamer.value || planStreamer.value === ALL_PLAN) return msg.warning('请先选择一个具体主播')
  customCourse.value = { id: 0, 日期: today, 今天练什么: '', 怎么练: '', 验收: '' }
  showCustomCourse.value = true
}

function editCustomCourse(row: any) {
  customCourse.value = {
    id: Number(row?.id) || 0,
    日期: String(row?.['执行日期'] || today),
    今天练什么: String(row?.['今天练什么'] || ''),
    怎么练: String(row?.['怎么练'] || ''),
    验收: String(row?.['验收'] || '')
  }
  showCustomCourse.value = true
}

async function saveCustomCourse() {
  if (!planStreamer.value || planStreamer.value === ALL_PLAN) return msg.warning('请先选择一个具体主播')
  if (!customCourse.value.今天练什么.trim()) return msg.warning('先填今天练什么')
  customBusy.value = true
  try {
    const payload = {
      streamer: planStreamer.value,
      date: customCourse.value.日期 || today,
      title: customCourse.value.今天练什么,
      how: customCourse.value.怎么练,
      accept: customCourse.value.验收,
      operator: opFilter.value.trim()
    }
    if (customCourse.value.id) await store.updateCustomCourse(customCourse.value.id, payload)
    else await store.addCustomCourse(payload)
    showCustomCourse.value = false
    await Promise.all([loadPlanFor(planStreamer.value), loadWeekTasks()])
    msg.success(customCourse.value.id ? '运营自定义计划已修改' : '运营自定义计划已添加')
  } catch (e: any) {
    msg.error('添加课程失败：' + (e?.message || e))
  } finally {
    customBusy.value = false
  }
}

async function deleteCustomCourse(row: any) {
  try {
    await store.removeCourse(Number(row.id))
    if (planStreamer.value && planStreamer.value !== ALL_PLAN) await loadPlanFor(planStreamer.value)
    await loadWeekTasks()
    msg.success('运营课程已删除')
  } catch (e: any) {
    msg.error('删除课程失败：' + (e?.message || e))
  }
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
  dayPhase.value = Number(p.to) <= 60 ? `${p.from}-${p.to}` : 'all'
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
const weekFocus = ref(false)
const selectedWeekTask = ref<any | null>(null)
const weekPalette = ['#2563eb', '#0891b2', '#7c3aed', '#c2410c', '#15803d', '#be123c', '#4f46e5']
function weekColor(row: any): string {
  const text = String(row?._date || row?.['日期'] || '')
  let n = 0
  for (let i = 0; i < text.length; i++) n = (n * 31 + text.charCodeAt(i)) >>> 0
  return weekPalette[n % weekPalette.length]
}
function weekRowProps(row: any) {
  const color = weekColor(row)
  return {
    style: `cursor:pointer;border-left:4px solid ${color};background:${weekFocus.value ? '#ffffff' : '#f8fbfd'}`,
    onClick: () => { selectedWeekTask.value = row }
  }
}
const weekColumns: DataTableColumns<any> = [
  { title: '日期', key: '日期', width: 118, render: (row: any) => h('span', { class: 'week-date-chip', style: `--week-color:${weekColor(row)}` }, row['日期']) },
  { title: '主播', key: '主播', width: 110 },
  { title: '赛道', key: '赛道', width: 90 },
  { title: '来源', key: '来源', width: 92 },
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
        const dayRows = (rows || []).filter((r: any) => String(r['主播'] || '').trim() === name && String(r['日期']) === `D${idx}`)
        const person = (roster || []).find((r: any) => String(r['主播'] || '').trim() === name)
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
        const leaveEnd = String(person?.['请假结束日期'] || person?.['请假开始日期'] || '')
        if (person?.['请假开始日期'] && leaveEnd && ds >= String(person['请假开始日期']) && ds <= leaveEnd) {
          out.push({ _sort: d.getTime(), _date: ds, 日期: `${week} ${d.getMonth() + 1}/${d.getDate()}`, 主播: name, 赛道: p['赛道'] || '', 来源: '请假', 天: `D${idx}`, 今天练什么: `请假${person['请假原因'] ? '：' + person['请假原因'] : ''}`, 验收: '不计完成率，不催课' })
          continue
        }
        if (!dayRows.length) continue
        for (const row of dayRows) {
          out.push({ _sort: d.getTime(), _date: ds, 日期: `${week} ${d.getMonth() + 1}/${d.getDate()}`, 主播: name, 赛道: p['赛道'] || '', 来源: courseSource(row) || 'AI计划', 天: `D${idx}`, 今天练什么: row['今天练什么'] || '', 验收: row['验收'] || '' })
        }
      }
    }
    weekTasks.value = out.sort((a, b) => Number(a._sort) - Number(b._sort) || String(a['主播']).localeCompare(String(b['主播'])))
    for (const person of roster || []) {
      const name = String(person['主播'] || '').trim()
      if (!name || names.has(name) || String(person['离司日期'] || '').trim()) continue
      out.push({ _sort: Date.now(), _date: localDate(), 日期: '新主播 · 待排课', 主播: name, 赛道: person['赛道'] || '', 来源: '待生成', 天: '-', 今天练什么: '导入 AI 报告并生成 60 天课表', 验收: '生成后自动出现在本周课表' })
    }
  } catch { /* ignore */ }
}

const planStreamerOptions = computed<SelectOption[]>(() => [
  { label: '全部主播（批量生成课表）', value: ALL_PLAN },
  ...filteredStreamers.value.map((n) => ({ label: streamerLabel(n), value: n }))
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
  { label: '1-3 天 互相了解', value: '1-3' },
  { label: '4-7 天 基础学习', value: '4-7' },
  { label: '8-15 天 上播学习', value: '8-15' },
  { label: '16-30 天 提升', value: '16-30' },
  { label: '31-60 天 巩固提升', value: '31-60' }
]

function courseSource(row: any): string {
  const src = String(row?.['课程来源'] || '').trim()
  if (src) return src
  return String(row?.['录入人'] || '').trim() === 'AI计划' ? 'AI计划' : String(row?.['录入人'] || '').trim()
}

const currentPlanDayKey = computed(() => {
  const idx = Number(planInfo.value?.dayIndex || 0)
  return idx > 0 ? `D${Math.min(idx, 60)}` : ''
})

const todayAiTask = computed(() => {
  const key = currentPlanDayKey.value
  if (!key) return null
  return store.planDays.find((r: any) => String(r['日期']) === key && courseSource(r) !== '运营自定义') || null
})

const todayCustomTasks = computed(() => {
  const key = currentPlanDayKey.value
  return store.planDays.filter((r: any) => {
    if (courseSource(r) !== '运营自定义') return false
    const day = String(r['执行日期'] || '')
    return day ? day === today : (!!key && String(r['日期'] || '') === key)
  })
})

const todayTask = computed(() => todayAiTask.value || todayCustomTasks.value[0] || null)
const todayCourseText = computed(() => [todayAiTask.value, ...todayCustomTasks.value].filter(Boolean).map((r: any) => String(r['今天练什么'] || '')).filter(Boolean).join('；'))

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

const dayColumns = computed<DataTableColumns<any>>(() => [
  { title: '天', key: '日期', width: 68 },
  { title: '来源', key: '来源', width: 96, render: (row: any) => courseSource(row) || 'AI计划' },
  { title: '今天练什么', key: '今天练什么', ellipsis: { tooltip: true } },
  { title: '验收', key: '验收', width: 250, ellipsis: { tooltip: true } },
  { title: '作业', key: '作业', width: 76, render: (row: any) => { const list = hwListByDay(String(row['日期'])); if (!list.length) return ''; return h('span', { title: list.map((w: any) => String(w['标题'] || '')).join('\n'), style: 'color: var(--ok); font-weight: 600' }, `✓ ${list.length} 份`) } },
  {
    title: '操作', key: 'ops', width: 132,
    render: (row: any) => courseSource(row) === '运营自定义'
      ? h('div', { class: 'day-ops' }, [
          h(NButton, { size: 'tiny', type: 'primary', quaternary: true, onClick: () => editCustomCourse(row) }, { default: () => '修改' }),
          h(NPopconfirm, { onPositiveClick: () => deleteCustomCourse(row) }, {
            trigger: () => h(NButton, { size: 'tiny', type: 'error', quaternary: true }, { default: () => '删除' }),
            default: () => '只删除这条运营自定义计划，AI 计划不受影响。'
          })
        ])
      : '-'
  }
])
const fbColumns: DataTableColumns<any> = [
  { title: '日期', key: '日期', width: 100 },
  { title: '主播', key: '主播', width: 110 },
  { title: '完成', key: '完成情况', width: 80 },
  { title: '数据结果', key: '数据结果', ellipsis: { tooltip: true } },
  { title: '问题', key: '问题', ellipsis: { tooltip: true } },
  { title: '明日计划', key: '明日计划', ellipsis: { tooltip: true } }
]

async function loadPlanFor(name: string) {
  if (!name) { autoSavePaused = true; planInfo.value = null; return }
  if (name === ALL_PLAN) { planInfo.value = null; return }
  const r = await store.loadPlan(name)
  planInfo.value = r
  if (r?.plan?.['赛道']) planTrack.value = String(r.plan['赛道'])
  if (r?.plan?.['开始日期']) planStart.value = String(r.plan['开始日期'])
  else if (r?.plan && !r.plan['开始日期']) planStart.value = localDate()
  fb.value['今日任务'] = todayCourseText.value
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
    autoSavePaused = true
    planInfo.value = null
    planTrack.value = ''
    current.value = ''
    return
  }
  autoSavePaused = true
  planTrack.value = store.trackOf(name) || store.defaultTrack
  loadProfile(name)
  current.value = name
  curTrack.value = planTrack.value
  await loadPlanFor(name)
  await loadTodayScores(name)
  store.loadHomework(name)
}

// ---------------- 主播作业 ----------------
const hwTitle = ref('')
const hwNote = ref('')
const hwLink = ref('')
const hwDate = ref(localDate())
const hwBusy = ref(false)
const canHomework = computed(() => !!planStreamer.value && planStreamer.value !== ALL_PLAN)

// —— 作业 × 孵化计划联动：作业按日历日期 ↔ 60 天计划的「第 N 天」对齐 ——
const planStartDate = computed(() => String(planInfo.value?.plan?.['开始日期'] || ''))
/** 日历日期 → 计划第几天（1–60），对不上返回 null */
function dateToDayIndex(d: string): number | null {
  const s = planStartDate.value
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  const n = Math.round((Date.parse(d) - Date.parse(s)) / 86400000) + 1
  return n >= 1 && n <= 60 ? n : null
}
/** 作业行显示：第 N 天 · 当天训练内容 */
function hwDayLabel(w: any): string {
  const n = dateToDayIndex(String(w['日期'] || ''))
  if (!n) return ''
  const task = store.planDays.find((r: any) => String(r['日期']) === 'D' + n && courseSource(r) !== '运营自定义')
  const t = String(task?.['今天练什么'] || '').trim()
  return `第 ${n} 天` + (t ? ' · ' + t : '')
}
/** 上传区选的日期对应第几天，选完日期一眼看到 */
const hwDateDayLabel = computed(() => {
  const n = dateToDayIndex(hwDate.value)
  return n ? `计划的第 ${n} 天` : ''
})

/** 「D5」当天的作业列表（课表作业列悬浮显示标题用） */
function hwListByDay(dayKey: string): any[] {
  return store.homeworkRows.filter((w: any) => {
    const n = dateToDayIndex(String(w['日期'] || ''))
    return n !== null && 'D' + n === dayKey
  })
}

/** 作业卡标题状态：今天对应计划第几天、作业交了没（联动一眼可见） */
const hwTodayLabel = computed(() => {
  if (!planInfo.value?.plan) return ''
  const n = dateToDayIndex(today)
  const c = store.homeworkRows.filter((w: any) => String(w['日期'] || '') === today).length
  const dayText = n ? `计划第 ${n} 天` : '计划外'
  return `今天 · ${dayText} · ${c ? `已交 ${c} 份作业` : '还没交作业'}`
})

async function pickHomework() {
  if (!canHomework.value) return
  hwBusy.value = true
  try {
    const r = await api().incubateHomeworkPick(planStreamer.value, hwTitle.value.trim(), hwNote.value.trim(), hwDate.value)
    if (r && r.ok) {
      msg.success('作业已上传存档')
      hwTitle.value = ''
      hwNote.value = ''
      await store.loadHomework(planStreamer.value)
    }
  } catch (e: any) {
    msg.error('上传失败：' + (e?.message || e))
  } finally {
    hwBusy.value = false
  }
}

async function addHwLink() {
  const u = hwLink.value.trim()
  if (!canHomework.value || !u) return
  try {
    await api().incubateHomeworkAddLink(planStreamer.value, hwTitle.value.trim(), u, hwNote.value.trim(), hwDate.value)
    msg.success('链接已登记')
    hwLink.value = ''
    await store.loadHomework(planStreamer.value)
  } catch (e: any) {
    msg.error('登记失败：' + (e?.message || e))
  }
}

async function openHw(w: any) {
  const ok = await api().incubateHomeworkOpen(Number(w.id))
  if (!ok) msg.error('打不开：文件可能已被移动或删除')
}

async function removeHw(w: any) {
  try {
    await api().incubateHomeworkDelete(Number(w.id))
    msg.success('已删除')
    await store.loadHomework(planStreamer.value)
  } catch (e: any) {
    msg.error('删除失败：' + (e?.message || e))
  }
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
  e.preventDefault()
  e.stopPropagation()
  const files = Array.from(e.dataTransfer?.files || [])
  const f = files.find((x) => /\.(md|markdown|txt|docx|doc|wps|rtf)$/i.test(x.name)) || files[0]
  let filePath = ''
  if (f) {
    try { filePath = String((window as any).electronAPI.getFilePath(f) || '') } catch { /* 下面走文本兜底 */ }
  }
  if (!filePath) {
    const raw = String(e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '').trim()
    if (/^file:\/\//i.test(raw)) {
      try {
        filePath = decodeURIComponent(new URL(raw.split(/\r?\n/)[0]).pathname).replace(/^\//, '').replace(/\//g, '\\')
      } catch { /* ignore */ }
    } else if (/^[A-Za-z]:[\\/]/.test(raw)) {
      filePath = raw.split(/\r?\n/)[0]
    }
  }
  if (filePath) return importFileAndGenerate(filePath)
  if (f && (/\.(md|markdown|txt)$/i.test(f.name) || /^text\//i.test(f.type || ''))) {
    planBusy.value = true
    try {
      const text = await f.text()
      if (!text.trim()) return msg.warning('拖进来的报告是空文件')
      await store.importReportText(text, f.name || '拖入的报告')
      if (planStreamer.value && planStreamer.value !== ALL_PLAN) await doGenerate()
      msg.success('报告已读取并导入')
    } catch (err: any) {
      msg.error('读取拖入报告失败：' + (err?.message || err))
    } finally { planBusy.value = false }
    return
  }
  msg.warning('没有识别到文件。请拖入 .md、.txt、Word 或 WPS 报告，或点击这里重新选择。')
}

async function justGenerate() {
  await doGenerate()
}

async function generateTargets() {
  const targets = planStreamer.value === ALL_PLAN ? filteredStreamers.value.slice() : [planStreamer.value]
  if (!targets.length) throw new Error('还没有主播，先点「+ 添加主播」')
  if (planStreamer.value !== ALL_PLAN && planStreamer.value && planTrack.value) {
    await store.updateStreamerTrack(planStreamer.value, planTrack.value)
  }
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
    .filter((n) => !isDeparted(n) && !onLeaveNow(n) && !onRestNow(n))
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
const displayWeekTasks = computed(() => {
  if (!weekFocus.value) return weekTasks.value
  const names = new Set<string>([planStreamer.value, ...needAttention.value.map((x: any) => x.name)].filter(Boolean))
  return weekTasks.value.filter((row: any) => names.has(String(row['主播'] || '').trim()))
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

async function loadTodayScores(name: string): Promise<void> {
  autoSavePaused = true
  const v: Record<string, string> = {}
  for (const d of store.common) v[d.key] = ''
  const session: any = name ? store.sessionsOf(name).find((row: any) => String(row['日期'] || '') === today) : null
  if (session?.values) {
    for (const d of store.common) v[d.key] = String(session.values[d.key] ?? '')
  }
  values.value = v
  autoSaveText.value = session ? '已载入今日评分' : '等待输入'
  await nextTick()
  autoSavePaused = false
}

async function autoSaveScores(): Promise<void> {
  if (autoSavePaused || !current.value || current.value === ALL_PLAN) return
  const picked: Record<string, string> = {}
  for (const d of topScoreDefs.value) picked[d.key] = String(values.value[d.key] ?? '')
  if (!Object.values(picked).some((v) => String(v).trim() !== '')) return
  autoSaveText.value = '正在自动保存…'
  try {
    await store.ensureStreamer(current.value, curTrack.value, opFilter.value.trim())
    await store.saveSession({ 日期: today, 运营: opFilter.value.trim(), 主播: current.value, 赛道: curTrack.value, values: picked })
    autoSaveText.value = `已自动保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`
  } catch (e: any) {
    autoSaveText.value = '自动保存失败，请检查数据目录'
  }
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
  void openWatchStreamer(name)
}

async function openWatchStreamer(name: string) {
  if (!name) return
  planStreamer.value = name
  current.value = name
  onPick(name, true)
  await onPlanStreamer(name)
  nextTick(() => document.querySelector('.inc-command-block')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

function onPick(name: string, addRecent = true) {
  if (!name) return
  curTrack.value = store.trackOf(name)
  void loadTodayScores(name)
  if (addRecent) {
    recent.value = [name, ...recent.value.filter((x) => x !== name)].slice(0, 6)
    localStorage.setItem('inc_recent', JSON.stringify(recent.value))
  }
}

function changeTrack(track: string) {
  if (!current.value) return
  store.updateStreamerTrack(current.value, track).catch(() => { /* 档案里没有这人就算了 */ })
  if (!autoSavePaused) autoSaveScores().catch(() => { /* 自动保存会记录状态 */ })
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
  { title: '运营', key: '运营', width: 86, render: (row: any) => h(NButton, { size: 'tiny', quaternary: true, type: 'primary', title: '跳到「主播跟踪」只看他带的主播', onClick: () => viewOperatorStreamers(row['运营']) }, { default: () => row['运营'] || '-' }) },
  { title: '在职主播', key: '主播数', width: 72 },
  { title: '已离司', key: '已离司', width: 64 },
  { title: '离职率', key: '离职率', width: 64, render: (row: any) => `${row['离职率'] || 0}%` },
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

/** 考核表点运营名字 → 跳到主播跟踪，只看他带的主播（考核和主播档案联动） */
function viewOperatorStreamers(name: any) {
  const n = String(name || '').trim()
  if (!n) return
  onOperatorName(n)
  onlyMine.value = true
  saveOnlyMine()
  tab.value = 'plan'
  msg.info(`已跳到「主播跟踪」，只看 ${n} 带的主播`)
}

async function loadView(v: string) {
  await store.switchTable(String(v))
}

// ---------------------------------------------------------------- 知识库·库模式

function switchLibCat(v: string) {
  if (v === viewTable.value) return
  viewTable.value = v
  if (v === '话术库') loadScripts()
  else loadView(v)
}

/** 选中主播的赛道（案例库按它过滤） */
const libStreamerTrack = computed(() => {
  if (!libStreamer.value) return ''
  const s = store.streamers.find((x: any) => String(x['主播'] || '').trim() === libStreamer.value)
  return String(s?.['赛道'] || '').trim()
})

/** 表格类资料按主播过滤：课表看人、资产看「适用主播」、案例看同赛道 */
const libRows = computed(() => {
  const rows = store.rows || []
  const name = libStreamer.value
  if (!name) return rows
  if (viewTable.value === '课表') return rows.filter((r: any) => String(r['主播'] || '').trim() === name)
  if (viewTable.value === '资产库') {
    return rows.filter((r: any) => {
      const fit = String(r['适用主播'] || '').trim()
      return !fit || fit === '通用' || fit.includes(name)
    })
  }
  if (viewTable.value === '案例库') {
    const t = libStreamerTrack.value
    return t ? rows.filter((r: any) => String(r['赛道'] || '').trim() === t) : rows
  }
  return rows
})

const libHint = computed(() => {
  const name = libStreamer.value
  const base: Record<string, string> = {
    资产库: '拆解产出的可复制资产（话术片段/节目/道具），可导入报告自动入库',
    话术库: '主播在直播间照着念的回话方案，按对话场景分区；支持 PDF/Word/TXT/CSV 一键导入',
    PK玩法库: 'PK 输了做的惩罚玩法，每条带安全提示；支持 PDF/Word/TXT/CSV 一键导入，已内置 200 条规避风险玩法',
    课表: '每个主播的 60 天孵化计划与运营自定义课程',
    案例库: '历史场次的成功案例，可直接打开视频和报告'
  }
  const cur = base[viewTable.value] || ''
  if (!name) return cur + '。选一个主播可以只看他相关的资料。'
  if (viewTable.value === '话术库' || viewTable.value === 'PK玩法库') return cur + '。这是通用库，不分主播；点「生成标准孵化手册」会收进该主播的手册。'
  if (viewTable.value === '课表') return `只看「${name}」的课表。`
  if (viewTable.value === '资产库') return `只看适用「${name}」和通用的资产。`
  if (viewTable.value === '案例库') return `只看「${name}」同赛道（${libStreamerTrack.value || '未填赛道'}）的案例。`
  return cur
})

// ---------------------------------------------------------------- 话术库

const scriptRows = ref<any[]>([])
const scriptScene = ref('全部')
const scriptKw = ref('')
const showScript = ref(false)
const scriptBusy = ref(false)
const scriptForm = ref<any>({ id: 0, 场景: '', 游客说: '', 回复方案: '', 出处: '' })
let scriptLoaded = false

const scriptScenes = computed(() => {
  const cats = scriptRows.value.map((r) => String(r['场景'] || '').trim()).filter(Boolean)
  return ['全部', ...Array.from(new Set(cats))]
})
const scriptSceneOptions = computed<SelectOption[]>(() =>
  scriptScenes.value.filter((c) => c !== '全部').map((c) => ({ label: c, value: c }))
)
const scriptShown = computed(() => {
  const kw = scriptKw.value.trim()
  const filtered = scriptRows.value.filter((r) => {
    if (scriptScene.value !== '全部' && String(r['场景'] || '').trim() !== scriptScene.value) return false
    if (!kw) return true
    return `${r['场景']} ${r['游客说']} ${r['回复方案']} ${r['出处']}`.includes(kw)
  })
  return filtered.slice(0, scriptLimit.value)
})
const scriptTotal = computed(() => {
  const kw = scriptKw.value.trim()
  return scriptRows.value.filter((r) => {
    if (scriptScene.value !== '全部' && String(r['场景'] || '').trim() !== scriptScene.value) return false
    if (!kw) return true
    return `${r['场景']} ${r['游客说']} ${r['回复方案']} ${r['出处']}`.includes(kw)
  }).length
})
// 大库防卡：默认只渲染前 80 张卡片，点「加载更多」逐步放开
const scriptLimit = ref(80)
watch([scriptScene, scriptKw], () => { scriptLimit.value = 80 })

async function loadScripts(force = false) {
  if (scriptLoaded && !force) return
  try {
    // 幂等：空表自动灌种子，老用户第一次打开话术库就有内置内容
    await api().incubateSeed()
    scriptRows.value = await api().incubateList('话术库')
    scriptLoaded = true
  } catch (e: any) {
    msg.error('话术库加载失败：' + (e?.message || e))
  }
}

// ---------------------------------------------------------------- 资料一键导入（话术库 / PK玩法库）
const importBusy = ref(false)
async function importKnowledgeFile() {
  const table = viewTable.value
  if (table !== '话术库' && table !== 'PK玩法库') return
  importBusy.value = true
  try {
    const r = await api().incubateKnowledgePick(table)
    if (!r || r.canceled) return
    if (r.error) { msg.error(r.error); return }
    // 确认导入：告诉运营识别出多少条、来自哪个文件
    const unit = table === 'PK玩法库' ? '条玩法' : '条话术'
    const ok = await new Promise<boolean>((resolve) => {
      dialog.warning({
        title: '一键导入资料',
        content: `从「${r.fileName}」识别出 ${r.total} ${unit}，导入到「${table}」？\n（已经有的会自动跳过，不会重复）`,
        positiveText: '导入',
        negativeText: '取消',
        onPositiveClick: () => resolve(true),
        onNegativeClick: () => resolve(false),
        onClose: () => resolve(false)
      })
    })
    if (!ok) return
    const res = await api().incubateKnowledgeImport(table, r.rows)
    msg.success(`导入完成：新增 ${res.added} ${unit}${res.skipped ? `，跳过已有 ${res.skipped} 条` : ''}`)
    if (table === '话术库') await loadScripts(true)
    else await store.switchTable(viewTable.value)
  } catch (e: any) {
    msg.error('导入失败：' + (e?.message || e))
  } finally {
    importBusy.value = false
  }
}

function openScriptEdit(row?: any) {
  if (row) {
    scriptForm.value = { id: Number(row.id), 场景: row['场景'] || '', 游客说: row['游客说'] || '', 回复方案: row['回复方案'] || '', 出处: row['出处'] || '' }
  } else {
    scriptForm.value = { id: 0, 场景: scriptScene.value !== '全部' ? scriptScene.value : '', 游客说: '', 回复方案: '', 出处: '' }
  }
  showScript.value = true
}

async function saveScript() {
  const f = scriptForm.value
  if (!String(f['游客说'] || '').trim()) return msg.warning('先写「游客说」的触发例句')
  if (!String(f['回复方案'] || '').trim()) return msg.warning('先写「回复方案」')
  scriptBusy.value = true
  try {
    const row = {
      场景: String(f['场景'] || '').trim() || '未分类',
      游客说: String(f['游客说'] || '').trim(),
      回复方案: String(f['回复方案'] || '').trim(),
      出处: String(f['出处'] || '').trim(),
      更新时间: today
    }
    if (f.id) await api().incubateUpdate('话术库', Number(f.id), row)
    else await api().incubateAdd('话术库', row)
    showScript.value = false
    await loadScripts(true)
    msg.success(f.id ? '已保存修改' : '已添加')
  } catch (e: any) {
    msg.error('保存失败：' + (e?.message || e))
  } finally {
    scriptBusy.value = false
  }
}

async function removeScript(row: any) {
  try {
    await api().incubateDelete('话术库', Number(row.id))
    await loadScripts(true)
    msg.success('已删除')
  } catch (e: any) {
    msg.error('删除失败：' + (e?.message || e))
  }
}

// ---------------------------------------------------------------- 标准孵化手册

const showManual = ref(false)
const manualBusy = ref(false)
const manualText = ref('')
const manualTitle = ref('标准孵化手册')
const manualNote = ref('')

function trunc(s: string, n: number): string {
  const t = String(s || '').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

/** 汇总一个主播的全部资料，拼成本地版手册（AI 不可用时也能直接出） */
function assembleManualLocal(name: string, profile: any, plans: any[], scripts: any[], assets: any[], cases: any[], mindsets: any[]): string {
  const L: string[] = []
  L.push(`# ${name} · 标准孵化手册`)
  L.push('')
  L.push(`> 生成日期：${today} ｜ 带教运营：${profile?.['带教运营'] || '未填'} ｜ 赛道：${profile?.['赛道'] || '未填'} ｜ 入司：${profile?.['入司日期'] || '未填'} ｜ 首播：${profile?.['首播日期'] || '未播'}`)
  L.push('')
  L.push('## 一、主播档案')
  L.push(`- 当前等级：${profile?.['当前等级'] || '未评'}　配合意愿：${profile?.['配合意愿'] || '未填'}　是否正常开播：${profile?.['是否正常开播'] || '未填'}`)
  if (profile?.['联系方式']) L.push(`- 联系方式：${profile['联系方式']}`)
  if (profile?.['固定休息日']) L.push(`- 固定休息日：${profile['固定休息日']}`)
  L.push('')
  L.push(`## 二、60 天孵化计划（共 ${plans.length} 天课表）`)
  if (plans.length) {
    for (const p of plans) {
      L.push(`- ${p['日期'] || p['执行日期'] || ''}｜${trunc(p['今天练什么'], 40)}｜怎么练：${trunc(p['怎么练'], 50)}｜验收：${trunc(p['验收'], 30)}`)
    }
  } else L.push('（还没有课表：先在「主播跟踪」导入 AI 报告生成 60 天计划）')
  L.push('')
  L.push('## 附、运营标准工作（阶段与复盘节奏）')
  L.push('- 阶段：1-3 天互相了解（找对标直播间、拆解）→ 4-7 天基础学习 → 8-15 天上播学习 → 16-30 天提升 → 31-60 天巩固提升')
  L.push('- 复盘：前 30 天每天下播后当日复盘（写 3 条改进，明天验证 1 条）；31-60 天每三天复盘一次；60 天以后每周复盘 + 学习')
  L.push('- 判断标准（音浪是标准不是任务）：20 万基础｜30 万成熟｜60 万进阶｜100 万以上优秀；第 40 天达 20 万即孵化成功')
  L.push('')
  L.push(`## 三、直播间话术库（按场景，共 ${scripts.length} 条）`)
  const byScene = new Map<string, any[]>()
  for (const s of scripts) {
    const k = String(s['场景'] || '未分类')
    if (!byScene.has(k)) byScene.set(k, [])
    byScene.get(k)!.push(s)
  }
  for (const [scene, list] of byScene) {
    L.push(`### ${scene}`)
    for (const s of list) L.push(`- 游客说「${trunc(s['游客说'], 30)}」→ ${trunc(s['回复方案'], 80)}`)
  }
  L.push('')
  L.push(`## 四、可复制资产（适用本主播 + 通用，共 ${assets.length} 条）`)
  if (assets.length) for (const a of assets) L.push(`- [${a['编号'] || ''}] ${a['类型'] || ''}：${trunc(a['内容'], 60)}`)
  else L.push('（暂无：在知识库导入拆解报告自动入库）')
  L.push('')
  L.push(`## 五、同赛道案例（共 ${cases.length} 条）`)
  if (cases.length) for (const c of cases) L.push(`- ${c['案例名'] || ''}：证明了${trunc(c['证明了什么'], 50)}`)
  else L.push('（暂无同赛道案例）')
  L.push('')
  L.push(`## 六、心态调整预案（主播高发问题 ${mindsets.length} 条）`)
  for (const m of mindsets) L.push(`- 【${m['分类'] || ''}】${trunc(m['问题'], 30)} → 应对：${trunc(m['应对动作'], 50)}`)
  L.push('')
  L.push('—— 本手册由系统根据知识库资料自动汇编，可按主播风格增删后打印使用。')
  return L.join('\n')
}

async function generateManual() {
  const name = libStreamer.value
  if (!name) return msg.warning('先在右上角选一个主播')
  manualBusy.value = true
  try {
    const profile = store.streamers.find((x: any) => String(x['主播'] || '').trim() === name)
    const [allPlans, scripts, allAssets, allCases, allMindset] = await Promise.all([
      api().incubateList('课表'),
      api().incubateList('话术库'),
      api().incubateList('资产库'),
      api().incubateList('案例库'),
      api().incubateList('心态调整')
    ])
    const plans = (allPlans || []).filter((r: any) => String(r['主播'] || '').trim() === name)
    const track = String(profile?.['赛道'] || '').trim()
    const assets = (allAssets || []).filter((r: any) => {
      const fit = String(r['适用主播'] || '').trim()
      return !fit || fit === '通用' || fit.includes(name)
    })
    const cases = track ? (allCases || []).filter((r: any) => String(r['赛道'] || '').trim() === track) : (allCases || [])
    const mindsets = (allMindset || []).filter((r: any) => String(r['对象'] || '主播') === '主播')

    const local = assembleManualLocal(name, profile, plans, scripts || [], assets, cases, mindsets)
    manualTitle.value = `${name} · 标准孵化手册`

    // 有 AI 配置就让 AI 把手册写得更像正式文档；失败/未配置就用本地汇编版
    try {
      const aiText = await api().aiChatText(
        '你是资深抖音直播运营总监。把给你的资料汇编改写成一份可直接打印使用的《主播标准孵化手册》。' +
        '要求：结构清晰（档案→60天计划→话术库→资产→案例→心态预案），话术和课表逐条保留不得省略，' +
        '语气像带教手册（告诉运营每一步怎么做），输出 Markdown，不要加资料里没有的内容。',
        local
      )
      manualText.value = String(aiText || '').trim() || local
      manualNote.value = '已由 AI 整理成正式手册。话术与课表逐条保留；可直接复制或导出 .md 打印。'
    } catch (e: any) {
      manualText.value = local
      manualNote.value = 'AI 不可用（' + trunc(e?.message || String(e), 60) + '），已用系统本地汇编版——内容一样全，只是没润色。'
    }
    showManual.value = true
  } catch (e: any) {
    msg.error('生成失败：' + (e?.message || e))
  } finally {
    manualBusy.value = false
  }
}

async function copyManual() {
  try {
    await navigator.clipboard.writeText(manualText.value)
    msg.success('已复制，直接粘到文档/微信都行')
  } catch {
    msg.warning('复制失败，请手动全选复制')
  }
}

async function exportManual() {
  try {
    const p = await api().aiSaveText(`${manualTitle.value}.md`, manualText.value)
    if (p) msg.success('已保存：' + p)
  } catch (e: any) {
    msg.error('保存失败：' + (e?.message || e))
  }
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
    const r: any = await store.importStreamers(importText.value, importOp.value.trim(), importTrack.value)
    msg.success(`名册导入：新增 ${r?.added ?? 0}、更新 ${r?.updated ?? 0}`)
    ensureSelection()
    showImport.value = false
    await loadWeekTasks()
    importText.value = ''
  } catch (e: any) {
    msg.error('导入失败：' + (e?.message || e))
  }
}

function openAddStreamer() {
  addOneForm.value = { name: '', operator: opFilter.value.trim(), contact: '', track: planTrack.value || store.defaultTrack, joinDate: today, firstLive: '' }
  showAddOne.value = true
}

function switchToBatch() {
  showAddOne.value = false
  importOp.value = opFilter.value.trim()
  importTrack.value = planTrack.value || store.defaultTrack
  showImport.value = true
}

/** 单个添加：走人事同一个 hrAddOne —— 同名视为同一人、只补不冲、绝不重复建档，两端天然对齐 */
async function doAddOne() {
  const name = addOneForm.value.name.trim()
  if (!name) return msg.warning('先填主播姓名')
  addOneBusy.value = true
  try {
    const r: any = await api().hrAddOne({
      name,
      operator: addOneForm.value.operator.trim(),
      contact: addOneForm.value.contact.trim(),
      track: addOneForm.value.track,
      joinDate: addOneForm.value.joinDate,
      firstLive: addOneForm.value.firstLive
    })
    if (r?.added) msg.success(`已添加 ${name}`)
    else if (r?.updated) msg.success(`${name} 已有档案，新信息已补齐`)
    else msg.info(`${name} 档案已存在，内容一致无需改动`)
    showAddOne.value = false
    await store.loadStreamers()
    ensureSelection()
    await loadWeekTasks()
    await onPlanStreamer(name)   // 添加完直接选中新主播开干
  } catch (e: any) {
    msg.error('添加失败：' + (e?.message || e))
  } finally {
    addOneBusy.value = false
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

watch(values, () => {
  if (autoSavePaused) return
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(() => { autoSaveScores().catch(() => { /* 状态已记录 */ }) }, 900)
}, { deep: true })

// ---------------------------------------------------------------- 心态调整（多方心态问题库：主播/运营/管理者）
const mindsetRows = ref<any[]>([])
const mindsetRole = ref('全部')
const mindsetCat = ref('全部')
const mindsetKw = ref('')
const showMindset = ref(false)
const mindsetBusy = ref(false)
const mindsetForm = ref<any>({ id: 0, 对象: '主播', 分类: '', 问题: '', 疏导回复: '', 应对动作: '' })
let mindsetLoaded = false

const mindsetRoleTabs = ['全部', '主播', '运营', '管理者']
const mindsetRoleOptions: SelectOption[] = [
  { label: '主播（运营照着说）', value: '主播' },
  { label: '运营（管理端照着说）', value: '运营' },
  { label: '管理者（自己想通照着做）', value: '管理者' }
]

// 切换对象时分类从头选，避免选了个该对象没有的分类
watch(mindsetRole, () => { mindsetCat.value = '全部' })

const mindsetCategories = computed(() => {
  const cats = mindsetRows.value
    .filter((r) => mindsetRole.value === '全部' || String(r['对象'] || '主播') === mindsetRole.value)
    .map((r) => String(r['分类'] || '').trim())
    .filter(Boolean)
  return ['全部', ...Array.from(new Set(cats))]
})

const mindsetCatOptions = computed<SelectOption[]>(() =>
  mindsetCategories.value.filter((c) => c !== '全部').map((c) => ({ label: c, value: c }))
)

const mindsetShown = computed(() => {
  const kw = mindsetKw.value.trim()
  return mindsetRows.value.filter((r) => {
    if (mindsetRole.value !== '全部' && String(r['对象'] || '主播') !== mindsetRole.value) return false
    if (mindsetCat.value !== '全部' && String(r['分类'] || '').trim() !== mindsetCat.value) return false
    if (!kw) return true
    const hay = `${r['对象']} ${r['分类']} ${r['问题']} ${r['疏导回复']} ${r['应对动作']}`
    return hay.includes(kw)
  })
})

function mindsetReplyLabel(row: any): string {
  const o = String(row['对象'] || '主播')
  if (o === '运营') return '疏导回复 · 管理端照着说'
  if (o === '管理者') return '自我提醒 · 自己想通'
  return '疏导回复 · 运营照着说'
}

function mindsetActionLabel(row: any): string {
  const o = String(row['对象'] || '主播')
  if (o === '主播') return '应对动作 · 说完带着做'
  if (o === '运营') return '应对动作 · 落地管理动作'
  return '应对动作 · 回去就做'
}

async function loadMindset(force = false) {
  if (mindsetLoaded && !force) return
  try {
    // 幂等：只给空表灌种子，老用户第一次打开这个 tab 也能拿到内置内容
    await api().incubateSeed()
    mindsetRows.value = await api().incubateList('心态调整')
    mindsetLoaded = true
  } catch (e: any) {
    msg.error('心态调整加载失败：' + (e?.message || e))
  }
}

function openMindsetEdit(row?: any) {
  if (row) {
    mindsetForm.value = { id: Number(row.id), 对象: row['对象'] || '主播', 分类: row['分类'] || '', 问题: row['问题'] || '', 疏导回复: row['疏导回复'] || '', 应对动作: row['应对动作'] || '' }
  } else {
    mindsetForm.value = {
      id: 0,
      对象: mindsetRole.value !== '全部' ? mindsetRole.value : '主播',
      分类: mindsetCat.value !== '全部' ? mindsetCat.value : '',
      问题: '', 疏导回复: '', 应对动作: ''
    }
  }
  showMindset.value = true
}

async function saveMindset() {
  const f = mindsetForm.value
  if (!String(f['问题'] || '').trim()) return msg.warning('先填写问题 / 场景')
  if (!String(f['疏导回复'] || '').trim()) return msg.warning('先填写疏导回复')
  mindsetBusy.value = true
  try {
    const row = {
      对象: String(f['对象'] || '').trim() || '主播',
      分类: String(f['分类'] || '').trim() || '未分类',
      问题: String(f['问题'] || '').trim(),
      疏导回复: String(f['疏导回复'] || '').trim(),
      应对动作: String(f['应对动作'] || '').trim(),
      更新时间: today
    }
    if (f.id) {
      await api().incubateUpdate('心态调整', Number(f.id), row)
    } else {
      await api().incubateAdd('心态调整', row)
    }
    showMindset.value = false
    await loadMindset(true)
    msg.success(f.id ? '已保存修改' : '已添加')
  } catch (e: any) {
    msg.error('保存失败：' + (e?.message || e))
  } finally {
    mindsetBusy.value = false
  }
}

async function removeMindset(row: any) {
  try {
    await api().incubateDelete('心态调整', Number(row.id))
    await loadMindset(true)
    msg.success('已删除')
  } catch (e: any) {
    msg.error('删除失败：' + (e?.message || e))
  }
}

watch(tab, (t) => {
  if (t === 'mindset') loadMindset()
  if (t === 'asset' && viewTable.value === '话术库') loadScripts()
})

onMounted(async () => {
  await store.loadTracks()
  await store.loadSchema()
  await store.loadStreamers()
  await store.loadSessions()
  await store.loadSchedule()
  await store.switchTable(viewTable.value)
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
    await loadTodayScores(planStreamer.value)
    store.loadHomework(planStreamer.value)
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
.edit-streamer-note { display:flex; flex-direction:column; gap:4px; padding:12px 14px; border:1px solid var(--line-2); border-radius:10px; background:var(--pulse-soft); }
.edit-streamer-note b { color:var(--pulse-deep); font-size:14px; }
.edit-streamer-note span { color:var(--pulse-deep); font-size:12.5px; line-height:1.6; }
.edit-streamer-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-top:14px; }
.delete-streamer-zone { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-top:16px; padding:13px 14px; border:1px solid var(--bad-soft); border-radius:10px; background:var(--bad-soft); }
.delete-streamer-zone > div { display:flex; flex-direction:column; gap:3px; min-width:0; }
.delete-streamer-zone b { color:var(--bad); font-size:13.5px; }
.delete-streamer-zone span { color:var(--bad); font-size:12.5px; line-height:1.55; }
.edit-streamer-footer { display:flex; justify-content:flex-end; gap:9px; }
@media (max-width:760px) { .edit-streamer-grid { grid-template-columns:1fr; } .delete-streamer-zone { align-items:flex-start; flex-direction:column; } }
.inc-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 8px; }
.inc-title { font-size: var(--fs-h1); font-weight: 700; letter-spacing: -0.2px; margin: 0 0 4px; color: var(--ink); }
.inc-subtitle { font-size: var(--fs-meta); color: var(--ink-3); }
.picker { display: flex; align-items: center; gap: 10px; margin: 10px 0 6px; flex-wrap: wrap; }
.switch-wrap { display: flex; align-items: center; gap: 6px; }
.groups { display: flex; align-items: center; gap: 8px; margin: 6px 0; flex-wrap: wrap; }
.chip { display: flex; align-items: baseline; gap: 6px; padding: 4px 10px; background: var(--surface); border: 1px solid var(--line-2); border-radius: 999px; cursor: pointer; user-select: none; transition: background-color 0.15s ease, border-color 0.15s ease; }
.chip b { font-size: 15px; }
.chip span { font-size: 12px; color: var(--ink-3); }
.chip.ok { border-color: rgba(22, 122, 74, 0.3); background: var(--ok-soft); } .chip.ok b { color: var(--ok); }
.chip.warn { border-color: rgba(180, 131, 12, 0.32); background: var(--warn-soft); } .chip.warn b { color: var(--warn); }
.chip.bad { border-color: rgba(192, 57, 43, 0.3); background: var(--bad-soft); } .chip.bad b { color: var(--bad); }
.chip.today { border-color: rgba(31, 78, 138, 0.35); background: var(--pulse-soft); } .chip.today b { color: var(--pulse-deep); }
.chip.none b { color: var(--ink-4); }
.chip.active { border-color: rgba(31, 78, 138, 0.4); background: var(--pulse-soft); }
.watch { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 6px 0 4px; }
.dot.warn { color: var(--warn); } .dot.bad { color: var(--bad); } .dot.none { color: var(--ink-4); }
.recent { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; flex-wrap: wrap; }
/* 填报卡：浅色卡面 + 左侧紫罗兰色带，是这一页唯一的强调 */
.card { position: relative; overflow: hidden; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); padding: 18px 18px 18px 20px; margin: 10px 0 14px; box-shadow: var(--shadow-panel); }
.card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--pulse-line); }
.card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap; gap: 8px; }
.who { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.who b { font-size: 16px; color: var(--ink); }
.tag { font-size: 12px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--surface-2); color: var(--ink-3); }
.tag.ok { border-color: rgba(22, 122, 74, 0.35); background: var(--ok-soft); color: var(--ok); }
.tag.warn { border-color: rgba(180, 131, 12, 0.35); background: var(--warn-soft); color: var(--brand); }
.tag.bad { border-color: rgba(192, 57, 43, 0.35); background: var(--bad-soft); color: var(--bad); }
.metrics { display: grid; grid-template-columns: repeat(2, minmax(200px, 1fr)); gap: 14px 18px; margin: 10px 0; }
.metric { display: flex; flex-direction: column; gap: 5px; }
.mlabel { font-size: 13.5px; font-weight: 600; color: var(--ink-2); }
.extras { margin: 6px 0; }
.actions { display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
.hint { font-size: 12px; color: var(--ink-4); }

/* 「今天该盯」：一个人一个小卡片，字大一号，一眼看得出来是几个人 */
.watch { margin-bottom: 10px; }
.watch-title { font-size: 14px; font-weight: 700; color: var(--ink); margin-bottom: 6px; }
.watch-list { display: flex; flex-wrap: wrap; gap: 8px; }
.watch-item {
  padding: 6px 12px; border-radius: 10px; height: auto;
  border: 1px solid var(--line); background: var(--surface);
  border-left: 4px solid var(--line-2);
}
.watch-item:hover { border-color: var(--pulse-accent); box-shadow: 0 3px 12px rgba(0, 0, 0, 0.08); }
/* n-button 默认是横排居中，这里改成上下两行，名字大、状态小 */
.watch-item :deep(.n-button__content) {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
}
.watch-item.warn { border-left-color: var(--pulse-accent); }
.watch-item.bad { border-left-color: var(--bad); }
.watch-item.idle { border-left-color: var(--line-2); }
.watch-name { font-size: 15px; font-weight: 700; color: var(--ink); line-height: 1.3; }
.watch-text { font-size: 12px; color: var(--ink-3); line-height: 1.3; }
.bar { display: flex; align-items: center; gap: 10px; margin: 12px 0 8px; flex-wrap: wrap; }
.empty { margin: 30px 0; font-size: 13px; color: var(--ink-4); }
.rule { margin-top: 12px; font-size: 12px; color: var(--ink-3); line-height: 1.9; }
.rule code { background: var(--pulse-soft); padding: 1px 5px; border-radius: 4px; color: var(--pulse-accent); }
.log { font-family: var(--font-num); color: var(--ink-4); }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

/* ---------- 培训计划（导入 → 60 天 → 每日反馈） ---------- */
.plan-wrap { display: flex; flex-direction: column; gap: 12px; }
.inc-block { border:1px solid var(--line); border-radius:16px; padding:14px 16px 16px; margin: 0; box-shadow:var(--shadow-panel); }
/* 渐变背景已统一为白卡片 */
.inc-block .blk-head { margin-top:0; }
.plan-import { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
.plan-import-title { font-weight: 700; margin-bottom: 10px; color: var(--ink); }
.plan-import-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.leave-row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:10px; padding:9px 11px; border-radius:9px; background:var(--ok-soft); border:1px solid var(--ok-soft); }
.leave-row b { font-size:12px; color:var(--ok); }
.plan-hint { margin-top: 8px; font-size: 12px; color: var(--ink-3); }
.plan-drop { margin-top: 10px; border: 1.5px dashed var(--pulse-soft); border-radius: 10px; padding: 14px; text-align: center; color: var(--ink-3); font-size: 13px; background: var(--pulse-soft); }
.plan-head { display: flex; justify-content: space-between; gap: 10px; align-items: center; flex-wrap: wrap; }
.plan-head-left { display: flex; gap: 8px; align-items: center; }
.plan-head-right { font-size: 12px; color: var(--ink-3); }
.pill { display: inline-block; padding: 2px 9px; border-radius: 999px; background: var(--pulse-soft); color: var(--pulse-accent); font-size: 12px; }
.pill.on { background: var(--ok-soft); color: var(--ok); }
.phase-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.phase-card { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; background: var(--surface); }
.phase-card.on { border-color: var(--pulse-accent); box-shadow: 0 0 0 3px rgba(31, 78, 138, 0.15); }
.phase-name { font-weight: 700; font-size: 13px; color: var(--ink); }
.phase-goal { font-size: 12px; color: var(--ink-3); margin-top: 4px; line-height: 1.5; }
.today-card, .fb-card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
.today-title { font-weight: 700; font-size: 13px; color: var(--ink); margin-bottom: 8px; }
.today-main { font-size: 15px; font-weight: 700; color: var(--pulse-deep); margin-bottom: 6px; }
.today-line { font-size: 13px; color: var(--ink-2); line-height: 1.7; }
.fb-row { display: flex; gap: 10px; margin-bottom: 8px; align-items: stretch; }
.plan-table-title { font-weight: 700; font-size: 13px; margin-top: 4px; }
.plan-filter { margin-bottom: 6px; }
.plan-empty { margin: 36px auto; color: var(--ink-3); font-size: 13px; text-align: center; }
.blk-head { margin: 24px 0 12px; padding: 11px 15px; border-radius: 11px; font-size: 16px; font-weight: 800; letter-spacing: .2px; border-left: 5px solid transparent; box-shadow: 0 2px 8px rgba(16, 80, 120, .05); }
.blk-base-head { background: linear-gradient(90deg, var(--pulse-soft), var(--pulse-soft)); color: var(--pulse-deep); border-left-color: var(--pulse-accent); }
.blk-today-head { background: linear-gradient(90deg, var(--ok-soft), var(--ok-soft)); color: var(--ok); border-left-color: var(--ok); }
.blk-all-head { background: linear-gradient(90deg, var(--pulse-soft), var(--pulse-soft)); color: var(--pulse-accent); border-left-color: var(--pulse-accent); }
.week-card { background: var(--surface); border: 1px solid var(--pulse-soft); border-radius: 12px; padding: 12px 14px; margin-bottom: 14px; }
.week-head { font-size: 14px; font-weight: 700; color: var(--ink-2); margin-bottom: 8px; }
.week-tools { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; color: var(--ink-3); font-size: 12px; }
.advanced-block { margin-top: 16px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 10px 14px; }
.advanced-block > summary { cursor: pointer; color: var(--pulse-accent); font-weight: 700; font-size: 13px; }
.advanced-block .track-daily { border-top: 0; margin-top: 10px; padding-top: 0; }
.pill.departed { background: var(--pulse-soft); color: var(--ink-3); text-decoration: line-through; }
.pill.rest { background:var(--ok-soft); color:var(--ok); }
.pill.leave { background:var(--brand-soft); color:var(--brand); }
/* 整页滚轮/滑条 */
.inc-page { height: calc(100vh - 56px); overflow-y: auto; padding-right: 18px; }
.inc-page::-webkit-scrollbar { width: 10px; }
.inc-page::-webkit-scrollbar-thumb { background: var(--line-2); border-radius: 6px; }
.inc-page::-webkit-scrollbar-track { background: transparent; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--ink-3); }
.field { min-width: 170px; }
.date-input { height: 34px; border: 1px solid var(--pulse-soft); border-radius: 6px; padding: 0 10px; width: 170px; font-size: 14px; color: var(--ink); background: var(--surface); }
.to-top { position: fixed; right: 28px; bottom: 28px; z-index: 50; background: var(--pulse-accent); color: var(--surface); padding: 10px 16px; border-radius: 999px; cursor: pointer; box-shadow: 0 6px 18px rgba(11,118,190,.35); font-size: 13px; }
.to-top:hover { background: var(--pulse-deep); }
/* 今天该盯：红色重点条 */
.watch { background: var(--bad-soft); border: 1px solid var(--line-2); border-radius: 12px; padding: 10px 14px; }
.watch-title { color: var(--bad); font-weight: 800; font-size: 14px; margin-bottom: 6px; }
.watch-item { cursor: pointer; }
.watch-item:hover { background: var(--bad-soft); }
.track-daily { border-top: 1px dashed var(--line); margin-top: 16px; padding-top: 16px; }
.sec-title { font-size: 15px; font-weight: 700; color: var(--ink); margin-bottom: 10px; }
/* 表格字大一点、行高一点，不费眼 */
.inc-page :deep(.n-data-table .n-data-table-td),
.inc-page :deep(.n-data-table .n-data-table-th) { font-size: 13px; padding-top: 9px; padding-bottom: 9px; }
/* 今天 与 60 天课表：强区分 */
.today-head { color: var(--pulse-accent); font-size: 16px; font-weight: 800; margin: 18px 0 10px; padding-left: 10px; border-left: 4px solid var(--pulse-accent); }
.today-card { background: var(--pulse-soft) !important; border: 1px solid var(--line-2) !important; border-left: 7px solid var(--pulse-accent) !important; border-radius: 14px !important; padding: 18px 20px !important; box-shadow: 0 2px 10px rgba(29,78,216,.08); }
.today-card.rest { background:var(--ok-soft) !important; border-color:var(--line-2) !important; border-left-color:var(--ok) !important; }
.leave-card { background:var(--brand-soft) !important; border:1px solid var(--line-2) !important; border-left:7px solid var(--warn) !important; border-radius:14px !important; padding:18px 20px !important; }
.fb-card { background: var(--pulse-soft) !important; border: 1px solid var(--pulse-cyan) !important; border-left: 7px solid var(--pulse-deep) !important; border-radius: 14px !important; padding: 18px 20px !important; margin-top: 14px; }
.schedule-title { background: var(--line); color: var(--ink-2); padding: 10px 14px; border-radius: 10px; font-size: 15px; margin: 10px 0 8px; }
.today-head-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 12px 0 8px; }
.today-head-row .today-head { margin: 0; }
.custom-course-card { margin-top: 10px; border-color: var(--ok); background: var(--ok-soft); }
.custom-course-row { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px dashed var(--line-2); }
.custom-course-row:first-of-type { border-top: 0; }
.custom-course-name { font-weight: 700; color: var(--ok); margin-bottom: 4px; }
.custom-form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 14px; }
.sec-divider { height: 1px; background: var(--line); margin: 22px 0 16px; }
.schedule-table { background: var(--surface-2); border: 1px solid var(--line); border-radius: 12px; padding: 8px; }
.schedule-table .n-data-table-th { background: var(--pulse-soft) !important; }
/* 2026-10 孵化页重排：主播身份置顶、三大板块强区分、评分自动保存 */
/* 统一白卡片 */
/* 板块排序：设置区(含主播录入) → 当前主播条 → 基础档案 → 今日评分；档案提到评分前 */
.inc-command-block { display:flex; flex-direction:column; }
.inc-command-block .command-grid { order:1; }
.inc-command-block .selected-hero { order:2; }
.inc-command-block .basic-profile-card { order:3; }
.inc-command-block .top-score-card { order:4; }
.command-grid { display:grid; grid-template-columns:minmax(0,1.45fr) minmax(300px,.8fr); gap:14px; align-items:start; }
.command-label { font-size:13px; font-weight:800; color:var(--pulse-deep); margin-bottom:10px; letter-spacing:.3px; }
.command-main .plan-import-row { margin-top:0; }
.watch-dock { background:var(--warn-soft); border:1px solid var(--warn); border-radius:14px; padding:11px 13px; min-height:86px; }
.watch-dock .watch-title { color:var(--warn); font-weight:800; margin-bottom:8px; }
.watch-dock .watch-list { display:flex; flex-wrap:wrap; gap:7px; }
.watch-dock .watch-item { display:flex; flex-direction:column; align-items:flex-start; gap:2px; border:1px solid var(--line-2); border-left:4px solid var(--warn); border-radius:10px; background:var(--surface); padding:6px 9px; cursor:pointer; text-align:left; }
.watch-dock .watch-item.bad { border-left-color:var(--bad); background:var(--bad-soft); }
.watch-dock .watch-item.ok { border-left-color:var(--ok); }
.selected-hero { margin-top:14px; padding:16px 18px; border-radius:16px; background:var(--pulse-deep); color:var(--surface); display:flex; justify-content:space-between; gap:18px; align-items:center; box-shadow:0 8px 24px rgba(15,23,42,.16); }
.hero-name-wrap { display:flex; align-items:baseline; gap:12px; min-width:0; flex-wrap:wrap; }
.hero-name-wrap span { font-size:12px; color:var(--pulse-cyan); font-weight:800; letter-spacing:1px; }
.hero-name-wrap b { font-size:30px; line-height:1.05; letter-spacing:.5px; }
.hero-name-wrap em { font-style:normal; font-size:12px; padding:4px 8px; border-radius:999px; background:rgba(255,255,255,.13); color:var(--pulse-soft); }
.hero-info { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:7px; font-size:12px; color:var(--line-2); }
.hero-info span { padding:4px 8px; border-radius:999px; background:rgba(255,255,255,.09); }
.hero-info .hero-danger { background:var(--bad); color:var(--bad-soft); font-weight:700; }
.top-score-card { margin-top:12px; border:1px solid var(--line-2); background:var(--surface); border-radius:14px; padding:12px 14px; }
.top-score-head { display:flex; align-items:baseline; gap:10px; margin-bottom:9px; }
.top-score-head b { color:var(--pulse-deep); font-size:14px; }
.top-score-head span { color:var(--ink-3); font-size:11px; }
.top-score-head i { margin-left:auto; font-style:normal; font-size:11px; color:var(--ok); background:var(--ok-soft); padding:3px 8px; border-radius:999px; }
.top-score-grid { display:grid; grid-template-columns:repeat(5,minmax(120px,1fr)); gap:10px; }
.top-score-grid label { display:flex; flex-direction:column; gap:5px; padding:9px 10px; background:var(--surface-2); border:1px solid var(--line); border-radius:10px; }
.top-score-grid label span { font-size:12px; font-weight:700; color:var(--ink-2); }
.block-streamer-name { display:flex; align-items:baseline; gap:10px; padding:12px 16px; margin:-2px -2px 12px; border-radius:12px; font-size:14px; font-weight:800; color:var(--surface); }
.block-streamer-name b { font-size:28px; line-height:1; letter-spacing:.4px; }
/* 统一白卡片 */
.block-streamer-name { background:linear-gradient(90deg,var(--pulse-deep),var(--pulse-accent)); }
/* 统一白卡片 */
.today-name { background:linear-gradient(90deg,var(--brand),var(--warn)); }
/* 统一白卡片 */
.all-name { background:linear-gradient(90deg,var(--pulse-violet),var(--pulse-accent)); }
.week-focus { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--pulse-deep); }
.week-date-chip { display:inline-flex; align-items:center; justify-content:center; min-width:86px; padding:3px 8px; border-radius:999px; color:var(--surface); font-weight:700; background:var(--week-color); }
.week-detail { margin-top:10px; padding:12px 14px; border-radius:12px; border:1px solid var(--line-2); background:var(--surface); display:flex; flex-direction:column; gap:7px; color:var(--ink-2); }
.week-detail-head { display:flex; align-items:baseline; gap:10px; }
.week-detail-head b { font-size:18px; color:var(--pulse-violet); }
.week-detail-head span { font-size:12px; color:var(--ink-3); }
.plan-drop { display:flex; flex-direction:column; align-items:center; gap:4px; cursor:pointer; transition:all .15s ease; }
.plan-drop:hover { background:var(--pulse-soft); border-color:var(--pulse-accent); color:var(--pulse-accent); }
@media (max-width:980px) { .command-grid { grid-template-columns:1fr; } .top-score-grid { grid-template-columns:repeat(2,minmax(120px,1fr)); } .selected-hero { flex-direction:column; align-items:flex-start; } .hero-info { justify-content:flex-start; } }
@media (min-width:901px) { .top-score-grid { grid-template-columns:repeat(5,minmax(100px,1fr)); } }
@media (max-width:900px) { .top-score-grid { grid-template-columns:repeat(2,minmax(120px,1fr)); } }
.basic-profile-card { margin-top:12px; border:1px solid var(--line-2); border-radius:14px; background:var(--surface); padding:12px 14px; }
.basic-profile-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px; }
.basic-profile-head b { color:var(--pulse-deep); font-size:14px; }
.basic-profile-head span { color:var(--ink-3); font-size:11px; }
.basic-profile-head .n-button { margin-left:auto; }
.inline-switch { display:flex; align-items:center; gap:5px; color:var(--pulse-deep); font-size:11px; }
.basic-profile-grid { display:grid; grid-template-columns:repeat(3,minmax(170px,1fr)); gap:9px 12px; }
.basic-profile-grid label { display:flex; flex-direction:column; gap:4px; color:var(--ink-3); font-size:11px; }
.basic-leave-row { margin-top:10px; display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding-top:10px; border-top:1px dashed var(--pulse-soft); }
.basic-leave-row > b { color:var(--brand); font-size:12px; }
.basic-leave-row label { display:flex; align-items:center; gap:5px; color:var(--ink-3); font-size:11px; }
.basic-status-row { margin-top:10px; display:flex; flex-wrap:wrap; align-items:center; gap:7px; }
@media (max-width:900px) { .basic-profile-grid { grid-template-columns:1fr; } }
/* 功能分组可读性：标题更大、三块之间留出明显间隔 */
.plan-wrap { gap:18px; }
.command-label { font-size:15px; line-height:1.35; }
.watch-title, .top-score-head b, .basic-profile-head b { font-size:15px; }
.profile-summary { color:var(--pulse-deep) !important; font-size:12px !important; font-weight:600; }
.basic-profile-card { border-top:5px solid var(--pulse-accent); }
.inc-today-block { border-top: none; box-shadow: var(--shadow-panel); }
.inc-all-block { border-top: none; box-shadow: var(--shadow-panel); }
.block-streamer-name b { font-size:32px; }
.panel-head b, .sec-title, .today-title, .week-head { font-size:14px; }
.plan-import-row { gap:8px; align-items:center; }
.plan-import-row .n-button { min-height:32px; }
.day-ops, .custom-course-actions { display:flex; align-items:center; gap:4px; flex-wrap:wrap; }
.custom-course-actions { justify-content:flex-end; }

/* —— 知识库·库模式 —— */
.lib-cats { display:flex; gap:4px; padding:3px; background:var(--surface-2); border:1px solid var(--line); border-radius:10px; }
.lib-cat { padding:5px 16px; border:none; background:transparent; color:var(--ink-3); border-radius:8px; font-size:12.5px; font-weight:600; cursor:pointer; font-family:inherit; transition:all .15s ease; }
.lib-cat:hover { color:var(--pulse-accent); }
.lib-cat.active { background:var(--pulse-accent); color:#fff; box-shadow:0 1px 3px rgba(31,78,138,.25); }
.lib-hint { margin:6px 0 10px; }
.script-source { margin-top:6px; font-size:11.5px; color:var(--ink-4); }

/* —— 心态调整 tab —— */
.mindset-head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin:12px 0 10px; }
.mindset-title { display:flex; flex-direction:column; gap:3px; min-width:0; }
.mindset-title b { font-size:15px; color:var(--ink); }
.mindset-title span { font-size:12px; color:var(--ink-3); line-height:1.6; }
.mindset-filter { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:12px; }
.mindset-chip { padding:4px 12px; border:1px solid var(--line-2); background:var(--surface); color:var(--ink-3); border-radius:999px; font-size:12px; cursor:pointer; font-family:inherit; transition:all .15s ease; }
.mindset-chip:hover { border-color:var(--pulse-accent); color:var(--pulse-accent); }
.mindset-chip.active { background:var(--pulse-soft); border-color:var(--pulse-accent); color:var(--pulse-accent); font-weight:600; }
.mindset-list { display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:12px; }
.mindset-card { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:13px 14px; box-shadow:var(--shadow-panel); display:flex; flex-direction:column; gap:9px; }
.mindset-card-head { display:flex; align-items:flex-start; gap:8px; }
.mindset-cat { flex-shrink:0; padding:2px 8px; border-radius:999px; background:var(--pulse-soft); color:var(--pulse-deep); font-size:11px; font-weight:600; line-height:1.7; }
.mindset-q { flex:1; min-width:0; font-size:13.5px; color:var(--ink); line-height:1.5; }
.mindset-ops { flex-shrink:0; display:flex; gap:4px; }
.mindset-block { background:var(--surface-2); border:1px solid var(--line); border-radius:8px; padding:8px 10px; }
.mindset-block.action { background:var(--ok-soft); border-color:rgba(22,122,74,.2); }
.mindset-label { font-size:11px; font-weight:600; color:var(--ink-4); margin-bottom:4px; letter-spacing:.02em; }
.mindset-block.action .mindset-label { color:var(--ok); }
.mindset-text { font-size:12.5px; color:var(--ink-2); line-height:1.7; white-space:pre-wrap; }
/* 多方对象筛选：主播=蓝 / 运营=绿 / 管理者=橙，一眼分清这条给谁用 */
.mindset-roles { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:10px; }
.mindset-role-tab { padding:5px 16px; border:1px solid var(--line-2); background:var(--surface); color:var(--ink-3); border-radius:8px; font-size:12.5px; font-weight:600; cursor:pointer; font-family:inherit; transition:all .15s ease; }
.mindset-role-tab:hover { border-color:var(--pulse-accent); color:var(--pulse-accent); }
.mindset-role-tab.active.role-全部 { background:var(--ink); border-color:var(--ink); color:var(--surface); }
.mindset-role-tab.active.role-主播 { background:var(--pulse-accent); border-color:var(--pulse-accent); color:var(--surface); }
.mindset-role-tab.active.role-运营 { background:var(--ok); border-color:var(--ok); color:var(--surface); }
.mindset-role-tab.active.role-管理者 { background:var(--brand); border-color:var(--brand); color:var(--surface); }
.mindset-role { flex-shrink:0; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:700; line-height:1.7; }
.mindset-role.role-主播 { background:var(--pulse-soft); color:var(--pulse-deep); }
.mindset-role.role-运营 { background:var(--ok-soft); color:var(--ok); }
.mindset-role.role-管理者 { background:var(--brand-soft); color:var(--brand); }
/* 2.9.12 可读性收口：字号有台阶、功能有边界、主操作只有一个焦点 */
.inc-page { padding: 22px 26px 42px; font-size: 14px; line-height: 1.58; color: var(--pulse-deep); }
.inc-header { align-items: center; margin-bottom: 14px; padding: 0 2px; }
.inc-title { margin: 0 0 5px; font-size: 24px; line-height: 1.2; letter-spacing: -0.4px; color: var(--pulse-deep); }
.inc-subtitle { max-width: 790px; font-size: 13.5px; line-height: 1.6; color: var(--pulse-accent); }
.header-action { min-height: 34px; font-size: 13px; }
.inc-page :deep(.n-tabs-tab) { font-size: 14px; font-weight: 650; }
.plan-wrap { gap: 24px; }
.inc-block { overflow: hidden; padding: 0 20px 20px; border-radius: 18px; border: 1px solid var(--line); box-shadow: var(--shadow-panel); background: var(--surface); }
/* 三大板块身份区分：左色条 + 标题区淡色底 + 角色签
   设置区=靛蓝（准备）、执行区=墨绿（今天干活）、档案区=琥珀（历史沉淀） */
.inc-command-block { border-left: 3px solid var(--pulse-accent); }
.inc-today-block { border-left: 3px solid var(--ok); }
.inc-all-block { border-left: 3px solid var(--warn); }
.section-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  margin: 0 -20px 16px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--line);
  background: var(--surface-2);
}
.section-heading-copy { min-width: 0; flex: 1; }
.section-heading-copy h3 { margin: 0 0 2px; font-size: 16px; line-height: 1.25; font-weight: 700; color: var(--ink); letter-spacing: -0.1px; }
.section-heading-copy p { margin: 0; font-size: 12px; line-height: 1.45; color: var(--ink-3); }
.section-person-mini { font-size: 12px; color: var(--pulse-accent); font-weight: 600; padding: 3px 10px; border-radius: 999px; background: var(--pulse-soft); white-space: nowrap; }
.section-heading-setup { background: var(--pulse-soft); }
.section-heading-today { background: var(--ok-soft); }
.section-heading-all { background: var(--warn-soft); }
.section-role {
  flex-shrink: 0;
  align-self: center;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
  padding: 3px 9px;
  border-radius: 6px;
  background: var(--surface);
}
.role-setup { color: var(--pulse-accent); border: 1px solid rgba(31, 78, 138, 0.35); }
.role-today { color: var(--ok); border: 1px solid rgba(22, 122, 74, 0.35); }
.role-all { color: var(--warn); border: 1px solid rgba(180, 131, 12, 0.4); }
.command-grid { grid-template-columns: minmax(0, 1.65fr) minmax(270px, .75fr); gap: 16px; }
.command-main { min-width: 0; }
.control-block { padding: 15px 16px; background: rgba(255, 255, 255, .9); border: 1px solid var(--pulse-soft); border-radius: 14px; }
.control-block + .control-block { margin-top: 12px; }
.control-heading { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 9px; margin-bottom: 11px; }
.control-heading b { white-space: nowrap; font-size: 15px; line-height: 1.35; color: var(--pulse-deep); }
.control-heading span { font-size: 12.5px; line-height: 1.45; color: var(--pulse-accent); }
.selector-row { display: grid; align-items: end; gap: 12px; }
.selector-row-main { grid-template-columns: minmax(190px, 1.35fr) minmax(145px, .9fr) auto; }
.selector-row-settings { grid-template-columns: minmax(160px, 1fr) minmax(165px, 1fr) auto; margin-top: 11px; }
.control-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.control-field > span { font-size: 12.5px; line-height: 1.35; font-weight: 700; color: var(--pulse-deep); }
.control-field .date-input { width: 100%; font-size: 13.5px; }
.add-streamer-btn, .action-row .n-button { min-height: 36px; font-size: 13px; font-weight: 650; }
.plan-switch { align-self: center; min-height: 34px; margin-top: 17px; padding: 0 2px; font-size: 12.5px; }
.action-control-block { border-color: var(--line-2); }
.action-row { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.action-divider { display: none; }
.custom-course-btn { flex-basis: 100%; width: max-content; margin-top: 2px; font-weight: 700; }
.plan-drop { margin-top: 12px; padding: 15px 18px; border-radius: 11px; font-size: 13px; }
.plan-drop b { font-size: 14px; line-height: 1.4; color: var(--pulse-deep); }
.plan-drop span { font-size: 12.5px; line-height: 1.5; }
.watch-dock { min-height: 100%; padding: 14px; border-radius: 14px; background: var(--warn-soft); border: 1px solid var(--warn); }
.watch-dock .watch-title { margin-bottom: 10px; font-size: 16px; line-height: 1.35; color: var(--warn); }
.watch-dock .watch-list { gap: 8px; }
.watch-dock .watch-item { min-width: 118px; padding: 8px 10px; border-radius: 10px; }
.watch-name { font-size: 16px; }
.watch-text { font-size: 12.5px; line-height: 1.45; }
.selected-hero { margin-top: 16px; padding: 17px 20px; border-radius: 15px; }
.hero-name-wrap { gap: 10px 13px; }
.hero-name-wrap span { font-size: 12.5px; letter-spacing: .5px; }
.hero-name-wrap b { font-size: 34px; line-height: 1.08; }
.hero-name-wrap em, .hero-info { font-size: 12.5px; }
.top-score-card { margin-top: 14px; padding: 15px 16px; border-radius: 14px; border-color: var(--line-2); }
.top-score-head { align-items: center; margin-bottom: 12px; }
.top-score-head b { font-size: 16px; }
.top-score-head span { font-size: 12.5px; color: var(--pulse-accent); }
.top-score-head i { font-size: 12px; }
.top-score-grid { gap: 12px; }
.top-score-grid label { min-height: 74px; padding: 11px 12px; border-radius: 11px; }
.top-score-grid label span { font-size: 13.5px; line-height: 1.35; color: var(--pulse-deep); }
.basic-profile-card { margin-top: 14px; padding: 15px 16px; border-radius: 14px; border-color: var(--line-2); border-top-width: 4px; }
.basic-profile-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; margin: 0; }
.basic-profile-title { display: flex; flex-direction: column; gap: 1px; }
.basic-profile-title b { font-size: 16px; line-height: 1.3; color: var(--pulse-deep); }
.basic-profile-title span { font-size: 12px; color: var(--pulse-accent); }
.profile-actions { display: flex; align-items: center; justify-content: flex-end; gap: 7px; flex-wrap: wrap; }
.profile-summary { grid-column: 1 / -1; display: flex; align-items: stretch; justify-content: flex-start; gap: 8px; flex-wrap: wrap; }
.profile-summary > span { display: inline-flex; align-items: baseline; gap: 7px; min-height: 34px; padding: 6px 10px; border-radius: 8px; background: var(--pulse-soft); border: 1px solid var(--pulse-soft); }
.profile-summary i { font-style: normal; font-size: 11.5px; color: var(--pulse-accent); }
.profile-summary b { font-size: 13px; color: var(--pulse-deep); }
.basic-profile-grid { margin-top: 14px; padding-top: 15px; border-top: 1px dashed var(--line-2); gap: 11px 14px; }
.basic-profile-grid label { gap: 5px; font-size: 12.5px; font-weight: 650; color: var(--pulse-deep); }
.basic-leave-row { margin-top: 12px; padding-top: 12px; }
.basic-leave-row > b, .basic-leave-row label { font-size: 12.5px; }
.basic-status-row { gap: 8px; margin-top: 12px; }
.inc-page .chip { min-height: 30px; padding: 5px 10px; }
.inc-page .chip b { font-size: 15px; }
.inc-page .chip span { font-size: 12.5px; }
.plan-head { padding: 2px 0 13px; }
.plan-head-left { gap: 7px; flex-wrap: wrap; }
.plan-head-left > b { font-size: 18px; color: var(--brand); }
.pill { padding: 4px 9px; font-size: 12.5px; }
.plan-head-right { font-size: 12.5px; color: var(--brand); }
.phase-cards { gap: 10px; margin-bottom: 16px; }
.phase-card { padding: 11px 12px; border-radius: 11px; background: rgba(255,255,255,.88); }
.phase-name { font-size: 14px; }
.phase-goal { font-size: 12.5px; line-height: 1.55; }
.today-head-row { margin: 16px 0 10px; }
.today-head { font-size: 17px; line-height: 1.35; }
.today-card, .fb-card { padding: 17px 18px; border-radius: 13px; }
.today-title { margin-bottom: 9px; font-size: 15px; line-height: 1.4; }
.today-main { margin-bottom: 8px; font-size: 17px; line-height: 1.5; }
.today-line { font-size: 13.5px; line-height: 1.72; }
.custom-course-name { font-size: 14px; }
.fb-card { margin-top: 16px; }

/* 主播作业：挂在今日工作里，样式和反馈卡一家人 */
.hw-card { border-left: 3px solid var(--ok) !important; }
.hw-list { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.hw-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; font-size: 12.5px; }
.hw-type { flex-shrink: 0; font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 999px; color: var(--ok); border: 1px solid rgba(22, 122, 74, 0.35); }
.hw-type.link { color: var(--pulse-accent); border-color: rgba(31, 78, 138, 0.35); }
.hw-name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--ink); }
.hw-date { flex-shrink: 0; color: var(--ink-3); font-size: 11.5px; }
.hw-note { flex-shrink: 0; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-3); font-size: 11.5px; }
.hw-empty { margin-top: 6px; font-size: 12px; color: var(--ink-3); }
.hw-day { flex-shrink: 0; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--ok); border: 1px solid rgba(22, 122, 74, 0.3); border-radius: 6px; padding: 1px 7px; }
.hw-day-hint { flex-shrink: 0; align-self: center; font-size: 11.5px; font-weight: 700; color: var(--ok); }
.hw-today-chip { font-size: 11px; font-weight: 700; color: var(--ok); border: 1px solid rgba(22, 122, 74, 0.35); border-radius: 999px; padding: 1px 9px; margin: 0 8px; }
.week-card { padding: 14px 15px; border-radius: 13px; margin-bottom: 16px; background: rgba(255,255,255,.92); }
.week-head { margin-bottom: 9px; font-size: 16px; line-height: 1.35; color: var(--pulse-deep); }
.week-tools { font-size: 12.5px; line-height: 1.45; }
.plan-table-title { font-size: 15px; line-height: 1.4; color: var(--pulse-deep); }
.schedule-title { font-size: 16px; }
.inc-page :deep(.n-data-table .n-data-table-td), .inc-page :deep(.n-data-table .n-data-table-th) { font-size: 13.5px; padding-top: 10px; padding-bottom: 10px; }
.inc-page :deep(.n-data-table .n-data-table-th) { font-weight: 700; color: var(--pulse-deep); }
.week-detail { padding: 13px 15px; font-size: 13.5px; line-height: 1.65; }
.week-detail-head b { font-size: 19px; }
.week-detail-head span { font-size: 12.5px; }
@media (max-width: 1020px) {
  .command-grid { grid-template-columns: minmax(0, 1fr); }
  .watch-dock { min-height: 0; }
  .watch-dock .watch-list { max-height: none; }
}
@media (max-width: 920px) {
  .inc-page { padding: 18px 16px 38px; }
  .section-heading { align-items: flex-start; flex-wrap: wrap; }
  .section-person, .section-hint { margin-left: 51px; }
  .selector-row-main, .selector-row-settings, .basic-profile-head { grid-template-columns: 1fr; }
  .profile-summary { grid-column: 1; }
  .profile-actions { justify-content: flex-start; }
  .plan-switch { margin-top: 0; }
  .top-score-grid { grid-template-columns: repeat(2, minmax(120px, 1fr)); }
}
</style>
