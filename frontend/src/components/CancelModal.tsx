import type { ExecutionRow } from '../types/execution'
import { useCancel } from '../hooks/useCancel'

export const CANCELLABLE_STATES = new Set(['CREATED', 'RUNNING', 'PAUSED', 'RESTARTED'])

interface CancelModalProps {
  execution: ExecutionRow
  onClose: () => void
}

export function CancelModal({ execution, onClose }: CancelModalProps) {
  const cancel = useCancel()

  const handleConfirm = async () => {
    try {
      await cancel.mutateAsync(execution.id)
      onClose()
    } catch {
      // error surfaced via cancel.isError
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
        <h2 className="text-lg font-semibold mb-4">Cancel Execution</h2>

        <div className="space-y-1 text-sm mb-4">
          <div><span className="font-medium text-gray-600">Flow:</span> {execution.flowId}</div>
          <div><span className="font-medium text-gray-600">Namespace:</span> {execution.namespace}</div>
          <div><span className="font-medium text-gray-600">ID:</span>{' '}
            <span className="font-mono text-xs">{execution.id}</span>
          </div>
        </div>

        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3 mb-4">
          This sends a kill signal to Kestra. The execution will transition to KILLED.
        </p>

        {cancel.isError && (
          <p className="text-red-600 text-sm mb-3">{cancel.error?.message ?? 'Cancel failed'}</p>
        )}

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50"
          >
            Back
          </button>
          <button
            onClick={handleConfirm}
            disabled={cancel.isPending}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
          >
            {cancel.isPending ? 'Cancelling…' : 'Confirm Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}
