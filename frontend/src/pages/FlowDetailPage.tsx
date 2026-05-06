import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { NavBar } from '../components/NavBar'
import { StatusBadge } from '../components/StatusBadge'
import { TriggerModal } from '../components/TriggerModal'
import { useExecutions } from '../hooks/useExecutions'
import { useFlow } from '../hooks/useFlow'
import { useFlowInputs } from '../hooks/useFlowInputs'

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '-'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const s = Math.floor(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

export function FlowDetailPage() {
  const { namespace, flowId } = useParams<{ namespace: string; flowId: string }>()
  const [showTrigger, setShowTrigger] = useState(false)
  const { data: flow, isLoading, error } = useFlow(namespace, flowId)
  const { data: executions, isLoading: executionsLoading } = useExecutions({ namespace, flowId, size: 20 })
  const { data: inputs, isLoading: inputsLoading } = useFlowInputs(namespace!, flowId!, showTrigger)

  if (isLoading) return <><NavBar /><div className="p-6 text-gray-500">Loading...</div></>
  if (error || !flow) return <><NavBar /><div className="p-6 text-red-600">Flow not found.</div></>

  return (
    <>
      <NavBar />
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-3">
          <Link to="/flows" className="text-blue-600 text-sm hover:underline">← Flows</Link>
          <span className="text-gray-300">/</span>
          <span>{flow.namespace}</span>
          <span className="text-gray-300">/</span>
          <span className="font-medium">{flow.flowId}</span>
          <button
            onClick={() => setShowTrigger(true)}
            className="ml-auto px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
          >
            Trigger
          </button>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 border-b">
            <h2 className="font-semibold text-sm">Recent Executions</h2>
          </div>
          {executionsLoading ? (
            <div className="p-5 text-sm text-gray-500">Loading...</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 uppercase tracking-wide">
                <tr className="border-b">
                  <th className="px-4 py-2 text-left">ID</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Start</th>
                  <th className="px-4 py-2 text-left">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(executions?.results ?? []).map(execution => (
                  <tr key={execution.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-mono text-xs">
                      <Link to={`/executions/${execution.id}`} className="text-blue-600 hover:underline">{execution.id}</Link>
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge state={execution.state} /></td>
                    <td className="px-4 py-2.5 text-gray-500">{execution.startDate ? new Date(execution.startDate).toLocaleString() : '-'}</td>
                    <td className="px-4 py-2.5 text-gray-500">{formatDuration(execution.startDate, execution.endDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {showTrigger && (
          inputsLoading ? (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 shadow-xl text-sm text-gray-500">Loading inputs...</div>
            </div>
          ) : (
            <TriggerModal namespace={flow.namespace} flowId={flow.flowId} inputs={inputs ?? []} onClose={() => setShowTrigger(false)} />
          )
        )}
      </div>
    </>
  )
}
