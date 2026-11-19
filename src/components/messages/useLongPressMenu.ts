import { useEffect, useRef } from 'react'
import { openMessageMenu } from './MessageContextMenu.js'

// 全局单例 selectionchange：仅长按计时期间激活的回调响应，避免 N 条消息 N 个监听
const activeSelectionHandlers = new Set<() => void>()
let selectionListenerInstalled = false
const onGlobalSelection = () => {
  const selection = window.getSelection()
  if (selection && selection.toString().trim()) {
    activeSelectionHandlers.forEach((handler) => handler())
  }
}

/**
 * 触摸长按 800ms 打开消息菜单；移动超 10px 取消。
 * 系统文本选择优先：一旦产生选区或选区变化，立即取消自定义菜单，
 * 让位系统「复制/全选」浮动工具条；自定义菜单只在无选区时弹出。
 */
export const useLongPressMenu = (
  sessionId: string,
  messageId: string,
  getText: () => string,
  canEdit: boolean
) => {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startX = useRef(0)
  const startY = useRef(0)
  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }
  useEffect(() => {
    const handler = () => clear()
    activeSelectionHandlers.add(handler)
    if (!selectionListenerInstalled) {
      selectionListenerInstalled = true
      document.addEventListener('selectionchange', onGlobalSelection)
    }
    return () => {
      activeSelectionHandlers.delete(handler)
      clear()
    }
  }, [])
  return {
    onTouchStart: (event: React.TouchEvent) => {
      const touch = event.touches[0]
      const x = touch.clientX
      const y = touch.clientY
      startX.current = x
      startY.current = y
      clear()
      timer.current = setTimeout(() => {
        const selection = window.getSelection()?.toString() ?? ''
        if (selection.trim()) {
          return
        }
        openMessageMenu({ sessionId, messageId, x, y, text: getText(), canEdit })
      }, 800)
    },
    onTouchEnd: clear,
    onTouchMove: (event: React.TouchEvent) => {
      const touch = event.touches[0]
      if (Math.abs(touch.clientX - startX.current) > 10 || Math.abs(touch.clientY - startY.current) > 10) {
        clear()
      }
    },
  }
}
