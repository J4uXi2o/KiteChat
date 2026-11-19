// KiteChat 单元测试入口：tsc 编译纯函数模块到 .test-build，再用 node:test 执行
// 不引入额外依赖；浏览器 API（localStorage）以最小桩补齐
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, '.test-build')

fs.rmSync(out, { recursive: true, force: true })
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const compile = spawnSync(
  process.execPath,
  [
    tsc,
    '--ignoreConfig',
    'src/services/api/dsml.ts',
    'src/services/api/sse.ts',
    'src/services/chat/history/schema.ts',
    'src/services/speech/voices.ts',
    'tests/dsml.test.ts',
    'tests/sse.test.ts',
    'tests/schema.test.ts',
    'tests/voices.test.ts',
    '--outDir', out,
    '--module', 'nodenext',
    '--moduleResolution', 'nodenext',
    '--target', 'es2022',
    '--lib', 'es2022,dom',
    '--types', 'node',
    '--strict',
    '--skipLibCheck',
    '--esModuleInterop',
  ],
  { cwd: root, stdio: 'inherit' }
)
if (compile.status !== 0) {
  process.exit(compile.status ?? 1)
}
// ESM 标记
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ type: 'module' }))
// 最小 localStorage 桩（settings 存储读取用）
const setup = path.join(out, 'tests', 'setup.mjs')
fs.writeFileSync(
  setup,
  `const store = new Map()\nglobalThis.localStorage = {\n  getItem: (k) => (store.has(k) ? store.get(k) : null),\n  setItem: (k, v) => store.set(k, String(v)),\n  removeItem: (k) => store.delete(k),\n}\n`
)
const run = spawnSync(
  process.execPath,
  ['--import', './tests/setup.mjs', '--test', 'tests/dsml.test.js', 'tests/sse.test.js', 'tests/schema.test.js', 'tests/voices.test.js'],
  { cwd: out, stdio: 'inherit' }
)
process.exit(run.status ?? 1)
