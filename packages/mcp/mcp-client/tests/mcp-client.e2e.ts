/**
 * End-to-end tests for dsh-mcp-client. Exercises the REAL MCP protocol against:
 * 1. A self-written fixture server over stdio (controlled edge cases)
 * 2. @modelcontextprotocol/server-everything (official integration test server)
 * 3. @modelcontextprotocol/server-filesystem (real filesystem operations)
 * 4. An in-process StreamableHTTPServerTransport server over Streamable HTTP
 *
 * No API key needed — all servers are local/keyless.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { apply } from '@deepseek-ai/dsh-mcp-client/src/index.ts'
import { publicToolName } from '@deepseek-ai/dsh-mcp-client/src/tools.ts'
import type { Config } from '@deepseek-ai/dsh-mcp-client'

const testToolSignal = new AbortController().signal

const fixtureServerPath = fileURLToPath(new URL('./fixture-server.ts', import.meta.url))

// Resolve package-local .bin for pnpm-hoisted MCP server binaries.
const packageDir = fileURLToPath(new URL('..', import.meta.url))
const localBin = join(packageDir, 'node_modules', '.bin')

// ---- Helpers ----

async function mountRegistry(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

function sleep(ms: number): Promise<void> {
  const gate: PromiseWithResolvers<void> = Promise.withResolvers()
  setTimeout(gate.resolve, ms)
  return gate.promise
}

/** Narrow a result content block to its text, failing the test on any other shape. */
function textOf(block: unknown): string {
  if (block && typeof block === 'object' && 'text' in block && typeof block.text === 'string') {
    return block.text
  }
  throw new Error(`expected a text content block, got ${JSON.stringify(block)}`)
}

let callSeq = 0
function nextCallId(): CallId {
  return CallId(`e2e-${++callSeq}`)
}

// ---- Fixture server tests ----

describe('fixture server — controlled scenarios', () => {
  let ctx: Context

  const fixtureConfig: Config = {
    transport: 'stdio',
    serverName: 'fixture',
    command: process.execPath,
    args: [fixtureServerPath],
    env: {},
    cwd: packageDir,
    toolCallTimeoutMs: 15_000,
    failOnStartupError: false,
  }

  beforeAll(async () => {
    ctx = await mountRegistry()
    await apply(ctx, fixtureConfig)
  }, 30_000)

  afterAll(async () => {
    if (ctx) await ctx.fiber.dispose()
    await sleep(200)
  })

  it('discovers all fixture tools under the server namespace', () => {
    const schemas = ctx.tools.schemas()
    const names = schemas.map(s => s.name)
    expect(names).toContain('mcp__fixture__add')
    expect(names).toContain('mcp__fixture__greet')
    expect(names).toContain('mcp__fixture__fail')
    expect(names).toContain('mcp__fixture__image')
    // Raw names are not registered.
    expect(names).not.toContain('add')
  })

  it('normalizes the dotted tool name with a deterministic hash suffix', () => {
    const publicName = publicToolName('fixture', 'admin.reset')
    expect(publicName).toMatch(/^mcp__fixture__admin_reset_[0-9a-f]{12}$/)
    expect(ctx.tools.get(publicName)).toBeDefined()
  })

  it('executes the dotted tool via its normalized public name', async () => {
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: publicToolName('fixture', 'admin.reset'), arguments: {},
    })
    expect(result.isError).toBe(false)
    expect(result.content[0]).toEqual({ type: 'text', text: 'reset done' })
  })

  it('executes add(2, 3) → "5"', async () => {
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__fixture__add', arguments: { a: 2, b: 3 },
    })
    expect(result.isError).toBe(false)
    expect(result.content[0]).toEqual({ type: 'text', text: '5' })
  })

  it('executes greet("World") → "Hello, World!"', async () => {
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__fixture__greet', arguments: { name: 'World' },
    })
    expect(result.isError).toBe(false)
    expect(result.content[0]).toEqual({ type: 'text', text: 'Hello, World!' })
  })

  it('executes fail() → isError result', async () => {
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__fixture__fail', arguments: {},
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ type: 'text' })
  })

  it('executes image() → image placeholder', async () => {
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__fixture__image', arguments: {},
    })
    expect(result.isError).toBe(false)
    const text = textOf(result.content[0])
    expect(text).toContain('Here is an image:')
    expect(text).toContain('[image: image/png, content discarded]')
    expect(text).toContain('End of image.')
  })
})

describe('fixture server — duplicate serverName', () => {
  it('rejects a second instance with the same serverName on one root', async () => {
    const ctx = await mountRegistry()
    const config: Config = {
      transport: 'stdio',
      serverName: 'dup',
      command: process.execPath,
      args: [fixtureServerPath],
      env: {},
      cwd: packageDir,
      toolCallTimeoutMs: 15_000,
      failOnStartupError: false,
    }
    await apply(ctx, config)

    await expect(apply(ctx, config)).rejects.toThrow(/serverName "dup" is already in use/)

    await ctx.fiber.dispose()
    await sleep(200)
  }, 30_000)
})

describe('fixture server — disposal', () => {
  it('disposes cleanly without error', async () => {
    const ctx = await mountRegistry()
    await apply(ctx, {
      transport: 'stdio',
      serverName: 'fixture',
      command: process.execPath,
      args: [fixtureServerPath],
      env: {},
      cwd: packageDir,
      toolCallTimeoutMs: 15_000,
      failOnStartupError: false,
    })

    // Tools are registered before dispose.
    expect(ctx.tools.get('mcp__fixture__add')).toBeDefined()
    expect(ctx.tools.schemas().length).toBeGreaterThanOrEqual(4)

    // Dispose should complete without throwing.
    await ctx.fiber.dispose()
    await sleep(200)
  }, 30_000)
})

describe('fixture server — crash recovery', () => {
  function crashConfig(serverName: string, reconnect: NonNullable<Config['reconnect']>): Config {
    return {
      transport: 'stdio',
      serverName,
      command: process.execPath,
      args: [fixtureServerPath],
      env: {},
      cwd: packageDir,
      toolCallTimeoutMs: 15_000,
      failOnStartupError: false,
      reconnect,
    }
  }

  it('auto-reconnects after a stdio crash and serves tool calls again', async () => {
    const ctx = await mountRegistry()
    await apply(ctx, crashConfig('crashy', { initialDelayMs: 50, maxDelayMs: 500, maxAttempts: 40 }))

    const before = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__crashy__add', arguments: { a: 2, b: 3 },
    })
    expect(textOf(before.content[0])).toBe('5')

    // The crash tool replies, then kills the real child process.
    const crash = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__crashy__crash', arguments: {},
    })
    expect(crash.isError).toBe(false)

    // Recovery is proven by the world: a post-crash call round-trips through
    // the respawned server process.
    await vi.waitFor(async () => {
      const after = await ctx.tools.execute({
        signal: testToolSignal,
        callId: nextCallId(), name: 'mcp__crashy__add', arguments: { a: 20, b: 22 },
      })
      expect(after.isError).toBe(false)
      expect(textOf(after.content[0])).toBe('42')
    }, { timeout: 15_000, interval: 250 })

    // The recovered generation replaced the dead one: no duplicates, no leak.
    const addEntries = ctx.tools.schemas().map(s => s.name).filter(name => name === 'mcp__crashy__add')
    expect(addEntries).toHaveLength(1)

    await ctx.fiber.dispose()
    await sleep(200)
  }, 30_000)

  it('plugin unload during an outage stops reconnection and unregisters tools', async () => {
    const ctx = await mountRegistry()
    const fiber = ctx.plugin(
      { name: 'mcp-client', inject: ['tools'], apply },
      crashConfig('ephemeral', { initialDelayMs: 8_000, maxDelayMs: 8_000, maxAttempts: 5 }),
    )
    // Cordis awaits async apply() as startup work; wait for it.
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__ephemeral__add')).toBeDefined() }, { timeout: 20_000 })

    const crash = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__ephemeral__crash', arguments: {},
    })
    expect(crash.isError).toBe(false)

    // Give the transport close a moment to land the supervisor in its 8s
    // backoff wait, then unload: disposal must not sit out the backoff.
    await sleep(300)
    const started = Date.now()
    await fiber.dispose()
    expect(Date.now() - started).toBeLessThan(4_000)

    expect(ctx.tools.get('mcp__ephemeral__add')).toBeUndefined()
    await sleep(200)
    expect(ctx.tools.get('mcp__ephemeral__add')).toBeUndefined()

    await ctx.fiber.dispose()
  }, 30_000)
})

// ---- @modelcontextprotocol/server-everything ----

describe('server-everything — official test server', () => {
  let ctx: Context

  const config: Config = {
    transport: 'stdio',
    serverName: 'everything',
    command: join(localBin, 'mcp-server-everything'),
    args: ['stdio'],
    env: {},
    cwd: '',
    toolCallTimeoutMs: 30_000,
    failOnStartupError: false,
  }

  beforeAll(async () => {
    ctx = await mountRegistry()
    await apply(ctx, config)
  }, 60_000)

  afterAll(async () => {
    if (ctx) await ctx.fiber.dispose()
    await sleep(500)
  })

  it('discovers tools from server-everything', () => {
    const schemas = ctx.tools.schemas()
    const names = schemas.map(s => s.name)
    expect(names).toContain('mcp__everything__echo')
    expect(names).toContain('mcp__everything__get-sum')
    expect(names).toContain('mcp__everything__get-tiny-image')
    expect(names.length).toBeGreaterThanOrEqual(8)
  })

  it('executes echo({ message: "hello" }) → "Echo: hello"', async () => {
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__everything__echo', arguments: { message: 'hello' },
    })
    expect(result.isError).toBe(false)
    expect(textOf(result.content[0])).toBe('Echo: hello')
  })

  it('executes get-sum({ a: 3, b: 7 }) → contains "10"', async () => {
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__everything__get-sum', arguments: { a: 3, b: 7 },
    })
    expect(result.isError).toBe(false)
    expect(textOf(result.content[0])).toContain('10')
  })

  it('executes get-tiny-image → image placeholder', async () => {
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__everything__get-tiny-image', arguments: {},
    })
    expect(result.isError).toBe(false)
    expect(textOf(result.content[0])).toContain('[image: image/png, content discarded]')
  })
})

// ---- @modelcontextprotocol/server-filesystem ----

describe('server-filesystem — real filesystem operations', () => {
  let ctx: Context
  let tempDir: string

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mcp-fs-e2e-'))

    ctx = await mountRegistry()
    const config: Config = {
      transport: 'stdio',
      serverName: 'filesystem',
      command: join(localBin, 'mcp-server-filesystem'),
      args: [tempDir],
      env: {},
      cwd: '',
      toolCallTimeoutMs: 30_000,
      failOnStartupError: false,
    }
    await apply(ctx, config)
  }, 60_000)

  afterAll(async () => {
    if (ctx) await ctx.fiber.dispose()
    await sleep(500)
    await rm(tempDir, { recursive: true, force: true })
  })

  it('discovers filesystem tools', () => {
    const schemas = ctx.tools.schemas()
    const names = schemas.map(s => s.name)
    expect(names).toContain('mcp__filesystem__read_file')
    expect(names).toContain('mcp__filesystem__write_file')
    expect(names).toContain('mcp__filesystem__list_directory')
  })

  it('write_file + read_file round-trip', async () => {
    const filePath = join(tempDir, 'test.txt')
    const content = 'Hello from MCP e2e test!'

    const writeResult = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__filesystem__write_file', arguments: { path: filePath, content },
    })
    expect(writeResult.isError).toBe(false)

    // Assert the filesystem effect independently of the tool result.
    const onDisk = await readFile(filePath, 'utf8')
    expect(onDisk).toBe(content)

    const readResult = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__filesystem__read_file', arguments: { path: filePath },
    })
    expect(readResult.isError).toBe(false)
    expect(textOf(readResult.content[0])).toContain(content)
  })

  it('list_directory shows written file', async () => {
    await writeFile(join(tempDir, 'listed.txt'), 'listed')

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__filesystem__list_directory', arguments: { path: tempDir },
    })
    expect(result.isError).toBe(false)
    expect(textOf(result.content[0])).toContain('listed.txt')
  })
})

// ---- Streamable HTTP transport ----

describe('streamable-http — in-process MCP server', () => {
  let ctx: Context
  let httpServer: Server
  let baseUrl: string
  let credentialsDir: string
  /** Authorization header values observed by the HTTP server, in arrival order. */
  const seenAuth: Array<string | undefined> = []

  /**
   * Stateless Streamable HTTP endpoint: a fresh McpServer + server transport
   * per request (the SDK's documented stateless pattern — no session id, no
   * SSE stream to keep). The tool set mirrors a minimal fixture server.
   */
  async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    seenAuth.push(req.headers.authorization)
    if (!['Bearer first-token', 'Bearer rotated-token'].includes(req.headers.authorization ?? '')) {
      res.writeHead(401).end('Unauthorized')
      return
    }
    const server = new McpServer(
      { name: 'http-fixture', version: '1.0.0' },
      { capabilities: { tools: {} } },
    )
    server.registerTool('ping', {
      description: 'Replies pong.',
      inputSchema: {},
    }, async () => ({
      content: [{ type: 'text', text: 'pong' }],
    }))
    server.registerTool('shout', {
      description: 'Upper-cases a message.',
      inputSchema: { message: z.string().describe('Message to upper-case') },
    }, async args => ({
      content: [{ type: 'text', text: args.message.toUpperCase() }],
    }))
    // Stateless mode: sessionIdGenerator ABSENT (the runtime treats absent and
    // explicit-undefined identically; exactOptionalPropertyTypes forbids the
    // SDK-documented explicit `sessionIdGenerator: undefined` spelling).
    const transport = new StreamableHTTPServerTransport({})
    res.on('close', () => { void transport.close(); void server.close() })
    // Same exactOptionalPropertyTypes mismatch the client transport factory
    // documents (src/transport.ts): the SDK types optional callbacks without
    // `| undefined`. The SDK constructed the object; the cast is safe.
    await server.connect(transport as Transport)
    await transport.handleRequest(req, res)
  }

  beforeAll(async () => {
    httpServer = createServer((req, res) => {
      if (req.url?.startsWith('/redirect?target=')) {
        const port = req.url.slice('/redirect?target='.length)
        res.writeHead(307, { location: `http://127.0.0.1:${port}/mcp` }).end()
        return
      }
      handleMcpRequest(req, res).catch((error: unknown) => {
        res.writeHead(500).end(String(error))
      })
    })
    const listening: PromiseWithResolvers<void> = Promise.withResolvers()
    httpServer.listen(0, '127.0.0.1', listening.resolve)
    await listening.promise
    const address = httpServer.address()
    if (address === null || typeof address === 'string') throw new Error(`expected a TCP AddressInfo, got ${String(address)}`)
    baseUrl = `http://127.0.0.1:${address.port}/mcp`

    ctx = await mountRegistry()
    credentialsDir = await mkdtemp(join(tmpdir(), 'dsh-mcp-credentials-'))
    await ctx.plugin(LocalCredentialProvider, {
      path: join(credentialsDir, '.credentials.yaml'),
      watch: false,
    })
    await ctx.credentials.set(credentialRef('MCP_E2E_TOKEN'), 'first-token')
    const config: Config = {
      transport: 'streamable-http',
      serverName: 'web',
      url: baseUrl,
      headers: {},
      bearerTokenEnv: 'MCP_E2E_TOKEN',
      toolCallTimeoutMs: 15_000,
      failOnStartupError: false,
    }
    await apply(ctx, config)
  }, 30_000)

  afterAll(async () => {
    if (ctx) await ctx.fiber.dispose()
    await rm(credentialsDir, { recursive: true, force: true })
    await sleep(200)
    const closed: PromiseWithResolvers<void> = Promise.withResolvers()
    httpServer.close(() => { closed.resolve() })
    await closed.promise
  })

  it('discovers tools under the server namespace over HTTP', () => {
    const names = ctx.tools.schemas().map(s => s.name)
    expect(names).toContain('mcp__web__ping')
    expect(names).toContain('mcp__web__shout')
  })

  it('executes ping() → "pong" over HTTP', async () => {
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__web__ping', arguments: {},
    })
    expect(result.isError).toBe(false)
    expect(result.content[0]).toEqual({ type: 'text', text: 'pong' })
  })

  it('executes shout({ message }) with args over HTTP', async () => {
    await ctx.credentials.set(credentialRef('MCP_E2E_TOKEN'), 'rotated-token')
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__web__shout', arguments: { message: 'quiet' },
    })
    expect(result.isError).toBe(false)
    expect(result.content[0]).toEqual({ type: 'text', text: 'QUIET' })
  })

  it('resolves the Bearer credential for every HTTP request', () => {
    expect(seenAuth.length).toBeGreaterThan(0)
    expect(seenAuth).toContain('Bearer first-token')
    expect(seenAuth).toContain('Bearer rotated-token')
    for (const auth of seenAuth) {
      expect(['Bearer first-token', 'Bearer rotated-token']).toContain(auth)
    }
  })

  it('fails before network access when the credential is missing', async () => {
    const isolated = await mountRegistry()
    const before = seenAuth.length
    await expect(apply(isolated, {
      transport: 'streamable-http',
      serverName: 'missing',
      url: baseUrl,
      headers: {},
      bearerTokenEnv: 'MCP_MISSING_TOKEN',
      toolCallTimeoutMs: 15_000,
      failOnStartupError: true,
      reconnect: { enabled: false },
    })).rejects.toThrow('initial connection or tool synchronization failed')
    expect(seenAuth).toHaveLength(before)
    await isolated.fiber.dispose()
  })

  it('rejects a wrong Bearer credential at the server', async () => {
    const isolated = await mountRegistry()
    const directory = await mkdtemp(join(tmpdir(), 'dsh-mcp-wrong-credentials-'))
    await isolated.plugin(LocalCredentialProvider, {
      path: join(directory, '.credentials.yaml'),
      watch: false,
    })
    await isolated.credentials.set(credentialRef('MCP_WRONG_TOKEN'), 'wrong-token')
    await expect(apply(isolated, {
      transport: 'streamable-http',
      serverName: 'wrong',
      url: baseUrl,
      headers: {},
      bearerTokenEnv: 'MCP_WRONG_TOKEN',
      toolCallTimeoutMs: 15_000,
      failOnStartupError: true,
      reconnect: { enabled: false },
    })).rejects.toThrow('initial connection or tool synchronization failed')
    expect(seenAuth.at(-1)).toBe('Bearer wrong-token')
    await isolated.fiber.dispose()
    await rm(directory, { recursive: true, force: true })
  })

  it('rejects redirects without contacting the target', async () => {
    let targetRequests = 0
    const target = createServer((_req, res) => {
      targetRequests += 1
      res.writeHead(200).end()
    })
    const listening: PromiseWithResolvers<void> = Promise.withResolvers()
    target.listen(0, '127.0.0.1', listening.resolve)
    await listening.promise
    const targetAddress = target.address()
    if (targetAddress === null || typeof targetAddress === 'string') {
      throw new Error(`expected a TCP AddressInfo, got ${String(targetAddress)}`)
    }
    const redirectUrl = `${baseUrl.replace('/mcp', '/redirect')}?target=${targetAddress.port}`
    const isolated = await mountRegistry()
    const directory = await mkdtemp(join(tmpdir(), 'dsh-mcp-redirect-credentials-'))
    await isolated.plugin(LocalCredentialProvider, {
      path: join(directory, '.credentials.yaml'),
      watch: false,
    })
    await isolated.credentials.set(credentialRef('MCP_REDIRECT_TOKEN'), 'first-token')
    await expect(apply(isolated, {
      transport: 'streamable-http',
      serverName: 'redirect',
      url: redirectUrl,
      headers: {},
      bearerTokenEnv: 'MCP_REDIRECT_TOKEN',
      toolCallTimeoutMs: 15_000,
      failOnStartupError: true,
      reconnect: { enabled: false },
    })).rejects.toThrow('initial connection or tool synchronization failed')
    expect(targetRequests).toBe(0)
    await isolated.fiber.dispose()
    await rm(directory, { recursive: true, force: true })
    const closed: PromiseWithResolvers<void> = Promise.withResolvers()
    target.close(() => {
      closed.resolve()
    })
    await closed.promise
  })
})
