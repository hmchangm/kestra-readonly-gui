import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import type { FlowDetail } from '../types/execution'

export function useFlow(namespace: string | undefined, flowId: string | undefined) {
  return useQuery<FlowDetail>({
    queryKey: ['flow', namespace, flowId],
    queryFn: () => api.get(`/api/flows/${namespace}/${flowId}`).then(r => r.data),
    enabled: !!namespace && !!flowId,
  })
}
