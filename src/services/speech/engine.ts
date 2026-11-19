import type { SpeechProvider } from './store.js'
import { base64ToBlob, getBridge, nativeFetch } from '../native.js'

/** 把 AudioBuffer 编码为 16-bit PCM WAV（ASR 通用格式） */
const encodeWav = (buffer: AudioBuffer): Blob => {
  const channel = buffer.getChannelData(0)
  const sampleRate = buffer.sampleRate
  const length = channel.length
  const bytes = 44 + length * 2
  const view = new DataView(new ArrayBuffer(bytes))
  const writeStr = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i))
    }
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, bytes - 8, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, length * 2, true)
  let offset = 44
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, channel[i]))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += 2
  }
  return new Blob([view.buffer], { type: 'audio/wav' })
}

/** 重采样到 16kHz 兜底：优先由 AudioContext 内核完成高质量重采样，走到这里说明内核不支持指定采样率 */
const resampleTo16k = (input: Float32Array<ArrayBuffer>, fromRate: number): Float32Array<ArrayBuffer> => {
  if (fromRate === 16000) {
    return input
  }
  const ratio = fromRate / 16000
  // 降采样前做窗口均值低通，抑制 8kHz 以上频率混叠进目标频带
  const win = Math.max(1, Math.round(ratio))
  const outLength = Math.floor(input.length / ratio)
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const center = i * ratio
    let sum = 0
    let n = 0
    for (let k = Math.floor(center - win / 2); k <= Math.ceil(center + win / 2); k++) {
      if (k >= 0 && k < input.length) {
        sum += input[k]
        n += 1
      }
    }
    out[i] = n > 0 ? sum / n : 0
  }
  return out
}

/** 录音并返回 WAV blob；level 供按住说话时的电平动画 */
export const createRecorder = async (): Promise<{
  stop: () => Promise<{ blob: Blob; durationMs: number }>
  cancel: () => void
  level: () => number
}> => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  // 请求 16kHz 上下文：支持的内核直接输出高质量重采样，避免主线程裸插值
  let context: AudioContext
  try {
    context = new AudioContext({ sampleRate: 16000 })
  } catch {
    context = new AudioContext()
  }
  const source = context.createMediaStreamSource(stream)
  const processor = context.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  let level = 0
  let captured = 0
  const maxSamples = 16000 * 120
  processor.onaudioprocess = (event) => {
    if (captured >= maxSamples) {
      return
    }
    const data = event.inputBuffer.getChannelData(0)
    chunks.push(new Float32Array(data))
    captured += data.length
    let sum = 0
    for (let i = 0; i < data.length; i += 8) {
      sum += data[i] * data[i]
    }
    level = Math.min(1, Math.sqrt(sum / (data.length / 8)) * 4)
  }
  source.connect(processor)
  processor.connect(context.destination)
  const cleanup = () => {
    processor.disconnect()
    source.disconnect()
    stream.getTracks().forEach((track) => track.stop())
    void context.close()
  }
  return {
    level: () => level,
    stop: async () => {
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const merged = new Float32Array(total)
      let offset = 0
      for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.length
      }
      const samples = resampleTo16k(merged, context.sampleRate)
      const durationMs = Math.round((samples.length / 16000) * 1000)
      const audioBuffer = context.createBuffer(1, Math.max(1, samples.length), 16000)
      audioBuffer.copyToChannel(samples, 0)
      cleanup()
      return { blob: encodeWav(audioBuffer), durationMs }
    },
    cancel: cleanup,
  }
}

/** 语音请求：60s 超时 + 原生回退（JSON 可走原生，FormData 直连） */
const speechFetch = async (url: string, init: RequestInit): Promise<Response> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    const bridge = getBridge()
    if (bridge && typeof init.body === 'string') {
      const headers: Record<string, string> = {}
      new Headers(init.headers).forEach((value, key) => {
        headers[key] = value
      })
      const result = await nativeFetch({ url, method: 'POST', headers, body: init.body, binary: true })
      if (result.status === 0) {
        throw error
      }
      return new Response(base64ToBlob(result.body ?? '', 'audio/wav'), { status: result.status })
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

const authHeaders = (provider: SpeechProvider): Record<string, string> => ({
  Authorization: `Bearer ${provider.apiKey}`,
})

/** ASR：DeepSeek 私有 /v1/tools/asr，其余 OpenAI 兼容 /audio/transcriptions */
export const transcribe = async (provider: SpeechProvider, wav: Blob): Promise<string> => {
  const form = new FormData()
  form.append('file', wav, 'audio.wav')
  const url =
    provider.kind === 'deepseek'
      ? `${provider.baseUrl}/tools/asr`
      : `${provider.baseUrl}/audio/transcriptions`
  if (provider.kind !== 'deepseek') {
    form.append('model', provider.asrModel || 'whisper-1')
  }
  const response = await speechFetch(url, { method: 'POST', headers: authHeaders(provider), body: form })
  if (!response.ok) {
    throw new Error(`asr failed: ${response.status}`)
  }
  const body = (await response.json()) as { text?: string }
  return body.text ?? ''
}

/** TTS：DeepSeek 返回 WAV，其余 OpenAI 兼容返回 mp3/wav */
export const synthesize = async (provider: SpeechProvider, text: string): Promise<Blob> => {
  const url =
    provider.kind === 'deepseek'
      ? `${provider.baseUrl}/tools/tts`
      : `${provider.baseUrl}/audio/speech`
  const body =
    provider.kind === 'deepseek'
      ? { text: text.slice(0, 10000), voice_id: provider.ttsVoice || 'stella', format: 'wav', filter_markdown: true }
      : { model: provider.ttsModel || 'gpt-4o-mini-tts', input: text.slice(0, 4096), voice: provider.ttsVoice || 'alloy', response_format: 'mp3' }
  const response = await speechFetch(url, {
    method: 'POST',
    headers: { ...authHeaders(provider), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`tts failed: ${response.status}`)
  }
  return response.blob()
}

let currentAudio: HTMLAudioElement | null = null
let currentUrl: string | null = null

export const playBlob = (blob: Blob): Promise<void> =>
  new Promise((resolve, reject) => {
    stopPlayback()
    const url = URL.createObjectURL(blob)
    currentUrl = url
    const audio = new Audio(url)
    currentAudio = audio
    let settled = false
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true
        fn()
      }
    }
    audio.onended = () => {
      URL.revokeObjectURL(url)
      currentUrl = null
      currentAudio = null
      settle(resolve)
    }
    audio.onerror = () => {
      URL.revokeObjectURL(url)
      currentUrl = null
      currentAudio = null
      settle(() => reject(new Error('playback failed')))
    }
    void audio.play().catch(() => settle(() => reject(new Error('playback failed'))))
  })

export const stopPlayback = () => {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio = null
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl)
    currentUrl = null
  }
}