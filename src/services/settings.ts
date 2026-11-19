import { create } from 'zustand'

export type Locale = 'zh-CN' | 'en-US'

/** 深浅色模式；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 主题外观 id：default 为内置基础主题，其余见 app/themes.ts */
export type ThemeId = string

/** 本机设置，全部存 localStorage，不上传任何服务 */
type Settings = {
  locale: Locale
  themePreference: ThemePreference
  themeId: ThemeId
  /** 自定义强调色（hex）；null 表示使用主题默认 */
  accentColor: string | null
  /** 自定义主题 JSON（变量覆盖表）；null 表示未启用 */
  customTheme: Record<string, string> | null
  /** 正文字号缩放 */
  fontScale: number
  /** 圆角基数（px） */
  radius: number
  /** 深度思考开关（按提供商能力转成对应请求字段） */
  thinking: boolean
  /** 生图模式：输入内容作为提示词发给生图模型 */
  imageMode: boolean
  imageSize: string
  imageCount: number
  readLinks: boolean
  /** 联网搜索开关（需配置搜索服务） */
  search: boolean
  /** 每次搜索返回条数上限 */
  searchMaxResults: number
  /** 用户自定义系统提示词 */
  systemPrompt: string
  siderCollapsed: boolean
}

const KEYS = {
  locale: 'kitechat:locale',
  themePreference: 'kitechat:theme-preference',
  themeId: 'kitechat:theme-id',
  accentColor: 'kitechat:accent-color',
  customTheme: 'kitechat:custom-theme',
  fontScale: 'kitechat:font-scale',
  radius: 'kitechat:radius',
  thinking: 'kitechat:thinking',
  imageMode: 'kitechat:image-mode',
  imageSize: 'kitechat:image-size',
  imageCount: 'kitechat:image-count',
  readLinks: 'kitechat:read-links',
  search: 'kitechat:search',
  searchMaxResults: 'kitechat:search-max-results',
  systemPrompt: 'kitechat:system-prompt',
  siderCollapsed: 'kitechat:sider-collapsed',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

const initialThemeId = (): ThemeId => read(KEYS.themeId) ?? 'default'

const initialCustomTheme = (): Record<string, string> | null => {
  try {
    const parsed: unknown = JSON.parse(read(KEYS.customTheme) ?? 'null')
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed).filter(
        ([key, value]) => key.startsWith('--') && typeof value === 'string'
      )
      return entries.length > 0 ? Object.fromEntries(entries) : null
    }
  } catch {
    // 损坏的自定义主题按未启用处理
  }
  return null
}

const initialNumber = (key: string, fallback: number, min: number, max: number): number => {
  const value = Number(read(key))
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback
}

export const useSettings = create<Settings>(() => ({
  locale: initialLocale(),
  themePreference: initialThemePreference(),
  themeId: initialThemeId(),
  accentColor: read(KEYS.accentColor),
  customTheme: initialCustomTheme(),
  fontScale: initialNumber(KEYS.fontScale, 1, 0.85, 1.25),
  radius: initialNumber(KEYS.radius, 12, 0, 24),
  thinking: read(KEYS.thinking) === 'true',
  imageMode: read(KEYS.imageMode) === 'true',
  imageSize: read(KEYS.imageSize) ?? 'auto',
  imageCount: Math.min(4, Math.max(1, Number(read(KEYS.imageCount)) || 1)),
  readLinks: read(KEYS.readLinks) !== 'false',
  search: read(KEYS.search) === 'true',
  searchMaxResults: Math.min(50, Math.max(1, Number(read(KEYS.searchMaxResults)) || 20)),
  systemPrompt: read(KEYS.systemPrompt) ?? '',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setThemeId = (themeId: ThemeId) => {
  write(KEYS.themeId, themeId)
  useSettings.setState({ themeId })
}

export const setAccentColor = (accentColor: string | null) => {
  write(KEYS.accentColor, accentColor)
  useSettings.setState({ accentColor })
}

export const setCustomTheme = (customTheme: Record<string, string> | null) => {
  write(KEYS.customTheme, customTheme ? JSON.stringify(customTheme) : null)
  useSettings.setState({ customTheme })
}

export const setFontScale = (fontScale: number) => {
  write(KEYS.fontScale, String(fontScale))
  useSettings.setState({ fontScale })
}

export const setRadius = (radius: number) => {
  write(KEYS.radius, String(radius))
  useSettings.setState({ radius })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setImageMode = (imageMode: boolean) => {
  write(KEYS.imageMode, String(imageMode))
  useSettings.setState({ imageMode })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSearchMaxResults = (searchMaxResults: number) => {
  const value = Math.min(50, Math.max(1, Math.round(searchMaxResults) || 20))
  write(KEYS.searchMaxResults, String(value))
  useSettings.setState({ searchMaxResults: value })
}

export const setImageSize = (imageSize: string) => {
  write(KEYS.imageSize, imageSize)
  useSettings.setState({ imageSize })
}

export const setImageCount = (imageCount: number) => {
  write(KEYS.imageCount, String(imageCount))
  useSettings.setState({ imageCount })
}

export const setReadLinks = (readLinks: boolean) => {
  write(KEYS.readLinks, String(readLinks))
  useSettings.setState({ readLinks })
}

export const setSystemPrompt = (systemPrompt: string) => {
  write(KEYS.systemPrompt, systemPrompt || null)
  useSettings.setState({ systemPrompt })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}
