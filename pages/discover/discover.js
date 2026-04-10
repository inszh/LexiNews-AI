// pages/discover/discover.js
Page({
  data: {
    activeTab: 'bookmark',   // 'bookmark' | 'search'
    // 收藏
    bookmarks: [],
    // 搜索
    searchQuery: '',
    searchResults: [],
    allArticles: [],
    categories:  ['科技', '财经', '国际', '科学', '健康', '文化'],
  },

  onLoad() {
    this._loadAll();
  },

  onShow() {
    this._loadAll();
  },

  _loadAll() {
    // 加载收藏列表
    const ids  = wx.getStorageSync('bookmarks')      || [];
    const meta = wx.getStorageSync('bookmarks_meta') || {};
    const bookmarks = ids.map(id => meta[id]).filter(Boolean);
    this.setData({ bookmarks });

    // 把首页缓存文章作为搜索数据源
    const cache = wx.getStorageSync('index_articles_cache');
    if (cache && cache.articles) {
      this.setData({ allArticles: cache.articles });
    }
  },

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab, searchQuery: '', searchResults: [] });
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
});
