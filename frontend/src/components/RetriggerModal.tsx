import { useState } from 'react'
import type { ExecutionRow } from '../types/execution'
import { useRetrigger } from '../hooks/useRetrigger'

type InputMode = 'simple' | 'advanced'
type FieldType = 'date' | 'datetime' | 'boolean' | 'number' | 'text'

function inferType(value: unknown): FieldType {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return 'datetime'
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date'
  }
  return 'text'
}

function toFieldValue(value: unknown, type: FieldType): string | number | boolean {
  if (type === 'boolean') return typeof value === 'boolean' ? value : false
  if (type === 'number') return typeof value === 'number' ? value : Number(value)
  if (type === 'datetime') return typeof value === 'string' ? value.slice(0, 16) : ''
  return value != null ? String(value) : ''
}

function toOverrideValue(raw: string | number | boolean, type: FieldType): unknown {
  if (type === 'boolean') return raw
  if (type === 'number') return raw === '' ? null : Number(raw)
  if (type === 'datetime') {
    const s = raw as string
    return s ? (s.endsWith('Z') ? s : s + ':00Z') : null
  }
  return raw
}

interface RetriggerModalProps {
  execution: ExecutionRow & { inputs?: Record<string, unknown> }
  onClose: () => void
}

export function RetriggerModal({ execution, onClose }: RetriggerModalProps) {
  const inputs = execution.inputs ?? {}
  const retrigger = useRetrigger()

  const [mode, setMode] = useState<InputMode>('simple')
  const [fields, setFields] = useState<Record<string, string | number | boolean>>(() =>
    Object.fromEntries(
      Object.entries(inputs).map(([k, v]) => [k, toFieldValue(v, inferType(v))])
    )
  )
  const [advancedJson, setAdvancedJson] = useState(() => JSON.stringify(inputs, null, 2))
  const [jsonError, setJsonError] = useState<string | null>(null)

  function switchMode(next: InputMode) {
    if (next === 'advanced') {
      const expanded = Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k, toOverrideValue(v, inferType(inputs[k]))])
      )
      setAdvancedJson(JSON.stringify(expanded, null, 2))
      setMode('advanced')
    } else {
      try {
        const parsed = JSON.parse(advancedJson) as Record<string, unknown>
        setFields(
          Object.fromEntries(
            Object.entries(parsed).map(([k, v]) => [k, toFieldValue(v, inferType(v))])
          )
        )
        setJsonError(null)
        setMode('simple')
      } catch {
        setJsonError('Invalid JSON — fix before switching to Simple mode')
      }
    }
  }

  function buildOverrides(): Record<string, unknown> | null {
    if (mode === 'advanced') {
      try {
        return JSON.parse(advancedJson) as Record<string, unknown>
      } catch {
        setJsonError('Invalid JSON')
        return null
      }
    }
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(fields)) {
      const type = inferType(inputs[k])
      const overrideVal = toOverrideValue(v, type)
      if (String(overrideVal) !== String(inputs[k] ?? '')) {
        result[k] = overrideVal
      }
    }
    return result
  }

  const handleConfirm = async () => {
    const overrides = buildOverrides()
    if (overrides === null) return
    try {
      await retrigger.mutateAsync({ id: execution.id, overrides })
      onClose()
    } catch {
      // error surfaced via retrigger.isError
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-lg w-full shadow-xl">
        <h2 className="text-lg font-semibold mb-4">Retrigger Execution</h2>

        <div className="space-y-1 text-sm mb-4">
          <div><span className="font-medium text-gray-600">Flow:</span> {execution.flowId}</div>
          <div><span className="font-medium text-gray-600">Namespace:</span> {execution.namespace}</div>
          <div><span className="font-medium text-gray-600">Original ID:</span> <span className="font-mono text-xs">{execution.id}</span></div>
        </div>

        {Object.keys(inputs).length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-gray-500">Inputs</span>
              <div className="flex rounded border text-xs overflow-hidden">
                <button
                  onClick={() => switchMode('simple')}
                  className={`px-2 py-0.5 ${mode === 'simple' ? 'bg-blue-600 text-white' : 'hover:bg-gray-50'}`}
                >
                  Simple
                </button>
                <button
                  onClick={() => switchMode('advanced')}
                  className={`px-2 py-0.5 ${mode === 'advanced' ? 'bg-blue-600 text-white' : 'hover:bg-gray-50'}`}
                >
                  Advanced
                </button>
              </div>
            </div>

            {mode === 'simple' && (
              <div className="space-y-2">
                {Object.entries(inputs).map(([key, originalVal]) => {
                  const type = inferType(originalVal)
                  const value = fields[key]
                  return (
                    <div key={key} className="flex items-center gap-2 text-sm">
                      <label className="w-32 text-gray-600 font-medium shrink-0">{key}</label>
                      {type === 'boolean' ? (
                        <input
                          type="checkbox"
                          checked={value as boolean}
                          onChange={e => setFields(f => ({ ...f, [key]: e.target.checked }))}
                          className="h-4 w-4"
                        />
                      ) : (
                        <input
                          type={type === 'datetime' ? 'datetime-local' : type === 'date' ? 'date' : type === 'number' ? 'number' : 'text'}
                          value={value as string | number}
                          onChange={e => setFields(f => ({
                            ...f,
                            [key]: type === 'number'
                              ? e.target.value === '' ? toFieldValue(inputs[key], 'number') : Number(e.target.value)
                              : e.target.value,
                          }))}
                          className="flex-1 border rounded px-2 py-1 text-sm"
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {mode === 'advanced' && (
              <textarea
                value={advancedJson}
                onChange={e => { setAdvancedJson(e.target.value); setJsonError(null) }}
                className="w-full border rounded px-2 py-1 text-xs font-mono h-36"
                spellCheck={false}
              />
            )}

            {jsonError && <p className="text-red-600 text-xs mt-1">{jsonError}</p>}
          </div>
        )}

        <p className="text-sm text-gray-500 mb-4">
          This creates a new execution with the above inputs. The action is logged.
        </p>

        {retrigger.isError && (
          <p className="text-red-600 text-sm mb-3">{retrigger.error?.message ?? 'Retrigger failed'}</p>
        )}

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={retrigger.isPending || !!jsonError}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {retrigger.isPending ? 'Retriggering…' : 'Confirm Retrigger'}
          </button>
        </div>
      </div>
    </div>
  )
}
