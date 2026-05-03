import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../api/client'
import type { RetriggerResponse } from '../types/execution'

interface RetriggerRequest {
  id: string
  overrides: Record<string, unknown>
}

export function useRetrigger() {
  const queryClient = useQueryClient()
  return useMutation<RetriggerResponse, Error, RetriggerRequest>({
    mutationFn: ({ id, overrides }) =>
      api.post(`/api/executions/${id}/retrigger`, { overrides }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['executions'] })
      queryClient.invalidateQueries({ queryKey: ['executions-summary'] })
    },
  })
}
