import { appendFile } from 'node:fs/promises'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const auditPath = process.env.SCHOLAR_FIXTURE_AUDIT
if (auditPath === undefined || auditPath.length === 0) {
  throw new Error('SCHOLAR_FIXTURE_AUDIT is required')
}

const server = new McpServer(
  { name: 'scholar-fixture', version: '0.2.3' },
  { capabilities: { tools: {} } },
)

server.registerTool('scholar_search', {
  title: 'Scholar Search',
  description: 'Search the academic corpus. Use this tool for literature lookup requests.',
  inputSchema: {
    query: z.string().describe('Academic search query'),
    limit: z.number().int().positive().optional().describe('Maximum result count'),
  },
}, async ({ query, limit }) => {
  await appendFile(auditPath, `${JSON.stringify({ query, limit: limit ?? 10 })}\n`)
  return {
    content: [{
      type: 'text',
      text: 'SCHOLAR_FIXTURE_HIT: Graph Retrieval Systems (2025), paper_id=paper-1',
    }],
  }
})

await server.connect(new StdioServerTransport())
