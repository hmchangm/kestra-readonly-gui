import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TriggerModal } from './TriggerModal'
import type { FlowInput } from '../types/execution'

const mutateAsync = vi.fn().mockResolvedValue({})

vi.mock('../hooks/useTrigger', () => ({
  useTrigger: () => ({
    mutateAsync,
    isPending: false,
    isError: false,
    error: null,
  }),
}))

const inputs: FlowInput[] = [
  { id: 'date', type: 'STRING' },
  { id: 'count', type: 'INT' },
  { id: 'flag', type: 'BOOLEAN' },
]

describe('TriggerModal', () => {
  it('renders input controls based on flow input types', () => {
    render(<TriggerModal namespace="prod" flowId="daily" inputs={inputs} onClose={vi.fn()} />)

    expect(screen.getByLabelText('date')).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText('count')).toHaveAttribute('type', 'number')
    expect(screen.getByLabelText('flag')).toHaveAttribute('type', 'checkbox')
  })

  it('submits entered values and closes on success', async () => {
    const onClose = vi.fn()
    render(<TriggerModal namespace="prod" flowId="daily" inputs={inputs} onClose={onClose} />)

    fireEvent.change(screen.getByLabelText('date'), { target: { value: '2026-05-06' } })
    fireEvent.change(screen.getByLabelText('count'), { target: { value: '3' } })
    fireEvent.click(screen.getByLabelText('flag'))
    fireEvent.click(screen.getByText('Trigger'))

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ date: '2026-05-06', count: 3, flag: true })
      expect(onClose).toHaveBeenCalled()
    })
  })
})
