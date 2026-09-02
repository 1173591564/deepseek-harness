import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const root = join(import.meta.dirname, '../../../..')
const fixture = join(root, 'examples/headless-dashboard/tests/fixtures/context/memory-native/cordis.yml')
const driver = join(import.meta.dirname, 'loader-driver.ts')

describe('memory-native Loader composition', () => {
  it('persists and logs initialized context through the real Loader', async () => {
    const result = await runLoaderSmoke({
      label: 'memory-native Loader smoke',
      tempDirPrefix: 'memory-native-loader-',
      binScript: driver,
      libBinScript: driver,
      configPath: fixture,
      tsconfigPath: join(root, 'tsconfig.json'),
    })

    expect(result.stdout).toContain('[memory-loader] durable=true persisted=true')
    expect(result.stderr).not.toContain('UNHANDLED')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
