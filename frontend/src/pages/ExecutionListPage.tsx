import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useExecutions } from '../hooks/useExecutions'
import { useSummary } from '../hooks/useSummary'
import { StatusBadge } from '../components/StatusBadge'
import { KpiCard } from '../components/KpiCard'
import { TimelineChart } from '../components/TimelineChart'
import { RetriggerModal } from '../components/RetriggerModal'
import { CancelModal, CANCELLABLE_STATES } from '../components/CancelModal'
import { NamespaceCombobox } from '../components/NamespaceCombobox'
import { NavBar } from '../components/NavBar'
import type { ExecutionRow, ExecutionState } from '../types/execution'

const STATES: ExecutionState[] = ['CREATED','RUNNING','PAUSED','SUCCESS','WARNING','FAILED','KILLED']

export function ExecutionListPage() {
  const [namespace, setNamespace] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)
  const [retriggerTarget, setRetriggerTarget] = useState<ExecutionRow | null>(null)
  const [cancelTarget, setCancelTarget] = useState<ExecutionRow | null>(null)
  const [chartsOpen, setChartsOpen] = useState(true)

  const { data: summary } = useSummary()
  const { data: executions, isLoading, error } = useExecutions({
    namespace: namespace || undefined,
    status: status || undefined,
    from: from ? (from.endsWith('Z') ? from : from + ':00Z') : undefined,
    to:   to   ? (to.endsWith('Z')   ? to   : to   + ':00Z') : undefined,
    page,
    size: 20,
  })

  return (
    <>
      <NavBar />
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Executions</h1>
          <button
            onClick={() => setChartsOpen(o => !o)}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 border rounded-md px-3 py-1.5"
          >
            <span>{chartsOpen ? '▲' : '▼'}</span>
            <span>{chartsOpen ? 'Hide charts' : 'Show charts'}</span>
          </button>
        </div>

      {chartsOpen && (
        <>
          {/* KPI Cards */}
          <div className="flex gap-4 flex-wrap">
            <KpiCard label="Total today"  value={summary?.totalToday  ?? '—'} />
            <KpiCard label="Success rate" value={summary ? `${summary.successRate}%` : '—'} color="green" />
            <KpiCard label="Running now"  value={summary?.runningNow  ?? '—'} color="blue" />
            <KpiCard label="Failed today" value={summary?.failedToday ?? '—'} color="red" />
          </div>

          {/* Timeline chart */}
          {summary?.hourly && summary.hourly.length > 0 && (
            <div className="border rounded-lg p-4">
              <h2 className="text-sm font-medium text-gray-500 mb-2">Executions last 24h</h2>
              <TimelineChart data={summary.hourly} />
            </div>
          )}
        </>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <NamespaceCombobox
          value={namespace}
          onChange={v => { setNamespace(v); setPage(0) }}
        />
        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(0) }}
          className="border rounded-md px-3 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          {STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          type="datetime-local"
          value={from}
          onChange={e => { setFrom(e.target.value); setPage(0) }}
          className="border rounded-md px-3 py-1.5 text-sm"
          title="From"
        />
        <input
          type="datetime-local"
          value={to}
          onChange={e => { setTo(e.target.value); setPage(0) }}
          className="border rounded-md px-3 py-1.5 text-sm"
          title="To"
        />
      </div>

      {/* Table */}
      {isLoading && <div className="text-gray-500">Loading…</div>}
      {error && <div className="text-red-600">Failed to load executions: {(error as Error).message}</div>}
      {executions && (
        <>
          {/* Pagination — top */}
          <div className="flex items-center gap-3 text-sm">
            <button
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 border rounded disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="text-gray-500">
              Page {page + 1} · {executions.total} total
            </span>
            <button
              disabled={(page + 1) * executions.size >= executions.total}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 border rounded disabled:opacity-40"
            >
              Next →
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-500 text-xs uppercase tracking-wide">
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Flow</th>
                  <th className="px-4 py-3">Namespace</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Start</th>
                  <th className="px-4 py-3">End</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {executions.results.map(exec => (
                  <tr key={exec.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-blue-600">
                      <Link to={`/executions/${exec.id}`} className="hover:underline">
                        {exec.id.slice(0, 8)}…
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium">{exec.flowId}</td>
                    <td className="px-4 py-3 text-gray-500">{exec.namespace}</td>
                    <td className="px-4 py-3"><StatusBadge state={exec.state} /></td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {exec.startDate ? new Date(exec.startDate).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {exec.endDate ? new Date(exec.endDate).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 flex gap-2">
                      {CANCELLABLE_STATES.has(exec.state) && (
                        <button
                          onClick={() => setCancelTarget(exec)}
                          className="px-2.5 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        onClick={() => setRetriggerTarget(exec)}
                        className="px-2.5 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        Retrigger
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center gap-3 text-sm">
            <button
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 border rounded disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="text-gray-500">
              Page {page + 1} · {executions.total} total
            </span>
            <button
              disabled={(page + 1) * executions.size >= executions.total}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 border rounded disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </>
      )}

        {retriggerTarget && (
          <RetriggerModal execution={retriggerTarget} onClose={() => setRetriggerTarget(null)} />
        )}
        {cancelTarget && (
          <CancelModal execution={cancelTarget} onClose={() => setCancelTarget(null)} />
        )}
      </div>
    </>
  )
}
