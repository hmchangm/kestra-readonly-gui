import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { StatusBadge } from './StatusBadge'

describe('StatusBadge', () => {
  it('renders FAILED state', () => {
    render(<StatusBadge state="FAILED" />)
    expect(screen.getByText('FAILED')).toBeInTheDocument()
  })

  it('renders SUCCESS state', () => {
    render(<StatusBadge state="SUCCESS" />)
    expect(screen.getByText('SUCCESS')).toBeInTheDocument()
  })
})
