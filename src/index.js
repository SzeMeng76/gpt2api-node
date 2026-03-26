import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { initDatabase } from './config/database.js';
import { Token, ApiLog, Settings } from './models/index.js';
import TokenManager from './tokenManager.js';
import ProxyHandler from './proxyHandler.js';
import { ProxyError } from './proxyHandler.js';
import { authenticateApiKey, authenticateAdmin } from './middleware/auth.js';
import { startCleanupSchedule, startQuotaResetSchedule } from './cleanup.js';

// 导入路由
import authRoutes from './routes/auth.js';
import apiKeysRoutes from './routes/apiKeys.js';
import tokensRoutes from './routes/tokens.js';
import statsRoutes from './routes/stats.js';
import settingsRoutes from './routes/settings.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const MODELS_FILE = process.env.MODELS_FILE || './models.json';

// 初始化数据库
initDatabase();

// 中间件
app.use(express.json({ limit: '10mb' })); // 增加请求体大小限制以支持批量导入
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'gpt2api-node-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // 生产环境设置为 true（需要 HTTPS）
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 小时
  }
}));
app.use(express.static(path.join(__dirname, '../public')));

// 加载模型列表
let modelsList = [];
try {
  const modelsData = await fs.readFile(MODELS_FILE, 'utf-8');
  modelsList = JSON.parse(modelsData);
  console.log(`✓ 加载了 ${modelsList.length} 个模型`);
} catch (err) {
  console.warn('⚠ 无法加载模型列表，使用默认列表');
  modelsList = [
    { id: 'gpt-5.4', object: 'model', created: 1772697600, owned_by: 'openai' },
    { id: 'gpt-5.3-codex', object: 'model', created: 1770307200, owned_by: 'openai' }
  ];
}

// 创建 Token 管理器池
const tokenManagers = new Map();
let currentTokenIndex = 0; // 轮询索引

// 获取当前负载均衡策略
function getLoadBalanceStrategy() {
  return Settings.get('load_balance_strategy') || process.env.LOAD_BALANCE_STRATEGY || 'round-robin';
}

// Retry config
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const RETRY_DELAY_MS = parseInt(process.env.RETRY_DELAY_MS || '1000', 10);
const MAX_ERROR_COUNT = parseInt(process.env.MAX_ERROR_COUNT || '5', 10); // 连续失败 5 次后自动禁用

// 获取可用的 Token Manager（支持多种策略）
function getAvailableTokenManager(excludeIds = new Set()) {
  const activeTokens = Token.getAvailableForRetry().filter(t => !excludeIds.has(t.id));

  if (activeTokens.length === 0) {
    return null;
  }

  let token;
  const strategy = getLoadBalanceStrategy();

  switch (strategy) {
    case 'random':
      // 随机策略：随机选择一个 token
      token = activeTokens[Math.floor(Math.random() * activeTokens.length)];
      break;

    case 'least-used':
      // 最少使用策略：选择总请求数最少的 token
      token = activeTokens.reduce((min, current) => {
        return (current.total_requests || 0) < (min.total_requests || 0) ? current : min;
      });
      break;

    case 'round-robin':
    default:
      // 轮询策略：按顺序选择下一个 token
      token = activeTokens[currentTokenIndex % activeTokens.length];
      currentTokenIndex = (currentTokenIndex + 1) % activeTokens.length;
      break;
  }

  if (!tokenManagers.has(token.id)) {
    // 创建临时 token 文件
    const tempTokenData = {
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      id_token: token.id_token,
      account_id: token.account_id,
      email: token.email,
      expired_at: token.expired_at,
      last_refresh_at: token.last_refresh_at,
      type: 'codex'
    };

    // 使用内存中的 token 数据
    const manager = new TokenManager(null);
    manager.tokenData = tempTokenData;
    tokenManagers.set(token.id, { manager, tokenId: token.id });
  }

  return tokenManagers.get(token.id);
}

// ==================== 管理后台路由 ====================
app.use('/admin/auth', authRoutes);
app.use('/admin/api-keys', apiKeysRoutes);
app.use('/admin/tokens', tokensRoutes);
app.use('/admin/stats', statsRoutes);
app.use('/admin/settings', settingsRoutes);

// 根路径重定向到管理后台
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// ==================== 代理接口（需要 API Key） ====================

// OpenAI 兼容的聊天完成接口
app.post('/v1/chat/completions', authenticateApiKey, async (req, res) => {
  const model = req.body.model || 'unknown';
  const apiKeyId = req.apiKey?.id || null;
  const isStream = req.body.stream === true;
  const triedTokenIds = new Set();
  let lastError = null;
  const startTime = Date.now(); // 记录开始时间

  // 查找模型配置
  const modelConfig = modelsList.find(m => m.id === model);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = getAvailableTokenManager(triedTokenIds);
    if (!result) {
      // No more tokens to try
      break;
    }

    const { manager, tokenId } = result;
    triedTokenIds.add(tokenId);

    try {
      const proxyHandler = new ProxyHandler(manager, modelConfig);
      let usage;

      if (isStream) {
        usage = await proxyHandler.handleStreamRequest(req, res);
      } else {
        usage = await proxyHandler.handleNonStreamRequest(req, res);
      }

      // Success — update stats with actual token usage
      Token.updateUsage(tokenId, true);
      Token.resetErrorCount(tokenId); // 成功后重置错误计数
      if (usage && usage.total_tokens > 0) {
        Token.consumeQuota(tokenId, usage.total_tokens);
      }
      ApiLog.create({
        api_key_id: apiKeyId,
        token_id: tokenId,
        model,
        endpoint: '/v1/chat/completions',
        status_code: 200,
        error_message: null,
        input_tokens: usage?.input_tokens || 0,
        output_tokens: usage?.output_tokens || 0,
        total_tokens: usage?.total_tokens || 0,
        response_time: Date.now() - startTime
      });
      return;

    } catch (error) {
      lastError = error;
      Token.updateUsage(tokenId, false);
      Token.incrementErrorCount(tokenId); // 增加错误计数

      const retryable = error instanceof ProxyError ? error.retryable : false;
      const status = error instanceof ProxyError ? error.status : 500;

      console.error(`[Attempt ${attempt}/${MAX_RETRIES}] Token ${tokenId} failed [${status}]: ${error.message}`);

      // 检查错误类型并更新状态
      const token = Token.findById(tokenId);
      if (token) {
        let statusMessage = error.message;
        let shouldDisable = false;

        // 根据错误码设置状态
        if (status === 402) {
          Token.updateStatus(tokenId, 'payment_required', '账号余额不足或订阅已过期');
          shouldDisable = true;
        } else if (status === 403) {
          Token.updateStatus(tokenId, 'forbidden', '账号被封禁或无权限');
          shouldDisable = true;
        } else if (status === 429) {
          Token.updateStatus(tokenId, 'rate_limited', '请求频率超限');
          // 设置重试时间（1小时后）
          const retryAfter = new Date(Date.now() + 3600000).toISOString();
          Token.setRetryAfter(tokenId, retryAfter);
        } else if (token.error_count >= MAX_ERROR_COUNT) {
          // 连续失败次数过多，自动禁用
          Token.updateStatus(tokenId, 'error', `连续失败 ${token.error_count} 次`);
          shouldDisable = true;
        }

        // 自动禁用失效的 token
        if (shouldDisable) {
          Token.toggleActive(tokenId, false);
          console.log(`Token ${tokenId} 已自动禁用: ${statusMessage}`);
        }
      }

      if (!retryable || attempt >= MAX_RETRIES) {
        break;
      }

      // 401/403: refresh token before next attempt
      if (status === 401 || status === 403) {
        try {
          await manager.refreshToken();
          console.log(`Token ${tokenId} refreshed, retrying...`);
          triedTokenIds.delete(tokenId); // allow retry with same token after refresh
        } catch (refreshErr) {
          console.error(`Token ${tokenId} refresh failed: ${refreshErr.message}`);
        }
      }

      if (RETRY_DELAY_MS > 0) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  // All retries exhausted
  const status = lastError instanceof ProxyError ? lastError.status : 500;
  const message = lastError?.message || 'No available tokens';

  ApiLog.create({
    api_key_id: apiKeyId,
    token_id: null,
    model,
    endpoint: '/v1/chat/completions',
    status_code: status,
    error_message: message,
    response_time: Date.now() - startTime
  });

  if (!res.headersSent) {
    res.status(status).json({
      error: {
        message,
        type: 'proxy_error',
        code: status
      }
    });
  }
});

// Codex responses 直通接口 — 供 Codex CLI 直接接入
app.post('/v1/responses', authenticateApiKey, async (req, res) => {
  const model = req.body.model || 'unknown';
  const apiKeyId = req.apiKey?.id || null;
  const triedTokenIds = new Set();
  let lastError = null;
  const startTime = Date.now(); // 记录开始时间

  // 查找模型配置
  const modelConfig = modelsList.find(m => m.id === model);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = getAvailableTokenManager(triedTokenIds);
    if (!result) break;

    const { manager, tokenId } = result;
    triedTokenIds.add(tokenId);

    try {
      const proxyHandler = new ProxyHandler(manager, modelConfig);
      const usage = await proxyHandler.handlePassthrough(req, res);

      Token.updateUsage(tokenId, true);
      Token.resetErrorCount(tokenId); // 成功后重置错误计数
      if (usage && usage.total_tokens > 0) {
        Token.consumeQuota(tokenId, usage.total_tokens);
      }
      ApiLog.create({
        api_key_id: apiKeyId,
        token_id: tokenId,
        model,
        endpoint: '/v1/responses',
        status_code: 200,
        error_message: null,
        input_tokens: usage?.input_tokens || 0,
        output_tokens: usage?.output_tokens || 0,
        total_tokens: usage?.total_tokens || 0,
        response_time: Date.now() - startTime
      });
      return;

    } catch (error) {
      lastError = error;
      Token.updateUsage(tokenId, false);
      Token.incrementErrorCount(tokenId); // 增加错误计数

      const retryable = error instanceof ProxyError ? error.retryable : false;
      const status = error instanceof ProxyError ? error.status : 500;

      console.error(`[Attempt ${attempt}/${MAX_RETRIES}] Token ${tokenId} failed [${status}]: ${error.message}`);

      // 检查错误类型并更新状态
      const token = Token.findById(tokenId);
      if (token) {
        let statusMessage = error.message;
        let shouldDisable = false;

        if (status === 402) {
          Token.updateStatus(tokenId, 'payment_required', '账号余额不足或订阅已过期');
          shouldDisable = true;
        } else if (status === 403) {
          Token.updateStatus(tokenId, 'forbidden', '账号被封禁或无权限');
          shouldDisable = true;
        } else if (status === 429) {
          Token.updateStatus(tokenId, 'rate_limited', '请求频率超限');
          const retryAfter = new Date(Date.now() + 3600000).toISOString();
          Token.setRetryAfter(tokenId, retryAfter);
        } else if (token.error_count >= MAX_ERROR_COUNT) {
          Token.updateStatus(tokenId, 'error', `连续失败 ${token.error_count} 次`);
          shouldDisable = true;
        }

        if (shouldDisable) {
          Token.toggleActive(tokenId, false);
          console.log(`Token ${tokenId} 已自动禁用: ${statusMessage}`);
        }
      }

      if (!retryable || attempt >= MAX_RETRIES) break;

      if (status === 401 || status === 403) {
        try {
          await manager.refreshToken();
          triedTokenIds.delete(tokenId);
        } catch (refreshErr) {
          console.error(`Token ${tokenId} refresh failed: ${refreshErr.message}`);
        }
      }

      if (RETRY_DELAY_MS > 0) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  const status = lastError instanceof ProxyError ? lastError.status : 500;
  const message = lastError?.message || 'No available tokens';

  ApiLog.create({
    api_key_id: apiKeyId, token_id: null, model,
    endpoint: '/v1/responses', status_code: status, error_message: message,
    response_time: Date.now() - startTime
  });

  if (!res.headersSent) {
    res.status(status).json({
      error: { message, type: 'proxy_error', code: status }
    });
  }
});

// 模型列表接口（公开）
app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: modelsList
  });
});

// 健康检查（公开）
app.get('/health', (req, res) => {
  const activeTokens = Token.getActive();
  res.json({ 
    status: 'ok',
    tokens_count: activeTokens.length
  });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({
    error: {
      message: err.message || '内部服务器错误',
      type: 'server_error'
    }
  });
});

// 启动服务器
app.listen(PORT, () => {
  const activeTokens = Token.getActive();
  const allTokens = Token.getAll();
  const currentStrategy = getLoadBalanceStrategy();
  const strategyNames = {
    'round-robin': '轮询',
    'random': '随机',
    'least-used': '最少使用'
  };

  console.log('=================================');
  console.log('🚀 GPT2API Node 管理系统已启动');
  console.log(`📡 监听端口: ${PORT}`);
  console.log(`⚖️  账号总数: ${allTokens.length} | 负载均衡: ${strategyNames[currentStrategy] || currentStrategy}`);
  console.log(`🔑 活跃账号: ${activeTokens.length} 个`);
  console.log('=================================');
  console.log(`\n管理后台: http://localhost:${PORT}/admin`);
  console.log(`API 接口: http://localhost:${PORT}/v1/chat/completions`);
  console.log(`\n首次使用请运行: npm run init-db`);
  console.log(`默认账户: admin / admin123\n`);

  // 启动日志清理定时任务
  startCleanupSchedule();

  // 启动额度刷新定时任务
  startQuotaResetSchedule();
});
