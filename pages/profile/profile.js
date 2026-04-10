// pages/profile/profile.js
const config = require('../../utils/config.js');
Page({
  data: {
    aiUrl: '',
    apiKey: '',
    aiModel: '',
    aiPrompt: '',
    showKey: false,
    readCount: 48,
    aiCount: 23,
    likeCount: 12,
    cacheSize: '计算中...',
    cacheCount: 0,
  },

  onLoad() {
    this._loadSettings();
    this._calcCache();
    this._calcStats();
  },

  onShow() {
    this._loadSettings();
    this._calcCache();
    this._calcStats();
  },

  _calcStats() {
    const reads     = wx.getStorageSync('read_ids')   || [];
    const bookmarks = wx.getStorageSync('bookmarks')  || [];
    const cacheIdx  = wx.getStorageSync('detail_cache_index') || [];
    // 简估 AI 分析数：有分析缓存的篇数
    const aiCount = cacheIdx.filter(id => {
      try {
        const a = wx.getStorageSync(`analysis_${id}`);
        return a && a.paragraphs && a.paragraphs.some(p => p.inserts && p.inserts.length > 0);
      } catch { return false; }
    }).length;
    this.setData({
      readCount:  reads.length,
      aiCount:    aiCount,
      likeCount:  bookmarks.length
    });
  },

  _loadSettings() {
    const aiUrl   = wx.getStorageSync('ai_url')    || config.DEFAULT_AI_URL;
    const apiKey  = wx.getStorageSync('ai_key')    || config.DEFAULT_AI_KEY;
    const aiModel = wx.getStorageSync('ai_model')  || config.DEFAULT_AI_MODEL;
    const aiPrompt= wx.getStorageSync('ai_prompt') || config.DEFAULT_AI_PROMPT;
    this.setData({ aiUrl, apiKey, aiModel, aiPrompt });
  },

  onUrlInput(e)   { this.setData({ aiUrl:   e.detail.value }); },
  onKeyInput(e)   { this.setData({ apiKey:  e.detail.value }); },
  onModelInput(e) { this.setData({ aiModel: e.detail.value }); },
  onPromptInput(e){ this.setData({ aiPrompt:e.detail.value }); },
  toggleKeyVis()  { this.setData({ showKey: !this.data.showKey }); },

  saveSettings() {
    const { aiUrl, apiKey, aiModel, aiPrompt } = this.data;
    wx.setStorageSync('ai_url',   aiUrl.trim());
    wx.setStorageSync('ai_key',   apiKey.trim());
    wx.setStorageSync('ai_model', aiModel.trim());
    wx.setStorageSync('ai_prompt',aiPrompt.trim());

    const app = getApp();
    app.globalData.aiUrl   = aiUrl.trim();
    app.globalData.apiKey  = apiKey.trim();
    app.globalData.aiModel = aiModel.trim();
    app.globalData.aiPrompt= aiPrompt.trim();

    wx.showToast({ title: '保存成功', icon: 'success' });
  },

  resetSettings() {
    const defaults = {
      aiUrl:   config.DEFAULT_AI_URL,
      apiKey:  config.DEFAULT_AI_KEY,
      aiModel: config.DEFAULT_AI_MODEL,
      aiPrompt: config.DEFAULT_AI_PROMPT
    };
    wx.setStorageSync('ai_url',   defaults.aiUrl);
    wx.setStorageSync('ai_key',   defaults.apiKey);
    wx.setStorageSync('ai_model', defaults.aiModel);
    wx.setStorageSync('ai_prompt',defaults.aiPrompt);
    const app = getApp();
    app.globalData.aiUrl   = defaults.aiUrl;
    app.globalData.apiKey  = defaults.apiKey;
    app.globalData.aiModel = defaults.aiModel;
    app.globalData.aiPrompt= defaults.aiPrompt;
    this.setData(defaults);
    wx.showToast({ title: '已恢复默认', icon: 'success' });
  },

  // 跳转小红书
  openXiaohongshu() {
    wx.navigateToMiniProgram({
      appId: 'wx87b3e2b9a2f13a18', // 小红书小程序 AppID
      path: '',
      extraData: {},
      fail: () => {
        // 小程序跳转失败时，用剪贴板方式
        wx.setClipboardData({
          data: 'https://xhslink.com/m/16xjFq87q7b',
          success: () => {
            wx.showModal({
              title: '𝕏 小红书',
              content: '链接已复制到剪贴板，请在浏览器中打开：\nhttps://xhslink.com/m/16xjFq87q7b',
              showCancel: false,
              confirmText: '好的'
            });
          }
        });
      }
    });
  },

  // 跳转微信公众号
  openWechatOA() {
    wx.showModal({
      title: '微信公众号',
      content: '搜索公众号「@Zane同学说」即可关注，获取更多精彩内容！',
      cancelText: '取消',
      confirmText: '去搜索',
      success: (res) => {
        if (res.confirm) {
          // 复制公众号名到剪贴板，方便搜索
          wx.setClipboardData({ data: 'Zane同学说' });
        }
      }
    });
  },

  // ── 缓存管理 ──────────────────────────────────────────────
  _calcCache() {
    try {
      const info = wx.getStorageInfoSync();
      const sizeKB = info.currentSize || 0;
      const keys   = info.keys || [];
      // 统计文章相关缓存条数
      const articleKeys = keys.filter(k =>
        k.startsWith('detail_content_') || k.startsWith('analysis_')
      );
      const sizeText = sizeKB >= 1024
        ? (sizeKB / 1024).toFixed(1) + ' MB'
        : sizeKB + ' KB';
      this.setData({
        cacheSize:  sizeText,
        cacheCount: Math.floor(articleKeys.length / 2) // content+analysis 算一篇
      });
    } catch (_) {
      this.setData({ cacheSize: '未知', cacheCount: 0 });
    }
  },

  clearCache() {
    wx.showModal({
      title: '清理缓存',
      content: `将清除文章内容缓存和AI分析缓存，共约 ${this.data.cacheSize}。\n首页数据也将在下次打开时重新拉取。`,
      confirmText: '清除',
      confirmColor: '#FF3B30',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return;
        try {
          const info  = wx.getStorageInfoSync();
          const keys  = info.keys || [];
          // 清除文章内容缓存
          keys.filter(k =>
            k.startsWith('detail_content_') ||
            k.startsWith('analysis_')
          ).forEach(k => wx.removeStorageSync(k));
          // 清除索引和首页缓存
          wx.removeStorageSync('detail_cache_index');
          wx.removeStorageSync('index_articles_cache');

          wx.showToast({ title: '缓存已清理', icon: 'success' });
          this._calcCache();
        } catch (_) {
          wx.showToast({ title: '清理失败', icon: 'none' });
        }
      }
    });
  }
});

