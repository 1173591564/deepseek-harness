import { createServer } from 'node:net'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const root = join(import.meta.dirname, '../../../..')
const fixture = join(root, 'examples/headless-dashboard/tests/fixtures/interaction/user-questions-dashboard/cordis.yml')
const driver = join(import.meta.dirname, 'loader-driver.ts')

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('test port was unavailable')
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
  return address.port
}

describe('user-questions-dashboard Loader composition', () => {
  it('collects an authenticated browser answer through the real Loader', async () => {
    const port = await availablePort()
    const result = await runLoaderSmoke({
      label: 'dashboard Loader smoke',
      tempDirPrefix: 'dashboard-loader-',
      binScript: driver,
      libBinScript: driver,
      configPath: fixture,
      tsconfigPath: join(root, 'tsconfig.json'),
      env: { DASHBOARD_PORT: String(port) },
    })

    expect(result.stdout).toContain('[dashboard-loader] answer=Continue')
    expect(result.stderr).not.toContain('UNHANDLED')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
