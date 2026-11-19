import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DsmlStreamFilter, extractDsmlCalls, dsmlSearchQueries } from '../src/services/api/dsml.js'

const CALL =
  '<｜DSML｜calls>\n<｜DSML｜invoke name="web_search">\n<｜DSML｜parameter name="query">杭州 天气</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜calls>'

test('extractDsmlCalls: 完整调用剥离正文', () => {
  const { clean, calls } = extractDsmlCalls(`前文${CALL}后文`)
  // 调用块剥离后，块外正文的换行保留
  assert.equal(clean.replace(/\s+/g, ''), '前文后文')
  assert.ok(!clean.includes('DSML'))
  assert.deepEqual(calls, [{ name: 'web_search', query: '杭州 天气' }])
})

test('extractDsmlCalls: 无标记原样返回', () => {
  const { clean, calls } = extractDsmlCalls('普通正文，无标记。')
  assert.equal(clean, '普通正文，无标记。')
  assert.equal(calls.length, 0)
})

test('extractDsmlCalls: 截断的半个标记被丢弃', () => {
  const { clean } = extractDsmlCalls('正文<｜DSML｜inv')
  assert.equal(clean, '正文')
})

test('流式过滤: 标记逐字符喂入不泄漏', () => {
  const filter = new DsmlStreamFilter()
  let visible = ''
  const text = `答案开始。${CALL}答案结束。`
  for (const ch of text) {
    visible += filter.feed(ch)
  }
  visible += filter.flush()
  assert.equal(visible.replace(/\s+/g, ''), '答案开始。答案结束。')
  assert.deepEqual(dsmlSearchQueries(filter.calls), ['杭州 天气'])
})

test('流式过滤: 任意分片切法结果一致', () => {
  const text = `A${CALL}B${CALL}C`
  for (let cut = 0; cut <= text.length; cut++) {
    const filter = new DsmlStreamFilter()
    const visible = filter.feed(text.slice(0, cut)) + filter.feed(text.slice(cut)) + filter.flush()
    assert.equal(visible.replace(/\s+/g, ''), 'ABC', `cut=${cut}`)
    assert.equal(filter.calls.length, 2, `cut=${cut}`)
  }
})

test('流式过滤: 标记前缀悬停在分片尾部不误输出', () => {
  const filter = new DsmlStreamFilter()
  const v1 = filter.feed('正文<｜DS')
  assert.equal(v1, '正文')
  const v2 = filter.feed('ML｜calls><｜DSML｜invoke name="web_search"><｜DSML｜parameter name="query">q</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜calls>')
  assert.equal(v2, '')
  assert.deepEqual(dsmlSearchQueries(filter.calls), ['q'])
})

test('流式过滤: 未闭合调用在 flush 时丢弃且不产出调用', () => {
  const filter = new DsmlStreamFilter()
  const visible = filter.feed('正文<｜DSML｜calls><｜DSML｜invoke name="web_search">') + filter.flush()
  assert.equal(visible, '正文')
  assert.equal(filter.calls.length, 0)
})

test('流式过滤: 普通文本含 < 不受影响', () => {
  const filter = new DsmlStreamFilter()
  const visible = filter.feed('a < b 且 c << d') + filter.flush()
  assert.equal(visible, 'a < b 且 c << d')
})
