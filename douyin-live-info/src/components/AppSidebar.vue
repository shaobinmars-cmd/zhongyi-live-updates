<template>
  <div class="sidebar">
    <div class="sidebar-brand">
      <div class="brand-mark">众</div>
      <div class="brand-text">
        <span class="brand-name">众艺传媒</span>
        <span class="brand-sub">ZHONGYI MEDIA</span>
      </div>
    </div>
    <div class="nav-items">
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
  background: #ffffff;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #ffffff;
  padding: 20px 8px 12px;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px 20px;
  border-bottom: 1px solid #ffffff;
  margin-bottom: 16px;
}

.brand-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 品牌标记：用公司图标同一个橙红渐变，方形圆角 + 白色「众」 */
.brand-mark {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: linear-gradient(135deg, #ff8a3d 0%, #ff6a1a 45%, #e11d48 100%);
  color: #fff;
  font-size: 19px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(255, 106, 26, 0.3);
}
.brand-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.brand-sub {
  font-family: var(--font-num);
  font-size: 8px;
  letter-spacing: 1.6px;
  color: var(--ink-4);
}

.brand-name {
  font-size: 14px;
  font-weight: 700;
  color: #1f2328;
  letter-spacing: 0.5px;
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
  color: #6b7280;
  font-size: 13px;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  position: relative;
  transition: all 0.2s ease;
}

.nav-item:hover {
  background: rgba(249, 115, 22, 0.06);
  color: #a0a4b0;
}

.nav-item.active {
  background: rgba(249, 115, 22, 0.1);
  color: #f97316;
  font-weight: 600;
}

.nav-indicator {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 0;
  background: linear-gradient(180deg, #f97316, #ef4444);
  border-radius: 0 3px 3px 0;
  transition: height 0.2s ease;
}

.nav-indicator.visible {
  height: 20px;
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
  border-top: 1px solid #ffffff;
}

.version-tag {
  text-align: center;
.org-name {
  text-align: center;
  font-size: 9px;
  color: var(--ink-4);
  margin-bottom: 4px;
  letter-spacing: 0.2px;
}

  font-size: 10px;
  color: #9aa1ab;
  letter-spacing: 1px;
  font-weight: 500;
}
</style>
