import clsx from 'clsx'
import { useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { fetchModels, testProvider } from '../../services/api/gateway.js'
import {
  addCustomProvider,
  addImageProviderFromPreset,
  addProviderFromPreset,
  getModelSettings,
  initFetchedModelSettings,
  removeProvider,
  setModelSettings,
  updateProvider,
  useProviders,
  type Provider,
} from '../../services/providers/store.js'
import { IMAGE_PROVIDER_PRESETS, PROVIDER_PRESETS } from '../../services/providers/presets.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import styles from './Settings.module.css'

/** API 提供商管理：紧凑列表 + 弹窗编辑，预设收进添加弹窗 */
export const ProvidersSection = () => {
  const t = useTranslate()
  const providers = useProviders((state) => state.providers)
  const [addKind, setAddKind] = useState<null | 'chat' | 'image'>(null)
  const [editing, setEditing] = useState<Provider | null>(null)
  const [deleting, setDeleting] = useState<Provider | null>(null)
  const [custom, setCustom] = useState<{ name: string; baseUrl: string; protocol: 'openai' | 'anthropic' }>({ name: '', baseUrl: '', protocol: 'openai' })

  const chatProviders = providers.filter((provider) => provider.kind !== 'image')
  const imageProviders = providers.filter((provider) => provider.kind === 'image')
  // 编辑中的提供商取最新状态
  const editingLive = editing ? providers.find((p) => p.id === editing.id) ?? null : null

  const row = (provider: Provider) => (
    <div key={provider.id} className={styles.providerRow}>
      <button type="button" className={styles.providerRowMain} onClick={() => setEditing(provider)}>
        <span className={styles.providerName}>{provider.name}</span>
        <span className={clsx(styles.providerBadge, provider.apiKey && styles.providerBadgeReady)}>
          {provider.apiKey ? t('providerReady') : t('providerNoKey')}
        </span>
        <span className={styles.providerRowCount}>
          {provider.kind === 'image'
            ? t('providerModelCount', { count: provider.imageModels.length })
            : t('providerModelCount', { count: provider.models.length })}
        </span>
      </button>
      <Button variant="dangerOutlined" size="s" onClick={() => setDeleting(provider)}>
        {t('delete')}
      </Button>
    </div>
  )

  return (
    <div className={styles.providersSection}>
      <div className={styles.sectionHint}>{t('providersHint')}</div>

      <div className={styles.sectionHead}>
        <span className={styles.presetGroupTitle}>{t('providersChatSection')}</span>
        <Button variant="outlined" size="s" onClick={() => setAddKind('chat')}>
          {t('addProvider')}
        </Button>
      </div>
      {chatProviders.length === 0 ? (
        <div className={styles.sectionHint}>{t('providersEmpty')}</div>
      ) : (
        chatProviders.map(row)
      )}

      <div className={styles.sectionHead}>
        <span className={styles.presetGroupTitle}>{t('providersImageSection')}</span>
        <Button variant="outlined" size="s" onClick={() => setAddKind('image')}>
          {t('addProvider')}
        </Button>
      </div>
      <div className={styles.sectionHint}>{t('providersImageHint')}</div>
      {imageProviders.length === 0 ? (
        <div className={styles.sectionHint}>{t('providersEmpty')}</div>
      ) : (
        imageProviders.map(row)
      )}

      {addKind ? (
        <Modal
          title={t(addKind === 'image' ? 'addImageProviderTitle' : 'addChatProviderTitle')}
          closable
          onClose={() => setAddKind(null)}
          className={styles.addProviderModal}
        >
          <div className={styles.addProviderBody}>
            {(['vendor', 'aggregator', 'local'] as const)
              .filter((group) => addKind === 'chat' || group !== 'local')
              .map((group) => {
                const presets =
                  addKind === 'chat'
                    ? PROVIDER_PRESETS.filter((p) => p.group === group)
                    : IMAGE_PROVIDER_PRESETS.filter((p) => p.group === group)
                if (presets.length === 0) {
                  return null
                }
                return (
                  <div key={group} className={styles.presetGroup}>
                    <div className={styles.presetGroupTitle}>
                      {t(group === 'vendor' ? 'providerGroupVendor' : group === 'aggregator' ? 'providerGroupAggregator' : 'providerGroupLocal')}
                    </div>
                    <div className={styles.presetGrid}>
                      {presets.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          className={styles.presetCard}
                          onClick={() => {
                            const provider =
                              addKind === 'chat'
                                ? addProviderFromPreset(preset.id)
                                : addImageProviderFromPreset(preset.id)
                            setAddKind(null)
                            if (provider) {
                              setEditing(provider)
                            }
                          }}
                        >
                          <span className={styles.presetName}>{preset.name}</span>
                          <span className={styles.presetDesc}>{t(preset.descKey)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            <div className={styles.presetGroup}>
              <div className={styles.presetGroupTitle}>{t('customProvider')}</div>
              <div className={styles.formFields}>
                <input
                  className={styles.input}
                  value={custom.name}
                  placeholder={t('providerNamePlaceholder')}
                  onChange={(event) => setCustom({ ...custom, name: event.target.value })}
                />
                <input
                  className={styles.input}
                  value={custom.baseUrl}
                  placeholder="https://example.com/v1"
                  onChange={(event) => setCustom({ ...custom, baseUrl: event.target.value })}
                />
                {addKind === 'chat' ? (
                  <Select
                    ariaLabel={t('providerProtocol')}
                    value={custom.protocol}
                    options={[
                      { value: 'openai', label: 'OpenAI' },
                      { value: 'anthropic', label: 'Anthropic' },
                    ]}
                    onChange={(value) => setCustom({ ...custom, protocol: value })}
                  />
                ) : null}
                <Button
                  disabled={!custom.baseUrl.trim()}
                  onClick={() => {
                    const provider = addCustomProvider({ ...custom, kind: addKind })
                    setCustom({ name: '', baseUrl: '', protocol: 'openai' })
                    setAddKind(null)
                    setEditing(provider)
                  }}
                >
                  {t('confirm')}
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}

      {editingLive ? (
        <ProviderEditModal provider={editingLive} onClose={() => setEditing(null)} />
      ) : null}

      {deleting ? (
        <Modal
          title={t('deleteProviderTitle')}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="outlined" autoFocus onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  removeProvider(deleting.id)
                  setDeleting(null)
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteProviderDescription', { name: deleting.name })}
        </Modal>
      ) : null}
    </div>
  )
}

/** 单个提供商的编辑弹窗：地址/Key/协议/模型/高级参数 */
const ProviderEditModal = ({ provider, onClose }: { provider: Provider; onClose: () => void }) => {
  const t = useTranslate()
  const isImage = provider.kind === 'image'
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [newModel, setNewModel] = useState('')
  const [advanced, setAdvanced] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const runTest = async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setTesting(true)
    try {
      await testProvider(provider, controller.signal)
      showToast({ key: 'providerTestOk' })
    } catch (error) {
      if (!controller.signal.aborted) {
        showToast({
          key: 'providerTestFailed',
          params: { message: error instanceof Error ? error.message : String(error) },
          type: 'error',
        })
      }
    } finally {
      setTesting(false)
    }
  }

  const runFetchModels = async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setFetching(true)
    try {
      const models = await fetchModels(provider, controller.signal)
      if (models.length === 0) {
        showToast({ key: 'providerModelsEmpty', type: 'error' })
      } else {
        const merged = [...new Set([...models, ...provider.models])]
        updateProvider(provider.id, { models: merged })
        initFetchedModelSettings(provider, merged)
        showToast({ key: 'providerModelsFetched', params: { count: models.length } })
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        showToast({
          key: 'providerTestFailed',
          params: { message: error instanceof Error ? error.message : String(error) },
          type: 'error',
        })
      }
    } finally {
      setFetching(false)
    }
  }

  const models = isImage ? provider.imageModels : provider.models
  const setModels = (next: string[]) =>
    updateProvider(provider.id, isImage ? { imageModels: next } : { models: next })

  return (
    <Modal title={provider.name} closable onClose={onClose} className={styles.addProviderModal}>
      <div className={styles.addProviderBody}>
        <label className={styles.formField}>
          <span>{t('providerName')}</span>
          <input
            className={styles.input}
            value={provider.name}
            onChange={(event) => updateProvider(provider.id, { name: event.target.value })}
          />
        </label>
        <label className={styles.formField}>
          <span>{t('providerBaseUrl')}</span>
          <input
            className={styles.input}
            value={provider.baseUrl}
            onChange={(event) => updateProvider(provider.id, { baseUrl: event.target.value.trim() })}
          />
        </label>
        <label className={styles.formField}>
          <span>API Key</span>
          <div className={styles.keyRow}>
            <input
              className={styles.input}
              type={showKey ? 'text' : 'password'}
              value={provider.apiKey}
              placeholder={t('providerKeyPlaceholder')}
              autoComplete="off"
              onChange={(event) => updateProvider(provider.id, { apiKey: event.target.value.trim() })}
            />
            <Button variant="outlined" size="s" onClick={() => setShowKey((v) => !v)}>
              {t(showKey ? 'providerHideKey' : 'providerShowKey')}
            </Button>
          </div>
        </label>
        {!isImage ? (
          <div className={styles.formField}>
            <span>{t('providerProtocol')}</span>
            <Select
              ariaLabel={t('providerProtocol')}
              value={provider.protocol}
              options={[
                { value: 'openai', label: 'OpenAI' },
                { value: 'anthropic', label: 'Anthropic' },
              ]}
              onChange={(value) => updateProvider(provider.id, { protocol: value })}
            />
          </div>
        ) : null}
        <div className={styles.formField}>
          <div className={styles.modelListHead}>
            <span>{t(isImage ? 'providerImageModels' : 'providerChatModels')}</span>
            {!isImage && provider.supportsModelList ? (
              <Button
                variant="outlined"
                size="s"
                disabled={fetching || !provider.apiKey}
                onClick={() => void runFetchModels()}
              >
                {t(fetching ? 'providerFetchingModels' : 'providerFetchModels')}
              </Button>
            ) : null}
          </div>
          <div className={styles.modelChips}>
            {models.map((model) => (
              <span key={model} className={styles.modelChip}>
                <button
                  type="button"
                  className={styles.modelChipName}
                  onClick={() => setAdvanced(advanced === model ? null : model)}
                >
                  {model}
                </button>
                <button
                  type="button"
                  aria-label={`${t('delete')} ${model}`}
                  onClick={() => setModels(models.filter((m) => m !== model))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          {isImage || !provider.supportsModelList ? (
            <div className={styles.keyRow}>
              <input
                className={styles.input}
                value={newModel}
                placeholder={t('providerAddModelPlaceholder')}
                onChange={(event) => setNewModel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    const value = newModel.trim()
                    if (value && !models.includes(value)) {
                      setModels([...models, value])
                    }
                    setNewModel('')
                  }
                }}
              />
              <Button
                variant="outlined"
                size="s"
                onClick={() => {
                  const value = newModel.trim()
                  if (value && !models.includes(value)) {
                    setModels([...models, value])
                  }
                  setNewModel('')
                }}
              >
                {t('providerAddModel')}
              </Button>
            </div>
          ) : null}
          <div className={styles.sectionHint}>
            {t(isImage ? 'modelAdvancedHint' : models.length === 0 ? 'modelsFetchHint' : 'modelAdvancedHint')}
          </div>
        </div>
        {advanced && !isImage ? (
          <ModelAdvanced provider={provider} model={advanced} />
        ) : null}
        {!isImage ? (
          <Button variant="outlined" disabled={testing || !provider.apiKey} onClick={() => void runTest()}>
            {t(testing ? 'providerTesting' : 'providerTest')}
          </Button>
        ) : null}
      </div>
    </Modal>
  )
}

/** 模型高级参数：识图/思考/强度/上下文/最大输出 */
const ModelAdvanced = ({ provider, model }: { provider: Provider; model: string }) => {
  const t = useTranslate()
  const settings = getModelSettings(provider, model)
  return (
    <div className={styles.advancedBlock}>
      <div className={styles.advancedTitle}>{model}</div>
      <div className={styles.advancedBody}>
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={settings.vision}
            onChange={(event) => setModelSettings(provider.id, model, { vision: event.target.checked })}
          />
          {t('modelVision')}
        </label>
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={settings.thinking}
            onChange={(event) => setModelSettings(provider.id, model, { thinking: event.target.checked })}
          />
          {t('modelThinking')}
        </label>
        <label className={styles.formField}>
          <span>{t('modelThinkingStyle')}</span>
          <Select
            ariaLabel={t('modelThinkingStyle')}
            value={settings.thinkingStyle ?? ''}
            options={[
              { value: '', label: t('thinkingStyleAuto') },
              { value: 'none', label: 'none' },
              { value: 'deepseek', label: 'deepseek' },
              { value: 'glm', label: 'glm' },
              { value: 'enable_thinking', label: 'enable_thinking' },
              { value: 'reasoning_effort', label: 'reasoning_effort' },
              { value: 'kimi', label: 'kimi' },
            ]}
            onChange={(value) => setModelSettings(provider.id, model, { thinkingStyle: value as never })}
          />
        </label>
        <label className={styles.formField}>
          <span>{t('modelEffort')}</span>
          <Select
            ariaLabel={t('modelEffort')}
            value={settings.effort}
            options={[
              { value: 'low', label: 'low' },
              { value: 'medium', label: 'medium' },
              { value: 'high', label: 'high' },
            ]}
            onChange={(value) => setModelSettings(provider.id, model, { effort: value })}
          />
        </label>
        <label className={styles.formField}>
          <span>{t('modelContext')}</span>
          <input
            className={styles.input}
            type="number"
            min={0}
            value={settings.contextRounds}
            onChange={(event) =>
              setModelSettings(provider.id, model, { contextRounds: Math.max(0, Number(event.target.value) || 0) })
            }
          />
        </label>
        <label className={styles.formField}>
          <span>{t('modelMaxTokens')}</span>
          <input
            className={styles.input}
            type="number"
            min={0}
            value={settings.maxTokens}
            onChange={(event) =>
              setModelSettings(provider.id, model, { maxTokens: Math.max(0, Number(event.target.value) || 0) })
            }
          />
        </label>
      </div>
    </div>
  )
}