import type { SearchProvider } from '../providers/store.js'
import { getBridge, nativeFetch } from '../native.js'

/** 搜索结果统一结构（与内部 web_search_result 块兼容） */
export type SearchHit = {
  title: string
  url: string
  snippet: string
  site_name: string | null
  site_icon: string | null
  page_age: string | null
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** 单个搜索提供商的请求构造与结果解析（表驱动，新增厂商只需加一行） */
type SearchAdapter = {
  url: (query: string, count: number) => string
  method: 'GET' | 'POST'
  headers: (apiKey: string) => Record<string, string>
  body?: (query: string, count: number) => string
  parse: (json: unknown) => SearchHit[]
}

const hit = (
  url: string | undefined,
  title: string | undefined,
  snippet: string | undefined,
  extra?: { site_name?: string | null; site_icon?: string | null; page_age?: string | null }
): SearchHit[] =>
  url
    ? [
        {
          title: title || url,
          url,
          snippet: snippet ?? '',
          site_name: extra?.site_name ?? hostOf(url),
          site_icon: extra?.site_icon ?? null,
          page_age: extra?.page_age ?? null,
        },
      ]
    : []

const asRecord = (json: unknown): Record<string, unknown> =>
  typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {}

const arrayOf = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? (value as Record<string, unknown>[]) : []

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

const SEARCH_ADAPTERS: Record<SearchProvider['kind'], SearchAdapter> = {
  tavily: {
    url: () => 'https://api.tavily.com/search',
    method: 'POST',
    headers: (key) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }),
    body: (query, count) => JSON.stringify({ query, max_results: count, search_depth: 'basic' }),
    parse: (json) =>
      arrayOf(asRecord(json).results).flatMap((item) =>
        hit(str(item.url), str(item.title), str(item.content))
      ),
  },
  deepseek: {
    url: () => 'https://api.deepseek.com/v1/tools/search',
    method: 'POST',
    headers: (key) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }),
    body: (query, count) =>
      JSON.stringify({ query: query.slice(0, 128), count, need_content: true }),
    parse: (json) =>
      arrayOf(asRecord(json).results).flatMap((item) =>
        hit(str(item.url), str(item.title), str(item.summary) || str(item.content) || str(item.snippet), {
          site_name: str(item.site_name),
          site_icon: str(item.site_icon),
          page_age: str(item.date),
        })
      ),
  },
  serper: {
    url: () => 'https://google.serper.dev/search',
    method: 'POST',
    headers: (key) => ({ 'Content-Type': 'application/json', 'X-API-KEY': key }),
    body: (query, count) => JSON.stringify({ q: query, num: count }),
    parse: (json) =>
      arrayOf(asRecord(json).organic).flatMap((item) =>
        hit(str(item.link), str(item.title), str(item.snippet))
      ),
  },
  brave: {
    url: (query, count) =>
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
    method: 'GET',
    headers: (key) => ({ Accept: 'application/json', 'X-Subscription-Token': key }),
    parse: (json) =>
      arrayOf(asRecord(asRecord(json).web).results).flatMap((item) =>
        hit(str(item.url), str(item.title), str(item.description))
      ),
  },
  exa: {
    url: () => 'https://api.exa.ai/search',
    method: 'POST',
    headers: (key) => ({ 'Content-Type': 'application/json', 'x-api-key': key }),
    body: (query, count) =>
      JSON.stringify({ query, numResults: count, contents: { text: { maxCharacters: 600 } } }),
    parse: (json) =>
      arrayOf(asRecord(json).results).flatMap((item) =>
        hit(str(item.url), str(item.title), str(item.text))
      ),
  },
  bocha: {
    url: () => 'https://api.bochaai.com/v1/web-search',
    method: 'POST',
    headers: (key) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }),
    body: (query, count) => JSON.stringify({ query, summary: true, count }),
    parse: (json) =>
      arrayOf(asRecord(asRecord(asRecord(json).data).webPages).value).flatMap((item) =>
        hit(str(item.url), str(item.name), str(item.summary) || str(item.snippet), {
          site_name: str(item.siteName),
          site_icon: str(item.siteIcon),
          page_age: str(item.datePublished),
        })
      ),
  },
}

/** 统一请求：浏览器 fetch 优先，跨域受限回退原生通道（所有厂商一致） */
const searchRequest = async (
  adapter: SearchAdapter,
  provider: SearchProvider,
  query: string,
  count: number,
  signal: AbortSignal
): Promise<unknown> => {
  const url = adapter.url(query, count)
  const headers = adapter.headers(provider.apiKey)
  const body = adapter.body?.(query, count)
  const init: RequestInit = { method: adapter.method, headers, signal, ...(body ? { body } : {}) }
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    const bridge = getBridge()
    if (!bridge) {
      throw new Error('search network blocked')
    }
    const result = await nativeFetch({ url, method: adapter.method, headers, body })
    response = new Response(result.body ?? '', { status: result.status })
  }
  if (!response.ok) {
    throw new Error(`search failed: ${response.status}`)
  }
  return response.json()
}

/** 执行一次联网搜索；失败抛出错误由调用方展示 */
export const executeSearch = async (
  provider: SearchProvider,
  query: string,
  signal: AbortSignal,
  maxResults = 20
): Promise<SearchHit[]> => {
  const count = Math.min(50, Math.max(1, Math.round(maxResults) || 20))
  const adapter = SEARCH_ADAPTERS[provider.kind]
  const json = await searchRequest(adapter, provider, query, count, signal)
  return adapter.parse(json)
}