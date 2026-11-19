import { useEffect } from 'react'
import { useTranslate } from '../i18n/index.js'
import { useSettings } from '../services/settings.js'
import { useIsMobile, useMobileViewport, usePreventPageScroll } from './viewport.js'
import {
  bindChatPersistence,
  initChat,
  retrySaveSessions,
  selectSession,
  useChatStore,
} from '../services/chat/store.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import { closeSearchPanel } from '../components/search/searchPanelState.js'
import { SessionView } from '../components/session/SessionView.js'
import { MobileHeader } from '../components/session/MobileHeader.js'
import { Welcome } from '../components/session/Welcome.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { closeSettings, useSettingsDialog } from '../components/settings/settingsDialogState.js'
import { newChat } from '../services/chat/store.js'
import { restoreDrafts, setDraftText } from '../services/chat/drafts.js'
import { maybeShowOnboarding, Onboarding } from '../components/onboarding/Onboarding.js'
import { ImageViewer, useImageViewer } from '../components/base/ImageViewer.js'
import { useMessageMenu } from '../components/messages/MessageContextMenu.js'
import { useModelMenu } from '../components/chatInput/ChatInput.js'
import { Toast } from '../components/base/Toast.js'
import { Button } from '../components/base/Button.js'
import { CollapsedSider } from '../components/sider/CollapsedSider.js'
import { closeMobileSider, useMobileSider } from '../components/sider/mobileSiderState.js'
import { MobileSider, Sider } from '../components/sider/Sider.js'
import styles from './App.module.css'

export const App = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  // 移动端侧边栏以独立抽屉管理开合状态
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const ready = useChatStore((state) => state.ready)
  const initError = useChatStore((state) => state.initError)
  const saveError = useChatStore((state) => Object.values(state.sessionSaveErrors).some(Boolean))
  const importingHistory = useChatStore((state) => state.importingHistory)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId === null ? false : state.sessionLoadErrors[state.activeId] === true
  )
  const frameRef = useMobileViewport(isMobile)
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)

  usePreventPageScroll(isMobile)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  useEffect(bindChatPersistence, [])

  // 搜索结果面板只属于当前会话
  useEffect(closeSearchPanel, [activeId])
  // 移动端选中会话、切换布局后收起抽屉
  useEffect(closeMobileSider, [activeId, isMobile])

  // 安卓返回键桥：原生层派发 kitechat-back，优先关闭弹层/抽屉，否则交还原生处理
  useEffect(() => {
    const onBack = () => {
      const handled =
        useSettingsDialog.getState().open ||
        useMobileSider.getState().open ||
        useImageViewer.getState().url !== null ||
        useMessageMenu.getState().menu !== null ||
        useModelMenu.getState().open
      closeSettings()
      closeMobileSider()
      useImageViewer.setState({ url: null, name: '' })
      useMessageMenu.setState({ menu: null })
      useModelMenu.setState({ open: false })
      ;(window as unknown as { __kitechatBackHandled?: boolean }).__kitechatBackHandled = handled
    }
    window.addEventListener('kitechat-back', onBack)
    return () => window.removeEventListener('kitechat-back', onBack)
  }, [])
  useEffect(() => {
    restoreDrafts()
    void initChat()
    maybeShowOnboarding()
    window.KiteNative?.webReady?.()
    const takeShare = () => {
      const text = window.KiteNative?.takeShare?.()
      if (text) {
        newChat()
        setDraftText(null, text)
      }
    }
    takeShare()
    const onShare = (event: Event) => {
      const text = (event as CustomEvent<string>).detail
      if (text) {
        newChat()
        setDraftText(null, text)
      }
    }
    window.addEventListener('kitechat-share', onShare)
    return () => window.removeEventListener('kitechat-share', onShare)
  }, [])

  return (
    <>
      <div ref={frameRef} className={styles.frame}>
        {isMobile ? <MobileSider /> : siderCollapsed ? null : <Sider />}
        <main className={styles.main}>
          {saveError ? (
            <div className={styles.saveError} role="alert">
              <span>{t('sessionSaveFailed')}</span>
              <Button
                variant="outlined"
                size="s"
                disabled={importingHistory}
                onClick={retrySaveSessions}
              >
                {t('retry')}
              </Button>
            </div>
          ) : null}
          <div className={styles.content}>
            {siderCollapsed ? <CollapsedSider /> : null}
            {!ready || (activeId !== null && !session) ? (
              <div className={styles.loadingView}>
                {isMobile ? <MobileHeader /> : null}
                <div className={styles.loadingState} role="status" aria-live="polite">
                  <span>
                    {(!ready ? initError : sessionLoadError)
                      ? t(!ready ? 'sessionListLoadFailed' : 'sessionLoadFailed')
                      : t('sessionLoading')}
                  </span>
                  {(!ready ? initError : sessionLoadError) ? (
                    <Button
                      variant="outlined"
                      size="m"
                      onClick={() => {
                        if (!ready) {
                          void initChat()
                        } else if (activeId !== null) {
                          selectSession(activeId)
                        }
                      }}
                    >
                      {t('retry')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : session ? (
              <SessionView
                session={session}
                streaming={streaming}
                siderCollapsed={siderCollapsed}
              />
            ) : (
              <Welcome />
            )}
          </div>
        </main>
        <SearchPanel />
      </div>
      <SettingsDialog />
      <Onboarding />
      <ImageViewer />
      <Toast />
    </>
  )
}
