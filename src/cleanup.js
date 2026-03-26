import db from './config/database.js';

/**
 * 重置所有过期的 token 额度
 */
export function resetExpiredQuotas() {
  try {
    const now = new Date().toISOString();

    // 查找所有需要重置额度的 token
    const tokens = db.prepare(`
      SELECT id, plan_type, quota_reset_at
      FROM tokens
      WHERE is_active = 1
      AND (quota_reset_at IS NULL OR quota_reset_at <= ?)
    `).all(now);

    if (tokens.length === 0) {
      return 0;
    }

    let resetCount = 0;
    const nextReset = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

    for (const token of tokens) {
      const planType = token.plan_type || 'free';
      let totalQuota = 50000;

      if (planType.includes('plus') || planType.includes('pro')) {
        totalQuota = 500000;
      } else if (planType.includes('team')) {
        totalQuota = 1000000;
      } else if (planType.includes('enterprise')) {
        totalQuota = 5000000;
      }

      // 重置额度
      db.prepare(`
        UPDATE tokens
        SET quota_total = ?,
            quota_used = 0,
            quota_remaining = ?,
            quota_reset_at = ?
        WHERE id = ?
      `).run(totalQuota, totalQuota, nextReset, token.id);

      resetCount++;
    }

    if (resetCount > 0) {
      console.log(`✓ 重置了 ${resetCount} 个账号的额度（下次重置: ${nextReset}）`);
    }

    return resetCount;
  } catch (error) {
    console.error('重置额度失败:', error);
    return 0;
  }
}

/**
 * 清理旧的 API 日志并重置账号统计（保留最近 90 天）
 */
export function cleanupOldLogs() {
  try {
    const daysToKeep = parseInt(process.env.LOG_RETENTION_DAYS || '90', 10);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    // 清理旧日志
    const result = db.prepare(`
      DELETE FROM api_logs
      WHERE created_at < ?
    `).run(cutoffDate.toISOString());

    if (result.changes > 0) {
      console.log(`✓ 清理了 ${result.changes} 条旧日志（${daysToKeep} 天前）`);

      // 只有在清理了日志后才重置统计
      const resetResult = db.prepare(`
        UPDATE tokens
        SET total_requests = 0,
            success_requests = 0,
            failed_requests = 0,
            error_count = 0
      `).run();

      if (resetResult.changes > 0) {
        console.log(`✓ 重置了 ${resetResult.changes} 个账号的请求统计`);
      }
    }

    return result.changes;
  } catch (error) {
    console.error('清理旧日志失败:', error);
    return 0;
  }
}

/**
 * 启动定时清理任务（每天凌晨 3 点执行）
 */
export function startCleanupSchedule() {
  const runCleanup = () => {
    const now = new Date();
    const hour = now.getHours();

    // 每天凌晨 3 点执行
    if (hour === 3) {
      console.log('开始执行日志清理任务...');
      cleanupOldLogs();
    }
  };

  // 立即检查一次（只有在有 90 天前的日志时才会清理）
  runCleanup();

  // 每小时检查一次
  setInterval(runCleanup, 60 * 60 * 1000);

  console.log('✓ 日志清理定时任务已启动（每天凌晨 3 点执行）');
}

/**
 * 启动额度刷新定时任务（每 3 小时执行一次）
 */
export function startQuotaResetSchedule() {
  // 立即执行一次
  console.log('开始初始化额度刷新...');
  resetExpiredQuotas();

  // 每 3 小时执行一次
  setInterval(() => {
    console.log('开始执行额度刷新任务...');
    resetExpiredQuotas();
  }, 3 * 60 * 60 * 1000);

  console.log('✓ 额度刷新定时任务已启动（每 3 小时执行一次）');
}

export default {
  cleanupOldLogs,
  startCleanupSchedule,
  resetExpiredQuotas,
  startQuotaResetSchedule
};
