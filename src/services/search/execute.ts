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

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** 执行一次联网搜索；失败抛出错误由调用方展示 */
export const executeSearch = async (
  provider: SearchProvider,
  query: string,
  signal: AbortSignal
): Promise<SearchHit[]> => {
  if (provider.kind === 'tavily') {
    const init: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({ query, max_results: 6, search_depth: 'basic' }),
      signal,
    }
    let response: Response
    try {
      response = await fetch('https://api.tavily.com/search', init)
    } catch {
      const bridge = getBridge()
      if (!bridge) {
        throw new Error('search network blocked')
      }
      const headers: Record<string, string> = {}
      new Headers(init.headers).forEach((value, key) => {
        headers[key] = value
      })
      const result = await nativeFetch({ url: 'https://api.tavily.com/search', method: 'POST', headers, body: typeof init.body === 'string' ? init.body : undefined })
      response = new Response(result.body ?? '', { status: result.status })
    }
    if (!response.ok) {
      throw new Error(`search failed: ${response.status}`)
    }
    const body = (await response.json()) as {
      results?: { title?: string; url?: string; content?: string }[]
    }
    return (body.results ?? []).flatMap((item) =>
      item.url
        ? [
            {
              title: item.title || item.url,
              url: item.url,
              snippet: item.content ?? '',
              site_name: hostOf(item.url),
              site_icon: null,
              page_age: null,
            },
          ]
        : []
    )
  }
  if (provider.kind === 'deepseek') {
    const response = await fetch('https://api.deepseek.com/v1/tools/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({ query: query.slice(0, 128), count: 6, need_content: true }),
      signal,
    })
    if (!response.ok) {
      throw new Error(`search failed: ${response.status}`)
    }
    const body = (await response.json()) as {
      results?: { title?: string; url?: string; snippet?: string; summary?: string; content?: string; site_name?: string; site_icon?: string; date?: string }[]
    }
    return (body.results ?? []).flatMap((item) =>
      item.url
        ? [{ title: item.title || item.url, url: item.url, snippet: item.summary || item.content || item.snippet || '', site_name: item.site_name ?? hostOf(item.url), site_icon: item.site_icon ?? null, page_age: item.date ?? null }]
        : []
    )
  }
  if (provider.kind === 'serper') {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': provider.apiKey },
      body: JSON.stringify({ q: query, num: 6 }),
      signal,
    })
    if (!response.ok) {
      throw new Error(`search failed: ${response.status}`)
    }
    const body = (await response.json()) as {
      organic?: { title?: string; link?: string; snippet?: string }[]
    }
    return (body.organic ?? []).flatMap((item) =>
      item.link
        ? [{ title: item.title || item.link, url: item.link, snippet: item.snippet ?? '', site_name: hostOf(item.link), site_icon: null, page_age: null }]
        : []
    )
  }
  if (provider.kind === 'brave') {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6`,
      { headers: { Accept: 'application/json', 'X-Subscription-Token': provider.apiKey }, signal }
    )
    if (!response.ok) {
      throw new Error(`search failed: ${response.status}`)
    }
    const body = (await response.json()) as {
      web?: { results?: { title?: string; url?: string; description?: string }[] }
    }
    return (body.web?.results ?? []).flatMap((item) =>
      item.url
        ? [{ title: item.title || item.url, url: item.url, snippet: item.description ?? '', site_name: hostOf(item.url), site_icon: null, page_age: null }]
        : []
    )
  }
  if (provider.kind === 'exa') {
    const response = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': provider.apiKey },
      body: JSON.stringify({ query, numResults: 6, contents: { text: { maxCharacters: 600 } } }),
      signal,
    })
    if (!response.ok) {
      throw new Error(`search failed: ${response.status}`)
    }
    const body = (await response.json()) as {
      results?: { title?: string; url?: string; text?: string }[]
    }
    return (body.results ?? []).flatMap((item) =>
      item.url
        ? [{ title: item.title || item.url, url: item.url, snippet: item.text ?? '', site_name: hostOf(item.url), site_icon: null, page_age: null }]
        : []
    )
  }
  // 博查 Bocha
  const response = await fetch('https://api.bochaai.com/v1/web-search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({ query, summary: true, count: 6 }),
    signal,
  })
  if (!response.ok) {
    throw new Error(`search failed: ${response.status}`)
  }
  const body = (await response.json()) as {
    data?: {
      webPages?: {
        value?: {
          name?: string
          url?: string
          snippet?: string
          summary?: string
          siteName?: string
          siteIcon?: string
          datePublished?: string
        }[]
      }
    }
  }
  return (body.data?.webPages?.value ?? []).flatMap((item) =>
    item.url
      ? [
          {
            title: item.name || item.url,
            url: item.url,
            snippet: item.summary || item.snippet || '',
            site_name: item.siteName || hostOf(item.url),
            site_icon: item.siteIcon ?? null,
            page_age: item.datePublished ?? null,
          },
        ]
      : []
  )
}