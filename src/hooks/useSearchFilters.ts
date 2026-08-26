import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePreferencesStore } from '@/store/preferences'
import type { Sport } from '@/types'
import { SPORTS } from '@/types'
import type { VenueSearchParams } from './queries'

/** Bentuknya sama persis dengan parameter query venue — sengaja satu tipe. */
export type Filters = VenueSearchParams

export const DEFAULT_FILTERS: Filters = {
  q: '',
  sport: null,
  minPrice: 0,
  maxPrice: 400_000,
  maxDistance: 20,
  indoorOnly: false,
}

function parseSport(value: string | null): Sport | null {
  if (!value) return null
  return SPORTS.includes(value as Sport) ? (value as Sport) : null
}

function parseNumber(value: string | null, fallback: number): number {
  if (value === null) return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Filter hidup di URL search params, bukan di state komponen. Efeknya:
 * hasil pencarian bisa dibagikan lewat link, dan tombol back/forward peramban
 * benar-benar mengembalikan filter sebelumnya.
 */
export function useSearchFilters() {
  const [params, setParams] = useSearchParams()
  // Radius bawaan datang dari Pengaturan; URL tetap yang menang kalau diisi.
  const preferredRadius = usePreferencesStore((s) => s.defaultRadiusKm)

  const filters = useMemo<Filters>(
    () => ({
      q: params.get('q') ?? DEFAULT_FILTERS.q,
      sport: parseSport(params.get('sport')),
      minPrice: parseNumber(params.get('minPrice'), DEFAULT_FILTERS.minPrice),
      maxPrice: parseNumber(params.get('maxPrice'), DEFAULT_FILTERS.maxPrice),
      maxDistance: parseNumber(params.get('maxDistance'), preferredRadius),
      indoorOnly: params.get('indoor') === '1',
    }),
    [params, preferredRadius],
  )

  const setFilters = useCallback(
    (patch: Partial<Filters>) => {
      const next = { ...filters, ...patch }
      const search = new URLSearchParams()
      if (next.q) search.set('q', next.q)
      if (next.sport) search.set('sport', next.sport)
      if (next.minPrice !== DEFAULT_FILTERS.minPrice) search.set('minPrice', String(next.minPrice))
      if (next.maxPrice !== DEFAULT_FILTERS.maxPrice) search.set('maxPrice', String(next.maxPrice))
      if (next.maxDistance !== preferredRadius) {
        search.set('maxDistance', String(next.maxDistance))
      }
      if (next.indoorOnly) search.set('indoor', '1')
      // replace: mengetik di kotak cari tidak boleh membanjiri riwayat peramban.
      setParams(search, { replace: true })
    },
    [filters, setParams, preferredRadius],
  )

  const reset = useCallback(() => setParams(new URLSearchParams()), [setParams])

  const activeCount =
    (filters.sport ? 1 : 0) +
    (filters.minPrice !== DEFAULT_FILTERS.minPrice || filters.maxPrice !== DEFAULT_FILTERS.maxPrice
      ? 1
      : 0) +
    (filters.maxDistance !== preferredRadius ? 1 : 0) +
    (filters.indoorOnly ? 1 : 0)

  return { filters, setFilters, reset, activeCount }
}

/**
 * Menahan nilai selama `delay` ms. Dipakai kotak pencarian supaya tiap
 * ketikan tidak jadi satu permintaan jaringan.
 */
export function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}
