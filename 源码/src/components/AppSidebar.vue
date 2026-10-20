<template>
  <div class="sidebar">
    <div class="nav-items">
      <!-- 工作区：每天打开就该看到的几个 -->
      <div class="nav-group">
        <div class="nav-group-title">工作</div>
        <button
          v-for="item in workItems"
          :key="item.path"
          :class="['nav-item', { active: current === item.path }]"
          @click="$emit('navigate', item.path)"
        >
          <div :class="['nav-indicator', { visible: current === item.path }]"></div>
          <span class="nav-icon" v-html="item.icon"></span>
          <span class="nav-label">{{ item.label }}</span>
        </button>
      </div>

      <!-- 人事（只有老板机出现；运营机自动隐藏，省得看着乱） -->
      <div class="nav-group" v-if="isManager">
        <div class="nav-group-title">管理</div>
        <button
          v-for="item in mgmtItems"
          :key="item.path"
          :class="['nav-item', { active: current === item.path }]"
          @click="$emit('navigate', item.path)"
        >
          <div :class="['nav-indicator', { visible: current === item.path }]"></div>
          <span class="nav-icon" v-html="item.icon"></span>
          <span class="nav-label">{{ item.label }}</span>
        </button>
      </div>

      <!-- 工具 -->
      <div class="nav-group">
        <div class="nav-group-title">工具</div>
        <button
          v-for="item in utilItems"
          :key="item.path"
          :class="['nav-item', { active: current === item.path }]"
          @click="$emit('navigate', item.path)"
        >
          <div :class="['nav-indicator', { visible: current === item.path }]"></div>
          <span class="nav-icon" v-html="item.icon"></span>
          <span class="nav-label">{{ item.label }}</span>
        </button>
      </div>
    </div>
    <div class="sidebar-footer">
      <div class="org-name">太原烁金迪电子科技有限公司</div>
      <div class="version-tag">V {{ appVersion }}<span v-if="isManager" class="role-badge"> 管理端</span></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
defineProps<{ current: string }>()

// 版本号直接读 package.json，以后改版本不用再找这里
import pkg from '../../package.json'
const appVersion = pkg.version
defineEmits<{ navigate: [path: string] }>()

const isManager = ref(false)

// 角色判断：sync 配置里的 bossMode = 这台是老板汇总电脑。
// 不额外存第二份角色配置，避免两边不一致。
onMounted(async () => {
  try {
    const api = (window as any).electronAPI
    const s = await api.syncGet()
    isManager.value = !!s?.bossMode
  } catch { isManager.value = false }
})

const workItems = [
  {
    path: '/dashboard',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8"/><rect x="14" y="3" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8"/><rect x="3" y="14" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8"/><rect x="14" y="14" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8"/></svg>',
    label: '运营总览'
  },
  {
    path: '/live',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="2" y="4" width="20" height="13" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 9h8M8 12h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    label: '直播监播'
  },
  {
    path: '/teardown',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 4h16v12H4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 20h8M12 16v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9.5 8.5l4 2-4 2z" fill="currentColor"/></svg>',
    label: '复盘'
  },
  {
    path: '/incubate',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    label: '主播'
  }
]

const mgmtItems = [
  {
    path: '/hr',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="9.5" cy="7" r="3.4" stroke="currentColor" stroke-width="1.8"/><path d="M17.5 11.5h4M19.5 9.5v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    label: '人事'
  }
]

const utilItems = [
  {
    path: '/music',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 18V5l10-2v13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6.5" cy="18" r="2.5" stroke="currentColor" stroke-width="1.8"/><circle cx="16.5" cy="16" r="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M9 9l10-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    label: '曲库'
  },
  {
    path: '/settings',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    label: '设置'
  },
  {
    path: '/about',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/><path d="M12 16v-4M12 8h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    label: '关于'
  }
]
</script>

<style scoped>
.sidebar {
  background: var(--surface-2);
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--line);
  padding: 14px 10px 12px;
}

.nav-items {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.nav-group-title {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: var(--ink-4);
  text-transform: uppercase;
  padding: 2px 12px 4px;
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: none;
  background: transparent;
  color: var(--ink-3);
  font-size: var(--fs-body);
  border-radius: 9px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  position: relative;
  transition: background-color 0.18s ease, color 0.18s ease;
}

.nav-item:hover {
  background: rgba(11, 118, 190, 0.07);
  color: var(--pulse-accent);
}

.nav-item.active {
  background: rgba(11, 118, 190, 0.11);
  color: var(--pulse-accent);
  font-weight: 600;
}

.nav-indicator {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 0;
  background: linear-gradient(180deg, var(--pulse-deep), var(--pulse-cyan));
  border-radius: 0 3px 3px 0;
  transition: height 0.2s ease;
}

.nav-indicator.visible {
  height: 22px;
}

.nav-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.sidebar-footer {
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.org-name {
  text-align: center;
  font-size: 9.5px;
  color: var(--ink-4);
  margin-bottom: 6px;
  letter-spacing: 0.2px;
  line-height: 1.5;
}

.version-tag {
  text-align: center;
  font-family: var(--font-num);
  font-size: 10.5px;
  color: var(--ink-3);
  letter-spacing: 1px;
  font-weight: 500;
}

.role-badge {
  display: inline-block;
  margin-left: 4px;
  padding: 1px 5px;
  border-radius: 999px;
  background: var(--pulse-soft);
  color: var(--pulse-deep);
  font-size: 9px;
  letter-spacing: 0.4px;
  font-family: inherit;
  font-weight: 600;
}
</style>
