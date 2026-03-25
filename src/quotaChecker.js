import axios from 'axios';
import httpsProxyAgent from 'https-proxy-agent';

const { HttpsProxyAgent } = httpsProxyAgent;

// 代理配置
const PROXY_URL = process.env.HTTP_PROXY || process.env.HTTPS_PROXY;

/**
 * 额度检查器 - 基于 ID Token 和实际使用情况估算额度
 * 不主动调用 API，避免触发风控
 */
class QuotaChecker {
  constructor() {
    // 不再主动调用 API
  }

  /**
   * 检查 Token 的额度（基于 ID Token 和使用统计）
   * @param {string} accessToken - Access Token
   * @param {string} idToken - ID Token (可选)
   * @param {number} actualUsage - 实际使用量
   * @param {string} dbPlanType - 数据库中存储的 plan_type (优先级最高)
   */
  async checkQuota(accessToken, idToken, actualUsage = 0, dbPlanType = null) {
    try {
      // 优先使用数据库中的 plan_type
      let planType = dbPlanType;
      let accountInfo = null;

      // 如果数据库没有 plan_type，尝试从 ID Token 解析
      if (!planType && idToken) {
        accountInfo = this.parseIdToken(idToken);
        planType = accountInfo?.plan_type;
      }

      // 如果还是没有，尝试从 access_token 解析
      if (!planType && accessToken) {
        accountInfo = accountInfo || this.parseAccessToken(accessToken);
        planType = accountInfo?.plan_type;
      }

      // 最后使用默认值
      planType = planType || 'free';

      // 根据订阅类型估算额度
      const quota = this.estimateQuota(planType, actualUsage);

      return {
        success: true,
        account: accountInfo || {
          account_id: null,
          plan_type: planType,
          subscription_start: null,
          subscription_end: null
        },
        quota: quota,
        usage: {
          available: true,
          estimated_remaining: quota.remaining
        },
        status: 'active'
      };
    } catch (error) {
      return {
        success: false,
        status: 'error',
        error_message: error.message,
        retryable: false
      };
    }
  }

  /**
   * 从 Access Token 解析账号信息（备用方案）
   */
  parseAccessToken(accessToken) {
    try {
      if (!accessToken) {
        return null;
      }

      const parts = accessToken.split('.');
      if (parts.length !== 3) {
        return null;
      }

      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      const authInfo = payload['https://api.openai.com/auth'] || {};
      const profileInfo = payload['https://api.openai.com/profile'] || {};

      return {
        account_id: authInfo.user_id || null,
        plan_type: 'free', // access_token 里没有 plan_type，默认 free
        email: profileInfo.email || null,
        subscription_start: null,
        subscription_end: null
      };
    } catch (error) {
      console.warn('解析 Access Token 失败:', error.message);
      return null;
    }
  }

  /**
   * 从 ID Token 解析账号信息
   */
  parseIdToken(idToken) {
    try {
      if (!idToken) {
        return null;
      }

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
