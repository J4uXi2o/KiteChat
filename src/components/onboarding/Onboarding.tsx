import { useState } from 'react'
import { create } from 'zustand'
import { useTranslate } from '../../i18n/index.js'
import { hasReadyProvider } from '../../services/providers/store.js'
import { setupDeepseek } from '../../services/setup/deepseek.js'
import { Button } from '../base/Button.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { showToast } from '../base/toastState.js'
import styles from './Onboarding.module.css'

const ONBOARDED_KEY = 'kitechat:onboarded'

export const useOnboarding = create<{ show: boolean }>(() => ({ show: false }))

/** 首次启动且未配置提供商时展示引导 */
export const maybeShowOnboarding = () => {
  try {
    if (localStorage.getItem(ONBOARDED_KEY)) {
      return
    }
  } catch {
    return
  }
  if (!hasReadyProvider()) {
    useOnboarding.setState({ show: true })
  }
}

export const finishOnboarding = () => {
  try {
    localStorage.setItem(ONBOARDED_KEY, '1')
  } catch {
    // 忽略存储失败
  }
  useOnboarding.setState({ show: false })
}

/** 引导：输入 DeepSeek Key 一键配置聊天/识图/搜索/语音，或手动配置 */
export const Onboarding = () => {
  const t = useTranslate()
  const show = useOnboarding((state) => state.show)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  if (!show) {
    return null
  }

  const runSetup = async () => {
    if (busy || !apiKey.trim()) {
      return
    }
    setBusy(true)
    try {
      await setupDeepseek(apiKey)
      setDone(true)
      showToast({ key: 'onboardSetupDone' })
    } catch {
      showToast({ key: 'onboardSetupFailed', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.title}>{t(done ? 'onboardDoneTitle' : 'onboardWelcomeTitle')}</div>
        <div className={styles.body}>
          {t(done ? 'onboardDoneBody' : 'onboardWelcomeBody')}
        </div>
        {done ? (
          <div className={styles.actions}>
            <Button onClick={finishOnboarding}>{t('onboardStart')}</Button>
          </div>
        ) : (
          <>
            <input
              className={styles.keyInput}
              type="password"
              value={apiKey}
              placeholder={t('onboardKeyPlaceholder')}
              autoComplete="off"
              onChange={(event) => setApiKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void runSetup()
                }
              }}
            />
            <div className={styles.featureList}>{t('onboardFeatureList')}</div>
            <div className={styles.actions}>
              <Button
                variant="outlined"
                onClick={() => {
                  finishOnboarding()
                  openSettings('providers')
                }}
              >
                {t('onboardManual')}
              </Button>
              <Button disabled={busy || !apiKey.trim()} onClick={() => void runSetup()}>
                {t(busy ? 'onboardSettingUp' : 'onboardOneClick')}
              </Button>
            </div>
            <button type="button" className={styles.skip} onClick={finishOnboarding}>
              {t('onboardSkip')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}