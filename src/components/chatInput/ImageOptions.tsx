import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { setImageCount, setImageSize, useSettings } from '../../services/settings.js'
import { Select } from '../base/Select.js'
import styles from './ChatInput.module.css'

const SIZES = ['auto', '1024x1024', '1024x1536', '1536x1024', '512x512', '720x1280', '1280x720']

/** 生图模式下的尺寸/张数选择；auto 由大模型按用户原话推断 */
export const ImageOptions = () => {
  const t = useTranslate()
  const imageSize = useSettings((state) => state.imageSize)
  const imageCount = useSettings((state) => state.imageCount)
  const [customMode, setCustomMode] = useState(false)
  const custom = customMode || (!SIZES.includes(imageSize) && imageSize !== 'auto')
  return (
    <div className={styles.imageOptions}>
      <Select
        ariaLabel={t('imageSizeLabel')}
        value={custom ? 'custom' : imageSize}
        options={[
          { value: 'auto', label: t('imageSizeAuto') },
          ...SIZES.filter((s) => s !== 'auto').map((size) => ({ value: size, label: size })),
          { value: 'custom', label: t('imageSizeCustom') },
        ]}
        onChange={(value) => {
          if (value === 'custom') {
            setCustomMode(true)
          } else {
            setCustomMode(false)
            setImageSize(value)
          }
        }}
      />
      {custom || imageSize !== 'auto' ? (
        <input
          className={styles.imageSizeInput}
          value={imageSize}
          aria-label={t('imageSizeLabel')}
          onChange={(event) => setImageSize(event.target.value.trim())}
        />
      ) : null}
      <Select
        ariaLabel={t('imageCountLabel')}
        value={String(imageCount)}
        options={[1, 2, 4].map((count) => ({ value: String(count), label: `${count}` }))}
        onChange={(value) => setImageCount(Number(value))}
      />
    </div>
  )
}