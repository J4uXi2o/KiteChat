import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { nativeFetch } from '../../services/native.js'
import { copyText } from '../../utils/clipboard.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import styles from './Settings.module.css'

export const REPO_URL = 'https://github.com/J4uXi2o/KiteChat'
export const SITE_URL = 'https://j4uxi2o.github.io/KiteChat/'
export const FEEDBACK_EMAIL = '58468680@qq.com'
export const QQ_GROUP = '195425971'

const openExternal = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** 数字分段比较版本号 */
const compareVersions = (a: string, b: string): number => {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) {
      return d
    }
  }
  return 0
}

/** 关于页：版本与更新、反馈邮箱、官网、仓库、QQ 群 */
export const AboutSection = () => {
  const t = useTranslate()
  const [checking, setChecking] = useState(false)
  const [latest, setLatest] = useState<{ tag: string; url: string } | null>(null)

  const checkUpdate = async () => {
    if (checking) {
      return
    }
    setChecking(true)
    setLatest(null)
    try {
      const result = await nativeFetch({
        url: 'https://api.github.com/repos/J4uXi2o/KiteChat/releases/latest',
        method: 'GET',
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'KiteChat' },
      })
      if (result.status === 200 && result.body) {
        const data = JSON.parse(result.body) as {
          tag_name?: string
          html_url?: string
          assets?: { name?: string; browser_download_url?: string }[]
        }
        const tag = (data.tag_name ?? '').replace(/^v/, '')
        const apk = data.assets?.find((a) => (a.name ?? '').endsWith('.apk'))
        if (tag && compareVersions(tag, __APP_VERSION__) > 0) {
          setLatest({ tag, url: apk?.browser_download_url ?? data.html_url ?? `${REPO_URL}/releases` })
        } else {
          showToast({ key: 'aboutLatest' })
        }
      } else {
        showToast({ key: 'aboutUpdateFailed', type: 'error' })
      }
    } catch {
      showToast({ key: 'aboutUpdateFailed', type: 'error' })
    } finally {
      setChecking(false)
    }
  }

  const copy = async (value: string) => {
    const ok = await copyText(value)
    showToast(ok ? { key: 'copied' } : { key: 'copyFailed', type: 'error' })
  }

  return (
    <div className={styles.providersSection}>
      <div className={styles.slotCard}>
        <div className={styles.providerHead}>
          <span className={styles.providerName}>KiteChat</span>
          <span className={styles.sectionHint}>v{__APP_VERSION__}</span>
        </div>
        <div className={styles.sectionHint}>{t('aboutDescription')}</div>
        <div className={styles.keyRow}>
          <Button variant="outlined" size="s" disabled={checking} onClick={() => void checkUpdate()}>
            {t(checking ? 'aboutChecking' : 'aboutCheckUpdate')}
          </Button>
          {latest ? (
            <Button variant="primary" size="s" onClick={() => openExternal(latest.url)}>
              {t('aboutNewVersion', { version: latest.tag })}
            </Button>
          ) : null}
        </div>
      </div>
      <div className={styles.slotCard}>
        <div className={styles.providerHead}>
          <span className={styles.providerName}>{t('aboutWebsite')}</span>
          <Button variant="outlined" size="s" onClick={() => openExternal(SITE_URL)}>
            {t('aboutOpen')}
          </Button>
        </div>
        <div className={styles.sectionHint}>{SITE_URL}</div>
      </div>
      <div className={styles.slotCard}>
        <div className={styles.providerHead}>
          <span className={styles.providerName}>{t('aboutRepo')}</span>
          <Button variant="outlined" size="s" onClick={() => openExternal(REPO_URL)}>
            {t('aboutOpen')}
          </Button>
        </div>
        <div className={styles.sectionHint}>{REPO_URL}</div>
      </div>
      <div className={styles.slotCard}>
        <div className={styles.providerHead}>
          <span className={styles.providerName}>{t('aboutEmail')}</span>
          <Button variant="outlined" size="s" onClick={() => void copy(FEEDBACK_EMAIL)}>
            {t('copy')}
          </Button>
        </div>
        <div className={styles.sectionHint}>{FEEDBACK_EMAIL}</div>
      </div>
      <div className={styles.slotCard}>
        <div className={styles.providerHead}>
          <span className={styles.providerName}>{t('aboutQQ')}</span>
          <Button variant="outlined" size="s" onClick={() => void copy(QQ_GROUP)}>
            {t('copy')}
          </Button>
        </div>
        <div className={styles.sectionHint}>{QQ_GROUP}</div>
      </div>
      <div className={styles.sectionHint}>{t('aboutLicense')}</div>
    </div>
  )
}
