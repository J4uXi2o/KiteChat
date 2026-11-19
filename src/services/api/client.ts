import { translate, type TranslationMessage } from '../../i18n/index.js'
import { getBridge, nativeFetch as nativeCall } from '../native.js'
import type { ApiErrorBody } from './types.js'

/**
 * 通用 HTTP 请求与错误类型。具体端点由 providers/gateway 按用户配置拼接，
 * 本文件不再绑定任何固定 API 地址。
 */

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧，随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError(kind, message, response.status)
}

/** 安卓原生 HTTP 通道：WebView 跨域受限时回退使用 */
const nativeFetch = async (url: string, init: RequestInit): Promise<Response | null> => {
  const bridge = getBridge()
  if (!bridge) {
    return null
  }
  const headers: Record<string, string> = {}
  const raw = init.headers
  if (raw) {
    if (raw instanceof Headers) {
      raw.forEach((value, key) => {
        headers[key] = value
      })
    } else if (Array.isArray(raw)) {
      for (const [key, value] of raw) {
        headers[key] = value
      }
    } else {
      Object.assign(headers, raw)
    }
  }
  const body = typeof init.body === 'string' ? init.body : undefined
  const id = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const onAbort = () => bridge.cancel?.(id)
  init.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await nativeCall({ id, url, method: init.method ?? 'GET', headers, body })
    return new Response(result.body ?? '', { status: result.status, headers: result.headers ?? {} })
  } finally {
    init.signal?.removeEventListener('abort', onAbort)
  }
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    const fallback = await nativeFetch(url, init).catch(() => null)
    if (!fallback) {
      throw new ApiError('network', error instanceof Error ? error.message : String(error))
    }
    response = fallback
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}