// pages/index/index.js
const api = require('../../utils/api.js')

const PAGE_SIZE = 10;

Page({
  data: {
    categories:      ['全部', '科技', '财经', '国际', '科学', '健康', '文化'],
    selectedCategory: '全部',
    leftColumn:      [],
    rightColumn:     [],
    allArticles:     [],  // 完整已拉取列表（已过滤）
    isLoading:       true,
    refreshing:      false,
    loadingMore:     false,
    noMore:          false,
    currentPage:     1,
  },

  onLoad() {
    this._tryLoad();
  },

  // 判断是否需要重新联网（30 分钟阈值），并加入短暂延迟以保证预加载动画展示
  _tryLoad() {
    const cache = wx.getStorageSync('index_articles_cache');
    const now   = Date.now();
    const THIRTY_MIN = 30 * 60 * 1000;

    if (cache && cache.articles && cache.fetchedAt && (now - cache.fetchedAt < THIRTY_MIN)) {
      console.log('[首页] 缓存有效，上次联网:', new Date(cache.fetchedAt).toLocaleString());
      this._extractCategories(cache.articles);
      this._applyArticles(cache.articles, { isLoading: false });
    } else {
      console.log('[首页] 缓存过期或不存在，重新联网拉取');
      this.loadData();
    }
  },

  loadData() {
    this.setData({ isLoading: true });

    api.getNewsList()
      .then(({ articles }) => {
        // 持久化到本地
        wx.setStorageSync('index_articles_cache', {
          articles,
          fetchedAt: Date.now()
        });
        this._extractCategories(articles);
        this._applyArticles(articles, { isLoading: false, refreshing: false });
      })
      .catch(err => {
        console.error('[首页] 加载失败', err);
        wx.showToast({ title: '加载失败', icon: 'none' });
        // 出错时降级使用旧缓存
        const cache = wx.getStorageSync('index_articles_cache');
        if (cache && cache.articles) {
          this._applyArticles(cache.articles, { isLoading: false, refreshing: false });
        } else {
          this.setData({ isLoading: false, refreshing: false });
        }
      });
  },

  // 下拉刷新（强制重新联网，忽略缓存）
  onRefresh() {
    this.setData({ refreshing: true });
    this.loadData();
  },

  // 上拉加载更多（客户端分页）
  onScrollToLower() {
    if (this.data.noMore || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    this._loadPage(this.data.currentPage + 1);
  },

  // 按选中分类过滤并重置分页
  _applyArticles(rawData, extraData = {}) {
    const category = this.data.selectedCategory;
    const filtered = (category === '全部' || !category)
      ? rawData
      : rawData.filter(a => a.category === category);

    const withDisplay = filtered.map(a => {
      // 这里的 a.aspectRatio 已经在 api.js 中计算好
      return Object.assign({}, a, {
        likesDisplay: a.likes > 999 ? (a.likes / 1000).toFixed(1) + 'k' : (a.likes || 0)
      });
    });

    this._loadPage(1, withDisplay, Object.assign({
      allArticles:  withDisplay,
      currentPage:  1,
      noMore:       false
    }, extraData));
  },

  // 核心：基于数据提取唯一分类列表
  _extractCategories(articles) {
    if (!articles || articles.length === 0) return;
    
    // 提取不重复的分类名称
    const rawCategories = articles.map(a => a.category).filter(Boolean);
    const uniqueCategories = ['全部', ...new Set(rawCategories)];
    
    console.log('[分类解析] 实时分类列表:', uniqueCategories);
    
    // 同步到全局，确保搜索/个人页能够共享这些动态分类
    const app = getApp();
    app.globalData.categories = uniqueCategories;
    
    this.setData({
      categories: uniqueCategories
    });
  },

  // 分页加载核心逻辑
  _loadPage(page, source, extraData = {}) {
    const src   = source || this.data.allArticles;
    const slice = src.slice(0, page * PAGE_SIZE);

    const left  = slice.filter((_, i) => i % 2 === 0);
    const right = slice.filter((_, i) => i % 2 === 1);

    const updateData = Object.assign({
      leftColumn:  left,
      rightColumn: right,
      currentPage: page,
      noMore:      page * PAGE_SIZE >= src.length,
      loadingMore: false
    }, extraData);

    this.setData(updateData);
  },

  // 搜索处理：同步动态解析好的全量数据
  onSearch(e) {
    const keyword = e.detail.value.trim().toLowerCase();
    if (!keyword) {
      this._applyArticles(this.data.allArticles);
      return;
    }
    const filtered = this.data.allArticles.filter(a => 
      a.title.toLowerCase().includes(keyword) || 
      a.category.toLowerCase().includes(keyword) ||
      a.sourceName.toLowerCase().includes(keyword)
    );
    this._applyArticles(filtered);
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