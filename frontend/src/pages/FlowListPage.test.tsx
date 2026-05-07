import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { FlowListPage } from './FlowListPage'

vi.mock('../hooks/useFlows', () => ({
  useFlows: () => ({
    data: [
      { namespace: 'prod', flowId: 'daily', lastRunDate: '2026-05-06T10:00:00Z', executionCount: 2 },
      { namespace: 'dev', flowId: 'hourly', lastRunDate: null, executionCount: 0 },
    ],
    isLoading: false,
    error: null,
  }),
}))

vi.mock('../components/NamespaceCombobox', () => ({
  NamespaceCombobox: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input
      aria-label="Namespace filter"
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  ),
}))

describe('FlowListPage', () => {
  it('renders flow rows as links to flow detail', () => {
    render(<MemoryRouter><FlowListPage /></MemoryRouter>)

    expect(screen.getByText('prod')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'daily' })
    expect(link).toHaveAttribute('href', '/flows/prod/daily')
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('filters flow rows by namespace text', () => {
    render(<MemoryRouter><FlowListPage /></MemoryRouter>)

    fireEvent.change(screen.getByLabelText('Namespace filter'), { target: { value: 'prod' } })

    expect(screen.getByRole('link', { name: 'daily' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'hourly' })).not.toBeInTheDocument()
  })

  it('shows an empty state when no flows match the namespace filter', () => {
    render(<MemoryRouter><FlowListPage /></MemoryRouter>)

    fireEvent.change(screen.getByLabelText('Namespace filter'), { target: { value: 'qa' } })

    expect(screen.getByText('No flows match this namespace.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'daily' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'hourly' })).not.toBeInTheDocument()
  })
})
