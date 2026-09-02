import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'

function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = []
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => chunks.push(chunk))
    request.on('end', () => {
      try {
        resolve(JSON.parse(chunks.join('')) as Record<string, unknown>)
      } catch (error) {
        reject(error instanceof Error ? error : new Error('invalid JSON request'))
      }
    })
    request.on('error', reject)
  })
}

function send(response: ServerResponse, data: unknown): void {
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ code: 0, data }))
}

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<{
  endpoint: string
  close(): Promise<void>
}> {
  const server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    }),
  }
}

let persisted: Record<string, unknown> | undefined
const gateway = await listen((request, response) => {
  void (async () => {
    const body = await readJson(request)
    if (request.headers['x-tdai-user-key'] !== 'memory-key' || body.user_key !== 'memory-key') {
      response.writeHead(401).end()
      return
    }
    switch (request.url) {
      case '/v3/meta/auth/verify':
        send(response, { valid: true, user: { user_id: 'user-1' } })
        return
      case '/v3/meta/team/list':
        send(response, { items: [{ team_id: 'team-1', name: 'Research Team' }] })
        return
      case '/v3/meta/agent/list':
        send(response, { items: [{ agent_id: 'agent-1', name: 'Research Agent' }] })
        return
      case '/v3/meta/task/list':
        send(response, { items: [] })
        return
      case '/v3/meta/agent/get':
        send(response, { agent_id: 'agent-1', name: 'Research Agent' })
        return
      default:
        response.writeHead(404).end()
    }
  })().catch(() => response.writeHead(500).end())
})

const proxy = await listen((request, response) => {
  void (async () => {
    if (request.headers.authorization !== 'Bearer proxy-token') {
      response.writeHead(401).end()
      return
    }
    const body = await readJson(request)
    if (request.url === '/v3/session/native-init') {
      persisted = body
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
      return
    }
    if (request.url === '/v3/session/native-get') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ data: persisted }))
      return
    }
    response.writeHead(404).end()
  })().catch(() => response.writeHead(500).end())
})

process.env.MEMORY_ENDPOINT = gateway.endpoint
process.env.PROXY_ENDPOINT = proxy.endpoint
process.env.MEMORY_KEY = 'memory-key'
process.env.PROXY_TOKEN = 'proxy-token'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('memory-native driver requires a config path')

const events: Array<{ type: string; data: Record<string, unknown> }> = []
const agent = {
  id: 'agent-owner',
  session: {
    events,
    append(type: string, data: Record<string, unknown>) {
      events.push({ type, data })
    },
  },
} as unknown as Agent

try {
  const ctx = await boot('memory-native-loader', resolveConfigPath(configPath, undefined))
  try {
    await ctx.systemPrompt.assemble({ agent, scope: agent })
    const snapshot = events.find(event => event.type === 'user/message')
    const durable = snapshot?.data.source !== undefined
      && JSON.stringify(snapshot.data).includes('<session_context>')
    const stored = persisted?.session_key === 'agent-owner'
      && !JSON.stringify(persisted).includes('memory-key')
      && !JSON.stringify(persisted).includes('proxy-token')
    console.log(`[memory-loader] durable=${durable} persisted=${stored}`)
  } finally {
    await ctx.fiber.dispose()
  }
} finally {
  await Promise.all([gateway.close(), proxy.close()])
}
