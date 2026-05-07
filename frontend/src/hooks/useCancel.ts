import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../api/client'
import type { CancelResponse } from '../types/execution'

export function useCancel() {
  const queryClient = useQueryClient()
  return useMutation<CancelResponse, Error, string>({
    mutationFn: (id: string) =>
      api.post(`/api/executions/${id}/cancel`).then(r => r.data),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['executions'] })
      queryClient.invalidateQueries({ queryKey: ['execution', id] })
      queryClient.invalidateQueries({ queryKey: ['executions-summary'] })
    },
  })
}
