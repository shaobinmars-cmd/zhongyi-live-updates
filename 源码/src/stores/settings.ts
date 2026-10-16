import { defineStore } from 'pinia'
import { ref } from 'vue'

const api = () => (window as any).electronAPI

export const useSettingsStore = defineStore('settings', () => {
  const outputFormats = ['mp3', 'mp4', 'wav', 'flv']
  const selectedFormat = ref('mp3')
  const outputPath = ref('')
  // 7×24 长挂机相关
  const segmentMinutes = ref(30)
  const maxGB = ref(80)
  const minFreeGB = ref(10)
  const autoReconnect = ref(true)
  const statusMessage = ref('')

  async function loadConfig() {
    const cfg = await api().configLoad()
    selectedFormat.value = cfg.outputFormat
    outputPath.value = cfg.outputPath
    segmentMinutes.value = cfg.segmentMinutes ?? 30
    maxGB.value = cfg.maxGB ?? 80
    minFreeGB.value = cfg.minFreeGB ?? 10
    autoReconnect.value = cfg.autoReconnect !== false
  }

  async function saveConfig() {
    await api().configSave({ outputFormat: selectedFormat.value, outputPath: outputPath.value })
    await api().configSave({
      outputFormat: selectedFormat.value,
      outputPath: outputPath.value,
      segmentMinutes: Number(segmentMinutes.value) || 0,
      maxGB: Number(maxGB.value) || 0,
      minFreeGB: Number(minFreeGB.value) || 0,
      autoReconnect: autoReconnect.value
    })
    statusMessage.value = '已保存'
  }

  async function browsePath() {
    const path = await api().configBrowsePath()
    if (path) outputPath.value = path
  }

  return {
    outputFormats, selectedFormat, outputPath,
    segmentMinutes, maxGB, minFreeGB, autoReconnect, statusMessage,
    loadConfig, saveConfig, browsePath
  }
})
