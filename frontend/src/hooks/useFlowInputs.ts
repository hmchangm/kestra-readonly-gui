import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import type { FlowInput } from '../types/execution'

export function useFlowInputs(namespace: string, flowId: string, enabled: boolean) {
  return useQuery<FlowInput[]>({
    queryKey: ['flowInputs', namespace, flowId],
    queryFn: () => api.get(`/api/flows/${namespace}/${flowId}/inputs`).then(r => r.data),
    enabled,
  })
}
