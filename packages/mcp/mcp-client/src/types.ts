/** Client-safe event declarations for the MCP client bridge. */

import type { CredentialRef } from '@deepseek-ai/dsh-credentials'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The MCP server rejected its configured credential with HTTP 401.
     * @param payload - Server and credential identity for browser consumers.
     * @mode emit
     */
    'mcp-client/authentication-rejected'(payload: {
      serverName: string
      credentialRef: CredentialRef
    }): void
  }
}
