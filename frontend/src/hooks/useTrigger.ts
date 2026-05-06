import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../api/client'
import type { TriggerResponse } from '../types/execution'

export function useTrigger(namespace: string, flowId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (inputs: Record<string, unknown>) =>
      api
        .post<TriggerResponse>(`/api/flows/${namespace}/${flowId}/trigger`, { inputs })
        .then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['executions'] })
      queryClient.invalidateQueries({ queryKey: ['flows'] })
    },
  })
}
