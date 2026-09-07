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

async function bench(connectionApi: Record<string, unknown> = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const remote = new TestRemote(ctx)
  ctx.provide('connection', { api: connectionApi } as never)
  return { ctx, locale, remote, slots: ctx.get('slots') as SlotRegistry }
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

  it('shows only Scholar rejection events and hides again after saving a replacement', async () => {
    const api = {
      agentPresets: { list: vi.fn(() => Promise.resolve({
        rpcId: 'preset' as never,
        result: { ok: true, value: { presets: [{ id: 'academic' }] } },
      })) },
      credentials: {
        describe: vi.fn(() => Promise.resolve({
          rpcId: 'describe' as never,
          result: { ok: true, value: { credentials: {
            SCHOLAR_REMOTE_TOKEN: { configured: true, writable: true },
          } } },
        })),
        set: vi.fn(() => Promise.resolve({
          rpcId: 'set' as never,
          result: { ok: true, value: {} },
        })),
      },
    }
    const hWithApi = await bench(api)
    declare(hWithApi.slots)
    const fiber = hWithApi.ctx.plugin({ inject: [...inject], apply }, HTTPS_CONFIG)
    await fiber.await()
    const entry = hWithApi.slots.entries('settings.onboarding')[0]!
    const injected = entry.inject as unknown as
      () => import('../src/client/ScholarOnboardingDialog.tsx').ScholarOnboardingInjected
    const controller = injected().controller

    hWithApi.remote.$dispatch('mcp-client/authentication-rejected', [{
      serverName: 'scholar',
      credentialRef: 'OTHER_TOKEN',
    }])
    expect(controller.store.getSnapshot().status).toBe('idle')

    hWithApi.remote.$dispatch('mcp-client/authentication-rejected', [{
      serverName: 'scholar',
      credentialRef: 'SCHOLAR_REMOTE_TOKEN',
    }])
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'required',
      error: 'rejected',
    })

    hWithApi.remote.$dispatch('credentials/updated', ['SCHOLAR_REMOTE_TOKEN'])
    await vi.waitFor(() => { expect(controller.store.getSnapshot().status).toBe('hidden') })
    await fiber.dispose()
  })
})
