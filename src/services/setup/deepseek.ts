/** DeepSeek 一键配置：一个 Key 配齐聊天/识图/标题/搜索/语音 */
import {
  addProviderFromPreset,
  addSearchProvider,
  defaultModelSettings,
  getBinding,
  setBinding,
  updateProvider,
  updateSearchProvider,
  useProviders,
} from '../providers/store.js'
import { addSpeechFromPreset, updateSpeechProvider, useSpeech } from '../speech/store.js'
import { fetchModels } from '../api/gateway.js'

export const setupDeepseek = async (apiKey: string): Promise<void> => {
  const key = apiKey.trim()
  if (!key) {
    throw new Error('empty key')
  }
  // 聊天/识图提供商（已存在同预设则复用）
  let provider = useProviders.getState().providers.find((p) => p.presetId === 'deepseek')
  if (!provider) {
    provider = addProviderFromPreset('deepseek') ?? undefined
  }
  if (!provider) {
    throw new Error('preset missing')
  }
  updateProvider(provider.id, { apiKey: key, thinkingStyle: 'none' })
  // 拉取账号可用模型（失败则用保守默认）
  let models: string[] = []
  try {
    models = await fetchModels({ ...provider, apiKey: key })
  } catch {
    models = []
  }
  if (models.length === 0) {
    models = ['deepseek-chat']
  }
  const modelSettings = { ...provider.modelSettings }
  for (const model of models) {
    modelSettings[model] = {
      ...defaultModelSettings(),
      vision: true,
      thinking: false,
    }
  }
  updateProvider(provider.id, { models, modelSettings })
  const chatModel = models.includes('deepseek-chat') ? 'deepseek-chat' : models[0]
  setBinding('chat', { providerId: provider.id, model: chatModel })
  if (!getBinding('vision')) {
    setBinding('vision', { providerId: provider.id, model: chatModel })
  }
  if (!getBinding('title')) {
    setBinding('title', { providerId: provider.id, model: chatModel })
  }
  // 搜索服务
  let search = useProviders.getState().searchProviders.find((p) => p.presetId === 'deepseek-search')
  if (!search) {
    search = addSearchProvider('deepseek-search') ?? undefined
  }
  if (search) {
    updateSearchProvider(search.id, { apiKey: key })
  }
  // 语音服务
  let speech = useSpeech.getState().providers.find((p) => p.presetId === 'deepseek-speech')
  if (!speech) {
    speech = addSpeechFromPreset('deepseek-speech') ?? undefined
  }
  if (speech) {
    updateSpeechProvider(speech.id, { apiKey: key })
  }
}