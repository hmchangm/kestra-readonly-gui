import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ExecutionDetailPage } from './ExecutionDetailPage'
import { useExecution } from '../hooks/useExecution'

vi.mock('../hooks/useExecution')
vi.mock('../hooks/useTaskLogs', () => ({
  useTaskLogs: () => ({
    data: [{ timestamp: '2026-05-06T10:00:00Z', level: 'ERROR', message: 'Connection refused' }],
    isLoading: false,
  }),
}))
vi.mock('../components/RetriggerModal', () => ({ RetriggerModal: () => null }))
vi.mock('../components/CancelModal', () => ({
  CancelModal: () => null,
  CANCELLABLE_STATES: new Set(['CREATED', 'RUNNING', 'PAUSED', 'RESTARTED']),
}))

function wrap(ui: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/executions/exec-1']}>
        <Routes>
          <Route path="/executions/:id" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const baseExecution = {
  id: 'exec-1',
  namespace: 'prod',
  flowId: 'my-flow',
  startDate: null,
  endDate: null,
  inputs: {},
  taskRuns: [
    { id: 'tr-1', taskId: 'fetch-data', state: 'SUCCESS', startDate: null, endDate: null },
    { id: 'tr-2', taskId: 'send-report', state: 'FAILED', startDate: null, endDate: null },
  ],
}

describe('ExecutionDetailPage log view', () => {
  beforeEach(() => {
    vi.mocked(useExecution).mockReturnValue({
      data: { ...baseExecution, state: 'FAILED' },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useExecution>)
  })

  it('renders a logs toggle button for each task run', () => {
    wrap(<ExecutionDetailPage />)
    const toggles = screen.getAllByText('▶ logs')
    expect(toggles).toHaveLength(2)
  })

  it('clicking a toggle expands the inline log panel', () => {
    wrap(<ExecutionDetailPage />)
    fireEvent.click(screen.getAllByText('▶ logs')[0])
    expect(screen.getByText('Connection refused')).toBeInTheDocument()
  })

  it('renders log timestamps with readable contrast on the dark panel', () => {
    wrap(<ExecutionDetailPage />)
    fireEvent.click(screen.getAllByText('▶ logs')[0])

    expect(screen.getByText('2026-05-06T10:00:00Z')).toHaveClass('text-gray-400')
  })

  it('clicking the same toggle again collapses the panel', () => {
    wrap(<ExecutionDetailPage />)
    fireEvent.click(screen.getAllByText('▶ logs')[0])
    expect(screen.getByText('Connection refused')).toBeInTheDocument()
    fireEvent.click(screen.getByText('▼ logs'))
    expect(screen.queryByText('Connection refused')).not.toBeInTheDocument()
  })

  it('only one log panel is open at a time', () => {
    wrap(<ExecutionDetailPage />)
    fireEvent.click(screen.getAllByText('▶ logs')[0])
    expect(screen.getAllByTestId('log-panel')).toHaveLength(1)
    fireEvent.click(screen.getByText('▶ logs'))  // second row still shows ▶ logs
    expect(screen.getAllByTestId('log-panel')).toHaveLength(1)
  })
})

describe('ExecutionDetailPage cancel button', () => {
  it('shows Cancel button for RUNNING execution', () => {
    vi.mocked(useExecution).mockReturnValue({
      data: { ...baseExecution, state: 'RUNNING' },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useExecution>)
    wrap(<ExecutionDetailPage />)
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('hides Cancel button for FAILED execution', () => {
    vi.mocked(useExecution).mockReturnValue({
      data: { ...baseExecution, state: 'FAILED' },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useExecution>)
    wrap(<ExecutionDetailPage />)
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
  })

  it('hides Cancel button for SUCCESS execution', () => {
    vi.mocked(useExecution).mockReturnValue({
      data: { ...baseExecution, state: 'SUCCESS' },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useExecution>)
    wrap(<ExecutionDetailPage />)
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
  })
})
