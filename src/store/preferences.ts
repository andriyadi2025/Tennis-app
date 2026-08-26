import { create } from 'zustand'
import type { NotificationKind, Preferences } from '@/types'
import { readJson, writeJson } from '@/lib/storage'

const KEY = 'preferences'

export const DEFAULT_PREFERENCES: Preferences = {
  notify: {
    booking: true,
    payment: true,
    match: true,
    promo: false,
    community: true,
  },
  area: 'Bandung Utara',
  defaultRadiusKm: 20,
  reduceMotion: false,
}

interface PreferencesState extends Preferences {
  setArea: (area: string) => void
  setRadius: (km: number) => void
  toggleNotify: (kind: NotificationKind) => void
  setReduceMotion: (value: boolean) => void
  resetPreferences: () => void
}

/**
 * Preferensi dibaca sekali saat modul dimuat dan ditulis ulang tiap berubah.
 * Nilai yang tersimpan digabung di atas bawaan, bukan menggantikannya, supaya
 * preferensi lama tidak kehilangan kunci ketika ada setelan baru ditambahkan.
 */
function load(): Preferences {
  const saved = readJson<Partial<Preferences>>(KEY, {})
  return {
    ...DEFAULT_PREFERENCES,
    ...saved,
    notify: { ...DEFAULT_PREFERENCES.notify, ...(saved.notify ?? {}) },
  }
}

function snapshot(s: PreferencesState): Preferences {
  return {
    notify: s.notify,
    area: s.area,
    defaultRadiusKm: s.defaultRadiusKm,
    reduceMotion: s.reduceMotion,
  }
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  ...load(),

  setArea: (area) => {
    set({ area })
    writeJson(KEY, { ...snapshot(get()), area })
  },

  setRadius: (defaultRadiusKm) => {
    const km = Math.max(1, Math.round(defaultRadiusKm))
    set({ defaultRadiusKm: km })
    writeJson(KEY, { ...snapshot(get()), defaultRadiusKm: km })
  },

  toggleNotify: (kind) => {
    const notify = { ...get().notify, [kind]: !get().notify[kind] }
    set({ notify })
    writeJson(KEY, { ...snapshot(get()), notify })
  },

  setReduceMotion: (reduceMotion) => {
    set({ reduceMotion })
    writeJson(KEY, { ...snapshot(get()), reduceMotion })
  },

  resetPreferences: () => {
    set(DEFAULT_PREFERENCES)
    writeJson(KEY, DEFAULT_PREFERENCES)
  },
}))
