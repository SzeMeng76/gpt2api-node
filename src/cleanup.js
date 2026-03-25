import db from './config/database.js';

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
    }

    // 重置所有账号的请求统计（但保留额度信息，因为额度是3小时自动刷新的）
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

  // 立即检查一次
  runCleanup();

  // 每小时检查一次
  setInterval(runCleanup, 60 * 60 * 1000);

  console.log('✓ 日志清理定时任务已启动（每天凌晨 3 点执行）');
}

export default {
  cleanupOldLogs,
  startCleanupSchedule
};
