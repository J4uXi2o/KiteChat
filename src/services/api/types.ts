/**
 * 内部统一协议类型：以 Anthropic Messages 事件为规范格式，
 * OpenAI 协议由 gateway 适配成同一事件流。附件一律 base64/文本内联，
 * 不依赖任何厂商的文件上传接口。
 */

export type ChatModel = string

// ---------- 响应：内容块 ----------

/** 正文引用（保留类型以兼容导入的历史数据；新请求不再产生） */
export type TextCitation = {
  type: 'web_search_result_location'
  url: string
  title: string | null
  cited_text: string
  encrypted_index: string
}

export type TextBlock = { type: 'text'; text: string; citations?: TextCitation[] }

export type ThinkingBlock = { type: 'thinking'; thinking: string; signature: string }

/** 服务端工具块：仅用于展示导入的历史数据，新请求不再声明任何服务端工具 */
export type ServerToolKind =
  | 'search'
  | 'deep_search'
  | 'read_link'
  | 'image_search'
  | 'deep_image_search'

export type ServerToolInput =
  | { action: 'search'; query?: string; queries: string[] }
  | { action: 'open_page'; url: string }
  | { action: 'find_in_page'; url: string; pattern: string }
  | { action: 'read_link'; url: string }

export type ServerToolUseBlock = {
  type: 'server_tool_use'
  id: string
  name: string
  input: ServerToolInput
  caller: { type: 'direct' }
  kind: ServerToolKind
}

export type WebSearchResult = {
  type: 'web_search_result'
  title: string
  url: string
  image_url?: string
  snippet: string
  site_icon: string | null
  site_name: string | null
  encrypted_content: string
  page_age: string | null
}

export type WebSearchToolResultError = {
  type: 'web_search_tool_result_error'
  error_code: 'unavailable'
}

export type WebSearchToolResultBlock = {
  type: 'web_search_tool_result'
  tool_use_id: string
  content: (WebSearchResult | WebSearchToolResultError)[]
  kind: ServerToolKind
}

export type WebFetchResult = {
  type: 'web_fetch_result'
  url: string
  content: {
    type: 'document'
    source: { type: 'text'; media_type: 'text/plain'; data: string }
    title: string | null
  }
  published_at: string | null
}

export type WebFetchToolResultError = {
  type: 'web_fetch_tool_result_error'
  error_code: 'url_not_accessible' | 'url_not_allowed' | 'unavailable'
}

export type WebFetchToolResultBlock = {
  type: 'web_fetch_tool_result'
  tool_use_id: string
  content: WebFetchResult | WebFetchToolResultError
  kind: ServerToolKind
  signature?: string
}

export type ServerToolBlock =
  | ServerToolUseBlock
  | WebSearchToolResultBlock
  | WebFetchToolResultBlock

export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown }

// ---------- 请求 ----------

export type TextBlockParam = { type: 'text'; text: string }

/** 图片块：base64 内联，OpenAI/Anthropic 通用 */
export type ImageBlockParam = {
  type: 'image'
  source: { type: 'base64'; media_type: string; data: string }
}

/** 文本类附件：解码后内联为文本（通用协议没有文件引用） */
export type DocumentBlockParam = {
  type: 'document'
  source: { type: 'text'; media_type: 'text/plain'; data: string }
}

export type FileBlockParam = ImageBlockParam | DocumentBlockParam

export type AssistantBlockParam = TextBlockParam | ThinkingBlock

export type MessageParam =
  | { role: 'user'; content: string | (FileBlockParam | TextBlockParam)[] }
  | { role: 'assistant'; content: AssistantBlockParam[] }

/** 内部统一请求（gateway 按协议转换） */
export type CreateMessageRequest = {
  model: ChatModel
  system: string
  messages: MessageParam[]
  thinking?: boolean
  maxTokens?: number
}

// ---------- 响应：流式事件 ----------

export type StopReason = 'end_turn' | 'max_tokens' | 'tool_use' | 'refusal'

export type StopDetails = { type: 'refusal'; category: null; explanation: null }

export type MessageUsage = {
  input_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  output_tokens: number
  server_tool_use?: { web_search_requests: number; tool_search: number }
}

export type OutputBlockStart = TextBlock | ThinkingBlock | ServerToolBlock | ToolUseBlock

export type ContentBlockDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'signature_delta'; signature: string }
  | { type: 'citations_delta'; citation: TextCitation }
  | { type: 'input_json_delta'; partial_json: string }

export type MessageStreamEvent =
  | {
      type: 'message_start'
      message: { id: string; model: string; usage?: MessageUsage }
    }
  | { type: 'content_block_start'; index: number; content_block: OutputBlockStart }
  | { type: 'content_block_delta'; index: number; delta: ContentBlockDelta }
  | { type: 'content_block_stop'; index: number }
  | {
      type: 'message_delta'
      delta: {
        stop_reason: StopReason
        stop_sequence: null
        stop_details?: StopDetails
        title?: string
      }
      usage?: MessageUsage
    }
  | { type: 'message_stop' }
  | { type: 'ping' }

/** 非 2xx 响应体 */
export type ApiErrorBody = {
  error: {
    message: string
    type?: string
    param?: string | null
    code?: string | null
  }
}
