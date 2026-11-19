/**
 * 多提供商网关：把 OpenAI Chat Completions 与 Anthropic Messages 两种协议
 * 统一为应用内部的 MessageStreamEvent 事件流（以 Anthropic 事件为规范格式）。
 * 支持模型级参数（思考/强度/最大输出/上下文裁剪）与客户端联网搜索工具循环。
 * 请求只发往用户配置的提供商 baseUrl 与搜索服务地址，不经过任何中间服务。
 */
import type { ModelSettings, Provider, SearchProvider } from '../providers/store.js'
import { executeSearch, type SearchHit } from '../search/execute.js'
import { ApiError, request } from './client.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'
import type {
  MessageParam,
  MessageStreamEvent,
  MessageUsage,
  StopReason,
  WebSearchResult,
} from './types.js'

const joinUrl = (base: string, path: string) => `${base.replace(/\/+$/, '')}${path}`

/** dataURL 转 Blob（部分 WebView 不支持 fetch(data:)） */
const dataUrlToBlob = (dataUrl: string): Blob => {
  const comma = dataUrl.indexOf(',')
  const meta = dataUrl.slice(0, comma)
  const mime = /data:([^;]+)/.exec(meta)?.[1] ?? 'image/png'
  const binary = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mime })
}

/** 超时信号合并（旧内核无 AbortSignal.any 时降级为原信号） */
const withTimeout = (signal: AbortSignal, ms: number): AbortSignal => {
  const timeout = AbortSignal.timeout?.(ms)
  return timeout && AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal
}

const authHeaders = (provider: Provider): Record<string, string> =>
  provider.protocol === 'anthropic'
    ? {
        'x-api-key': provider.apiKey,
        Authorization: `Bearer ${provider.apiKey}`,
        'anthropic-version': '2023-06-01',
        // 允许浏览器/WebView 直连（Anthropic 官方端点要求）
        'anthropic-dangerous-direct-browser-access': 'true',
      }
    : { Authorization: `Bearer ${provider.apiKey}` }

/** GET /models 拉取模型列表；返回模型 ID 数组（OpenAI 与 Anthropic 两种响应格式都兼容） */
export const fetchModels = async (
  provider: Provider,
  signal?: AbortSignal
): Promise<string[]> => {
  const response = await request(joinUrl(provider.baseUrl, '/models'), {
    method: 'GET',
    headers: authHeaders(provider),
    signal,
  })
  const body: unknown = await response.json()
  const data = (body as { data?: unknown }).data
  if (!Array.isArray(data)) {
    return []
  }
  return data
    .map((item) =>
      typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string'
        ? (item as { id: string }).id
        : ''
    )
    .filter(Boolean)
}

/** 测试连接：优先 GET /models（不产生费用），不支持时发一条最小聊天请求 */
export const testProvider = async (provider: Provider, signal?: AbortSignal): Promise<void> => {
  if (provider.supportsModelList) {
    await fetchModels(provider, signal)
    return
  }
  const model = provider.models[0]
  if (!model) {
    throw new ApiError('protocol', 'no model configured')
  }
  const events = streamChat(
    provider,
    { model, system: '', messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 },
    signal ?? new AbortController().signal
  )
  for await (const event of events) {
    if (event.type === 'message_stop') {
      return
    }
  }
}

// ---------- 内部请求 ----------

export type GatewayRequest = {
  model: string
  system: string
  messages: MessageParam[]
  /** 深度思考开关；按提供商 thinkingStyle 与模型能力转成对应字段 */
  thinking?: boolean
  maxTokens?: number
  temperature?: number
  /** 模型级能力配置 */
  settings?: ModelSettings
  /** 启用客户端联网搜索 */
  search?: { provider: SearchProvider }
}

const usage = (input: number, output: number): MessageUsage => ({
  input_tokens: input,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: output,
})

const readErrorBody = async (response: Response): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  try {
    const body = JSON.parse(text) as { error?: { message?: string } }
    if (body.error?.message) {
      return new ApiError('protocol', body.error.message, response.status)
    }
  } catch {
    // 保持原文
  }
  return new ApiError('protocol', text || response.statusText, response.status)
}

const thinkingFields = (
  provider: Provider,
  enabled: boolean,
  settings?: ModelSettings
): Record<string, unknown> => {
  if (!enabled || (settings && !settings.thinking)) {
    return {}
  }
  switch (settings?.thinkingStyle || provider.thinkingStyle) {
    case 'reasoning_effort':
      return { reasoning_effort: settings?.effort ?? 'medium' }
    case 'deepseek':
    case 'glm':
    case 'kimi':
      return { thinking: { type: 'enabled' } }
    case 'enable_thinking':
      return { enable_thinking: true }
    default:
      return {}
  }
}

const openAiStopReason = (reason: unknown): StopReason =>
  reason === 'length'
    ? 'max_tokens'
    : reason === 'content_filter'
      ? 'refusal'
      : reason === 'tool_calls'
        ? 'tool_use'
        : 'end_turn'

// ---------- OpenAI 协议 ----------

type OpenAiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type OpenAiToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type OpenAiMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | OpenAiContentPart[] | null
  tool_calls?: OpenAiToolCall[]
  tool_call_id?: string
}

const toOpenAiMessages = (system: string, messages: MessageParam[]): OpenAiMessage[] => {
  const result: OpenAiMessage[] = []
  if (system.trim()) {
    result.push({ role: 'system', content: system })
  }
  for (const message of messages) {
    if (typeof message.content === 'string') {
      result.push({ role: message.role, content: message.content })
      continue
    }
    const parts: OpenAiContentPart[] = []
    let text = ''
    const flushText = () => {
      if (text) {
        parts.push({ type: 'text', text })
        text = ''
      }
    }
    for (const block of message.content) {
      if (block.type === 'text') {
        text += block.text
      } else if (block.type === 'image' && block.source.type === 'base64') {
        flushText()
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
        })
      } else if (block.type === 'document' && block.source.type === 'text') {
        text += `\n\n${block.source.data}`
      }
    }
    flushText()
    if (parts.length === 0) {
      continue
    }
    result.push({
      role: message.role,
      content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts,
    })
  }
  return result
}

const WEB_SEARCH_TOOL_OPENAI = {
  type: 'function',
  function: {
    name: 'web_search',
    description: '搜索互联网获取实时信息。当问题涉及最新事件、实时数据或需要外部知识时调用。',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: '搜索关键词' } },
      required: ['query'],
    },
  },
}

type OpenAiRound = {
  events: MessageStreamEvent[]
  toolCalls: OpenAiToolCall[]
  assistantText: string
  stopReason: StopReason
  usage?: MessageUsage
}

/** 单轮 OpenAI 请求：收集事件与工具调用，不产出 message_delta/message_stop */
async function openAiRound(
  provider: Provider,
  body: GatewayRequest,
  messages: OpenAiMessage[],
  withTools: boolean,
  indexOffset: number,
  signal: AbortSignal
): Promise<OpenAiRound> {
  const response = await request(joinUrl(provider.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      ...authHeaders(provider),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model: body.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(body.maxTokens !== undefined ? { max_tokens: body.maxTokens } : {}),
      ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
      ...thinkingFields(provider, body.thinking ?? false, body.settings),
      ...(withTools ? { tools: [WEB_SEARCH_TOOL_OPENAI], tool_choice: 'auto' } : {}),
    }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body) {
    throw await readErrorBody(response)
  }

  const events: MessageStreamEvent[] = []
  let textOpen = false
  let thinkOpen = false
  let index = indexOffset
  let stopReason: StopReason = 'end_turn'
  let finalUsage: MessageUsage | undefined
  let assistantText = ''
  const toolAcc = new Map<number, { id: string; name: string; args: string }>()

  const closeBlock = () => {
    if (textOpen || thinkOpen) {
      events.push({ type: 'content_block_stop', index })
      textOpen = false
      thinkOpen = false
      index += 1
    }
  }

  if (!contentType.includes('text/event-stream')) {
    // 非流式兜底
    const payload = (await response.json()) as Record<string, unknown>
    const error = payload.error as { message?: unknown } | undefined
    if (error && typeof error.message === 'string') {
      throw new ApiError('http', error.message)
    }
    const choices = payload.choices
    const choice = Array.isArray(choices)
      ? (choices[0] as Record<string, unknown> | undefined)
      : undefined
    const message = choice?.message as Record<string, unknown> | undefined
    const content = typeof message?.content === 'string' ? message.content : ''
    const reasoning =
      typeof message?.reasoning_content === 'string'
        ? message.reasoning_content
        : typeof message?.reasoning === 'string'
          ? message.reasoning
          : ''
    if (reasoning) {
      events.push({
        type: 'content_block_start',
        index,
        content_block: { type: 'thinking', thinking: reasoning, signature: '' },
      })
      events.push({ type: 'content_block_stop', index })
      index += 1
    }
    if (content) {
      assistantText = content
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: content } })
      events.push({ type: 'content_block_stop', index })
      index += 1
    }
    const rawCalls = message?.tool_calls
    const toolCalls = (Array.isArray(rawCalls) ? (rawCalls as OpenAiToolCall[]) : []).filter(
      (call) => typeof call?.id === 'string' && typeof call?.function?.name === 'string'
    )
    const usageRecord = payload.usage as Record<string, unknown> | undefined
    return {
      events,
      toolCalls,
      assistantText,
      stopReason: openAiStopReason(choice?.finish_reason),
      usage:
        usageRecord && typeof usageRecord.prompt_tokens === 'number'
          ? usage(
              usageRecord.prompt_tokens,
              typeof usageRecord.completion_tokens === 'number'
                ? usageRecord.completion_tokens
                : 0
            )
          : undefined,
    }
  }

  for await (const { data } of readServerSentEvents(response.body, signal)) {
    if (data.trim() === '[DONE]') {
      break
    }
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      continue
    }
    if (typeof payload !== 'object' || payload === null) {
      continue
    }
    const record = payload as Record<string, unknown>
    const error = record.error as { message?: unknown } | undefined
    if (error && typeof error.message === 'string') {
      throw new ApiError('stream', error.message)
    }
    const choices = record.choices
    const choice = Array.isArray(choices)
      ? (choices[0] as Record<string, unknown> | undefined)
      : undefined
    const delta = choice?.delta as Record<string, unknown> | undefined
    const reasoning = delta?.reasoning_content ?? delta?.reasoning
    if (typeof reasoning === 'string' && reasoning) {
      if (!thinkOpen) {
        closeBlock()
        thinkOpen = true
        events.push({
          type: 'content_block_start',
          index,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        })
      }
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'thinking_delta', thinking: reasoning },
      })
    }
    const content = delta?.content
    if (typeof content === 'string' && content) {
      if (!textOpen) {
        closeBlock()
        textOpen = true
        events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
      }
      assistantText += content
      events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: content } })
    }
    const rawToolDeltas = delta?.tool_calls
    if (Array.isArray(rawToolDeltas)) {
      for (const item of rawToolDeltas as Record<string, unknown>[]) {
        const i = typeof item.index === 'number' ? item.index : 0
        const acc = toolAcc.get(i) ?? { id: '', name: '', args: '' }
        if (typeof item.id === 'string') {
          acc.id = item.id
        }
        const fn = item.function as Record<string, unknown> | undefined
        if (fn) {
          if (typeof fn.name === 'string') {
            acc.name += fn.name
          }
          if (typeof fn.arguments === 'string') {
            acc.args += fn.arguments
          }
        }
        toolAcc.set(i, acc)
      }
    }
    if (choice?.finish_reason != null) {
      stopReason = openAiStopReason(choice.finish_reason)
    }
    const usageRecord = record.usage as Record<string, unknown> | undefined
    if (usageRecord && typeof usageRecord.prompt_tokens === 'number') {
      finalUsage = usage(
        usageRecord.prompt_tokens,
        typeof usageRecord.completion_tokens === 'number' ? usageRecord.completion_tokens : 0
      )
    }
  }
  closeBlock()
  const toolCalls = [...toolAcc.values()]
    .filter((acc) => acc.id && acc.name)
    .map((acc) => ({
      id: acc.id,
      type: 'function' as const,
      function: { name: acc.name, arguments: acc.args },
    }))
  return { events, toolCalls, assistantText, stopReason, usage: finalUsage }
}

const hitsToResults = (hits: SearchHit[]): WebSearchResult[] =>
  hits.map((hit) => ({
    type: 'web_search_result',
    title: hit.title,
    url: hit.url,
    snippet: hit.snippet,
    site_icon: hit.site_icon,
    site_name: hit.site_name,
    encrypted_content: '',
    page_age: hit.page_age,
  }))

async function* streamOpenAi(
  provider: Provider,
  body: GatewayRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const messages = toOpenAiMessages(body.system, body.messages)
  yield { type: 'message_start', message: { id: '', model: body.model } }
  let index = 0
  let toolUseCount = 0
  let lastUsage: MessageUsage | undefined
  let stopReason: StopReason = 'end_turn'
  const maxRounds = body.search ? 6 : 1
  for (let round = 0; round < maxRounds; round++) {
    // 最后一轮撤掉工具，强制模型基于已有搜索结果输出最终回答，避免只思考不正文
    const withTools = Boolean(body.search) && round < maxRounds - 1
    const roundBody = withTools
      ? body
      : {
          ...body,
          system: [
            body.system,
            '你已经完成资料检索。现在必须直接输出给用户的最终回答正文，用中文、条理清晰并引用来源；不要再调用任何工具，也不要只输出思考过程。',
          ]
            .filter(Boolean)
            .join('\n\n'),
        }
    const result = await openAiRound(provider, roundBody, messages, withTools, index, signal)
    for (const event of result.events) {
      yield event
      if (event.type === 'content_block_stop') {
        index = event.index + 1
      }
    }
    lastUsage = result.usage ?? lastUsage
    stopReason = result.stopReason
    if (!withTools || result.toolCalls.length === 0 || !body.search) {
      break
    }
    messages.push({
      role: 'assistant',
      content: result.assistantText || null,
      tool_calls: result.toolCalls,
    })
    for (const call of result.toolCalls) {
      toolUseCount += 1
      const toolId = `srvtoolu_search_${toolUseCount}`
      let query = ''
      try {
        const args = JSON.parse(call.function.arguments || '{}') as { query?: unknown }
        query = typeof args.query === 'string' ? args.query : ''
      } catch {
        query = ''
      }
      yield {
        type: 'content_block_start',
        index,
        content_block: {
          type: 'server_tool_use',
          id: toolId,
          name: 'web_search',
          input: { action: 'search', queries: query ? [query] : [] },
          caller: { type: 'direct' },
          kind: 'search',
        },
      }
      yield { type: 'content_block_stop', index }
      index += 1
      let hits: SearchHit[] = []
      let failed = false
      try {
        hits = await executeSearch(body.search.provider, query, signal)
      } catch {
        failed = true
      }
      yield {
        type: 'content_block_start',
        index,
        content_block: {
          type: 'web_search_tool_result',
          tool_use_id: toolId,
          content: failed
            ? [{ type: 'web_search_tool_result_error', error_code: 'unavailable' }]
            : hitsToResults(hits),
          kind: 'search',
        },
      }
      yield { type: 'content_block_stop', index }
      index += 1
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(
          hits.map((hit) => ({ title: hit.title, url: hit.url, snippet: hit.snippet }))
        ),
      })
    }
  }
  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReason === 'tool_use' ? 'end_turn' : stopReason, stop_sequence: null },
    usage: lastUsage,
  }
  yield { type: 'message_stop' }
}

// ---------- Anthropic 协议 ----------

const toAnthropicBody = (
  provider: Provider,
  body: GatewayRequest,
  messages: unknown[],
  withTools: boolean
): Record<string, unknown> => {
  const thinkingEnabled =
    provider.thinkingStyle === 'anthropic' && body.thinking && (body.settings?.thinking ?? true)
  const thinking = thinkingEnabled ? { type: 'enabled', budget_tokens: 4096 } : undefined
  return {
    model: body.model,
    ...(body.system.trim() ? { system: body.system } : {}),
    messages,
    max_tokens: Math.max(body.maxTokens ?? 4096, thinking ? 8192 : 0),
    ...(thinking ? { thinking } : {}),
    ...(body.temperature !== undefined && !thinking ? { temperature: body.temperature } : {}),
    ...(withTools
      ? { tools: [{ name: 'web_search', description: '搜索互联网获取实时信息', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }] }
      : {}),
    stream: true,
  }
}

type AnthropicRound = {
  events: MessageStreamEvent[]
  toolUses: { id: string; name: string; input: unknown }[]
  assistantContent: unknown[]
  stopReason: StopReason
  usage?: MessageUsage
}

async function anthropicRound(
  provider: Provider,
  body: GatewayRequest,
  messages: unknown[],
  withTools: boolean,
  signal: AbortSignal
): Promise<AnthropicRound> {
  const response = await request(joinUrl(provider.baseUrl, '/messages'), {
    method: 'POST',
    headers: {
      ...authHeaders(provider),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(toAnthropicBody(provider, body, messages, withTools)),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorBody(response)
  }
  const events: MessageStreamEvent[] = []
  const toolUses: { id: string; name: string; input: unknown }[] = []
  const assistantContent: unknown[] = []
  const openBlocks = new Map<number, Record<string, unknown>>()
  const jsonAcc = new Map<number, string>()
  let stopReason: StopReason = 'end_turn'
  let lastUsage: MessageUsage | undefined
  let inputTokens = 0

  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    const errorBody = payload as { error?: { message?: string } } | null
    if (errorBody && typeof errorBody === 'object' && errorBody.error?.message) {
      throw new ApiError('stream', errorBody.error.message)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const record = payload as Record<string, unknown> | null
    if (!record || typeof record !== 'object') {
      continue
    }
    if (record.type === 'message_start') {
      const startUsage = (record.message as Record<string, unknown> | undefined)?.usage as
        | Record<string, unknown>
        | undefined
      if (startUsage && typeof startUsage.input_tokens === 'number') {
        inputTokens = startUsage.input_tokens
      }
    } else if (record.type === 'content_block_start') {
      const block = record.content_block as Record<string, unknown>
      const i = record.index as number
      openBlocks.set(i, { ...block })
      if (block.type === 'tool_use') {
        jsonAcc.set(i, '')
      }
    } else if (record.type === 'content_block_delta') {
      const i = record.index as number
      const delta = record.delta as Record<string, unknown>
      const block = openBlocks.get(i)
      if (block && delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        jsonAcc.set(i, (jsonAcc.get(i) ?? '') + delta.partial_json)
      }
      if (block && delta.type === 'text_delta' && typeof delta.text === 'string') {
        block.text = ((block.text as string) ?? '') + delta.text
      }
      if (block && delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        block.thinking = ((block.thinking as string) ?? '') + delta.thinking
      }
    } else if (record.type === 'content_block_stop') {
      const i = record.index as number
      const block = openBlocks.get(i)
      if (block) {
        if (block.type === 'tool_use') {
          let input: unknown = {}
          try {
            input = JSON.parse(jsonAcc.get(i) || '{}')
          } catch {
            input = {}
          }
          toolUses.push({ id: block.id as string, name: block.name as string, input })
          assistantContent.push({ type: 'tool_use', id: block.id, name: block.name, input })
        } else if (block.type === 'text' || block.type === 'thinking') {
          assistantContent.push(block)
        }
        openBlocks.delete(i)
      }
    } else if (record.type === 'message_delta') {
      const delta = record.delta as Record<string, unknown>
      if (typeof delta.stop_reason === 'string') {
        stopReason = delta.stop_reason as StopReason
      }
      const u = record.usage as Record<string, unknown> | undefined
      if (u && typeof u.output_tokens === 'number') {
        lastUsage = usage(inputTokens, u.output_tokens)
      }
    }
    const event = readMessageEvent(payload)
    if (event && event.type !== 'message_stop' && event.type !== 'message_start') {
      events.push(event)
    }
    if (record.type === 'message_stop') {
      break
    }
  }
  return { events, toolUses, assistantContent, stopReason, usage: lastUsage }
}

async function* streamAnthropic(
  provider: Provider,
  body: GatewayRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const messages: unknown[] = [...body.messages]
  yield { type: 'message_start', message: { id: '', model: body.model } }
  let toolUseCount = 0
  let lastUsage: MessageUsage | undefined
  let stopReason: StopReason = 'end_turn'
  const maxRounds = body.search ? 6 : 1
  for (let round = 0; round < maxRounds; round++) {
    // 最后一轮撤掉工具，强制模型基于已有搜索结果输出最终回答
    const withTools = Boolean(body.search) && round < maxRounds - 1
    const roundBody = withTools
      ? body
      : {
          ...body,
          system: [
            body.system,
            '你已经完成资料检索。现在必须直接输出给用户的最终回答正文，用中文、条理清晰并引用来源；不要再调用任何工具，也不要只输出思考过程。',
          ]
            .filter(Boolean)
            .join('\n\n'),
        }
    const result = await anthropicRound(provider, roundBody, messages, withTools, signal)
    for (const event of result.events) {
      yield event
    }
    lastUsage = result.usage ?? lastUsage
    stopReason = result.stopReason
    if (!withTools || result.toolUses.length === 0 || !body.search) {
      break
    }
    messages.push({ role: 'assistant', content: result.assistantContent })
    const toolResults: unknown[] = []
    for (const tool of result.toolUses) {
      toolUseCount += 1
      const query =
        typeof (tool.input as { query?: unknown })?.query === 'string'
          ? ((tool.input as { query: string }).query)
          : ''
      let hits: SearchHit[] = []
      let failed = false
      try {
        hits = await executeSearch(body.search.provider, query, signal)
      } catch {
        failed = true
      }
      const resultBlock = {
        type: 'web_search_tool_result',
        tool_use_id: tool.id,
        content: failed
          ? [{ type: 'web_search_tool_result_error', error_code: 'unavailable' }]
          : hitsToResults(hits),
        kind: 'search',
      }
      yield { type: 'content_block_start', index: 1000 + toolUseCount * 2, content_block: {
        type: 'server_tool_use',
        id: tool.id,
        name: 'web_search',
        input: { action: 'search', queries: query ? [query] : [] },
        caller: { type: 'direct' },
        kind: 'search',
      } }
      yield { type: 'content_block_stop', index: 1000 + toolUseCount * 2 }
      yield { type: 'content_block_start', index: 1000 + toolUseCount * 2 + 1, content_block: resultBlock as never }
      yield { type: 'content_block_stop', index: 1000 + toolUseCount * 2 + 1 }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tool.id,
        content: JSON.stringify(
          hits.map((hit) => ({ title: hit.title, url: hit.url, snippet: hit.snippet }))
        ),
      })
    }
    messages.push({ role: 'user', content: toolResults })
  }
  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReason === 'tool_use' ? 'end_turn' : stopReason, stop_sequence: null },
    usage: lastUsage,
  }
  yield { type: 'message_stop' }
}

// ---------- 统一入口 ----------

/** 按模型上下文轮数裁剪历史（保留最近 N 轮 user+assistant） */
const trimContext = (messages: MessageParam[], rounds: number): MessageParam[] => {
  if (!rounds || rounds <= 0) {
    return messages
  }
  let count = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      count += 1
      if (count > rounds) {
        return messages.slice(i + 1)
      }
    }
  }
  return messages
}

export function streamChat(
  provider: Provider,
  body: GatewayRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const settings = body.settings
  const trimmed = trimContext(body.messages, settings?.contextRounds ?? 0)
  const maxTokens =
    body.maxTokens ?? (settings && settings.maxTokens > 0 ? settings.maxTokens : undefined)
  const finalBody: GatewayRequest = { ...body, messages: trimmed, maxTokens }
  return provider.protocol === 'anthropic'
    ? streamAnthropic(provider, finalBody, signal)
    : streamOpenAi(provider, finalBody, signal)
}

/** 一次性非流式文本请求（标题生成等轻量功能） */
/** 轻量一次性文本请求（标题生成）：非流式、关闭思考，避免思考占满输出预算 */
export const completeText = async (
  provider: Provider,
  body: GatewayRequest,
  signal: AbortSignal
): Promise<string> => {
  const messages = toOpenAiMessages(body.system, body.messages)
  const off: Record<string, unknown> =
    provider.thinkingStyle === 'deepseek' || provider.thinkingStyle === 'glm' || provider.thinkingStyle === 'kimi'
      ? { thinking: { type: 'disabled' } }
      : provider.thinkingStyle === 'enable_thinking'
        ? { enable_thinking: false }
        : {}
  const combined = withTimeout(signal, 60_000)
  if (provider.protocol === 'anthropic') {
    const response = await request(joinUrl(provider.baseUrl, '/messages'), {
      method: 'POST',
      headers: { ...authHeaders(provider), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: body.model,
        ...(body.system.trim() ? { system: body.system } : {}),
        messages: body.messages,
        max_tokens: body.maxTokens ?? 512,
      }),
      signal: combined,
    })
    const payload = (await response.json()) as { content?: { type?: string; text?: string }[] }
    return (payload.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('')
  }
  const response = await request(joinUrl(provider.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: { ...authHeaders(provider), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: body.model,
      messages,
      stream: false,
      max_tokens: body.maxTokens ?? 512,
      ...off,
    }),
    signal: combined,
  })
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  return payload.choices?.[0]?.message?.content ?? ''
}

// ---------- 生图（OpenAI 风格 /images/generations） ----------

export type GeneratedImage = {
  /** base64 数据（不含 data: 前缀）或远程 URL */
  data: string
  isUrl: boolean
  mimeType: string
  revisedPrompt?: string
}

export const generateImage = async (
  provider: Provider,
  model: string,
  prompt: string,
  size: string,
  signal: AbortSignal,
  count = 1,
  refImages: string[] = []
): Promise<GeneratedImage[]> => {
  const combined = withTimeout(signal, 300_000)
  const useEdits =
    refImages.length > 0 &&
    (provider.presetId === 'openai-image' || provider.presetId === 'tokenrhythm-image')
  let response: Response
  if (useEdits) {
    const form = new FormData()
    form.append('model', model)
    form.append('prompt', prompt)
    form.append('n', String(count))
    form.append('size', size)
    const imageField = provider.presetId === 'tokenrhythm-image' ? 'image' : 'image[]'
    for (const dataUrl of refImages) {
      form.append(imageField, dataUrlToBlob(dataUrl), 'ref.png')
    }
    response = await request(joinUrl(provider.baseUrl, '/images/edits'), {
      method: 'POST',
      headers: authHeaders(provider),
      body: form,
      signal: combined,
    })
  } else {
    if (
      refImages.length > 0 &&
      provider.presetId !== 'siliconflow-image' &&
      provider.presetId !== 'openai-image' &&
      provider.presetId !== 'tokenrhythm-image'
    ) {
      throw new ApiError('protocol', '该生图提供商暂不支持参考图（图生图），请改用 OpenAI / 硅基流动 / 基元律动生图')
    }
    const body: Record<string, unknown> = { model, prompt, n: count, size }
    if (refImages.length > 0 && provider.presetId === 'siliconflow-image') {
      body.image = refImages[0]
    }
    try {
      response = await request(joinUrl(provider.baseUrl, '/images/generations'), {
        method: 'POST',
        headers: { ...authHeaders(provider), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: combined,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/尺寸|size/i.test(message) && size !== '1024x1024') {
        response = await request(joinUrl(provider.baseUrl, '/images/generations'), {
          method: 'POST',
          headers: { ...authHeaders(provider), 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, size: '1024x1024' }),
          signal: combined,
        })
      } else {
        throw error
      }
    }
  }
  const body = (await response.json()) as {
    data?: { b64_json?: string; url?: string; revised_prompt?: string }[]
  }
  const items = Array.isArray(body.data) ? body.data : []
  const images = items.flatMap((item): GeneratedImage[] => {
    if (typeof item.b64_json === 'string' && item.b64_json) {
      return [{ data: item.b64_json, isUrl: false, mimeType: 'image/png', revisedPrompt: item.revised_prompt }]
    }
    if (typeof item.url === 'string' && item.url) {
      return [{ data: item.url, isUrl: true, mimeType: 'image/png', revisedPrompt: item.revised_prompt }]
    }
    return []
  })
  if (images.length === 0) {
    throw new ApiError('protocol', 'empty image response')
  }
  return images
}