const config = require('./utils/config.js');

App({
  globalData: {
    apiKey: '',
    aiUrl: '',
    aiModel: '',
    aiPrompt: '',
    currentArticle: null,
    userToken: ''
  },

  onLaunch() {
    const key = wx.getStorageSync('ai_key') || config.DEFAULT_AI_KEY;
    const url = wx.getStorageSync('ai_url') || config.DEFAULT_AI_URL;
    const model = wx.getStorageSync('ai_model') || config.DEFAULT_AI_MODEL;
    const prompt = wx.getStorageSync('ai_prompt') || config.DEFAULT_AI_PROMPT;

    this.globalData.apiKey = key;
    this.globalData.aiUrl = url;
    this.globalData.aiModel = model;
    this.globalData.aiPrompt = prompt;

    // 获取登录凭证
    this.login();
  },

  login() {
    const self = this;
    wx.login({
      success: res => {
        let code = res.code;
        console.log('[Auth] Fetching OpenID with code:', code);
        wx.request({
          url: config.BASE_URL + '/api/auth/login',
          method: 'POST',
          data: { code: code },
          success: (loginRes) => {
            if (loginRes.data && loginRes.data.success) {
              const openid = loginRes.data.openid;
              console.log('[Auth] Login Success, OpenID:', openid);
              self.globalData.userToken = openid;
              wx.setStorageSync('user_openid', openid);
            } else {
              console.warn('[Auth] Real Login failed, switching to Mock Mode...');
              this._useMockLogin();
            }
          },
          fail: (err) => {
            console.warn('[Auth] Network error, using Mock Mode...');
            this._useMockLogin();
          }
        });
      }
    });
  },

  _useMockLogin() {
    const mockId = 'debug_user_test';
    console.log('[Auth] Mock Login Enabled:', mockId);
    this.globalData.userToken = mockId;
    wx.setStorageSync('user_openid', mockId);
  }
})
