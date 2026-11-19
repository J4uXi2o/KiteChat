/**
 * DeepSeek 原生文本工具调用（DSML）的识别与过滤。
 * 撤掉工具后模型可能以文本标记形式输出调用，这里统一提取为结构化调用并从正文剥离，
 * OpenAI 与 Anthropic 两条协议路径共用，避免逻辑分叉。
 */

export const DSML_MARKER = '<｜DSML｜'
const DSML_CLOSE = '</｜DSML｜calls>'
const DSML_INVOKE_RE = /<｜DSML｜invoke name="([^"]+)">([\s\S]*?)<\/｜DSML｜invoke>/g
const DSML_PARAM_RE = /<｜DSML｜parameter name="([^"]+)"[^>]*>([\s\S]*?)<\/｜DSML｜parameter>/g

export type DsmlCall = { name: string; query: string }

/** 从完整文本中提取 DSML 调用，返回清理后的文本与调用列表 */
export const extractDsmlCalls = (text: string): { clean: string; calls: DsmlCall[] } => {
  const calls: DsmlCall[] = []
  let clean = text.replace(DSML_INVOKE_RE, (_m, name: string, body: string) => {
    let query = ''
    for (const p of body.matchAll(DSML_PARAM_RE)) {
      if (p[1] === 'query') {
        query = p[2].trim()
      }
    }
    calls.push({ name, query })
    return ''
  })
  // 清理残留标记（未闭合的 calls 包裹、流式截断的半个标记等）
  clean = clean.replace(/<\/?｜DSML｜[^>]*>?/g, '').replace(/<｜DSML｜[\s\S]*$/, '')
  return { clean: clean.trim(), calls }
}

/**
 * 流式 DSML 过滤器：逐段喂入正文，输出可见文本并收集完整调用。
 * 标记可能跨分片截断，内部缓冲到标记/闭合完整后再处理。
 */
export class DsmlStreamFilter {
  private buffer = ''
  private inDsml = false
  readonly calls: DsmlCall[] = []

  /** 喂入一段正文，返回其中应展示给用户的可见文本 */
  feed(chunk: string): string {
    this.buffer += chunk
    let visible = ''
    for (;;) {
      if (!this.inDsml) {
        const marker = this.buffer.indexOf(DSML_MARKER)
        if (marker < 0) {
          // 保留可能是标记开头的尾部，其余输出
          let keep = 0
          const maxPrefix = Math.min(this.buffer.length, DSML_MARKER.length - 1)
          for (let k = maxPrefix; k > 0; k--) {
            if (DSML_MARKER.startsWith(this.buffer.slice(-k))) {
              keep = k
              break
            }
          }
          visible += this.buffer.slice(0, this.buffer.length - keep)
          this.buffer = this.buffer.slice(this.buffer.length - keep)
          return visible
        }
        visible += this.buffer.slice(0, marker)
        this.buffer = this.buffer.slice(marker)
        this.inDsml = true
      }
      const end = this.buffer.indexOf(DSML_CLOSE)
      if (end < 0) {
        return visible
      }
      const blockText = this.buffer.slice(0, end + DSML_CLOSE.length)
      this.buffer = this.buffer.slice(end + DSML_CLOSE.length)
      this.inDsml = false
      const extracted = extractDsmlCalls(blockText)
      this.calls.push(...extracted.calls)
      visible += extracted.clean
    }
  }

  /** 流结束：处理残留缓冲（完整调用提取，截断标记丢弃），返回剩余可见文本 */
  flush(): string {
    if (!this.buffer) {
      return ''
    }
    const extracted = extractDsmlCalls(this.buffer)
    this.calls.push(...extracted.calls)
    this.buffer = ''
    this.inDsml = false
    return extracted.clean
  }
}

/** 把 DSML 调用中的 web_search 转成标准查询列表 */
export const dsmlSearchQueries = (calls: DsmlCall[]): string[] =>
  calls.filter((c) => c.name === 'web_search' && c.query).map((c) => c.query)