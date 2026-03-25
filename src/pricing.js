/**
 * OpenAI API 定价信息 (2026年3月)
 * 价格单位：美元 / 百万 tokens
 * 来源：OpenAI 官方定价页面
 */
const MODEL_PRICING = {
  // GPT-5.4 系列（最新旗舰）
  'gpt-5.4': { input: 2.50, output: 15.00, cached: 0.25 },
  'gpt-5.4-mini': { input: 0.75, output: 4.50, cached: 0.075 },
  'gpt-5.4-nano': { input: 0.20, output: 1.25, cached: 0.02 },
  'gpt-5.4-pro': { input: 30.00, output: 180.00 },

  // GPT-5 Codex 系列
  'gpt-5.3-codex': { input: 1.75, output: 14.00, cached: 0.175 },
  'gpt-5.2-codex': { input: 1.75, output: 14.00, cached: 0.175 },
  'gpt-5.1-codex-max': { input: 1.25, output: 10.00, cached: 0.125 },
  'gpt-5.1-codex': { input: 1.25, output: 10.00, cached: 0.125 },
  'gpt-5-codex': { input: 1.25, output: 10.00, cached: 0.125 },
  'gpt-5.1-codex-mini': { input: 0.25, output: 2.00, cached: 0.025 },
  'codex-mini-latest': { input: 1.50, output: 6.00, cached: 0.375 },

  // GPT-5 系列
  'gpt-5.2': { input: 1.75, output: 14.00 },
  'gpt-5.1': { input: 1.25, output: 10.00 },
  'gpt-5': { input: 1.25, output: 10.00 },
  'gpt-5-mini': { input: 0.25, output: 2.00 },
  'gpt-5-nano': { input: 0.05, output: 0.40 },

  // GPT-4 系列
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1-nano': { input: 0.10, output: 0.40 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },

  // o 系列（推理模型）
  'o1': { input: 15.00, output: 60.00 },
  'o1-mini': { input: 1.10, output: 4.40 },
  'o3': { input: 2.00, output: 8.00 },
  'o3-mini': { input: 0.50, output: 2.00 },
  'o4-mini': { input: 1.10, output: 4.40 },

  // GPT-3.5 系列
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },

  // 默认价格（如果模型未知）
  'default': { input: 2.50, output: 15.00 }
};

/**
 * 计算单次请求的费用
 * @param {string} model - 模型名称
 * @param {number} inputTokens - 输入 token 数量
 * @param {number} outputTokens - 输出 token 数量
 * @param {number} cachedTokens - 缓存 token 数量（可选）
 * @returns {number} 费用（美元）
 */
export function calculateCost(model, inputTokens, outputTokens, cachedTokens = 0) {
  const normalizedModel = normalizeModelName(model);
  const pricing = MODEL_PRICING[normalizedModel] || MODEL_PRICING['default'];

  // 计算费用（价格是每百万 tokens）
  let inputCost = (inputTokens / 1000000) * pricing.input;
  const outputCost = (outputTokens / 1000000) * pricing.output;

  // 如果有缓存 token 且模型支持缓存定价
  if (cachedTokens > 0 && pricing.cached) {
    const nonCachedTokens = Math.max(0, inputTokens - cachedTokens);
    inputCost = (nonCachedTokens / 1000000) * pricing.input + (cachedTokens / 1000000) * pricing.cached;
  }

  return inputCost + outputCost;
}

/**
 * 标准化模型名称
 */
function normalizeModelName(model) {
  if (!model) return 'default';
  const lower = model.toLowerCase();
  const withoutDate = lower.replace(/-\d{4}-\d{2}-\d{2}$/, '');

  // GPT-5.4 系列
  if (withoutDate.includes('gpt-5.4-pro')) return 'gpt-5.4-pro';
  if (withoutDate.includes('gpt-5.4-mini')) return 'gpt-5.4-mini';
  if (withoutDate.includes('gpt-5.4-nano')) return 'gpt-5.4-nano';
  if (withoutDate.includes('gpt-5.4')) return 'gpt-5.4';

  // Codex 系列
  if (withoutDate.includes('gpt-5.3-codex')) return 'gpt-5.3-codex';
  if (withoutDate.includes('gpt-5.2-codex')) return 'gpt-5.2-codex';
  if (withoutDate.includes('gpt-5.1-codex-max')) return 'gpt-5.1-codex-max';
  if (withoutDate.includes('gpt-5.1-codex-mini')) return 'gpt-5.1-codex-mini';
  if (withoutDate.includes('gpt-5.1-codex')) return 'gpt-5.1-codex';
  if (withoutDate.includes('gpt-5-codex')) return 'gpt-5-codex';
  if (withoutDate.includes('codex-mini-latest')) return 'codex-mini-latest';

  // GPT-5 系列
  if (withoutDate.includes('gpt-5.2')) return 'gpt-5.2';
  if (withoutDate.includes('gpt-5.1')) return 'gpt-5.1';
  if (withoutDate.includes('gpt-5-mini')) return 'gpt-5-mini';
  if (withoutDate.includes('gpt-5-nano')) return 'gpt-5-nano';
  if (withoutDate.includes('gpt-5')) return 'gpt-5';

  // GPT-4 系列
  if (withoutDate.includes('gpt-4.1-mini')) return 'gpt-4.1-mini';
  if (withoutDate.includes('gpt-4.1-nano')) return 'gpt-4.1-nano';
  if (withoutDate.includes('gpt-4.1')) return 'gpt-4.1';
  if (withoutDate.includes('gpt-4o-mini')) return 'gpt-4o-mini';
  if (withoutDate.includes('gpt-4o')) return 'gpt-4o';
  if (withoutDate.includes('gpt-4-turbo')) return 'gpt-4-turbo';
  if (withoutDate.includes('gpt-4')) return 'gpt-4';

  // o 系列
  if (withoutDate.includes('o4-mini')) return 'o4-mini';
  if (withoutDate.includes('o3-mini')) return 'o3-mini';
  if (withoutDate.includes('o3')) return 'o3';
  if (withoutDate.includes('o1-mini')) return 'o1-mini';
  if (withoutDate.includes('o1')) return 'o1';

  // GPT-3.5
  if (withoutDate.includes('gpt-3.5')) return 'gpt-3.5-turbo';

  return 'default';
}

/**
 * 格式化费用显示
 */
export function formatCost(cost) {
  if (cost < 0.001) {
    return `$${(cost * 1000).toFixed(4)}‰`;
  } else if (cost < 0.01) {
    return `$${(cost * 100).toFixed(3)}¢`;
  } else if (cost < 1) {
    return `$${(cost * 100).toFixed(2)}¢`;
  } else {
    return `$${cost.toFixed(2)}`;
  }
}

/**
 * 获取模型定价信息
 */
export function getModelPricing(model) {
  const normalizedModel = normalizeModelName(model);
  return MODEL_PRICING[normalizedModel] || MODEL_PRICING['default'];
}

export default {
  calculateCost,
  formatCost,
  getModelPricing,
  MODEL_PRICING
};
