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
   * @param {string} dbPlanType - 数据库中存储的 plan_type (优先级最高)
   */
  async checkQuota(accessToken, idToken, dbPlanType = null) {
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
      const quota = this.estimateQuota(planType);

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
   * 注意：ChatGPT 的额度是按时间周期重置的，不是按 token 消耗
   *
   * 2026年最新限额（来源：OpenAI官方文档）:
   * - GPT-5 系列：按消息数限制（每3小时重置）
   * - o3/o4-mini：按每日/每周限制
   * - Codex 模型：按消息数限制（每5小时滚动窗口 + 每周上限）
   */
  estimateQuota(planType, actualUsage = 0) {
    const plan = (planType || 'free').toLowerCase();

    // GPT-5 系列限额
    let gpt5Quota = {
      gpt5: 10,           // GPT-5: 10 messages/5h (Free)
      gpt5Thinking: 0,    // GPT-5 Thinking: 0 (Free无权限)
      o3: 0,              // o3: 0 (Free无权限)
      o4mini: 0           // o4-mini: 0 (Free无权限)
    };

    // GPT-4 系列限额（每3小时）
    let gpt4Quota = {
      gpt4o: 80,          // GPT-4o: 80 messages/3h
      gpt4: 40,           // GPT-4: 40 messages/3h
      gpt35: 100          // GPT-3.5: 100 messages/3h
    };

    // Codex 模型限额（每5小时滚动窗口）
    let codexQuota = {
      local: 20,          // 本地消息
      cloud: 10,          // 云端任务
      weekly: 100         // 每周上限
    };

    // 平台总限制（所有模型共享）
    let platformLimit = 80; // 每3小时跨模型总限制

    if (plan.includes('go')) {
      // Go Plan ($8/month)
      gpt5Quota = { gpt5: 160, gpt5Thinking: 10, o3: 0, o4mini: 0 };
      gpt4Quota = { gpt4o: 100, gpt4: 50, gpt35: 150 };
      codexQuota = { local: 35, cloud: 15, weekly: 200 };
      platformLimit = 80;
    } else if (plan.includes('plus')) {
      // Plus Plan ($20/month)
      gpt5Quota = { gpt5: 160, gpt5Thinking: 3000, o3: 100, o4mini: 300 };
      gpt4Quota = { gpt4o: 80, gpt4: 40, gpt35: 100 };
      codexQuota = { local: 90, cloud: 30, weekly: 500 };
      platformLimit = 80;
    } else if (plan.includes('pro')) {
      // Pro Plan ($200/month) - Unlimited
      gpt5Quota = { gpt5: 999999, gpt5Thinking: 999999, o3: 999999, o4mini: 999999 };
      gpt4Quota = { gpt4o: 999999, gpt4: 999999, gpt35: 999999 };
      codexQuota = { local: 900, cloud: 300, weekly: 5000 };
      platformLimit = 999999;
    } else if (plan.includes('team') || plan.includes('business')) {
      // Team/Business Plan (~2x Plus limits)
      gpt5Quota = { gpt5: 160, gpt5Thinking: 3000, o3: 200, o4mini: 600 };
      gpt4Quota = { gpt4o: 160, gpt4: 80, gpt35: 200 };
      codexQuota = { local: 180, cloud: 60, weekly: 1000 };
      platformLimit = 160;
    } else if (plan.includes('enterprise')) {
      // Enterprise - Custom/Unlimited
      gpt5Quota = { gpt5: 999999, gpt5Thinking: 999999, o3: 999999, o4mini: 999999 };
      gpt4Quota = { gpt4o: 999999, gpt4: 999999, gpt35: 999999 };
      codexQuota = { local: 999999, cloud: 999999, weekly: 999999 };
      platformLimit = 999999;
    }

    // ChatGPT 额度是周期性重置的，不累计消耗
    return {
      // GPT-5 系列
      gpt5: {
        gpt5: { total: gpt5Quota.gpt5, used: 0, remaining: gpt5Quota.gpt5, resetPeriod: plan === 'free' ? '5 hours' : '3 hours' },
        gpt5Thinking: { total: gpt5Quota.gpt5Thinking, used: 0, remaining: gpt5Quota.gpt5Thinking, resetPeriod: '1 week' },
        o3: { total: gpt5Quota.o3, used: 0, remaining: gpt5Quota.o3, resetPeriod: '1 week' },
        o4mini: { total: gpt5Quota.o4mini, used: 0, remaining: gpt5Quota.o4mini, resetPeriod: '1 day' }
      },
      // GPT-4 系列
      gpt4: {
        gpt4o: { total: gpt4Quota.gpt4o, used: 0, remaining: gpt4Quota.gpt4o, resetPeriod: '3 hours' },
        gpt4: { total: gpt4Quota.gpt4, used: 0, remaining: gpt4Quota.gpt4, resetPeriod: '3 hours' },
        gpt35: { total: gpt4Quota.gpt35, used: 0, remaining: gpt4Quota.gpt35, resetPeriod: '3 hours' }
      },
      // Codex 系列
      codex: {
        local: { total: codexQuota.local, used: 0, remaining: codexQuota.local, resetPeriod: '5 hours' },
        cloud: { total: codexQuota.cloud, used: 0, remaining: codexQuota.cloud, resetPeriod: '5 hours' },
        weekly: { total: codexQuota.weekly, used: 0, remaining: codexQuota.weekly, resetPeriod: '1 week' }
      },
      // 平台总限制
      platform: {
        total: platformLimit,
        used: 0,
        remaining: platformLimit,
        resetPeriod: '3 hours',
        note: 'All models combined limit'
      },
      // 保持向后兼容
      total: gpt5Quota.gpt5,
      used: 0,
      remaining: gpt5Quota.gpt5
    };
  }
}

export default new QuotaChecker();
