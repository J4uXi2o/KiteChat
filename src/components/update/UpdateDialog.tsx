import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { useTranslate } from '../../i18n/index.js'
import { nativeFetch } from '../../services/native.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { compareVersions, openExternal, REPO_URL } from '../settings/AboutSection.js'
import settingsStyles from '../settings/Settings.module.css'

type UpdateInfo = { tag: string; url: string; notes: string }

const useUpdateStore = create<{ info: UpdateInfo | null }>(() => ({ info: null }))

const CHECK_KEY = 'kitechat:updateCheckedAt'
const SKIP_KEY = 'kitechat:updateSkipped'
const DAY_MS = 24 * 60 * 60 * 1000

/** 启动后静默检查更新：每天最多一次；跳过过的版本不再弹 */
export const maybeCheckUpdate = () => {
  window.setTimeout(() => {
    void (async () => {
      try {
        const last = Number(localStorage.getItem(CHECK_KEY) ?? 0)
        if (Date.now() - last < DAY_MS) {
          return
        }
        localStorage.setItem(CHECK_KEY, String(Date.now()))
        const result = await nativeFetch({
          url: 'https://api.github.com/repos/J4uXi2o/KiteChat/releases/latest',
          method: 'GET',
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'KiteChat' },
        })
        if (result.status !== 200 || !result.body) {
          return
        }
        const data = JSON.parse(result.body) as {
          tag_name?: string
          html_url?: string
          body?: string
          assets?: { name?: string; browser_download_url?: string }[]
        }
        const tag = (data.tag_name ?? '').replace(/^v/, '')
        if (!tag || compareVersions(tag, __APP_VERSION__) <= 0) {
          return
        }
        if (localStorage.getItem(SKIP_KEY) === tag) {
          return
        }
        const apk = data.assets?.find((asset) => (asset.name ?? '').endsWith('.apk'))
        useUpdateStore.setState({
          info: {
            tag,
            url: apk?.browser_download_url ?? data.html_url ?? `${REPO_URL}/releases`,
            notes: (data.body ?? '').trim(),
          },
        })
      } catch {
        // 静默失败：不打扰用户
      }
    })()
  }, 6000)
}

/** 更新提示窗：去下载 / 跳过此版本 */
export const UpdateDialog = () => {
  const t = useTranslate()
  const info = useUpdateStore((state) => state.info)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (info) {
      setVisible(true)
    }
  }, [info])
  if (!info || !visible) {
    return null
  }
  return (
    <Modal
      title={t('updateAvailableTitle', { version: info.tag })}
      closable
      onClose={() => setVisible(false)}
      footer={
        <>
          <Button
            variant="outlined"
            size="m"
            onClick={() => {
              localStorage.setItem(SKIP_KEY, info.tag)
              setVisible(false)
            }}
          >
            {t('updateSkipVersion')}
          </Button>
          <Button
            variant="primary"
            size="m"
            onClick={() => {
              openExternal(info.url)
              setVisible(false)
            }}
          >
            {t('updateDownload')}
          </Button>
        </>
      }
    >
      <div className={settingsStyles.sectionHint}>{t('aboutDescription')}</div>
      {info.notes ? <div className={settingsStyles.updateNotes}>{info.notes}</div> : null}
    </Modal>
  )
}
