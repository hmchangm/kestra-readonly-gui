import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RetriggerModal } from './RetriggerModal'
import type { ExecutionRow } from '../types/execution'

vi.mock('../hooks/useRetrigger', () => ({
  useRetrigger: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
    isError: false,
    error: null,
  }),
}))

const exec: ExecutionRow = {
  id: 'exec-1', namespace: 'prod.etl', flowId: 'daily-report',
  state: 'FAILED', startDate: null, endDate: null,
}

const execWithInputs = {
  ...exec,
  id: 'exec-2',
  inputs: { date: '2026-05-01', count: 5, active: true },
}

function wrap(ui: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      {ui}
    </QueryClientProvider>
  )
}

describe('RetriggerModal', () => {
  it('shows flow and namespace', () => {
    wrap(<RetriggerModal execution={exec} onClose={vi.fn()} />)
    expect(screen.getByText('daily-report')).toBeInTheDocument()
    expect(screen.getByText('prod.etl')).toBeInTheDocument()
  })

  it('calls onClose when Cancel clicked', () => {
    const onClose = vi.fn()
    wrap(<RetriggerModal execution={exec} onClose={onClose} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })

  it('simple mode pre-fills input fields from execution inputs', () => {
    wrap(<RetriggerModal execution={execWithInputs} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('2026-05-01')).toBeInTheDocument()
    expect(screen.getByDisplayValue('5')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('advanced mode shows textarea containing JSON', () => {
    wrap(<RetriggerModal execution={execWithInputs} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Advanced'))
    const textarea = document.querySelector('textarea')
    expect(textarea).not.toBeNull()
    expect(textarea!.value).toContain('2026-05-01')
  })

  it('switching Simple to Advanced serialises current field values into textarea', () => {
    wrap(<RetriggerModal execution={execWithInputs} onClose={vi.fn()} />)
    const dateInput = screen.getByDisplayValue('2026-05-01')
    fireEvent.change(dateInput, { target: { value: '2026-05-02' } })
    fireEvent.click(screen.getByText('Advanced'))
    const textarea = document.querySelector('textarea')
    expect(textarea!.value).toContain('2026-05-02')
  })
})
