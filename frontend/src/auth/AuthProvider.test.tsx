import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthProvider'

vi.mock('./oidc', () => ({
  userManager: {
    getUser: vi.fn().mockResolvedValue(null),
    events: {
      addUserLoaded: vi.fn(),
      addUserUnloaded: vi.fn(),
      removeUserLoaded: vi.fn(),
      removeUserUnloaded: vi.fn(),
    },
    signinRedirect: vi.fn(),
    signoutRedirect: vi.fn(),
  },
}))

function TestConsumer() {
  const { user, isLoading } = useAuth()
  return <div>{isLoading ? 'loading' : user ? 'logged-in' : 'logged-out'}</div>
}

describe('AuthProvider', () => {
  it('shows loading then logged-out when no user', async () => {
    render(<AuthProvider><TestConsumer /></AuthProvider>)
    expect(screen.getByText('loading')).toBeInTheDocument()
    await screen.findByText('logged-out')
  })
})
