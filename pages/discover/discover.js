// pages/discover/discover.js
const config = require('../../utils/config.js');

Page({
  data: {
    activeTab: 'bookmark',   // 默认进入收藏页
    isRefreshing: false,
    // 收藏
    bookmarks: [],
    // 搜索
    searchQuery: '',
    searchResults: [],
    allArticles: [],
    categories:  ['科技', '财经', '国际', '科学', '健康', '文化'],
    // 生词
    vocabulary: [],
    vocabPage: 1,
    vocabHasMore: true,
    isVocabLoading: false,
    speakingWord: ''
  },

  onLoad() {
    this._loadAll();
  },

  onShow() {
    this._loadAll();
  },

  _loadAll() {
    // 1. 加载收藏列表
    const ids  = wx.getStorageSync('bookmarks')      || [];
    const meta = wx.getStorageSync('bookmarks_meta') || {};
    const bookmarks = ids.map(id => meta[id]).filter(Boolean);
    this.setData({ bookmarks });

    // 2. 同步来自首页的动态分类
    const app = getApp();
    if (app.globalData.categories && app.globalData.categories.length > 0) {
      const cats = app.globalData.categories.filter(c => c !== '全部');
      this.setData({ categories: cats });
    }

    // 3. 把首页缓存文章作为搜索数据源
    const cache = wx.getStorageSync('index_articles_cache');
    if (cache && cache.articles) {
      this.setData({ allArticles: cache.articles });
    }

    // 4. 加载生词本（优先展示本地，随后请求后端同步）
    const localVocab = wx.getStorageSync('vocabulary') || [];
    this.setData({ vocabulary: localVocab });
    this._fetchVocabFromBackend();
  },

  _fetchVocabFromBackend(isLoadMore = false) {
    const app = getApp();
    const openid = app.globalData.userToken || wx.getStorageSync('user_openid');
    if (!openid || (isLoadMore && !this.data.vocabHasMore) || this.data.isVocabLoading) return;

    this.setData({ isVocabLoading: true });
    const page = isLoadMore ? this.data.vocabPage + 1 : 1;

    wx.request({
      url: config.BASE_URL + '/api/user/vocabulary',
      data: { openid, page, limit: 20 },
      method: 'GET',
      success: (res) => {
        console.log('[Vocab Sync] Response Page ' + page + ':', res.data);
        if (res.statusCode === 200 && res.data.success && Array.isArray(res.data.words)) {
          // 将后端返回的数据映射为本地格式
          const remoteVocab = res.data.words.map(item => ({
            id: item.id,
            word: item.word,
            phonetic: item.phonetic || '',
            pos: item.pos || '',
            trans: item.trans || '',
            transGeneral: item.trans_general || '',
            sentence: item.context || item.sentence || '',
            sourceTitle: item.source_title || item.sourceTitle || 'LexiNews AI',
            // 处理 SQLite 时间字符串
            timestamp: item.created_at ? new Date(item.created_at.replace(' ', 'T')).getTime() : Date.now()
          }));
          
          let combined = isLoadMore ? this.data.vocabulary.concat(remoteVocab) : [...remoteVocab];
          
          if (!isLoadMore) {
              // 仅在第一页时执行本地补全逻辑
              const localVocab = wx.getStorageSync('vocabulary') || [];
              localVocab.forEach(l => {
                 if (!combined.some(c => c.word.toLowerCase() === l.word.toLowerCase())) {
                   combined.push(l);
                 }
              });
              // 仅首屏重排序
              combined.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          }

          console.log('[Vocab Sync] Total Count Now:', combined.length);
          this.setData({ 
            vocabulary: combined,
            vocabPage: page,
            vocabHasMore: res.data.hasMore,
            isVocabLoading: false
          });

          // 仅持久化前 100 条作为离线缓存
          if (!isLoadMore) {
            wx.setStorageSync('vocabulary', combined.slice(0, 100));
          }
        } else {
          this.setData({ isVocabLoading: false });
          console.error('[Vocab Sync] API success but data error:', res);
        }
      },
      fail: (err) => {
        this.setData({ isVocabLoading: false });
        console.error('[Vocab Sync] Network error:', err);
      }
    });
  },

  onVocabScrollToLower() {
    console.log('[Vocab] Scroll to lower, loading more...');
    this._fetchVocabFromBackend(true);
  },

  onRefresh() {
    this.setData({ isRefreshing: true });
    // 仅刷新收藏列表
    this._loadAll();
    setTimeout(() => {
      this.setData({ isRefreshing: false });
    }, 500);
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab, searchQuery: '', searchResults: [] });
  },

  // 取消收藏（从发现页操作）
  removeBookmark(e) {
    const id = e.currentTarget.dataset.id;
    let ids = wx.getStorageSync('bookmarks') || [];
    ids = ids.filter(i => i !== id);
    wx.setStorageSync('bookmarks', ids);
    this._loadAll();
    wx.showToast({ title: '已取消收藏', icon: 'none', duration: 800 });
  },

  removeVocab(e) {
    const { ts, id } = e.currentTarget.dataset;
    const app = getApp();
    const openid = app.globalData.userToken || wx.getStorageSync('user_openid');

    // 1. 本地逻辑
    let list = wx.getStorageSync('vocabulary') || [];
    list = list.filter(item => item.timestamp !== ts);
    wx.setStorageSync('vocabulary', list);
    this.setData({ vocabulary: list });

    // 2. 远端同步
    if (openid && id) {
      wx.request({
        url: config.BASE_URL + '/api/user/vocabulary',
        method: 'DELETE',
        data: { openid, id },
        success: (res) => {
          console.log('[Vocab Sync] Delete success:', id);
        }
      });
    }

    wx.showToast({ title: '已移除', icon: 'none' });
  },

  openArticle(e) {
    const item = e.currentTarget.dataset.item;
    if (!item) return;
    const app = getApp();
    app.globalData.currentArticle = item;
    wx.navigateTo({ url: `/pages/detail/detail?id=${item.id}` });
  },

  // 搜索
  onSearchInput(e) {
    const q = e.detail.value.trim();
    if (!q) {
      this.setData({ searchQuery: '', searchResults: [] });
      return;
    }
    const ql = q.toLowerCase();
    const results = this.data.allArticles.filter(a =>
      (a.title     || '').toLowerCase().includes(ql) ||
      (a.category  || '').toLowerCase().includes(ql) ||
      (a.sourceName|| '').toLowerCase().includes(ql) ||
      (a.tags      || []).some(t => t.toLowerCase().includes(ql))
    );
    this.setData({ searchQuery: q, searchResults: results });
  },

  clearSearch() {
    this.setData({ searchQuery: '', searchResults: [] });
  },

  searchTrend(e) {
    const q = e.currentTarget.dataset.q;
    this.onSearchInput({ detail: { value: q } });
    this.setData({ searchQuery: q });
  },

  onUnload() {
    this._stopSpeaking();
  },

  onSpeakWord(e) {
    const word = e.currentTarget.dataset.word;
    if (!word) return;

    if (this.data.speakingWord === word) {
      this._stopSpeaking();
      return;
    }

    this._stopSpeaking();
    this.setData({ speakingWord: word });
    this._doSpeak(word);
  },

  _stopSpeaking() {
    try {
      if (this._ttsCtx) {
        this._ttsCtx.destroy && this._ttsCtx.destroy();
        this._ttsCtx = null;
      }
    } catch (_) { }
    this.setData({ speakingWord: '' });
  },

  _doSpeak(text) {
    // 优先微信原生 TTS
    if (wx.textToSpeech) {
      wx.textToSpeech({
        lang: 'en_US',
        talkSpeed: 1.0,
        content: text,
        success: () => { },
        complete: () => { 
          if (this.data.speakingWord === text) {
            this.setData({ speakingWord: '' }); 
          }
        },
        fail: () => {
          this.setData({ speakingWord: '' });
          wx.showToast({ title: '朗读失败', icon: 'none' });
        }
      });
      return;
    }

    // 降级：调用后端 AI 语音代理
    const ttsProxyUrl = config.BASE_URL + '/api/ai/tts';
    const audio = wx.createInnerAudioContext();
    this._ttsCtx = audio;
    audio.autoplay = true;
    audio.onEnded(() => { 
      if (this.data.speakingWord === text) {
        this.setData({ speakingWord: '' }); 
      }
    });
    audio.onError((res) => {
      console.error('[TTS Proxy] Audio Context Error:', res);
      this.setData({ speakingWord: '' });
      wx.showToast({ title: '朗读加载失败', icon: 'none' });
    });

    wx.request({
      url: ttsProxyUrl,
      method: 'POST',
      responseType: 'arraybuffer',
      data: { input: text },
      success: (res) => {
        if (res.statusCode === 200) {
          const fs = wx.getFileSystemManager();
          const path = `${wx.env.USER_DATA_PATH}/tts_${Date.now()}.mp3`;
          fs.writeFile({
            filePath: path,
            data: res.data,
            encoding: 'binary',
            success: () => {
              audio.src = path;
            },
            fail: (err) => {
              console.error('[TTS] File System Error:', err);
              this.setData({ speakingWord: '' });
            }
          });
        } else {
          this.setData({ speakingWord: '' });
          wx.showToast({ title: '服务不可用', icon: 'none' });
        }
      },
      fail: (err) => {
        console.error('[TTS] Request Network Failure:', err);
        this.setData({ speakingWord: '' });
        wx.showToast({ title: '网络连接失败', icon: 'none' });
      }
    });
  }
});
