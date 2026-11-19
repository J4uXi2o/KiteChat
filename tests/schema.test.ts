import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkManifest, readSessionIndex, readSessionFile } from '../src/services/chat/history/schema.js'
import { EXPORT_FORMAT_VERSION } from '../src/services/chat/history/format.js'

const entry = {
  id: 's1',
  title: '标题',
  message_count: 2,
  inserted_at: '2026-11-19T10:00:00Z',
  updated_at: '2026-11-19T10:00:01.123456Z',
}

test('manifest: 当前版本通过，更高版本拒绝', () => {
  checkManifest({ export_format_version: EXPORT_FORMAT_VERSION })
  assert.throws(() => checkManifest({ export_format_version: EXPORT_FORMAT_VERSION + 1 }))
  assert.throws(() => checkManifest({ export_format_version: 'x' }))
  assert.throws(() => checkManifest(null))
})

test('sessionIndex: 合法条目通过并保留时间原文', () => {
  const [item] = readSessionIndex([entry])
  assert.equal(item.id, 's1')
  assert.equal(item.updated_at, entry.updated_at)
  assert.equal(item.pinned, false)
})

test('sessionIndex: 路径注入 id 拒绝', () => {
  for (const id of ['../x', 'a/b', 'a\\b', '.', '..']) {
    assert.throws(() => readSessionIndex([{ ...entry, id }]), `id=${id}`)
  }
})

test('sessionIndex: 非法时间/计数拒绝', () => {
  assert.throws(() => readSessionIndex([{ ...entry, inserted_at: '2026-13-40T99:00:00Z' }]))
  assert.throws(() => readSessionIndex([{ ...entry, message_count: -1 }]))
  assert.throws(() => readSessionIndex([{ ...entry, message_count: 1.5 }]))
})

test('sessionFile: 合法消息树通过，未知字段被剥除', () => {
  const file = {
    ...entry,
    current_message_id: 1,
    messages: [
      {
        id: 0,
        parent_id: null,
        role: 'USER',
        status: 'FINISHED',
        thinking_enabled: false,
        search_enabled: false,
        accumulated_token_usage: 0,
        inserted_at: '2026-11-19T10:00:00Z',
        fragments: [{ type: 'RESPONSE', content: '你好', extra_unknown: 1 }],
        sneaky: 'x',
      },
    ],
    sneaky: 'y',
  }
  const parsed = readSessionFile(file) as unknown as { sneaky?: unknown; messages: unknown[] }
  assert.equal(parsed.sneaky, undefined)
  assert.equal(parsed.messages.length, 1)
})

test('sessionFile: 非法角色/状态拒绝，坏片段丢弃不整树失败', () => {
  const base = {
    ...entry,
    current_message_id: 0,
    messages: [
      {
        id: 0,
        parent_id: null,
        role: 'USER',
        status: 'FINISHED',
        thinking_enabled: false,
        search_enabled: false,
        accumulated_token_usage: 0,
        inserted_at: '2026-11-19T10:00:00Z',
        fragments: [{ type: 'NOT_A_TYPE' }, { type: 'RESPONSE', content: 'ok' }],
      },
    ],
  }
  const parsed = readSessionFile(base)
  assert.equal(parsed.messages[0].fragments.length, 1)
  assert.throws(() =>
    readSessionFile({
      ...base,
      messages: [{ ...base.messages[0], role: 'ROBOT' }],
    })
  )
})
