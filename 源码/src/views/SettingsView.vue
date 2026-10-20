<template>
  <div class="settings-page">
    <h2 class="page-title">设置</h2>

    <!-- AI 分析 -->
    <div class="card settings-card">
      <div class="section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" stroke="var(--pulse-accent)" stroke-width="1.8" stroke-linecap="round"/>
          <circle cx="12" cy="12" r="3.2" stroke="var(--pulse-accent)" stroke-width="1.8"/>
        </svg>
        <h3 class="section-title">AI 分析</h3>
      </div>

      <div class="ai-presets">
        <div class="preset-row">
          <button
            v-for="(p, i) in aiPresets"
            :key="p.name"
            :class="['preset-chip', { active: activePreset === i }]"
            @click="choosePreset(i)"
          >{{ p.name }}</button>
        </div>
        <div v-if="activePreset != null" class="preset-models">
          <div class="preset-note">{{ aiPresets[activePreset].note }}</div>
          <button
            v-for="m in aiPresets[activePreset].models"
            :key="m"
            :class="['model-chip', { active: ai.model === m }]"
            @click="chooseModel(m)"
          >{{ m }}</button>
        </div>
      </div>

      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">接口地址</label>
          <n-input v-model:value="ai.baseUrl" placeholder="https://ws-r9vynbc12ax2fjvf.cn-beijing.maas.aliyuncs.com/compatible-mode/v1" />
        </div>
        <div class="form-group">
          <label class="form-label">API 密钥</label>
          <n-input v-model:value="ai.apiKey" type="password" show-password-on="click" placeholder="sk-..." />
        </div>
        <div class="form-group">
          <label class="form-label">模型名</label>
          <n-input v-model:value="ai.model" placeholder="qwen-max" />
        </div>
      </div>
      <div class="form-hint">
        上面点一下服务商和模型就自动填好地址和模型名，密钥去对应平台控制台申请。密钥只存在本机。
      </div>

      <div class="form-actions">
        <n-button :loading="aiTesting" type="primary" @click="testAi">测试并保存</n-button>
        <span v-if="aiMessage" :class="aiOk ? 'success-text' : 'error-text'">{{ aiMessage }}</span>
      </div>
    </div>

    <!-- 给新运营发配置 -->
    <div class="card settings-card" v-if="isManager">
      <div class="section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" stroke="var(--pulse-accent)" stroke-width="1.8" stroke-linecap="round"/>
          <circle cx="9.5" cy="7" r="3.4" stroke="var(--pulse-accent)" stroke-width="1.8"/>
          <path d="M17.5 11.5h4M19.5 9.5v4" stroke="var(--pulse-accent)" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <h3 class="section-title">给新运营发配置</h3>
      </div>

      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">运营名字</label>
          <n-input v-model:value="genName" placeholder="如：小九九" />
        </div>
        <div class="form-group">
          <label class="form-label">给他单独建一把 API Key</label>
          <n-input v-model:value="genKey" placeholder="阿里云/DeepSeek 控制台新建" />
        </div>
      </div>
      <div class="form-hint">点「生成并复制」自动带你当前的接口地址和模型名。给每个运营一把独立 key，用量各算各的。</div>

      <div class="form-actions">
        <n-button ghost size="small" @click="applyGenFromAi">自动带我当前配置</n-button>
        <n-button type="primary" @click="genInvite">生成并复制发给他</n-button>
        <span v-if="genMsg" class="success-text">{{ genMsg }}</span>
      </div>
      <n-input v-if="genText" v-model:value="genText" type="textarea" :rows="6" readonly style="margin-top: 10px" />
    </div>

    <!-- 运营端自己的快捷填：粘管理员发的配置串 -->
    <div class="card settings-card" v-else>
      <div class="section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M12 5v14M5 12h14" stroke="var(--pulse-accent)" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <h3 class="section-title">管理员发的配置串</h3>
      </div>
      <div class="form-group">
        <n-input v-model:value="configText" type="textarea" :rows="2" placeholder="粘管理员发你的那整行（ZYAI1|地址|密钥|模型）" />
      </div>
      <div class="form-actions">
        <n-button type="primary" @click="pasteConfig">一键填好</n-button>
        <span v-if="aiMessage" :class="aiOk ? 'success-text' : 'error-text'">{{ aiMessage }}</span>
      </div>
    </div>

    <!-- 数据同步与报表 -->
    <div class="card settings-card" v-if="isManager">
      <div class="section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M4 6h16M4 12h10M4 18h7" stroke="var(--pulse-accent)" stroke-width="1.8" stroke-linecap="round"/>
          <circle cx="18" cy="15" r="3" stroke="var(--pulse-accent)" stroke-width="1.8"/>
        </svg>
        <h3 class="section-title">数据同步与报表</h3>
      </div>
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">数据仓库全名</label>
          <n-input v-model:value="sync.owner" placeholder="shaobinmars-cmd/zhongyi-data" />
        </div>
        <div class="form-group">
          <label class="form-label">GitHub 令牌</label>
          <n-input v-model:value="sync.token" type="password" show-password-on="click" placeholder="github_pat_..." />
        </div>
      </div>
      <div class="form-group switch-group">
        <div>
          <label class="form-label">每天自动上传</label>
          <div class="form-hint">电脑关机期间不会传，下次打开自动补。不传录像、不传密钥。</div>
        </div>
        <n-switch v-model:value="sync.autoDaily" />
      </div>
      <div class="form-group switch-group">
        <div>
          <label class="form-label">这台是老板汇总电脑</label>
          <div class="form-hint">打开后每天自动拉取全部运营数据，生成日/周/月/季报。</div>
        </div>
        <n-switch v-model:value="sync.bossMode" />
      </div>
      <div class="form-actions">
        <n-button type="primary" @click="saveSync">保存</n-button>
        <n-button :loading="syncBusy" @click="syncNow">立即上传</n-button>
        <n-button :loading="reportBusy" @click="makeReports">生成全部报表</n-button>
        <span v-if="syncMsg" class="form-hint" style="color: var(--ok); white-space: pre-wrap">{{ syncMsg }}</span>
      </div>
    </div>

    <!-- ④ 录制 -->
    <div class="card settings-card">
      <div class="section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="3" stroke="var(--pulse-accent)" stroke-width="1.8"/>
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="var(--pulse-accent)" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <h3 class="section-title">录制</h3>
      </div>
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">输出格式</label>
          <n-select v-model:value="settings.selectedFormat" :options="formatOptions" />
        </div>
        <div class="form-group">
          <label class="form-label">保存路径</label>
          <div class="path-row">
            <n-input v-model:value="settings.outputPath" placeholder="留空默认桌面「直播录制」文件夹" />
            <n-button @click="settings.browsePath()">浏览</n-button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">分段（分钟）</label>
          <n-input-number v-model:value="settings.segmentMinutes" :min="0" :max="720" :step="10" style="width: 100%" />
          <div class="form-hint">0 = 一场一个文件。建议 30 分钟，断了只丢一段。</div>
        </div>
        <div class="form-group">
          <label class="form-label">自动重连</label>
          <n-switch v-model:value="settings.autoReconnect" />
        </div>
      </div>
      <div class="form-actions">
        <n-button type="primary" @click="settings.saveConfig()">保存</n-button>
        <span v-if="settings.statusMessage" class="success-text">{{ settings.statusMessage }}</span>
      </div>
    </div>

    <!-- ⑤ 联网更新 -->
    <div class="card settings-card">
      <div class="section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M12 3v12M5 8l7-5 7 5M12 21v-6" stroke="var(--pulse-accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <h3 class="section-title">联网更新</h3>
      </div>
      <div class="form-hint" style="margin-bottom: 10px">跨路由/外场地都能用，升级只替换程序，授权、数据、录像都保留。</div>
      <div class="form-group" style="display: flex; align-items: center; gap: 10px">
        <n-input v-model:value="updUrl" size="small" placeholder="latest.json 地址" />
        <n-button size="small" :loading="updChecking" @click="doCheckPublic">检查更新</n-button>
        <n-button size="small" type="warning" :loading="updBusy" @click="doUpgradePublic">一键升级</n-button>
      </div>
      <div class="update-links">
        <button v-for="item in updateSources" :key="item.url" :class="{ active: updUrl === item.url }" @click="chooseUpdateSource(item.url)">{{ item.label }}</button>
      </div>
      <div v-if="updMsg" class="form-hint" style="white-space: pre-wrap">{{ updMsg }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NInput, NButton, NSelect, NInputNumber, NSwitch } from 'naive-ui'
import { useSettingsStore } from '../stores/settings'

const settings = useSettingsStore()
const api = () => (window as any).electronAPI

const formatOptions = [
  { label: 'MP4', value: 'mp4' },
  { label: 'MP3', value: 'mp3' },
  { label: 'WAV', value: 'wav' },
  { label: 'FLV', value: 'flv' }
]

onMounted(async () => {
  settings.loadConfig()
  await loadAi()
  try {
    const s = await api().syncGet()
    sync.value = s || sync.value
  } catch { /* ignore */ }
  try {
    const s = await api().syncGet()
    isManager.value = !!s?.bossMode
  } catch { /* ignore */ }
})

// ---- AI ----
const ai = ref<any>({ baseUrl: '', apiKey: '', model: '', maxOutputTokens: 8000, temperature: 0.3, maxImages: 4 })
const aiTesting = ref(false)
const aiMessage = ref('')
const aiOk = ref(true)

/** 各家 AI 的接口与常用模型：一键选择即填好地址+模型名，密钥各自去平台申请 */
const aiPresets = [
  {
    name: '阿里通义',
    baseUrl: 'https://ws-r9vynbc12ax2fjvf.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    note: '百炼专属通道（官网控制台复制）：识别图片选 qwen3-vl-plus；纯文字选 qwen-max / qwen-plus，均已实测可用。',
    models: ['qwen3-vl-plus', 'qwen-max', 'qwen-plus']
  },
  {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    note: '便宜稳定，纯文字（看图场景请用智谱 glm-4v）。控制台：platform.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner']
  },
  {
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    note: 'glm-4v 系列支持图片；glm-4-flash 有免费额度。控制台：open.bigmodel.cn',
    models: ['glm-4v-plus', 'glm-4-plus', 'glm-4-air', 'glm-4-flash']
  },
  {
    name: '月之暗面 Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    note: 'kimi-latest 支持图片，长文本见长。控制台：platform.moonshot.cn',
    models: ['kimi-latest', 'moonshot-v1-128k', 'moonshot-v1-32k']
  },
  {
    name: '字节豆包',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    note: '火山方舟：模型名要填控制台里建的「接入点 ID」（ep- 开头），不是模型本名。控制台：console.volcengine.com/ark',
    models: []
  },
  {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    note: '需要能直连外网的网络环境。控制台：platform.openai.com',
    models: ['gpt-4o', 'gpt-4o-mini']
  }
]
const activePreset = ref<number | null>(null)

function choosePreset(i: number) {
  activePreset.value = i
  ai.value.baseUrl = aiPresets[i].baseUrl
}

function chooseModel(m: string) {
  if (activePreset.value != null) ai.value.baseUrl = aiPresets[activePreset.value].baseUrl
  ai.value.model = m
}

/** 按当前地址反查是哪家，进来就高亮对应服务商 */
function syncPresetFromUrl() {
  const u = String(ai.value.baseUrl || '').replace(/\/+$/, '')
  const i = aiPresets.findIndex((p) => p.baseUrl === u)
  activePreset.value = i >= 0 ? i : null
}

// ---- 给新运营发配置 ----
const genName = ref('')
const genKey = ref('')
const genMsg = ref('')
const genText = ref('')

function applyGenFromAi() {
  genMsg.value = '接口地址和模型名会自动带上；只要把单独的 key 填进上面就行'
  setTimeout(() => (genMsg.value = ''), 3000)
}

function genInvite() {
  const key = genKey.value.trim()
  const base = (ai.value.baseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '')
  const model = ai.value.model || 'deepseek-chat'
  if (!key) { genMsg.value = '先填给他的 API Key'; return }
  const name = genName.value.trim() || '你好'
  const code = ['ZYAI1', base, key, model].join('|')
  const text = [
    name + '，软件装好、激活之后照这个弄：',
    '1) 打开软件 → 设置页',
    '2) 找到「管理员发的配置串」框',
    '3) 把下面这一整行粘进去 → 点「一键填好」',
    '',
    code,
    '',
    '提示"连接成功"就能用了。'
  ].join('\n')
  genText.value = text
  try {
    navigator.clipboard.writeText(text)
    genMsg.value = '已复制，直接微信发给他'
  } catch {
    genMsg.value = '复制失败，请手动选中下面的文字复制'
  }
}

// ---- 运营端：粘管理员的串 ----
const configText = ref('')

async function pasteConfig() {
  let text = configText.value.trim()
  if (!text) {
    try { text = (await navigator.clipboard.readText()).trim() } catch { /* ignore */ }
  }
  const body = text.startsWith('ZYAI1|') ? text.slice(6) : text
  const parts = body.split('|').map((s) => s.trim()).filter(Boolean)
  if (parts.length < 2 || !/^https?:\/\//i.test(parts[0])) {
    aiOk.value = false
    aiMessage.value = '没认出来：需要形如 ZYAI1|https://...|密钥|模型'
    return
  }
  ai.value.baseUrl = parts[0].replace(/\/+$/, '')
  ai.value.apiKey = parts[1]
  ai.value.model = parts[2] || 'deepseek-chat'
  await saveAi()
  await testAi()
}

// ---- 数据同步 ----
const isManager = ref(false)
const sync = ref<any>({ owner: '', repo: '', token: '', operator: '', autoDaily: true, bossMode: false, lastUploadAt: 0, lastReportDate: '', lastResult: '' })
const syncBusy = ref(false)
const reportBusy = ref(false)
const syncMsg = ref('')

// 兼容老板机汇总字段
const fullRepo = computed(() => sync.value.owner ? (sync.value.owner + '/' + (sync.value.repo || '')) : '')

async function loadAi() {
  try { ai.value = await api().aiConfigGet(); syncPresetFromUrl() } catch { /* ignore */ }
}

function plainAi() {
  return {
    enabled: !!ai.value.enabled,
    baseUrl: String(ai.value.baseUrl || ''),
    apiKey: String(ai.value.apiKey || ''),
    model: String(ai.value.model || ''),
    maxOutputTokens: Number(ai.value.maxOutputTokens) || 8000,
    temperature: typeof ai.value.temperature === 'number' ? ai.value.temperature : 0.3,
    maxImages: Math.max(0, Math.min(8, Number(ai.value.maxImages) || 0))
  }
}

async function saveAi() {
  try { await api().aiConfigSet(plainAi()); aiOk.value = true; aiMessage.value = '已保存' }
  catch (ex: any) { aiOk.value = false; aiMessage.value = '保存失败：' + (ex?.message || ex) }
}

async function testAi() {
  aiTesting.value = true
  aiMessage.value = '测试中…'
  try { await api().aiConfigSet(plainAi()) } catch { /* ignore */ }
  try {
    const r = await api().aiTest(plainAi())
    aiOk.value = !!r?.ok
    aiMessage.value = r?.message || ''
  } catch (ex: any) {
    aiOk.value = false
    aiMessage.value = String(ex?.message || ex)
  } finally { aiTesting.value = false }
}

async function saveSync() {
  try { sync.value = await api().syncSet({ ...sync.value }); syncMsg.value = '已保存' }
  catch (e: any) { syncMsg.value = '保存失败：' + (e?.message || e) }
}

async function syncNow() {
  syncBusy.value = true
  syncMsg.value = '上传中…'
  try {
    await api().syncSet({ ...sync.value })
    const r2 = await api().syncNow()
    syncMsg.value = r2?.message || (r2?.ok ? '上传完成' : '上传失败')
    await loadSync2()
  } catch (e: any) { syncMsg.value = '上传失败：' + (e?.message || e) } finally { syncBusy.value = false }
}

async function loadSync2() {
  try { sync.value = await api().syncGet() } catch { /* ignore */ }
}

async function makeReports() {
  reportBusy.value = true
  syncMsg.value = '拉取数据 + 生成报表…'
  try {
    await api().syncSet({ ...sync.value })
    const r = await api().syncReports()
    syncMsg.value = r?.message || (r?.ok ? '报表已生成' : '生成失败')
  } catch (e: any) { syncMsg.value = '生成失败：' + (e?.message || e) } finally { reportBusy.value = false }
}

// ---- 联网更新 ----
const RAW_UPDATE_URL = 'https://raw.githubusercontent.com/shaobinmars-cmd/zhongyi-live-updates/main/latest.json'
const updateSources = [
  { label: 'ghfast', url: 'https://ghfast.top/' + RAW_UPDATE_URL },
  { label: 'ghproxy', url: 'https://ghproxy.net/' + RAW_UPDATE_URL },
  { label: 'gh-proxy', url: 'https://gh-proxy.com/' + RAW_UPDATE_URL },
  { label: 'GitHub 原文件', url: RAW_UPDATE_URL }
]
const DEFAULT_UPDATE_URL = updateSources[0].url
const savedUpdateUrl = localStorage.getItem('upd_url') || ''
const updUrl = ref(!savedUpdateUrl ? DEFAULT_UPDATE_URL : savedUpdateUrl)
const updMsg = ref('')
const updInfo = ref<any>(null)
const updChecking = ref(false)
const updBusy = ref(false)

function chooseUpdateSource(url: string) {
  updUrl.value = url
  localStorage.setItem('upd_url', url)
  doCheckPublic().catch(() => { /* ignore */ })
}

async function doCheckPublic() {
  localStorage.setItem('upd_url', updUrl.value.trim())
  updChecking.value = true
  updMsg.value = '检查中…'
  try {
    const r = await api().updateCheckUrl(updUrl.value.trim())
    updInfo.value = r
    updMsg.value = r.message + (r.notes ? '\n' + r.notes : '')
  } catch (e: any) { updMsg.value = '失败：' + (e?.message || e) } finally { updChecking.value = false }
}

async function doUpgradePublic() {
  if (!updInfo.value?.ok) await doCheckPublic()
  if (!updInfo.value?.ok) return
  if (!updInfo.value.newer) { updMsg.value = '已经是最新版本'; return }
  updBusy.value = true
  updMsg.value = '下载中…'
  ;(window as any).electronAPI.onUpdateProgress((p: number) => { updMsg.value = `下载中 ${p}%` })
  const m = { version: updInfo.value.latest, url: updInfo.value.url, parts: updInfo.value.parts, sha256: updInfo.value.sha256, size: updInfo.value.size }
  const d = await api().updateDownloadManifest(m)
  if (!d?.ok) { updMsg.value = d?.message || '下载失败'; updBusy.value = false; return }
  updMsg.value = '下载完成，正在安装…'
  const inst = await api().updateInstallFile(d.path)
  if (!inst?.ok) { updMsg.value = inst?.message || '安装启动失败'; updBusy.value = false }
}
</script>

<style scoped>
.settings-page { padding: 16px 20px 20px; height: 100%; overflow-y: auto; }
.page-title { margin-bottom: 16px; }

.settings-card { padding: 20px 22px; max-width: 920px; margin: 0 auto 14px; }

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}
.section-title { font-size: 15px; font-weight: 700; color: var(--ink); }

/* 两列网格，省纵向空间 */
.form-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px 18px;
}
.form-grid .form-group { margin-bottom: 0; }
.form-grid .form-group:nth-last-child(1):nth-child(odd),
.form-grid .form-group:nth-last-child(2):nth-child(even):nth-last-child(1) { grid-column: span 1; }

.form-group { margin-bottom: 14px; }
.form-label { font-size: 11px; color: var(--ink-3); display: block; margin-bottom: 6px; font-weight: 500; }
.path-row { display: flex; gap: 8px; }
.form-hint { font-size: 11px; color: var(--ink-4); margin-top: 5px; }
.switch-group { display: flex; align-items: center; justify-content: space-between; gap: 16px; }

.form-actions { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.success-text { font-size: 12px; color: var(--ok); font-weight: 500; }
.error-text { font-size: 12px; color: var(--bad); font-weight: 500; }

.update-links { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.update-links button { border: 1px solid var(--pulse-soft); background: var(--surface); color: var(--pulse-deep); border-radius: 999px; padding: 4px 9px; font: 11px var(--font); cursor: pointer; }
.update-links button:hover, .update-links button.active { border-color: var(--pulse-deep); background: var(--pulse-soft); color: var(--pulse-deep); }

/* AI 服务商一键选择 */
.ai-presets { margin-bottom: 14px; }
.preset-row { display: flex; flex-wrap: wrap; gap: 6px; }
.preset-chip {
  border: 1px solid var(--line-2);
  background: var(--surface);
  color: var(--ink-3);
  border-radius: 999px;
  padding: 5px 14px;
  font: 500 12px var(--font);
  cursor: pointer;
  transition: all 0.15s ease;
}
.preset-chip:hover { border-color: var(--pulse-accent); color: var(--pulse-accent); }
.preset-chip.active {
  border-color: var(--pulse-accent);
  background: var(--pulse-soft);
  color: var(--pulse-deep);
  font-weight: 600;
}
.preset-models {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 9px 12px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
}
.preset-note { width: 100%; font-size: 11px; color: var(--ink-4); margin-bottom: 2px; }
.model-chip {
  border: 1px solid var(--line-2);
  background: var(--surface);
  color: var(--pulse-deep);
  border-radius: 6px;
  padding: 3px 10px;
  font: 11px var(--font-num);
  cursor: pointer;
  transition: all 0.15s ease;
}
.model-chip:hover { border-color: var(--pulse-accent); }
.model-chip.active {
  border-color: var(--pulse-accent);
  background: var(--pulse-soft);
  font-weight: 600;
}
</style>
