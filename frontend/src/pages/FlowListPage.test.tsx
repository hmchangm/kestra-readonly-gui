import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { FlowListPage } from './FlowListPage'

vi.mock('../hooks/useFlows', () => ({
  useFlows: () => ({
    data: [{ namespace: 'prod', flowId: 'daily', lastRunDate: '2026-05-06T10:00:00Z', executionCount: 2 }],
    isLoading: false,
    error: null,
  }),
}))

describe('FlowListPage', () => {
  it('renders flow rows as links to flow detail', () => {
    render(<MemoryRouter><FlowListPage /></MemoryRouter>)

    expect(screen.getByText('prod')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'daily' })
    expect(link).toHaveAttribute('href', '/flows/prod/daily')
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
