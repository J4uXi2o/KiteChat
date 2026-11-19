declare const __APP_VERSION__: string

interface Window {
  KiteNative?: {
    fetch?(req: string): string
    fetchAsync?(req: string, callbackName: string): void
    getInsets?(): string
    saveImage?(base64: string, mime: string, name: string): string
    saveFile?(base64: string, mime: string, name: string): string
    cancel?(id: string): void
    notify?(title: string, body: string): void
    takeShare?(): string
    webReady?(): void
    setNativeTheme?(dark: boolean): void
  }
}

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css' {}

declare module '*?url' {
  const url: string
  export default url
}


/** Prism 语言包通过副作用注册到全局 Prism */
declare module 'prismjs/components/*' {}

/** KaTeX 化学公式扩展通过副作用注册到 KaTeX */
declare module 'katex/contrib/mhchem' {}
