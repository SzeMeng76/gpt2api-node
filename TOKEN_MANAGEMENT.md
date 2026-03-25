# Token 管理和额度检查说明

## 新增功能

### 1. Token 状态管理

系统现在会自动跟踪每个 token 的状态：

- **active**: 正常可用
- **error**: 出现错误但可重试
- **payment_required**: 余额不足或订阅过期（402 错误）
- **forbidden**: 账号被封禁（403 错误）
- **rate_limited**: 请求频率超限（429 错误）
- **unauthorized**: Token 过期或无效（401 错误）

### 2. 自动错误处理

- **连续失败自动禁用**: 当 token 连续失败 5 次（可配置）后，会自动禁用
- **不可恢复错误立即禁用**: 遇到 402（余额不足）或 403（账号封禁）时立即禁用
- **速率限制自动重试**: 遇到 429 错误时，设置 1 小时后重试
- **成功后重置计数**: 请求成功后自动重置错误计数

### 3. 真实额度检查

新增 `/admin/tokens/:id/quota` 接口，通过实际调用 ChatGPT API 来检查：

- 账号真实状态（是否可用）
- 订阅类型（免费/Plus/Team/Enterprise）
- 账号信息（邮箱、账号 ID）
- 估算的额度使用情况

## 使用方法

### 1. 单个 Token 额度检查

```bash
curl -X POST http://localhost:3000/admin/tokens/1/quota \
  -H "Cookie: connect.sid=YOUR_SESSION_ID"
```

响应示例：
```json
{
  "success": true,
  "quota": {
    "total": 500000,
    "used": 12345,
    "remaining": 487655,
    "plan_type": "plus"
  },
  "account": {
    "account_id": "user-xxx",
    "email": "user@example.com",
    "plan_type": "plus",
    "is_paid": true
  },
  "message": "额度检查成功"
}
```

失败响应示例：
```json
{
  "success": false,
  "status": "payment_required",
  "error": "账号余额不足或订阅已过期",
  "error_code": 402,
  "retryable": false,
  "auto_disabled": true
}
```

### 2. 批量刷新所有 Token

```bash
curl -X POST http://localhost:3000/admin/tokens/quota/refresh-all \
  -H "Cookie: connect.sid=YOUR_SESSION_ID"
```

响应示例：
```json
{
  "success": true,
  "total": 10,
  "success": 7,
  "failed": 2,
  "disabled": 1,
  "errors": [
    "Token 3: 账号余额不足或订阅已过期 (已自动禁用)",
    "Token 5: 请求频率超限"
  ],
  "message": "批量刷新完成：成功 7 个，失败 2 个，自动禁用 1 个"
}
```

### 3. 查看 Token 状态

在管理后台的 Token 列表中，现在会显示：

- **status**: 当前状态
- **status_message**: 状态说明
- **error_count**: 连续错误次数
- **last_error_at**: 最后错误时间
- **next_retry_after**: 下次重试时间

## 配置选项

在 `.env` 文件中配置：

```env
# 最大重试次数
MAX_RETRIES=3

# 重试延迟（毫秒）
RETRY_DELAY_MS=1000

# 连续失败多少次后自动禁用
MAX_ERROR_COUNT=5
```

## 工作流程

### 请求处理流程

1. 从可用 token 池中选择一个 token
2. 使用该 token 发送请求
3. 如果成功：
   - 重置错误计数
   - 更新使用统计
   - 更新额度信息
4. 如果失败：
   - 增加错误计数
   - 更新状态和错误信息
   - 根据错误类型决定是否禁用或设置重试时间
   - 尝试下一个 token（如果有重试次数）

### 自动禁用规则

Token 会在以下情况下自动禁用：

1. **402 错误**: 余额不足或订阅过期
2. **403 错误**: 账号被封禁
3. **连续失败**: 错误计数达到 `MAX_ERROR_COUNT`（默认 5 次）

### 重试机制

- **401/403 错误**: 尝试刷新 token 后重试
- **429 错误**: 设置 1 小时后重试，不立即禁用
- **5xx 错误**: 可重试，但会增加错误计数

## 数据库字段说明

新增的 tokens 表字段：

- `status`: 状态（active/error/payment_required/forbidden/rate_limited/unauthorized）
- `status_message`: 状态说明文本
- `error_count`: 连续错误次数
- `last_error_at`: 最后错误时间
- `next_retry_after`: 下次重试时间（用于速率限制）

## 最佳实践

1. **定期检查额度**: 建议每天运行一次批量刷新，及时发现失效的 token
2. **监控错误日志**: 关注自动禁用的 token，及时补充新的账号
3. **合理设置重试**: 根据实际情况调整 `MAX_RETRIES` 和 `MAX_ERROR_COUNT`
4. **及时处理失效账号**: 对于被禁用的 token，检查原因后删除或重新激活

## 故障排查

### Token 被自动禁用了怎么办？

1. 查看 `status_message` 了解禁用原因
2. 如果是 402 错误，检查账号余额或订阅状态
3. 如果是 403 错误，账号可能被封，需要更换
4. 如果是连续失败，可能是网络问题，解决后可重新启用

### 如何重新启用 Token？

在管理后台中：
1. 找到被禁用的 token
2. 点击"启用"按钮
3. 系统会重置错误计数和状态

或通过 API：
```bash
curl -X PUT http://localhost:3000/admin/tokens/1 \
  -H "Cookie: connect.sid=YOUR_SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"is_active": true}'
```

### 额度显示不准确？

额度是基于以下信息估算的：
1. ID Token 中的订阅类型
2. API 返回的账号信息
3. 实际的 token 使用量（从 api_logs 统计）

ChatGPT API 不提供精确的额度查询接口，所以显示的是估算值。真实可用性以实际 API 调用结果为准。
