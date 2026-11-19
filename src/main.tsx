import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'

/** 启动时主动拉取系统栏安全区：原生推送可能早于页面就绪而丢失 */
const pullNativeInsets = (attempt = 0) => {
  const bridge = window.KiteNative
  if (!bridge?.getInsets) {
    return
  }
  try {
    const insets = JSON.parse(bridge.getInsets()) as { top?: number; bottom?: number; ime?: number }
    const root = document.documentElement
    root.style.setProperty('--kitechat-safe-top', `${insets.top ?? 0}px`)
    root.style.setProperty('--kitechat-safe-bottom', `${insets.bottom ?? 0}px`)
    root.style.setProperty('--kitechat-keyboard', `${insets.ime ?? 0}px`)
    if ((insets.top ?? 0) === 0 && attempt < 5) {
      setTimeout(() => pullNativeInsets(attempt + 1), 400 * (attempt + 1))
    }
  } catch {
    // 原生桥不可用时保持浏览器默认布局
  }
}
pullNativeInsets()

ensureKatex()
setupTheme()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
