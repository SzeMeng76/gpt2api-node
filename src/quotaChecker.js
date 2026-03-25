import axios from 'axios';
import httpsProxyAgent from 'https-proxy-agent';

const { HttpsProxyAgent } = httpsProxyAgent;

// 代理配置
const PROXY_URL = process.env.HTTP_PROXY || process.env.HTTPS_PROXY;

/**
 * 额度检查器 - 通过实际调用 ChatGPT API 来检查账号状态和额度
 */
class QuotaChecker {
  constructor() {
    this.CHATGPT_API_URL = 'https://chatgpt.com/backend-api';
  }

  /**
   * 检查 Token 的真实额度和状态
   */
  async checkQuota(accessToken) {
    try {
      const config = {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      };

      // 如果配置了代理，使用代理
      if (PROXY_URL) {
        config.httpsAgent = new HttpsProxyAgent(PROXY_URL);
      }

      // 1. 获取账号信息
      const accountInfo = await this.getAccountInfo(accessToken, config);

      // 2. 获取使用情况（如果可用）
      const usage = await this.getUsageInfo(accessToken, config);

      return {
        success: true,
        account: accountInfo,
        usage: usage,
        status: 'active'
      };
    } catch (error) {
      return this.handleQuotaError(error);
    }
  }

  /**
   * 获取账号信息
   */
  async getAccountInfo(accessToken, config) {
    try {
      const response = await axios.get(
        `${this.CHATGPT_API_URL}/accounts/check/v4-2023-04-27`,
        config
      );

      const data = response.data;
      const account = data.accounts?.default || {};

      return {
        account_id: account.account_id || null,
        email: account.account_user_email || null,
        plan_type: account.account_user_role || 'free',
        is_paid: account.account_user_role !== 'free',
        features: account.features || []
      };
    } catch (error) {
      console.warn('获取账号信息失败:', error.message);
      return null;
    }
  }

  /**
   * 获取使用情况
   */
  async getUsageInfo(accessToken, config) {
    try {
      // ChatGPT 没有直接的额度查询 API
      // 我们通过发送一个最小的测试请求来验证账号状态
      const testResponse = await axios.post(
        `${this.CHATGPT_API_URL}/conversation`,
        {
          action: 'next',
          messages: [{
            id: 'test-' + Date.now(),
            author: { role: 'user' },
            content: { content_type: 'text', parts: ['hi'] }
          }],
          model: 'text-davinci-002-render-sha',
          parent_message_id: '00000000-0000-0000-0000-000000000000'
        },
        {
          ...config,
          timeout: 5000,
          validateStatus: (status) => status < 500 // 接受 4xx 错误
        }
      );

      // 如果请求成功或返回正常错误（非额度问题），说明账号可用
      if (testResponse.status < 400) {
        return {
          available: true,
          estimated_remaining: null // ChatGPT 不提供具体额度
        };
      }

      return {
        available: false,
        error_code: testResponse.status
      };
    } catch (error) {
      // 测试请求失败，返回错误信息
      return {
        available: false,
        error: error.message
      };
    }
  }

  /**
   * 处理额度检查错误
   */
  handleQuotaError(error) {
    const status = error.response?.status;
    const data = error.response?.data;

    let result = {
      success: false,
      status: 'error',
      error_code: status,
      error_message: error.message
    };

    // 根据不同的错误码判断状态
    switch (status) {
      case 401:
        result.status = 'unauthorized';
        result.error_message = 'Token 已过期或无效';
        result.retryable = true;
        break;
      case 402:
        result.status = 'payment_required';
        result.error_message = '账号余额不足或订阅已过期';
        result.retryable = false;
        break;
      case 403:
        result.status = 'forbidden';
        result.error_message = '账号被封禁或无权限';
        result.retryable = false;
        break;
      case 429:
        result.status = 'rate_limited';
        result.error_message = '请求频率超限';
        result.retryable = true;
        result.retry_after = error.response?.headers['retry-after'] || 60;
        break;
      case 500:
      case 502:
      case 503:
      case 504:
        result.status = 'server_error';
        result.error_message = '服务器错误';
        result.retryable = true;
        break;
      default:
        result.status = 'unknown_error';
        result.error_message = data?.detail || error.message;
        result.retryable = false;
    }

    return result;
  }

  /**
   * 从 ID Token 解析账号信息
   */
  parseIdToken(idToken) {
    try {
      const parts = idToken.split('.');
      if (parts.length !== 3) {
        return null;
      }

      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      const authInfo = payload['https://api.openai.com/auth'] || {};

      return {
        account_id: authInfo.chatgpt_account_id || null,
        plan_type: authInfo.chatgpt_plan_type || 'free',
        subscription_start: authInfo.chatgpt_subscription_active_start || null,
        subscription_end: authInfo.chatgpt_subscription_active_until || null
      };
    } catch (error) {
      console.warn('解析 ID Token 失败:', error.message);
      return null;
    }
  }

  /**
   * 估算额度（基于订阅类型）
   */
  estimateQuota(planType, actualUsage = 0) {
    let totalQuota = 50000; // 默认免费额度

    const plan = (planType || 'free').toLowerCase();

    if (plan.includes('plus') || plan.includes('pro')) {
      totalQuota = 500000;
    } else if (plan.includes('team')) {
      totalQuota = 1000000;
    } else if (plan.includes('enterprise')) {
      totalQuota = 5000000;
    }

    return {
      total: totalQuota,
      used: actualUsage,
      remaining: Math.max(0, totalQuota - actualUsage)
    };
  }
}

export default new QuotaChecker();
