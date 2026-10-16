<template>
  <div class="about-page">
    <h2 class="page-title">关于</h2>

    <div class="card about-card">
      <div class="app-info">
        <div class="app-logo">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="3" width="20" height="14" rx="3" stroke="#f97316" stroke-width="2"/>
            <path d="M8 21h8M12 17v4" stroke="#f97316" stroke-width="2" stroke-linecap="round"/>
            <circle cx="12" cy="10" r="3" fill="#f97316" opacity="0.3"/>
          </svg>
        </div>
        <div>
          <div class="app-name">众艺传媒 · 抖音直播运营工具</div>
          <div class="app-version">V {{ appVersion }} · 太原烁金迪电子科技有限公司</div>
        </div>
      </div>

      <div class="section-divider"></div>

      <div class="section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="#f97316" stroke-width="1.8"/>
          <polyline points="22,6 12,13 2,6" stroke="#f97316" stroke-width="1.8" fill="none"/>
        </svg>
        <h3 class="section-title">联系方式</h3>
      </div>

      <div class="contact-row">
        <span class="contact-label">邮箱</span>
        <span class="contact-value">314246817@qq.com</span>
      </div>

      <div class="section-divider"></div>

      <div class="section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="3" stroke="#f97316" stroke-width="1.8"/>
          <circle cx="12" cy="12" r="4" stroke="#f97316" stroke-width="1.8"/>
          <rect x="11" y="4" width="2" height="2" fill="#f97316" rx="1"/>
        </svg>
        <h3 class="section-title">扫码关注</h3>
        <span class="section-tip">扫不出来就点一下放大</span>
      </div>

      <div class="qr-grid">
        <div class="qr-item" @click="zoom('/qq.png')">
          <img src="/qq.png" alt="QQ二维码" class="qr-img" />
          <span class="qr-label">QQ</span>
        </div>
        <div class="qr-item" @click="zoom('/wechat.png')">
          <img src="/wechat.png" alt="微信二维码" class="qr-img" />
          <span class="qr-label">微信</span>
        </div>
        <div class="qr-item" @click="zoom('/douyin.png')">
          <img src="/douyin.png" alt="抖音二维码" class="qr-img" />
          <span class="qr-label">抖音</span>
        </div>
      </div>

      <div class="section-divider"></div>

      <div class="section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="#f97316" stroke-width="1.8" fill="none"/>
        </svg>
        <h3 class="section-title">免责声明</h3>
      </div>

      <div class="disclaimer-text">
        <p>1. 本工具仅供学习和技术研究使用，请勿用于任何商业用途或违法行为。</p>
        <p>2. 使用本工具所产生的一切后果由使用者自行承担，开发者不承担任何责任。</p>
        <p>3. 本工具不存储、不传播任何直播内容，仅采集公开的弹幕互动数据。</p>
        <p>4. 请遵守相关平台的使用条款和当地法律法规，尊重他人隐私和知识产权。</p>
        <p>5. 如有侵权或不妥之处，请联系作者删除。</p>
        <p>6. 本工具完全免费，如您是付费购买的本软件，证明您已经上当受骗。</p>
      </div>
    </div>

    <div v-if="zoomed" class="qr-zoom" @click="zoomed = ''">
      <img :src="zoomed" alt="二维码大图" />
      <div class="qr-zoom-tip">点任意位置关闭</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

// 版本号读 package.json，避免写死导致显示错版
import pkg from '../../package.json'
const appVersion = pkg.version

const zoomed = ref('')

function zoom(src: string) {
  zoomed.value = src
}
</script>

<style scoped>
.about-page { padding: 16px 20px 20px; height: 100%; overflow-y: auto; }

.about-card { padding: 24px; max-width: 760px; margin: 0 auto; }

.app-info {
  display: flex;
  align-items: center;
  gap: 16px;
}

.app-logo {
  width: 56px;
  height: 56px;
  background: rgba(249, 115, 22, 0.1);
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.app-name { font-size: 18px; font-weight: 700; color: #1f2328; }
.app-version { font-size: 12px; color: #6b7280; margin-top: 4px; }

.section-divider {
  height: 1px;
  background: #e6e8ec;
  margin: 20px 0;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.section-title { font-size: 15px; font-weight: 700; color: #1f2328; }
.section-tip { font-size: 11px; color: #9aa1ab; margin-left: auto; }

.contact-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}

.contact-label {
  font-size: 12px;
  color: #6b7280;
  min-width: 48px;
}

.contact-value {
  font-size: 13px;
  color: #f97316;
  font-weight: 500;
}

.qr-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.qr-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  cursor: zoom-in;
}

/*
 * 二维码要够大才扫得动：显示区给到 200px。
 * 太小的话浏览器降采样会把模块糊在一起（微信码原来只有 120px，手机扫不出来）。
 */
.qr-img {
  width: 100%;
  max-width: 200px;
  aspect-ratio: 1;
  object-fit: contain;
  border-radius: 8px;
  border: 1px solid #d8dbe0;
  background: #fff;
  padding: 6px;
  display: block;
}

.qr-label {
  font-size: 12px;
  color: #6b7280;
  font-weight: 500;
}

.qr-zoom {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.86);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  cursor: zoom-out;
  z-index: 50;
}

.qr-zoom img {
  width: auto;
  height: auto;
  max-width: min(72vw, 560px);
  max-height: 72vh;
  background: #fff;
  padding: 12px;
  border-radius: 12px;
  image-rendering: -webkit-optimize-contrast;
}

.qr-zoom-tip { font-size: 12px; color: #6b7280; }

.disclaimer-text {
  font-size: 12px;
  color: #6b7280;
  line-height: 1.8;
}

.disclaimer-text p {
  margin-bottom: 2px;
}
</style>
