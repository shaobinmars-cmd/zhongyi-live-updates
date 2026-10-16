<template>
  <div class="sidebar">
    <div class="nav-items">
    <!-- 品牌标志已移到顶部律动带（AppTitlebar），侧边栏只留导航，避免一页两个 Logo -->
      <button
        v-for="item in navItems"
        :key="item.path"
        :class="['nav-item', { active: current === item.path }]"
        @click="$emit('navigate', item.path)"
      >
        <div :class="['nav-indicator', { visible: current === item.path }]"></div>
        <span class="nav-icon" v-html="item.icon"></span>
        <span class="nav-label">{{ item.label }}</span>
      </button>
    </div>
    <div class="sidebar-footer">
      <div class="org-name">太原烁金迪电子科技有限公司</div>
      <div class="version-tag">V {{ appVersion }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ current: string }>()

// 版本号直接读 package.json，以后改版本不用再找这里（之前写死过 2.3.0，差点让运营装错版本）
import pkg from '../../package.json'
const appVersion = pkg.version
defineEmits<{ navigate: [path: string] }>()

const navItems = [
  {
    path: '/dashboard',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8"/><rect x="14" y="3" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8"/><rect x="3" y="14" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8"/><rect x="14" y="14" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8"/></svg>',
    label: '仪表盘'
  },
  {
    path: '/rooms',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="2" y="4" width="20" height="13" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    label: '直播间'
  },
  {
    path: '/danmu',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    label: '弹幕'
  },
  {
    path: '/recording',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>',
    label: '录制'
  },
  {
    path: '/teardown',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 4h16v12H4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 20h8M12 16v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9.5 8.5l4 2-4 2z" fill="currentColor"/></svg>',
    label: '拆解'
  },
  {
    path: '/incubate',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    label: '孵化'
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
  background: #fbfdff;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--line);
  padding: 14px 10px 12px;
}



.nav-items {
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
  background: linear-gradient(180deg, #0a5fa8, #00c2d1);
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
</style>
