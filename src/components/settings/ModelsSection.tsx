import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  addSearchProvider,
  removeSearchProvider,
  setActiveSearch,
  setBinding,
  updateSearchProvider,
  useProviders,
  type FeatureSlot,
} from '../../services/providers/store.js'
import { SEARCH_PRESETS } from '../../services/providers/store.js'
import { setReadLinks, useSettings } from '../../services/settings.js'
import { SpeechSection } from './SpeechSection.js'
import { Button } from '../base/Button.js'
import { Select } from '../base/Select.js'
import styles from './Settings.module.css'

/** 功能 → 提供商 + 模型 的自由绑定 + 搜索服务管理 */
export const ModelsSection = () => {
  const t = useTranslate()
  const providers = useProviders((state) => state.providers)
  const bindings = useProviders((state) => state.bindings)
  const searchProviders = useProviders((state) => state.searchProviders)
  const activeSearchId = useProviders((state) => state.activeSearchId)
  const [showKey, setShowKey] = useState<Record<string, boolean>>({})

  const chatProviders = providers.filter((provider) => provider.kind !== 'image')
  const imageProviders = providers.filter((provider) => provider.kind === 'image')

  const slots: { slot: FeatureSlot; label: string; hint: string; image?: boolean }[] = [
    { slot: 'chat', label: t('slotChat'), hint: t('slotChatHint') },
    { slot: 'vision', label: t('slotVision'), hint: t('slotVisionHint') },
    { slot: 'title', label: t('slotTitle'), hint: t('slotTitleHint') },
    { slot: 'image', label: t('slotImage'), hint: t('slotImageHint'), image: true },
  ]

  return (
    <div className={styles.providersSection}>
      <div className={styles.sectionHint}>{t('modelsHint')}</div>
      {slots.map(({ slot, label, hint, image }) => {
        const binding = bindings[slot]
        const pool = image ? imageProviders : chatProviders
        const provider = pool.find((item) => item.id === binding?.providerId)
        const models = provider ? (image ? provider.imageModels : provider.models) : []
        return (
          <div key={slot} className={styles.slotCard}>
            <div className={styles.slotLabel}>{label}</div>
            <div className={styles.slotHint}>{hint}</div>
            <div className={styles.slotSelectors}>
              <Select
                ariaLabel={label}
                value={binding?.providerId ?? ''}
                placeholder={t('slotSelectProvider')}
                options={[
                  { value: '', label: t('slotAuto') },
                  ...pool.map((item) => ({ value: item.id, label: item.name })),
                ]}
                onChange={(providerId) => {
                  if (!providerId) {
                    setBinding(slot, null)
                    return
                  }
                  const next = pool.find((item) => item.id === providerId)
                  const nextModels = next ? (image ? next.imageModels : next.models) : []
                  setBinding(slot, { providerId, model: nextModels[0] ?? '' })
                }}
              />
              <input
                className={styles.input}
                list={`models-${slot}`}
                value={binding?.model ?? ''}
                placeholder={t('slotSelectModel')}
                disabled={!provider}
                onChange={(event) => {
                  if (binding) {
                    setBinding(slot, { ...binding, model: event.target.value })
                  }
                }}
              />
              <datalist id={`models-${slot}`}>
                {models.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </div>
            {provider && models.length === 0 ? (
              <div className={styles.slotWarn}>{t('slotNoModels')}</div>
            ) : null}
          </div>
        )
      })}

      <div className={styles.presetGroupTitle}>{t('searchSectionTitle')}</div>
      <div className={styles.sectionHint}>{t('searchHint')}</div>
      {searchProviders.map((provider) => (
        <div key={provider.id} className={styles.slotCard}>
          <div className={styles.providerHead}>
            <button
              type="button"
              className={clsx(styles.checkRow, styles.searchActive)}
              onClick={() => setActiveSearch(provider.id)}
            >
              <input type="radio" readOnly checked={activeSearchId === provider.id} />
              {provider.name}
            </button>
            <Button variant="dangerOutlined" size="s" onClick={() => removeSearchProvider(provider.id)}>
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
              onChange={(event) => updateSearchProvider(provider.id, { apiKey: event.target.value.trim() })}
            />
            <Button
              variant="outlined"
              size="s"
              onClick={() => setShowKey((state) => ({ ...state, [provider.id]: !state[provider.id] }))}
            >
              {t(showKey[provider.id] ? 'providerHideKey' : 'providerShowKey')}
            </Button>
          </div>
        </div>
      ))}
      <div className={styles.presetGrid}>
        {SEARCH_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={styles.presetCard}
            onClick={() => addSearchProvider(preset.id)}
          >
            <span className={styles.presetName}>{preset.name}</span>
            <span className={styles.presetDesc}>{t(preset.descKey as TranslationKey)}</span>
          </button>
        ))}
      </div>

      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={useSettings((state) => state.readLinks)}
          onChange={(event) => setReadLinks(event.target.checked)}
        />
        {t('readLinksLabel')}
      </label>
      <SpeechSection />

    </div>
  )
}