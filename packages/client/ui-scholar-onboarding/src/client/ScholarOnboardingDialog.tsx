/** Scholar mode first-use Token dialog. */

import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ScholarOnboardingController, ScholarOnboardingState } from './controller.ts'
import type { ScholarOnboardingKey } from './locales.ts'
import styles from './ScholarOnboardingDialog.module.css'

/** Registration-side dependencies of {@link ScholarOnboardingDialog}. */
export interface ScholarOnboardingInjected {
  hooks: {
    /** Controller snapshot bound by the slot renderer. */
    scholarOnboarding: SnapshotStore<ScholarOnboardingState>
  }
  /** Scholar validation and credential persistence. */
  controller: ScholarOnboardingController
  /** Whether the configured Proxy Hub transport exposes the Token over HTTP. */
  insecureTransport: boolean
  /** Feature copy. */
  t: (key: ScholarOnboardingKey) => string
}

/** Slot owner props plus Scholar dependencies. */
export type ScholarOnboardingDialogProps =
  PropsRuntime<'settings.onboarding'> & InjectFace<ScholarOnboardingInjected>

const ignoreImplicitDismiss = (): void => {}

/**
 * Prompt for the fixed Proxy Hub's Scholar Token when Scholar mode has no credential.
 * @param props - settings owner callbacks and Scholar onboarding dependencies.
 * @returns a blocking modal while the credential is required.
 */
export function ScholarOnboardingDialog(props: ScholarOnboardingDialogProps): ReactNode {
  const { complete, controller, insecureTransport, useScholarOnboarding, t } = props
  const state = useScholarOnboarding(snapshot => snapshot)
  const [token, setToken] = useState('')
  const input = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  useEffect(() => {
    if (state.status === 'hidden') complete()
  }, [complete, state.status])

  useEffect(() => {
    if (state.status === 'required' || state.status === 'error') input.current?.focus()
  }, [state.status])

  if (
    state.status === 'idle'
    || state.status === 'loading'
    || state.status === 'hidden'
  ) return null

  const busy = state.status === 'validating'
  const trimmed = token.trim()
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (trimmed.length === 0 || busy) return
    void controller.validateAndSave(trimmed)
  }

  return (
    <Modal
      open
      title={t('title')}
      onClose={ignoreImplicitDismiss}
      headless
      className={styles.dialog as string}
    >
      <form className={styles.content} onSubmit={submit}>
        <h2 className={styles.title}>{t('title')}</h2>
        <p className={styles.description}>{t('description')}</p>
        {insecureTransport ? <p className={styles.warning}>{t('insecure')}</p> : null}
        <label className={styles.label}>
          <span>{t('tokenLabel')}</span>
          <input
            ref={input}
            className={styles.input}
            type="password"
            autoComplete="off"
            value={token}
            placeholder={t('tokenPlaceholder')}
            disabled={busy}
            onChange={(event) => { setToken(event.target.value) }}
          />
        </label>
        {token.length > 0 && trimmed.length === 0 && (
          <p className={styles.error} role="alert">{t('required')}</p>
        )}
        {state.error !== null && (
          <p className={styles.error} role="alert">{t(state.error)}</p>
        )}
        <div className={styles.actions}>
          <Button type="button" variant="outline" disabled={busy} onClick={complete}>
            {t('later')}
          </Button>
          <Button type="submit" variant="primary" disabled={trimmed.length === 0 || busy}>
            {busy ? t('saving') : t('save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
