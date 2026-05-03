import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import type { ExecutionPage } from '../types/execution'

export interface ExecutionFilters {
  namespace?: string
  status?: string
  from?: string
  to?: string
  page?: number
  size?: number
}

export function useExecutions(filters: ExecutionFilters = {}) {
  return useQuery<ExecutionPage>({
    queryKey: ['executions', filters],
    queryFn: () => api.get('/api/executions', { params: filters }).then(r => r.data),
  })
}
