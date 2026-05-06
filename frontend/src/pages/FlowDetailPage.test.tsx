import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { FlowDetailPage } from './FlowDetailPage'

vi.mock('../hooks/useFlow', () => ({
  useFlow: () => ({
    data: { namespace: 'prod', flowId: 'daily' },
    isLoading: false,
    error: null,
  }),
}))

vi.mock('../hooks/useExecutions', () => ({
  useExecutions: () => ({
    data: {
      results: [{ id: 'exec-1', namespace: 'prod', flowId: 'daily', state: 'SUCCESS', startDate: '2026-05-06T10:00:00Z', endDate: '2026-05-06T10:01:00Z' }],
    },
    isLoading: false,
  }),
}))

vi.mock('../hooks/useFlowInputs', () => ({
  useFlowInputs: () => ({
    data: [{ id: 'date', type: 'STRING' }],
    isLoading: false,
  }),
}))

vi.mock('../components/TriggerModal', () => ({
  TriggerModal: () => <div>Trigger modal open</div>,
}))

describe('FlowDetailPage', () => {
  it('shows flow identity and recent executions', () => {
    render(
      <MemoryRouter initialEntries={['/flows/prod/daily']}>
        <Routes><Route path="/flows/:namespace/:flowId" element={<FlowDetailPage />} /></Routes>
      </MemoryRouter>
    )

    expect(screen.getByText('prod')).toBeInTheDocument()
    expect(screen.getByText('daily')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'exec-1' })).toHaveAttribute('href', '/executions/exec-1')
  })

  it('opens trigger modal from trigger button', () => {
    render(
      <MemoryRouter initialEntries={['/flows/prod/daily']}>
        <Routes><Route path="/flows/:namespace/:flowId" element={<FlowDetailPage />} /></Routes>
      </MemoryRouter>
    )

    fireEvent.click(screen.getByText('Trigger'))
    expect(screen.getByText('Trigger modal open')).toBeInTheDocument()
  })
})
