import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import type { SummaryData } from '../types/execution'

export function useSummary() {
  return useQuery<SummaryData>({
    queryKey: ['executions-summary'],
    queryFn: () => api.get('/api/executions/summary').then(r => r.data),
    refetchInterval: 60_000,
  })
}
