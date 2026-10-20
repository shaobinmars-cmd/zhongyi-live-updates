<template>
  <div class="settings-page">
    <h2 class="page-title">设置</h2>
    <div class="settings-hero">
      <div class="settings-sub">平时只需要管录制、AI、授权和更新。高级网络/共享默认收起，避免误改。</div>
      <div class="settings-nav">
        <button @click="scrollSetting('set-record')">录制</button>
        <button @click="scrollSetting('set-ai')">AI 与图片</button>
        <button @click="scrollSetting('set-access')">运营授权</button>
        <button @click="scrollSetting('set-system')">数据与更新</button>
      </div>
    </div>

    <div class="card settings-card">
      <div class="section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="3" stroke="#f97316" stroke-width="1.8"/>
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="#f97316" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <h3 id="set-record" class="section-title anchor-title">录制设置</h3>
      </div>

      <div class="form-group">
        <label class="form-label">输出格式</label>
        <n-select v-model:value="settings.selectedFormat" :options="formatOptions" />
      </div>

      <div class="form-group">
        <label class="form-label">保存路径</label>
        <div class="path-row">
          <n-input v-model:value="settings.outputPath" placeholder="留空则默认保存到桌面「直播录制」文件夹" />
          <n-button @click="settings.browsePath()">浏览</n-button>
        </div>
        <div class="form-hint">留空则默认保存到桌面「直播录制」文件夹</div>
      </div>

      <div class="form-divider"></div>

      <div class="section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="#f97316" stroke-width="1.8" fill="none"/>
        </svg>
        <h3 class="section-title">长时间挂机（7×24）</h3>
      </div>

      <div class="form-group">
        <label class="form-label">每段时长（分钟）</label>
        <n-input-number v-model:value="settings.segmentMinutes" :min="0" :max="720" :step="10" style="width: 100%" />
        <div class="form-hint">到点自动切成新文件；填 0 表示一场一个文件。建议 30 分钟 —— 断了只丢一段。</div>
      </div>

      <div class="form-group">
        <label class="form-label">录制目录容量上限（GB）</label>
        <n-input-number v-model:value="settings.maxGB" :min="0" :max="10000" :step="10" style="width: 100%" />
        <div class="form-hint">超过就先删最老的录像；填 0 表示不限制。</div>
      </div>

      <div class="form-group">
        <label class="form-label">磁盘剩余最低（GB）</label>
        <n-input-number v-model:value="settings.minFreeGB" :min="0" :max="1000" :step="1" style="width: 100%" />
        <div class="form-hint">剩余空间低于这个值就停止录制，避免把整块盘写满。</div>
      </div>

      <div class="form-group switch-group">
        <div>
          <label class="form-label">断流自动重连</label>
          <div class="form-hint">断了自动重取流接着录；连续 10 次连不上就判定已下播并停止。</div>
        </div>
        <n-switch v-model:value="settings.autoReconnect" />
      </div>

      <div class="form-actions">
        <n-button type="primary" @click="settings.saveConfig()">保存设置</n-button>
        <span v-if="settings.statusMessage" class="success-text">{{ settings.statusMessage }}</span>
      </div>
    </div>

    <div class="card settings-card">
      <div class="section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" stroke="#f97316" stroke-width="1.8" stroke-linecap="round"/>
          <circle cx="12" cy="12" r="3.2" stroke="#f97316" stroke-width="1.8"/>
        </svg>
        <h3 id="set-ai" class="section-title anchor-title">AI 分析（运营自己就能出报告）</h3>
      </div>

      <div class="form-group">
        <label class="form-label">接口地址</label>
        <n-input v-model:value="ai.baseUrl" placeholder="https://api.deepseek.com/v1" />
        <div class="form-hint">OpenAI 兼容格式即可。DeepSeek 就填 https://api.deepseek.com/v1；智谱/Kimi/通义 也都有兼容地址。</div>
      </div>

      <div class="form-group">
        <label class="form-label">API 密钥</label>
        <n-input v-model:value="ai.apiKey" type="password" show-password-on="click" placeholder="sk-..." />
        <div class="form-hint">填一次就行，存在本机，不会外发。</div>
      </div>

      <div class="form-group">
        <label class="form-label">模型名</label>
        <n-input v-model:value="ai.model" placeholder="deepseek-chat" />
      </div>

      <div class="form-group">
        <label class="form-label">单次最多输出（token）</label>
        <n-input-number v-model:value="ai.maxOutputTokens" :min="500" :max="32000" :step="500" style="width: 100%" />
        <div class="form-hint">报告很长就调大（比如 8000）。素材包本身超长时会自动分片，不用管。</div>
      </div>

      <div class="vision-box">
        <div class="vision-title">图片分析（可选，通义千问）</div>
        <div class="form-hint">填了才会把拆解网格图一起发给视觉模型；不填只分析文字。</div>
        <div class="vision-grid">
          <n-input v-model:value="vis.baseUrl" size="small" placeholder="视觉接口地址" />
          <n-input v-model:value="vis.apiKey" size="small" type="password" show-password-on="click" placeholder="千问 API Key" />
          <n-input v-model:value="vis.model" size="small" placeholder="qwen-vl-plus" />
          <n-input-number v-model:value="vis.maxImages" size="small" :min="0" :max="8" style="width: 120px" />
          <n-button size="small" type="primary" @click="saveVision">保存图片模型</n-button>
        </div>
        <div class="form-hint">图片数建议 4 张；0 = 不分析图。每场拆解页还能临时改。</div>
        <div v-if="visMsg" class="form-hint">{{ visMsg }}</div>
      </div>

      <div class="form-group">
        <label class="form-label">管理员发的配置串（可选，一键填好）</label>
        <n-input v-model:value="configText" type="textarea" :rows="2" placeholder="把管理员发你的整段粘到这里（ZYAI1|地址|密钥|模型）" />
        <div class="form-hint">粘好点右边的「一键填好」，就不用自己填上面三项。</div>
      </div>

      <div class="form-actions">
        <n-button type="primary" @click="saveAi">保存 AI 设置</n-button>
        <n-button :loading="aiTesting" @click="testAi">测试连接</n-button>
        <n-button @click="pasteConfig">一键填好</n-button>
        <span v-if="aiMessage" :class="aiOk ? 'success-text' : 'error-text'">{{ aiMessage }}</span>
      </div>
    </div>

    <div class="card settings-card">
      <div class="section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M12 5v14M5 12h14" stroke="#f97316" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <h3 id="set-access" class="section-title anchor-title">给新运营发配置（以后加人就用这个）</h3>
      </div>
      <div class="form-hint" style="margin-bottom: 10px">
        以后新加一个运营：去 DeepSeek 官网给他建一把新 key → 填到下面 → 生成一条消息发给他。
        他粘一下就能用，不用改软件、不用找人改代码。
      </div>

      <div class="form-group">
        <label class="form-label">运营名字</label>
        <n-input v-model:value="genName" placeholder="如：小九九" />
      </div>

      <div class="form-group">
        <label class="form-label">他的 DeepSeek API Key</label>
        <n-input v-model:value="genKey" placeholder="sk-..." />
        <div class="form-hint">在 DeepSeek 官网「API keys」里新建一把，建完只显示一次，直接粘到这里。</div>
      </div>

      <div class="form-group">
        <label class="form-label">接口地址</label>
        <n-input v-model:value="genBase" placeholder="https://api.deepseek.com/v1" />
      </div>

      <div class="form-actions">
        <n-button type="primary" @click="genInvite">生成并复制发给他</n-button>
        <span v-if="genMsg" class="success-text">{{ genMsg }}</span>
      </div>
      <n-input v-if="genText" v-model:value="genText" type="textarea" :rows="7" readonly style="margin-top: 10px" />
    </div>
    <div class="card settings-card">
      <div class="section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M4 6h16M4 12h10M4 18h7" stroke="#f97316" stroke-width="1.8" stroke-linecap="round"/>
          <circle cx="18" cy="15" r="3" stroke="#f97316" stroke-width="1.8"/>
        </svg>
        <h3 class="section-title">分享给运营（你这台电脑当服务器）</h3>
      </div>
      <div class="form-hint" style="margin-bottom: 10px">
        开启后，运营在自己 App 的设置页填下面的地址 + 他自己的密钥，分析就走你这台的 AI。
        密钥一人一个，用量分开统计。需同一个局域网（或 VPN）。
      </div>

      <div class="form-group switch-group">
        <div>
          <label class="form-label">开启共享</label>
          <div class="form-hint">关掉后运营那边会连不上（你自己这台仍可用）。</div>
        </div>
        <n-switch v-model:value="share.enabled" @update:value="saveShareCfg" />
      </div>

      <div class="form-group">
        <label class="form-label">端口</label>
        <n-input-number v-model:value="share.port" :min="1024" :max="65535" style="width: 100%" @update:value="saveShareCfg" />
      </div>

      <div class="form-group">
        <label class="form-label">运营要填的接口地址</label>
        <n-input :value="shareStatus.baseUrl" readonly />
        <div class="form-hint">
          服务：{{ shareStatus.running ? '运行中' : '未开启' }}　本机 IP：{{ (shareStatus.addresses || []).join('，') || '未检测到' }}
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">外地运营（外网访问）</label>
        <div class="client-actions" style="margin-bottom: 6px">
          <n-button size="tiny" type="primary" :loading="wanBusy" @click="openPublic">一键开放外网</n-button>
          <n-button size="tiny" @click="closePublic">关闭外网端口</n-button>
          <n-button size="tiny" @click="openRouter">打开光猫/路由器设置页</n-button>
        </div>
        <n-input :value="publicBaseUrl" readonly placeholder="开放后这里会显示外地运营要填的地址" />
        <div class="form-hint" style="white-space: pre-wrap">{{ publicMsg || '同一个办公室的运营填内网地址就行；外地的填上面这个。' }}</div>
      </div>

      <div class="client-head">
        <span>运营密钥与用量</span>
        <div class="client-actions">
          <n-button size="tiny" @click="addClient">加一个运营</n-button>
          <n-button size="tiny" @click="addClientsBatch">批量加（一行一个名字）</n-button>
          <n-button size="tiny" @click="resetClients">用量清零</n-button>
        </div>
      </div>

      <div class="client-actions" style="margin-bottom: 8px">
        <n-input v-model:value="newClientName" size="small" placeholder="运营名字，如 小九九" style="width: 170px" @keyup.enter="addClient" />
        <n-button size="small" type="primary" @click="addClient">加这一个</n-button>
        <n-button size="small" @click="showBatch = !showBatch">批量加</n-button>
      </div>
      <template v-if="showBatch">
        <n-input v-model:value="batchNames" type="textarea" :rows="3" placeholder="一行一个名字，例如：&#10;小九九&#10;大甜甜&#10;乐乐" style="margin-bottom: 6px" />
        <n-button size="small" type="primary" style="margin-bottom: 8px" @click="addClientsBatch">生成这批密钥</n-button>
      </template>

      <div v-for="c in share.clients" :key="c.token" class="client-row">
        <div class="client-line1">
          <span class="client-name">{{ c.name }}</span>
          <span class="client-token" @click="copyToken(c.token)">{{ c.token }}（点一下复制）</span>
        </div>
        <div class="client-line2">
          <span>用量：{{ c.requests }} 次 · 传上去 {{ c.tokensIn }} tok · 生成 {{ c.tokensOut }} tok</span>
          <span>{{ c.lastUsedAt ? '最后 ' + c.lastUsedAt : '还没用过' }}</span>
        </div>
        <div class="client-line3">
          <n-button size="tiny" @click="copyInvite(c)">复制配置给他</n-button>
          <n-button size="tiny" type="error" ghost @click="askRemove(c.token)">{{ pendingDelete === c.token ? '再点一次确认删除' : '删除' }}</n-button>
          <span v-if="c.lastError" class="error-text">最近报错：{{ c.lastError }}</span>
        </div>
      </div>
      <div v-if="!share.clients.length" class="form-hint">还没有密钥，点「加一个运营」会生成一串专属密钥。</div>
      <div v-if="shareMsg" class="form-hint" style="white-space: pre-wrap">{{ shareMsg }}</div>
    </div>

    <div class="card settings-card">
      <div class="section-header">
        <h3 id="set-system" class="section-title anchor-title">数据同步与报表（推荐）</h3>
      </div>
      <div class="form-hint" style="margin-bottom: 10px">运营每天自动把孵化数据传到私有 GitHub 仓库；老板电脑随时生成日/周/月/季/年报。不传录像，不保存 AI 密钥。</div>
      <div class="sync-grid">
        <label>仓库所有者<n-input v-model:value="sync.owner" size="small" placeholder="shaobinmars-cmd" /></label>
        <label>数据仓库<n-input v-model:value="sync.repo" size="small" placeholder="zhongyi-data" /></label>
        <label>运营名字<n-input v-model:value="sync.operator" size="small" placeholder="张三" /></label>
        <label>GitHub 令牌<n-input v-model:value="sync.token" size="small" type="password" show-password-on="click" placeholder="github_pat_..." /></label>
      </div>
      <div class="form-group switch-group" style="margin-top: 10px">
        <div><label class="form-label">每天自动上传</label><div class="form-hint">电脑关机期间不会传；下次打开软件会自动补传当天最新数据。</div></div>
        <n-switch v-model:value="sync.autoDaily" />
      </div>
      <div class="form-group switch-group">
        <div><label class="form-label">这台是老板汇总电脑</label><div class="form-hint">打开后，每天自动拉取全部运营数据并生成日/周/月/季/年报。</div></div>
        <n-switch v-model:value="sync.bossMode" />
      </div>
      <div class="form-actions">
        <n-button type="primary" @click="saveSync">保存同步设置</n-button>
        <n-button :loading="syncBusy" @click="syncNow">立即上传本机数据</n-button>
        <n-button :loading="syncTesting" @click="checkSync">上传通道自检</n-button>
        <n-button :loading="reportBusy" @click="makeReports">生成全部报表</n-button>
      </div>
      <div v-if="syncMsg" class="form-hint" style="white-space: pre-wrap">{{ syncMsg }}</div>
      <div v-else-if="sync.lastResult" class="form-hint" style="white-space: pre-wrap">上次结果：{{ sync.lastResult }}</div>
      <div v-if="sync.lastUploadAt" class="form-hint">上次上传：{{ new Date(sync.lastUploadAt).toLocaleString('zh-CN') }}；软件每小时检查，超过 20 小时自动补传。</div>
      <details v-if="syncLog.length" class="sync-log"><summary>查看同步日志</summary><pre>{{ syncLog.join('\n') }}</pre></details>
    </div>
    <!-- 公网更新、GitHub 同步、局域网升级 -->

    <!-- 联网更新（公网，跨路由/外场地） -->
    <div class="form-group" style="margin-top: 18px">
      <h3 class="section-title">联网更新（公网，跨路由/外场地可用）</h3>
      <div class="form-hint" style="margin: 6px 0 10px">填一次公网 latest.json 地址，以后点「检查更新 → 一键升级」就行，不用管局域网。</div>
      <div class="form-hint" style="margin: 6px 0 10px">升级只替换程序：GPU 运行库、转写模型、授权、孵化数据和录像都会保留。更新包下载后保存在用户目录的 updates 文件夹，下载不完整或磁盘不足不会安装。</div>
      <div class="form-group" style="display: flex; align-items: center; gap: 10px">
        <n-input v-model:value="updUrl" size="small" placeholder="https://.../latest.json" />
        <n-button size="small" :loading="updChecking" @click="doCheckPublic">检查更新</n-button>
        <n-button size="small" type="warning" :loading="updBusy" @click="doUpgradePublic">一键升级</n-button>
      </div>
      <div class="update-links">
        <button v-for="item in updateSources" :key="item.url" :class="{ active: updUrl === item.url }" @click="chooseUpdateSource(item.url)">{{ item.label }}</button>
      </div>
      <div v-if="updMsg" class="form-hint" style="white-space: pre-wrap">{{ updMsg }}</div>
    </div>

    <details class="settings-advanced">
      <summary>高级：局域网汇总与局域网升级（没有外网时可继续用）</summary>
      <div class="form-hint" style="margin: 6px 0 10px">
        运营电脑上的弹幕、孵化、场次清单、AI 报告，每天自动汇总到你这台；新版本也放在你这台，运营点一下就能升。<b>录像不上传。</b>
      </div>

      <div class="form-group" style="display: flex; align-items: center; gap: 10px">
        <label class="form-label">你这台当汇总服务器</label>
        <n-switch v-model:value="col.enabled" size="small" />
        <n-input-number v-model:value="col.port" size="small" :min="1024" :max="65535" style="width: 120px" />
        <n-button size="small" type="primary" @click="saveCollectSrv">保存并开启</n-button>
        <n-button size="small" @click="openInbox">打开汇总文件夹</n-button>
      </div>
      <div class="form-group" style="display: flex; align-items: center; gap: 10px">
        <label class="form-label">升级包目录</label>
        <n-input v-model:value="col.updateDir" size="small" placeholder="把新安装包 exe 放进这个目录，运营点一下就能升" />
        <n-button size="small" @click="pickUpdateDir">选目录</n-button>
      </div>
      <div v-if="colStatus" class="form-hint">
        服务：{{ colStatus.running ? '运行中' : '未开启' }}　地址：{{ colStatus.baseUrl }}　已收 {{ colStatus.received }} 份
      </div>
      <div v-if="colMsg" class="form-hint" style="white-space: pre-wrap">{{ colMsg }}</div>

      <div class="client-head">运营那台怎么用</div>
      <div class="form-hint" style="margin-bottom: 8px">
        运营只要在用你的 AI 共享，下面两项会自动带上，不用手填。
      </div>
      <div class="form-group" style="display: flex; align-items: center; gap: 10px">
        <label class="form-label">汇总地址</label>
        <n-input v-model:value="cli.serverUrl" size="small" placeholder="留空 = 自动取 AI 共享那台机器" />
        <n-input v-model:value="cli.token" size="small" placeholder="密钥（留空 = 用 AI 共享的）" />
        <n-button size="small" @click="adoptAi">自动填</n-button>
      </div>
      <div class="form-group" style="display: flex; align-items: center; gap: 10px">
        <label class="form-label">每天自动上报</label>
        <n-switch v-model:value="cli.autoDaily" size="small" />
        <n-button size="small" type="primary" :loading="sending" @click="sendNow">立即上报一次</n-button>
        <n-button size="small" :loading="checking" @click="doCheckUpdate">检查更新</n-button>
        <n-button size="small" type="warning" :loading="upgrading" @click="doUpgrade">一键升级</n-button>
      </div>
      <div v-if="cliMsg" class="form-hint" style="white-space: pre-wrap">{{ cliMsg }}</div>
    </details>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NInput, NButton, NSelect, NInputNumber, NSwitch } from 'naive-ui'
import { useSettingsStore } from '../stores/settings'

const settings = useSettingsStore()

const formatOptions = [
  { label: 'MP3', value: 'mp3' },
  { label: 'MP4', value: 'mp4' },
  { label: 'WAV', value: 'wav' },
  { label: 'FLV', value: 'flv' }
]

onMounted(() => {
  settings.loadConfig()
  loadAi()
  loadShare()
  loadCollectAll()
  loadSync()
})

function scrollSetting(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// ---- AI 分析配置 ----
const api = () => (window as any).electronAPI
const ai = ref<any>({ enabled: true, baseUrl: '', apiKey: '', model: '', maxOutputTokens: 8000, temperature: 0.3 })
const aiTesting = ref(false)
const aiMessage = ref('')
const aiOk = ref(true)

// ---- 分享给运营（本机当服务器，一人一密钥 + 用量）----
const share = ref<any>({ enabled: false, port: 57888, clients: [] })
const shareStatus = ref<any>({ running: false, port: 57888, addresses: [], baseUrl: '' })
const shareMsg = ref('')
const wanBusy = ref(false)
const publicBaseUrl = ref('')
const publicMsg = ref('')
const gatewayUrl = ref('http://192.168.1.1')
const newClientName = ref('')
const showBatch = ref(false)
const batchNames = ref('')

// ---- 数据汇总 / 一键升级（局域网）----
const col = ref<any>({ enabled: false, port: 57889, updateDir: '' })
const colStatus = ref<any>(null)
const colMsg = ref('')
const cli = ref<any>({ serverUrl: '', token: '', autoDaily: true })
const sync = ref<any>({ owner: 'shaobinmars-cmd', repo: 'zhongyi-data', token: '', operator: '', autoDaily: true, bossMode: false, lastUploadAt: 0, lastReportDate: '', lastResult: '' })
const syncBusy = ref(false)
const syncTesting = ref(false)
const reportBusy = ref(false)
const syncMsg = ref('')
const syncLog = ref<string[]>([])
const cliMsg = ref('')
const sending = ref(false)
const checking = ref(false)
const upgrading = ref(false)
const vis = ref<any>({ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '', model: 'qwen-vl-plus', maxImages: 4 })
const visMsg = ref('')
async function loadVision() {
  try {
    const c = await (window as any).electronAPI.aiConfigGet()
    vis.value = { baseUrl: c.visionBaseUrl || vis.value.baseUrl, apiKey: c.visionApiKey || '', model: c.visionModel || 'qwen-vl-plus', maxImages: Number(c.visionMaxImages) || 4 }
  } catch { /* ignore */ }
}
async function saveVision() {
  try {
    await (window as any).electronAPI.aiConfigSet({ visionBaseUrl: String(vis.value.baseUrl || '').trim(), visionApiKey: String(vis.value.apiKey || '').trim(), visionModel: String(vis.value.model || '').trim(), visionMaxImages: Number(vis.value.maxImages) || 4 })
    visMsg.value = '已保存'
  } catch (e: any) { visMsg.value = '保存失败：' + (e?.message || e) }
}
loadVision()

const RAW_UPDATE_URL = 'https://raw.githubusercontent.com/shaobinmars-cmd/zhongyi-live-updates/main/latest.json'
const updateSources = [
  { label: '首选 ghfast', url: 'https://ghfast.top/' + RAW_UPDATE_URL },
  { label: '备用 1 ghproxy', url: 'https://ghproxy.net/' + RAW_UPDATE_URL },
  { label: '备用 2 gh-proxy', url: 'https://gh-proxy.com/' + RAW_UPDATE_URL },
  { label: 'GitHub 原文件', url: RAW_UPDATE_URL }
]
const DEFAULT_UPDATE_URL = updateSources[0].url
const savedUpdateUrl = localStorage.getItem('upd_url') || ''
const updUrl = ref(
  !savedUpdateUrl || /(?:fastly|cdn|gcore|testingcf)\.jsdelivr\.net\/gh\/shaobinmars-cmd\/zhongyi-live-updates/i.test(savedUpdateUrl)
    ? DEFAULT_UPDATE_URL
    : savedUpdateUrl
)
const updMsg = ref('')
const updInfo = ref<any>(null)
const updChecking = ref(false)
const updBusy = ref(false)
const updPct = ref(0)

function chooseUpdateSource(url: string) {
  updUrl.value = url
  localStorage.setItem('upd_url', url)
  updMsg.value = '已切换更新入口，正在检查…'
  doCheckPublic().catch(() => { /* 状态会在 updMsg 中显示 */ })
}

async function doCheckPublic() {
  localStorage.setItem('upd_url', updUrl.value.trim())
  updChecking.value = true
  updMsg.value = '检查中…'
  try {
    const r = await (window as any).electronAPI.updateCheckUrl(updUrl.value.trim())
    updInfo.value = r
    updMsg.value = r.message + (r.notes ? '\n' + r.notes : '')
  } catch (e: any) { updMsg.value = '失败：' + (e?.message || e) } finally { updChecking.value = false }
}

async function doUpgradePublic() {
  if (!updInfo.value?.ok) await doCheckPublic()
  if (!updInfo.value?.ok) return
  if (!updInfo.value.newer) { updMsg.value = '已经是最新版本'; return }
  updBusy.value = true
  updPct.value = 0
  updMsg.value = '下载中 0%'
  ;(window as any).electronAPI.onUpdateProgress((p: number) => { updPct.value = p; updMsg.value = `下载中 ${p}%` })
  const m = { version: updInfo.value.latest, url: updInfo.value.url, parts: updInfo.value.parts, sha256: updInfo.value.sha256, size: updInfo.value.size }
  const d = await (window as any).electronAPI.updateDownloadManifest(m)
  if (!d?.ok) { updMsg.value = d?.message || '下载失败'; updBusy.value = false; return }
  updMsg.value = '下载完成，正在安装…'
  const inst = await (window as any).electronAPI.updateInstallFile(d.path)
  if (!inst?.ok) { updMsg.value = inst?.message || '安装启动失败'; updBusy.value = false }
}
const configText = ref('')
const pendingDelete = ref('')

// 以后加人：填名字 + 新 key → 生成一段可以直接转发的话
const genName = ref('')
const genKey = ref('')
const genBase = ref('https://api.deepseek.com/v1')
const genMsg = ref('')
const genText = ref('')

function genInvite() {
  const key = genKey.value.trim()
  const base = (genBase.value.trim() || 'https://api.deepseek.com/v1').replace(/\/+$/, '')
  if (!key.startsWith('sk-')) { genMsg.value = 'key 不对：DeepSeek 的 key 是 sk- 开头的，别漏字符'; return }
  const name = genName.value.trim() || '你好'
  const code = ['ZYAI1', base, key, 'deepseek-chat'].join('|')
  const text = [
    name + '，软件装好、激活之后照这个弄：',
    '1) 打开软件 → 左边「设置」页',
    '2) 找到「管理员发的配置串（可选，一键填好）」',
    '3) 把下面这一整行粘进去，点右边的「一键填好」',
    '',
    code,
    '',
    '提示“连接成功”就能用了。以后拆完，在「拆解」页点「AI 分析」，报告会自己生成。'
  ].join('\n')
  genText.value = text
  try {
    navigator.clipboard.writeText(text)
    genMsg.value = '已复制，直接微信发给他（下面也能手动选中复制）'
  } catch {
    genMsg.value = '复制失败，请手动选中下面的文字复制'
  }
}

// 删除走两次点击确认（Electron 里没有原生输入框/确认框，不能靠 prompt/confirm）
async function askRemove(token: string) {
  if (pendingDelete.value !== token) {
    pendingDelete.value = token
    shareMsg.value = '再点一次就删掉这个密钥（那个人马上不能用）'
    return
  }
  pendingDelete.value = ''
  await removeClient(token)
}

// 运营端：一键把管理员发来的配置串填好
async function pasteConfig() {
  let text = configText.value.trim()
  if (!/https?:\/\//i.test(text)) {
    try { text = (await navigator.clipboard.readText()).trim() } catch { /* 读不到就用上面的框 */ }
  }
  // 两种写法都认：带 ZYAI1 前缀的整段，或直接「地址|密钥|模型」
  const body = text.startsWith('ZYAI1|') ? text.slice(6) : text
  const parts = body.split('|').map((s) => s.trim()).filter(Boolean)
  if (parts.length < 2 || !/^https?:\/\//i.test(parts[0]) || !parts[1].startsWith('sk-')) {
    aiOk.value = false
    aiMessage.value = '配置没认出来。要形如「https://api.deepseek.com/v1|sk-xxxx|deepseek-chat」（前面多一段 ZYAI1| 也行）'
    return
  }
  ai.value.baseUrl = parts[0].replace(/\/+$/, '')
  ai.value.apiKey = parts[1]
  ai.value.model = parts[2] || 'deepseek-chat'
  await saveAi()
  await testAi()
}

async function addClientsBatch() {
  const input = batchNames.value
  if (!input.trim()) { shareMsg.value = '先在框里写名字，一行一个'; return }
  const names = input.split(/[\r\n,，、]+/).map((s) => s.trim()).filter(Boolean)
  if (!names.length) return
  try {
    const r = await api().aiShareAddMany(names)
    share.value = r.config
    shareStatus.value = r.status
    shareMsg.value = '已生成 ' + (r.created?.length || 0) + ' 把密钥：' + (r.created || []).map((c: any) => c.name).join('、')
  } catch (ex: any) {
    shareMsg.value = '批量生成失败：' + (ex?.message || ex)
  }
}

async function openPublic() {
  wanBusy.value = true
  publicMsg.value = '正在查公网 IP、开路由器端口…'
  try {
    const wan = await api().aiWanIp()
    if (wan && wan.ok && wan.ip) {
      const isPrivate = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(wan.ip)
      if (isPrivate) {
        const p = wan.ip.split('.')
        gatewayUrl.value = 'http://' + p[0] + '.' + p[1] + '.' + p[2] + '.1'
        publicMsg.value = '现在是两层网络（路由器上面还有一层：' + wan.ip + '）。内层端口已自动开，还需要在光猫里放行：\n1) 点「打开光猫/路由器设置页」登录\n2) 找「端口映射 / 虚拟服务器 / DMZ」\n3) 把 ' + wan.ip + ' 设为 DMZ 主机（或把 ' + share.value.port + ' 映射到 ' + wan.ip + ':' + share.value.port + '）\n4) 回来再点一次「一键开放外网」'
      }
    } else if (wan && !wan.ok) {
      publicMsg.value = '查不到外网 IP：' + (wan.message || '')
    }
    const r = await api().aiOpenPort(share.value.port)
    if (r && r.ok) {
      publicBaseUrl.value = 'http://' + r.externalIp + ':' + share.value.port + '/v1'
      publicMsg.value = '外网已开通，外地运营填：' + publicBaseUrl.value + '\n（路由器断电重启后再点一次「一键开放外网」即可）'
    } else {
      publicMsg.value = (publicMsg.value ? publicMsg.value + '\n\n' : '') + '自动开放结果：' + ((r && r.message) || '失败')
    }
  } catch (ex: any) {
    publicMsg.value = '失败：' + (ex?.message || ex)
  } finally {
    wanBusy.value = false
  }
}

async function closePublic() {
  try {
    const r = await api().aiClosePort(share.value.port)
    publicMsg.value = (r && r.message) || '已关闭'
    publicBaseUrl.value = ''
  } catch (ex: any) {
    publicMsg.value = '失败：' + (ex?.message || ex)
  }
}

function openRouter() {
  window.open(gatewayUrl.value, '_blank')
}

async function loadShare() {
  try {
    share.value = await api().aiShareGet()
    shareStatus.value = await api().aiShareStatus()
  } catch { /* 读不到就用默认值 */ }
}

async function saveShareCfg() {
  try {
    const r = await api().aiShareSet({ enabled: share.value.enabled, port: share.value.port })
    share.value = r.config
    shareStatus.value = r.status
    shareMsg.value = share.value.enabled ? '已开启，把地址和密钥发给运营' : '已关闭'
  } catch (ex: any) {
    shareMsg.value = '保存失败：' + (ex?.message || ex)
  }
}

async function addClient() {
  const name = window.prompt('这位运营叫什么？（写名字方便你看用量）', '')
  if (name === null) return
  try {
    const r = await api().aiShareAdd(name)
    share.value = r.config
    shareStatus.value = r.status
    shareMsg.value = '已生成密钥：' + (r.client?.token || '')
  } catch (ex: any) {
    shareMsg.value = '生成失败：' + (ex?.message || ex)
  }
}

async function removeClient(token: string) {
  try {
    share.value = await api().aiShareRemove(token)
    shareStatus.value = await api().aiShareStatus()
    shareMsg.value = '已删除密钥（那个人马上就不能用了）'
  } catch (ex: any) {
    shareMsg.value = '删除失败：' + (ex?.message || ex)
  }
}

async function resetClients() {
  try {
    share.value = await api().aiShareReset()
    shareMsg.value = '用量已清零（密钥没变，运营不用改）'
  } catch (ex: any) {
    shareMsg.value = '清零失败：' + (ex?.message || ex)
  }
}

function copyToken(token: string) {
  try {
    navigator.clipboard.writeText(token)
    shareMsg.value = '密钥已复制：' + token
  } catch { /* ignore */ }
}

function copyInvite(c: any) {
  const url = publicBaseUrl.value || shareStatus.value.baseUrl
  const code = ['ZYAI1', url, c.token, 'deepseek-chat'].join('|')
  const text = [
    (c.name || '你好') + '，打开软件 →「设置」页 → 点「粘贴配置（一键填好）」→ 把下面整段粘进去：',
    '',
    code,
    '',
    '（地址：' + url + '　密钥：' + c.token + '）'
  ].join('\n')
  try {
    navigator.clipboard.writeText(text)
    shareMsg.value = '已复制，直接微信发给他：\n' + text
  } catch { /* ignore */ }
}

async function loadCollectAll() {
  try {
    col.value = await api().collectServerGet()
    colStatus.value = await api().collectServerStatus()
  } catch { /* 读不到就用默认值 */ }
  try { cli.value = await api().collectConfigGet() } catch { /* ignore */ }
}

async function saveCollectSrv() {
  colMsg.value = ''
  try {
    const r = await api().collectServerSet({
      enabled: !!col.value.enabled,
      port: Number(col.value.port) || 57889,
      updateDir: String(col.value.updateDir || '')
    })
    col.value = r.config
    colStatus.value = r.status
    colMsg.value = col.value.enabled ? '已开启，运营那台现在就能上报和升级了' : '已关闭'
  } catch (ex: any) {
    colMsg.value = '保存失败：' + (ex?.message || ex)
  }
}

async function pickUpdateDir() {
  const d = await api().collectBrowseUpdateDir()
  if (d) { col.value.updateDir = d; await saveCollectSrv() }
}

async function openInbox() {
  const r = await api().collectOpenInbox()
  colMsg.value = r?.ok ? '已打开汇总文件夹：' + r.dir : ('打不开：' + (r?.message || ''))
}

async function adoptAi() {
  cli.value = await api().collectAdoptFromAi()
  cliMsg.value = '已按 AI 共享的地址填好'
}

async function saveCli() {
  await api().collectConfigSet({
    serverUrl: String(cli.value.serverUrl || ''),
    token: String(cli.value.token || ''),
    autoDaily: !!cli.value.autoDaily
  })
}

async function sendNow() {
  sending.value = true
  cliMsg.value = '正在打包上报…（弹幕库大的话要几十秒）'
  try {
    await saveCli()
    const r = await api().collectSendNow()
    cliMsg.value = (r?.ok ? '✅ ' : '❌ ') + (r?.message || '')
  } catch (ex: any) {
    cliMsg.value = '上报失败：' + (ex?.message || ex)
  } finally { sending.value = false }
}

async function doCheckUpdate() {
  checking.value = true
  cliMsg.value = '正在问老板那台最新版是多少…'
  try {
    await saveCli()
    const r = await api().updateCheck()
    cliMsg.value = (r?.ok ? '' : '❌ ') + (r?.message || '')
  } catch (ex: any) {
    cliMsg.value = '检查失败：' + (ex?.message || ex)
  } finally { checking.value = false }
}

async function doUpgrade() {
  upgrading.value = true
  cliMsg.value = '正在检查并下载新版本…（局域网很快，别关窗口）'
  try {
    await saveCli()
    const r = await api().updateApply()
    cliMsg.value = (r?.ok ? '✅ ' : '❌ ') + (r?.message || '')
  } catch (ex: any) {
    cliMsg.value = '升级失败：' + (ex?.message || ex)
  } finally { upgrading.value = false }
}

async function loadSync() {
  try { sync.value = await api().syncGet() } catch { /* ignore */ }
}

async function saveSync() {
  try {
    sync.value = await api().syncSet({ ...sync.value })
    syncMsg.value = '同步设置已保存。以后打开软件会自动补传。'
  } catch (e: any) { syncMsg.value = '保存失败：' + (e?.message || e) }
}

async function checkSync() {
  syncTesting.value = true
  syncMsg.value = '正在检查 GitHub 数据仓库和写入权限…'
  try {
    await api().syncSet({ ...sync.value })
    const r = await api().syncTest()
    syncMsg.value = r?.message || (r?.ok ? '上传通道正常' : '上传通道异常')
    syncLog.value = Array.isArray(r?.output) ? r.output.slice(-10) : []
    await loadSync()
  } catch (e: any) {
    syncMsg.value = '自检失败：' + (e?.message || e)
  } finally { syncTesting.value = false }
}

async function syncNow() {
  syncBusy.value = true
  syncMsg.value = '正在打包并上传本机数据…'
  try {
    await api().syncSet({ ...sync.value })
    const r = await api().syncNow()
    syncMsg.value = r?.message || (r?.ok ? '上传完成' : '上传失败')
    syncLog.value = Array.isArray(r?.output) ? r.output.slice(-30) : []
    await loadSync()
  } catch (e: any) { syncMsg.value = '上传失败：' + (e?.message || e) } finally { syncBusy.value = false }
}

async function makeReports() {
  reportBusy.value = true
  syncMsg.value = '正在拉取全部运营数据并生成日报、周报、月报、季报、年报…'
  try {
    await api().syncSet({ ...sync.value })
    const r = await api().syncReports()
    syncMsg.value = r?.message || (r?.ok ? '报表已生成' : '生成失败')
    syncLog.value = Array.isArray(r?.output) ? r.output.slice(-30) : []
  } catch (e: any) { syncMsg.value = '生成失败：' + (e?.message || e) } finally { reportBusy.value = false }
}

async function loadAi() {
  try { ai.value = await api().aiConfigGet() } catch { /* 读不到就用默认值 */ }
}

/**
 * 传给主进程必须是「普通对象」。
 * ai 是 Vue 的响应式对象，直接传过去会报：「An object could not be cloned.」
 * （运营机上就撞过这个：填了 key 点保存/测试都报这句，看着像接口错）
 */
function plainAi() {
  return {
    enabled: !!ai.value.enabled,
    baseUrl: String(ai.value.baseUrl || ''),
    apiKey: String(ai.value.apiKey || ''),
    model: String(ai.value.model || ''),
    maxOutputTokens: Number(ai.value.maxOutputTokens) || 8000,
    temperature: typeof ai.value.temperature === 'number' ? ai.value.temperature : 0.3
  }
}

async function saveAi() {
  try {
    ai.value = await api().aiConfigSet(plainAi())
    aiOk.value = true
    aiMessage.value = '已保存'
  } catch (ex: any) {
    aiOk.value = false
    aiMessage.value = '保存失败：' + (ex?.message || ex)
  }
}

async function testAi() {
  aiTesting.value = true
  aiMessage.value = '正在测试…'
  // 先把当前填的存下来，避免测通了结果没保存
  try { ai.value = await api().aiConfigSet(plainAi()) } catch { /* 存不下也继续测 */ }
  try {
    const r = await api().aiTest(plainAi())
    aiOk.value = !!r?.ok
    aiMessage.value = r?.message || ''
  } catch (ex: any) {
    aiOk.value = false
    aiMessage.value = String(ex?.message || ex)
  } finally {
    aiTesting.value = false
  }
}
</script>

<style scoped>
.settings-page { padding: 16px 20px 20px; height: 100%; overflow-y: auto; }
.settings-hero { display:flex; align-items:center; justify-content:space-between; gap:16px; max-width:1040px; margin:0 auto 14px; padding:14px 18px; border-radius:14px; background:linear-gradient(100deg,#eaf7ff,#f8fcff 58%,#eefbf8); border:1px solid #d7e9f5; }
.settings-sub { color:var(--ink-3); font-size:12px; }
.settings-nav { display:flex; gap:7px; flex-wrap:wrap; }
.settings-nav button { border:1px solid #c9ddea; background:#fff; color:#24546e; border-radius:999px; padding:7px 12px; cursor:pointer; font-size:12px; }
.settings-nav button:hover { border-color:#0b76be; color:#0b76be; }
.anchor-title { scroll-margin-top:20px; }
.page-title { margin-bottom: 20px; }

.settings-card { padding: 22px 24px; max-width: 1040px; margin: 0 auto 16px; }

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
}

.section-title { font-size: 15px; font-weight: 700; color: #1f2328; }

.form-group { margin-bottom: 18px; }
.form-label {
  font-size: 11px;
  color: #6b7280;
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
}

.path-row { display: flex; gap: 8px; }
.form-hint { font-size: 10px; color: #9aa1ab; margin-top: 6px; }

.form-divider {

  height: 1px;
  background: #e6e8ec;
  margin: 20px 0;
}
.switch-group { display: flex; align-items: center; justify-content: space-between; gap: 16px; }

.form-actions { display: flex; align-items: center; gap: 12px; }
.success-text { font-size: 12px; color: #10b981; font-weight: 500; }
.error-text { font-size: 12px; color: #ef4444; font-weight: 500; }

.client-head { display: flex; align-items: center; justify-content: space-between; margin: 14px 0 8px; font-size: 13px; font-weight: 600; color: #1f2328; }
.client-actions { display: flex; gap: 6px; }
.client-row { border: 1px solid #e6e8ec; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; background: #fafbfc; }
.client-line1 { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; flex-wrap: wrap; }
.client-name { font-weight: 600; color: #1f2328; }
.client-token { font-family: Consolas, monospace; font-size: 11px; color: #6b7280; cursor: pointer; }
.client-line2 { display: flex; justify-content: space-between; gap: 10px; font-size: 11px; color: #6b7280; margin-top: 4px; flex-wrap: wrap; }
.client-line3 { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.vision-box { margin: 16px 0 4px; padding: 14px; border:1px solid #d8e8f3; border-radius:12px; background:#f6fbff; }
.vision-title { font-size:13px; font-weight:700; color:#174f6c; }
.vision-grid { display:grid; grid-template-columns: 1.35fr 1fr .75fr 110px auto; gap:8px; align-items:center; margin-top:9px; }
.sync-grid { display:grid; grid-template-columns: repeat(2,minmax(220px,1fr)); gap:12px; }
.sync-grid label { display:flex; flex-direction:column; gap:5px; font-size:11px; color:#607587; }
.sync-log { margin-top:10px; border:1px solid #e2ebf4; border-radius:10px; padding:8px 10px; background:#f8fbfd; }
.sync-log summary { cursor:pointer; color:#56748a; font-size:12px; }
.sync-log pre { margin-top:8px; max-height:220px; overflow:auto; white-space:pre-wrap; font:11px/1.6 Consolas,monospace; color:#385065; }
.settings-advanced { max-width:1040px; margin:0 auto 16px; border:1px solid #e2ebf4; border-radius:12px; background:#fbfdff; padding:12px 16px; }
.settings-advanced > summary { cursor:pointer; color:#56748a; font-size:12px; font-weight:600; }
.update-links { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0; }
.update-links button { border:1px solid #d6e4ee; background:#fff; color:#476273; border-radius:999px; padding:4px 9px; font:11px var(--font); cursor:pointer; }
.update-links button:hover, .update-links button.active { border-color:#0ea5b7; background:#ecfeff; color:#087f8c; }
</style>
