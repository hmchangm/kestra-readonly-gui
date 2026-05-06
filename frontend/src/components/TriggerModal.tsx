import { useState } from 'react'
import type { FlowInput } from '../types/execution'
import { useTrigger } from '../hooks/useTrigger'

function inputType(type: string): 'text' | 'number' | 'checkbox' {
  if (type === 'INT' || type === 'FLOAT') return 'number'
  if (type === 'BOOLEAN') return 'checkbox'
  return 'text'
}

function toSubmitValue(value: string | boolean, type: string): unknown {
  if (type === 'BOOLEAN') return value === true
  if (type === 'INT' || type === 'FLOAT') return value === '' ? null : Number(value)
  return value
}

interface TriggerModalProps {
  namespace: string
  flowId: string
  inputs: FlowInput[]
  onClose: () => void
}

export function TriggerModal({ namespace, flowId, inputs, onClose }: TriggerModalProps) {
  const trigger = useTrigger(namespace, flowId)
  const [fields, setFields] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(inputs.map(input => [input.id, input.type === 'BOOLEAN' ? false : '']))
  )

  async function handleSubmit() {
    const payload = Object.fromEntries(
      inputs.map(input => [input.id, toSubmitValue(fields[input.id], input.type)])
    )
    try {
      await trigger.mutateAsync(payload)
      onClose()
    } catch {
      // Mutation state renders the error below.
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-lg w-full shadow-xl">
        <h2 className="text-lg font-semibold mb-4">Trigger Flow</h2>
        <div className="space-y-1 text-sm mb-4">
          <div><span className="font-medium text-gray-600">Flow:</span> {flowId}</div>
          <div><span className="font-medium text-gray-600">Namespace:</span> {namespace}</div>
        </div>

        <div className="space-y-2 mb-4">
          {inputs.length === 0 && <p className="text-sm text-gray-500">This flow has no inputs.</p>}
          {inputs.map(input => {
            const type = inputType(input.type)
            return (
              <div key={input.id} className="flex items-center gap-2 text-sm">
                <label htmlFor={`flow-input-${input.id}`} className="w-32 text-gray-600 font-medium shrink-0">{input.id}</label>
                {type === 'checkbox' ? (
                  <input
                    id={`flow-input-${input.id}`}
                    aria-label={input.id}
                    type="checkbox"
                    checked={fields[input.id] as boolean}
                    onChange={e => setFields(prev => ({ ...prev, [input.id]: e.target.checked }))}
                    className="h-4 w-4"
                  />
                ) : (
                  <input
                    id={`flow-input-${input.id}`}
                    aria-label={input.id}
                    type={type}
                    value={fields[input.id] as string}
                    onChange={e => setFields(prev => ({ ...prev, [input.id]: e.target.value }))}
                    className="flex-1 border rounded px-2 py-1 text-sm"
                  />
                )}
              </div>
            )
          })}
        </div>

        {trigger.isError && (
          <p className="text-red-600 text-sm mb-3">{trigger.error?.message ?? 'Trigger failed'}</p>
        )}

        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={trigger.isPending}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {trigger.isPending ? 'Triggering...' : 'Trigger'}
          </button>
        </div>
      </div>
    </div>
  )
}
