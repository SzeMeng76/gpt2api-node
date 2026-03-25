# GPT2API Node

基于 Node.js + Express 的 OpenAI Codex 反向代理服务，支持多账号管理、自动刷新 token、负载均衡，提供 OpenAI 兼容的 API 接口和完整的管理后台。

> 本项目基于 [lulistart/gpt2api-node](https://github.com/lulistart/gpt2api-node) 二次开发，感谢原作者的贡献！

## 🎯 核心特性

### API 兼容性
- ✅ **完整的 OpenAI Chat Completions API 支持** - 100% 兼容 OpenAI SDK
- ✅ **原生 Codex Responses API 支持** - `/v1/responses` 端点，完美支持 OpenAI 官方 Codex CLI
- ✅ **流式和非流式响应** - 支持 SSE 流式输出和标准 JSON 响应
- ✅ **工具调用（Function Calling）** - 完整支持工具定义、调用和响应
- ✅ **推理内容（Reasoning Content）** - 支持 o1/o3 系列模型的推理过程输出
- ✅ **结构化输出（Structured Outputs）** - 支持 JSON Schema 格式约束
- ✅ **Thinking 配置支持** - 每个模型可配置独立的 reasoning effort levels

### 请求转换
- 🔄 **智能参数过滤** - 自动过滤 Codex API 不支持的参数（temperature, top_p, max_tokens 等）
- 🛠️ **消息格式转换** - 自动转换 system 角色为 developer，处理多模态内容
- 🔧 **工具定义扁平化** - 自动将嵌套的 function 字段提升到顶层
- ✂️ **长工具名自动缩短** - 超过 64 字符的工具名自动缩短并在响应时还原
- 🎯 **工具类型标准化** - 自动转换遗留工具类型（如 web_search_preview → web_search）
- 🔑 **客户端身份透传** - 支持透传 Originator、Version、X-Codex-Turn-Metadata 等 headers

### 响应处理
- 📊 **完整的流式事件支持** - 处理所有 Codex 响应事件类型
  - `response.output_text.delta` - 文本内容增量
  - `response.reasoning_summary_text.delta` - 推理内容增量
  - `response.output_item.added` - 工具调用开始
  - `response.function_call_arguments.delta` - 工具参数增量
  - `response.completed` - 响应完成
- 🔄 **工具名称还原** - 自动将缩短的工具名还原为原始名称
- ✅ **正确的 finish_reason** - 根据是否有工具调用返回 `tool_calls` 或 `stop`
- 📈 **真实 Token 用量追踪** - 从 Codex API 响应中提取实际 token 使用量

### 系统功能
- 🔄 **自动重试机制** - 请求失败时自动切换 token 重试，最多重试 3 次
- ⚖️ **负载均衡** - 支持轮询、随机、最少使用三种策略
- 🔑 **多账号管理** - 批量导入、手动添加、自动刷新
- 🌐 **xyhelper Token 支持** - 同时支持 OpenAI 原生 OAuth 和 xyhelper token 刷新
- 🐳 **Docker 支持** - 提供完整的 Docker 和 Docker Compose 配置
- 🚀 **GitHub Actions CI/CD** - 自动构建并推送 Docker 镜像到 GHCR

## 界面预览

<table>
  <tr>
    <td width="50%">
      <img src="screenshots/管理员登录.png" alt="管理员登录" />
      <p align="center">管理员登录</p>
    </td>
    <td width="50%">
      <img src="screenshots/仪表盘.png" alt="仪表盘" />
      <p align="center">仪表盘</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="screenshots/API keys.png" alt="API Keys管理" />
      <p align="center">API Keys 管理</p>
    </td>
    <td width="50%">
      <img src="screenshots/账号管理.png" alt="账号管理" />
      <p align="center">账号管理</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="screenshots/数据分析.png" alt="数据分析" />
      <p align="center">数据分析</p>
    </td>
    <td width="50%">
      <img src="screenshots/系统设置.png" alt="系统设置" />
      <p align="center">系统设置</p>
    </td>
  </tr>
</table>

## 功能特性

### 管理后台
- ✅ 完整的 Web 管理界面
- ✅ 仪表盘和实时统计
- ✅ API Key 管理和认证
- ✅ 多账号管理和批量导入
- ✅ 请求统计和数据分析
- ✅ 实时活动记录
- ✅ 系统设置和配置

### Token 管理
- 🔄 自动 Token 刷新（支持 OpenAI 原生 + xyhelper）
- 📊 实时额度查询和更新
- 🔀 智能负载均衡（轮询/随机/最少使用）
- 📈 使用统计和成功率追踪
- 🗑️ 批量删除和管理

### API 功能
- 🌐 OpenAI 兼容接口（`/v1/chat/completions`）
- 🔧 Codex 原生接口（`/v1/responses`）
- 📋 模型列表接口（`/v1/models`）
- ❤️ 健康检查接口（`/health`）
- 🔐 API Key 认证和权限控制

## 快速开始

### 方式一：Docker 部署（推荐）

使用 Docker Compose 一键部署：

```bash
# 克隆项目
git clone https://github.com/SzeMeng76/gpt2api-node.git
cd gpt2api-node

# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f
```

服务将在 `http://localhost:3000` 启动。

### 方式二：本地部署

#### 1. 安装依赖

```bash
cd gpt2api-node
npm install
```

#### 2. 初始化数据库

```bash
npm run init-db
```

默认管理员账户：
- 用户名：`admin`
- 密码：`admin123`

#### 3. 启动服务

```bash
npm start
```

开发模式（自动重启）：

```bash
npm run dev
```

#### 4. 访问管理后台

打开浏览器访问：`http://localhost:3000/admin`

使用默认账户登录后，请立即修改密码。

## 管理后台功能

### 仪表盘
- 系统概览和实时统计
- API Keys 数量
- Token 账号数量
- 今日请求数和成功率
- 最近活动记录

### API Keys 管理
- 创建和管理 API Keys
- 查看使用统计
- 启用/禁用 API Key

### 账号管理
- 批量导入 Token（支持 JSON 文件）
- 手动添加账号
- 批量删除账号
- 查看账号额度和使用情况
- 刷新账号额度
- 负载均衡策略配置

### 数据分析
- 请求量趋势图表
- 模型使用分布
- 账号详细统计
- API 请求日志

### 系统设置
- 修改管理员密码
- 负载均衡策略设置

## 负载均衡策略

支持三种负载均衡策略：

1. **轮询（round-robin）**：按顺序依次使用每个账号
2. **随机（random）**：随机选择一个可用账号
3. **最少使用（least-used）**：选择请求次数最少的账号

可在管理后台的账号管理页面或通过环境变量配置。

## API 接口

### 1. Chat Completions 接口（OpenAI 兼容）

**端点**: `POST /v1/chat/completions`

完全兼容 OpenAI Chat Completions API，支持所有标准功能。

**支持的功能**:
- ✅ 流式和非流式响应
- ✅ 工具调用（Function Calling）
- ✅ 推理内容（Reasoning Content）
- ✅ 结构化输出（JSON Schema）
- ✅ 多模态输入（文本、图片）
- ✅ 多轮对话

**请求头**:
```
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

**基础请求示例**:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.4",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "stream": false
  }'
```

**流式请求示例**:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.4",
    "messages": [
      {"role": "user", "content": "Write a Python function"}
    ],
    "stream": true
  }'
```

**工具调用示例**:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.4",
    "messages": [
      {"role": "user", "content": "What is the weather in Beijing?"}
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_weather",
          "description": "Get the current weather",
          "parameters": {
            "type": "object",
            "properties": {
              "location": {"type": "string"}
            },
            "required": ["location"]
          }
        }
      }
    ],
    "tool_choice": "auto"
  }'
```

### 2. Codex Responses 接口（原生 CLI 支持）

**端点**: `POST /v1/responses`

此端点专为 OpenAI 官方 Codex CLI 设计，完全兼容原生 Responses API 格式。

**特点**:
- 🎯 原生 Codex API 格式
- 🔧 自动参数过滤和转换
- 🛠️ 工具类型标准化
- ✂️ 长工具名自动处理

**请求示例**:

```bash
curl http://localhost:3000/v1/responses \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.3-codex",
    "input": [
      {
        "type": "message",
        "role": "user",
        "content": [
          {"type": "input_text", "text": "Write a hello world in Python"}
        ]
      }
    ]
  }'
```

### 3. 模型列表

**端点**: `GET /v1/models`

```bash
curl http://localhost:3000/v1/models
```

### 4. 健康检查

**端点**: `GET /health`

```bash
curl http://localhost:3000/health
```

**响应示例**:
```json
{
  "status": "ok",
  "tokens_count": 5
}
```

## 支持的模型

所有模型均支持 Thinking/Reasoning 功能，可配置 reasoning effort levels（low, medium, high）。

- `gpt-5.4` - GPT 5.4（最新，2026年3月发布，融合推理和编码能力）
- `gpt-5.4-2026-03-05` - GPT 5.4 固定快照版本
- `gpt-5.3-codex` - GPT 5.3 Codex
- `gpt-5.2` - GPT 5.2
- `gpt-5.2-codex` - GPT 5.2 Codex
- `gpt-5.1` - GPT 5.1
- `gpt-5.1-codex` - GPT 5.1 Codex
- `gpt-5.1-codex-mini` - GPT 5.1 Codex Mini（更快更便宜）
- `gpt-5.1-codex-max` - GPT 5.1 Codex Max
- `gpt-5` - GPT 5
- `gpt-5-codex` - GPT 5 Codex
- `gpt-5-codex-mini` - GPT 5 Codex Mini

**注意**: GPT-5.4 已经融合了 GPT-5.3-Codex 的编码能力，是一个统一的模型，不再有单独的 `gpt-5.4-codex` 版本。

### 模型配置

模型配置存储在 `models.json` 文件中，支持为每个模型配置独立的 thinking 支持：

```json
{
  "id": "gpt-5.4",
  "object": "model",
  "created": 1772697600,
  "owned_by": "openai",
  "thinking": {
    "levels": ["low", "medium", "high"]
  }
}
```

在请求中可以通过 `reasoning_effort` 参数指定推理强度：

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.4",
    "messages": [{"role": "user", "content": "Solve this problem"}],
    "reasoning_effort": "high"
  }'
```

## 在 Cherry Studio 中使用

Cherry Studio 是一个支持多种 AI 服务的桌面客户端。配置步骤：

### 1. 创建 API Key

1. 访问管理后台：`http://localhost:3000/admin`
2. 进入 **API Keys** 页面
3. 点击 **创建 API Key**
4. 复制生成的 API Key（只显示一次）

### 2. 在 Cherry Studio 中配置

1. 打开 Cherry Studio
2. 进入 **设置** → **模型提供商**
3. 添加新的 **OpenAI 兼容** 提供商
4. 填写配置：
   - **名称**: GPT2API Node（或自定义名称）
   - **API 地址**: `http://localhost:3000/v1`
   - **API Key**: 粘贴刚才创建的 API Key
   - **模型**: 选择或手动输入模型名称（如 `gpt-5.3-codex`）

### 3. 开始使用

配置完成后，在 Cherry Studio 中选择刚才添加的提供商和模型，即可开始对话。

## 使用示例

### Python

```python
import openai

client = openai.OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="YOUR_API_KEY"
)

response = client.chat.completions.create(
    model="gpt-5.3-codex",
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)

print(response.choices[0].message.content)
```

### JavaScript/Node.js

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'YOUR_API_KEY'
});

const response = await client.chat.completions.create({
  model: 'gpt-5.3-codex',
  messages: [
    { role: 'user', content: 'Hello!' }
  ]
});

console.log(response.choices[0].message.content);
```

## Token 管理

### 获取 Refresh Token

#### 方式一：xyhelper 插件（推荐 ⭐）

最简单的方式，适合所有用户：

1. 安装 [xyhelper Chrome 插件](https://github.com/xyhelper/xyhelper-chrome-login)
2. 点击插件图标，会自动打开 ChatGPT 登录页面
3. 登录你的 ChatGPT 账号
4. 插件会自动获取 refresh_token
5. 点击复制按钮，将 token 导入到本系统

**优点**：
- ✅ 一键获取，无需技术知识
- ✅ 自动刷新，稳定可靠
- ✅ 支持多账号管理

#### 方式二：OpenAI 原生 Token（高级）

适合技术用户，需要抓包获取以 `rt_` 开头的 refresh_token。

**注意**：
- 💡 系统会自动识别 token 类型（xyhelper 或 OpenAI 原生）
- 💡 两种 token 都支持，无需手动选择刷新方式
- 💡 推荐使用 xyhelper 插件，更简单方便

### 批量导入

1. 准备 JSON 文件，格式如下：

```json
[
  {
    "access_token": "your_access_token",
    "refresh_token": "your_refresh_token",
    "id_token": "your_id_token",
    "account_id": "account_id",
    "email": "email@example.com",
    "name": "账号名称"
  }
]
```

2. 在管理后台的账号管理页面点击 **导入 JSON**
3. 选择文件或粘贴 JSON 内容
4. 预览后确认导入

### 手动添加

在管理后台的账号管理页面点击 **手动添加**，填写必要信息。

**必填字段**：
- `refresh_token` - 刷新令牌（支持 xyhelper 或 OpenAI 原生格式）
- `access_token` - 访问令牌（可选，系统会自动刷新获取）

**可选字段**：
- `email` - 账号邮箱
- `name` - 账号备注名称

**提示**：如果不知道如何获取 token，请参考上方的 [获取 Refresh Token](#获取-refresh-token) 部分。

### 自动刷新

服务会自动检测 token 是否过期，并在需要时自动刷新。

**刷新机制**：
- ✅ xyhelper token → 使用 xyhelper API 刷新
- ✅ OpenAI 原生 token (rt_) → 使用 OpenAI OAuth 刷新
- ✅ 自动识别，无需手动配置

## 环境变量配置

创建 `.env` 文件：

```env
# 服务端口
PORT=3000

# 会话密钥（生产环境请修改）
SESSION_SECRET=your-secret-key-change-in-production

# 负载均衡策略：round-robin（轮询）、random（随机）、least-used（最少使用）
LOAD_BALANCE_STRATEGY=round-robin

# 模型配置文件路径
MODELS_FILE=./models.json

# 重试配置
MAX_RETRIES=3
RETRY_DELAY_MS=1000
```

## 技术实现细节

### 请求转换流程

1. **参数过滤** - 自动过滤 Codex API 不支持的参数
   - 过滤：`temperature`, `top_p`, `top_k`, `max_tokens`, `max_completion_tokens`
   - 保留：`reasoning_effort`, `response_format`, `tools`, `tool_choice`

2. **消息格式转换**
   - `system` 角色 → `developer` 角色
   - `tool` 消息 → `function_call_output` 对象
   - `assistant` 的 `tool_calls` → 独立的 `function_call` 对象
   - 跳过只有 `tool_calls` 没有 `content` 的空 `assistant` 消息

3. **工具定义处理**
   - 扁平化：`{type: "function", function: {name, description, parameters}}` → `{type: "function", name, description, parameters}`
   - 缩短：超过 64 字符的工具名自动缩短（保留 `mcp__` 前缀和最后一段）
   - 唯一性：添加数字后缀确保缩短后的名称唯一

4. **Reasoning 配置验证**
   - 根据模型配置验证 `reasoning_effort` 是否在允许的 levels 中
   - 如果不在允许列表，使用默认值（第一个 level 或 'medium'）
   - 如果模型没有 thinking 配置，使用请求中的值或默认 'medium'

5. **客户端身份 Headers 透传**
   - `Originator` - 客户端来源标识（默认：`codex_cli_rs`）
   - `Version` - 客户端版本号（默认：空）
   - `X-Codex-Turn-Metadata` - 会话元数据（可选）
   - `X-Client-Request-Id` - 客户端请求 ID（可选）

6. **必需字段设置**
   - `stream`: 根据请求设置
   - `store`: 固定为 `false`
   - `parallel_tool_calls`: 固定为 `true`
   - `reasoning.effort`: 根据模型配置和请求验证后设置
   - `reasoning.summary`: 固定为 `auto`
   - `include`: 固定为 `["reasoning.encrypted_content"]`

### 响应转换流程

#### 流式响应事件处理

| Codex 事件 | OpenAI 事件 | 说明 |
|-----------|------------|------|
| `response.created` | - | 保存响应 ID 和创建时间 |
| `response.output_text.delta` | `delta.content` | 文本内容增量 |
| `response.reasoning_summary_text.delta` | `delta.reasoning_content` | 推理内容增量 |
| `response.reasoning_summary_text.done` | `delta.reasoning_content: "\n\n"` | 推理结束换行 |
| `response.output_item.added` | `delta.tool_calls[].function.name` | 工具调用开始 |
| `response.function_call_arguments.delta` | `delta.tool_calls[].function.arguments` | 工具参数增量 |
| `response.function_call_arguments.done` | - | 工具参数完成（回退） |
| `response.output_item.done` | `delta.tool_calls[]` | 工具调用完成（回退） |
| `response.completed` | `finish_reason` | 响应完成，设置正确的 finish_reason |

#### 非流式响应处理

1. 从 `response.output` 数组中提取：
   - `message` 类型 → `content`
   - `reasoning` 类型 → `reasoning_content`
   - `function_call` 类型 → `tool_calls[]`

2. 还原工具名称（从缩短名还原为原始名）

3. 设置 `finish_reason`：
   - 有工具调用 → `tool_calls`
   - 无工具调用 → `stop`

### 工具名称缩短算法

```javascript
// 缩短规则
if (name.length <= 64) return name;

// 保留 mcp__ 前缀和最后一段
if (name.startsWith('mcp__')) {
  const lastIdx = name.lastIndexOf('__');
  return 'mcp__' + name.substring(lastIdx + 2);
}

// 否则直接截断
return name.substring(0, 64);

// 确保唯一性：添加 _1, _2, _3 等后缀
```

## 项目结构

```
gpt2api-node/
├── src/
│   ├── index.js              # 主服务器文件
│   ├── tokenManager.js       # Token 管理模块
│   ├── proxyHandler.js       # 代理处理模块
│   ├── config/
│   │   └── database.js       # 数据库配置
│   ├── models/
│   │   └── index.js          # 数据模型
│   ├── routes/
│   │   ├── auth.js           # 认证路由
│   │   ├── apiKeys.js        # API Keys 路由
│   │   ├── tokens.js         # Tokens 路由
│   │   ├── stats.js          # 统计路由
│   │   └── settings.js       # 设置路由
│   ├── middleware/
│   │   └── auth.js           # 认证中间件
│   └── scripts/
│       └── initDatabase.js   # 数据库初始化脚本
├── public/
│   └── admin/                # 管理后台前端
│       ├── index.html
│       ├── login.html
│       └── js/
│           └── admin.js
├── database/
│   └── app.db                # SQLite 数据库
├── models.json               # 模型配置
├── package.json
└── README.md
```

## 注意事项

1. **安全性**: 
   - 首次登录后请立即修改管理员密码
   - 妥善保管 API Keys
   - 生产环境请使用 HTTPS

2. **网络要求**: 需要能够访问 `chatgpt.com` 和 `auth.openai.com`

3. **Token 有效期**: Token 会自动刷新，但如果 refresh_token 失效，需要重新获取

4. **并发限制**: 根据 OpenAI 账户限制，注意控制并发请求数量

## 故障排除

### 无法访问管理后台

确保服务已启动，访问 `http://localhost:3000/admin`

### 数据库初始化失败

删除 `database/app.db` 文件，重新运行 `npm run init-db`

### Token 刷新失败

可能是 refresh_token 已过期，需要重新导入新的 token

### API 请求返回 400 错误

1. 检查请求格式是否正确
2. 查看服务器日志中的详细错误信息
3. 确认使用的模型名称是否正确
4. 检查工具定义格式是否符合规范

### API 请求返回 401 错误

1. 检查 API Key 是否正确
2. 确认 API Key 是否已启用
3. 检查 Authorization 头格式：`Bearer YOUR_API_KEY`

### API 请求返回 500 错误

1. 确保有可用的 Token 账号
2. 检查 Token 是否已过期
3. 查看管理后台的请求日志
4. 检查服务器日志中的错误堆栈

### 工具调用不工作

1. 确认工具定义格式正确（使用 OpenAI 标准格式）
2. 检查工具名称长度（超过 64 字符会自动缩短）
3. 查看响应中的 `finish_reason` 是否为 `tool_calls`
4. 检查服务器日志中的转换过程

### 流式响应中断

1. 检查网络连接稳定性
2. 确认客户端正确处理 SSE 格式
3. 查看服务器日志中的错误信息
4. 检查 Token 是否在响应过程中过期

## 相关项目

- [lulistart/gpt2api-node](https://github.com/lulistart/gpt2api-node) - 原始项目
- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) - Go 语言实现的参考项目

## 更新日志

### v1.1.0 (2026-03-25)

**新功能**
- ✅ 支持客户端身份 headers 透传（Originator, Version, X-Codex-Turn-Metadata, X-Client-Request-Id）
- ✅ 支持每个模型独立的 Thinking 配置（reasoning effort levels）
- ✅ 更新 User-Agent 到 codex_cli_rs/0.116.0
- ✅ 自动验证 reasoning_effort 是否在模型允许的 levels 中

**改进**
- 🔧 优化请求 headers 构建逻辑，支持更灵活的客户端配置
- 🔧 改进模型配置加载机制，支持 thinking 配置
- 📝 更新文档，添加 Thinking 配置说明和使用示例

### v1.0.0

- ✅ 完整实现 OpenAI Chat Completions API 转换
- ✅ 完整实现 Codex Responses API 支持
- ✅ 支持所有流式响应事件类型
- ✅ 实现工具名称自动缩短和还原
- ✅ 支持工具调用（Function Calling）
- ✅ 支持推理内容（Reasoning Content）
- ✅ 支持结构化输出（JSON Schema）
- ✅ 自动参数过滤和格式转换
- ✅ 完整的错误处理和重试机制

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License

## 致谢

- 原项目：[lulistart/gpt2api-node](https://github.com/lulistart/gpt2api-node)
- 参考实现：[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
- 感谢所有贡献者的支持
