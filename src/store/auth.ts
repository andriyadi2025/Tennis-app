import { create } from 'zustand'
import type { AuthUser, Identity } from '@/lib/authApi'
import { fetchMe, logout as logoutRequest } from '@/lib/authApi'
import { STORAGE_KEYS, readJson, remove, writeJson } from '@/lib/storage'

interface PersistedAuth {
  user: AuthUser | null
  token: string | null
  identities: Identity[]
}

interface AuthState extends PersistedAuth {
  signIn: (user: AuthUser, token: string, identities?: Identity[]) => void
  signOut: () => void
  /** Menyegarkan profil dari server; sesi yang sudah dicabut ikut dibersihkan. */
  refresh: () => Promise<void>
  setUser: (user: AuthUser) => void
}

const initial = readJson<PersistedAuth>(STORAGE_KEYS.auth, {
  user: null,
  token: null,
  identities: [],
})

export const useAuthStore = create<AuthState>((set, get) => ({
  user: initial.user,
  token: initial.token,
  identities: initial.identities ?? [],

  signIn: (user, token, identities = []) => {
    set({ user, token, identities })
    writeJson(STORAGE_KEYS.auth, { user, token, identities })
  },

  signOut: () => {
    const { token } = get()
    // Sesi dicabut di server juga, bukan cuma dilupakan di sini.
    if (token) void logoutRequest(token).catch(() => undefined)
    set({ user: null, token: null, identities: [] })
    remove(STORAGE_KEYS.auth)
    remove(STORAGE_KEYS.draft)
  },

  setUser: (user) => {
    const { token, identities } = get()
    set({ user })
    writeJson(STORAGE_KEYS.auth, { user, token, identities })
  },

  refresh: async () => {
    const { token } = get()
    if (!token) return
    try {
      const { user, identities } = await fetchMe(token)
      set({ user, identities })
      writeJson(STORAGE_KEYS.auth, { user, token, identities })
    } catch {
      /*
       * Token yang ditolak server berarti sesi sudah tidak ada — dibuang di
       * sini juga, supaya app tidak menampilkan diri seolah masih masuk.
       */
      set({ user: null, token: null, identities: [] })
      remove(STORAGE_KEYS.auth)
    }
  },
}))

export function useIsAuthenticated(): boolean {
  return useAuthStore((s) => s.user !== null)
}
