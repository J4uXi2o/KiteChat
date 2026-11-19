import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { playBlob, stopPlayback, synthesize } from '../../services/speech/engine.js'
import { getSpeechProvider, useSpeech } from '../../services/speech/store.js'
import { IconPlayMediaOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { showToast } from '../base/toastState.js'

/** 朗读按钮：TTS 播放回复文本 */
export const ReadAloudButton = ({ text }: { text: string }) => {
  const t = useTranslate()
  const ttsId = useSpeech((state) => state.ttsId)
  const [playing, setPlaying] = useState(false)

  const toggle = async () => {
    if (playing) {
      stopPlayback()
      setPlaying(false)
      return
    }
    const provider = getSpeechProvider(ttsId)
    if (!provider) {
      showToast({ key: 'voiceNoProvider', type: 'error' })
      return
    }
    setPlaying(true)
    try {
      const blob = await synthesize(provider, text.slice(0, 2000))
      await playBlob(blob)
    } catch {
      showToast({ key: 'voiceFailed', type: 'error' })
    } finally {
      setPlaying(false)
    }
  }

  return (
    <IconButton
      icon={<IconPlayMediaOutline16 />}
      tooltip={t(playing ? 'ttsStop' : 'ttsPlay')}
      tooltipPlacement="bottom"
      onClick={() => void toggle()}
    />
  )
}