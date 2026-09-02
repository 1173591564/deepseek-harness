import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-scholar-native'

/** Cordis companion plugin name. */
export const name = 'scholar-native-invariant'
/** Service required to reserve package invariant ownership. */
export const inject = ['invariants']

/** No runtime invariant: Scholar snapshots use the standard plugin message source validated by Session. */
const install: InvariantInstaller = () => {}

/**
 * Register the Scholar native invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
