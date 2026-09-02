import type { Agent } from '@deepseek-ai/dsh-agent'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('scholar-native driver requires a config path')

const ctx = await boot('scholar-native-loader', resolveConfigPath(configPath, undefined))
try {
  const agent = {
    session: {
      events: [{
        type: 'user/message',
        data: {
          role: 'user',
          content: [{ type: 'text', text: 'graph neural network retrieval' }],
          source: { kind: 'user' },
        },
      }],
    },
  } as unknown as Agent
  const prompt = renderPrompt(await ctx.systemPrompt.assemble({ agent, scope: agent }))
  console.log(`[scholar-loader] persona=${prompt.includes('<scholar_persona>')} literature=${prompt.includes('Graph Retrieval')}`)
} finally {
  await ctx.fiber.dispose()
}
