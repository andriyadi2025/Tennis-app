import { create } from 'zustand'
import type { User } from '@/types'
import { STORAGE_KEYS, readJson, remove, writeJson } from '@/lib/storage'

interface PersistedAuth {
  user: User | null
  token: string | null
}

interface AuthState extends PersistedAuth {
  signIn: (user: User, token: string) => void
  signOut: () => void
  /** Poin berkurang saat ditukar, bertambah setelah booking lunas. */
  adjustPoints: (delta: number) => void
}

const initial = readJson<PersistedAuth>(STORAGE_KEYS.auth, { user: null, token: null })

export const useAuthStore = create<AuthState>((set, get) => ({
  user: initial.user,
  token: initial.token,

  signIn: (user, token) => {
    set({ user, token })
    writeJson(STORAGE_KEYS.auth, { user, token })
  },

  signOut: () => {
    set({ user: null, token: null })
    // Hanya kunci milik app ini yang dihapus.
    remove(STORAGE_KEYS.auth)
    remove(STORAGE_KEYS.draft)
  },

  adjustPoints: (delta) => {
    const { user, token } = get()
    if (!user) return
    const next = { ...user, points: Math.max(0, user.points + delta) }
    set({ user: next })
    writeJson(STORAGE_KEYS.auth, { user: next, token })
  },
}))

export function useIsAuthenticated(): boolean {
  return useAuthStore((s) => s.user !== null)
}
