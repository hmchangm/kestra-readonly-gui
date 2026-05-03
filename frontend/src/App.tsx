import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { CallbackPage } from './pages/CallbackPage'
import { ExecutionListPage } from './pages/ExecutionListPage'
import { ExecutionDetailPage } from './pages/ExecutionDetailPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})

function LoginRedirect() {
  const { login } = useAuth()
  useEffect(() => { login() }, [login])
  return <div className="flex items-center justify-center h-screen text-gray-500">Redirecting to login…</div>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/callback" element={<CallbackPage />} />
            <Route path="/login" element={<LoginRedirect />} />
            <Route path="/" element={<ProtectedRoute><ExecutionListPage /></ProtectedRoute>} />
            <Route path="/executions/:id" element={<ProtectedRoute><ExecutionDetailPage /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
