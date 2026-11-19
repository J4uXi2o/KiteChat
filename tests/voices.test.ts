import assert from 'node:assert/strict'
import { test } from 'node:test'
import { voiceOptionsFor, voiceLabel, OPENAI_LEGACY_VOICES } from '../src/services/speech/voices.js'

test('deepseek 音色目录固定', () => {
  const options = voiceOptionsFor('deepseek', '')
  assert.ok(options.some((v) => v.value === 'stella'))
})

test('openai tts-1 仅旧版子集', () => {
  const legacy = voiceOptionsFor('openai', 'tts-1')
  assert.deepEqual(legacy, OPENAI_LEGACY_VOICES)
  assert.ok(!legacy.some((v) => v.value === 'marin'))
  const modern = voiceOptionsFor('openai', 'gpt-4o-mini-tts')
  assert.ok(modern.some((v) => v.value === 'marin'))
})

test('siliconflow 音色带模型前缀', () => {
  const options = voiceOptionsFor('siliconflow', 'FunAudioLLM/CosyVoice2-0.5B')
  assert.ok(options.every((v) => v.value.startsWith('FunAudioLLM/CosyVoice2-0.5B:')))
  const fallback = voiceOptionsFor('siliconflow', '')
  assert.ok(fallback.length > 0)
})

test('voiceLabel: 未知音色回退原值', () => {
  assert.equal(voiceLabel('openai', 'gpt-4o-mini-tts', 'custom-x'), 'custom-x')
  assert.notEqual(voiceLabel('openai', 'gpt-4o-mini-tts', 'alloy'), 'alloy'.length)
})
