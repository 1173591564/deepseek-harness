import { describe, expect, it, vi } from 'vitest'
import type { IApiClient, RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import {
  SCHOLAR_TOKEN_REF,
  ScholarOnboardingController,
} from '../src/client/controller.ts'

let nextRpc = 0

function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `scholar-${nextRpc++}` as never, result: { ok: true, value } }
}

function fail<T>(message: string): RpcResponse<T> {
  return {
    rpcId: `scholar-${nextRpc++}` as never,
    result: { ok: false, error: { code: 'internal', message, details: {} } },
  }
}

function harness(options: {
  academic?: boolean
  configured?: boolean
  writable?: boolean
  rosterFailure?: boolean
  describeReject?: boolean
  saveFailure?: boolean
  saveReject?: boolean
  response?: Response
  fetchReject?: boolean
} = {}) {
  const set = vi.fn((_payload: { ref: string; value: string }) => {
    if (options.saveReject === true) return Promise.reject(new Error('write failed'))
    if (options.saveFailure === true) return Promise.resolve(fail<Record<string, never>>('write failed'))
    return Promise.resolve(ok({}))
  })
  const api = {
    agentPresets: {
      list: vi.fn(() => Promise.resolve(options.rosterFailure === true
        ? fail<{ presets: never[] }>('roster failed')
        : ok({
          presets: options.academic === false
            ? [{ id: 'standard' }]
            : [{ id: 'standard' }, { id: 'academic' }],
        }))),
    },
    credentials: {
      describe: vi.fn(() => options.describeReject === true
        ? Promise.reject(new Error('transport unavailable'))
        : Promise.resolve(ok({
          credentials: {
            [SCHOLAR_TOKEN_REF]: {
              configured: options.configured ?? false,
              writable: options.writable ?? true,
            },
          },
        }))),
      set,
    },
  } as unknown as Pick<IApiClient, 'agentPresets' | 'credentials'>
  const fetchIdentity = vi.fn(() => options.fetchReject === true
    ? Promise.reject(new Error('network unavailable'))
    : Promise.resolve(options.response ?? Response.json({ name: 'Literature group' })))
  const controller = new ScholarOnboardingController(
    api,
    'https://scholar.example/v1/me',
    1_000,
    fetchIdentity,
  )
  return { controller, fetchIdentity, set }
}

describe('ScholarOnboardingController', () => {
  it('requires a writable missing credential only when the academic preset exists', async () => {
    const required = harness()
    await required.controller.load()
    expect(required.controller.store.getSnapshot().status).toBe('required')

    for (const hidden of [
      harness({ academic: false }),
      harness({ configured: true }),
      harness({ writable: false }),
      harness({ rosterFailure: true }),
      harness({ describeReject: true }),
    ]) {
      await hidden.controller.load()
      expect(hidden.controller.store.getSnapshot().status).toBe('hidden')
    }
  })

  it('validates with Bearer authentication before committing the Managed Credential', async () => {
    const h = harness()
    await expect(h.controller.validateAndSave('sk-test')).resolves.toBe(true)
    expect(h.fetchIdentity).toHaveBeenCalledWith(
      'https://scholar.example/v1/me',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          authorization: 'Bearer sk-test',
        },
      }),
    )
    expect(h.set).toHaveBeenCalledWith({
      ref: SCHOLAR_TOKEN_REF,
      value: 'sk-test',
    })
    expect(h.controller.store.getSnapshot()).toEqual({
      status: 'hidden',
      error: null,
      tokenName: 'Literature group',
    })
  })

  it.each([
    [401, 'invalid'],
    [403, 'invalid'],
    [500, 'unavailable'],
  ] as const)('does not persist an HTTP %s response', async (status, error) => {
    const h = harness({ response: new Response('', { status }) })
    await expect(h.controller.validateAndSave('sk-test')).resolves.toBe(false)
    expect(h.set).not.toHaveBeenCalled()
    expect(h.controller.store.getSnapshot().error).toBe(error)
  })

  it('preserves the credential on transport and malformed identity failures', async () => {
    const unavailable = harness({ fetchReject: true })
    await expect(unavailable.controller.validateAndSave('sk-test')).resolves.toBe(false)
    expect(unavailable.set).not.toHaveBeenCalled()
    expect(unavailable.controller.store.getSnapshot().error).toBe('unavailable')

    const malformed = harness({ response: Response.json({ token_name: 'legacy' }) })
    await expect(malformed.controller.validateAndSave('sk-test')).resolves.toBe(false)
    expect(malformed.set).not.toHaveBeenCalled()
    expect(malformed.controller.store.getSnapshot().error).toBe('malformed')
  })

  it('reports failed and rejected credential writes without hiding the step', async () => {
    for (const h of [harness({ saveFailure: true }), harness({ saveReject: true })]) {
      await expect(h.controller.validateAndSave('sk-test')).resolves.toBe(false)
      expect(h.controller.store.getSnapshot()).toMatchObject({
        status: 'error',
        error: 'saveFailed',
      })
    }
  })
})
