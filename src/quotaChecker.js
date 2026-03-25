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
   */
  async checkQuota(accessToken, idToken, actualUsage = 0) {
    try {
      // 从 ID Token 解析账号信息
      const accountInfo = this.parseIdToken(idToken);

      if (!accountInfo) {
        return {
          success: false,
          status: 'error',
          error_message: '无法解析 Token 信息',
          retryable: false
        };
      }

      // 根据订阅类型估算额度
      const quota = this.estimateQuota(accountInfo.plan_type, actualUsage);

      return {
        success: true,
        account: accountInfo,
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
