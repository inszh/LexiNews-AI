const notion = require('../../utils/notion.js');
const config = require('../../utils/config.js');

// ============================================================
// 缓存常量
// ============================================================
const MAX_DETAIL_CACHE = 30;                          // 最多缓存 30 篇
const DETAIL_CONTENT_TTL = 7 * 24 * 60 * 60 * 1000;  // 内容缓存 7 天
const ANALYSIS_TTL = 14 * 24 * 60 * 60 * 1000;       // 分析结果缓存 14 天

Page({
  data: {
    article: {},
    paragraphs: [],
    liked: false,
    likeCount: 4201,
    bookmarked: false,
    isLoading: true,
    isAnalyzing: false,
    isSpeaking: false,
    // AI 面板
    showAiPanel: false,
    selectedIndex: -1,
    selectedText: '',
    aiInput: '',
    keyboardHeight: 0,
    scrollTarget: '',
    screenHeight: 600
  },

  onLoad(options) {
    const pageId = options.id;
    const app = getApp();
    const sys = wx.getSystemInfoSync();
    this.setData({ screenHeight: sys.windowHeight });

    if (app.globalData.currentArticle) {
      this.setData({ article: { ...app.globalData.currentArticle } });
      wx.setNavigationBarTitle({ title: app.globalData.currentArticle.sourceName || 'News' });
    }

    if (pageId) {
      this._pageId = pageId;
      // 请求结束标志
      const bookmarks = wx.getStorageSync('bookmarks') || [];
      this.setData({ bookmarked: bookmarks.includes(pageId) });
      // 记录已读
      this._markRead(pageId);
      this._loadFromCache(pageId);
      this.fetchContent(pageId);
    }
  },

  // 收藏 / 取消收藏
  toggleBookmark() {
    const pageId = this._pageId;
    if (!pageId) return;
    let bookmarks = wx.getStorageSync('bookmarks') || [];
    const already = bookmarks.includes(pageId);
    if (already) {
      bookmarks = bookmarks.filter(id => id !== pageId);
    } else {
      bookmarks.unshift(pageId);
      // 存储文章元数据以便发现页使用
      const articleMeta = wx.getStorageSync('bookmarks_meta') || {};
      articleMeta[pageId] = {
        id: pageId,
        title:      this.data.article.title      || '',
        sourceName: this.data.article.sourceName || '',
        image:      this.data.article.image      || '',
        category:   this.data.article.category   || '',
        publishedAt:this.data.article.publishedAt|| ''
      };
      wx.setStorageSync('bookmarks_meta', articleMeta);
      wx.showToast({ title: '已收藏', icon: 'success', duration: 1000 });
    }
    wx.setStorageSync('bookmarks', bookmarks);
    this.setData({ bookmarked: !already });
  },

  _markRead(pageId) {
    const reads = wx.getStorageSync('read_ids') || [];
    if (!reads.includes(pageId)) {
      reads.unshift(pageId);
      if (reads.length > 200) reads.pop();
      wx.setStorageSync('read_ids', reads);
    }
  },

  onUnload() {
    // 离开页面时停止朗读
    this._stopSpeaking();
  },

  // ── 缓存读取：优先展示本地内容 ──────────────────────────────
  _loadFromCache(pageId) {
    // 1. 先尝试恢复 analysis（含 inserts）
    try {
      const analysis = wx.getStorageSync(`analysis_${pageId}`);
      if (analysis) {
        if (analysis.paragraphs) {
          this.setData({ paragraphs: analysis.paragraphs, isLoading: false });
        }
        let articleNeedsUpdate = false;
        const updatedArticle = { ...this.data.article };
        if (analysis.titleInserts && analysis.titleInserts.length > 0) {
          updatedArticle.inserts = analysis.titleInserts;
          articleNeedsUpdate = true;
        }
        if (analysis.summaryInserts && analysis.summaryInserts.length > 0) {
          updatedArticle.summaryInserts = analysis.summaryInserts;
          articleNeedsUpdate = true;
        }
        if (articleNeedsUpdate) {
          this.setData({ article: updatedArticle });
        }
      }
    } catch (_) {}

    // 2. 再尝试恢复纯内容块（无 inserts，用于骨架屏即消）
    try {
      const content = wx.getStorageSync(`detail_content_${pageId}`);
      if (content && content.blocks && content.blocks.length > 0) {
        if (this.data.paragraphs.length === 0) {
          // 没有 analysis 缓存时，先用内容缓存展示骨架
          const merged = content.blocks.map(b =>
            b.type === 'p' ? { ...b, inserts: [] } : b
          );
          this.setData({ paragraphs: merged, isLoading: false });
        }
      }
    } catch (_) {}
  },

  // ── 缓存写入：LRU 驱逐旧条目 ────────────────────────────────
  _getCacheIndex() {
    try { return wx.getStorageSync('detail_cache_index') || []; } catch (_) { return []; }
  },

  _updateCacheIndex(pageId) {
    let index = this._getCacheIndex();
    // LRU: 移到末尾
    index = index.filter(id => id !== pageId);
    index.push(pageId);
    // 超出上限时驱逐最旧的
    while (index.length > MAX_DETAIL_CACHE) {
      const oldId = index.shift();
      try { wx.removeStorageSync(`detail_content_${oldId}`); } catch (_) {}
      try { wx.removeStorageSync(`analysis_${oldId}`); } catch (_) {}
    }
    try { wx.setStorageSync('detail_cache_index', index); } catch (_) {}
  },

  _saveDetailContent(pageId, blocks, prop) {
    try {
      wx.setStorageSync(`detail_content_${pageId}`, {
        blocks, prop, savedAt: Date.now()
      });
      this._updateCacheIndex(pageId);
    } catch (_) {}
  },

  // 保存分析结果到本地
  _saveAnalysis() {
    const article = this.data.article || {};
    const pageId = article.id || '';
    if (!pageId) return;
    try {
      wx.setStorageSync(`analysis_${pageId}`, {
        paragraphs: this.data.paragraphs,
        titleInserts: article.inserts || [],
        summaryInserts: article.summaryInserts || [],
        savedAt: Date.now()
      });
      this._updateCacheIndex(pageId);
    } catch (_) {}
  },

  // ── 联网加载内容 ─────────────────────────────────────────────
  async fetchContent(pageId) {
    try {
      wx.showNavigationBarLoading();
      // 如果本地已有内容，不显示全屏加载
      if (this.data.paragraphs.length === 0) {
        this.setData({ isLoading: true });
      }

      const [prop, blocks] = await Promise.all([
        notion.getPageProperties(pageId),
        notion.getPageBlocks(pageId)
      ]);

      if (blocks && blocks.length > 0) {
        // 缓存原始内容
        this._saveDetailContent(pageId, blocks, prop);

        // 恢复已有 inserts
        const analysis = wx.getStorageSync(`analysis_${pageId}`);
        const cachedParagraphs = (analysis && analysis.paragraphs) ? analysis.paragraphs : [];

        const imgBlock = blocks.find(b => b.type === 'img');
        const firstImg = (imgBlock && imgBlock.src) || this.data.article.image;
        const allText  = blocks.filter(b => b.text).map(b => b.text).join('');
        const cnCount  = (allText.match(/[\u4e00-\u9fa5]/g) || []).length;
        const enWords  = (allText.replace(/[\u4e00-\u9fa5]/g, '').match(/\b\w+\b/g) || []).length;
        const readMin  = Math.max(1, Math.round(cnCount / 300 + enWords / 200));

        const mergedParagraphs = blocks.map((b, i) => {
          if (b.type !== 'p') return b;
          const prev = cachedParagraphs[i];
          return { ...b, inserts: (prev && prev.inserts) ? prev.inserts : [] };
        });

        this.setData({
          'article.image':      firstImg,
          'article.summary':    prop.summary || '',
          'article.category':   prop.category || this.data.article.category,
          'article.publishedAt':prop.publishedAt || this.data.article.publishedAt,
          'article.sourceName': prop.source || this.data.article.sourceName,
          'article.icon':       prop.icon || this.data.article.icon,
          'article.readTime':   readMin,
          paragraphs: mergedParagraphs,
          isLoading: false
        });
      } else {
        this.setData({ isLoading: false });
      }
    } catch (err) {
      console.error('fetchContent error', err);
      this.setData({ isLoading: false });
    } finally {
      wx.hideNavigationBarLoading();
    }
  },

  toggleLike() {
    this.setData({ liked: !this.data.liked });
  },

  onParagraphTap(e) {
    const index = e.currentTarget.dataset.index;
    const text  = e.currentTarget.dataset.text || '';
    
    this._stopSpeaking();

    const app = getApp();
    const defaultPrompt = app.globalData.aiPrompt || config.DEFAULT_AI_PROMPT;

    this.setData({
      selectedIndex: index,
      selectedText:  text,
      showAiPanel:   true,
      aiPrompt:      defaultPrompt,
      aiInput:       '',
      keyboardHeight: 0
    });
    // 监听键盘高度变化，让面板随键盘上移
    wx.onKeyboardHeightChange(res => {
      this.setData({ keyboardHeight: res.height });
    });
  },

  noop() {},

  closeAiPanel() {
    this._stopSpeaking();
    wx.offKeyboardHeightChange();
    this.setData({
      showAiPanel: false,
      selectedIndex: -1,
      keyboardHeight: 0
    });
  },

  // bindfocus/bindblur 备用：部分平台 onKeyboardHeightChange 延迟较大
  onInputFocus(e) {
    const h = e.detail.height || 0;
    if (h > 0) this.setData({ keyboardHeight: h });
  },

  onInputBlur() {
    this.setData({ keyboardHeight: 0 });
  },

  onSelectedTextChange(e) {
    this.setData({ selectedText: e.detail.value });
  },

  onAiInputChange(e) {
    this.setData({ aiInput: e.detail.value });
  },

  onQuickAction(e) {
    const action = e.currentTarget.dataset.action;
    this.setData({ aiInput: action });
  },

  // ── 发送 AI 分析 ────────────────────────────────────
  async onSendAi() {
    // 思考中禁止重复发送
    if (this.data.isAnalyzing) {
      return;
    }

    const app = getApp();
    const DEFAULT_PROMPT = app.globalData.aiPrompt || config.DEFAULT_AI_PROMPT;
    const { selectedText, selectedIndex, paragraphs } = this.data;
    const aiInput = this.data.aiInput.trim() || DEFAULT_PROMPT;
    if (!selectedText) return;

    if (!this.data.aiInput.trim()) {
      this.setData({ aiInput: DEFAULT_PROMPT });
    }

    this.setData({ isAnalyzing: true });

    try {
      const app     = getApp();
      const apiKey  = app.globalData.apiKey  || config.DEFAULT_AI_KEY;
      const apiUrl  = app.globalData.aiUrl   || config.DEFAULT_AI_URL;
      const aiModel = app.globalData.aiModel || config.DEFAULT_AI_MODEL;

      const res = await new Promise((resolve, reject) => {
        this._requestTask = wx.request({
          url: apiUrl,
          method: 'POST',
          header: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          data: {
            model:    aiModel,
            stream:   false,
            messages: [{ role: 'user', content: `${aiInput}:\n\n${selectedText}` }]
          },
          success: resolve,
          fail:    reject
        });
      });
      this._requestTask = null;

      const aiResult = (res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message) 
        ? res.data.choices[0].message.content 
        : '';
      if (!aiResult) throw new Error('空结果');

      const newInsert = {
        id:      Date.now().toString(),
        prompt:  aiInput,
        result:  aiResult,
        collapsed: false
      };

      const updatedParagraphs = [...paragraphs];
      const updatedArticle = { ...this.data.article };
      const idx = parseInt(selectedIndex, 10);

      if (idx === -1) {
        // 标题分析
        if (!updatedArticle.inserts) updatedArticle.inserts = [];
        updatedArticle.inserts = [...updatedArticle.inserts, newInsert];
      } else if (idx === -2) {
        // 摘要分析
        if (!updatedArticle.summaryInserts) updatedArticle.summaryInserts = [];
        updatedArticle.summaryInserts = [...updatedArticle.summaryInserts, newInsert];
      } else {
        const target = updatedParagraphs[idx];
        if (target) {
          if (!target.inserts) target.inserts = [];
          target.inserts = [...target.inserts, newInsert];
        }
      }

      wx.offKeyboardHeightChange();

      this.setData({
        paragraphs:    updatedParagraphs,
        article:       updatedArticle,
        showAiPanel:   false,
        selectedIndex: -1,
        keyboardHeight: 0,
        aiInput:       ''
      });

      this._saveAnalysis();

      // 延迟滚动，等面板关闭动画完成后定位到分析结果
      const targetIdx = selectedIndex;
      setTimeout(() => {
        this.setData({ scrollTarget: 'blk-' + targetIdx });
        setTimeout(() => this.setData({ scrollTarget: '' }), 800);
      }, 380);

    } catch (err) {
      console.error('AI 分析失败', err);
      wx.showToast({ title: 'AI 思考失败，请重试', icon: 'none' });
    } finally {
      this.setData({ isAnalyzing: false });
    }
  },

  // 移除某条 AI 分析结果
  onRemoveAnalysis(e) {
    const { index, id } = e.currentTarget.dataset;
    const idx = parseInt(index, 10);
    const updatedParagraphs = [...this.data.paragraphs];
    let updatedArticle = { ...this.data.article };

    if (idx === -1) {
      if (updatedArticle.inserts) {
        updatedArticle.inserts = updatedArticle.inserts.filter(item => item.id !== id);
      }
    } else if (idx === -2) {
      if (updatedArticle.summaryInserts) {
        updatedArticle.summaryInserts = updatedArticle.summaryInserts.filter(item => item.id !== id);
      }
    } else {
      const target = updatedParagraphs[idx];
      if (target && target.inserts) {
        updatedParagraphs[idx] = {
          ...target,
          inserts: target.inserts.filter(item => item.id !== id)
        };
      }
    }

    this.setData({
      paragraphs: updatedParagraphs,
      article: updatedArticle
    });

    this._saveAnalysis();
  },

  // ── TTS：朗读【选中的英文段落】────────────────────────────────
  onSpeakSelected() {
    const text = this.data.selectedText;
    if (!text) return;

    // 再次点击停止
    if (this.data.isSpeaking) {
      this._stopSpeaking();
      return;
    }

    this.setData({ isSpeaking: true });
    this._doSpeak(text);
  },

  _stopSpeaking() {
    try {
      if (this._ttsCtx) {
        this._ttsCtx.destroy && this._ttsCtx.destroy();
        this._ttsCtx = null;
      }
    } catch (_) {}
    this.setData({ isSpeaking: false });
  },

  _doSpeak(text) {
    // 优先微信原生 TTS（英文语音）
    if (wx.textToSpeech) {
      wx.textToSpeech({
        lang:      'en_US',
        talkSpeed: 1.0,
        content:   text,
        success:   () => {},
        complete:  () => { this.setData({ isSpeaking: false }); },
        fail:      () => {
          this.setData({ isSpeaking: false });
          wx.showToast({ title: '朗读失败', icon: 'none' });
        }
      });
      return;
    }

    // 降级：调 OpenAI 兼容 TTS 接口
    const app    = getApp();
    const apiKey = app.globalData.apiKey || 'sk-bZc0tPtQpawrUn478iMSE4xexyDXn4fm0MCtkhSeY0rrYBUn';
    const apiUrl = (app.globalData.aiUrl || 'https://llm.whitedream.top/v1/chat/completions')
      .replace('/chat/completions', '/audio/speech');

    const audio = wx.createInnerAudioContext();
    this._ttsCtx = audio;
    audio.autoplay = true;
    audio.onEnded(() => { this.setData({ isSpeaking: false }); });
    audio.onError(() => {
      this.setData({ isSpeaking: false });
      wx.showToast({ title: '朗读不可用', icon: 'none' });
    });

    wx.request({
      url:          apiUrl,
      method:       'POST',
      responseType: 'arraybuffer',
      header: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      data: { model: 'tts-1', input: text, voice: 'nova' },
      success: (res) => {
        if (res.statusCode === 200) {
          const fs   = wx.getFileSystemManager();
          const path = `${wx.env.USER_DATA_PATH}/tts_${Date.now()}.mp3`;
          fs.writeFile({
            filePath: path,
            data:     res.data,
            encoding: 'binary',
            success:  () => { audio.src = path; },
            fail:     () => {
              this.setData({ isSpeaking: false });
              wx.showToast({ title: '朗读失败', icon: 'none' });
            }
          });
        } else {
          this.setData({ isSpeaking: false });
          wx.showToast({ title: '朗读不可用', icon: 'none' });
        }
      },
      fail: () => {
        this.setData({ isSpeaking: false });
        wx.showToast({ title: '朗读失败', icon: 'none' });
      }
    });
  }
});