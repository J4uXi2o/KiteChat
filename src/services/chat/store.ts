import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import { ApiError } from '../api/client.js'
import { completeText, generateImage, streamChat } from '../api/gateway.js'
import { getActiveSearchProvider, getBinding, getModelSettings, resolveChatBinding } from '../providers/store.js'
import { setImageMode, useSettings } from '../settings.js'
import { extractDocx, extractPdf, isParsableDoc } from '../docs/extract.js'
import { base64ToBlob as nativeBase64ToBlob, getBridge, nativeFetch } from '../native.js'
import { appendBranch, getVisibleMessages, normalizeSession, selectVersion } from './branches.js'
import * as db from './db.js'
import {
  clearAllDrafts,
  clearDraft,
  clearSentDraft,
  getDraft,
  prepareDraftMessage,
} from './drafts.js'
import {
  applyEvent,
  canContinueReply,
  getContextRounds,
  settleReply,
  toRequestMessages,
  type InlineFiles,
} from './reply.js'
import {
  toSessionSummary,
  type AssistantMessage,
  type Message,
  type Session,
  type SessionSummary,
  type UserMessage,
} from './types.js'

/** 保留最近打开的详情；当前会话、生成中及尚未成功保存的会话不淘汰。 */
const SESSION_CACHE_LIMIT = 5
/** 单张图片 base64 上限（约 8MB 原件），超过则不进入请求 */
const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024
/** 单个文本附件内联上限 */
const MAX_INLINE_TEXT_BYTES = 1024 * 1024

/** 允许自动补标题的请求；手动重命名后取消本轮标题写入。 */
const titleRequests = new Set<AbortController>()

type ChatState = {
  ready: boolean
  initError: boolean
  /** 历史导入或全部删除期间锁定交互，提交成功前仍展示原有记录。 */
  importingHistory: boolean
  /** 仅列表元数据，按 updatedAt 降序；流式消息更新不会改变此数组。 */
  sessions: SessionSummary[]
  sessionCache: Record<string, Session>
  sessionLoadErrors: Record<string, boolean>
  sessionSaveErrors: Record<string, boolean>
  /** null 表示新对话（欢迎页） */
  activeId: string | null
  /** 正在生成回复的会话 */
  streaming: Record<string, AbortController>
}

export const useChatStore = create<ChatState>(() => ({
  ready: false,
  initError: false,
  importingHistory: false,
  sessions: [],
  sessionCache: {},
  sessionLoadErrors: {},
  sessionSaveErrors: {},
  activeId: null,
  streaming: {},
}))

const { getState: get, setState: set } = useChatStore

const sortSessions = (sessions: SessionSummary[]) =>
  [...sessions].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || b.updatedAt - a.updatedAt)

const getSession = (id: string) => {
  const cache = get().sessionCache
  return Object.hasOwn(cache, id) ? cache[id] : undefined
}

const getStreamController = (id: string) => {
  const streams = get().streaming
  return Object.hasOwn(streams, id) ? streams[id] : undefined
}

const sameSummary = (a: SessionSummary, b: SessionSummary) =>
  a.title === b.title && a.createdAt === b.createdAt && a.updatedAt === b.updatedAt

const sessionAccess = new Map<string, number>()
const unsavedSessions = new Set<string>()
/** 保存失败时保留原件，重试成功后才释放。 */
const pendingFiles = new Map<string, db.StoredFile[]>()
const deletingSessions = new Set<string>()
const deletionTasks = new Set<Promise<boolean>>()
const streamFlushes = new Map<string, () => void>()
let accessSequence = 0
let historyEpoch = 0
let initTask: Promise<void> | undefined
const sessionLoads = new Map<string, { promise: Promise<void> }>()

const touchSession = (id: string) => sessionAccess.set(id, ++accessSequence)

const trimSessionCache = () => {
  const state = get()
  const ids = Object.keys(state.sessionCache)
  if (ids.length <= SESSION_CACHE_LIMIT) {
    return
  }
  const removable = ids
    .filter(
      (id) =>
        id !== state.activeId &&
        !Object.hasOwn(state.streaming, id) &&
        !unsavedSessions.has(id) &&
        !deletingSessions.has(id)
    )
    .sort((a, b) => (sessionAccess.get(a) ?? 0) - (sessionAccess.get(b) ?? 0))
  const evicted = new Set(removable.slice(0, ids.length - SESSION_CACHE_LIMIT))
  for (const id of evicted) {
    sessionAccess.delete(id)
  }
  if (evicted.size > 0) {
    set({
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([id]) => !evicted.has(id))
      ),
    })
  }
}

const updateSession = (id: string, update: (session: Session) => Session) =>
  set((state) => {
    const previous = Object.hasOwn(state.sessionCache, id) ? state.sessionCache[id] : undefined
    if (!previous) {
      return state
    }
    const session = update(previous)
    if (session === previous) {
      return state
    }
    return {
      sessionCache: { ...state.sessionCache, [id]: session },
      sessions: sameSummary(previous, session)
        ? state.sessions
        : sortSessions(
            state.sessions.map((summary) =>
              summary.id === id ? toSessionSummary(session) : summary
            )
          ),
    }
  })

const updateReply = (sessionId: string, reply: AssistantMessage) =>
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.id === reply.id
        ? { ...reply, parentId: message.parentId, selectedChildId: message.selectedChildId }
        : message
    ),
  }))

const persist = (sessionId: string) => {
  const session = getSession(sessionId)
  if (session) {
    unsavedSessions.add(sessionId)
    if (deletingSessions.has(sessionId)) {
      return
    }
    const epoch = historyEpoch
    const files = pendingFiles.get(sessionId)
    void db
      .saveSession(session, files)
      .then(() => {
        if (epoch !== historyEpoch || !getSession(sessionId)) {
          return
        }
        if (pendingFiles.get(sessionId) === files) {
          pendingFiles.delete(sessionId)
        }
        if (getSession(sessionId) === session) {
          unsavedSessions.delete(sessionId)
          set((state) => ({
            sessionSaveErrors: Object.fromEntries(
              Object.entries(state.sessionSaveErrors).filter(([id]) => id !== sessionId)
            ),
          }))
          trimSessionCache()
        }
      })
      .catch((error: unknown) => {
        db.reportStorageError('save session')(error)
        if (epoch === historyEpoch && getSession(sessionId)) {
          set((state) => ({
            sessionSaveErrors: { ...state.sessionSaveErrors, [sessionId]: true },
          }))
        }
      })
  }
}

export const retrySaveSessions = () => {
  if (!get().importingHistory) {
    unsavedSessions.forEach(persist)
  }
}

/** 离开前先合并尚未绘制的增量；隐藏期间浏览器可能暂停动画帧。 */
export const bindChatPersistence = () => {
  const save = () => {
    if (get().importingHistory) {
      return
    }
    for (const [id, flush] of streamFlushes) {
      flush()
      persist(id)
    }
    for (const id of unsavedSessions) {
      if (!streamFlushes.has(id)) {
        persist(id)
      }
    }
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      save()
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', save)
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', save)
  }
}

/** 按当前绑定与开关创建回复 */
const createReply = (model: string | null): AssistantMessage => {
  const { thinking } = useSettings.getState()
  return {
    id: createId(),
    role: 'assistant',
    createdAt: Date.now(),
    model,
    thinking,
    prefix: true,
    status: 'pending',
    blocks: [],
  }
}

/** 仍在生成中的回复（页面关闭或导出时未结束）按「已停止」处理 */
const settleInterrupted = (session: Session): Session => {
  if (
    !session.messages.some(
      (m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
    )
  ) {
    return session
  }
  return {
    ...session,
    messages: session.messages.map((m) =>
      m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
        ? settleReply(m, 'stopped', session.updatedAt)
        : m
    ),
  }
}

export const initChat = (): Promise<void> => {
  if (get().ready) {
    return Promise.resolve()
  }
  if (initTask) {
    return initTask
  }
  const epoch = historyEpoch
  set({ initError: false })
  initTask = (async () => {
    try {
      const summaries = await db.loadSessionSummaries()
      if (epoch === historyEpoch) {
        set({ ready: true, sessions: sortSessions(summaries) })
      }
    } catch (error) {
      if (epoch === historyEpoch) {
        set({ initError: true })
        db.reportStorageError('read local sessions')(error)
      }
    } finally {
      if (epoch === historyEpoch) {
        initTask = undefined
      }
    }
  })()
  return initTask
}

/** 同一会话合并并发读取；切换只改变 activeId，旧请求不会把界面切回去。 */
const ensureSessionLoaded = (id: string): Promise<void> => {
  if (getSession(id)) {
    return Promise.resolve()
  }
  const pending = sessionLoads.get(id)
  if (pending) {
    return pending.promise
  }
  const epoch = historyEpoch
  set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: false } }))
  const load = { promise: Promise.resolve() }
  sessionLoads.set(id, load)
  load.promise = (async () => {
    try {
      const stored = await db.loadSession(id)
      if (epoch !== historyEpoch || sessionLoads.get(id) !== load) {
        return
      }
      const summary = get().sessions.find((session) => session.id === id)
      if (!summary) {
        return
      }
      if (!stored) {
        throw new Error(`Session ${id} is missing from local storage`)
      }
      const settled = settleInterrupted(normalizeSession(stored))
      const session = sameSummary(settled, summary) ? settled : { ...settled, ...summary }
      touchSession(id)
      set((state) => ({ sessionCache: { ...state.sessionCache, [id]: session } }))
      if (session !== stored) {
        persist(id)
      }
      trimSessionCache()
    } catch (error) {
      if (epoch === historyEpoch && sessionLoads.get(id) === load) {
        set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: true } }))
        db.reportStorageError('read session')(error)
      }
    } finally {
      if (sessionLoads.get(id) === load) {
        sessionLoads.delete(id)
      }
    }
  })()
  return load.promise
}

/** 等所有回复的收尾（落盘）完成 */
const waitForIdle = (sessionId?: string) =>
  new Promise<void>((resolve) => {
    const isIdle = (state: ChatState) =>
      sessionId === undefined
        ? Object.keys(state.streaming).length === 0
        : !Object.hasOwn(state.streaming, sessionId)
    if (isIdle(get())) {
      resolve()
      return
    }
    const unsubscribe = useChatStore.subscribe((state) => {
      if (isIdle(state)) {
        unsubscribe()
        resolve()
      }
    })
  })

/**
 * 替换历史对话：先写入暂存，成功后原子替换旧记录；写入为空即删除全部会话与附件。
 * 期间停止生成并禁止修改会话；失败时清除暂存，保留原有记录。
 */
export const replaceHistory = async (write: () => Promise<void>): Promise<number> => {
  if (get().importingHistory) {
    throw new Error('History replacement is already in progress')
  }
  set({ importingHistory: true })
  try {
    for (const controller of Object.values(get().streaming)) {
      controller.abort()
    }
    await Promise.all(deletionTasks)
    historyEpoch += 1
    initTask = undefined
    sessionLoads.clear()
    await waitForIdle()
    await db.clearStaging()
    let summaries: SessionSummary[]
    try {
      await write()
      summaries = await db.commitStaging()
    } catch (error) {
      await db.clearStaging().catch(db.reportStorageError('clear unfinished history replacement'))
      throw error
    }
    sessionAccess.clear()
    unsavedSessions.clear()
    pendingFiles.clear()
    clearAllDrafts()
    set({
      ready: true,
      initError: false,
      sessions: sortSessions(summaries),
      sessionCache: {},
      sessionLoadErrors: {},
      sessionSaveErrors: {},
      activeId: null,
    })
    return summaries.length
  } finally {
    set({ importingHistory: false })
    retrySaveSessions()
    const { activeId, ready } = get()
    if (activeId !== null) {
      void ensureSessionLoaded(activeId)
    } else if (!ready) {
      void initChat()
    }
  }
}

export const newChat = () => {
  if (!get().importingHistory) {
    set({ activeId: null })
    trimSessionCache()
  }
}

export const selectSession = (id: string) => {
  if (!get().importingHistory && get().sessions.some((session) => session.id === id)) {
    touchSession(id)
    set({ activeId: id })
    void ensureSessionLoaded(id)
    trimSessionCache()
  }
}

export const renameSession = (id: string, title: string) => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return
  }
  const controller = getStreamController(id)
  if (controller) {
    titleRequests.delete(controller)
  }
  if (getSession(id)) {
    updateSession(id, (session) => ({ ...session, title }))
    persist(id)
  } else {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, title } : session
      ),
    }))
    void db.renameSession(id, title).catch(db.reportStorageError('rename session'))
  }
}

/** 删除会话；本地原件仅在没有其他会话引用时清理。 */
export const removeSession = (id: string): Promise<boolean> => {
  const task = removeSessionData(id).finally(() => deletionTasks.delete(task))
  deletionTasks.add(task)
  return task
}

const removeSessionData = async (id: string): Promise<boolean> => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return false
  }
  const epoch = historyEpoch
  deletingSessions.add(id)
  try {
    getStreamController(id)?.abort()
    await waitForIdle(id)
    if (epoch !== historyEpoch) {
      return false
    }
    await db.deleteSession(id)
    if (epoch !== historyEpoch) {
      return true
    }
    sessionLoads.delete(id)
    sessionAccess.delete(id)
    unsavedSessions.delete(id)
    pendingFiles.delete(id)
    clearDraft(id)
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== id),
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([key]) => key !== id)
      ),
      sessionLoadErrors: Object.fromEntries(
        Object.entries(state.sessionLoadErrors).filter(([key]) => key !== id)
      ),
      sessionSaveErrors: Object.fromEntries(
        Object.entries(state.sessionSaveErrors).filter(([key]) => key !== id)
      ),
      activeId: state.activeId === id ? null : state.activeId,
    }))
    return true
  } catch (error) {
    db.reportStorageError('delete session')(error)
    return false
  } finally {
    deletingSessions.delete(id)
    if (getSession(id)) {
      if (get().importingHistory) {
        unsavedSessions.add(id)
      } else {
        persist(id)
      }
    }
  }
}

export const togglePin = (id: string) => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return
  }
  if (getSession(id)) {
    updateSession(id, (session) => ({ ...session, pinned: !session.pinned }))
    persist(id)
  } else {
    set((state) => ({
      sessions: sortSessions(
        state.sessions.map((session) =>
          session.id === id ? { ...session, pinned: !session.pinned } : session
        )
      ),
    }))
    const summary = get().sessions.find((session) => session.id === id)
    if (summary) {
      void db.updateSummaryMeta(id, { pinned: summary.pinned }).catch(db.reportStorageError('pin session'))
    }
  }
}

/** 删除单条消息：把其子节点接到其父节点下，保留其余分支 */
export const removeMessage = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId) || getStreamController(sessionId)) {
    return
  }
  updateSession(sessionId, (original) => {
    const session = normalizeSession(original)
    const target = session.messages.find((message) => message.id === messageId)
    if (!target) {
      return original
    }
    const children = session.messages.filter((message) => message.parentId === messageId)
    const keepChild =
      children.find((child) => child.id === target.selectedChildId) ?? children[0] ?? null
    const messages = session.messages
      .filter((message) => message.id !== messageId)
      .map((message) => {
        if (message.parentId === messageId) {
          return { ...message, parentId: target.parentId ?? null }
        }
        if (message.selectedChildId === messageId) {
          return { ...message, selectedChildId: keepChild?.id }
        }
        return message
      })
    const rootMessageId =
      session.rootMessageId === messageId ? (keepChild?.id ?? null) : session.rootMessageId
    return { ...session, messages, rootMessageId }
  })
  persist(sessionId)
}

export const stopReply = (sessionId: string) => {
  const controller = getStreamController(sessionId)
  if (controller) {
    titleRequests.delete(controller)
    controller.abort()
  }
}

/**
 * 提交指定会话的最新草稿；null 表示新建会话。
 * 生图模式开启且已绑定生图模型时走生图流程，否则走聊天流程。
 */
export const sendMessage = (targetSessionId: string | null) => {
  if (get().importingHistory || !get().ready) {
    return false
  }
  const prepared = prepareDraftMessage(getDraft(targetSessionId))
  if (!prepared) {
    return false
  }
  const { imageMode } = useSettings.getState()
  const imageBinding = imageMode ? getBinding('image') : null
  const hasImages = prepared.files.some((file) => file.isImage)
  const chatBinding = imageBinding
    ? null
    : (hasImages ? (getBinding('vision') ?? resolveChatBinding()) : resolveChatBinding())
  if (!imageBinding && !chatBinding) {
    return false
  }
  const { text, files } = prepared
  const now = Date.now()
  let sessionId = targetSessionId
  if (
    sessionId !== null &&
    (deletingSessions.has(sessionId) || getStreamController(sessionId) || !getSession(sessionId))
  ) {
    return false
  }
  if (sessionId === null) {
    const session: Session = {
      id: createId(),
      title: '',
      createdAt: now,
      updatedAt: now,
      messages: [],
      rootMessageId: null,
    }
    sessionId = session.id
    touchSession(session.id)
    set((state) => ({
      sessions: [toSessionSummary(session), ...state.sessions],
      sessionCache: { ...state.sessionCache, [session.id]: session },
      activeId: session.id,
    }))
  }
  const current = getSession(sessionId)
  if (!current) {
    return false
  }
  const history = getVisibleMessages(current)
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files: files.map(({ id, name, size, isImage, mimeType }) => ({
      id,
      serverId: null,
      name,
      size,
      isImage,
      mimeType,
    })),
    createdAt: now,
  }
  const reply = createReply(imageBinding ? imageBinding.model : (chatBinding?.model ?? null))
  updateSession(sessionId, (session) => ({
    ...appendBranch(session, history.at(-1)?.id ?? null, [question, reply]),
    updatedAt: now,
  }))
  if (files.length > 0) {
    pendingFiles.set(sessionId, [
      ...(pendingFiles.get(sessionId) ?? []),
      ...files.map(({ id, blob }) => ({ id, blob })),
    ])
  }
  persist(sessionId)
  clearSentDraft(targetSessionId)
  if (imageBinding) {
    // 生图为单次模式：发送后自动回到聊天，避免后续消息误入生图
    setImageMode(false)
    void streamImageReply(sessionId, reply, question, imageBinding)
  } else if (chatBinding) {
    void streamReply(sessionId, reply, { history, question }, chatBinding)
  }
  return true
}

/** 重新生成当前路径上的回答：在原问题下新增版本，不覆盖旧回答和后续对话。 */
export const regenerateReply = (sessionId: string, messageId?: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index =
    messageId === undefined ? path.length - 1 : path.findIndex((m) => m.id === messageId)
  const question = path[index - 1]
  const previous = path[index]
  if (question?.role !== 'user' || previous?.role !== 'assistant') {
    return
  }
  // 生图回复重新生成仍走生图绑定
  if (previous.images) {
    const binding = getBinding('image')
    if (!binding) {
      return
    }
    const reply = createReply(binding.model)
    updateSession(sessionId, (s) => ({
      ...appendBranch(s, question.id, [reply]),
      updatedAt: Date.now(),
    }))
    persist(sessionId)
    void streamImageReply(sessionId, reply, question, binding)
    return
  }
  const binding = resolveChatBinding()
  if (!binding) {
    return
  }
  const history = path.slice(0, index - 1)
  const reply = createReply(binding.model)
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, question.id, [reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history, question }, binding)
}

/** 编辑提问后新增同父版本，保留原文件；旧问题的所有回答与后续对话仍可切回。 */
export const editMessage = (sessionId: string, messageId: string, content: string): boolean => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return false
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return false
  }
  const binding = resolveChatBinding()
  if (!binding) {
    return false
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const previous = path[index]
  const text = content.trim()
  if (previous?.role !== 'user' || (!text && previous.files.length === 0)) {
    return false
  }
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files: previous.files,
    createdAt: Date.now(),
  }
  const reply = createReply(binding.model)
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, path[index - 1]?.id ?? null, [question, reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, index), question }, binding)
  return true
}

export const selectMessageVersion = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  if (getStreamController(sessionId)) {
    return
  }
  updateSession(sessionId, (session) => selectVersion(session, messageId))
  persist(sessionId)
}

/** 继续最后一条未完成的回答：保留原消息与开关，仅将新流的内容追加到原块之后。 */
export const continueReply = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const question = path.at(-2)
  const previous = path.at(-1)
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.id !== messageId ||
    !canContinueReply(previous)
  ) {
    return
  }
  const binding = resolveChatBinding()
  if (!binding) {
    return
  }
  const { thinking } = useSettings.getState()
  const reply: AssistantMessage = {
    ...previous,
    model: previous.model ?? binding.model,
    thinking: previous.thinking ?? thinking,
    status: 'pending',
    stopReason: undefined,
    stopDetails: undefined,
    error: undefined,
  }
  updateReply(sessionId, reply)
  updateSession(sessionId, (s) => ({ ...s, updatedAt: Date.now() }))
  persist(sessionId)
  void streamReply(
    sessionId,
    reply,
    { history: path.slice(0, -2), question, prefix: previous },
    binding
  )
}

type Request = { history: Message[]; question: UserMessage; prefix?: AssistantMessage }

// ---------- 附件内联 ----------

/** 原生通道抓取网页正文（去标签，截断） */
const pageCache = new Map<string, { at: number; text: string }>()

/** 拒绝环回/私网/链路本地/云元数据地址，防 SSRF 读取内网 */
const isBlockedHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true
  }
  if (host.includes(':')) {
    return host === '::1' || host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd')
  }
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false
  }
  const [a, b] = parts
  return (
    a === 0 || a === 127 || a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  )
}

const fetchPageText = async (url: string): Promise<string | null> => {
  const bridge = getBridge()
  if (!bridge) {
    return null
  }
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    if (isBlockedHost(parsed.hostname)) {
      return null
    }
  } catch {
    return null
  }
  const cached = pageCache.get(url)
  if (cached && Date.now() - cached.at < 10 * 60_000) {
    return cached.text
  }
  const result = await nativeFetch({ url, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 KiteChat' } })
  if (result.status !== 200 || !result.body) {
    return null
  }
  const text = result.body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const trimmed = text.slice(0, 6000) || null
  if (trimmed) {
    pageCache.set(url, { at: Date.now(), text: trimmed })
  }
  return trimmed
}

const withTimeoutSignal = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** 参考图转不透明 JPEG（wan2.7 拒绝透明通道 PNG） */
const blobToJpegDataUrl = async (blob: Blob): Promise<string> => {
  try {
    const bitmap = await createImageBitmap(blob)
    // 降采样到最长边 1536，避免大图转码触发 WebView 渲染进程崩溃
    const scale = Math.min(1, 1536 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      return canvas.toDataURL('image/jpeg', 0.9)
    }
    bitmap.close()
  } catch {
    // 回退原图
  }
  return blobToBase64(blob).then((b64) => `data:${blob.type || 'image/png'};base64,${b64}`)
}

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('read file failed'))
    reader.readAsDataURL(blob)
  })

/** 从本地原件读出并编码附件；缺失或超限的附件跳过（只展示、不进入请求） */
const buildInlineFiles = async (messages: UserMessage[]): Promise<InlineFiles> => {
  const inline: InlineFiles = new Map()
  const seen = new Set<string>()
  for (const message of messages) {
    for (const file of message.files) {
      if (seen.has(file.id)) {
        continue
      }
      seen.add(file.id)
      const blob = await db.loadFile(file.id).catch(() => undefined)
      if (!blob) {
        continue
      }
      if (file.isImage) {
        if (blob.size > MAX_INLINE_IMAGE_BYTES) {
          continue
        }
        const data = await blobToBase64(blob).catch(() => '')
        if (data) {
          inline.set(file.id, {
            id: file.id,
            isImage: true,
            mimeType: file.mimeType || blob.type || 'image/png',
            data,
          })
        }
      } else if (isParsableDoc(file.name)) {
        try {
          const text = /\.pdf$/i.test(file.name) ? await extractPdf(blob) : await extractDocx(blob)
          if (text.trim()) {
            inline.set(file.id, { id: file.id, isImage: false, mimeType: 'text/plain', data: text })
          }
        } catch {
          // 解析失败不阻断发送
        }
      } else if (blob.size <= MAX_INLINE_TEXT_BYTES) {
        const text = await blob.text().catch(() => '')
        if (text) {
          inline.set(file.id, { id: file.id, isImage: false, mimeType: 'text/plain', data: text })
        }
      }
    }
  }
  return inline
}

// ---------- 标题生成 ----------

const TITLE_PROMPT =
  '根据以下用户消息生成一个不超过 16 个字的简短对话标题。只输出标题本身，不要引号、标点或解释。'

const generateTitle = async (
  sessionId: string,
  question: UserMessage,
  controller: AbortController
) => {
  const binding = getBinding('title') ?? resolveChatBinding()
  if (!binding || !question.content.trim()) {
    return
  }
  try {
    const text = await completeText(
      binding.provider,
      {
        model: binding.model,
        system: TITLE_PROMPT,
        messages: [{ role: 'user', content: question.content.slice(0, 500) }],
        maxTokens: 512,
      },
      controller.signal
    )
    const title = text.trim().replace(/^["'「『]+|["'」』]+$/g, '').slice(0, 40)
    if (
      title &&
      titleRequests.has(controller) &&
      !controller.signal.aborted &&
      !get().importingHistory
    ) {
      updateSession(sessionId, (session) => (session.title ? session : { ...session, title }))
      titleRequests.delete(controller)
      persist(sessionId)
    }
  } catch {
    // 标题生成失败不影响对话
  }
}

// ---------- 聊天流 ----------

const streamReply = async (
  sessionId: string,
  initial: AssistantMessage,
  request: Request,
  binding: { provider: import('../providers/store.js').Provider; model: string }
) => {
  const controller = new AbortController()
  if (!getSession(sessionId)?.title) {
    titleRequests.add(controller)
    void generateTitle(sessionId, request.question, controller)
  }
  set((state) => ({ streaming: { ...state.streaming, [sessionId]: controller } }))
  let reply = initial
  let frame = 0
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined
  let lastHiddenFlush = 0
  const flush = () => {
    cancelAnimationFrame(frame)
    frame = 0
    updateReply(sessionId, reply)
  }
  streamFlushes.set(sessionId, flush)
  let timeout: ReturnType<typeof setTimeout> | undefined
  let timedOut = false

  try {
    try {
      const contextUsers = getContextRounds(request.history).map(([user]) => user)
      const inline = await buildInlineFiles([...contextUsers, request.question])
      const messages = toRequestMessages(
        request.history,
        request.question,
        inline,
        request.prefix,
        initial.thinking ?? false
      )
      const modelName = initial.model ?? binding.model
      const searchProvider = useSettings.getState().search ? getActiveSearchProvider() : null
      if (useSettings.getState().readLinks) {
        // 只从用户消息提取链接，避免模型输出诱导抓取（提示注入+SSRF）
        const recentText = [...request.history.slice(-6).map((m) => (m.role === 'user' ? m.content : '')), request.question.content].join('\n')
        const urls = [...new Set((recentText.match(/https?:\/\/[^\s<>()"']+/g) ?? []).slice(0, 2))]
        const pages: string[] = []
        for (const url of urls) {
          const page = await withTimeoutSignal(fetchPageText(url), 20_000).catch(() => null)
          if (page) {
            pages.push(`[网页内容 ${url}]\n${page}`)
          }
        }
        if (pages.length > 0) {
          messages.splice(Math.max(0, messages.length - 1), 0, { role: 'user', content: pages.join('\n\n') })
        }
      }
      timeout = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, 300_000)
      const events = streamChat(
        binding.provider,
        {
          model: modelName,
          system: useSettings.getState().systemPrompt,
          messages,
          thinking: initial.thinking ?? false,
          settings: getModelSettings(binding.provider, modelName),
          ...(searchProvider ? { search: { provider: searchProvider } } : {}),
        },
        controller.signal
      )
      const blockIndexes = new Map<number, number>()
      for await (const event of events) {
        reply = applyEvent(reply, event, Date.now(), blockIndexes)
        if (document.visibilityState === 'hidden') {
          // 后台合并刷新：最多 2 次/秒，避免每个 SSE 事件都触发渲染耗电
          const now = Date.now()
          if (now - lastHiddenFlush >= 500) {
            lastHiddenFlush = now
            flush()
          } else if (!hiddenTimer) {
            hiddenTimer = setTimeout(() => {
              hiddenTimer = undefined
              lastHiddenFlush = Date.now()
              flush()
            }, 500)
          }
        } else {
          frame ||= requestAnimationFrame(flush)
        }
      }
      reply = settleReply(reply, 'done', Date.now())
      if (document.visibilityState === 'hidden') {
        window.KiteNative?.notify?.('KiteChat', '回复已完成')
      }
    } catch (error) {
      if (controller.signal.aborted) {
        reply = timedOut
          ? settleReply(reply, 'error', Date.now(), {
              kind: 'network',
              message: '',
              localMessage: { key: 'replyTimeout' },
            })
          : settleReply(reply, 'stopped', Date.now())
      } else if ((error as Error)?.name === 'TimeoutError') {
        reply = settleReply(reply, 'error', Date.now(), {
          kind: 'network',
          message: '',
          localMessage: { key: 'replyTimeout' },
        })
      } else if (error instanceof ApiError && error.kind === 'interrupted' && reply.stopReason) {
        reply = settleReply(reply, 'done', Date.now())
      } else if (error instanceof ApiError) {
        reply = settleReply(reply, 'error', Date.now(), {
          kind: error.kind,
          message: error.message,
          status: error.status,
          localMessage: error.localMessage,
        })
      } else {
        reply = settleReply(reply, 'error', Date.now(), {
          kind: 'protocol',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } finally {
    clearTimeout(timeout)
    clearTimeout(hiddenTimer)
    streamFlushes.delete(sessionId)
    cancelAnimationFrame(frame)
    updateReply(sessionId, reply)
    set((state) => ({
      streaming: Object.fromEntries(
        Object.entries(state.streaming).filter(([id]) => id !== sessionId)
      ),
    }))
    persist(sessionId)
  }
}

// ---------- 生图流 ----------

const base64ToBlob = (data: string, mimeType: string): Blob => {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mimeType })
}

const streamImageReply = async (
  sessionId: string,
  initial: AssistantMessage,
  question: UserMessage,
  binding: { provider: import('../providers/store.js').Provider; model: string }
) => {
  const controller = new AbortController()
  // 生图会话标题直接取提示词，不经聊天模型（避免模型回复污染标题）
  if (!getSession(sessionId)?.title && question.content.trim()) {
    const title = question.content.trim().slice(0, 24)
    updateSession(sessionId, (session) => (session.title ? session : { ...session, title }))
    persist(sessionId)
  }
  set((state) => ({ streaming: { ...state.streaming, [sessionId]: controller } }))
  let reply: AssistantMessage = { ...initial, status: 'streaming' }
  const flush = () => updateReply(sessionId, reply)
  streamFlushes.set(sessionId, flush)
  try {
    const { imageSize: rawSize, imageCount } = useSettings.getState()
    let imageSize = rawSize
    if (rawSize === 'auto') {
      const chatBinding = resolveChatBinding()
      imageSize = '1024x1024'
      if (chatBinding) {
        try {
          const inferred = await withTimeoutSignal(
            completeText(
              chatBinding.provider,
              {
                model: chatBinding.model,
                system: '你是生图参数助手。根据用户原话推断图片尺寸与张数，只输出 JSON，如 {"size":"1024x1536","n":1}。尺寸只能是 1024x1024、1024x1536、1536x1024、512x512、720x1280、1280x720 之一；用户未提及则 size 用 1024x1024、n 用 1。不要改写用户原话。',
                messages: [{ role: 'user', content: question.content }],
                maxTokens: 60,
                settings: { ...getModelSettings(chatBinding.provider, chatBinding.model), thinking: false },
              },
              controller.signal
            ),
            15_000
          )
          const match = /\{[\s\S]*\}/.exec(inferred)
          if (match) {
            const parsed = JSON.parse(match[0]) as { size?: string; n?: number }
            if (parsed.size && /^[0-9]{3,4}x[0-9]{3,4}$/.test(parsed.size)) {
              imageSize = parsed.size
            }
          }
        } catch {
          imageSize = '1024x1024'
        }
      }
    }
    const refImages: string[] = []
    let refFiles = question.files.filter((f) => f.isImage).slice(0, 1)
    if (refFiles.length === 0) {
      const session = getSession(sessionId)
      const visible = session ? getVisibleMessages(session) : []
      for (let i = visible.length - 1; i >= 0; i--) {
        const m = visible[i]
        if (m.role === 'assistant' && m.images && m.images.length > 0) {
          refFiles = [{ id: m.images[m.images.length - 1].id, name: 'ref.png', isImage: true, mimeType: 'image/png', serverId: '', size: 0 }]
          break
        }
      }
    }
    for (const file of refFiles) {
      const blob = await db.loadFile(file.id).catch(() => undefined)
      if (blob) {
        refImages.push(await blobToJpegDataUrl(blob))
      }
    }
    const images = await generateImage(
      binding.provider,
      binding.model,
      question.content,
      imageSize,
      controller.signal,
      imageCount,
      refImages
    )
    const stored: { id: string; mimeType: string }[] = []
    const files: db.StoredFile[] = []
    for (const image of images) {
      let blob: Blob
      if (image.isUrl) {
        let response: Response
        try {
          response = await fetch(image.data, { signal: controller.signal })
        } catch {
          // OSS 图片无跨域头：安卓原生通道下载
          const bridge = getBridge()
          if (!bridge) {
            throw new ApiError('network', 'image download blocked')
          }
          const result = await nativeFetch({ url: image.data, method: 'GET', headers: {}, binary: true })
          if (result.status !== 200 || !result.body) {
            throw new ApiError('http', `image download failed: ${result.status}`, result.status)
          }
          response = new Response(nativeBase64ToBlob(result.body, 'image/png'), { status: 200 })
        }
        if (!response.ok) {
          throw new ApiError('http', `image download failed: ${response.status}`, response.status)
        }
        blob = await response.blob()
      } else {
        blob = base64ToBlob(image.data, image.mimeType)
      }
      const id = createId()
      stored.push({ id, mimeType: blob.type || image.mimeType })
      files.push({ id, blob })
    }
    pendingFiles.set(sessionId, [...(pendingFiles.get(sessionId) ?? []), ...files])
    if (document.visibilityState === 'hidden') {
      window.KiteNative?.notify?.('KiteChat', '图片已生成')
    }
    reply = {
      ...reply,
      images: stored,
      blocks: [
        {
          type: 'text',
          text: '',
          citations: [],
        },
      ],
      status: 'done',
      stopReason: 'end_turn',
    }
  } catch (error) {
    if (controller.signal.aborted) {
      reply = settleReply(reply, 'stopped', Date.now())
    } else if (error instanceof ApiError) {
      reply = settleReply(reply, 'error', Date.now(), {
        kind: error.kind,
        message: error.message,
        status: error.status,
        localMessage: error.localMessage,
      })
    } else {
      reply = settleReply(reply, 'error', Date.now(), {
        kind: 'protocol',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  } finally {
    titleRequests.delete(controller)
    streamFlushes.delete(sessionId)
    updateReply(sessionId, reply)
    set((state) => ({
      streaming: Object.fromEntries(
        Object.entries(state.streaming).filter(([id]) => id !== sessionId)
      ),
    }))
    persist(sessionId)
  }
}