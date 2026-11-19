import { create } from 'zustand'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { loadFile } from '../../services/chat/db.js'
import { IconCloseFill14, IconDownloadOutline16 } from './icons.js'
import { showToast } from './toastState.js'
import styles from './ImageViewer.module.css'

type ViewerState = { url: string | null; name: string }

export const useImageViewer = create<ViewerState>(() => ({ url: null, name: '' }))

export const openImageViewer = (url: string, name: string) =>
  useImageViewer.setState({ url, name })

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })

/** 全屏图片查看器：应用内查看，保存走原生相册，浏览器兜底下载 */
export const ImageViewer = () => {
  const t = useTranslate()
  const { url, name } = useImageViewer()
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [url])

  if (!url) {
    return null
  }
  const close = () => {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url)
    }
    useImageViewer.setState({ url: null, name: '' })
  }

  const save = async () => {
    if (saving) {
      return
    }
    setSaving(true)
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      const fileName = name || `kitechat-${Date.now()}.png`
      const bridge = window.KiteNative
      if (bridge?.saveImage) {
        const base64 = await blobToBase64(blob)
        const mime = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/png'
        const result = bridge.saveImage(base64, mime, fileName)
        if (result === 'ok') {
          showToast({ key: 'imageSaved' })
        } else {
          showToast({ key: 'imageSaveFailedDetail', params: { message: result }, type: 'error' })
        }
      } else {
        const link = document.createElement('a')
        link.href = url
        link.download = fileName
        link.click()
        showToast({ key: 'imageSaved' })
      }
    } catch {
      showToast({ key: 'imageSaveFailed', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={close} role="dialog" aria-label={t('imageViewerTitle')}>
      <div className={styles.bar} onClick={(event) => event.stopPropagation()}>
        <button type="button" className={styles.barButton} onClick={close} aria-label={t('close')}>
          <IconCloseFill14 />
        </button>
        <button
          type="button"
          className={styles.barButton}
          onClick={() => void save()}
          disabled={saving}
        >
          <IconDownloadOutline16 />
          {t(saving ? 'imageSaving' : 'imageSave')}
        </button>
      </div>
      {failed ? (
        <div className={styles.failed} onClick={(event) => event.stopPropagation()}>
          {t('imageLoadFailed')}
        </div>
      ) : (
        <img
          className={styles.image}
          src={url}
          alt={name}
          onClick={(event) => event.stopPropagation()}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  )
}

/** 附件/生图缩略图点击入口：从本地原件打开查看器 */
export const useOpenLocalImage = () => async (id: string, name: string) => {
  const blob = await loadFile(id).catch(() => undefined)
  if (blob) {
    openImageViewer(URL.createObjectURL(blob), name)
  }
}