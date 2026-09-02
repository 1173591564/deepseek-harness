import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('dashboard driver requires a config path')

const port = Number(process.env.DASHBOARD_PORT)
const origin = `http://127.0.0.1:${port}`
const ctx = await boot('dashboard-loader', resolveConfigPath(configPath, undefined))
try {
  const page = await fetch(origin)
  const cookie = page.headers.get('set-cookie')?.split(';', 1)[0]
  if (cookie === undefined) throw new Error('dashboard did not issue a capability cookie')

  const events = await fetch(`${origin}/events`, {
    headers: { Cookie: cookie, Origin: origin },
  })
  if (!events.ok || events.body === null) throw new Error('dashboard event stream did not open')
  const reader = events.body.getReader()
  const answerPromise = ctx.userQuestions.ask({
    questions: [{
      id: 'decision',
      question: 'Continue?',
      options: [{ label: 'Continue' }, { label: 'Stop' }],
    }],
  })

  const decoder = new TextDecoder()
  let buffer = ''
  let question: { id: string } | undefined
  while (question === undefined) {
    const chunk = await reader.read()
    if (chunk.done) throw new Error('dashboard event stream ended before a question')
    buffer += decoder.decode(chunk.value, { stream: true })
    const data = /^data: (.+)$/m.exec(buffer)?.[1]
    if (data !== undefined) {
      const parsed = JSON.parse(data) as unknown
      if (
        typeof parsed === 'object'
        && parsed !== null
        && 'id' in parsed
        && typeof parsed.id === 'string'
      ) {
        question = { id: parsed.id }
      }
    }
  }

  const response = await fetch(`${origin}/answer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      Origin: origin,
    },
    body: JSON.stringify({
      id: question.id,
      answers: [{ id: 'decision', selected: ['Continue'] }],
    }),
  })
  if (!response.ok) throw new Error(`dashboard rejected an answer with ${response.status}`)
  const answer = await answerPromise
  await reader.cancel()
  console.log(`[dashboard-loader] answer=${answer.answers[0]?.selected[0]}`)
} finally {
  await ctx.fiber.dispose()
}
