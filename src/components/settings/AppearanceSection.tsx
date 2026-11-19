import clsx from 'clsx'
import { type ReactNode } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  setAccentColor,
  setCustomTheme,
  setFontScale,
  setRadius,
  setThemeId,
  setThemePreference,
  useSettings,
  type ThemePreference,
} from '../../services/settings.js'
import { THEME_PRESETS } from '../../app/themes.js'
import {
  IconDarkOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
} from '../base/icons.js'
import { Button } from '../base/Button.js'
import styles from './Settings.module.css'

const ACCENTS = ['#3964fe', '#a78bfa', '#ec4899', '#34d399', '#38bdf8', '#d97706', '#f43f5e', '#64748b']

const modeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  { value: 'light', label: 'avatarMenuSettingsDialogThemeSelectLightOption', icon: <IconLightOutline16 /> },
  { value: 'dark', label: 'avatarMenuSettingsDialogThemeSelectDarkOption', icon: <IconDarkOutline16 /> },
  { value: 'system', label: 'avatarMenuSettingsDialogThemeSelectSystemOption', icon: <IconFollowsystemOutline16 /> },
]

/** rgb()/rgba() 或 #hex 归一为 #rrggbb，供取色器使用 */
const toHex = (value: string, fallback: string): string => {
  const v = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) {
    return v
  }
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return '#' + v.slice(1).split('').map((c) => c + c).join('')
  }
  const m = /rgba?\(([^)]+)\)/.exec(v)
  if (m) {
    const parts = m[1].split(',').map((p) => parseFloat(p))
    if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
      return (
        '#' +
        parts.slice(0, 3).map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')
      )
    }
  }
  return fallback
}

const readVar = (name: string, fallback: string): string => {
  if (typeof window === 'undefined') {
    return fallback
  }
  return toHex(getComputedStyle(document.body).getPropertyValue(name), fallback)
}

/** 调色板槽位：背景 / 面板 / 文字 / 强调 */
const PALETTE: { key: string; vars: string[]; fallback: string; labelKey: TranslationKey }[] = [
  { key: 'bg', vars: ['--dsw-alias-bg-base'], fallback: '#ffffff', labelKey: 'paletteBg' },
  { key: 'panel', vars: ['--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3', '--dsw-specific-input-major', '--dsw-specific-sidebar-fill'], fallback: '#f9fafb', labelKey: 'palettePanel' },
  { key: 'text', vars: ['--dsw-alias-label-primary'], fallback: '#0f1115', labelKey: 'paletteText' },
  { key: 'accent', vars: ['--dsw-alias-brand-primary', '--dsw-alias-brand-text', '--dsw-alias-button-primary-fill'], fallback: '#3964fe', labelKey: 'paletteAccent' },
]

/** 外观：主题预设、深浅色、强调色、字号圆角、可视化调色板 */
export const AppearanceSection = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const themeId = useSettings((state) => state.themeId)
  const accentColor = useSettings((state) => state.accentColor)
  const fontScale = useSettings((state) => state.fontScale)
  const radius = useSettings((state) => state.radius)
  const customTheme = useSettings((state) => state.customTheme)

  const setPalette = (vars: string[], color: string) => {
    const next = { ...(customTheme ?? {}) }
    for (const v of vars) {
      next[v] = color
    }
    setCustomTheme(next)
  }

  return (
    <div className={styles.providersSection}>
      <div className={styles.theme}>
        {t('avatarMenuSettingsDialogThemeItemLabel')}
        <div role="radiogroup" aria-label={t('avatarMenuSettingsDialogThemeItemLabel')} className={styles.themeOptions}>
          {modeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={themePreference === option.value}
              className={clsx(styles.themeOption, themePreference === option.value && styles.themeOptionSelected)}
              onClick={() => setThemePreference(option.value)}
            >
              {option.icon}
              {t(option.label)}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.formField}>
        <span>{t('themePresetsLabel')}</span>
        <div className={styles.themeGrid}>
          {THEME_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={clsx(styles.themeCard, themeId === preset.id && styles.themeCardActive)}
              onClick={() => setThemeId(preset.id)}
            >
              <span className={styles.themeSwatch}>
                {preset.swatch.map((color, index) => (
                  <span key={index} style={{ background: color }} />
                ))}
              </span>
              <span className={styles.themeCardName}>{t(preset.nameKey)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className={styles.formField}>
        <span>{t('accentColorLabel')}</span>
        <div className={styles.accentRow}>
          <button
            type="button"
            className={clsx(styles.accentDot, styles.accentAuto, !accentColor && styles.accentActive)}
            aria-label={t('accentAuto')}
            onClick={() => setAccentColor(null)}
          >
            A
          </button>
          {ACCENTS.map((color) => (
            <button
              key={color}
              type="button"
              className={clsx(styles.accentDot, accentColor === color && styles.accentActive)}
              style={{ background: color }}
              aria-label={color}
              onClick={() => setAccentColor(color)}
            />
          ))}
          <input
            type="color"
            className={styles.accentPicker}
            value={accentColor ?? '#3964fe'}
            aria-label={t('accentColorLabel')}
            onChange={(event) => setAccentColor(event.target.value)}
          />
        </div>
      </div>
      <label className={styles.formField}>
        <span>
          {t('fontScaleLabel')}（{Math.round(fontScale * 100)}%）
        </span>
        <input
          type="range"
          min={0.85}
          max={1.25}
          step={0.05}
          value={fontScale}
          onChange={(event) => setFontScale(Number(event.target.value))}
        />
      </label>
      <label className={styles.formField}>
        <span>
          {t('radiusLabel')}（{radius}px）
        </span>
        <input
          type="range"
          min={0}
          max={24}
          step={2}
          value={radius}
          onChange={(event) => setRadius(Number(event.target.value))}
        />
      </label>
      <div className={styles.formField}>
        <div className={styles.modelListHead}>
          <span>{t('paletteTitle')}</span>
          <Button variant="outlined" size="s" onClick={() => setCustomTheme(null)}>
            {t('paletteReset')}
          </Button>
        </div>
        <div className={styles.paletteGrid}>
          {PALETTE.map((slot) => {
            const current = customTheme?.[slot.vars[0]]
            const value = toHex(current ?? readVar(slot.vars[0], slot.fallback), slot.fallback)
            return (
              <label key={slot.key} className={styles.paletteCell}>
                <input
                  type="color"
                  className={styles.paletteSwatch}
                  value={value}
                  aria-label={t(slot.labelKey)}
                  onChange={(event) => setPalette(slot.vars, event.target.value)}
                />
                <span className={styles.paletteLabel}>{t(slot.labelKey)}</span>
                <span className={styles.paletteHex}>{value}</span>
              </label>
            )
          })}
        </div>
        <div className={styles.sectionHint}>{t('paletteHint')}</div>
      </div>
    </div>
  )
}