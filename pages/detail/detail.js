const api = require('../../utils/api.js');
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
    screenHeight: 600,
    // 全文逐段分析状态
    isFullAnalyzing: false,
    fullAnalyzeProgress: 0,
    fullAnalyzeTotal: 0,
    fullAnalyzeDone: false,    // 是否已完成全文分析（置灰按鈕）
    // 阅读进度记录
    savedScrollTop: 0,
    // 新手引导
    showTutorial: false,
    // 单词气泡翻译
    highlightWordId: '',
    showWordBubble: false,
    bubbleTop: 0,
    bubbleLeft: 0,
    bubbleArrowUp: true,
    bubbleData: null,
    isBubbleLoading: false,
    isExistedInVocab: false,
    // 学习深度统计
    aiAnalysisCount: 0,
    wordClickCount: 0,
    fullTranslationCount: 0
  },

  onLoad(options) {
    const pageId = options.id;
    const app = getApp();
    const sys = wx.getSystemInfoSync();
    this.setData({ screenHeight: sys.windowHeight });

    // 记录开始阅读时间 (v1.3)
    this._startTime = Date.now();
    this._pageIdForStats = pageId;

    if (app.globalData.currentArticle) {
      const art = app.globalData.currentArticle;
      if (art.title) {
        art.titleWords = this._processTextToWords(art.title, 'title');
      }
      this.setData({ article: Object.assign({}, art) });
    }

    if (pageId) {
      this._pageId = pageId;
      const bookmarks = wx.getStorageSync('bookmarks') || [];
      this.setData({ bookmarked: bookmarks.includes(pageId) });
      this._markRead(pageId);
      this._loadFromCache(pageId);

      // 尝试恢复阅读进度
      const progress = wx.getStorageSync('read_progress_' + pageId);
      if (progress) {
        console.log('[进度] 发现上次阅读位置:', progress);
        this.setData({ savedScrollTop: progress });
      }

      this.fetchContent(pageId);

      // 检查是否已完成全文分析
      var analysis = wx.getStorageSync('analysis_' + pageId);
      if (analysis && analysis.fullAnalyzeDone) {
        this.setData({ fullAnalyzeDone: true });
      }
    }

    // 检查 AI 服务初始化状态
    this._checkAiStatus();

    // 检查是否首次进入详情页（全局记录，不是每篇文章）
    var tutorialShown = wx.getStorageSync('detail_tutorial_shown');
    if (!tutorialShown) {
      var self = this;
      // 稍延显示，等页面渲染完
      setTimeout(function () {
        self.setData({ showTutorial: true });
      }, 800);
    }
  },

  onUnload() {
    this._recordReading();
    // 1. 停止朗读
    this._stopSpeaking();
    // 2. 这里的 _currentScrollTop 由 onPageScrollLocal 实时记录
    if (this._pageId && this._currentScrollTop > 0) {
      wx.setStorageSync('read_progress_' + this._pageId, this._currentScrollTop);
      console.log('[进度] 已保存当前位置:', this._currentScrollTop);
    }
  },

  _recordReading() {
    const app = getApp();
    const openid = app.globalData.userToken || wx.getStorageSync('user_openid');
    if (!openid || !this._pageIdForStats) return;

    const endTime = Date.now();
    const config = require('../../utils/config.js');
    const durationMs = endTime - this._startTime;
    const aiCount = this.data.aiAnalysisCount;
    const wordCount = this.data.wordClickCount;

    // 新的阅读逻辑：必须停留至少 3 分钟
    // 且满足以下任意一个深度学习条件：
    // 1. 手动触发 AI 字段分析 >= 2 次
    // 2. 单词点击查询成功 >= 6 次
    // 3. 点击并成功完成全文分析/翻译 >= 1 次
    const MIN_TIME = 3 * 60 * 1000;
    const isDeepRead = (durationMs >= MIN_TIME) && (
      aiCount >= 2 ||
      wordCount >= 6 ||
      this.data.fullTranslationCount >= 1
    );

    if (!isDeepRead) {
      console.log(`[Study] 学习未达标: ${Math.round(durationMs / 1000)}s, AI:${aiCount}, Word:${wordCount}, Full:${this.data.fullTranslationCount}`);
      return;
    }

    wx.request({
      url: config.BASE_URL + '/api/user/record-reading',
      method: 'POST',
      data: {
        openid: openid,
        articleId: this._pageIdForStats,
        startTime: this._startTime,
        endTime: endTime
      }
    });
  },

  _recordVocabulary(wordData) {
    const app = getApp();
    const openid = app.globalData.userToken || wx.getStorageSync('user_openid');
    if (!openid || !wordData || !wordData.word) return;

    const config = require('../../utils/config.js');
    wx.request({
      url: config.BASE_URL + '/api/user/vocabulary',
      method: 'POST',
      data: {
        openid: openid,
        word: wordData.word,
        phonetic: wordData.phonetic || '',
        pos: wordData.pos || '',
        trans: wordData.trans || '',
        transGeneral: wordData.transGeneral || '',
        sourceTitle: wordData.sourceTitle || '',
        context: wordData.sentence || ''
      },
      success: (res) => {
        if (res.statusCode === 200 && res.data.id) {
          console.log('[Vocab] Multi-Field Sync Success. ID:', res.data.id);
          // 回填 ID 到本地缓存，由于本地是用 timestamp 标识的，我们找到并更新它
          let list = wx.getStorageSync('vocabulary') || [];
          const idx = list.findIndex(item => item.timestamp === wordData.timestamp);
          if (idx !== -1) {
            list[idx].id = res.data.id;
            wx.setStorageSync('vocabulary', list);
          }
        } else {
          console.error('[Vocab] Sync Server Error:', res.data);
        }
      },
      fail: (err) => {
        console.error('[Vocab] Sync Network Failed:', err);
      }
    });
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
        title: this.data.article.title || '',
        sourceName: this.data.article.sourceName || '',
        image: this.data.article.image || '',
        category: this.data.article.category || '',
        publishedAt: this.data.article.publishedAt || ''
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


  // 监听滚动实时记录位置
  onPageScrollLocal(e) {
    this._currentScrollTop = e.detail.scrollTop;
  },
  _processTextToWords(text, bIdx) {
    if (!text) return [];
    const parts = text.split(/([ \t\n]+)/);
    return parts.map((part, wIdx) => {
      const isWord = /[a-zA-Z]/.test(part) && !/^[ \t\n,.!?;:()\[\]{}"]+$/.test(part);
      return {
        id: `w-${bIdx}-${wIdx}`,
        text: part,
        isWord: isWord
      };
    });
  },

  _findSentence(text, word) {
    if (!text || !word) return '';
    // 简单的分句逻辑：按 . ! ? 加上空格分割
    const sentArr = text.split(/([.!?]\s+)/);
    const sentences = [];
    for (let i = 0; i < sentArr.length; i += 2) {
      sentences.push(sentArr[i] + (sentArr[i + 1] || ''));
    }
    // 寻找包含该单词的句子
    const target = sentences.find(s => s.toLowerCase().includes(word.toLowerCase()));
    return (target || text).trim();
  },

  _processBlocks(blocks) {
    return blocks.map((b, bIdx) => {
      if (!b.text || !['p', 'h1', 'h2', 'h3', 'bullet', 'numbered', 'quote', 'toggle', 'callout', 'code'].includes(b.type)) return b;
      const words = this._processTextToWords(b.text, bIdx);
      return Object.assign({}, b, { words });
    });
  },

  // ── 缓存读取：优先展示本地内容 ──────────────────────────────
  _loadFromCache(pageId) {
    // 1. 先尝试恢复 analysis（含 inserts）
    try {
      const analysis = wx.getStorageSync(`analysis_${pageId}`);
      if (analysis) {
        if (analysis.paragraphs) {
          this.setData({ paragraphs: this._processBlocks(analysis.paragraphs), isLoading: false });
        }
        let articleNeedsUpdate = false;
        const updatedArticle = Object.assign({}, this.data.article);
        if (analysis.titleInserts && analysis.titleInserts.length > 0) {
          updatedArticle.inserts = analysis.titleInserts;
          articleNeedsUpdate = true;
        }
        if (analysis.summaryInserts && analysis.summaryInserts.length > 0) {
          updatedArticle.summaryInserts = analysis.summaryInserts;
          articleNeedsUpdate = true;
        }
        if (analysis.fullInserts && analysis.fullInserts.length > 0) {
          updatedArticle.fullInserts = analysis.fullInserts;
          articleNeedsUpdate = true;
        }
        if (articleNeedsUpdate) {
          this.setData({ article: updatedArticle });
        }
      }
    } catch (_) { }

    // 2. 再尝试恢复纯内容块（无 inserts，用于骨架屏即消）
    try {
      const content = wx.getStorageSync(`detail_content_${pageId}`);
      if (content && content.blocks && content.blocks.length > 0) {
        if (this.data.paragraphs.length === 0) {
          // 没有 analysis 缓存时，先用内容缓存展示骨架
          const processed = this._processBlocks(content.blocks);
          const merged = processed.map(b =>
            b.type === 'p' ? Object.assign({}, b, { inserts: [] }) : b
          );
          this.setData({ paragraphs: merged, isLoading: false });
        }
      }
    } catch (_) { }
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
      try { wx.removeStorageSync(`detail_content_${oldId}`); } catch (_) { }
      try { wx.removeStorageSync(`analysis_${oldId}`); } catch (_) { }
    }
    try { wx.setStorageSync('detail_cache_index', index); } catch (_) { }
  },

  _saveDetailContent(pageId, blocks, prop) {
    try {
      wx.setStorageSync(`detail_content_${pageId}`, {
        blocks, prop, savedAt: Date.now()
      });
      this._updateCacheIndex(pageId);
    } catch (_) { }
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
        fullInserts: article.fullInserts || [],
        savedAt: Date.now()
      });
      this._updateCacheIndex(pageId);
    } catch (_) { }
  },

  // ── 联网加载内容（纯 Promise 链，避免 async/await 兼容问题）────
  fetchContent(pageId) {
    var self = this;
    wx.showNavigationBarLoading();
    if (self.data.paragraphs.length === 0) {
      self.setData({ isLoading: true });
    }

    Promise.all([
      api.getPageProperties(pageId),
      api.getPageBlocks(pageId)
    ]).then((results) => {
      var prop = results[0];
      var blocks = results[1];

      if (blocks && blocks.length > 0) {
        self._saveDetailContent(pageId, blocks, prop);

        var analysis = wx.getStorageSync('analysis_' + pageId);
        var cachedParagraphs = (analysis && analysis.paragraphs) ? analysis.paragraphs : [];

        var imgBlock = null;
        for (var i = 0; i < blocks.length; i++) {
          if (blocks[i].type === 'img') { imgBlock = blocks[i]; break; }
        }
        var firstImg = (imgBlock && imgBlock.src) || self.data.article.image;

        var allText = '';
        for (var i = 0; i < blocks.length; i++) {
          if (blocks[i].text) allText += blocks[i].text;
        }
        var cnCount = (allText.match(/[\u4e00-\u9fa5]/g) || []).length;
        var enWords = (allText.replace(/[\u4e00-\u9fa5]/g, '').match(/\b\w+\b/g) || []).length;
        var readMin = Math.max(1, Math.round(cnCount / 300 + enWords / 200));

        var processed = self._processBlocks(blocks);
        var mergedParagraphs = processed.map((b, i) => {
          if (b.type !== 'p') return b;
          var prev = cachedParagraphs[i];
          return Object.assign({}, b, { inserts: (prev && prev.inserts) ? prev.inserts : [] });
        });

        self.setData({
          'article.titleWords': self._processTextToWords(prop.title || self.data.article.title, 'title'),
          'article.image': firstImg,
          'article.summary': prop.summary || '',
          'article.category': prop.category || self.data.article.category,
          'article.publishedAt': prop.publishedAt || self.data.article.publishedAt,
          'article.sourceName': prop.source || self.data.article.sourceName,
          'article.icon': prop.icon || self.data.article.icon,
          'article.readTime': readMin,
          paragraphs: mergedParagraphs,
          isLoading: false
        });
      } else {
        self.setData({ isLoading: false });
      }
    }).catch((err) => {
      console.error('fetchContent error', err);
      self.setData({ isLoading: false });
    }).then(() => {
      wx.hideNavigationBarLoading();
    });
  },

  toggleLike() {
    this.setData({ liked: !this.data.liked });
  },

  // ── 全文逐段分析：遍历每个段落，逐一调用 AI，结果插入对应段落下方 ──
  onFullAnalysis() {
    var self = this;
    // 已完成全文分析，置灰不可点
    if (self.data.fullAnalyzeDone) return;
    if (self.data.isFullAnalyzing) {
      wx.showToast({ title: '正在分析中…', icon: 'none' });
      return;
    }

    // 筛选所有可分析段落
    var paragraphs = self.data.paragraphs;
    var targets = [];
    for (var i = 0; i < paragraphs.length; i++) {
      var p = paragraphs[i];
      if (p.text && (p.type === 'p' || p.type === 'h1' || p.type === 'h2' || p.type === 'h3'
        || p.type === 'bullet' || p.type === 'numbered' || p.type === 'quote')) {
        targets.push(i);
      }
    }

    if (targets.length === 0) {
      wx.showToast({ title: '没有可分析的段落', icon: 'none' });
      return;
    }

    const app = getApp();
    const prompt = app.globalData.aiPrompt || config.DEFAULT_AI_PROMPT;
    const apiKey = app.globalData.apiKey || config.DEFAULT_AI_KEY;
    const apiUrl = app.globalData.aiUrl || config.DEFAULT_AI_URL;
    const aiModel = app.globalData.aiModel || config.DEFAULT_AI_MODEL;

    // 取消标志（用于中断逐段循环）
    self._cancelFullAnalysis = false;

    self.setData({
      isFullAnalyzing: true,
      fullAnalyzeProgress: 0,
      fullAnalyzeTotal: targets.length
    });

    var index = 0;
    function analyzeNext() {
      // 检查取消标志
      if (self._cancelFullAnalysis) {
        self.setData({ isFullAnalyzing: false });
        self._saveAnalysis();
        wx.showToast({ title: '已取消分析', icon: 'none', duration: 1200 });
        return;
      }

      if (index >= targets.length) {
        self.setData({
          isFullAnalyzing: false,
          fullAnalyzeDone: true,
          fullTranslationCount: self.data.fullTranslationCount + 1
        });
        self._saveAnalysis();
        // 持久化 done 状态
        var pageId = self._pageId;
        if (pageId) {
          var analysis = wx.getStorageSync('analysis_' + pageId) || {};
          analysis.fullAnalyzeDone = true;
          wx.setStorageSync('analysis_' + pageId, analysis);
        }
        wx.showToast({ title: '全文分析完成 ✔', icon: 'success', duration: 1800 });
        return;
      }

      var paraIdx = targets[index];
      var para = self.data.paragraphs[paraIdx];
      var text = (para && para.text) || '';
      if (!text) { index++; analyzeNext(); return; }

      // 全文分析中的单段字数过长跳过逻辑
      if (text.length > 1200) {
        console.warn(`[FullAnalysis] Skipping index ${paraIdx} because content is too long (${text.length} chars)`);
        index++;
        setTimeout(analyzeNext, 100);
        return;
      }

      self._fullAnalysisTask = wx.request({
        url: config.BASE_URL + '/api/ai/proxy',
        method: 'POST',
        data: {
          messages: [{ role: 'user', content: prompt + ':\n\n' + text }],
          stream: false
        },
        success: function (res) {
          if (self._cancelFullAnalysis) { self.setData({ isFullAnalyzing: false }); return; }
          const aiModel = res.data.model || 'Unknown';
          const tokens = res.data.usage?.total_tokens || 'N/A';
          console.log(`[FullAnalyze] Progress: ${index + 1}/${targets.length} | Model: ${aiModel} | Tokens: ${tokens}`);

          var aiResult = (res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message)
            ? res.data.choices[0].message.content : '';
          if (aiResult) {
            var newInsert = {
              id: Date.now().toString() + '_' + paraIdx,
              prompt: prompt,
              result: aiResult,
              collapsed: false
            };
            var updatedParagraphs = self.data.paragraphs.slice();
            var target = updatedParagraphs[paraIdx];
            if (target) {
              var existingInserts = (target.inserts || []).slice();
              existingInserts.push(newInsert);
              updatedParagraphs[paraIdx] = Object.assign({}, target, { inserts: existingInserts });
              self.setData({ paragraphs: updatedParagraphs });
            }
          }
          index++;
          self.setData({ fullAnalyzeProgress: index });
          setTimeout(analyzeNext, 300);
        },
        fail: function () {
          if (self._cancelFullAnalysis) { self.setData({ isFullAnalyzing: false }); return; }
          index++;
          self.setData({ fullAnalyzeProgress: index });
          setTimeout(analyzeNext, 300);
        }
      });
    }

    analyzeNext();
  },

  // 取消全文分析
  onCancelFullAnalysis() {
    this._cancelFullAnalysis = true;
    if (this._fullAnalysisTask) {
      this._fullAnalysisTask.abort();
      this._fullAnalysisTask = null;
    }
    this.setData({ isFullAnalyzing: false });
    this._saveAnalysis();
  },

  // 关闭新手引导蒙版
  onDismissTutorial() {
    wx.setStorageSync('detail_tutorial_shown', true);
    this.setData({ showTutorial: false });
  },

  // ── 手势区分逻辑：Tap vs LongPress ───────────────────────────
  onParagraphTouchStart(e) {
    this._touchStartTime = Date.now();
    this._isLongPressTriggered = false;
    this._lastDataset = e.currentTarget.dataset;

    // 设置 500ms 的长按定时器
    this._longPressTimer = setTimeout(() => {
      this._isLongPressTriggered = true;
      this.innerOnParagraphTap(this._lastDataset.index, this._lastDataset.text);
    }, 500);
  },

  onParagraphTouchEnd(e) {
    // 清除定时器，如果 500ms 内抬起则不触发长按
    if (this._longPressTimer) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
  },

  onParagraphTouchMove(e) {
    // 移动过大则取消判定，减少误触
    if (this._longPressTimer) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
  },

  onWordTap(e) {
    const duration = Date.now() - this._touchStartTime;
    // 短按判定：≤300ms
    if (duration > 300) return;

    // 抬起早于 500ms，清除长按定时器以防万一
    if (this._longPressTimer) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }

    const { word, sentence, id } = e.currentTarget.dataset;
    if (!word || !id) return;

    this.handleWordClick(word, sentence, id);
  },

  handleWordClick(word, sentence, wordId) {
    const self = this;

    // 1. 立即取消旧高亮，关闭旧气泡，展示新高亮
    self.setData({
      highlightWordId: wordId,
      showWordBubble: false,
      bubbleData: null,
      isBubbleLoading: true
    });

    // 2. 测量单词坐标，确定气泡位置
    const query = wx.createSelectorQuery();
    query.select('#' + wordId).boundingClientRect();
    query.selectViewport().scrollOffset();
    query.exec((res) => {
      if (res[0]) {
        const { top, bottom, left, width } = res[0];
        const winWidth = wx.getSystemInfoSync().windowWidth;

        // 气泡宽度固定为 440rpx (220pt)
        const bubbleWidth = 440 * (winWidth / 750);
        let bubbleLeft = left + width / 2 - bubbleWidth / 2;

        // 边界处理：防止超出屏幕左右
        const margin = 20;
        if (bubbleLeft < margin) bubbleLeft = margin;
        if (bubbleLeft + bubbleWidth > winWidth - margin) bubbleLeft = winWidth - bubbleWidth - margin;

        // 默认在下方
        let bubbleTop = bottom + 12;
        let arrowUp = true;

        // 如果下方空间不足，则翻转到上方
        const sys = wx.getSystemInfoSync();
        if (bubbleTop + 140 > sys.windowHeight - 80) { // 预估气泡高度 140px
          bubbleTop = top - 140 - 12;
          arrowUp = false;
        }

        self.setData({
          bubbleTop,
          bubbleLeft,
          bubbleArrowUp: arrowUp,
          showWordBubble: true
        });

        // 3. 提取确切的单句并调用 AI
        const actualSentence = self._findSentence(sentence, word);
        self.translateWordcontext(word, actualSentence);
      }
    });
  },

  translateWordcontext(word, sentence) {
    const self = this;
    const app = getApp();
    const apiKey = app.globalData.apiKey || config.DEFAULT_AI_KEY;
    const apiUrl = app.globalData.aiUrl || config.DEFAULT_AI_URL;
    const aiModel = app.globalData.aiModel || config.DEFAULT_AI_MODEL;

    const prompt = `你是一个专业的英汉词典。请翻译给定的单词并分析原句。要求：
1. 所有的释义、解释和句子翻译必须使用【中文】。
2. 给出单词的原形、音标（IPA格式）、语境下的词性。
3. 给出该词在当前特定单句语境下的精准【中文释义】(trans_context)。
4. 给出该词在通用字典里的常见【中文释义】(trans_general)。
5. 给出该单句的完整【中文翻译】(sentence_trans)。
请严格返回 JSON 格式，不要包含 Markdown 代码块或多余文字：
{"word": "单词原形", "phonetic": "音标", "pos": "词性", "trans_context": "中文语境义", "trans_general": "中文字典义", "sentence_trans": "该句完整中文译文"}`;

    const cleanWord = word.replace(/^[ \t\n,.!?;:()\[\]{}"]+|[ \t\n,.!?;:()\[\]{}"]+$/g, '');

    wx.request({
      url: config.BASE_URL + '/api/ai/proxy',
      method: 'POST',
      data: {
        messages: [{ role: 'user', content: prompt + `\n\nWord: ${cleanWord}\nSentence: ${sentence}` }],
        stream: false
      },
      success: (res) => {
        const activeModel = res.data.model || 'Unknown';
        const tokens = res.data.usage?.total_tokens || 'N/A';
        console.log(`[WordTranslation] Service Status: SUCCESS | Model: ${activeModel} | Tokens: ${tokens}`);

        let data = null;
        try {
          if (res.statusCode === 200 && res.data.choices && res.data.choices[0]) {
            const content = res.data.choices[0].message.content;
            data = JSON.parse(content.replace(/```json|```/g, ''));
          } else {
            console.error('[AI] Invalid response or error from server', res.data);
          }
        } catch (e) {
          console.error('Parse translation error', e, res.data);
        }

        if (data) {
          // 保存原始英文句子，并对单词进行加粗处理
          const regex = new RegExp(`(${cleanWord})`, 'gi');
          data.original_sentence = sentence.replace(regex, '<b>$1</b>');

          // 检查是否已在生词本
          const existed = self._checkVocabExisted(data.word);
          self.setData({
            bubbleData: data,
            isBubbleLoading: false,
            isExistedInVocab: existed,
            wordClickCount: self.data.wordClickCount + 1
          });
        } else {
          self.setData({ showWordBubble: false, highlightWordId: '' });
        }
      },
      fail: () => {
        self.setData({ showWordBubble: false, highlightWordId: '' });
      }
    });
  },

  _checkVocabExisted(word) {
    const list = wx.getStorageSync('vocabulary') || [];
    return list.some(item => item.word.toLowerCase() === word.toLowerCase());
  },

  onAddToVocab() {
    if (this.data.isExistedInVocab || !this.data.bubbleData) return;

    const wordObj = {
      word: this.data.bubbleData.word,
      phonetic: this.data.bubbleData.phonetic,
      pos: this.data.bubbleData.pos,
      trans: this.data.bubbleData.trans_context,
      transGeneral: this.data.bubbleData.trans_general, // 字典意
      sentence: this.data.bubbleData.original_sentence, // 存储英文原句
      sentence_trans: this.data.bubbleData.sentence_trans, // 额外存储译文备用
      sourceTitle: this.data.article.title || 'LexiNews AI',
      timestamp: Date.now()
    };

    let list = wx.getStorageSync('vocabulary') || [];
    list.unshift(wordObj);
    wx.setStorageSync('vocabulary', list);

    // 同步至后端
    this._recordVocabulary(wordObj);

    this.setData({ isExistedInVocab: true });
    wx.showToast({ title: '已加入生词本', icon: 'success' });
  },

  closeWordBubble() {
    this.setData({
      showWordBubble: false,
      highlightWordId: ''
    });
  },

  onParagraphTap(e) {
    // 已废弃，改用 touchstart 判断。保留以防万一直接 bindtap 调用。
  },

  innerOnParagraphTap(index, text) {
    this._stopSpeaking();

    const app = getApp();
    const defaultPrompt = app.globalData.aiPrompt || config.DEFAULT_AI_PROMPT;

    this.setData({
      selectedIndex: index,
      selectedText: text,
      aiPrompt: defaultPrompt,
      aiInput: defaultPrompt,
      keyboardHeight: 0,
      showWordBubble: false, // 长按时关闭单词气泡
      highlightWordId: ''
    });

    // 智能参数化滑动：非负索引（正文内容）才进行对齐滑动
    if (index >= 0) {
      const query = wx.createSelectorQuery().in(this);
      query.select('#blk-' + index).boundingClientRect();
      query.select('.detail-scroll').scrollOffset();
      query.exec((res) => {
        if (res[0] && res[1]) {
          const nodeTop = res[0].top;
          const currentScrollTop = res[1].scrollTop;
          const targetScrollTop = nodeTop + currentScrollTop - 120;
          this.setData({ savedScrollTop: targetScrollTop });
          setTimeout(() => { this.setData({ showAiPanel: true }); }, 300);
        } else {
          this.setData({ showAiPanel: true });
        }
      });
    } else {
      // 标题(index:-1)、摘要(index:-2)等直接显示面板，不触发滚动
      this.setData({ showAiPanel: true });
    }

    wx.onKeyboardHeightChange(res => {
      this.setData({ keyboardHeight: res.height });
    });
  },

  noop() { },

  closeAiPanel() {
    this._stopSpeaking();
    wx.hideKeyboard(); // 强制收起键盘
    wx.offKeyboardHeightChange();
    this.setData({
      showAiPanel: false,
      selectedIndex: -1,
      keyboardHeight: 0
    });
  },

  onInputFocus(e) {
    const h = e.detail.height || 0;
    if (h > 0) this.setData({ keyboardHeight: h });
  },

  onInputBlur() {
    // 不再手动归零，交给全局 onKeyboardHeightChange 处理，防止切换抖动
  },

  onSelectedTextChange(e) {
    this.setData({ selectedText: e.detail.value });
  },

  onAiInputChange(e) {
    this.setData({ aiInput: e.detail.value });
  },

  onQuickAction(e) {
    const action = e.currentTarget.dataset.action;
    // 智能处理：如果是同一类操作则替换，如果是补充则追加（这里采用替换+自动聚焦逻辑）
    this.setData({ aiInput: action });
  },

  // ── 发送 AI 分析（纯 Promise 链）────────────────────────────
  onSendAi() {
    var self = this;
    if (self.data.isAnalyzing) return;

    const app = getApp();
    const DEFAULT_PROMPT = app.globalData.aiPrompt || config.DEFAULT_AI_PROMPT;
    const selectedText = self.data.selectedText;
    const selectedIndex = self.data.selectedIndex;
    const paragraphs = self.data.paragraphs;
    const aiInput = (self.data.aiInput || '').trim() || DEFAULT_PROMPT;

    if (!selectedText) return;

    // v1.4: 增加字数限制，防止 Token 浪费
    if (selectedText.length > 1000) {
      wx.showModal({
        title: '内容过长',
        content: `当前选中的内容过长（${selectedText.length} 字），单次分析建议不超过 1000 字以节省 Token 并获得更好的分析效果。`,
        showCancel: false,
        confirmText: '我知道了'
      });
      return;
    }

    if (!(self.data.aiInput || '').trim()) {
      self.setData({ aiInput: DEFAULT_PROMPT });
    }

    self.setData({ isAnalyzing: true });

    const proxyUrl = config.BASE_URL + '/api/ai/proxy';

    new Promise((resolve, reject) => {
      self._requestTask = wx.request({
        url: proxyUrl,
        method: 'POST',
        data: {
          messages: [{ role: 'user', content: aiInput + ':\n\n' + selectedText }],
          stream: false
        },
        success: (res) => {
          const usedModel = res.data.model || 'Unknown';
          const tokens = res.data.usage?.total_tokens || 'N/A';
          console.log(`[AISession] Request: SUCCESS | Model: ${usedModel} | Tokens: ${tokens}`);
          resolve(res);
        },
        fail: (err) => {
          console.error('[AI Proxy] Request Failed:', err);
          reject(err);
        }
      });
    }).then((res) => {
      self._requestTask = null;

      // 结构化检查原始数据
      if (!res.data) {
        console.error('[AI] Error: Empty response body (no res.data)');
        throw new Error('服务器未返回数据');
      }

      const aiResult = (res.data.choices && res.data.choices[0] && res.data.choices[0].message)
        ? res.data.choices[0].message.content
        : '';

      if (!aiResult) {
        console.error('[AI] Error: Could not find content in response. Raw data:', res.data);
        throw new Error('空结果');
      }

      const newInsert = {
        id: Date.now().toString(),
        prompt: aiInput,
        result: aiResult,
        collapsed: false
      };

      const updatedParagraphs = paragraphs.slice();
      const updatedArticle = Object.assign({}, self.data.article);
      const idx = parseInt(selectedIndex, 10);

      if (idx === -1) {
        if (!updatedArticle.inserts) updatedArticle.inserts = [];
        updatedArticle.inserts = [newInsert].concat(updatedArticle.inserts);
      } else if (idx === -2) {
        if (!updatedArticle.summaryInserts) updatedArticle.summaryInserts = [];
        updatedArticle.summaryInserts = [newInsert].concat(updatedArticle.summaryInserts);
      } else if (idx === -3) {
        if (!updatedArticle.fullInserts) updatedArticle.fullInserts = [];
        updatedArticle.fullInserts = [newInsert].concat(updatedArticle.fullInserts);
      } else {
        const target = updatedParagraphs[idx];
        if (target) {
          if (!target.inserts) target.inserts = [];
          target.inserts = target.inserts.concat([newInsert]);
        }
      }

      wx.offKeyboardHeightChange();

      wx.hideKeyboard(); // 发送成功，收起键盘

      self.setData({
        paragraphs: updatedParagraphs,
        article: updatedArticle,
        showAiPanel: false,
        selectedIndex: -1,
        keyboardHeight: 0,
        aiInput: '',
        aiAnalysisCount: self.data.aiAnalysisCount + 1
      });

      self._saveAnalysis();

      // 同步生词 (v1.3)
      if (selectedText && selectedText.length < 50) {
        console.log('[Vocab] Triggering sync for:', selectedText);
        self._recordVocabulary(selectedText);
      }

      const targetIdx = selectedIndex;
      setTimeout(() => {
        self.setData({ scrollTarget: 'blk-' + targetIdx });
        setTimeout(() => self.setData({ scrollTarget: '' }), 800);
      }, 380);

    }).catch((err) => {
      console.error('AI 分析失败', err);
      wx.showToast({ title: 'AI 思考失败，请重试', icon: 'none' });
    }).then(() => {
      self.setData({ isAnalyzing: false });
    });
  },

  // 移除某条 AI 分析结果
  onRemoveAnalysis(e) {
    const { index, id } = e.currentTarget.dataset;
    const idx = parseInt(index, 10);
    const updatedParagraphs = this.data.paragraphs.slice();
    let updatedArticle = Object.assign({}, this.data.article);

    if (idx === -1) {
      if (updatedArticle.inserts) {
        updatedArticle.inserts = updatedArticle.inserts.filter(item => item.id !== id);
      }
    } else if (idx === -2) {
      if (updatedArticle.summaryInserts) {
        updatedArticle.summaryInserts = updatedArticle.summaryInserts.filter(item => item.id !== id);
      }
    } else if (idx === -3) {
      if (updatedArticle.fullInserts) {
        updatedArticle.fullInserts = updatedArticle.fullInserts.filter(item => item.id !== id);
      }
    } else {
      const target = updatedParagraphs[idx];
      if (target && target.inserts) {
        updatedParagraphs[idx] = Object.assign({}, target, {
          inserts: target.inserts.filter(item => item.id !== id)
        });
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
    } catch (_) { }
    this.setData({ isSpeaking: false });
  },

  onSpeakWord() {
    if (this.data.bubbleData && this.data.bubbleData.word) {
      this._doSpeak(this.data.bubbleData.word);
    }
  },

  _doSpeak(text) {
    // 优先微信原生 TTS（英文语音）
    if (wx.textToSpeech) {
      wx.textToSpeech({
        lang: 'en_US',
        talkSpeed: 1.0,
        content: text,
        success: () => { },
        complete: () => { this.setData({ isSpeaking: false }); },
        fail: () => {
          this.setData({ isSpeaking: false });
          wx.showToast({ title: '朗读失败', icon: 'none' });
        }
      });
      return;
    }

    // 降级：调用后端 AI 语音代理 (v2.0 安全版)
    const ttsProxyUrl = config.BASE_URL + '/api/ai/tts';

    console.log('[TTS Proxy] Requesting:', ttsProxyUrl);

    const audio = wx.createInnerAudioContext();
    this._ttsCtx = audio;
    audio.autoplay = true;
    audio.onEnded(() => { this.setData({ isSpeaking: false }); });
    audio.onError((res) => {
      console.error('[TTS Proxy] Audio Context Error:', res);
      this.setData({ isSpeaking: false });
      wx.showToast({ title: '朗读加载失败', icon: 'none' });
    });

    wx.request({
      url: ttsProxyUrl,
      method: 'POST',
      responseType: 'arraybuffer',
      data: { input: text },
      success: (res) => {
        console.log('[TTS] Response Status Code:', res.statusCode);
        if (res.statusCode === 200) {
          const fs = wx.getFileSystemManager();
          const path = `${wx.env.USER_DATA_PATH}/tts_${Date.now()}.mp3`;
          fs.writeFile({
            filePath: path,
            data: res.data,
            encoding: 'binary',
            success: () => {
              console.log('[TTS] Audio file saved:', path);
              audio.src = path;
            },
            fail: (err) => {
              console.error('[TTS] File System Error:', err);
              this.setData({ isSpeaking: false });
              wx.showToast({ title: '语音文件保存失败', icon: 'none' });
            }
          });
        } else {
          console.error('[TTS] Server Error Data:', res.data);
          this.setData({ isSpeaking: false });
          wx.showToast({ title: `服务不可用(${res.statusCode})`, icon: 'none' });
        }
      },
      fail: (err) => {
        console.error('[TTS] Request Network Failure:', err);
        this.setData({ isSpeaking: false });
        wx.showToast({ title: '网络连接失败', icon: 'none' });
      }
    });
  },

  _checkAiStatus() {
    wx.request({
      url: config.BASE_URL + '/api/ai/config',
      method: 'GET',
      success: (res) => {
        if (res.statusCode === 200 && res.data) {
          const { status, model, activeCount, totalPool } = res.data;
          console.log('-----------------------------------');
          console.log('[AI Service Monitor] OK');
          console.log(`- Status: ${status}`);
          console.log(`- Active Model: ${model}`);
          console.log(`- Health: ${activeCount}/${totalPool} models healthy`);
          console.log('-----------------------------------');
        }
      },
      fail: () => {
        console.error('[AI Service Monitor] Failed to fetch service status. Check network or server.');
      }
    });
  }
});