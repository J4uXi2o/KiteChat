/** 原生 HTTP 桥：异步回调，避免同步 JS 接口阻塞页面线程 */
export type NativeResult = { status: number; headers?: Record<string, string>; body?: string }

type Bridge = {
  fetchAsync?: (req: string, callbackName: string) => void
  fetchStream?: (req: string, callbackName: string) => void
  fetch?: (req: string) => string
  cancel?: (id: string) => void
  notify?: (title: string, body: string) => void
  takeShare?: () => string
  webReady?: () => void
  saveImage?: (base64: string, mime: string, name: string) => string
  saveFile?: (base64: string, mime: string, name: string) => string
  getInsets?: () => string
  setNativeTheme?: (dark: boolean) => void
}

export const getBridge = (): Bridge | undefined =>
  (window as unknown as { KiteNative?: Bridge }).KiteNative

/** 回调表：状态放 Map；window 上的转发函数用 Reflect.deleteProperty 清理（原生按 window[name] 调用） */
const nativeCallbacks = new Map<string, (raw: string) => void>()
const registerCallback = (name: string, handler: (raw: string) => void) => {
  nativeCallbacks.set(name, handler)
  ;(window as unknown as Record<string, unknown>)[name] = (raw: string) => {
    nativeCallbacks.get(name)?.(raw)
  }
}
const unregisterCallback = (name: string) => {
  nativeCallbacks.delete(name)
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, name)
}

export const nativeFetch = (req: {
  id?: string
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  binary?: boolean
}): Promise<NativeResult> => {
  const bridge = getBridge()
  if (!bridge) {
    return Promise.reject(new Error('no native bridge'))
  }
  const payload = JSON.stringify(req)
  const fetchAsync = bridge.fetchAsync
  if (fetchAsync) {
    return new Promise((resolve, reject) => {
      const name = `__kiteNativeCb${Date.now()}${Math.floor(Math.random() * 1e6)}`
      const timer = setTimeout(() => {
        unregisterCallback(name)
        reject(new Error('native fetch timeout'))
      }, 320_000)
      registerCallback(name, (result) => {
        clearTimeout(timer)
        unregisterCallback(name)
        try {
          resolve(JSON.parse(result) as NativeResult)
        } catch {
          reject(new Error('bad native result'))
        }
      })
      fetchAsync(payload, name)
    })
  }
  // 旧版同步桥兜底
  const fetchSync = bridge.fetch
  if (!fetchSync) {
    return Promise.reject(new Error('no native fetch method'))
  }
  try {
    return Promise.resolve(JSON.parse(fetchSync(payload)) as NativeResult)
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
}

/** 原生分块流式请求：meta → chunk* → done，返回可读字节流（跨域回退时保持真流式） */
export const nativeFetchStream = (req: {
  id?: string
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}): Promise<{ status: number; headers: Record<string, string>; stream: ReadableStream<Uint8Array> }> => {
  const bridge = getBridge()
  const fetchStream = bridge?.fetchStream
  if (!fetchStream) {
    return Promise.reject(new Error('no native stream bridge'))
  }
  const payload = JSON.stringify(req)
  return new Promise((resolve, reject) => {
    const name = `__kiteNativeStream${Date.now()}${Math.floor(Math.random() * 1e6)}`
    let settled = false
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null
    const timer = setTimeout(() => {
      cleanup()
      if (!settled) {
        settled = true
        reject(new Error('native stream timeout'))
      } else {
        controller?.error(new Error('native stream timeout'))
      }
    }, 320_000)
    const cleanup = () => {
      clearTimeout(timer)
      unregisterCallback(name)
    }
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
      cancel() {
        if (req.id) {
          bridge.cancel?.(req.id)
        }
        cleanup()
      },
    })
    registerCallback(name, (raw: string) => {
      let msg: { type?: string; status?: number; headers?: Record<string, string>; data?: string; message?: string }
      try {
        msg = JSON.parse(raw)
      } catch {
        return
      }
      if (msg.type === 'meta') {
        if (!settled) {
          settled = true
          resolve({ status: msg.status ?? 0, headers: msg.headers ?? {}, stream })
        }
      } else if (msg.type === 'chunk' && typeof msg.data === 'string') {
        const binary = atob(msg.data)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i)
        }
        controller?.enqueue(bytes)
      } else if (msg.type === 'done') {
        cleanup()
        controller?.close()
      } else if (msg.type === 'error') {
        cleanup()
        const err = new Error(msg.message ?? 'native stream error')
        if (!settled) {
          settled = true
          reject(err)
        } else {
          controller?.error(err)
        }
      }
    })
    fetchStream(payload, name)
  })
}

/** base64 转 Blob */
export const base64ToBlob = (base64: string, mime: string): Blob => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mime })
}