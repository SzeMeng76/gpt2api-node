import axios from 'axios';

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const CODEX_USER_AGENT = 'codex_cli_rs/0.116.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464';
const CODEX_ORIGINATOR = 'codex_cli_rs';

const RETRYABLE_STATUS = new Set([401, 402, 403, 429, 500, 502, 503, 504]);

/**
 * Proxy error with retryable flag
 */
export class ProxyError extends Error {
  constructor(message, status = 500, retryable = false) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

/**
 * 代理处理器
 */
class ProxyHandler {
  constructor(tokenManager, modelConfig = null) {
    this.tokenManager = tokenManager;
    this.modelConfig = modelConfig; // 模型配置（包含 thinking 支持信息）
  }

  /**
   * 生成会话 ID
   */
  generateSessionId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * 规范化工具类型名称
   */
  normalizeToolType(toolType) {
    // 将遗留的 web_search_preview 变体转换为稳定的 web_search
    if (toolType === 'web_search_preview' || toolType === 'web_search_preview_2025_03_11') {
      return 'web_search';
    }
    return toolType;
  }

  /**
   * 缩短工具名称（如果超过 64 字符）
   */
  shortenToolName(name) {
    const limit = 64;
    if (name.length <= limit) {
      return name;
    }

    // 如果是 mcp__ 前缀，保留前缀和最后一段
    if (name.startsWith('mcp__')) {
      const lastIdx = name.lastIndexOf('__');
      if (lastIdx > 0) {
        const candidate = 'mcp__' + name.substring(lastIdx + 2);
        if (candidate.length > limit) {
          return candidate.substring(0, limit);
        }
        return candidate;
      }
    }

    // 否则直接截断
    return name.substring(0, limit);
  }

  /**
   * 构建工具名称缩短映射表
   */
  buildToolNameMap(toolNames) {
    const limit = 64;
    const used = new Set();
    const map = {};

    const makeUnique = (candidate) => {
      if (!used.has(candidate)) {
        return candidate;
      }

      // 添加后缀确保唯一性
      let base = candidate;
      for (let i = 1; ; i++) {
        const suffix = '_' + i;
        const allowed = limit - suffix.length;
        let tmp = base;
        if (tmp.length > allowed) {
          tmp = tmp.substring(0, allowed);
        }
        tmp = tmp + suffix;
        if (!used.has(tmp)) {
          return tmp;
        }
      }
    };

    for (const name of toolNames) {
      const shortened = this.shortenToolName(name);
      const unique = makeUnique(shortened);
      used.add(unique);
      map[name] = unique;
    }

    return map;
  }

  /**
   * 构建反向工具名称映射（缩短名 -> 原始名）
   */
  buildReverseToolNameMap(toolNameMap) {
    const reverse = {};
    for (const [original, shortened] of Object.entries(toolNameMap)) {
      reverse[shortened] = original;
    }
    return reverse;
  }

  /**
   * 规范化 tools 数组
   */
  normalizeTools(tools) {
    if (!Array.isArray(tools)) return tools;

    return tools.map(tool => {
      if (tool && tool.type) {
        const normalizedType = this.normalizeToolType(tool.type);
        if (normalizedType !== tool.type) {
          console.log(`[Tool Normalization] ${tool.type} → ${normalizedType}`);
          return { ...tool, type: normalizedType };
        }
      }
      return tool;
    });
  }

  /**
   * 规范化 tool_choice
   */
  normalizeToolChoice(toolChoice) {
    if (!toolChoice || typeof toolChoice !== 'object') return toolChoice;

    const normalized = { ...toolChoice };

    // 规范化顶层 type
    if (normalized.type) {
      const normalizedType = this.normalizeToolType(normalized.type);
      if (normalizedType !== normalized.type) {
        console.log(`[Tool Choice Normalization] ${normalized.type} → ${normalizedType}`);
        normalized.type = normalizedType;
      }
    }

    // 规范化嵌套的 tools 数组
    if (Array.isArray(normalized.tools)) {
      normalized.tools = this.normalizeTools(normalized.tools);
    }

    return normalized;
  }

  /**
   * 转换 OpenAI 格式请求到 Codex 格式
   */
  transformRequest(openaiRequest) {
    const {
      model,
      messages,
      stream = true,
      stream_options,
      // 过滤掉 Codex 不支持的参数
      max_tokens,
      temperature,
      top_p,
      top_k,
      max_completion_tokens,
      reasoningSummary,
      verbosity,
      ...rest
    } = openaiRequest;

    // 构建工具名称缩短映射表
    let toolNameMap = {};
    if (rest.tools && Array.isArray(rest.tools)) {
      const toolNames = rest.tools
        .filter(t => {
          if (t.type !== 'function') return false;
          // 支持两种格式
          const name = t.function?.name || t.name;
          return typeof name === 'string';
        })
        .map(t => {
          // 支持两种格式
          const name = t.function?.name || t.name;
          return String(name);
        });
      if (toolNames.length > 0) {
        toolNameMap = this.buildToolNameMap(toolNames);
      }
    }

    // 转换消息格式 - 处理所有消息类型
    const input = [];

    for (const msg of messages) {
      const role = msg.role;

      // 处理 tool 角色消息 - 转为 function_call_output
      if (role === 'tool') {
        // 自动转换 tool_call_id 为字符串
        let callId = msg.tool_call_id != null ? String(msg.tool_call_id) : '';

        // 确保 call_id 以 call_ 开头（Codex 要求）
        if (callId && !callId.startsWith('call_')) {
          callId = 'call_' + callId;
        }

        input.push({
          type: 'function_call_output',
          call_id: callId,
          output: msg.content
        });
        continue;
      }

      // 处理普通消息
      const messageRole = role === 'system' ? 'developer' : role;
      const contentType = role === 'assistant' ? 'output_text' : 'input_text';

      const messageObj = {
        type: 'message',
        role: messageRole,
        content: []
      };

      // 处理消息内容
      if (msg.content) {
        if (Array.isArray(msg.content)) {
          for (const c of msg.content) {
            if (c.type === 'text') {
              messageObj.content.push({ type: contentType, text: c.text });
            } else if (c.type === 'image_url') {
              messageObj.content.push({
                type: 'input_image',
                image_url: c.image_url?.url || c.image_url
              });
            }
          }
        } else if (typeof msg.content === 'string' && msg.content !== '') {
          messageObj.content.push({ type: contentType, text: msg.content });
        }
      }

      // 只在有内容或者不是 assistant 时才添加消息对象
      // assistant 消息如果只有 tool_calls 没有 content，不添加空消息
      if (role !== 'assistant' || messageObj.content.length > 0) {
        input.push(messageObj);
      }

      // 处理 assistant 的 tool_calls - 转为独立的 function_call 对象
      if (role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.type === 'function') {
            // 自动转换 id 和 name 为字符串
            let callId = tc.id != null ? String(tc.id) : '';

            // 确保 call_id 以 call_ 开头（Codex 要求）
            if (callId && !callId.startsWith('call_')) {
              callId = 'call_' + callId;
            }

            const functionName = tc.function?.name != null ? String(tc.function.name) : '';

            if (!functionName) {
              throw new Error(`tool_calls[].function.name is required`);
            }

            const shortenedName = toolNameMap[functionName] || functionName;
            input.push({
              type: 'function_call',
              call_id: callId,
              name: shortenedName,
              arguments: tc.function.arguments
            });
          }
        }
      }
    }

    // 构建 Codex 请求 - 注意：Codex 不支持 temperature, top_p, max_tokens 等参数
    const codexRequest = {
      model: model || 'gpt-5.4',
      input,
      instructions: '',  // 保持为空字符串
      stream,
      store: false,  // 必须设置为 false
      parallel_tool_calls: true,
      include: ['reasoning.encrypted_content'],
      _toolNameMap: toolNameMap  // 保存映射表供响应转换使用
    };

    // 处理 reasoning - 根据模型配置验证和设置
    if (this.modelConfig?.thinking) {
      const thinkingConfig = this.modelConfig.thinking;
      const requestedEffort = rest.reasoning_effort || 'medium';

      // 验证 reasoning_effort 是否在允许的 levels 中
      if (thinkingConfig.levels && Array.isArray(thinkingConfig.levels)) {
        if (thinkingConfig.levels.includes(requestedEffort)) {
          codexRequest.reasoning = {
            effort: requestedEffort,
            summary: 'auto'
          };
        } else {
          // 使用默认值（第一个 level 或 'medium'）
          const defaultEffort = thinkingConfig.levels[0] || 'medium';
          codexRequest.reasoning = {
            effort: defaultEffort,
            summary: 'auto'
          };
          console.log(`[Reasoning] 请求的 effort "${requestedEffort}" 不在允许列表中，使用默认值 "${defaultEffort}"`);
        }
      }
    } else {
      // 模型没有 thinking 配置，使用默认行为
      codexRequest.reasoning = {
        effort: rest.reasoning_effort || 'medium',
        summary: 'auto'
      };
    }

    // 处理 tools - 需要扁平化 function 字段并缩短名称
    if (rest.tools !== undefined) {
      const normalizedTools = this.normalizeTools(rest.tools);
      codexRequest.tools = normalizedTools.map(tool => {
        if (tool.type === 'function') {
          // 支持两种格式：嵌套格式 (tool.function.name) 和扁平格式 (tool.name)
          let originalName, description, parameters, strict;

          if (tool.function) {
            // 嵌套格式：OpenAI 标准格式
            originalName = tool.function.name != null ? String(tool.function.name) : '';
            description = tool.function.description;
            parameters = tool.function.parameters;
            strict = tool.function.strict;
          } else {
            // 扁平格式：已经是 Codex 格式
            originalName = tool.name != null ? String(tool.name) : '';
            description = tool.description;
            parameters = tool.parameters;
            strict = tool.strict;
          }

          if (!originalName) {
            throw new Error(`tools[].function.name or tools[].name is required`);
          }

          const shortenedName = toolNameMap[originalName] || originalName;

          // 返回扁平化格式
          return {
            type: 'function',
            name: shortenedName,
            description: description,
            parameters: parameters,
            ...(strict !== undefined && { strict: strict })
          };
        }
        // 非 function 类型的工具直接传递
        return tool;
      });
    }
    // 传递 tool_choice（包括 "auto"）
    if (rest.tool_choice !== undefined) {
      if (typeof rest.tool_choice === 'string') {
        codexRequest.tool_choice = rest.tool_choice;
      } else if (rest.tool_choice.type === 'function' && rest.tool_choice.function) {
        // 自动转换 name 为字符串
        const originalName = rest.tool_choice.function.name != null ? String(rest.tool_choice.function.name) : '';

        if (!originalName) {
          throw new Error(`tool_choice.function.name is required`);
        }

        const shortenedName = toolNameMap[originalName] || originalName;
        // 扁平化 function tool_choice
        codexRequest.tool_choice = {
          type: 'function',
          name: shortenedName
        };
      } else {
        codexRequest.tool_choice = this.normalizeToolChoice(rest.tool_choice);
      }
    }

    // 处理 response_format 和 text.verbosity
    if (rest.response_format !== undefined) {
      const rf = rest.response_format;
      if (rf.type === 'text') {
        codexRequest.text = { format: { type: 'text' } };
      } else if (rf.type === 'json_schema' && rf.json_schema) {
        codexRequest.text = {
          format: {
            type: 'json_schema',
            name: rf.json_schema.name,
            strict: rf.json_schema.strict,
            schema: rf.json_schema.schema
          }
        };
      }

      // 如果有 text.verbosity，也要映射
      if (rest.text?.verbosity !== undefined) {
        if (!codexRequest.text) {
          codexRequest.text = {};
        }
        codexRequest.text.verbosity = rest.text.verbosity;
      }
    } else if (rest.text?.verbosity !== undefined) {
      // 只有 text.verbosity 没有 response_format 的情况
      codexRequest.text = {
        verbosity: rest.text.verbosity
      };
    }

    return codexRequest;
  }

  /**
   * 转换 Codex 响应到 OpenAI 格式
   */
  transformResponse(codexResponse, model, isStream = false, state = {}) {
    if (isStream) {
      // 流式响应处理
      const line = codexResponse.toString().trim();

      if (!line.startsWith('data:')) {
        return null;
      }

      const data = line.slice(5).trim();

      if (data === '[DONE]') {
        return 'data: [DONE]\n\n';
      }

      try {
        const parsed = JSON.parse(data);

        // 初始化状态
        if (!state.functionCallIndex) {
          state.functionCallIndex = -1;
          state.hasReceivedArgumentsDelta = false;
          state.hasToolCallAnnounced = false;
        }

        // 保存响应 ID 和创建时间
        if (parsed.type === 'response.created') {
          state.responseId = parsed.response?.id;
          state.createdAt = parsed.response?.created_at || Math.floor(Date.now() / 1000);
          state.model = parsed.response?.model || model;
          return null;
        }

        const responseId = state.responseId || 'chatcmpl-' + Date.now();
        const createdAt = state.createdAt || Math.floor(Date.now() / 1000);
        const modelName = state.model || model;

        // 处理不同类型的事件
        if (parsed.type === 'response.output_text.delta') {
          // 文本增量更新
          return `data: ${JSON.stringify({
            id: responseId,
            object: 'chat.completion.chunk',
            created: createdAt,
            model: modelName,
            choices: [{
              index: 0,
              delta: { role: 'assistant', content: parsed.delta || '' },
              finish_reason: null
            }]
          })}\n\n`;
        } else if (parsed.type === 'response.reasoning_summary_text.delta') {
          // 推理内容增量
          return `data: ${JSON.stringify({
            id: responseId,
            object: 'chat.completion.chunk',
            created: createdAt,
            model: modelName,
            choices: [{
              index: 0,
              delta: { role: 'assistant', reasoning_content: parsed.delta || '' },
              finish_reason: null
            }]
          })}\n\n`;
        } else if (parsed.type === 'response.reasoning_summary_text.done') {
          // 推理摘要结束 - 添加换行
          return `data: ${JSON.stringify({
            id: responseId,
            object: 'chat.completion.chunk',
            created: createdAt,
            model: modelName,
            choices: [{
              index: 0,
              delta: { role: 'assistant', reasoning_content: '\n\n' },
              finish_reason: null
            }]
          })}\n\n`;
        } else if (parsed.type === 'response.output_item.added') {
          // 工具调用开始
          const item = parsed.item;
          if (!item || item.type !== 'function_call') {
            return null;
          }

          state.functionCallIndex++;
          state.hasReceivedArgumentsDelta = false;
          state.hasToolCallAnnounced = true;

          // 还原工具名称
          const reverseMap = this.buildReverseToolNameMap(state.toolNameMap || {});
          const originalName = reverseMap[item.name] || item.name;

          // 确保 call_id 是字符串
          const callId = item.call_id != null ? String(item.call_id) : '';

          return `data: ${JSON.stringify({
            id: responseId,
            object: 'chat.completion.chunk',
            created: createdAt,
            model: modelName,
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: state.functionCallIndex,
                  id: callId,
                  type: 'function',
                  function: {
                    name: originalName,
                    arguments: ''
                  }
                }]
              },
              finish_reason: null
            }]
          })}\n\n`;
        } else if (parsed.type === 'response.function_call_arguments.delta') {
          // 工具调用参数增量
          state.hasReceivedArgumentsDelta = true;

          return `data: ${JSON.stringify({
            id: responseId,
            object: 'chat.completion.chunk',
            created: createdAt,
            model: modelName,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: state.functionCallIndex,
                  function: {
                    arguments: parsed.delta || ''
                  }
                }]
              },
              finish_reason: null
            }]
          })}\n\n`;
        } else if (parsed.type === 'response.function_call_arguments.done') {
          // 工具调用参数完成
          if (state.hasReceivedArgumentsDelta) {
            // 参数已经通过 delta 事件发送，跳过
            return null;
          }

          // 回退：没有收到 delta 事件，一次性发送完整参数
          return `data: ${JSON.stringify({
            id: responseId,
            object: 'chat.completion.chunk',
            created: createdAt,
            model: modelName,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: state.functionCallIndex,
                  function: {
                    arguments: parsed.arguments || ''
                  }
                }]
              },
              finish_reason: null
            }]
          })}\n\n`;
        } else if (parsed.type === 'response.output_item.done') {
          // 工具调用完成
          const item = parsed.item;
          if (!item || item.type !== 'function_call') {
            return null;
          }

          if (state.hasToolCallAnnounced) {
            // 工具调用已经通过 output_item.added 宣布，跳过
            state.hasToolCallAnnounced = false;
            return null;
          }

          // 回退：模型跳过了 output_item.added，现在发送完整工具调用
          state.functionCallIndex++;

          // 还原工具名称
          const reverseMap = this.buildReverseToolNameMap(state.toolNameMap || {});
          const originalName = reverseMap[item.name] || item.name;

          // 确保 call_id 是字符串
          const callId = item.call_id != null ? String(item.call_id) : '';

          return `data: ${JSON.stringify({
            id: responseId,
            object: 'chat.completion.chunk',
            created: createdAt,
            model: modelName,
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: state.functionCallIndex,
                  id: callId,
                  type: 'function',
                  function: {
                    name: originalName,
                    arguments: item.arguments || ''
                  }
                }]
              },
              finish_reason: null
            }]
          })}\n\n`;
        } else if (parsed.type === 'response.completed') {
          // 响应完成
          const usage = parsed.response?.usage || {};
          const finishReason = state.functionCallIndex !== -1 ? 'tool_calls' : 'stop';

          return `data: ${JSON.stringify({
            id: responseId,
            object: 'chat.completion.chunk',
            created: createdAt,
            model: modelName,
            choices: [{
              index: 0,
              delta: {},
              finish_reason: finishReason
            }],
            usage: {
              prompt_tokens: usage.input_tokens || 0,
              completion_tokens: usage.output_tokens || 0,
              total_tokens: usage.total_tokens || 0
            }
          })}\n\n`;
        }
      } catch (e) {
        // 忽略 JSON 解析错误，可能是不完整的数据
        return null;
      }

      return null;
    } else {
      // 非流式响应处理
      try {
        const parsed = typeof codexResponse === 'string'
          ? JSON.parse(codexResponse)
          : codexResponse;

        const response = parsed.response || {};
        const output = response.output || [];

        // 提取消息内容和推理内容
        let content = '';
        let reasoningContent = '';
        const toolCalls = [];

        for (const item of output) {
          if (item.type === 'message' && item.content) {
            for (const part of item.content) {
              if (part.type === 'output_text') {
                content += part.text || '';
              }
            }
          } else if (item.type === 'reasoning' && item.summary) {
            // 提取推理摘要
            for (const summaryItem of item.summary) {
              if (summaryItem.type === 'summary_text') {
                reasoningContent += summaryItem.text || '';
              }
            }
          } else if (item.type === 'function_call') {
            // 处理工具调用 - 还原工具名称
            const reverseMap = this.buildReverseToolNameMap(state.toolNameMap || {});
            const originalName = reverseMap[item.name] || item.name;

            // 确保 call_id 是字符串
            const callId = item.call_id != null ? String(item.call_id) : '';

            toolCalls.push({
              id: callId,
              type: 'function',
              function: {
                name: originalName,
                arguments: item.arguments || ''
              }
            });
          }
        }

        const usage = response.usage || {};
        const message = { role: 'assistant', content: content };

        // 添加推理内容（如果有）
        if (reasoningContent) {
          message.reasoning_content = reasoningContent;
        }

        // 添加工具调用（如果有）
        if (toolCalls.length > 0) {
          message.tool_calls = toolCalls;
        }

        // 根据是否有工具调用决定 finish_reason
        const finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop';

        return {
          id: response.id || 'chatcmpl-' + Date.now(),
          object: 'chat.completion',
          created: response.created_at || Math.floor(Date.now() / 1000),
          model: response.model || model,
          choices: [{
            index: 0,
            message,
            finish_reason: finishReason
          }],
          usage: {
            prompt_tokens: usage.input_tokens || 0,
            completion_tokens: usage.output_tokens || 0,
            total_tokens: usage.total_tokens || 0
          }
        };
      } catch (e) {
        throw new Error(`转换响应失败: ${e.message}`);
      }
    }
  }

  /**
   * 构建请求 headers（支持透传客户端身份 headers）
   */
  buildRequestHeaders(req, accessToken) {
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': CODEX_USER_AGENT,
      'Openai-Beta': 'responses=experimental',
      'Session_id': this.generateSessionId()
    };

    // 透传客户端身份 headers（如果客户端提供）
    const clientHeaders = req.headers || {};

    // Version - 透传客户端版本，如果没有则留空
    headers['Version'] = clientHeaders['version'] || '';

    // Originator - 透传客户端来源，如果没有则使用默认值
    headers['Originator'] = clientHeaders['originator'] || CODEX_ORIGINATOR;

    // X-Codex-Turn-Metadata - 透传
    if (clientHeaders['x-codex-turn-metadata']) {
      headers['X-Codex-Turn-Metadata'] = clientHeaders['x-codex-turn-metadata'];
    }

    // X-Client-Request-Id - 透传
    if (clientHeaders['x-client-request-id']) {
      headers['X-Client-Request-Id'] = clientHeaders['x-client-request-id'];
    }

    return headers;
  }

  /**
   * 处理流式请求
   */
  async handleStreamRequest(req, res) {
    try {
      const openaiRequest = req.body;
      console.log('收到请求:', JSON.stringify(openaiRequest, null, 2));

      const codexRequest = this.transformRequest(openaiRequest);
      const toolNameMap = codexRequest._toolNameMap || {};
      delete codexRequest._toolNameMap;  // 删除内部字段，不发送给 Codex

      console.log('转换后的 Codex 请求:', JSON.stringify(codexRequest, null, 2));

      const accessToken = await this.tokenManager.getValidToken();

      // 设置响应头
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // 构建请求 headers（支持透传客户端身份）
      const headers = this.buildRequestHeaders(req, accessToken);
      headers['Accept'] = 'text/event-stream';

      const response = await axios.post(
        `${CODEX_BASE_URL}/responses`,
        codexRequest,
        {
          headers,
          responseType: 'stream',
          timeout: 300000 // 5 分钟超时
        }
      );

      // 处理流式响应
      let buffer = '';
      const state = { toolNameMap }; // 用于保存响应 ID、创建时间和工具名称映射

      return new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');

          // 保留最后一行（可能不完整）
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim()) {
              // 捕获 usage 数据
              if (line.includes('response.completed')) {
                try {
                  const data = line.trim().startsWith('data:') ? line.slice(5).trim() : line;
                  const parsed = JSON.parse(data);
                  if (parsed.type === 'response.completed') {
                    const u = parsed.response?.usage || {};
                    state.usage = {
                      input_tokens: u.input_tokens || 0,
                      output_tokens: u.output_tokens || 0,
                      total_tokens: u.total_tokens || 0
                    };
                  }
                } catch (e) {}
              }
              const transformed = this.transformResponse(line, openaiRequest.model, true, state);
              if (transformed) {
                res.write(transformed);
              }
            }
          }
        });

        response.data.on('end', () => {
          // 处理缓冲区中剩余的数据
          if (buffer.trim()) {
            const transformed = this.transformResponse(buffer, openaiRequest.model, true, state);
            if (transformed) {
              res.write(transformed);
            }
          }
          res.write('data: [DONE]\n\n');
          res.end();
          resolve(state.usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 });
        });

        response.data.on('error', (error) => {
          console.error('流式响应错误:', error.message);
          res.end();
          reject(new ProxyError(error.message, 500, true));
        });
      });

    } catch (error) {
      const status = error.response?.status || 500;
      const message = error.response?.data?.error?.message || error.message;
      const retryable = RETRYABLE_STATUS.has(status);
      console.error(`代理请求失败 [${status}${retryable ? ' retryable' : ''}]: ${message}`);
      throw new ProxyError(message, status, retryable);
    }
  }

  /**
   * 处理非流式请求
   */
  async handleNonStreamRequest(req, res) {
    try {
      const openaiRequest = req.body;
      console.log('收到非流式请求:', JSON.stringify(openaiRequest, null, 2));

      const codexRequest = this.transformRequest({ ...openaiRequest, stream: true });
      const toolNameMap = codexRequest._toolNameMap || {};
      delete codexRequest._toolNameMap;  // 删除内部字段，不发送给 Codex

      console.log('转换后的 Codex 请求:', JSON.stringify(codexRequest, null, 2));

      const accessToken = await this.tokenManager.getValidToken();

      const response = await axios.post(
        `${CODEX_BASE_URL}/responses`,
        codexRequest,
        {
          headers: this.buildRequestHeaders(req, accessToken),
          responseType: 'stream',
          timeout: 300000
        }
      );

      // 处理流式响应数据 - 查找 response.completed 事件
      let finalResponse = null;
      let buffer = '';

      return new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim().startsWith('data:')) {
              const data = line.slice(5).trim();
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'response.completed') {
                  finalResponse = parsed;
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          }
        });

        response.data.on('end', () => {
          if (!finalResponse) {
            reject(new Error('未收到完整响应'));
            return;
          }

          // 转换为 OpenAI 格式，传递工具名称映射
          const transformed = this.transformResponse(finalResponse, openaiRequest.model, false, { toolNameMap });
          res.json(transformed);

          // 返回 usage 数据
          const u = finalResponse.response?.usage || {};
          resolve({
            input_tokens: u.input_tokens || 0,
            output_tokens: u.output_tokens || 0,
            total_tokens: u.total_tokens || 0
          });
        });

        response.data.on('error', (error) => {
          reject(new ProxyError(error.message, 500, true));
        });
      });

    } catch (error) {
      const status = error.response?.status || 500;
      const message = error.response?.data?.error?.message || error.message;
      const retryable = RETRYABLE_STATUS.has(status);
      console.error(`代理请求失败 [${status}${retryable ? ' retryable' : ''}]: ${message}`);
      throw new ProxyError(message, status, retryable);
    }
  }

  /**
   * 直通转发 /v1/responses — 供 Codex CLI 直接接入，做最小转换
   */
  async handlePassthrough(req, res) {
    try {
      const accessToken = await this.tokenManager.getValidToken();

      // 构建请求体，删除 Codex 不支持的参数
      const {
        max_output_tokens,
        max_completion_tokens,
        temperature,
        top_p,
        truncation,
        context_management,
        user,
        service_tier,
        ...rest
      } = req.body;

      const requestBody = {
        instructions: rest.instructions || '',
        store: false,
        parallel_tool_calls: true,
        include: ['reasoning.encrypted_content'],
        ...rest
      };

      // 只保留 service_tier 如果是 "priority"
      if (service_tier === 'priority') {
        requestBody.service_tier = service_tier;
      }

      // 转换 input 中的 system role 为 developer
      if (Array.isArray(requestBody.input)) {
        requestBody.input = requestBody.input.map(item => {
          if (item.type === 'message' && item.role === 'system') {
            return { ...item, role: 'developer' };
          }
          return item;
        });
      }

      // 规范化工具类型
      if (requestBody.tools) {
        requestBody.tools = this.normalizeTools(requestBody.tools);
      }
      if (requestBody.tool_choice) {
        requestBody.tool_choice = this.normalizeToolChoice(requestBody.tool_choice);
      }

      const clientWantsStream = req.body.stream !== false;

      const headers = this.buildRequestHeaders(req, accessToken);
      headers['Accept'] = 'text/event-stream';

      console.log('[Passthrough] Request body:', JSON.stringify(requestBody).slice(0, 500));

      const response = await axios.post(
        `${CODEX_BASE_URL}/responses`,
        requestBody,
        { headers, responseType: 'stream', timeout: 300000 }
      );

      let usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

      if (clientWantsStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
      }

      return new Promise((resolve, reject) => {
        let buffer = '';

        response.data.on('data', (chunk) => {
          const text = chunk.toString();
          if (clientWantsStream) {
            res.write(text);
          }
          buffer += text;

          // Process complete lines from buffer for usage/non-stream response
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim().startsWith('data:')) continue;
            try {
              const parsed = JSON.parse(line.slice(5).trim());
              if (parsed.type === 'response.completed') {
                const u = parsed.response?.usage || {};
                usage = {
                  input_tokens: u.input_tokens || 0,
                  output_tokens: u.output_tokens || 0,
                  total_tokens: u.total_tokens || 0
                };
                if (!clientWantsStream && !res.headersSent) {
                  res.json(parsed);
                }
              }
            } catch (e) {}
          }
        });

        response.data.on('end', () => {
          if (clientWantsStream) {
            res.end();
          } else if (!res.headersSent) {
            // Fallback: if no response.completed found
            res.status(500).json({ error: { message: 'No completed response received' } });
          }
          resolve(usage);
        });

        response.data.on('error', (error) => {
          res.end();
          reject(new ProxyError(error.message, 500, true));
        });
      });

    } catch (error) {
      const status = error.response?.status || 500;
      const retryable = RETRYABLE_STATUS.has(status);

      // When responseType is 'stream', error.response.data is a stream — read it
      if (error.response?.data && typeof error.response.data.on === 'function') {
        return new Promise((_, reject) => {
          let body = '';
          error.response.data.on('data', (chunk) => { body += chunk.toString(); });
          error.response.data.on('end', () => {
            let message = error.message;
            try {
              const parsed = JSON.parse(body);
              message = parsed.error?.message || parsed.message || body;
            } catch (e) {
              message = body || error.message;
            }
            console.error(`代理请求失败 [${status}${retryable ? ' retryable' : ''}]: ${message}`);
            reject(new ProxyError(message, status, retryable));
          });
          error.response.data.on('error', () => reject(new ProxyError(error.message, status, retryable)));
        });
      }

      const message = error.response?.data?.error?.message || error.message;
      console.error(`代理请求失败 [${status}${retryable ? ' retryable' : ''}]: ${message}`);
      throw new ProxyError(message, status, retryable);
    }
  }
}

export default ProxyHandler;
