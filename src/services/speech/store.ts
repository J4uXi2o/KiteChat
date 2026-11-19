import { create } from 'zustand'
import { createId } from '../../utils/id.js'

/** 语音服务提供商（独立于聊天/生图） */
export type SpeechKind = 'deepseek' | 'openai' | 'siliconflow' | 'custom'

export type SpeechProvider = {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  kind: SpeechKind
  asrModel: string
  ttsModel: string
  ttsVoice: string
  presetId: string | null
}

export const SPEECH_PRESETS: {
  id: string
  name: string
  kind: SpeechKind
  baseUrl: string
  asrModel: string
  ttsModel: string
  ttsVoice: string
}[] = [
  { id: 'deepseek-speech', name: 'DeepSeek 语音', kind: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', asrModel: '', ttsModel: '', ttsVoice: 'stella' },
  { id: 'openai-speech', name: 'OpenAI 语音', kind: 'openai', baseUrl: 'https://api.openai.com/v1', asrModel: 'gpt-4o-transcribe', ttsModel: 'gpt-4o-mini-tts', ttsVoice: 'marin' },
  { id: 'siliconflow-speech', name: '硅基流动语音', kind: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1', asrModel: 'FunAudioLLM/SenseVoiceSmall', ttsModel: 'FunAudioLLM/CosyVoice2-0.5B', ttsVoice: 'FunAudioLLM/CosyVoice2-0.5B:alex' },
]

type SpeechState = {
  providers: SpeechProvider[]
  asrId: string | null
  ttsId: string | null
}

const KEY = 'kitechat:speech'

const read = (): SpeechState => {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as SpeechState
      if (Array.isArray(parsed.providers)) {
        // 旧版静态音色表迁移：DeepSeek 仅 stella/tide；硅基流动音色需带模型前缀
        const providers = parsed.providers.map((p) => {
          if (p.kind === 'deepseek' && p.ttsVoice !== 'stella' && p.ttsVoice !== 'tide') {
            return { ...p, ttsVoice: 'stella' }
          }
          if (p.kind === 'siliconflow' && p.ttsVoice && !p.ttsVoice.includes(':') && !p.ttsVoice.startsWith('speech:')) {
            return { ...p, ttsVoice: `${p.ttsModel || 'FunAudioLLM/CosyVoice2-0.5B'}:${p.ttsVoice}` }
          }
          return p
        })
        return { providers, asrId: parsed.asrId ?? null, ttsId: parsed.ttsId ?? null }
      }
    }
  } catch {
    // 忽略损坏数据
  }
  return { providers: [], asrId: null, ttsId: null }
}

const persist = (state: SpeechState) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // 仅内存生效
  }
}

const initialState = read()
try {
  localStorage.setItem(KEY, JSON.stringify(initialState))
} catch {
  // 仅内存生效
}

export const useSpeech = create<SpeechState>(() => initialState)

const commit = (update: (state: SpeechState) => SpeechState) => {
  useSpeech.setState((state) => {
    const next = update(state)
    persist(next)
    return next
  })
}

export const addSpeechFromPreset = (presetId: string): SpeechProvider | null => {
  const preset = SPEECH_PRESETS.find((item) => item.id === presetId)
  if (!preset) {
    return null
  }
  const existing = useSpeech.getState().providers.find((p) => p.presetId === presetId)
  if (existing) {
    return existing
  }
  const provider: SpeechProvider = {
    id: createId(),
    name: preset.name,
    baseUrl: preset.baseUrl,
    apiKey: '',
    kind: preset.kind,
    asrModel: preset.asrModel,
    ttsModel: preset.ttsModel,
    ttsVoice: preset.ttsVoice,
    presetId: preset.id,
  }
  commit((state) => ({
    ...state,
    providers: [...state.providers, provider],
    asrId: state.asrId ?? provider.id,
    ttsId: state.ttsId ?? provider.id,
  }))
  return provider
}

export const addCustomSpeech = (input: { name: string; baseUrl: string }): SpeechProvider => {
  const provider: SpeechProvider = {
    id: createId(),
    name: input.name || input.baseUrl,
    baseUrl: input.baseUrl.replace(/\/+$/, ''),
    apiKey: '',
    kind: 'custom',
    asrModel: 'whisper-1',
    ttsModel: 'gpt-4o-mini-tts',
    ttsVoice: 'alloy',
    presetId: null,
  }
  commit((state) => ({ ...state, providers: [...state.providers, provider] }))
  return provider
}

export const updateSpeechProvider = (id: string, patch: Partial<Omit<SpeechProvider, 'id'>>) => {
  commit((state) => ({
    ...state,
    providers: state.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  }))
}

export const removeSpeechProvider = (id: string) => {
  commit((state) => ({
    providers: state.providers.filter((p) => p.id !== id),
    asrId: state.asrId === id ? null : state.asrId,
    ttsId: state.ttsId === id ? null : state.ttsId,
  }))
}

export const setSpeechSlot = (slot: 'asr' | 'tts', id: string | null) => {
  commit((state) => ({ ...state, [slot === 'asr' ? 'asrId' : 'ttsId']: id }))
}

export const getSpeechProvider = (id: string | null): SpeechProvider | null => {
  if (!id) {
    return null
  }
  const provider = useSpeech.getState().providers.find((p) => p.id === id)
  return provider && provider.apiKey ? provider : null
}