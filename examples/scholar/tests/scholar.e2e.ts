import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import {
  LOADER_SMOKE_TEST_TIMEOUT_MS,
  runLoaderSmoke,
} from '@deepseek-ai/dsh-loader-smoke'
import { codingHarness, waitForIdle } from '../../headless-agent/tests/harness.ts'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const fixture = join(root, 'examples/scholar/tests/fixtures/context/scholar-native/cordis.yml')
const driver = join(root, 'packages/context/scholar-native/tests/loader-driver.ts')
const server = fileURLToPath(new URL('./fixture-server.ts', import.meta.url))

async function prepareScholarHome(scholarHome: string): Promise<void> {
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
}

let ctx: Context | undefined
let workdir: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (workdir !== undefined) await rm(workdir, { recursive: true, force: true })
  workdir = undefined
})

describe('scholar example keyless Loader smoke', () => {
  it('assembles the Scholar persona and current literature', async () => {
    const result = await runLoaderSmoke({
      label: 'scholar example Loader smoke',
      tempDirPrefix: 'scholar-example-loader-',
      binScript: driver,
      libBinScript: driver,
      configPath: fixture,
      tsconfigPath: join(root, 'tsconfig.json'),
      prepare: async (cwd) => {
        await prepareScholarHome(join(cwd, '.dsh/scholar'))
      },
    })

    expect(result.stdout).toContain('[scholar-loader] persona=true literature=true')
    expect(result.stderr).not.toContain('scholar-native: literature enrichment failed')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('scholar example with-key smoke', () => {
  it('records a real model-driven Scholar tool execution outside model prose', async () => {
    workdir = await mkdtemp(join(tmpdir(), 'scholar-example-model-'))
    const scholarHome = join(workdir, 'scholar')
    const auditPath = join(workdir, 'scholar-audit.jsonl')
    await prepareScholarHome(scholarHome)

    ctx = await codingHarness(workdir)
    await ctx.plugin(McpClient, {
      transport: 'stdio',
      serverName: 'scholar',
      command: process.execPath,
      args: [server],
      env: { SCHOLAR_FIXTURE_AUDIT: auditPath },
      cwd: root,
      toolCallTimeoutMs: 15_000,
      failOnStartupError: true,
    })
    const agent = ctx.agentLoop.create(SessionId('scholar-model-e2e'), {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    })
    agent.followup(createUserMessage({
      content: [{
        type: 'text',
        text: 'Call mcp__scholar__scholar_search exactly once with query '
          + '"graph retrieval phase one proof", then summarize the returned paper in one sentence.',
      }],
      source: { kind: 'user' },
    }))
    await waitForIdle(ctx, agent)

    const calls = [...agent.session.events].filter(event => event.type === 'tool/call')
    expect(calls.some(event => event.data.name === 'mcp__scholar__scholar_search')).toBe(true)
    const audit = (await readFile(auditPath, 'utf8')).trim().split('\n').map(
      line => JSON.parse(line) as { query: string },
    )
    expect(audit).toEqual([{ query: 'graph retrieval phase one proof', limit: 10 }])
  }, 120_000)
})
