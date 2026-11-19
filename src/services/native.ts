/** 原生 HTTP 桥：异步回调，避免同步 JS 接口阻塞页面线程 */
export type NativeResult = { status: number; headers?: Record<string, string>; body?: string }

type Bridge = {
  fetchAsync?: (req: string, callbackName: string) => void
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
  if (bridge.fetchAsync) {
    return new Promise((resolve, reject) => {
      const name = `__kiteNativeCb${Date.now()}${Math.floor(Math.random() * 1e6)}`
      const timer = setTimeout(() => {
        delete (window as unknown as Record<string, unknown>)[name]
        reject(new Error('native fetch timeout'))
      }, 320_000)
      ;(window as unknown as Record<string, unknown>)[name] = (result: string) => {
        clearTimeout(timer)
        delete (window as unknown as Record<string, unknown>)[name]
        try {
          resolve(JSON.parse(result) as NativeResult)
        } catch {
          reject(new Error('bad native result'))
        }
      }
      bridge.fetchAsync!(payload, name)
    })
  }
  // 旧版同步桥兜底
  try {
    return Promise.resolve(JSON.parse(bridge.fetch!(payload)) as NativeResult)
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
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