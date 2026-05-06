import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import type { LogEntry } from '../types/execution'

export function useTaskLogs(executionId: string, taskRunId: string | null) {
  return useQuery<LogEntry[]>({
    queryKey: ['taskLogs', executionId, taskRunId],
    queryFn: () =>
      api
        .get(`/api/executions/${executionId}/tasks/${taskRunId}/logs`)
        .then(r => r.data),
    enabled: !!taskRunId,
  })
}
