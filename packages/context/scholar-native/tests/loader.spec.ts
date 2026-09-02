import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const root = join(import.meta.dirname, '../../../..')
const fixture = join(root, 'examples/scholar/tests/fixtures/context/scholar-native/cordis.yml')
const driver = join(import.meta.dirname, 'loader-driver.ts')

describe('scholar-native Loader composition', () => {
  it('assembles current literature through the real Loader', async () => {
    const result = await runLoaderSmoke({
      label: 'scholar-native Loader smoke',
      tempDirPrefix: 'scholar-native-loader-',
      binScript: driver,
      libBinScript: driver,
      configPath: fixture,
      tsconfigPath: join(root, 'tsconfig.json'),
      prepare: async (cwd) => {
        const scholarHome = join(cwd, '.dsh/scholar')
        await mkdir(join(scholarHome, '.scholar/rules'), { recursive: true })
        await mkdir(join(scholarHome, 'output/parsed'), { recursive: true })
        await writeFile(join(scholarHome, '.scholar/rules/identity.md'), 'Academic research assistant.')
        await writeFile(join(scholarHome, 'output/parsed/paper.json'), JSON.stringify({
          paper_id: 'paper-1',
          title: 'Graph Retrieval',
          abstract: 'Graph neural network methods for document retrieval.',
          year: 2025,
          authors: ['Researcher'],
        }))
      },
    })

    expect(result.stdout).toContain('[scholar-loader] persona=true literature=true')
    expect(result.stderr).not.toContain('scholar-native: literature enrichment failed')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
