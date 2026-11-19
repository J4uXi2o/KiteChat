/** 各语音协议官方音色（2026-11 核对官方文档）；label 仅展示，value 为请求用 id */
export type VoiceOption = { value: string; label: string }

const named = (entries: [string, string][]): VoiceOption[] =>
  entries.map(([value, label]) => ({ value, label }))

export const DEEPSEEK_VOICES: VoiceOption[] = named([
  ['stella', 'stella · 海星（女声，默认）'],
  ['tide', 'tide · 暗潮（男声）'],
])

export const OPENAI_VOICES: VoiceOption[] = named([
  ['marin', 'marin（官方推荐）'],
  ['cedar', 'cedar（官方推荐）'],
  ['alloy', 'alloy'],
  ['ash', 'ash'],
  ['ballad', 'ballad'],
  ['coral', 'coral'],
  ['echo', 'echo'],
  ['fable', 'fable'],
  ['onyx', 'onyx'],
  ['nova', 'nova'],
  ['sage', 'sage'],
  ['shimmer', 'shimmer'],
  ['verse', 'verse'],
])

/** tts-1 / tts-1-hd 仅支持 9 音色子集 */
export const OPENAI_LEGACY_VOICES: VoiceOption[] = OPENAI_VOICES.filter((v) =>
  ['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'].includes(v.value)
)

const SF_VOICE_NAMES: [string, string][] = [
  ['alex', 'alex · 男声沉稳'],
  ['anna', 'anna · 女声沉稳'],
  ['bella', 'bella · 女声激情'],
  ['benjamin', 'benjamin · 男声低沉'],
  ['charles', 'charles · 男声磁性'],
  ['claire', 'claire · 女声温柔'],
  ['david', 'david · 男声欢快'],
  ['diana', 'diana · 女声欢快'],
]

/** 硅基流动 voice 必须带模型前缀，如 FunAudioLLM/CosyVoice2-0.5B:alex */
export const siliconflowVoices = (model: string): VoiceOption[] =>
  SF_VOICE_NAMES.map(([id, label]) => ({ value: `${model}:${id}`, label }))

export const voiceOptionsFor = (kind: string, ttsModel: string): VoiceOption[] => {
  if (kind === 'deepseek') return DEEPSEEK_VOICES
  if (kind === 'openai') {
    return ttsModel === 'tts-1' || ttsModel === 'tts-1-hd' ? OPENAI_LEGACY_VOICES : OPENAI_VOICES
  }
  if (kind === 'siliconflow') return siliconflowVoices(ttsModel || 'FunAudioLLM/CosyVoice2-0.5B')
  return OPENAI_VOICES
}

export const voiceLabel = (kind: string, ttsModel: string, value: string): string =>
  voiceOptionsFor(kind, ttsModel).find((v) => v.value === value)?.label ?? value
