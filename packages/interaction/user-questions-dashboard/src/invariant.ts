import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-user-questions-dashboard'

/** Cordis companion plugin name. */
export const name = 'user-questions-dashboard-invariant'
/** Service required to reserve package invariant ownership. */
export const inject = ['invariants']

/** No runtime invariant: question ownership and answer validation remain private to each pending request. */
const install: InvariantInstaller = () => {}

/**
 * Register the dashboard provider invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
