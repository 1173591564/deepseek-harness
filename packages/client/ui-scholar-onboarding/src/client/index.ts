/**
 * Scholar mode Token onboarding plugin, browser half.
 * @module @deepseek-ai/dsh-client-ui-scholar-onboarding/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { ScholarOnboardingController, SCHOLAR_TOKEN_REF } from './controller.ts'
import { ScholarOnboardingDialog } from './ScholarOnboardingDialog.tsx'
import type { ScholarOnboardingInjected } from './ScholarOnboardingDialog.tsx'
import { en, zh, type ScholarOnboardingKey } from './locales.ts'

export type { ScholarOnboardingKey } from './locales.ts'
export type {
  ScholarOnboardingInjected,
  ScholarOnboardingDialogProps,
} from './ScholarOnboardingDialog.tsx'

/** Browser Scholar onboarding deployment configuration. */
export interface Config {
  /** Fixed Proxy Hub MCP endpoint hidden from ordinary users. */
  gatewayUrl: string
  /** Explicit development allowance for a non-loopback HTTP endpoint. */
  allowInsecureHttp: boolean
  /** Timeout for the Proxy Hub identity validation request. */
  validationTimeoutMs: number
}

/** Validate the fixed Proxy Hub endpoint and development HTTP opt-in. */
export const Config: Schema<Config> = Schema.object({
  gatewayUrl: Schema.string().role('url').required(),
  allowInsecureHttp: Schema.boolean().default(false),
  validationTimeoutMs: Schema.number().min(1).default(20_000),
})

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Scholar mode Token onboarding copy. */
    'settings.scholar-onboarding': ScholarOnboardingKey
  }
}

const NS = 'settings.scholar-onboarding'

/** Services required by Scholar onboarding. */
export const inject = ['slots', 'locale', 'connection', 'remote']

/**
 * Register the Scholar onboarding step and refresh credential state after writes.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext, config: Config): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-scholar-onboarding: copy dictionaries')
  const connection = ctx.get('connection') as ConnectionHandle
  const gatewayUrl = new URL(config.gatewayUrl)
  if (
    gatewayUrl.protocol !== 'https:'
    && !(gatewayUrl.protocol === 'http:' && config.allowInsecureHttp)
  ) {
    throw new Error(
      'ui-scholar-onboarding: gatewayUrl requires HTTPS unless allowInsecureHttp is true',
    )
  }
  const controller = new ScholarOnboardingController(
    connection.api,
    new URL('/v1/me', gatewayUrl).href,
    config.validationTimeoutMs,
  )
  const t = ctx.locale.bind(NS) as ScholarOnboardingInjected['t']
  const injected = (): ScholarOnboardingInjected => ({
    controller,
    hooks: { scholarOnboarding: controller.store },
    insecureTransport: gatewayUrl.protocol === 'http:',
    t,
  })

  ctx.effect(() => {
    const disposers = [
      ctx.remote.$on('credentials/updated', (ref) => {
        if (ref === SCHOLAR_TOKEN_REF) void controller.load()
      }),
      ctx.on('connection/reset', () => { void controller.load() }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-scholar-onboarding: invalidations')

  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'scholar-token',
    order: 10,
    inject: injected,
  }, ScholarOnboardingDialog))
}
