// KiteChat 跨平台生产构建入口（替代上游的 rm -rf && NODE_ENV=... 写法）
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cli = path.join(root, 'node_modules', '@rspack', 'cli', 'bin', 'rspack.js')
const result = spawnSync(process.execPath, [cli, 'build', '-c', 'rspack.config.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
})
process.exit(result.status ?? 1)