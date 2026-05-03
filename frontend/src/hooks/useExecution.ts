import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import type { ExecutionDetail } from '../types/execution'

export function useExecution(id: string) {
  return useQuery<ExecutionDetail>({
    queryKey: ['execution', id],
    queryFn: () => api.get(`/api/executions/${id}`).then(r => r.data),
    enabled: !!id,
  })
}
