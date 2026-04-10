// utils/notion.js
const NOTION_TOKEN = '';//不删不让传
const DATABASE_ID  = '';//不删不让传

// 域名提取
const extractDomain = (url) => {
  if (!url) return 'Notion';
  try {
    const domain = url.split('/')[2];
    return domain.replace('www.', '');
  } catch (e) { return 'Source'; }
};

// 获取正文首图（首页用）
const getPageImage = (pageId) => {
  return new Promise((resolve) => {
    wx.request({
      url: `https://api.notion.com/v1/blocks/${pageId}/children`,
      method: 'GET',
      header: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' },
      success: (res) => {
        const results = res.data && res.data.results;
        const imgBlock = results ? results.find(b => b.type === 'image') : null;
        let url = '';
        if (imgBlock && imgBlock.image) {
          url = (imgBlock.image.file && imgBlock.image.file.url) || (imgBlock.image.external && imgBlock.image.external.url) || '';
        }
        resolve(url);
      },
      fail: () => resolve('')
    });
  });
};

// --- 详情页专用 1：获取页面属性 (标题、摘要等) ---
const getPageProperties = (pageId) => {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `https://api.notion.com/v1/pages/${pageId}`,
      method: 'GET',
      header: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' },
      success: (res) => {
        if (res.statusCode === 200) {
          const prop  = res.data.properties;
          const rawUrl = (prop['URL'] && prop['URL'].url) || '';
          const nameTitle = prop['Name'] && prop['Name'].title;
          const noteRichText = prop['读书笔记'] && prop['读书笔记'].rich_text;
          const categorySelect = prop['分类'] && prop['分类'].select;
          const studyNum = prop['学习时长'] && prop['学习时长'].number;

          resolve({
            id:          res.data.id,
            title:       (nameTitle && nameTitle[0] && nameTitle[0].plain_text) || '无标题',
            summary:     (noteRichText && noteRichText[0] && noteRichText[0].plain_text) || '',
            category:    (categorySelect && categorySelect.name) || '科技',
            source:      extractDomain(rawUrl),
            publishedAt: res.data.created_time.split('T')[0],
            readTime:    studyNum || 5,
            imageColor:  '#F8F8F6'
          });
        } else { reject(res); }
      },
      fail: (err) => reject(err)
    });
  });
};

// 从 richText 数组提取纯文本
const extractText = (richText) => (richText || []).map(t => t.plain_text).join('');

// 将单个 block 解析为显示用数据，返回 null 则过滤掉
const parseBlock = (block) => {
  const type = block.type;
  const data  = block[type];
  if (!data) return null;

  if (type === 'paragraph') {
    const text = extractText(data.rich_text);
    return text
      ? { type: 'p', text, hasChildren: block.has_children }
      : (block.has_children ? { type: 'p', text: '', hasChildren: true } : null);
  }
  if (type === 'heading_1') {
    const text = extractText(data.rich_text);
    return text ? { type: 'h1', text } : null;
  }
  if (type === 'heading_2') {
    const text = extractText(data.rich_text);
    return text ? { type: 'h2', text } : null;
  }
  if (type === 'heading_3') {
    const text = extractText(data.rich_text);
    return text ? { type: 'h3', text } : null;
  }
  if (type === 'bulleted_list_item') {
    const text = extractText(data.rich_text);
    return text ? { type: 'bullet', text, hasChildren: block.has_children } : null;
  }
  if (type === 'numbered_list_item') {
    const text = extractText(data.rich_text);
    return text ? { type: 'numbered', text, hasChildren: block.has_children } : null;
  }
  if (type === 'quote') {
    const text = extractText(data.rich_text);
    return text ? { type: 'quote', text } : null;
  }
  if (type === 'callout') {
    const text  = extractText(data.rich_text);
    const emoji = (data.icon && data.icon.emoji) || '💡';
    return text ? { type: 'callout', text, emoji } : null;
  }
  if (type === 'divider') {
    return { type: 'divider' };
  }
  if (type === 'code') {
    const text = extractText(data.rich_text);
    return text ? { type: 'code', text } : null;
  }
  if (type === 'toggle') {
    const text = extractText(data.rich_text);
    return { type: 'toggle', text, hasChildren: block.has_children, id: block.id };
  }
  if (type === 'image') {
    const url = (data.file && data.file.url) || (data.external && data.external.url) || '';
    return url ? { type: 'img', src: url } : null;
  }
  return null;
};

// 递归获取某个块的所有子块（depth 控制最大层数，最多 2 层）
const fetchBlocksRecursive = (blockId, depth = 0) => {
  return new Promise((resolve) => {
    wx.request({
      url: `https://api.notion.com/v1/blocks/${blockId}/children?page_size=100`,
      method: 'GET',
      header: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28'
      },
      success: async (res) => {
        if (res.statusCode !== 200) { resolve([]); return; }
        const results   = res.data.results || [];
        const allBlocks = [];
        for (const block of results) {
          const parsed = parseBlock(block);
          if (parsed) allBlocks.push(parsed);
          if (depth < 2 && block.has_children
              && block.type !== 'child_page'
              && block.type !== 'child_database') {
            const children = await fetchBlocksRecursive(block.id, depth + 1);
            allBlocks.push(...children);
          }
        }
        resolve(allBlocks);
      },
      fail: () => resolve([])
    });
  });
};

const getPageBlocks = async (pageId) => {
  const blocks = await fetchBlocksRecursive(pageId);
  console.log('-> [Blocks] 递归解析完成，分段数:', blocks.length);
  return blocks;
};

/**
 * 首页列表
 * @param {object} opts
 * @param {number} opts.pageSize   - 每次请求条数，默认 100（一次拉全）
 * @param {string} opts.startCursor - Notion 游标，用于翻页
 */
const getNewsList = (opts = {}) => {
  const pageSize   = opts.pageSize   || 100;
  const startCursor = opts.startCursor || undefined;

  const body = {
    page_size: pageSize,
    // 最新内容在最上面（按创建时间倒序）
    sorts: [{ timestamp: 'created_time', direction: 'descending' }]
  };
  if (startCursor) body.start_cursor = startCursor;

  return new Promise((resolve, reject) => {
    wx.request({
      url: `https://api.notion.com/v1/databases/${DATABASE_ID}/query`,
      method: 'POST',
      header: {
        'Authorization':  `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type':   'application/json'
      },
      data: body,
      success: async (res) => {
        if (res.statusCode === 200) {
          const formatted = await Promise.all(
            res.data.results.map(async (page) => {
              const prop      = page.properties;
              const imageUrl  = await getPageImage(page.id);
              const urlProp   = prop['URL'];
              const rawUrl    = (urlProp && urlProp.url) || '';
              const catProp   = prop['分类'];
              const category  = (catProp && catProp.select && catProp.select.name) || '';
              const nameTitle = prop['Name'] && prop['Name'].title;

              return {
                id:          page.id,
                title:       (nameTitle && nameTitle[0] && nameTitle[0].plain_text) || '无标题',
                image:       imageUrl,
                icon:        rawUrl ? `https://www.google.com/s2/favicons?domain=${rawUrl}&sz=64` : '',
                sourceName:  extractDomain(rawUrl),
                category,
                publishedAt: page.created_time.split('T')[0].substring(5), // MM-DD
                imageColor:  '#F8F8F6'
              };
            })
          );
          resolve({
            articles:    formatted,
            hasMore:     res.data.has_more || false,
            nextCursor:  res.data.next_cursor || null
          });
        } else {
          reject(new Error(res.statusCode));
        }
      },
      fail: (err) => reject(err)
    });
  });
};

module.exports = {
  getNewsList,
  getPageProperties,
  getPageBlocks
};