<template>
  <div class="gate">
    <div class="gate-card">
      <div class="gate-brand">
        <div class="brand-icon">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="3" width="20" height="14" rx="3" stroke="#f97316" stroke-width="2" />
            <path d="M8 21h8M12 17v4" stroke="#f97316" stroke-width="2" stroke-linecap="round" />
            <circle cx="12" cy="10" r="3" fill="#f97316" opacity="0.3" />
          </svg>
        </div>
        <div>
          <div class="gate-title">直播运营中控台</div>
          <div class="gate-sub">本机还没有授权。把下面的机器码发给管理员，换回授权文件后在这里激活。</div>
        </div>
      </div>

      <div class="gate-block">
        <div class="gate-label">本机机器码</div>
        <div class="machine-row">
          <code class="machine">{{ machine }}</code>
          <n-button size="tiny" @click="copyCode">{{ copied ? '已复制' : '复制' }}</n-button>
        </div>
      </div>

      <div v-if="reason" class="gate-reason">{{ reason }}</div>

      <div class="gate-block">
        <div class="gate-label">授权内容</div>
        <n-input
          v-model:value="text"
          type="textarea"
          :rows="6"
          placeholder="把管理员发来的 授权.json 内容整段粘贴到这里，或者点下面的「选择授权文件」"
        />
      </div>

      <div class="gate-actions">
        <n-button type="primary" :loading="busy" :disabled="!text.trim()" @click="activate">激活</n-button>
        <n-button :loading="busy" @click="browse">选择授权文件</n-button>
      </div>

      <div v-if="error" class="gate-error">{{ error }}</div>
      <div v-if="info" class="gate-info">{{ info }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NButton, NInput } from 'naive-ui'

const emit = defineEmits<{ activated: [] }>()

const api = () => (window as any).electronAPI

const machine = ref('读取中…')
const reason = ref('')
const text = ref('')
const error = ref('')
const info = ref('')
const busy = ref(false)
const copied = ref(false)

function apply(status: any) {
  if (!status) return
  machine.value = status.machineCode || machine.value
  if (status.licensed) {
    reason.value = ''
    info.value = status.payload
      ? `已授权给：${status.payload.运营 || '—'}　到期：${status.payload.到期}` +
        (typeof status.daysLeft === 'number' ? `（还剩 ${status.daysLeft} 天）` : '')
      : ''
    emit('activated')
    return
  }
  reason.value = status.reason || ''
}

async function refresh() {
  try {
    apply(await api().licenseStatus())
  } catch {
    machine.value = '读取失败'
  }
}

async function activate() {
  error.value = ''
  busy.value = true
  try {
    const st = await api().licenseActivate(text.value)
    if (st?.licensed) {
      apply(st)
    } else {
      error.value = st?.reason || '激活失败'
    }
  } catch (ex: any) {
    error.value = ex?.message || '激活失败'
  } finally {
    busy.value = false
  }
}

async function browse() {
  error.value = ''
  busy.value = true
  try {
    const st = await api().licenseBrowse()
    if (st?.licensed) apply(st)
    else if (st?.reason) error.value = st.reason
  } catch (ex: any) {
    error.value = ex?.message || '读取失败'
  } finally {
    busy.value = false
  }
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(machine.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch { /* ignore */ }
}

onMounted(async () => {
  await refresh()
  // 启动时顺便查一次吊销名单
  try { await api().licenseCheckRevoke() } catch { /* ignore */ }
  await refresh()
})
</script>

<style scoped>
.gate {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f4f5f7;
  padding: 24px;
}

.gate-card {
  width: 560px;
  max-width: 100%;
  background: #ffffff;
  border: 1px solid #e6e8ec;
  border-radius: 12px;
  padding: 28px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
}

.gate-brand { display: flex; align-items: center; gap: 14px; margin-bottom: 22px; }
.brand-icon {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: rgba(249, 115, 22, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.gate-title { font-size: 17px; font-weight: 700; color: #1f2328; }
.gate-sub { font-size: 11px; color: #6b7280; margin-top: 6px; line-height: 1.7; }

.gate-block { margin-bottom: 16px; }
.gate-label { font-size: 11px; color: #6b7280; margin-bottom: 6px; }

.machine-row { display: flex; align-items: center; gap: 10px; }
.machine {
  flex: 1;
  font-family: Consolas, monospace;
  font-size: 14px;
  letter-spacing: 1px;
  color: #f97316;
  background: #f4f5f7;
  border: 1px solid #d8dbe0;
  border-radius: 8px;
  padding: 9px 12px;
  user-select: all;
}

.gate-reason {
  font-size: 11px;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 8px;
  padding: 9px 12px;
  margin-bottom: 16px;
  line-height: 1.7;
}

.gate-actions { display: flex; gap: 10px; margin-top: 4px; }

.gate-error { font-size: 11px; color: #ef4444; margin-top: 12px; line-height: 1.7; }
.gate-info { font-size: 11px; color: #10b981; margin-top: 12px; }
</style>
