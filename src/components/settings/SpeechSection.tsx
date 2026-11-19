import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  addCustomSpeech,
  addSpeechFromPreset,
  removeSpeechProvider,
  setSpeechSlot,
  SPEECH_PRESETS,
  updateSpeechProvider,
  useSpeech,
} from '../../services/speech/store.js'
import { Button } from '../base/Button.js'
import { voiceLabel, voiceOptionsFor } from '../../services/speech/voices.js'
import { Select } from '../base/Select.js'
import styles from './Settings.module.css'

/** 语音服务：ASR / TTS 提供商与槽位 */
export const SpeechSection = () => {
  const t = useTranslate()
  const providers = useSpeech((state) => state.providers)
  const asrId = useSpeech((state) => state.asrId)
  const ttsId = useSpeech((state) => state.ttsId)
  const [showKey, setShowKey] = useState<Record<string, boolean>>({})
  const [custom, setCustom] = useState({ name: '', baseUrl: '' })
  const [customVoice, setCustomVoice] = useState<Record<string, string>>({})

  return (
    <div className={styles.providersSection}>
      <div className={styles.presetGroupTitle}>{t('speechSectionTitle')}</div>
      <div className={styles.sectionHint}>{t('speechHint')}</div>
      <div className={styles.sectionHint}>{t('speechCustomHint')}</div>
      <div className={styles.slotCard}>
        <div className={styles.slotLabel}>{t('speechAsrSlot')}</div>
        <Select
          ariaLabel={t('speechAsrSlot')}
          value={asrId ?? ''}
          placeholder={t('slotAuto')}
          options={[{ value: '', label: t('slotAuto') }, ...providers.map((p) => ({ value: p.id, label: p.name }))]}
          onChange={(value) => setSpeechSlot('asr', value || null)}
        />
      </div>
      <div className={styles.slotCard}>
        <div className={styles.slotLabel}>{t('speechTtsSlot')}</div>
        <Select
          ariaLabel={t('speechTtsSlot')}
          value={ttsId ?? ''}
          placeholder={t('slotAuto')}
          options={[{ value: '', label: t('slotAuto') }, ...providers.map((p) => ({ value: p.id, label: p.name }))]}
          onChange={(value) => setSpeechSlot('tts', value || null)}
        />
      </div>
      {providers.map((provider) => (
        <div key={provider.id} className={styles.slotCard}>
          <div className={styles.providerHead}>
            <span className={styles.providerName}>{provider.name}</span>
            <Button variant="dangerOutlined" size="s" onClick={() => removeSpeechProvider(provider.id)}>
              {t('delete')}
            </Button>
          </div>
          <div className={styles.keyRow}>
            <input
              className={styles.input}
              type={showKey[provider.id] ? 'text' : 'password'}
              value={provider.apiKey}
              placeholder={t('providerKeyPlaceholder')}
              autoComplete="off"
              onChange={(event) => updateSpeechProvider(provider.id, { apiKey: event.target.value.trim() })}
            />
            <Button
              variant="outlined"
              size="s"
              onClick={() => setShowKey((state) => ({ ...state, [provider.id]: !state[provider.id] }))}
            >
              {t(showKey[provider.id] ? 'providerHideKey' : 'providerShowKey')}
            </Button>
          </div>
          {provider.kind === 'custom' || provider.kind === 'deepseek' ? (
            <label className={styles.formField}>
              <span>{t('speechProtocol')}</span>
              <Select
                ariaLabel={t('speechProtocol')}
                value={provider.kind}
                options={[
                  { value: 'custom', label: t('speechProtocolOpenai') },
                  { value: 'deepseek', label: 'DeepSeek' },
                ]}
                onChange={(value) => {
                  const kind = value as 'custom' | 'deepseek'
                  const patch: { kind: 'custom' | 'deepseek'; ttsVoice?: string; ttsModel?: string; asrModel?: string } = { kind }
                  if (kind === 'deepseek' && provider.ttsVoice !== 'stella' && provider.ttsVoice !== 'tide') {
                    patch.ttsVoice = 'stella'
                  }
                  if (kind === 'custom' && !provider.ttsModel) {
                    patch.ttsModel = 'gpt-4o-mini-tts'
                    patch.asrModel = provider.asrModel || 'whisper-1'
                  }
                  updateSpeechProvider(provider.id, patch)
                }}
              />
            </label>
          ) : null}
          {provider.kind !== 'deepseek' ? (
            <>
              <label className={styles.formField}>
                <span>{t('speechAsrModel')}</span>
                <input
                  className={styles.input}
                  value={provider.asrModel}
                  onChange={(event) => updateSpeechProvider(provider.id, { asrModel: event.target.value })}
                />
              </label>
              <label className={styles.formField}>
                <span>{t('speechTtsModel')}</span>
                <input
                  className={styles.input}
                  value={provider.ttsModel}
                  onChange={(event) => updateSpeechProvider(provider.id, { ttsModel: event.target.value })}
                />
              </label>
            </>
          ) : null}
          <label className={styles.formField}>
            <span>{t('speechVoice')}</span>
            <Select
              ariaLabel={t('speechVoice')}
              value={provider.ttsVoice}
              placeholder={t('speechVoiceCustom')}
              options={[
                ...voiceOptionsFor(provider.kind, provider.ttsModel),
                { value: '__custom__', label: t('speechVoiceCustom') },
              ]}
              onChange={(value) => {
                if (value === '__custom__') {
                  setCustomVoice((state) => ({ ...state, [provider.id]: provider.ttsVoice }))
                } else {
                  setCustomVoice((state) => {
                    const next = { ...state }
                    delete next[provider.id]
                    return next
                  })
                  updateSpeechProvider(provider.id, { ttsVoice: value })
                }
              }}
            />
            {customVoice[provider.id] !== undefined ? (
              <div className={styles.keyRow}>
                <input
                  className={styles.input}
                  value={customVoice[provider.id]}
                  placeholder={t('speechVoiceCustomPlaceholder')}
                  onChange={(event) =>
                    setCustomVoice((state) => ({ ...state, [provider.id]: event.target.value }))
                  }
                />
                <Button
                  variant="outlined"
                  size="s"
                  disabled={!customVoice[provider.id].trim()}
                  onClick={() => {
                    updateSpeechProvider(provider.id, { ttsVoice: customVoice[provider.id].trim() })
                    setCustomVoice((state) => {
                      const next = { ...state }
                      delete next[provider.id]
                      return next
                    })
                  }}
                >
                  {t('imageSave')}
                </Button>
              </div>
            ) : !voiceOptionsFor(provider.kind, provider.ttsModel).some((v) => v.value === provider.ttsVoice) && provider.ttsVoice ? (
              <div className={styles.sectionHint}>{voiceLabel(provider.kind, provider.ttsModel, provider.ttsVoice)}</div>
            ) : null}
          </label>
        </div>
      ))}
      <div className={styles.presetGrid}>
        {SPEECH_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={styles.presetCard}
            onClick={() => addSpeechFromPreset(preset.id)}
          >
            <span className={styles.presetName}>{preset.name}</span>
          </button>
        ))}
      </div>
      <div className={styles.formFields}>
        <input
          className={styles.input}
          value={custom.name}
          placeholder={t('providerNamePlaceholder')}
          onChange={(event) => setCustom({ ...custom, name: event.target.value })}
        />
        <div className={styles.keyRow}>
          <input
            className={styles.input}
            value={custom.baseUrl}
            placeholder="https://example.com/v1"
            onChange={(event) => setCustom({ ...custom, baseUrl: event.target.value })}
          />
          <Button
            variant="outlined"
            size="s"
            disabled={!custom.baseUrl.trim()}
            onClick={() => {
              addCustomSpeech(custom)
              setCustom({ name: '', baseUrl: '' })
            }}
          >
            {t('addProvider')}
          </Button>
        </div>
      </div>
    </div>
  )
}