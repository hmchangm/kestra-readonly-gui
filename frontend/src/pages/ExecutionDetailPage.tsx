import { useState, Fragment } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useExecution } from '../hooks/useExecution'
import { useTaskLogs } from '../hooks/useTaskLogs'
import { StatusBadge } from '../components/StatusBadge'
import { KpiCard } from '../components/KpiCard'
import { RetriggerModal } from '../components/RetriggerModal'

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '—'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const s = Math.floor(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function levelClass(level: string): string {
  if (level === 'ERROR') return 'text-red-400'
  if (level === 'WARN') return 'text-yellow-400'
  return 'text-gray-400'
}

export function ExecutionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: execution, isLoading, error } = useExecution(id!)
  const [showRetrigger, setShowRetrigger] = useState(false)
  const [expandedTaskRunId, setExpandedTaskRunId] = useState<string | null>(null)
  const { data: logs, isLoading: logsLoading } = useTaskLogs(id!, expandedTaskRunId)

  if (isLoading) return <div className="p-6 text-gray-500">Loading…</div>
  if (error || !execution) return (
    <div className="p-6">
      <p className="text-red-600">Execution not found.</p>
      <Link to="/" className="text-blue-600 text-sm hover:underline mt-2 block">← Back</Link>
    </div>
  )

  const passed = execution.taskRuns.filter(t => t.state === 'SUCCESS').length
  const failed = execution.taskRuns.filter(t => ['FAILED', 'KILLED'].includes(t.state)).length

  function toggleLogs(taskRunId: string) {
    setExpandedTaskRunId(prev => prev === taskRunId ? null : taskRunId)
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-blue-600 text-sm hover:underline">← Executions</Link>
        <span className="text-gray-300">/</span>
        <span className="font-mono text-sm text-gray-600">{execution.id}</span>
      </div>

      {/* KPI cards */}
      <div className="flex gap-4 flex-wrap items-center">
        <KpiCard label="Duration" value={formatDuration(execution.startDate, execution.endDate)} />
        <KpiCard label="Tasks passed" value={`${passed} / ${execution.taskRuns.length}`} color="green" />
        <KpiCard label="Tasks failed" value={failed} color={failed > 0 ? 'red' : 'default'} />
        <div className="border rounded-lg p-4 text-center min-w-[120px]">
          <StatusBadge state={execution.state} />
          <div className="text-xs text-gray-500 mt-1">Final state</div>
        </div>
        <button
          onClick={() => setShowRetrigger(true)}
          className="ml-auto px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
        >
          Retrigger
        </button>
      </div>

      {/* Metadata */}
      <div className="border rounded-lg p-5 space-y-2 text-sm">
        <h2 className="font-semibold text-base mb-3">Details</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2">
          <div><span className="text-gray-500">Flow:</span> <span className="font-medium">{execution.flowId}</span></div>
          <div><span className="text-gray-500">Namespace:</span> {execution.namespace}</div>
          <div><span className="text-gray-500">Start:</span> {execution.startDate ? new Date(execution.startDate).toLocaleString() : '—'}</div>
          <div><span className="text-gray-500">End:</span> {execution.endDate ? new Date(execution.endDate).toLocaleString() : '—'}</div>
        </div>
        {Object.keys(execution.inputs).length > 0 && (
          <div className="mt-3">
            <div className="text-gray-500 mb-1">Inputs:</div>
            <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto border">
              {JSON.stringify(execution.inputs, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Task runs */}
      <div className="border rounded-lg overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b">
          <h2 className="font-semibold text-sm">Task Runs ({execution.taskRuns.length})</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 uppercase tracking-wide">
            <tr className="border-b">
              <th className="px-4 py-2 text-left">Task ID</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">Start</th>
              <th className="px-4 py-2 text-left">End</th>
              <th className="px-4 py-2 text-left">Duration</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {execution.taskRuns.map(tr => {
              const isExpanded = expandedTaskRunId === tr.id
              return (
                <Fragment key={tr.id}>
                  <tr className={`hover:bg-gray-50 ${isExpanded ? 'bg-yellow-50 border-l-2 border-yellow-300' : ''}`}>
                    <td className="px-4 py-2.5 font-mono text-xs">{tr.taskId}</td>
                    <td className="px-4 py-2.5"><StatusBadge state={tr.state} /></td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">
                      {tr.startDate ? new Date(tr.startDate).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">
                      {tr.endDate ? new Date(tr.endDate).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">
                      {formatDuration(tr.startDate, tr.endDate)}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => toggleLogs(tr.id)}
                        className="text-xs text-blue-600 hover:text-blue-800 whitespace-nowrap"
                      >
                        {isExpanded ? '▼ logs' : '▶ logs'}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr data-testid="log-panel">
                      <td colSpan={6} className="p-0">
                        <div className="bg-gray-900 text-gray-200 font-mono text-xs leading-relaxed p-3 max-h-64 overflow-y-auto">
                          {logsLoading && (
                            <div className="text-gray-500 text-center py-4">Loading…</div>
                          )}
                          {!logsLoading && (!logs || logs.length === 0) && (
                            <div className="text-gray-500 text-center py-4">No logs for this task run.</div>
                          )}
                          {!logsLoading && logs && logs.map((entry, i) => (
                            <div key={i}>
                              <span className="text-gray-600">{entry.timestamp}</span>
                              {' '}
                              <span className={`${levelClass(entry.level)} font-semibold`}>{entry.level.padEnd(5)}</span>
                              {' '}
                              {entry.message}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {showRetrigger && (
        <RetriggerModal execution={execution} onClose={() => setShowRetrigger(false)} />
      )}
    </div>
  )
}
