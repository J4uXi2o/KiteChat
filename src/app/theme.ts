import { useSyncExternalStore } from 'react'
import { useSettings, type ThemePreference } from '../services/settings.js'
import { getBridge } from '../services/native.js'
import { accentVars, getThemePreset } from './themes.js'

export type Theme = 'light' | 'dark'

const query = window.matchMedia('(prefers-color-scheme: dark)')

const subscribeOsTheme = (listener: () => void) => {
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

const getOsTheme = (): Theme => (query.matches ? 'dark' : 'light')

const resolveTheme = (preference: ThemePreference, osTheme: Theme): Theme =>
  preference === 'system' ? osTheme : preference

/** 当前实际生效的深浅色：主题预设强制模式优先，其次手动选择，「跟随系统」取系统设置 */
export const useTheme = (): Theme => {
  const preference = useSettings((state) => state.themePreference)
  const themeId = useSettings((state) => state.themeId)
  const osTheme = useSyncExternalStore(subscribeOsTheme, getOsTheme)
  const forced = getThemePreset(themeId)?.mode
  return forced ?? resolveTheme(preference, osTheme)
}

const syncPageBackground = () => {
  const backgroundColor = getComputedStyle(document.body).backgroundColor
  document.documentElement.style.backgroundColor = backgroundColor
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', backgroundColor)
}

/** 本引擎写入的变量，切换主题时先全部清除再重新应用 */
let appliedVars: string[] = []

const applyVars = (vars: Record<string, string>) => {
  const body = document.body
  for (const name of appliedVars) {
    body.style.removeProperty(name)
  }
  appliedVars = Object.keys(vars)
  for (const [name, value] of Object.entries(vars)) {
    body.style.setProperty(name, value)
  }
}

/** 同步页面主题、主题变量、根画布背景和支持 theme-color 的浏览器栏。 */
const applyTheme = (theme: Theme) => {
  const body = document.body
  const { themeId, accentColor, customTheme, fontScale, radius } = useSettings.getState()
  // 主题切换帧禁用过渡，使页面颜色同步更新
  body.classList.add('change-theme')
  body.classList.toggle('dark', theme === 'dark')
  body.classList.toggle('light', theme === 'light')
  if (theme === 'dark') {
    body.setAttribute('data-ds-dark-theme', 'dark')
  } else {
    body.removeAttribute('data-ds-dark-theme')
  }
  document.documentElement.style.colorScheme = theme
  getBridge()?.setNativeTheme?.(theme === 'dark')

  const vars: Record<string, string> = {
    ...(getThemePreset(themeId)?.vars ?? {}),
    ...(accentColor ? accentVars(accentColor) : {}),
    ...(customTheme ?? {}),
    '--kitechat-font-scale': String(fontScale),
    '--kitechat-radius': `${radius}px`,
  }
  applyVars(vars)

  if (document.readyState === 'complete') {
    syncPageBackground()
  }
  setTimeout(() => {
    body.classList.remove('change-theme')
  }, 0)
}

let appliedKey = ''

const syncTheme = () => {
  const { themePreference, themeId, accentColor, customTheme, fontScale, radius } =
    useSettings.getState()
  const theme = getThemePreset(themeId)?.mode ?? resolveTheme(themePreference, getOsTheme())
  const key = JSON.stringify([theme, themeId, accentColor, customTheme, fontScale, radius])
  if (key !== appliedKey) {
    appliedKey = key
    applyTheme(theme)
  }
}

/** 首屏渲染前同步应用一次，之后随主题设置与系统深浅色变化更新 */
export const setupTheme = () => {
  syncTheme()
  if (document.readyState !== 'complete') {
    window.addEventListener('load', syncPageBackground, { once: true })
  }
  query.addEventListener('change', syncTheme)
  useSettings.subscribe(syncTheme)
}