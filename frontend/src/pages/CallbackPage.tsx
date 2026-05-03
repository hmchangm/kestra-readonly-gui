import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { userManager } from '../auth/oidc'

export function CallbackPage() {
  const navigate = useNavigate()
  useEffect(() => {
    userManager.signinRedirectCallback()
      .then(() => navigate('/'))
      .catch(err => {
        console.error('OIDC callback failed', err)
        navigate('/login')
      })
  }, [navigate])
  return <div className="flex items-center justify-center h-screen text-gray-500">Completing login…</div>
}
