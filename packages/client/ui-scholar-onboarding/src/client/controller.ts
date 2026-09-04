/**
 * Scholar onboarding state and Proxy Hub validation.
 * @module @deepseek-ai/dsh-client-ui-scholar-onboarding/controller
 */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Managed Credential reference written by Scholar mode. */
export const SCHOLAR_TOKEN_REF = 'SCHOLAR_REMOTE_TOKEN'
const SCHOLAR_PRESET_ID = 'academic'

/** User-visible state of the Scholar onboarding step. */
export interface ScholarOnboardingState {
  status: 'idle' | 'loading' | 'hidden' | 'required' | 'validating' | 'error'
  error: 'invalid' | 'unavailable' | 'malformed' | 'saveFailed' | null
  tokenName: string | null
}

const INITIAL: ScholarOnboardingState = {
  status: 'idle',
  error: null,
  tokenName: null,
}

interface ProxyIdentity {
  name: string
}

function identityOf(value: unknown): ProxyIdentity | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const name = (value as Record<string, unknown>).name
  return typeof name === 'string' && name.length > 0 ? { name } : undefined
}

/** Controller for one Scholar onboarding slot registration. */
export class ScholarOnboardingController {
  /** Snapshot consumed by the onboarding component. */
  readonly store: SnapshotStore<ScholarOnboardingState> = createSnapshotStore(INITIAL)
  private readonly fetchIdentity: typeof fetch

  constructor(
    private readonly api: Pick<IApiClient, 'agentPresets' | 'credentials'>,
    private readonly identityUrl: string,
    private readonly validationTimeoutMs: number,
    fetchIdentity: typeof fetch = fetch,
  ) {
    this.fetchIdentity = (input, init) => fetchIdentity(input, init)
  }

  private set(patch: Partial<ScholarOnboardingState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  /**
   * Show the step only when the academic preset exists and its credential is absent.
   * @returns once roster and credential state are reflected in the snapshot.
   */
  async load(): Promise<void> {
    if (this.store.getSnapshot().status === 'loading') return
    this.set({ status: 'loading', error: null })
    try {
      const roster = await this.api.agentPresets.list({})
      if (
        !roster.result.ok
        || !roster.result.value.presets.some(preset => preset.id === SCHOLAR_PRESET_ID)
      ) {
        this.set({ status: 'hidden' })
        return
      }
      const described = await this.api.credentials.describe({ refs: [SCHOLAR_TOKEN_REF] })
      const credential = described.result.ok
        ? described.result.value.credentials[SCHOLAR_TOKEN_REF]
        : undefined
      if (
        credential === undefined
        || credential.configured
        || !credential.writable
      ) {
        this.set({ status: 'hidden' })
        return
      }
      this.set({ status: 'required' })
    } catch {
      this.set({ status: 'hidden' })
    }
  }

  /**
   * Validate a Token with `/v1/me`, then persist it through the credential wire.
   * @param token - raw Token entered by the user.
   * @returns true after the Managed Credential commits.
   */
  async validateAndSave(token: string): Promise<boolean> {
    this.set({ status: 'validating', error: null })
    let response: Response
    try {
      response = await this.fetchIdentity(this.identityUrl, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(this.validationTimeoutMs),
        redirect: 'error',
      })
    } catch {
      this.set({ status: 'error', error: 'unavailable' })
      return false
    }
    if (response.status === 401 || response.status === 403) {
      this.set({ status: 'error', error: 'invalid' })
      return false
    }
    if (!response.ok) {
      this.set({ status: 'error', error: 'unavailable' })
      return false
    }
    let identity: ProxyIdentity | undefined
    try {
      identity = identityOf(await response.json())
    } catch {
      identity = undefined
    }
    if (identity === undefined) {
      this.set({ status: 'error', error: 'malformed' })
      return false
    }
    try {
      const saved = await this.api.credentials.set({ ref: SCHOLAR_TOKEN_REF, value: token })
      if (!saved.result.ok) {
        this.set({ status: 'error', error: 'saveFailed' })
        return false
      }
    } catch {
      this.set({ status: 'error', error: 'saveFailed' })
      return false
    }
    this.set({ status: 'hidden', tokenName: identity.name })
    return true
  }
}
