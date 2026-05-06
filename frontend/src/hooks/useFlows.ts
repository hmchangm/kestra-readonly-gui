import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import type { FlowRow } from '../types/execution'

export function useFlows() {
  return useQuery<FlowRow[]>({
    queryKey: ['flows'],
    queryFn: () => api.get('/api/flows').then(r => r.data),
  })
}
