import express from 'express';
import { authenticateAdmin } from '../middleware/auth.js';
import { Settings } from '../models/index.js';

const router = express.Router();

// 所有路由都需要认证
router.use(authenticateAdmin);

// 获取负载均衡策略
router.get('/load-balance-strategy', async (req, res) => {
  try {
    const strategy = Settings.get('load_balance_strategy') || process.env.LOAD_BALANCE_STRATEGY || 'round-robin';
    res.json({ strategy });
  } catch (error) {
    console.error('获取策略失败:', error);
    res.status(500).json({ error: '获取策略失败' });
  }
});

// 更新负载均衡策略
router.post('/load-balance-strategy', async (req, res) => {
  try {
    const { strategy } = req.body;

    if (!['round-robin', 'random', 'least-used'].includes(strategy)) {
      return res.status(400).json({ error: '无效的策略' });
    }

    // 保存到数据库
    Settings.set('load_balance_strategy', strategy);

    res.json({
      success: true,
      message: '策略已更新并保存到数据库，将在下次请求时生效',
      strategy
    });
  } catch (error) {
    console.error('更新策略失败:', error);
    res.status(500).json({ error: '更新策略失败' });
  }
});

export default router;
