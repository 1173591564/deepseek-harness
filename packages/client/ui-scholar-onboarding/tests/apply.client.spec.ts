import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import {
  apply,
  inject,
} from '@deepseek-ai/dsh-client-ui-scholar-onboarding/client'
import { ScholarOnboardingDialog } from '../src/client/ScholarOnboardingDialog.tsx'

usePinnedBrowserLanguages('zh-CN')

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  new TestRemote(ctx)
  ctx.provide('connection', { api: {} } as never)
  return { ctx, locale, slots: ctx.get('slots') as SlotRegistry }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'settings.onboarding': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

const HTTPS_CONFIG = {
  gatewayUrl: 'https://scholar.example/v1/mcp/scholar',
  allowInsecureHttp: false,
  validationTimeoutMs: 1_000,
}

describe('ui-scholar-onboarding apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote'])
  })

  it('registers before or after the onboarding slot declaration and disposes cleanly', async () => {
    const before = await bench()
    declare(before.slots)
    const fiber = before.ctx.plugin({ inject: [...inject], apply }, HTTPS_CONFIG)
    await fiber.await()
    const entry = before.slots.entries('settings.onboarding')[0]!
    expect(entry.component).toBe(ScholarOnboardingDialog)
    expect(entry.options).toMatchObject({ id: 'scholar-token', order: 10 })
    const injected = entry.inject as unknown as
      () => import('../src/client/ScholarOnboardingDialog.tsx').ScholarOnboardingInjected
    expect(injected().insecureTransport).toBe(false)
    expect(injected().t('title')).toBe('连接学者模式')

    await fiber.dispose()
    expect(before.slots.entries('settings.onboarding')).toHaveLength(0)
    expect(() => before.locale.register('settings.scholar-onboarding', 'zh', {})).not.toThrow()

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }, HTTPS_CONFIG).await()
    expect(after.slots.entries('settings.onboarding')).toHaveLength(0)
    declare(after.slots)
    await Promise.resolve()
    expect(after.slots.entries('settings.onboarding')[0]!.component)
      .toBe(ScholarOnboardingDialog)
  })

  it('requires an explicit opt-in for public HTTP and exposes its warning state', async () => {
    expect(() => {
      apply({
        effect: vi.fn(),
        get: vi.fn(() => {
          return { api: {} }
        }),
        locale: { register: vi.fn() },
      } as never, {
        ...HTTPS_CONFIG,
        gatewayUrl: 'http://scholar.example/v1/mcp/scholar',
      })
    }).toThrow(/requires HTTPS/)

    const allowed = await bench()
    declare(allowed.slots)
    await allowed.ctx.plugin({ inject: [...inject], apply }, {
      ...HTTPS_CONFIG,
      gatewayUrl: 'http://scholar.example/v1/mcp/scholar',
      allowInsecureHttp: true,
    }).await()
    const injected = allowed.slots.entries('settings.onboarding')[0]!.inject as unknown as
      () => import('../src/client/ScholarOnboardingDialog.tsx').ScholarOnboardingInjected
    expect(injected().insecureTransport).toBe(true)
  })
})
