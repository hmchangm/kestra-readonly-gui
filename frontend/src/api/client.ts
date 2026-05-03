import axios from 'axios'
import { userManager } from '../auth/oidc'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
})

api.interceptors.request.use(async config => {
  const user = await userManager.getUser()
  if (user?.access_token) {
    config.headers.Authorization = `Bearer ${user.access_token}`
  }
  return config
})

let redirecting = false

api.interceptors.response.use(
  res => res,
  async err => {
    if (err.response?.status === 401 && !redirecting) {
      redirecting = true
      await userManager.signinRedirect()
    }
    return Promise.reject(err)
  }
)

export default api
