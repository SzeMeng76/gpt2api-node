import express from 'express';
import { Token, ApiLog } from '../models/index.js';
import { authenticateAdmin } from '../middleware/auth.js';
import quotaChecker from '../quotaChecker.js';

const router = express.Router();

// 所有路由都需要认证
router.use(authenticateAdmin);

// 获取所有 Tokens（支持分页）
router.get('/', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    const allTokens = Token.getAll();
    const total = allTokens.length;
    const tokens = allTokens.slice(offset, offset + limit);
    
    // 隐藏敏感信息
    const maskedTokens = tokens.map(t => ({
      ...t,
      access_token: t.access_token ? '***' : null,
      refresh_token: t.refresh_token ? '***' : null,
      id_token: t.id_token ? '***' : null
    }));
    
    res.json({
      data: maskedTokens,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('获取 Tokens 失败:', error);
    res.status(500).json({ error: '获取 Tokens 失败' });
  }
});

// 创建 Token
router.post('/', async (req, res) => {
  try {
    const { name, access_token, refresh_token, id_token, email, account_id, expired_at, expired, last_refresh_at, last_refresh, plan_type } = req.body;

    // 验证必需字段
    if (!access_token || !refresh_token) {
      return res.status(400).json({ error: 'access_token 和 refresh_token 是必需的' });
    }

    // 从 access_token 解析信息
    let parsedEmail = email;
    let parsedAccountId = account_id;

    if (!parsedEmail || !parsedAccountId) {
      const tokenInfo = quotaChecker.parseAccessToken(access_token);
      if (tokenInfo) {
        parsedEmail = parsedEmail || tokenInfo.email;
        parsedAccountId = parsedAccountId || tokenInfo.account_id;
      }
    }

    // 创建 Token 记录（支持旧字段名兼容）
    const id = Token.create({
      name: name || parsedEmail || parsedAccountId || '未命名账户',
      email: parsedEmail,
      account_id: parsedAccountId,
      access_token,
      refresh_token,
      id_token,
      expired_at: expired_at || expired || null,
      last_refresh_at: last_refresh_at || last_refresh || null,
      plan_type: plan_type || 'free'
    });

    res.json({
      success: true,
      id,
      message: 'Token 添加成功'
    });
  } catch (error) {
    console.error('添加 Token 失败:', error);
    res.status(500).json({ error: '添加 Token 失败: ' + error.message });
  }
});

// 批量导入 Tokens
router.post('/import', async (req, res) => {
  try {
    const { tokens } = req.body;

    if (!Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({ error: '请提供有效的 tokens 数组' });
    }

    let successCount = 0;
    let failedCount = 0;
    const errors = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      
      try {
        // 验证必需字段
        if (!token.access_token || !token.refresh_token) {
          failedCount++;
          errors.push(`第 ${i + 1} 个 token: 缺少 access_token 或 refresh_token`);
          continue;
        }

        // 从 access_token 解析信息
        let parsedEmail = token.email;
        let parsedAccountId = token.account_id;

        if (!parsedEmail || !parsedAccountId) {
          const tokenInfo = quotaChecker.parseAccessToken(token.access_token);
          if (tokenInfo) {
            parsedEmail = parsedEmail || tokenInfo.email;
            parsedAccountId = parsedAccountId || tokenInfo.account_id;
          }
        }

        // 创建 Token 记录（支持旧字段名兼容）
        Token.create({
          name: token.name || parsedEmail || parsedAccountId || `导入账户 ${i + 1}`,
          email: parsedEmail,
          account_id: parsedAccountId,
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          id_token: token.id_token,
          expired_at: token.expired_at || token.expired || null,
          last_refresh_at: token.last_refresh_at || token.last_refresh || null,
          plan_type: token.plan_type || 'free'
        });

        successCount++;
      } catch (error) {
        failedCount++;
        errors.push(`第 ${i + 1} 个 token: ${error.message}`);
      }
    }

    res.json({
      success: true,
      total: tokens.length,
      success: successCount,
      failed: failedCount,
      errors: errors.length > 0 ? errors : undefined,
      message: `导入完成：成功 ${successCount} 个，失败 ${failedCount} 个`
    });
  } catch (error) {
    console.error('批量导入 Tokens 失败:', error);
    res.status(500).json({ error: '批量导入失败: ' + error.message });
  }
});

// 更新 Token
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    
    Token.toggleActive(id, is_active);
    res.json({ success: true });
  } catch (error) {
    console.error('更新 Token 失败:', error);
    res.status(500).json({ error: '更新 Token 失败' });
  }
});

// 手动刷新 Token
router.post('/:id/refresh', async (req, res) => {
  try {
    const { id } = req.params;
    const token = Token.findById(id);

    if (!token) {
      return res.status(404).json({ error: 'Token 不存在' });
    }

    // 这里需要调用 tokenManager 的刷新功能
    // 暂时返回提示
    res.json({
      success: false,
      message: 'Token 刷新功能需要集成到 tokenManager'
    });
  } catch (error) {
    console.error('刷新 Token 失败:', error);
    res.status(500).json({ error: '刷新 Token 失败' });
  }
});

// 删除 Token
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    Token.delete(id);
    res.json({ success: true });
  } catch (error) {
    console.error('删除 Token 失败:', error);
    res.status(500).json({ error: '删除 Token 失败' });
  }
});

// 批量删除 Tokens
router.post('/batch-delete', (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请提供有效的 ids 数组' });
    }

    let successCount = 0;
    let failedCount = 0;
    const errors = [];

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      
      try {
        Token.delete(id);
        successCount++;
      } catch (error) {
        failedCount++;
        errors.push(`ID ${id}: ${error.message}`);
      }
    }

    res.json({
      success: true,
      total: ids.length,
      success: successCount,
      failed: failedCount,
      errors: errors.length > 0 ? errors : undefined,
      message: `批量删除完成：成功 ${successCount} 个，失败 ${failedCount} 个`
    });
  } catch (error) {
    console.error('批量删除 Tokens 失败:', error);
    res.status(500).json({ error: '批量删除失败: ' + error.message });
  }
});

// 刷新 Token 额度（真实检查）
router.post('/:id/quota', async (req, res) => {
  try {
    const { id } = req.params;
    const token = Token.findById(id);

    if (!token) {
      return res.status(404).json({ error: 'Token 不存在' });
    }

    console.log(`开始检查 Token ${id} 的真实额度...`);

    // 获取实际使用量
    const actualUsage = ApiLog.getTokenUsage(id);

    // 使用被动检查（基于 ID Token 和使用统计）
    const checkResult = await quotaChecker.checkQuota(token.access_token, token.id_token, actualUsage.total_tokens, token.plan_type);

    if (!checkResult.success) {
      // 检查失败，更新错误状态
      Token.incrementErrorCount(id);
      Token.updateStatus(id, checkResult.status, checkResult.error_message);

      // 如果是不可重试的错误（402, 403），自动禁用
      if (!checkResult.retryable) {
        Token.toggleActive(id, false);
        console.log(`Token ${id} 遇到不可恢复错误，已自动禁用`);
      }

      // 如果有重试时间，设置下次重试时间
      if (checkResult.retry_after) {
        const retryAfter = new Date(Date.now() + checkResult.retry_after * 1000).toISOString();
        Token.setRetryAfter(id, retryAfter);
      }

      return res.json({
        success: false,
        status: checkResult.status,
        error: checkResult.error_message,
        error_code: checkResult.error_code,
        retryable: checkResult.retryable,
        auto_disabled: !checkResult.retryable
      });
    }

    // 检查成功，重置错误计数
    Token.resetErrorCount(id);

    // 更新数据库
    Token.updateQuota(id, checkResult.quota);
    Token.updateStatus(id, 'active', null);

    res.json({
      success: true,
      quota: {
        ...checkResult.quota,
        plan_type: checkResult.account?.plan_type || 'free'
      },
      account: checkResult.account,
      usage: checkResult.usage,
      message: '额度检查成功'
    });
  } catch (error) {
    console.error('刷新额度失败:', error);
    res.status(500).json({ error: '刷新额度失败: ' + error.message });
  }
});

// 批量刷新所有 Token 额度（真实检查）
router.post('/quota/refresh-all', async (req, res) => {
  try {
    const tokens = Token.getAll();
    let successCount = 0;
    let failedCount = 0;
    let disabledCount = 0;
    const errors = [];

    for (const token of tokens) {
      try {
        console.log(`检查 Token ${token.id} (${token.email || token.account_id})...`);

        // 获取实际使用量
        const actualUsage = ApiLog.getTokenUsage(token.id);

        // 使用被动检查（基于 ID Token 和使用统计）
        const checkResult = await quotaChecker.checkQuota(token.access_token, token.id_token, actualUsage.total_tokens, token.plan_type);

        if (!checkResult.success) {
          // 检查失败
          Token.incrementErrorCount(token.id);
          Token.updateStatus(token.id, checkResult.status, checkResult.error_message);

          // 如果是不可重试的错误，自动禁用
          if (!checkResult.retryable) {
            Token.toggleActive(token.id, false);
            disabledCount++;
            errors.push(`Token ${token.id}: ${checkResult.error_message} (已自动禁用)`);
          } else {
            errors.push(`Token ${token.id}: ${checkResult.error_message}`);
          }

          // 设置重试时间
          if (checkResult.retry_after) {
            const retryAfter = new Date(Date.now() + checkResult.retry_after * 1000).toISOString();
            Token.setRetryAfter(token.id, retryAfter);
          }

          failedCount++;
          continue;
        }

        // 检查成功
        Token.resetErrorCount(token.id);

        // 更新数据库
        Token.updateQuota(token.id, checkResult.quota);
        Token.updateStatus(token.id, 'active', null);

        successCount++;
      } catch (error) {
        console.error(`刷新 Token ${token.id} 额度失败:`, error);
        failedCount++;
        errors.push(`Token ${token.id}: ${error.message}`);
      }
    }

    res.json({
      success: true,
      total: tokens.length,
      success: successCount,
      failed: failedCount,
      disabled: disabledCount,
      errors: errors.length > 0 ? errors : undefined,
      message: `批量刷新完成：成功 ${successCount} 个，失败 ${failedCount} 个，自动禁用 ${disabledCount} 个`
    });
  } catch (error) {
    console.error('批量刷新额度失败:', error);
    res.status(500).json({ error: '批量刷新失败: ' + error.message });
  }
});

export default router;
