// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { ScholarOnboardingDialog } from '../src/client/ScholarOnboardingDialog.tsx'
import type { ScholarOnboardingDialogProps } from '../src/client/ScholarOnboardingDialog.tsx'
import { ScholarOnboardingController } from '../src/client/controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function harness(insecureTransport = true) {
  const controller = new ScholarOnboardingController(
    {} as never,
    'https://scholar.example/v1/me',
    1_000,
  )
  controller.store.set({ status: 'required', error: null, tokenName: null })
  const complete = vi.fn()
  const validateAndSave = vi.spyOn(controller, 'validateAndSave').mockResolvedValue(false)
  const unusedHook = (() => { throw new Error('unused standard hook') }) as never
  const props: ScholarOnboardingDialogProps = {
    stepId: 'scholar-token',
    complete,
    openSection: vi.fn(),
    useSessions: unusedHook,
    useWorkspaces: unusedHook,
    controller,
    insecureTransport,
    useScholarOnboarding: bindSnapshotSelector(controller.store),
    t: key => en[key],
  }
  return { complete, controller, props, validateAndSave }
}

describe('ScholarOnboardingDialog', () => {
  it('shows only the Token field and development HTTP warning', async () => {
    const h = harness()
    render(<ScholarOnboardingDialog {...h.props} />)
    expect(screen.getByRole('dialog', { name: en.title })).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>(en.tokenLabel).type).toBe('password')
    expect(screen.getByText(en.insecure)).toBeTruthy()
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(en.tokenLabel))
    })
  })

  it('omits the HTTP warning for HTTPS composition', () => {
    const h = harness(false)
    render(<ScholarOnboardingDialog {...h.props} />)
    expect(screen.queryByText(en.insecure)).toBeNull()
  })

  it('trims the Token, blocks blank submission, and completes only after hidden state', async () => {
    const h = harness()
    render(<ScholarOnboardingDialog {...h.props} />)
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: en.save })
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(en.tokenLabel), { target: { value: '   ' } })
    expect(screen.getByText(en.required)).toBeTruthy()
    expect(h.validateAndSave).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(en.tokenLabel), { target: { value: '  sk-test  ' } })
    fireEvent.click(submit)
    expect(h.validateAndSave).toHaveBeenCalledWith('sk-test')
    expect(h.complete).not.toHaveBeenCalled()
    h.controller.store.set({ status: 'hidden', error: null, tokenName: 'Lab' })
    await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
  })

  it('allows deferral and renders validation errors', () => {
    const h = harness()
    const view = render(<ScholarOnboardingDialog {...h.props} />)
    fireEvent.click(screen.getByRole('button', { name: en.later }))
    expect(h.complete).toHaveBeenCalledOnce()
    view.rerender(<ScholarOnboardingDialog {...h.props} />)
    act(() => {
      h.controller.store.set({ status: 'error', error: 'invalid', tokenName: null })
    })
    expect(screen.getByRole('alert').textContent).toBe(en.invalid)
  })

  it('renders the rejected credential guidance', () => {
    const h = harness()
    h.controller.markRejected()
    render(<ScholarOnboardingDialog {...h.props} />)
    expect(screen.getByRole('alert').textContent).toBe(en.rejected)
  })
})
