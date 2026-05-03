import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { NamespaceCombobox } from './NamespaceCombobox'

vi.mock('../hooks/useNamespaces', () => ({
  useNamespaces: () => ({ data: ['company.finance', 'company.ops', 'company.team'] }),
}))

describe('NamespaceCombobox', () => {
  it('renders the text input', () => {
    render(<NamespaceCombobox value="" onChange={vi.fn()} />)
    expect(screen.getByPlaceholderText('Filter by namespace…')).toBeInTheDocument()
  })

  it('shows all suggestions on focus when value is empty', () => {
    render(<NamespaceCombobox value="" onChange={vi.fn()} />)
    fireEvent.focus(screen.getByPlaceholderText('Filter by namespace…'))
    expect(screen.getByText('company.finance')).toBeInTheDocument()
    expect(screen.getByText('company.ops')).toBeInTheDocument()
    expect(screen.getByText('company.team')).toBeInTheDocument()
  })

  it('filters suggestions by substring match (case-insensitive)', () => {
    render(<NamespaceCombobox value="OPS" onChange={vi.fn()} />)
    fireEvent.focus(screen.getByPlaceholderText('Filter by namespace…'))
    expect(screen.getByText('company.ops')).toBeInTheDocument()
    expect(screen.queryByText('company.finance')).not.toBeInTheDocument()
    expect(screen.queryByText('company.team')).not.toBeInTheDocument()
  })

  it('calls onChange on every keystroke', () => {
    const onChange = vi.fn()
    render(<NamespaceCombobox value="" onChange={onChange} />)
    fireEvent.change(screen.getByPlaceholderText('Filter by namespace…'), {
      target: { value: 'comp' },
    })
    expect(onChange).toHaveBeenCalledWith('comp')
  })

  it('selects suggestion on mousedown and closes dropdown', () => {
    const onChange = vi.fn()
    render(<NamespaceCombobox value="comp" onChange={onChange} />)
    fireEvent.focus(screen.getByPlaceholderText('Filter by namespace…'))
    fireEvent.mouseDown(screen.getByText('company.ops'))
    expect(onChange).toHaveBeenCalledWith('company.ops')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes dropdown on Escape, keeps current text', () => {
    render(<NamespaceCombobox value="comp" onChange={vi.fn()} />)
    const input = screen.getByPlaceholderText('Filter by namespace…')
    fireEvent.focus(input)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('moves highlight down with ArrowDown', () => {
    render(<NamespaceCombobox value="company" onChange={vi.fn()} />)
    const input = screen.getByPlaceholderText('Filter by namespace…')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[1]).toHaveAttribute('aria-selected', 'false')
  })

  it('selects highlighted suggestion on Enter', () => {
    const onChange = vi.fn()
    render(<NamespaceCombobox value="company" onChange={onChange} />)
    const input = screen.getByPlaceholderText('Filter by namespace…')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('company.finance')
  })
})
