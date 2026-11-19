/**
 * API 提供商预设模板，分「聊天 / 识图」与「生图」两类。
 * 端点按各厂商公开文档配置（截至 2026-11）；模型 ID 仅为常用示例，
 * 实际可用性以用户账号为准，可在应用内拉取模型列表或手填。
 */

import type { TranslationKey } from '../../i18n/index.js'

export type ProviderProtocol = 'openai' | 'anthropic'

/** 思考参数风格：不同厂商对「深度思考」的请求字段不同 */
export type ThinkingStyle =
  | 'none'
  | 'reasoning_effort'
  | 'deepseek'
  | 'glm'
  | 'enable_thinking'
  | 'kimi'
  | 'anthropic'

export type ProviderPreset = {
  id: string
  name: string
  descKey: TranslationKey
  baseUrl: string
  protocol: ProviderProtocol
  chatModels: string[]
  /** 常用识图（视觉）模型示例 */
  visionModels: string[]
  thinkingStyle: ThinkingStyle
  supportsModelList: boolean
  group: 'vendor' | 'aggregator' | 'local'
}

export type ImageProviderPreset = {
  id: string
  name: string
  descKey: TranslationKey
  baseUrl: string
  imageModels: string[]
  group: 'vendor' | 'aggregator'
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    descKey: 'presetDescDeepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    protocol: 'openai',
    chatModels: ['deepseek-chat', 'deepseek-reasoner'],
    visionModels: [],
    thinkingStyle: 'deepseek',
    supportsModelList: true,
    group: 'vendor',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    descKey: 'presetDescOpenai',
    baseUrl: 'https://api.openai.com/v1',
    protocol: 'openai',
    chatModels: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
    visionModels: ['gpt-4o', 'gpt-4o-mini'],
    thinkingStyle: 'reasoning_effort',
    supportsModelList: true,
    group: 'vendor',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    descKey: 'presetDescAnthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    protocol: 'anthropic',
    chatModels: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
    visionModels: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
    thinkingStyle: 'anthropic',
    supportsModelList: true,
    group: 'vendor',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    descKey: 'presetDescGemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    protocol: 'openai',
    chatModels: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    visionModels: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    thinkingStyle: 'reasoning_effort',
    supportsModelList: true,
    group: 'vendor',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    descKey: 'presetDescZhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    protocol: 'openai',
    chatModels: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'],
    visionModels: ['glm-4-plus', 'glm-4-air'],
    thinkingStyle: 'glm',
    supportsModelList: false,
    group: 'vendor',
  },
  {
    id: 'moonshot',
    name: '月之暗面 Kimi',
    descKey: 'presetDescMoonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    protocol: 'openai',
    chatModels: ['kimi-k2-0905-preview', 'moonshot-v1-8k', 'moonshot-v1-32k'],
    visionModels: ['kimi-k2-0905-preview', 'moonshot-v1-8k'],
    thinkingStyle: 'kimi',
    supportsModelList: true,
    group: 'vendor',
  },
  {
    id: 'dashscope',
    name: '阿里百炼 Qwen',
    descKey: 'presetDescDashscope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    protocol: 'openai',
    chatModels: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
    visionModels: ['qwen-max', 'qwen-plus'],
    thinkingStyle: 'enable_thinking',
    supportsModelList: true,
    group: 'vendor',
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    descKey: 'presetDescSiliconflow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    protocol: 'openai',
    chatModels: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
    visionModels: ['Qwen/Qwen2.5-72B-Instruct'],
    thinkingStyle: 'enable_thinking',
    supportsModelList: true,
    group: 'vendor',
  },
  {
    id: 'tokenrhythm',
    name: '基元律动 TokenRhythm',
    descKey: 'presetDescTokenrhythm',
    baseUrl: 'https://tokenrhythm.studio/v1',
    protocol: 'openai',
    chatModels: ['deepseek-v4-flash', 'glm-5.2', 'kimi-k2'],
    visionModels: ['deepseek-v4-flash', 'glm-5.2', 'kimi-k2'],
    thinkingStyle: 'none',
    supportsModelList: true,
    group: 'aggregator',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    descKey: 'presetDescOpenrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    protocol: 'openai',
    chatModels: ['openai/gpt-4o', 'anthropic/claude-sonnet-4.5', 'deepseek/deepseek-chat'],
    visionModels: ['openai/gpt-4o', 'anthropic/claude-sonnet-4.5'],
    thinkingStyle: 'none',
    supportsModelList: true,
    group: 'aggregator',
  },
  {
    id: 'ollama',
    name: 'Ollama（本地）',
    descKey: 'presetDescOllama',
    baseUrl: 'http://localhost:11434/v1',
    protocol: 'openai',
    chatModels: ['llama3.1', 'qwen2.5'],
    visionModels: [],
    thinkingStyle: 'none',
    supportsModelList: true,
    group: 'local',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio（本地）',
    descKey: 'presetDescLmstudio',
    baseUrl: 'http://localhost:1234/v1',
    protocol: 'openai',
    chatModels: [],
    visionModels: [],
    thinkingStyle: 'none',
    supportsModelList: true,
    group: 'local',
  },
]

/** 生图提供商预设（独立于聊天提供商；聚合站生图需单独配置） */
export const IMAGE_PROVIDER_PRESETS: ImageProviderPreset[] = [
  {
    id: 'openai-image',
    name: 'OpenAI 生图',
    descKey: 'presetDescOpenaiImage',
    baseUrl: 'https://api.openai.com/v1',
    imageModels: ['gpt-image-1', 'dall-e-3'],
    group: 'vendor',
  },
  {
    id: 'zhipu-image',
    name: '智谱 CogView',
    descKey: 'presetDescZhipuImage',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    imageModels: ['cogview-4', 'cogview-3-flash'],
    group: 'vendor',
  },
  {
    id: 'siliconflow-image',
    name: '硅基流动生图',
    descKey: 'presetDescSiliconflowImage',
    baseUrl: 'https://api.siliconflow.cn/v1',
    imageModels: ['black-forest-labs/FLUX.1-schnell', 'Qwen/Qwen-Image'],
    group: 'vendor',
  },
  {
    id: 'dashscope-image',
    name: '阿里百炼生图',
    descKey: 'presetDescDashscopeImage',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    imageModels: ['qwen-image', 'wanx2.1-t2i-turbo'],
    group: 'vendor',
  },
  {
    id: 'tokenrhythm-image',
    name: '基元律动生图',
    descKey: 'presetDescTokenrhythmImage',
    baseUrl: 'https://tokenrhythm.studio/v1',
    imageModels: ['wan2.7-image'],
    group: 'aggregator',
  },
  {
    id: 'openrouter-image',
    name: 'OpenRouter 生图',
    descKey: 'presetDescOpenrouterImage',
    baseUrl: 'https://openrouter.ai/api/v1',
    imageModels: ['google/gemini-2.5-flash-image'],
    group: 'aggregator',
  },
]

export const getPreset = (id: string): ProviderPreset | undefined =>
  PROVIDER_PRESETS.find((preset) => preset.id === id)

export const getImagePreset = (id: string): ImageProviderPreset | undefined =>
  IMAGE_PROVIDER_PRESETS.find((preset) => preset.id === id)