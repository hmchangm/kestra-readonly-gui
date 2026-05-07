import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CancelModal } from './CancelModal'
import type { ExecutionRow } from '../types/execution'

vi.mock('../hooks/useCancel', () => ({
  useCancel: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
    isError: false,
    error: null,
  }),
}))

const exec: ExecutionRow = {
  id: 'exec-1', namespace: 'prod.etl', flowId: 'daily-report',
  state: 'RUNNING', startDate: null, endDate: null,
}

function wrap(ui: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
  )
}

describe('CancelModal', () => {
  it('shows flow, namespace and execution id', () => {
    wrap(<CancelModal execution={exec} onClose={vi.fn()} />)
    expect(screen.getByText('daily-report')).toBeInTheDocument()
    expect(screen.getByText('prod.etl')).toBeInTheDocument()
    expect(screen.getByText('exec-1')).toBeInTheDocument()
  })

  it('calls onClose when Back is clicked', () => {
    const onClose = vi.fn()
    wrap(<CancelModal execution={exec} onClose={onClose} />)
    fireEvent.click(screen.getByText('Back'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows kill signal warning', () => {
    wrap(<CancelModal execution={exec} onClose={vi.fn()} />)
    expect(screen.getByText(/kill signal/i)).toBeInTheDocument()
  })

  it('Confirm Cancel button is present and not disabled', () => {
    wrap(<CancelModal execution={exec} onClose={vi.fn()} />)
    const btn = screen.getByText('Confirm Cancel')
    expect(btn).toBeInTheDocument()
    expect(btn).not.toBeDisabled()
  })
})
