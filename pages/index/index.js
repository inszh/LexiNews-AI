// pages/index/index.js
const notion = require('../../utils/notion.js')

const PAGE_SIZE = 10;

Page({
  data: {
    categories:      ['全部', '科技', '财经', '国际', '科学', '健康', '文化'],
    selectedCategory: '全部',
    leftColumn:      [],
    rightColumn:     [],
    allArticles:     [],  // 完整已拉取列表（已过滤）
    isLoading:       false,
    refreshing:      false,
    loadingMore:     false,
    noMore:          false,
    currentPage:     1,
  },

  onLoad() {
    this._tryLoad();
  },

  // 判断是否需要重新联网（30 分钟阈值）
  _tryLoad() {
    const cache = wx.getStorageSync('index_articles_cache');
    const now   = Date.now();
    const THIRTY_MIN = 30 * 60 * 1000;

    if (cache && cache.articles && cache.fetchedAt && (now - cache.fetchedAt < THIRTY_MIN)) {
      console.log('[首页] 缓存有效，上次联网:', new Date(cache.fetchedAt).toLocaleString());
      this._applyArticles(cache.articles);
    } else {
      console.log('[首页] 缓存过期或不存在，重新联网拉取');
      this.loadNotionData();
    }
  },

  loadNotionData() {
    this.setData({ isLoading: true });

    notion.getNewsList()
      .then(({ articles }) => {
        // 持久化到本地，记录联网时间
        wx.setStorageSync('index_articles_cache', {
          articles,
          fetchedAt: Date.now()
        });
        this.setData({ isLoading: false, refreshing: false });
        this._applyArticles(articles);
      })
      .catch(err => {
        console.error('[首页] 加载失败', err);
        this.setData({ isLoading: false, refreshing: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
        // 出错时降级使用旧缓存
        const cache = wx.getStorageSync('index_articles_cache');
        if (cache && cache.articles) {
          this._applyArticles(cache.articles);
        }
      });
  },

  // 下拉刷新（强制重新联网，忽略缓存）
  onRefresh() {
    this.setData({ refreshing: true });
    this.loadNotionData();
  },

  // 上拉加载更多（客户端分页）
  onScrollToLower() {
    if (this.data.noMore || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    setTimeout(() => {
      this._loadPage(this.data.currentPage + 1);
    }, 350);
  },

  // 按选中分类过滤并重置分页
  _applyArticles(rawData) {
    const category = this.data.selectedCategory;
    const filtered = (category === '全部' || !category)
      ? rawData
      : rawData.filter(a => a.category === category);

    const withDisplay = filtered.map(a => ({
      ...a,
      likesDisplay: a.likes > 999 ? (a.likes / 1000).toFixed(1) + 'k' : (a.likes || 0)
    }));

    this.setData({
      allArticles:  withDisplay,
      currentPage:  1,
      noMore:       false,
      leftColumn:   [],
      rightColumn:  []
    });
    this._loadPage(1, withDisplay);
  },

  // 将第 page 页（累积）加载进瀑布流
  _loadPage(page, source) {
    const src   = source || this.data.allArticles;
    const slice = src.slice(0, page * PAGE_SIZE);

    const left  = slice.filter((_, i) => i % 2 === 0);
    const right = slice.filter((_, i) => i % 2 === 1);

    this.setData({
      leftColumn:  left,
      rightColumn: right,
      currentPage: page,
      noMore:      page * PAGE_SIZE >= src.length,
      loadingMore: false
    });
  },

  selectCategory(e) {
    const cat = e.currentTarget.dataset.cat;
    this.setData({ selectedCategory: cat });
    const cache = wx.getStorageSync('index_articles_cache');
    const raw   = (cache && cache.articles) ? cache.articles : [];
    this._applyArticles(raw);
  },

  resetCategory() {
    this.setData({ selectedCategory: '全部' });
    const cache = wx.getStorageSync('index_articles_cache');
    const raw   = (cache && cache.articles) ? cache.articles : [];
    this._applyArticles(raw);
  },

  openArticle(e) {
    const item = e.currentTarget.dataset.item;
    if (!item) return;
    const app = getApp();
    app.globalData.currentArticle = item;
    wx.navigateTo({ url: `/pages/detail/detail?id=${item.id}` });
  }
})