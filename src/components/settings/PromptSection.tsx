import { useTranslate } from '../../i18n/index.js'
import { setSystemPrompt, useSettings } from '../../services/settings.js'
import styles from './Settings.module.css'

const PRESETS: { labelKey: 'promptPresetConcise' | 'promptPresetTranslator' | 'promptPresetCoder' | 'promptPresetTeacher'; text: string }[] = [
  { labelKey: 'promptPresetConcise', text: '你是一位简洁专业的助手，回答直接、准确，避免冗余。' },
  { labelKey: 'promptPresetTranslator', text: '你是一位专业翻译，忠实原文、语言自然，保留术语与格式。' },
  { labelKey: 'promptPresetCoder', text: '你是一位资深工程师，给出可运行的代码与关键解释，遵循最佳实践。' },
  { labelKey: 'promptPresetTeacher', text: '你是一位耐心的老师，用类比和分步讲解帮助用户理解概念。' },
]

/** 系统提示词独立页：编辑 + 常用模板一键填入 */
export const PromptSection = () => {
  const t = useTranslate()
  const systemPrompt = useSettings((state) => state.systemPrompt)
  return (
    <div className={styles.providersSection}>
      <div className={styles.sectionHint}>{t('promptHint')}</div>
      <label className={styles.formField}>
        <span>{t('systemPromptLabel')}</span>
        <textarea
          className={styles.textarea}
          rows={10}
          value={systemPrompt}
          placeholder={t('systemPromptPlaceholder')}
          onChange={(event) => setSystemPrompt(event.target.value)}
        />
      </label>
      <div className={styles.formField}>
        <span>{t('promptPresetsLabel')}</span>
        <div className={styles.presetGrid}>
          {PRESETS.map((preset) => (
            <button
              key={preset.labelKey}
              type="button"
              className={styles.presetCard}
              onClick={() => setSystemPrompt(preset.text)}
            >
              <span className={styles.presetName}>{t(preset.labelKey)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className={styles.sectionHint}>{t('promptEmptyHint')}</div>
    </div>
  )
}