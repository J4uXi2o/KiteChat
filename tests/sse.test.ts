import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ServerSentEventDecoder, readServerSentEvents } from '../src/services/api/sse.js'

test('SSE: 基本事件与多行 data', () => {
  const d = new ServerSentEventDecoder()
  const events = d.push('data: one\ndata: two\n\n')
  assert.equal(events.length, 1)
  assert.equal(events[0].data, 'one\ntwo')
  assert.equal(events[0].event, 'message')
})

test('SSE: event/id 字段与保活注释', () => {
  const d = new ServerSentEventDecoder()
  const events = d.push(': keep-alive\nevent: ping\nid: 7\ndata: x\n\n')
  assert.equal(events.length, 1)
  assert.equal(events[0].event, 'ping')
  assert.equal(events[0].lastEventId, '7')
})

test('SSE: CRLF 跨分片不误判', () => {
  const d = new ServerSentEventDecoder()
  assert.deepEqual(d.push('data: a\r'), [])
  const events = d.push('\n\r\n')
  assert.equal(events.length, 1)
  assert.equal(events[0].data, 'a')
})

test('SSE: 逐字节喂入与整段一致', () => {
  const text = 'data: {"x":1}\n\nevent: e\ndata: 中文\n\n'
  const whole = new ServerSentEventDecoder().push(text)
  const d = new ServerSentEventDecoder()
  const parts: ReturnType<ServerSentEventDecoder['push']> = []
  for (const ch of text) {
    parts.push(...d.push(ch))
  }
  assert.deepEqual(parts, whole)
})

test('SSE: 无空行结尾的事件按规范丢弃，结尾 CR 例外', () => {
  const d = new ServerSentEventDecoder()
  d.push('data: incomplete')
  assert.deepEqual(d.end(), [])
  const d2 = new ServerSentEventDecoder()
  d2.push('data: x\n\r')
  // 结尾孤立 CR 是完整换行：这里恰好构成空行 → 事件在 end() 派发
  const tail = d2.end()
  assert.equal(tail.length, 1)
  assert.equal(tail[0].data, 'x')
})

test('SSE: id 含 NUL 被忽略', () => {
  const d = new ServerSentEventDecoder()
  d.push('id: ok\ndata: 1\n\n')
  const events = d.push('id: b\u0000ad\ndata: 2\n\n')
  assert.equal(events[0].lastEventId, 'ok')
})

test('readServerSentEvents: 多字节字符跨分片', async () => {
  const enc = new TextEncoder()
  const bytes = enc.encode('data: 你好世界\n\n')
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      // 从多字节字符中间切开
      const cut = bytes.indexOf(0xe4) + 1
      c.enqueue(bytes.slice(0, cut))
      c.enqueue(bytes.slice(cut))
      c.close()
    },
  })
  const out: string[] = []
  for await (const ev of readServerSentEvents(stream)) {
    out.push(ev.data)
  }
  assert.deepEqual(out, ['你好世界'])
})
