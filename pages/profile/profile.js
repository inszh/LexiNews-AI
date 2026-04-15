// pages/profile/profile.js
const config = require('../../utils/config.js');
Page({
  data: {
    aiUrl: '',
    apiKey: '',
    aiModel: '',
    aiPrompt: '',
    showKey: false,
    readCount: 0,
    aiCount: 0,
    likeCount: 0,
    cacheSize: '计算中...',
    cacheCount: 0,
    // 学习仪表盘数据
    streak: 0,
    isTodayRead: false,
    todayMinutes: 0,
    weeklyStats: [],
    wordTotal: 0,
    wordGrowth: [],
    recentWords: [],
    vocabPage: 1,
    vocabHasMore: true,
    isVocabLoading: false,
    milestones: { next: 10, reached: [] },
    milestonePercent: 0,
    totalArticles: 0
  },

  onLoad() {
    this._loadSettings();
    this._calcCache();
    this._fetchUserStats();
  },

  onShow() {
    this._loadSettings();
    this._calcCache();
    // 预加载本地生词，实现即时同步感
    const localVocab = wx.getStorageSync('vocabulary') || [];
    if (localVocab.length > 0) {
      this.setData({ recentWords: localVocab.slice(0, 30) });
    }
    this._fetchUserStats();
  },

  _fetchUserStats() {
    const api = require('../../utils/api.js');
    const app = getApp();
    const openid = app.globalData.userToken || wx.getStorageSync('user_openid');

    console.log('[Dashboard] Current OpenID:', openid);

    if (!openid) {
      console.warn('[Dashboard] Fetch aborted: No OpenID available. Please check login status.');
      return;
    }

    console.log('[Dashboard] Fetching stats for:', openid);
    api.getUserStats(openid).then(res => {
      console.log('[Stats] Desktop Data:', res);
      const { user, weeklyStats, wordGrowth, milestones } = res;

      // 计算里程碑百分比
      let percent = 0;
      const total = user.totalArticles;
      const next = milestones.next || 500;
      const prev = milestones.reached.length > 0 ? milestones.reached[milestones.reached.length - 1] : 0;

      if (next > prev) {
        percent = Math.min(100, Math.round(((total - prev) / (next - prev)) * 100));
      } else {
        percent = 100;
      }

      // 获取最近 7 天阅读情况 (补全缺失日期)
      const weekData = this._processWeeklyStats(weeklyStats);
      // 使用后端计算的去重总数，如果后端没返则走本地计算逻辑兜底
      const wordTotal = user.totalVocabCount !== undefined ? user.totalVocabCount : wordGrowth.reduce((sum, item) => sum + item.count, 0);

      this.setData({
        streak: user.streak,
        isTodayRead: res.isTodayRead || (user.todayMinutes > 0),
        todayMinutes: user.todayMinutes,
        totalArticles: user.totalArticles,
        readCount: user.totalArticles, // 同步老的已读数
        weeklyStats: weekData,
        milestones: milestones,
        milestonePercent: percent,
        milestoneRemaining: Math.max(0, (milestones.next || 10) - total),
        wordGrowth: wordGrowth,
        wordTotal: wordTotal,
        recentWords: res.recentWords || res.todayWords || [],
        vocabPage: 1,
        vocabHasMore: true
      }, () => {
        console.log('[Dashboard] Data sync successful. Words captured:', this.data.recentWords);
      });

      // 如果有词汇数据，绘制曲线 (在 WXML 渲染完后)
      if (wordGrowth && wordGrowth.length > 0) {
        this.renderVocabChart(wordGrowth);
      }
    }).catch(err => {
      console.error('[Stats] API Error:', err);
    });
  },

  fetchMoreVocab() {
    if (this.data.isVocabLoading || !this.data.vocabHasMore) return;
    
    this.setData({ isVocabLoading: true });
    const api = require('../../utils/api.js');
    const app = getApp();
    const openid = app.globalData.userToken || wx.getStorageSync('user_openid');
    const nextPage = this.data.vocabPage + 1;

    api.getUserVocabulary(openid, nextPage).then(res => {
      const newWords = res.words || [];
      this.setData({
        recentWords: this.data.recentWords.concat(newWords),
        vocabPage: nextPage,
        vocabHasMore: newWords.length > 0,
        isVocabLoading: false
      });
    }).catch(err => {
      console.error('[Vocab] Load more error:', err);
      this.setData({ isVocabLoading: false });
    });
  },

  _processWeeklyStats(raw) {
    const days = ['一', '二', '三', '四', '五', '六', '日'];
    const result = [];
    const now = new Date();

    // 定位到本周一 (0:周日, 1:周一...)
    const dayOfWeek = now.getDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const match = raw.find(r => r.day === dateStr);

      result.push({
        label: days[i],
        minutes: match ? match.minutes : 0,
        height: match ? Math.min(100, Math.round((match.minutes / 120) * 100)) : 0
      });
    }
    return result;
  },

  renderVocabChart(data) {
    const query = wx.createSelectorQuery();
    query.select('#vocabChart')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0]) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getSystemInfoSync().pixelRatio;

        canvas.width = res[0].width * dpr;
        canvas.height = res[0].height * dpr;
        ctx.scale(dpr, dpr);

        const w = res[0].width;
        const h = res[0].height;
        
        // 1. 计算累积增长数据
        let cumulative = 0;
        const pts = data.map(item => {
          cumulative += item.count;
          return { day: item.day, count: cumulative };
        }).slice(-7); // 只画最近7次变动

        if (pts.length < 2) return;

        // 2. 以最大词汇量作为 Y 轴基准
        const maxVal = Math.max(...pts.map(p => p.count)) * 1.2 || 10;

        ctx.clearRect(0, 0, w, h);

        // 绘制渐变填充
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, 'rgba(240, 180, 41, 0.2)');
        grad.addColorStop(1, 'rgba(240, 180, 41, 0)');

        ctx.beginPath();
        ctx.moveTo(0, h);

        pts.forEach((p, i) => {
          const x = (i / (pts.length - 1)) * w;
          const y = h - (p.count / maxVal) * (h - 20) - 10;
          ctx.lineTo(x, y);
        });

        ctx.lineTo(w, h);
        ctx.fillStyle = grad;
        ctx.fill();

        // 绘制主线条
        ctx.beginPath();
        ctx.strokeStyle = '#F0B429';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        pts.forEach((p, i) => {
          const x = (i / (pts.length - 1)) * w;
          const y = h - (p.count / maxVal) * (h - 20) - 10;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      });
  },

  _loadSettings() {
    this._fetchAiConfig();
    const aiPrompt = wx.getStorageSync('ai_prompt') || config.DEFAULT_AI_PROMPT;
    this.setData({ aiPrompt });
  },

  _fetchAiConfig() {
    const self = this;
    wx.request({
      url: config.BASE_URL + '/api/ai/config',
      method: 'GET',
      success: (res) => {
        if (res.statusCode === 200 && res.data) {
          // 后端现在已经返回了平铺后的 model, status, enable_tts 等字段
          // 直接赋值即可，不再需要前端手动映射
          self.setData({ serverAiConfig: res.data });
          console.log('[AiConfig] Sync Success:', res.data);
        }
      }
    });
  },

  onUrlInput(e) { this.setData({ aiUrl: e.detail.value }); },
  onKeyInput(e) { this.setData({ apiKey: e.detail.value }); },
  onModelInput(e) { this.setData({ aiModel: e.detail.value }); },
  onPromptInput(e) { this.setData({ aiPrompt: e.detail.value }); },
  toggleKeyVis() { this.setData({ showKey: !this.data.showKey }); },

  saveSettings() {
    const { aiUrl, apiKey, aiModel, aiPrompt } = this.data;
    wx.setStorageSync('ai_url', aiUrl.trim());
    wx.setStorageSync('ai_key', apiKey.trim());
    wx.setStorageSync('ai_model', aiModel.trim());
    wx.setStorageSync('ai_prompt', aiPrompt.trim());

    const app = getApp();
    app.globalData.aiUrl = aiUrl.trim();
    app.globalData.apiKey = apiKey.trim();
    app.globalData.aiModel = aiModel.trim();
    app.globalData.aiPrompt = aiPrompt.trim();

    wx.showToast({ title: '保存成功', icon: 'success' });
  },

  resetSettings() {
    const defaults = {
      aiUrl: config.DEFAULT_AI_URL,
      apiKey: config.DEFAULT_AI_KEY,
      aiModel: config.DEFAULT_AI_MODEL,
      aiPrompt: config.DEFAULT_AI_PROMPT
    };
    wx.setStorageSync('ai_url', defaults.aiUrl);
    wx.setStorageSync('ai_key', defaults.apiKey);
    wx.setStorageSync('ai_model', defaults.aiModel);
    wx.setStorageSync('ai_prompt', defaults.aiPrompt);
    const app = getApp();
    app.globalData.aiUrl = defaults.aiUrl;
    app.globalData.apiKey = defaults.apiKey;
    app.globalData.aiModel = defaults.aiModel;
    app.globalData.aiPrompt = defaults.aiPrompt;
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
      const keys = info.keys || [];
      
      // 精确提取缓存中的 PageID 并进行去重
      const articleIds = new Set();
      keys.forEach(k => {
        if (k.startsWith('detail_content_')) {
          articleIds.add(k.replace('detail_content_', ''));
        } else if (k.startsWith('analysis_')) {
          articleIds.add(k.replace('analysis_', ''));
        }
      });

      const sizeText = sizeKB >= 1024
        ? (sizeKB / 1024).toFixed(1) + ' MB'
        : sizeKB + ' KB';

      this.setData({
        cacheSize: sizeText,
        cacheCount: articleIds.size
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
          const info = wx.getStorageInfoSync();
          const keys = info.keys || [];
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
  },

  toggleWordTrans(e) {
    const { index } = e.currentTarget.dataset;
    const { recentWords } = this.data;
    if (recentWords && recentWords[index]) {
      recentWords[index].showTrans = !recentWords[index].showTrans;
      this.setData({ recentWords });
    }
  }
});
