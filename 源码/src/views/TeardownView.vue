<template>
  <div
    class="td-page"
    :class="{ 'drag-over': dragging }"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >

    <!-- 拖进来的时候：整页盖一层，明确告诉你“松手就放进来” -->
    <div
      v-if="dragging"
      style="position:fixed; inset:0; z-index:9999; background:rgba(11,118,190,0.10); border:3px dashed #0B76BE; display:flex; align-items:center; justify-content:center; pointer-events:none"
    >
      <div style="background:#fff; border-radius:14px; padding:22px 40px; font-size:20px; font-weight:700; color:#0B76BE; box-shadow:0 10px 40px rgba(0,0,0,.18)">
        松手就放进来
      </div>
    </div>

    <!-- 放进来之后：常驻一条，一眼能看到“现在放的是什么” -->
    <div
      v-if="input"
      :style="{ display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap', padding:'10px 14px', borderRadius:'10px', marginBottom:'10px', border:'1px solid ' + (pickedBad ? '#fecaca' : '#bbf7d0'), background: pickedBad ? '#fef2f2' : '#f0fdf4' }"
    >
      <span style="font-size:16px">{{ pickedBad ? '⚠️' : '✅' }}</span>
      <span style="font-size:14px; font-weight:700" :style="{ color: pickedBad ? '#b91c1c' : '#15803d' }">
        {{ pickedBad ? '这个放进来读不出内容：' : '已放入：' }}
      </span>
      <span style="font-size:13px; color:#1f2328; word-break:break-all">{{ pickedName }}</span>
      <span style="font-size:12px; color:#6b7280">{{ pickedMeta }}</span>
      <button class="link-btn" style="margin-left:auto" @click="pickedReset">换一个</button>
    </div>
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
            <n-button size="small" type="primary" ghost @click="pickFile">选手机/相机视频</n-button>
            <n-button size="small" @click="pickDir">选整个目录</n-button>
          </div>
          <div class="online-row">
            <n-select v-model:value="platform" :options="platformOptions" size="small" style="width: 150px" />
            <n-input v-model:value="urlInput" size="small" placeholder="粘贴抖音直播、回放、B站、TikTok、快手、小红书链接" @keyup.enter="useUrl" />
            <n-input-number v-if="platform === 'douyin-live'" v-model:value="liveSeconds" size="small" :min="30" :max="7200" :step="60" style="width: 120px" />
            <n-button size="small" type="primary" ghost @click="useUrl">放入链接</n-button>
          </div>
          <div class="pick-hint">{{ platformHint }}</div>
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
            <span class="zone-title">拆解设置与开始</span>
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

          <!-- 一键下载：模型 / GPU 运行库（运营不用自己找命令行） -->
          <div class="dl-row">
            <n-button
              size="tiny"
              tertiary
              :loading="prefetching === 'model'"
              :disabled="!!prefetching || running"
              @click="downloadModel"
            >下载/校验这个模型</n-button>
            <n-button
              size="tiny"
              tertiary
              :loading="prefetching === 'gpu'"
              :disabled="!!prefetching || running"
              @click="downloadGpu"
            >安装/校验 GPU 运行库</n-button>
            <n-button
              v-if="prefetching"
              size="tiny"
              tertiary
              type="error"
              @click="cancelDownload"
            >停止下载</n-button>
          </div>
          <div v-if="prefetchMsg" class="model-hint prefetch-msg">{{ prefetchMsg }}</div>
          <div class="model-hint">GPU 运行库保存在用户目录，以后升级软件不用重新下载；旧版已装的 GPU 库会自动迁移。</div>
          <div class="model-hint">没下过的模型首次拆解要联网下载（medium 约 1.5GB）；点上面的按钮可以先下好，走的是国内镜像。</div>

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
            <n-button size="small" @click="pickCompare('A')">选文件</n-button>
          </div>
          <div class="run-row">
            <div class="run-label">B 自家</div>
            <n-select v-model:value="compareB" size="small" :options="recOptions" placeholder="选自家主播的场次" style="width: 100%" />
            <n-button size="small" @click="pickCompare('B')">选文件</n-button>
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
          <div class="model-hint">两边都要先拆解过（有「拆解素材包.md」）；下拉里没有的场次，点「选文件」直接指定那个素材包。生成后到右边「双场对比」页签看结果</div>
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
              <span class="packet-meta" style="color:#0B76BE">出报告请看右边「喂给 AI」页签</span>
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
          <!-- ============ 三步走：放素材 → 出报告 → 拿报告 ============ -->

          <!-- 1 放素材 -->
          <div style="display:flex; gap:12px; margin-bottom:12px">
            <div class="num" style="flex:0 0 22px; height:22px; border-radius:50%; background:#0B76BE; color:#fff; font-size:12px; font-weight:700; display:flex; align-items:center; justify-content:center">1</div>
            <div style="flex:1; min-width:0">
              <div style="font-size:14px; font-weight:700; color:#1f2328; margin-bottom:6px">放素材包</div>
              <div :style="{ border: '2px dashed ' + (!input ? '#c9d3de' : (pickedBad ? '#f87171' : '#4ade80')), background: !input ? '#fafbfc' : (pickedBad ? '#fef2f2' : '#f0fdf4'), borderRadius: '10px', padding: '14px 16px', textAlign: 'center' }">
                <div v-if="!input" style="font-size:14px; color:#1f2328; font-weight:600">
                  把拆解素材包.md 拖到这里（只放素材包也能出文字报告）
                </div>
                <div v-else style="font-size:14px; font-weight:700; color:#1f2328; word-break:break-all">
                  {{ pickedBad ? '⚠️ ' : '✅ ' }}{{ pickedName }}
                </div>
                <div style="font-size:12px; color:#6b7280; margin-top:6px; line-height:1.6">
                  <template v-if="!input">也可以在左边列表里选择已经拆解好的场次；图片是可选补充，不是必填。</template>
                  <template v-else-if="pickedBad">读不出内容 —— 请拖「拆解素材包.md」，图片请放到下面的可选图片区</template>
                  <template v-else>{{ pickedMeta }}</template>
                </div>
              </div>
              <div v-if="input" style="margin-top:6px"><button class="link-btn" @click="pickedReset">换一个</button></div>
            </div>
          </div>

          <!-- 2 出报告 -->
          <div style="display:flex; gap:12px; margin-bottom:12px">
            <div class="num" :style="{ flex:'0 0 22px', height:'22px', borderRadius:'50%', background: split ? '#0B76BE' : '#c9d3de', color:'#fff', fontSize:'12px', fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center' }">2</div>
            <div style="flex:1; min-width:0">
              <div style="font-size:14px; font-weight:700; color:#1f2328; margin-bottom:6px">出报告</div>
              <div class="ai-img-row">
                <span>本场喂几张图给 AI</span>
                <n-select v-model:value="imageCount" :options="imageOptions" size="small" style="width: 180px" />
                <span class="hint">设置页填了千问视觉模型才生效</span>
              </div>
              <div class="manual-image-zone" @dragover.prevent.stop @drop.prevent.stop="onAnalysisImagesDrop">
                <div class="manual-image-head"><b>可选补充图片</b><n-button size="tiny" tertiary @click="pickAnalysisImages">选择图片</n-button><n-button v-if="analysisImages.length" size="tiny" quaternary type="error" @click="analysisImages = []">清空</n-button></div>
                <div class="hint">可把几张现场截图拖到这里。没选图片不影响文字报告，只是不分析画面；只放素材包也能正常出报告。</div>
                <div v-if="analysisImages.length" class="manual-image-list">{{ analysisImages.length }} 张：{{ analysisImages.map(p => p.split(/[\\/]/).pop()).join('、') }}</div>
              </div>
              <n-button
                block
                size="large"
                :type="aiReportPath && !aiBusy ? 'success' : 'primary'"
                :loading="aiBusy"
                :disabled="!split"
                @click="aiReportPath && !aiBusy ? openTarget(aiReportPath) : onAnalyze()"
              >
                {{ aiBusy ? '正在出报告…' : (aiReportPath ? '查看报告' : '一键出报告') }}
              </n-button>
              <div style="font-size:12px; color:#6b7280; margin-top:6px; line-height:1.6">
                <template v-if="!split">把素材放进上面，这个按钮就亮了。分几段、怎么合并都是自动的，不用你管。</template>
                <template v-else-if="aiReportPath">这一场的报告已经生成过，点一下就能看。</template>
                <template v-else>点一下就行：整包约 {{ split.totalTokens }} 字，自动跑完再合并。以前拆过的也能直接出报告。</template>
              </div>
            </div>
          </div>

          <!-- 跑的时候：进度 -->
          <div v-if="aiBusy" style="display:flex; gap:12px; margin-bottom:12px">
            <div class="num">…</div>
            <div style="flex:1; min-width:0">
              <div style="height:8px; background:#eef0f3; border-radius:4px; overflow:hidden">
                <div :style="{ width: aiPercent + '%', height: '100%', background: 'linear-gradient(90deg,#0B76BE,#00C2D1)', transition: 'width .4s' }"></div>
              </div>
              <div style="font-size:13px; color:#1f2328; margin-top:6px">
                {{ aiStage }}　·　已用 {{ aiElapsedText }}<template v-if="aiEtaText">　·　预计还需 {{ aiEtaText }}</template>
              </div>
              <div v-for="(h, i) in aiHistory" :key="i" style="font-size:12px; color:#10b981; margin-top:4px">✅ {{ h }}</div>
              <n-button size="tiny" type="warning" style="margin-top:8px" @click="onCancelAnalyze">停止分析</n-button>
              <div style="font-size:11px; color:#9aa1ab; margin-top:6px">中途停了也不白跑：已经跑完的那几段会留在报告里。</div>
            </div>
          </div>

          <!-- 3 拿报告 -->
          <div v-if="!aiBusy && aiReportPath" style="display:flex; gap:12px; margin-bottom:12px">
            <div class="num" style="flex:0 0 22px; height:22px; border-radius:50%; background:#10b981; color:#fff; font-size:12px; font-weight:700; display:flex; align-items:center; justify-content:center">3</div>
            <div style="flex:1; min-width:0">
              <div style="font-size:14px; font-weight:700; color:#10b981; margin-bottom:6px">报告好了</div>
              <div style="display:flex; gap:8px">
                <n-button size="small" type="primary" @click="openTarget(aiReportPath)">打开报告</n-button>
                <n-button size="small" @click="openTarget(packet.workDir)">打开文件夹</n-button>
              </div>
              <div style="font-size:11px; color:#9aa1ab; margin-top:6px; word-break:break-all">{{ aiReportPath }}</div>
            </div>
          </div>

          <!-- 高级：运营平时不用碰，默认收起 -->
          <details v-if="split" style="border-top:1px solid #e6e8ec; padding-top:8px; margin-top:4px">
            <summary style="font-size:12px; color:#9aa1ab; cursor:pointer">高级（分片明细 / 导出分片 / 单份复制）</summary>
            <div class="split-head" style="margin-top:10px">
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
          </details>
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

/**
 * 对比那两栏也能直接指定一个素材包文件。
 * 为什么需要：拖进来的素材包不在录像列表里，下拉里根本找不到它。
 */
async function pickCompare(which: 'A' | 'B'): Promise<void> {
  const p = await api().teardownBrowse('file')
  if (!p) return
  if (which === 'A') compareA.value = p
  else compareB.value = p
}

// ---- 顶部「已放入」横条：一眼看到现在放的是什么 ----
const pickedName = computed(() => (td.input || '').split(/[\\/]/).pop() || '')
function isOnlineLink(v: string) { return /^https?:\/\//i.test(String(v || '').trim()) }
function useUrl() {
  const u = urlInput.value.trim()
  if (!isOnlineLink(u)) return message.warning('先粘贴一个 http/https 链接')
  td.input = u
  td.packet = null
  message.success('链接已放入，点「开始拆解」会自动下载/现录')
}
const pickedBad = computed(() => !!td.input && !isOnlineLink(td.input) && !packet.value)
const pickedMeta = computed(() => {
  if (!td.input) return ''
  if (isOnlineLink(td.input)) return '线上链接：开始拆解时自动下载或现录'
  if (!packet.value) return '读不出内容 —— 选录像文件，或者把「拆解素材包.md」拖进来'
  const parts = [`${packet.value.content.length.toLocaleString()} 字`]
  if (split.value) parts.push(`约 ${split.value.totalTokens} token`)
  if (aiReportPath.value) parts.push('已有报告')
  return parts.join(' · ')
})
function pickedReset() {
  td.input = ''
  aiReportPath.value = ''
}

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
const platform = ref('auto')
const urlInput = ref('')
const liveSeconds = ref(600)
const platformOptions = [
  { label: '自动识别平台', value: 'auto' },
  { label: '抖音直播（现录一段）', value: 'douyin-live' },
  { label: '抖音回放', value: 'douyin-video' },
  { label: 'B站', value: 'bilibili' },
  { label: 'TikTok', value: 'tiktok' },
  { label: '快手', value: 'kuaishou' },
  { label: '小红书', value: 'xiaohongshu' },
  { label: '本地文件/目录', value: 'local' }
]
const platformHint = computed(() => platform.value === 'douyin-live'
  ? `抖音直播会在开始拆解时现录 ${liveSeconds.value} 秒，再自动拆解。`
  : '回放链接会先用 yt-dlp 下载，再走同一套拆解。需要登录的平台，请先在浏览器登录。')
const imageCount = ref(4)
const analysisImages = ref<string[]>([])
const imageOptions = [
  { label: '不分析图片', value: 0 },
  { label: '关键 4 张（推荐）', value: 4 },
  { label: '关键 8 张（更细）', value: 8 }
]

// ---- AI 分析：把素材包直接发给设置页里配好的 AI 接口 ----
const aiBusy = ref(false)
const aiStage = ref('')
const aiReportPath = ref('')
// 进度：第几段/共几段 + 已用时间 + 预估剩余 + 每段完成的记录
const aiPartDone = ref(0)
const aiPartTotal = ref(0)
const aiHistory = ref<string[]>([])
const aiStartAt = ref(0)
const aiNow = ref(Date.now())
let aiTimer: ReturnType<typeof setInterval> | null = null
function startAiTimer(): void {
  stopAiTimer()
  aiStartAt.value = Date.now()
  aiNow.value = Date.now()
  aiTimer = setInterval(() => { aiNow.value = Date.now() }, 1000)
}
function stopAiTimer(): void {
  if (aiTimer) { clearInterval(aiTimer); aiTimer = null }
}
const aiPercent = computed(() => {
  if (!aiPartTotal.value) return aiBusy.value ? 5 : 0
  return Math.min(99, Math.round((aiPartDone.value / aiPartTotal.value) * 100))
})
const aiElapsedText = computed(() => {
  if (!aiStartAt.value) return '0 秒'
  const sec = Math.max(0, Math.round((aiNow.value - aiStartAt.value) / 1000))
  return sec < 60 ? sec + ' 秒' : Math.floor(sec / 60) + ' 分钟'
})
const aiEtaText = computed(() => {
  if (!aiStartAt.value || !aiPartDone.value || !aiPartTotal.value) return ''
  const per = (aiNow.value - aiStartAt.value) / aiPartDone.value
  const left = per * (aiPartTotal.value - aiPartDone.value)
  if (left <= 0) return ''
  return left < 60000 ? '不到 1 分钟' : Math.ceil(left / 60000) + ' 分钟'
})
const packetChars = computed(() => (packet.value?.content || '').length)
function addAnalysisImages(paths: string[]) {
  const ok = paths.filter((p) => /\.(jpe?g|png|webp)$/i.test(String(p || '')))
  analysisImages.value = Array.from(new Set([...analysisImages.value, ...ok])).slice(0, 8)
}
async function pickAnalysisImages() {
  const paths = await api().aiPickImages()
  addAnalysisImages(Array.isArray(paths) ? paths : [])
}
function onAnalysisImagesDrop(e: DragEvent) {
  const paths: string[] = []
  for (const f of Array.from(e.dataTransfer?.files || [])) {
    const p = (window as any).electronAPI.getFilePath(f)
    if (p) paths.push(p)
  }
  addAnalysisImages(paths)
}
const api = () => (window as any).electronAPI

async function onAnalyze() {
  if (!input.value) { message.warning('先选一个录制'); return }
  aiBusy.value = true
  aiHistory.value = []
  aiPartDone.value = 0
  aiPartTotal.value = split.value?.parts?.length || 1
  startAiTimer()
  aiStage.value = '准备中…'
  try {
    const res = await api().aiAnalyze(input.value, { imageCount: Number(imageCount.value) || 0, images: analysisImages.value.slice() })
    if (res && res.ok) {
      aiReportPath.value = res.reportPath || ''
      aiPartDone.value = aiPartTotal.value
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
    stopAiTimer()
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

// ---- 一键下载：转写模型 / GPU 运行库 ----
const prefetching = ref<'' | 'model' | 'gpu'>('')
const prefetchMsg = ref('')

/** 下载脚本每输出一行都会走到这里，界面实时能看到进度 */
function onPrefetch(e: any): void {
  if (!e) return
  prefetching.value = e.running ? e.kind : ''
  if (e.line) {
    prefetchMsg.value = e.line
    td.appendLine(e.line)   // 同时进日志页，方便回看
  }
}

async function downloadModel(): Promise<void> {
  prefetchMsg.value = ''
  const res = await api().teardownPrefetchModel(td.model)
  if (res && !res.ok && res.message) prefetchMsg.value = res.message
  await recheckEnv()
}

async function downloadGpu(): Promise<void> {
  prefetchMsg.value = ''
  const res = await api().teardownPrefetchGpu()
  if (res && !res.ok && res.message) prefetchMsg.value = res.message
  await recheckEnv()
}

async function cancelDownload(): Promise<void> {
  await api().teardownPrefetchCancel()
  prefetching.value = ''
  prefetchMsg.value = '已停止下载'
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
  if (isOnlineLink(td.input)) {
    const r = await api().teardownResolveUrl(td.input, Number(liveSeconds.value) || 600)
    if (!r?.ok || !r?.path) {
      message.error(r?.message || '链接下载失败')
      return
    }
    td.input = r.path
    urlInput.value = ''
    await td.loadPacket(r.path).catch(() => null)
  }
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

/**
 * 换了一场就看看这一场有没有已经生成过的报告（以前拆过的也能直接看/直接再跑）。
 * 有报告的话上面那个大按钮会变成「查看报告」。这里不需要新的 IPC：
 * 读得到报告内容就说明文件在，路径用 packet.workDir 拼出来。
 */
watch(() => packet.value?.workDir, async (wd) => {
  const v = td.input
  if (!v) { aiReportPath.value = ''; return }
  if (!wd) return
  try {
    const text = await api().aiReadReport(v)
    aiReportPath.value = text ? wd + '\\AI分析报告.md' : ''
  } catch { /* 读不到就当没报告 */ }
}, { immediate: true })

onMounted(async () => {
  td.setupListeners()
  // 每次进页面先清掉旧的（否则来回切页会越叠越多）
  api().removeAiListeners()
  // 进度：字数 / 第几段 / 每段完成的记录，都从这里来
  api().onAiProgress((p: any) => {
    if (!p) return
    if (p.total) aiPartTotal.value = Number(p.total) || aiPartTotal.value
    if (p.stage) aiStage.value = p.stage
    // 「第 N 段完成」这类事件：进度条往前走一格，并记一行到下面
    if (typeof p.part === 'number' && p.part > 0 && /完成/.test(String(p.stage || ''))) {
      if (p.part > aiPartDone.value) {
        aiPartDone.value = p.part
        const total = Number(p.total) || 0
        aiHistory.value = [...aiHistory.value, total ? `第 ${p.part}/${total} 段完成` : `第 ${p.part} 段完成`]
      }
    }
  })
  // 下载进度监听器同样先去重再注册
  api().removePrefetchListeners()
  api().onPrefetchProgress(onPrefetch)
  await td.refreshConfig()
  try {
    const aiCfg = await api().aiConfigGet()
    imageCount.value = Math.max(0, Math.min(8, Number(aiCfg?.visionMaxImages ?? 4) || 0))
  } catch { /* ignore */ }
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
  color: var(--pulse-violet);
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
.dl-row { display: flex; align-items: center; gap: 8px; margin: 2px 0 4px 72px; flex-wrap: wrap; }
.prefetch-msg { color: #f97316; word-break: break-all; }
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
.tab.active { color: var(--pulse-violet); border-bottom-color: var(--pulse-violet); font-weight: 600; }
.tab-dot { width: 6px; height: 6px; border-radius: 50%; background: #10b981; }
.tab-badge {
  font-size: 10px;
  background: rgba(108, 75, 255, 0.16);
  color: var(--pulse-violet);
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
.online-row { display:flex; align-items:center; gap:8px; margin-top:10px; padding-top:10px; border-top:1px dashed #dbe5ed; }
.ai-img-row { display:flex; align-items:center; gap:8px; margin:8px 0 10px; padding:8px 10px; border-radius:8px; background:#f4f9fd; color:#385065; font-size:12px; }
.manual-image-zone { margin:8px 0 10px; padding:9px 11px; border:1.5px dashed #b8d9e9; border-radius:9px; background:#fbfdff; }
.manual-image-head { display:flex; align-items:center; gap:7px; color:#24546e; font-size:12px; } .manual-image-list { margin-top:6px; color:#5d7484; font-size:10px; word-break:break-all; }
.pick-hint { font-size: 10px; color: #9aa1ab; line-height: 1.7; margin: 8px 0; }

/* 把视频拖进窗口时的提示框 */
.td-page.drag-over::after {
  content: '把视频拖到这里松手，就能拆';
  position: fixed;
  inset: 8px;
  border: 2px dashed var(--pulse-violet);
  border-radius: 12px;
  background: rgba(108, 75, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--pulse-violet);
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
