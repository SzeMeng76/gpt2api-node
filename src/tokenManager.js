import fs from 'fs/promises';
import axios from 'axios';
import httpsProxyAgent from 'https-proxy-agent';

const { HttpsProxyAgent } = httpsProxyAgent;

// OpenAI OAuth 配置
const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const XYHELPER_TOKEN_URL = 'https://public.xyhelper.cn/oauth/token';
const DEFAULT_CLIENT_ID = 'app_LlGpXReQgckcGGUo2JrYvtJK';

/**
 * 从 JWT access_token 中提取 client_id
 */
function extractClientId(accessToken) {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString());
    return payload.client_id || DEFAULT_CLIENT_ID;
  } catch {
    return DEFAULT_CLIENT_ID;
  }
}

/**
 * 判断 refresh_token 是否来自 xyhelper
 */
function isXyhelperToken(refreshToken) {
  return refreshToken && !refreshToken.startsWith('rt_');
}

/**
 * 获取代理配置（动态读取环境变量）
 */
function getProxyUrl() {
  return process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
}

/**
 * Token 管理器
 */
class TokenManager {
  constructor(tokenFilePath) {
    this.tokenFilePath = tokenFilePath;
    this.tokenData = null;
  }

  /**
   * 从文件加载 token
   */
  async loadToken() {
    try {
      const data = await fs.readFile(this.tokenFilePath, 'utf-8');
      this.tokenData = JSON.parse(data);
      console.log(`✓ Token 加载成功: ${this.tokenData.email || this.tokenData.account_id}`);
      return this.tokenData;
    } catch (error) {
      throw new Error(`加载 token 文件失败: ${error.message}`);
    }
  }

  /**
   * 保存 token 到文件
   */
  async saveToken(tokenData) {
    try {
      this.tokenData = tokenData;
      if (this.tokenFilePath) {
        await fs.writeFile(this.tokenFilePath, JSON.stringify(tokenData, null, 2), 'utf-8');
        console.log('✓ Token 已保存到文件');
      }
    } catch (error) {
      console.error(`保存 token 文件失败: ${error.message}`);
    }
  }

  /**
   * 检查 token 是否过期
   */
  isTokenExpired() {
    if (!this.tokenData || !this.tokenData.expired_at) {
      return true;
    }
    const expireTime = new Date(this.tokenData.expired_at);
    const now = new Date();
    // 提前 5 分钟刷新
    return expireTime.getTime() - now.getTime() < 5 * 60 * 1000;
  }

  /**
   * 刷新 access token
   */
  async refreshToken() {
    if (!this.tokenData || !this.tokenData.refresh_token) {
      throw new Error('没有可用的 refresh_token');
    }

    console.log('正在刷新 token...');

    try {
      const config = {
        headers: {
          'Accept': 'application/json'
        }
      };

      // 如果配置了代理，使用代理
      const PROXY_URL = getProxyUrl();
      if (PROXY_URL) {
        config.httpsAgent = new HttpsProxyAgent(PROXY_URL);
        console.log(`使用代理: ${PROXY_URL}`);
      }

      let response;

      if (isXyhelperToken(this.tokenData.refresh_token)) {
        // xyhelper token: 用 xyhelper API 刷新 (JSON body)
        console.log('检测到 xyhelper token，使用 xyhelper API 刷新...');
        config.headers['Content-Type'] = 'application/json';
        response = await axios.post(XYHELPER_TOKEN_URL, {
          grant_type: 'refresh_token',
          refresh_token: this.tokenData.refresh_token
        }, config);
      } else {
        // OpenAI 原生 rt_ token: 用 OpenAI OAuth 刷新 (form-urlencoded)
        console.log('检测到 OpenAI 原生 token，使用 OpenAI OAuth 刷新...');
        const clientId = extractClientId(this.tokenData.access_token);
        config.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        const params = new URLSearchParams({
          client_id: clientId,
          grant_type: 'refresh_token',
          refresh_token: this.tokenData.refresh_token,
          scope: 'openid profile email'
        });
        response = await axios.post(OPENAI_TOKEN_URL, params.toString(), config);
      }

      const { access_token, accessToken, refresh_token, id_token, expires_in } = response.data;
      const token = access_token || accessToken;

      if (!token) {
        throw new Error('刷新响应中没有 access_token');
      }

      // 更新 token 数据
      const newTokenData = {
        ...this.tokenData,
        access_token: token,
        refresh_token: refresh_token || this.tokenData.refresh_token,
        id_token: id_token || this.tokenData.id_token,
        expired_at: expires_in
          ? new Date(Date.now() + expires_in * 1000).toISOString()
          : new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        last_refresh_at: new Date().toISOString()
      };

      await this.saveToken(newTokenData);
      console.log('✓ Token 刷新成功');

      return newTokenData;
    } catch (error) {
      const errorMsg = error.response?.data || error.message;
      throw new Error(`Token 刷新失败: ${JSON.stringify(errorMsg)}`);
    }
  }

  /**
   * 获取有效的 access token（自动刷新）
   */
  async getValidToken() {
    if (!this.tokenData) {
      await this.loadToken();
    }

    if (this.isTokenExpired()) {
      await this.refreshToken();
    }

    return this.tokenData.access_token;
  }

  /**
   * 获取 token 信息
   */
  getTokenInfo() {
    return {
      email: this.tokenData?.email,
      account_id: this.tokenData?.account_id,
      expired_at: this.tokenData?.expired_at,
      type: this.tokenData?.type
    };
  }
}

export default TokenManager;
