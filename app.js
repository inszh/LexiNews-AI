const config = require('./utils/config.js');

App({
  globalData: {
    apiKey:  '',
    aiUrl:   '',
    aiModel: '',
    aiPrompt: '',
    currentArticle: null
  },

  onLaunch() {
    const key   = wx.getStorageSync('ai_key')    || config.DEFAULT_AI_KEY;
    const url   = wx.getStorageSync('ai_url')    || config.DEFAULT_AI_URL;
    const model = wx.getStorageSync('ai_model')  || config.DEFAULT_AI_MODEL;
    const prompt = wx.getStorageSync('ai_prompt') || config.DEFAULT_AI_PROMPT;

    this.globalData.apiKey  = key;
    this.globalData.aiUrl   = url;
    this.globalData.aiModel = model;
    this.globalData.aiPrompt = prompt;
  }
})
