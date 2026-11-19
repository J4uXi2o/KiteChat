import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { createRecorder, transcribe } from '../../services/speech/engine.js'
import { getSpeechProvider, useSpeech } from '../../services/speech/store.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import styles from './ChatInput.module.css'

type Recorder = Awaited<ReturnType<typeof createRecorder>>

/**
 * 微信式语音条：按住说话、松开发送转写；上滑进入取消区（变红），在取消区松手丢弃。
 * 录音过短（<800ms）提示说话太短；转写结果追加进输入框，由用户确认后发送。
 */
export const VoiceBar = ({
  onText,
  onSent,
}: {
  onText: (text: string) => void
  onSent?: () => void
}) => {
  const t = useTranslate()
  const asrId = useSpeech((state) => state.asrId)
  const [recording, setRecording] = useState(false)
  const [willCancel, setWillCancel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [level, setLevel] = useState(0)
  const recorderRef = useRef<Recorder | null>(null)
  const activeRef = useRef(false)
  const cancelRef = useRef(false)
  const startYRef = useRef(0)
  const startedAtRef = useRef(0)
  const pointerIdRef = useRef<number | null>(null)
  const handlersRef = useRef<{ up: () => void; cancel: () => void } | null>(null)

  useEffect(() => {
    if (!recording) {
      setLevel(0)
      return
    }
    const timer = setInterval(() => setLevel(recorderRef.current?.level() ?? 0), 90)
    return () => clearInterval(timer)
  }, [recording])

  const release = useCallback(() => {
    const handlers = handlersRef.current
    if (handlers) {
      window.removeEventListener('pointerup', handlers.up)
      window.removeEventListener('pointercancel', handlers.cancel)
      handlersRef.current = null
    }
    pointerIdRef.current = null
  }, [])

  const finish = useCallback(
    async (cancel: boolean) => {
      if (!activeRef.current) {
        return
      }
      activeRef.current = false
      setRecording(false)
      setWillCancel(false)
      release()
      const recorder = recorderRef.current
      recorderRef.current = null
      if (!recorder) {
        return
      }
      if (cancel) {
        recorder.cancel()
        return
      }
      const heldMs = Date.now() - startedAtRef.current
      if (heldMs < 800) {
        recorder.cancel()
        showToast({ key: 'voiceTooShort', type: 'error' })
        return
      }
      setBusy(true)
      try {
        const { blob, durationMs } = await recorder.stop()
        if (durationMs > 120_000) {
          showToast({ key: 'voiceTooLong', type: 'error' })
          return
        }
        const provider = getSpeechProvider(asrId)
        if (provider) {
          const text = await transcribe(provider, blob)
          if (text.trim()) {
            onText(text)
            onSent?.()
          } else {
            showToast({ key: 'voiceEmpty', type: 'error' })
          }
        }
      } catch {
        showToast({ key: 'voiceFailed', type: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [asrId, onText, onSent, release]
  )

  const onUp = useCallback(() => void finish(cancelRef.current), [finish])
  const onCancelEvt = useCallback(() => void finish(true), [finish])
  handlersRef.current = { up: onUp, cancel: onCancelEvt }

  useEffect(
    () => () => {
      recorderRef.current?.cancel()
      release()
    },
    [release]
  )

  const start = async (event: React.PointerEvent<HTMLButtonElement>) => {
    if (busy || activeRef.current) {
      return
    }
    event.preventDefault()
    const provider = getSpeechProvider(asrId)
    if (!provider) {
      showToast({ key: 'voiceNoProvider', type: 'error' })
      openSettings('models')
      return
    }
    activeRef.current = true
    cancelRef.current = false
    startYRef.current = event.clientY
    startedAtRef.current = Date.now()
    pointerIdRef.current = event.pointerId
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancelEvt)
    try {
      const recorder = await createRecorder()
      recorderRef.current = recorder
      if (!activeRef.current) {
        recorder.cancel()
        recorderRef.current = null
        return
      }
      setRecording(true)
    } catch {
      activeRef.current = false
      release()
      showToast({ key: 'voiceMicDenied', type: 'error' })
    }
  }

  const move = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!activeRef.current || event.pointerId !== pointerIdRef.current) {
      return
    }
    const cancel = startYRef.current - event.clientY > 60
    cancelRef.current = cancel
    setWillCancel(cancel)
  }

  return (
    <div className={styles.voiceArea}>
      {recording ? createPortal(
        <div className={clsx(styles.voiceOverlay, willCancel && styles.voiceOverlayCancel)} aria-hidden>
          <div className={styles.voiceWaves}>
            {Array.from({ length: 24 }).map((_, i) => (
              <span
                key={i}
                style={{ height: `${4 + Math.round(level * 26 * (0.35 + 0.65 * Math.abs(Math.sin(i * 0.7 + level * 6))))}px` }}
              />
            ))}
          </div>
          <div className={styles.voiceOverlayHint}>
            {t(willCancel ? 'voiceReleaseCancel' : 'voiceSlideCancel')}
          </div>
        </div>,
        document.body
      ) : null}
      <button
        type="button"
        className={clsx(styles.voiceBar, recording && !willCancel && styles.voiceBarActive, willCancel && styles.voiceBarCancel)}
        disabled={busy}
        aria-label={t('voiceHoldToTalk')}
        onPointerDown={(event) => void start(event)}
        onPointerMove={move}
        onContextMenu={(event) => event.preventDefault()}
      >
        {busy ? t('voiceConverting') : t(recording ? (willCancel ? 'voiceReleaseCancel' : 'voiceReleaseSend') : 'voiceHoldToTalk')}
      </button>
    </div>
  )
}
