/**
 * Transport factory: creates the appropriate MCP transport based on the
 * plugin's resolved config. Stdio spawns a child process (with credential
 * scrubbing); Streamable HTTP connects to a URL.
 *
 * @module
 */

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { Config } from './index.ts'

/**
 * The subprocess seam's scrubbed parent env (credential-shaped and stale
 * `DSH_*` names dropped), plus the spec's explicit env. The MCP SDK owns the
 * actual spawn, so this transport shares the scrub definition rather than the
 * spawn path.
 */
function buildChildEnv(extra: Record<string, string>): Record<string, string> {
  return { ...scrubbedParentEnv(), ...extra }
}

/**
 * Create an MCP transport from the resolved plugin config.
 *
 * @param config - Resolved plugin config discriminated on `transport`.
 * @param resolveBearerToken - Optional resolver called once for each HTTP operation.
 * @returns A connected-ready MCP Transport (stdio or Streamable HTTP).
 */
export function createTransport(
  config: Config,
  resolveBearerToken?: () => Promise<string>,
): Transport {
  switch (config.transport) {
    case 'stdio':
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: buildChildEnv(config.env),
        cwd: config.cwd,
      })
    case 'streamable-http': {
      const guardedFetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
        const headers = new Headers(config.headers)
        new Headers(init?.headers).forEach((value, name) => {
          headers.set(name, value)
        })
        if (resolveBearerToken !== undefined) {
          headers.set('authorization', `Bearer ${await resolveBearerToken()}`)
        }
        return await fetch(url, { ...init, headers, redirect: 'error' })
      }
      // The MCP SDK's StreamableHTTPClientTransport has optional callback
      // properties typed without `| undefined` (exactOptionalPropertyTypes
      // mismatch with the Transport interface); the SDK constructed the
      // object, so the cast records only that widening.
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        {
          requestInit: { headers: config.headers, redirect: 'error' },
          fetch: guardedFetch,
        },
      ) as Transport
    }
  }
}
