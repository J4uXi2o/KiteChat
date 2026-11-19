import { create } from 'zustand'
import type { TranslationMessage } from '../../i18n/index.js'
import { createId } from '../../utils/id.js'
import { isImage, resolveMimeType, validateFiles } from '../attachments.js'
import type { FileAttachment } from './types.js'

export type DraftAttachment = {
  /** 本地标识，也是 IndexedDB 原件的 key */
  id: string
  file: File
  isImage: boolean
  previewUrl: string | null
}

type Draft = { text: string; attachments: DraftAttachment[] }

export const EMPTY_DRAFT: Draft = { text: '', attachments: [] }

/** 草稿只保存在本次页面的内存中，独立于会话详情缓存；null 是新对话的草稿。 */
export const useDrafts = create<{ drafts: Map<string | null, Draft> }>(() => ({
  drafts: new Map(),
}))

export const getDraft = (sessionId: string | null): Draft =>
  useDrafts.getState().drafts.get(sessionId) ?? EMPTY_DRAFT

const updateDraft = (sessionId: string | null, update: (draft: Draft) => Draft) =>
  useDrafts.setState((state) => {
    const draft = update(state.drafts.get(sessionId) ?? EMPTY_DRAFT)
    const drafts = new Map(state.drafts)
    if (draft.text || draft.attachments.length > 0) {
      drafts.set(sessionId, draft)
    } else {
      drafts.delete(sessionId)
    }
    return { drafts }
  })

const DRAFTS_KEY = 'kitechat:drafts'

let persistTimer: ReturnType<typeof setTimeout> | null = null
const persistDrafts = () => {
  if (persistTimer) {
    clearTimeout(persistTimer)
  }
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
    const entries = [...useDrafts.getState().drafts.entries()]
      .filter(([, draft]) => draft.text)
      .map(([id, draft]) => [id, draft.text])
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(entries))
    } catch {
      // 存储不可用时仅内存生效
    }
  }, 300)
}

/** 启动时恢复未发送的草稿文本 */
export const restoreDrafts = () => {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY)
    if (!raw) {
      return
    }
    const entries: unknown = JSON.parse(raw)
    if (!Array.isArray(entries)) {
      return
    }
    useDrafts.setState((state) => {
      const drafts = new Map(state.drafts)
      for (const entry of entries) {
        if (
          Array.isArray(entry) &&
          (typeof entry[0] === 'string' || entry[0] === null) &&
          typeof entry[1] === 'string' &&
          entry[1] &&
          !drafts.has(entry[0])
        ) {
          drafts.set(entry[0], { text: entry[1], attachments: [] })
        }
      }
      return { drafts }
    })
  } catch {
    // 损坏数据忽略
  }
}

export const setDraftText = (sessionId: string | null, text: string) => {
  updateDraft(sessionId, (draft) => ({ ...draft, text }))
  persistDrafts()
}

/** 整批校验通过后创建本地预览；附件不上传，发送时内联进请求。 */
export const addDraftFiles = (
  sessionId: string | null,
  files: File[]
): TranslationMessage | null => {
  if (files.length === 0) {
    return null
  }
  const error = validateFiles(files, getDraft(sessionId).attachments.length)
  if (error) {
    return error
  }
  const added = files.map((file): DraftAttachment => {
    const image = isImage(resolveMimeType(file))
    return {
      id: createId(),
      file,
      isImage: image,
      previewUrl: image ? URL.createObjectURL(file) : null,
    }
  })
  updateDraft(sessionId, (draft) => ({ ...draft, attachments: [...draft.attachments, ...added] }))
  return null
}

/** 发送按钮和实际提交共用规则：有文字或有附件即可发送。 */
export const prepareDraftMessage = (draft: Draft) => {
  const text = draft.text.trim()
  if (!text && draft.attachments.length === 0) {
    return null
  }
  const files: (FileAttachment & { blob: Blob })[] = draft.attachments.map((attachment) => ({
    id: attachment.id,
    serverId: null,
    name: attachment.file.name,
    size: attachment.file.size,
    isImage: attachment.isImage,
    mimeType: resolveMimeType(attachment.file),
    blob: attachment.file,
  }))
  return { text, files }
}

const releaseAttachment = (attachment: DraftAttachment) => {
  if (attachment.previewUrl) {
    URL.revokeObjectURL(attachment.previewUrl)
  }
}

export const removeDraftAttachment = (sessionId: string | null, attachmentId: string) => {
  const attachment = getDraft(sessionId).attachments.find((item) => item.id === attachmentId)
  if (!attachment) {
    return
  }
  releaseAttachment(attachment)
  updateDraft(sessionId, (draft) => ({
    ...draft,
    attachments: draft.attachments.filter((item) => item.id !== attachmentId),
  }))
}

/** 发送成功后原件已交给会话，释放预览。 */
export const clearSentDraft = (sessionId: string | null) => {
  getDraft(sessionId).attachments.forEach(releaseAttachment)
  updateDraft(sessionId, () => EMPTY_DRAFT)
  persistDrafts()
}

/** 删除会话或替换历史成功后，释放尚未发送的草稿。 */
export const clearDraft = (sessionId: string | null) => {
  getDraft(sessionId).attachments.forEach(releaseAttachment)
  updateDraft(sessionId, () => EMPTY_DRAFT)
  persistDrafts()
}

export const clearAllDrafts = () => {
  for (const draft of useDrafts.getState().drafts.values()) {
    draft.attachments.forEach(releaseAttachment)
  }
  useDrafts.setState({ drafts: new Map() })
  persistDrafts()
}