import { useRef } from 'react'
import { create } from 'zustand'
import { useTranslate } from '../../i18n/index.js'
import { removeMessage } from '../../services/chat/store.js'
import { copyText } from '../../utils/clipboard.js'
import { showToast } from '../base/toastState.js'
import styles from './MessageContextMenu.module.css'

type MenuState = {
  sessionId: string
  messageId: string
  x: number
  y: number
  text: string
  canEdit: boolean
} | null

export const useMessageMenu = create<{ menu: MenuState }>(() => ({ menu: null }))

export const openMessageMenu = (menu: NonNullable<MenuState>) => {
  // 用户正在划选文本时不弹自定义菜单，保证系统复制工具条可用
  const selection = window.getSelection()?.toString() ?? ''
  if (selection.trim()) {
    return
  }
  useMessageMenu.setState({ menu })
}

/** 长按消息弹出的操作菜单：复制 / 编辑（用户消息）/ 删除 */
export const MessageContextMenu = ({ onEdit }: { onEdit: (messageId: string) => void }) => {
  const t = useTranslate()
  const menu = useMessageMenu((state) => state.menu)
  // 所有 Hook 必须在条件返回之前调用，否则菜单开合会触发 React 崩溃（白屏）
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  if (!menu) {
    return null
  }
  const close = () => useMessageMenu.setState({ menu: null })
  const maskPress = {
    onTouchStart: () => {
      closeTimer.current = setTimeout(close, 500)
    },
    onTouchEnd: () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    },
    onTouchMove: () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    },
  }
  void menu.x
  void menu.y
  return (
    <div className={styles.mask} onClick={close} onContextMenu={(event) => event.preventDefault()} {...maskPress}>
      <div
        className={styles.menu}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className={styles.item}
          onClick={() => {
            void copyText(menu.text).then((ok) =>
              showToast(ok ? { key: 'copied' } : { key: 'copyFailed', type: 'error' })
            )
            close()
          }}
        >
          {t('copy')}
        </button>
        {menu.canEdit ? (
          <button
            type="button"
            className={styles.item}
            onClick={() => {
              onEdit(menu.messageId)
              close()
            }}
          >
            {t('editMessage')}
          </button>
        ) : null}
        <button
          type="button"
          className={styles.danger}
          onClick={() => {
            removeMessage(menu.sessionId, menu.messageId)
            close()
          }}
        >
          {t('delete')}
        </button>
      </div>
    </div>
  )
}
