import type { ExecutionState } from '../types/execution'

const STATE_CLASSES: Record<ExecutionState, string> = {
  SUCCESS:   'bg-green-100  text-green-800',
  FAILED:    'bg-red-100    text-red-800',
  RUNNING:   'bg-blue-100   text-blue-800',
  KILLED:    'bg-gray-100   text-gray-800',
  KILLING:   'bg-orange-100 text-orange-800',
  PAUSED:    'bg-yellow-100 text-yellow-800',
  RESTARTED: 'bg-purple-100 text-purple-800',
  CREATED:   'bg-slate-100  text-slate-800',
  WARNING:   'bg-amber-100  text-amber-800',
}

export function StatusBadge({ state }: { state: ExecutionState }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATE_CLASSES[state]}`}>
      {state}
    </span>
  )
}
