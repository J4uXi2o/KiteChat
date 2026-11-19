import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { loadFile } from '../../services/chat/db.js'
import { openImageViewer } from '../base/ImageViewer.js'
import styles from './GeneratedImages.module.css'

/** 单张生图结果：原件从本地 IndexedDB 读出 */
const GeneratedImage = ({ id }: { id: string }) => {
  const t = useTranslate()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    void loadFile(id).then((blob) => {
      if (!cancelled && blob) {
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      }
    })
    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [id])
  if (!url) {
    return <div className={styles.placeholder} aria-label={t('imageGenerating')} />
  }
  return (
    <button
      type="button"
      className={styles.image}
      onClick={() => openImageViewer(url, `kitechat-${id}.png`)}
    >
      <img src={url} alt={t('generatedImageAlt')} />
    </button>
  )
}

/** 生图回复的图片列表 */
export const GeneratedImages = ({ images }: { images: { id: string; mimeType: string }[] }) => (
  <div className={styles.grid}>
    {images.map((image) => (
      <GeneratedImage key={image.id} id={image.id} />
    ))}
  </div>
)