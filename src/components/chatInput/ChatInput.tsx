import clsx from 'clsx'
import { memo, useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import {
  IconKeyboardOutline16,
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconChipOutline14,
  IconGlobeLanguageOutline14,
  IconImageOutline14,
  IconMicOutline16,
  IconPaperclipOutline16,
  IconSendOutline16,
  IconStopFill16,
  IconThinkOutline14,
} from '../base/icons.js'
import { setImageMode, setSearch, setThinking, useSettings } from '../../services/settings.js'
import {
  getActiveSearchProvider,
  getBinding,
  getModelSettings,
  resolveChatBinding,
  setBinding,
  useProviders,
} from '../../services/providers/store.js'
import { useIsMobile } from '../../app/viewport.js'
import { sendMessage, stopReply, useChatStore } from '../../services/chat/store.js'
import {
  addDraftFiles,
  EMPTY_DRAFT,
  getDraft,
  prepareDraftMessage,
  removeDraftAttachment,
  setDraftText,
  useDrafts,
} from '../../services/chat/drafts.js'
import { IconButton } from '../base/IconButton.js'
import { ensureApiKey, openSettings } from '../settings/settingsDialogState.js'
import { DragMask, useFileDrop } from './DragMask.js'
import { showToast } from '../base/toastState.js'
import { ACCEPT } from '../../services/attachments.js'
import { IconPlusOutline16 } from '../base/icons.js'
import { DraftAttachments } from './DraftAttachments.js'
import { VoiceBar } from './MicButton.js'
import { ImageOptions } from './ImageOptions.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ChatInput.module.css'

/** 模型选择菜单开合（全局，供返回键关闭） */
export const useModelMenu = create<{ open: boolean }>(() => ({ open: false }))

/** 输入框：自适应文本框 + 附件 + 深度思考/生图开关 + 模型选择菜单 + 发送/停止 */
export const ChatInput = memo(function ChatInput({ sessionId }: { sessionId: string | null }) {
  return <Input key={sessionId === null ? 'new' : `session:${sessionId}`} sessionId={sessionId} />
})

const Input = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const draft = useDrafts((state) => state.drafts.get(sessionId) ?? EMPTY_DRAFT)
  const { text, attachments } = draft
  const setText = (value: string) => setDraftText(sessionId, value)
  const draftReady = prepareDraftMessage(draft) !== null
  const streaming = useChatStore(
    (state) => sessionId !== null && Object.hasOwn(state.streaming, sessionId)
  )
  const thinking = useSettings((state) => state.thinking)
  const imageMode = useSettings((state) => state.imageMode)
  const search = useSettings((state) => state.search)
  const importingHistory = useChatStore((state) => state.importingHistory)
  const isMobile = useIsMobile()
  const providers = useProviders((state) => state.providers)
  const chatBinding = useProviders((state) => state.bindings.chat)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [attachOpen, setAttachOpen] = useState(false)
  const [voiceMode, setVoiceMode] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const modelMenuOpen = useModelMenu((state) => state.open)
  const setModelMenuOpen = (open: boolean) => useModelMenu.setState({ open })

  const binding = resolveChatBinding()
  void chatBinding
  const modelLabel = binding ? binding.model : t('modelSwitchNone')
  const thinkEnabled = binding
    ? getModelSettings(binding.provider, binding.model).thinking ||
      binding.provider.thinkingStyle !== 'none'
    : false

  const acceptFiles = (files: File[]) => {
    if (files.length === 0 || useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    const error = addDraftFiles(sessionId, files)
    if (error) {
      showToast(error)
    }
  }
  const removeFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory) {
        removeDraftAttachment(sessionId, id)
      }
    },
    [sessionId]
  )
  const dragging = useFileDrop(acceptFiles)

  const canSend = !importingHistory && !streaming && draftReady

  const send = () => {
    if (
      useChatStore.getState().importingHistory ||
      !prepareDraftMessage(getDraft(sessionId))
    ) {
      return
    }
    if (imageMode && !getBinding('image')) {
      showToast({ key: 'imageModeNoBinding', type: 'error' })
      return
    }
    if (!ensureApiKey() || !sendMessage(sessionId)) {
      return
    }
    if (isMobile) {
      textareaRef.current?.blur()
    } else {
      textareaRef.current?.focus()
    }
  }

  const readyProviders = providers.filter((provider) => provider.kind !== 'image' && (provider.apiKey || provider.presetId === 'ollama' || provider.presetId === 'lmstudio'))

  return (
    <div
      className={clsx(styles.wrapper, sessionId === null ? styles.home : styles.session)}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          textareaRef.current?.focus({ preventScroll: true })
        }
      }}
    >
      <DraftAttachments items={attachments} onRemove={removeFile} />
      {voiceMode && !imageMode ? (
        <div className={styles.voiceRow}>
          <button
            type="button"
            className={styles.toggle}
            aria-label={t('voiceSwitchKeyboard')}
            onClick={() => setVoiceMode(false)}
          >
            <IconKeyboardOutline16 />
          </button>
          <VoiceBar
            onText={(text) => setText(getDraft(sessionId).text + text)}
            onSent={() => {
              setVoiceMode(false)
              send()
            }}
          />
        </div>
      ) : (
      <div className={styles.textareaWrapper}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          placeholder={t(imageMode ? 'chatInputPlaceholderImage' : 'chatInputPlaceholderChat')}
          rows={2}
          autoFocus={!isMobile}
          disabled={importingHistory}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onMouseDown={(event) => {
            if (isMobile && event.button === 0 && document.activeElement !== event.currentTarget) {
              event.preventDefault()
              event.currentTarget.focus({ preventScroll: true })
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send()
            }
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files)
            if (files.length > 0) {
              event.preventDefault()
              acceptFiles(files)
            }
          }}
        />
        <div className={styles.mirror} aria-hidden>
          {`${text}\n`}
        </div>
      </div>
      )}
      {imageMode ? (
        <div className={styles.imageParamsRow}>
          <span className={styles.imageModeTag}>
            <IconImageOutline14 />
            {t('imageModeSwitch')}
          </span>
          <ImageOptions />
        </div>
      ) : null}
      <div className={styles.functionRow}>
        <div className={styles.toggles}>
          <div className={styles.attachWrap}>
            <button
              type="button"
              className={clsx(styles.plusButton, attachOpen && styles.plusOpen)}
              aria-label={t('toolsButton')}
              aria-expanded={attachOpen}
              onClick={() => setAttachOpen((v) => !v)}
            >
              <IconPlusOutline16 />
            </button>
            {attachOpen ? createPortal(
              <>
                <div className={styles.attachMask} onClick={() => setAttachOpen(false)} />
                <div className={styles.attachMenu} role="menu">
                  <button
                    type="button"
                    className={styles.attachItem}
                    onClick={() => {
                      setAttachOpen(false)
                      if (ensureApiKey()) {
                        imageInputRef.current?.click()
                      }
                    }}
                  >
                    <IconImageOutline14 />
                    {t('uploadImage')}
                  </button>
                  <button
                    type="button"
                    className={styles.attachItem}
                    onClick={() => {
                      setAttachOpen(false)
                      if (ensureApiKey()) {
                        fileInputRef.current?.click()
                      }
                    }}
                  >
                    <IconPaperclipOutline16 />
                    {t('uploadFile')}
                  </button>
                </div>
              </>,
              document.body
            ) : null}
          </div>
          {imageMode ? (
            <button
              type="button"
              className={clsx(styles.iconToggle, styles.iconToggleActive)}
              aria-label={t('imageModeExit')}
              onClick={() => setImageMode(false)}
            >
              <IconImageOutline14 />
            </button>
          ) : (
            <>
              <button
                type="button"
                className={clsx(styles.iconToggle, thinking && styles.iconToggleActive)}
                aria-label={t('thinkingSwitch')}
                aria-pressed={thinking}
                disabled={!thinkEnabled}
                onClick={() => setThinking(!thinking)}
              >
                <IconThinkOutline14 />
              </button>
              <button
                type="button"
                className={clsx(styles.iconToggle, search && styles.iconToggleActive)}
                aria-label={t('searchSwitch')}
                aria-pressed={search}
                onClick={() => {
                  if (!search && !getActiveSearchProvider()) {
                    showToast({ key: 'searchNoProvider', type: 'error' })
                    openSettings('models')
                    return
                  }
                  setSearch(!search)
                }}
              >
                <IconGlobeLanguageOutline14 />
              </button>
              <button
                type="button"
                className={styles.iconToggle}
                aria-label={t('imageModeSwitch')}
                onClick={() => {
                  setImageMode(true)
                  setSearch(false)
                }}
              >
                <IconImageOutline14 />
              </button>
            </>
          )}
        </div>
        <div className={styles.right}>
          {!imageMode ? (
            <button
              type="button"
              className={clsx(styles.toggle, styles.modelToggle)}
              aria-label={t('modelSwitchTooltip')}
              aria-haspopup="dialog"
              aria-expanded={modelMenuOpen}
              onClick={() => setModelMenuOpen(true)}
            >
              <IconChipOutline14 />
              {!isMobile ? (
                <span className={clsx(styles.toggleLabel, styles.modelLabel)}>{modelLabel}</span>
              ) : null}
              <IconChevronDownOutline14 />
            </button>
          ) : null}
          {!imageMode ? (
            <IconButton
              size="m"
              tone="primary"
              icon={voiceMode ? <IconKeyboardOutline16 /> : <IconMicOutline16 />}
              tooltip={t(voiceMode ? 'voiceSwitchKeyboard' : 'voiceSwitchVoice')}
              onClick={() => {
                setVoiceMode((v) => !v)
                if (!voiceMode) {
                  setAttachOpen(false)
                }
              }}
            />
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept={ACCEPT}
            onChange={(event) => {
              acceptFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          <input
            ref={imageInputRef}
            type="file"
            multiple
            hidden
            accept="image/*"
            onChange={(event) => {
              acceptFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          {streaming && sessionId ? (
            <button
              type="button"
              className={styles.sendButton}
              aria-label={t('chatInputStopButtonTooltip')}
              onClick={() => stopReply(sessionId)}
            >
              <IconStopFill16 />
            </button>
          ) : (
            <button
              type="button"
              className={clsx(styles.sendButton, !canSend && styles.disabled)}
              aria-label={t('send')}
              aria-disabled={!canSend}
              onClick={send}
            >
              <IconSendOutline16 />
            </button>
          )}
        </div>
      </div>
      {dragging ? <DragMask /> : null}
      {modelMenuOpen ? (
        <div
          className={styles.modelMenuOverlay}
          onClick={() => setModelMenuOpen(false)}
        >
          <div
            className={styles.modelMenu}
            role="dialog"
            aria-label={t('modelPickerTitle')}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.modelMenuTitle}>{t('modelPickerTitle')}</div>
            <div className={styles.modelMenuList}>
              {readyProviders.length === 0 ? (
                <div className={styles.modelMenuEmpty}>{t('modelPickerEmpty')}</div>
              ) : (
                readyProviders.map((provider) => (
                  <div key={provider.id} className={styles.modelMenuGroup}>
                    <div className={styles.modelMenuProvider}>{provider.name}</div>
                    {provider.models.length === 0 ? (
                      <div className={styles.modelMenuEmpty}>{t('slotNoModels')}</div>
                    ) : (
                      provider.models.map((model) => {
                        const active =
                          binding?.provider.id === provider.id && binding.model === model
                        return (
                          <button
                            key={model}
                            type="button"
                            className={clsx(styles.modelMenuItem, active && styles.modelMenuItemActive)}
                            onClick={() => {
                              setBinding('chat', { providerId: provider.id, model })
                              setModelMenuOpen(false)
                            }}
                          >
                            <span className={styles.modelMenuItemName}>{model}</span>
                            {active ? <IconCheckOutline16 /> : null}
                          </button>
                        )
                      })
                    )}
                  </div>
                ))
              )}
            </div>
            <button
              type="button"
              className={styles.modelMenuManage}
              onClick={() => {
                setModelMenuOpen(false)
                openSettings('providers')
              }}
            >
              {t('modelPickerManage')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}