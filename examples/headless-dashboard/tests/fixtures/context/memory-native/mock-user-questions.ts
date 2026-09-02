import { type Context, Service } from '@deepseek-ai/cordis'

export default class MockUserQuestions extends Service {
  constructor(ctx: Context) {
    super(ctx, 'userQuestions')
  }

  async ask(request: { questions: Array<{ id: string; options?: Array<{ label: string }> }> }): Promise<{
    answers: Array<{ id: string; selected: string[] }>
  }> {
    const question = request.questions[0]
    if (question === undefined) throw new Error('memory fixture received no question')
    const selected = question.options?.[0]?.label
    if (selected === undefined) throw new Error('memory fixture received no selectable answer')
    return { answers: [{ id: question.id, selected: [selected] }] }
  }
}
