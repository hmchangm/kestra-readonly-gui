import { useState } from 'react'
import { Link } from 'react-router-dom'
import { NavBar } from '../components/NavBar'
import { NamespaceCombobox } from '../components/NamespaceCombobox'
import { useFlows } from '../hooks/useFlows'

export function FlowListPage() {
  const [namespace, setNamespace] = useState('')
  const { data: flows, isLoading, error } = useFlows()

  if (isLoading) return <><NavBar /><div className="p-6 text-gray-500">Loading...</div></>
  if (error) return <><NavBar /><div className="p-6 text-red-600">Failed to load flows.</div></>

  const filteredFlows = namespace
    ? (flows ?? []).filter(flow => flow.namespace.toLowerCase().includes(namespace.toLowerCase()))
    : (flows ?? [])

  return (
    <>
      <NavBar />
      <div className="p-6 space-y-4 max-w-6xl mx-auto">
        <h1 className="text-2xl font-semibold">Flows</h1>
        <div className="flex gap-3 flex-wrap">
          <NamespaceCombobox value={namespace} onChange={setNamespace} />
        </div>
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">Namespace</th>
                <th className="px-4 py-2 text-left">Flow</th>
                <th className="px-4 py-2 text-left">Last run</th>
                <th className="px-4 py-2 text-left">Executions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredFlows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-500">
                    No flows match this namespace.
                  </td>
                </tr>
              ) : (
                filteredFlows.map(flow => (
                  <tr key={`${flow.namespace}/${flow.flowId}`} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">{flow.namespace}</td>
                    <td className="px-4 py-2.5">
                      <Link to={`/flows/${flow.namespace}/${flow.flowId}`} className="text-blue-600 hover:underline font-medium">
                        {flow.flowId}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{flow.lastRunDate ? new Date(flow.lastRunDate).toLocaleString() : '-'}</td>
                    <td className="px-4 py-2.5">{flow.executionCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
