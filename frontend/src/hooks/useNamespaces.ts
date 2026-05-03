import { useQuery } from '@tanstack/react-query'
import api from '../api/client'

export function useNamespaces() {
  return useQuery<string[]>({
    queryKey: ['namespaces'],
    queryFn: () => api.get('/api/namespaces').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })
}
