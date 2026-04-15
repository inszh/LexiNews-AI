const config = require('./config');

const BASE_URL = config.BASE_URL;

/**
 * 图片抗抖动处理：解析 URL 中的宽高比
 * @param {string} coverUrl 
 * @returns {number} aspectRatio (默认 1.77 16:9)
 */
const getAspectRatio = (coverUrl) => {
  if (!coverUrl) return 1.77;
  const match = coverUrl.match(/_w(\d+)_h(\d+)\.webp$/);
  if (match) {
    const w = parseInt(match[1]);
    const h = parseInt(match[2]);
    return w / h;
  }
  return 1.77;
};

/**
 * 处理 URL (补全域名)
 * 无论是封面图还是站点图标，统一处理相对路径
 */
const resolveUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('/')) {
    return BASE_URL + url;
  }
  return url;
};

/**
 * 获取文章列表
 */
const getNewsList = (opts) => {
  const { category, q } = opts || {};
  const data = {};
  if (category && category !== '全部') data.category = category;
  if (q) data.q = q;

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}/api/articles`,
      data,
      method: 'GET',
      success: (res) => {
        console.log('[API] Raw Response from Backend:', res.data);
        if (res.statusCode === 200 && res.data && Array.isArray(res.data.data)) {
          const list = res.data.data.map(item => ({
            id:          item.id || '',
            title:       item.title || '无标题',
            image:       resolveUrl(item.cover),
            icon:        resolveUrl(item.icon),
            sourceName:  item.domain || item.source || '佚名',
            category:    item.category || '科技',
            publishedAt: item.date || '',
            imageColor:  '#F8F8F6',
            aspectRatio: getAspectRatio(item.cover)
          }));
          console.log('[API] Processed Articles List:', list);
          resolve({ articles: list, hasMore: false });
        } else {
          console.error('[API] 列表解析失败:', res);
          resolve({ articles: [], hasMore: false });
        }
      },
      fail: (err) => {
        console.error('[API] 列表请求失败:', err);
        reject(err);
      }
    });
  });
};

/**
 * 获取文章详情 (块解析)
 */
const getPageBlocks = (pageId) => {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}/api/articles/${pageId}`,
      method: 'GET',
      success: (res) => {
        if (res.statusCode === 200 && res.data && res.data.data) {
          const { data } = res.data;
          const rawBlocks = data.blocks || [];
          
          const blocks = rawBlocks.map(b => {
            const type = b.type;
            const content = b.content || '';
            
            switch (type) {
              case 'paragraph':
              case 'p':
                return { type: 'p', text: content };
              case 'image':
              case 'img':
                return { type: 'img', src: b.image || content };
              case 'heading_1':
              case 'h1':
                return { type: 'h1', text: content };
              case 'heading_2':
              case 'h2':
                return { type: 'h2', text: content };
              case 'heading_3':
              case 'h3':
                return { type: 'h3', text: content };
              case 'quote':
                return { type: 'quote', text: content };
              case 'bulleted_list_item':
              case 'bullet':
                return { type: 'bullet', text: content };
              case 'numbered_list_item':
              case 'numbered':
                return { type: 'numbered', text: content };
              case 'divider':
                return { type: 'divider' };
              case 'code':
                return { type: 'code', text: content };
              case 'callout':
                return { type: 'callout', text: content, emoji: b.emoji || '💡' };
              default:
                return null;
            }
          }).filter(Boolean);
          
          resolve(blocks);
        } else {
          resolve([]);
        }
      },
      fail: (err) => reject(err)
    });
  });
};

/**
 * 获取页面属性 (详情页标题、作者等)
 */
const getPageProperties = (pageId) => {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}/api/articles/${pageId}`,
      method: 'GET',
      success: (res) => {
        if (res.statusCode === 200 && res.data && res.data.data) {
          const { data } = res.data;
          resolve({
            id:          data.id,
            title:       data.title || '无标题',
            publishedAt: data.date || '',
            source:      data.domain || data.source || '',
            category:    data.category || '',
            icon:        resolveUrl(data.icon),
            readTime:    data.readingTime ? parseInt(data.readingTime.match(/\d+/) || [5]) : 5,
            summary:     data.summary || ''
          });
        } else {
          reject(new Error('Property parsing failed'));
        }
      },
      fail: (err) => reject(err)
    });
  });
};

/**
 * 获取用户学习统计数据
 */
const getUserStats = (openid) => {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}/api/user/stats`,
      data: { openid },
      method: 'GET',
      success: (res) => {
        if (res.statusCode === 200 && res.data) {
          resolve(res.data);
        } else {
          reject(new Error('Stats fetch failed'));
        }
      },
      fail: (err) => reject(err)
    });
  });
};

/**
 * 获取全量生词列表 (支持分页)
 */
const getUserVocabulary = (openid, page = 1, limit = 20) => {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}/api/user/vocabulary`,
      data: { openid, page, limit },
      method: 'GET',
      success: (res) => {
        if (res.statusCode === 200 && res.data) {
          resolve(res.data);
        } else {
          reject(new Error('Vocab fetch failed'));
        }
      },
      fail: (err) => reject(err)
    });
  });
};

module.exports = {
  getNewsList,
  getPageBlocks,
  getPageProperties,
  getAspectRatio,
  getUserStats,
  getUserVocabulary
};
