import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import { getImagePreset, getPreset, type ProviderProtocol, type ThinkingStyle } from './presets.js'

/**
 * 用户添加的 API 提供商。全部数据仅存本机 localStorage，
 * API Key 不会发送到除该提供商 baseUrl 以外的任何地址。
 */

/** 模型级能力与参数（高级面板可编辑） */
export type ModelSettings = {
  /** 支持图片输入（识图） */
  vision: boolean
  /** 支持深度思考 */
  thinking: boolean
  /** 思考强度（reasoning_effort 风格厂商生效） */
  effort: 'low' | 'medium' | 'high'
  /** 上下文轮数上限（0 = 不裁剪） */
  contextRounds: number
  /** 最大输出 tokens（0 = 不传） */
  maxTokens: number
  /** 思考参数协议 override（空 = 跟随提供商） */
  thinkingStyle?: ThinkingStyle | ''
}

export const defaultModelSettings = (): ModelSettings => ({
  vision: false,
  thinking: false,
  effort: 'medium',
  contextRounds: 0,
  maxTokens: 0,
})

export type ProviderKind = 'chat' | 'image'

export type Provider = {
  id: string
  /** 提供商类别：聊天/识图 或 生图 */
  kind: ProviderKind
  name: string
  baseUrl: string
  apiKey: string
  protocol: ProviderProtocol
  /** 用户确认过的模型 ID 列表（拉取或手填） */
  models: string[]
  /** 生图模型 ID 列表 */
  imageModels: string[]
  thinkingStyle: ThinkingStyle
  supportsModelList: boolean
  /** 来源预设 id；自定义为 null */
  presetId: string | null
  /** 按模型 ID 的能力配置 */
  modelSettings: Record<string, ModelSettings>
}

/** 搜索服务提供商（独立于大模型提供商） */
export type SearchProvider = {
  id: string
  name: string
  kind: 'tavily' | 'bocha' | 'serper' | 'brave' | 'exa' | 'deepseek'
  apiKey: string
  presetId: string | null
}

/** 功能槽位：每个功能独立绑定「提供商 + 模型」 */
export type FeatureSlot = 'chat' | 'title' | 'image' | 'vision'

export type ModelBinding = { providerId: string; model: string } | null

type ProvidersState = {
  providers: Provider[]
  bindings: Record<FeatureSlot, ModelBinding>
  searchProviders: SearchProvider[]
  /** 当前启用的搜索服务 id；null 表示未启用 */
  activeSearchId: string | null
}

const STORAGE_KEY = 'kitechat:providers'

const read = (): ProvidersState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        Array.isArray((parsed as ProvidersState).providers)
      ) {
        const state = parsed as ProvidersState
        return {
          providers: state.providers.map((provider) => ({
            ...provider,
            kind: provider.kind ?? (provider.imageModels?.length && !provider.models?.length ? 'image' : 'chat'),
            modelSettings: provider.modelSettings ?? {},
          })),
          bindings: {
            chat: state.bindings?.chat ?? null,
            title: state.bindings?.title ?? null,
            image: state.bindings?.image ?? null,
            vision: state.bindings?.vision ?? null,
          },
          searchProviders: state.searchProviders ?? [],
          activeSearchId: state.activeSearchId ?? null,
        }
      }
    }
  } catch {
    // 存储不可用或数据损坏时从空状态开始
  }
  return {
    providers: [],
    bindings: { chat: null, title: null, image: null, vision: null },
    searchProviders: [],
    activeSearchId: null,
  }
}

const persist = (state: ProvidersState) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 存储不可用时只在内存中生效
  }
}

export const useProviders = create<ProvidersState>(() => read())

const commit = (update: (state: ProvidersState) => ProvidersState) => {
  useProviders.setState((state) => {
    const next = update(state)
    persist(next)
    return next
  })
}

/** 按预设创建提供商；同一预设可重复添加（不同 Key） */
export const addProviderFromPreset = (presetId: string): Provider | null => {
  const preset = getPreset(presetId)
  if (!preset) {
    return null
  }
  // 聊天模型不预置：由用户点击「拉取模型列表」加载
  const modelSettings: Record<string, ModelSettings> = {}
  const provider: Provider = {
    id: createId(),
    kind: 'chat',
    name: preset.name,
    baseUrl: preset.baseUrl,
    apiKey: '',
    protocol: preset.protocol,
    models: [],
    imageModels: [],
    thinkingStyle: preset.thinkingStyle,
    supportsModelList: preset.supportsModelList,
    presetId: preset.id,
    modelSettings,
  }
  commit((state) => ({ ...state, providers: [...state.providers, provider] }))
  return provider
}

export const addCustomProvider = (input: {
  name: string
  baseUrl: string
  protocol: ProviderProtocol
  kind?: ProviderKind
}): Provider => {
  const provider: Provider = {
    id: createId(),
    kind: input.kind ?? 'chat',
    name: input.name.trim() || input.baseUrl,
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ''),
    apiKey: '',
    protocol: input.protocol,
    models: [],
    imageModels: [],
    thinkingStyle: 'none',
    supportsModelList: true,
    presetId: null,
    modelSettings: {},
  }
  commit((state) => ({ ...state, providers: [...state.providers, provider] }))
  return provider
}

export const updateProvider = (id: string, patch: Partial<Omit<Provider, 'id'>>) => {
  commit((state) => {
    const providers = state.providers.map((provider) =>
      provider.id === id ? { ...provider, ...patch } : provider
    )
    const updated = providers.find((provider) => provider.id === id)
    // 联动：绑定指向的模型被移除时自动解绑
    const bindings = Object.fromEntries(
      Object.entries(state.bindings).map(([slot, binding]) => {
        if (binding?.providerId !== id || !updated) {
          return [slot, binding]
        }
        const pool = slot === 'image' ? updated.imageModels : updated.models
        return [slot, binding.model && !pool.includes(binding.model) ? null : binding]
      })
    ) as Record<FeatureSlot, ModelBinding>
    return { ...state, providers, bindings }
  })
}

/** 拉取模型后按预设能力初始化高级参数（识图/思考） */
export const initFetchedModelSettings = (provider: Provider, models: string[]) => {
  const preset = provider.presetId ? getPreset(provider.presetId) : undefined
  const patch: Record<string, ModelSettings> = {}
  for (const model of models) {
    if (!provider.modelSettings[model]) {
      patch[model] = {
        ...defaultModelSettings(),
        thinking: preset ? preset.thinkingStyle !== 'none' : false,
        vision: preset ? preset.visionModels.includes(model) : false,
      }
    }
  }
  if (Object.keys(patch).length > 0) {
    updateProvider(provider.id, { modelSettings: { ...provider.modelSettings, ...patch } })
  }
}

export const getModelSettings = (provider: Provider, model: string): ModelSettings =>
  provider.modelSettings[model] ?? defaultModelSettings()

export const setModelSettings = (
  providerId: string,
  model: string,
  patch: Partial<ModelSettings>
) => {
  commit((state) => ({
    ...state,
    providers: state.providers.map((provider) => {
      if (provider.id !== providerId) {
        return provider
      }
      const current = provider.modelSettings[model] ?? defaultModelSettings()
      return {
        ...provider,
        modelSettings: { ...provider.modelSettings, [model]: { ...current, ...patch } },
      }
    }),
  }))
}

/** 删除提供商时同步清理指向它的功能绑定 */
export const removeProvider = (id: string) => {
  commit((state) => ({
    providers: state.providers.filter((provider) => provider.id !== id),
    bindings: Object.fromEntries(
      Object.entries(state.bindings).map(([slot, binding]) => [
        slot,
        binding?.providerId === id ? null : binding,
      ])
    ) as Record<FeatureSlot, ModelBinding>,
    searchProviders: state.searchProviders,
    activeSearchId: state.activeSearchId,
  }))
}

export const setBinding = (slot: FeatureSlot, binding: ModelBinding) => {
  commit((state) => ({ ...state, bindings: { ...state.bindings, [slot]: binding } }))
}

export const getProvider = (id: string | null | undefined): Provider | undefined =>
  id ? useProviders.getState().providers.find((provider) => provider.id === id) : undefined

/** 功能槽位的当前绑定；未绑定或提供商已删除时返回 null */
export const getBinding = (slot: FeatureSlot): { provider: Provider; model: string } | null => {
  const binding = useProviders.getState().bindings[slot]
  if (!binding) {
    return null
  }
  const provider = getProvider(binding.providerId)
  if (!provider || !binding.model) {
    return null
  }
  return { provider, model: binding.model }
}

/** 聊天默认绑定：优先 chat 绑定；没有时取第一个已填 Key 的提供商及其首个模型 */
/** 本地推理端点无需 Key */
export const isLocalProvider = (provider: Provider): boolean =>
  provider.presetId === 'ollama' ||
  provider.presetId === 'lmstudio' ||
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(provider.baseUrl + '/')

export const providerReady = (provider: Provider): boolean =>
  Boolean(provider.apiKey) || isLocalProvider(provider)

export const resolveChatBinding = (): { provider: Provider; model: string } | null => {
  const bound = getBinding('chat')
  if (bound && providerReady(bound.provider) && bound.model) {
    return bound
  }
  const { providers } = useProviders.getState()
  const ready = providers.find(
    (provider) => provider.kind === 'chat' && providerReady(provider) && provider.models.length > 0
  )
  return ready ? { provider: ready, model: ready.models[0] } : null
}

/** 是否已具备发送条件（任一提供商填了 Key 且有模型） */
export const hasReadyProvider = (): boolean => resolveChatBinding() !== null

/** 按生图预设创建提供商 */
export const addImageProviderFromPreset = (presetId: string): Provider | null => {
  const preset = getImagePreset(presetId)
  if (!preset) {
    return null
  }
  const provider: Provider = {
    id: createId(),
    kind: 'image',
    name: preset.name,
    baseUrl: preset.baseUrl,
    apiKey: '',
    protocol: 'openai',
    models: [],
    imageModels: [...preset.imageModels],
    thinkingStyle: 'none',
    supportsModelList: false,
    presetId: preset.id,
    modelSettings: {},
  }
  commit((state) => ({ ...state, providers: [...state.providers, provider] }))
  return provider
}

// ---------- 搜索服务 ----------

export const addSearchProvider = (presetId: string): SearchProvider | null => {
  const preset = SEARCH_PRESETS.find((item) => item.id === presetId)
  if (!preset) {
    return null
  }
  const provider: SearchProvider = {
    id: createId(),
    name: preset.name,
    kind: preset.kind,
    apiKey: '',
    presetId: preset.id,
  }
  commit((state) => ({
    ...state,
    searchProviders: [...state.searchProviders, provider],
    activeSearchId: state.activeSearchId ?? provider.id,
  }))
  return provider
}

export const updateSearchProvider = (id: string, patch: Partial<Omit<SearchProvider, 'id'>>) => {
  commit((state) => ({
    ...state,
    searchProviders: state.searchProviders.map((provider) =>
      provider.id === id ? { ...provider, ...patch } : provider
    ),
  }))
}

export const removeSearchProvider = (id: string) => {
  commit((state) => ({
    ...state,
    searchProviders: state.searchProviders.filter((provider) => provider.id !== id),
    activeSearchId: state.activeSearchId === id ? null : state.activeSearchId,
  }))
}

export const setActiveSearch = (id: string | null) => {
  commit((state) => ({ ...state, activeSearchId: id }))
}

export const getActiveSearchProvider = (): SearchProvider | null => {
  const { searchProviders, activeSearchId } = useProviders.getState()
  const provider = searchProviders.find((item) => item.id === activeSearchId)
  return provider && provider.apiKey ? provider : null
}

export const SEARCH_PRESETS: { id: string; name: string; kind: SearchProvider['kind']; descKey: string }[] = [
  { id: 'deepseek-search', name: 'DeepSeek 搜索', kind: 'deepseek', descKey: 'presetDescDeepseekSearch' },
  { id: 'tavily', name: 'Tavily', kind: 'tavily', descKey: 'presetDescTavily' },
  { id: 'bocha', name: '博查 Bocha', kind: 'bocha', descKey: 'presetDescBocha' },
  { id: 'serper', name: 'Serper (Google)', kind: 'serper', descKey: 'presetDescSerper' },
  { id: 'brave', name: 'Brave Search', kind: 'brave', descKey: 'presetDescBrave' },
  { id: 'exa', name: 'Exa', kind: 'exa', descKey: 'presetDescExa' },
]