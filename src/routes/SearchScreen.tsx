import { useEffect, useState } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { SPORTS, SPORT_LABEL } from '@/types'
import { useVenues } from '@/hooks/queries'
import { DEFAULT_FILTERS, useDebounced, useSearchFilters } from '@/hooks/useSearchFilters'
import { formatIdrShort } from '@/lib/money'
import { Screen, ScreenHeader } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Chip, Toggle, ToggleChip } from '@/components/ui/primitives'
import { AsyncList, EmptyState, ListSkeleton } from '@/components/ui/states'
import { VenueCard } from '@/components/domain/cards'

const PRICE_STEPS = [50_000, 100_000, 200_000, 400_000]
const DISTANCE_STEPS = [2, 5, 10, 20]

/** 03 · Cari & filter. Semua filter tersimpan di URL. */
export function SearchScreen() {
  const { filters, setFilters, reset, activeCount } = useSearchFilters()
  const [panelOpen, setPanelOpen] = useState(false)
  const [query, setQuery] = useState(filters.q)
  const debouncedQuery = useDebounced(query)

  // Ketikan menyusul ke URL setelah jeda; back/forward tetap sumber kebenaran.
  useEffect(() => {
    if (debouncedQuery !== filters.q) setFilters({ q: debouncedQuery })
  }, [debouncedQuery, filters.q, setFilters])

  const venues = useVenues(filters)

  return (
    <Screen>
      <ScreenHeader
        title="Cari"
        action={
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            aria-expanded={panelOpen}
            aria-controls="filter-panel"
            // Nama aksesibel dipatok di sini supaya angka pada lencana tidak
            // ikut terbaca sebagai bagian dari nama tombol.
            aria-label="Filter"
            className="relative flex h-11 w-11 items-center justify-center rounded-pill bg-surface"
          >
            <Icon icon={SlidersHorizontal} size={19} />
            {activeCount > 0 && (
              <span
                aria-hidden
                className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-pill bg-accent text-xs font-bold text-bg"
              >
                {activeCount}
              </span>
            )}
          </button>
        }
      />

      <div className="flex min-h-touch items-center gap-2.5 rounded-pill bg-surface px-5">
        <Icon icon={Search} size={18} className="text-accent-700" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="futsal sabtu"
          aria-label="Cari venue atau cabang olahraga"
          className="w-full bg-transparent text-lg text-text placeholder:text-neutral-600 focus:outline-none"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} aria-label="Hapus pencarian">
            <Icon icon={X} size={17} className="text-neutral-600" />
          </button>
        )}
      </div>

      {/* Cabang olahraga selalu terlihat — filter yang paling sering dipakai. */}
      <div className="row-scroll -mx-5 flex gap-2 px-5">
        <ToggleChip active={filters.sport === null} onClick={() => setFilters({ sport: null })}>
          Semua
        </ToggleChip>
        {SPORTS.map((sport) => (
          <ToggleChip
            key={sport}
            active={filters.sport === sport}
            onClick={() => setFilters({ sport: filters.sport === sport ? null : sport })}
          >
            {SPORT_LABEL[sport]}
          </ToggleChip>
        ))}
      </div>

      {panelOpen && (
        <div id="filter-panel" className="flex flex-col gap-5 rounded-lg bg-surface p-4">
          <fieldset className="flex flex-col gap-2.5">
            <legend className="text-base font-bold">Harga maksimum per jam</legend>
            <div className="flex flex-wrap gap-2">
              {PRICE_STEPS.map((step) => (
                <ToggleChip
                  key={step}
                  active={filters.maxPrice === step}
                  onClick={() => setFilters({ maxPrice: step })}
                >
                  {formatIdrShort(step)}
                </ToggleChip>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2.5">
            <legend className="text-base font-bold">Jarak maksimum</legend>
            <div className="flex flex-wrap gap-2">
              {DISTANCE_STEPS.map((km) => (
                <ToggleChip
                  key={km}
                  active={filters.maxDistance === km}
                  onClick={() => setFilters({ maxDistance: km })}
                >
                  {km} km
                </ToggleChip>
              ))}
            </div>
          </fieldset>

          <Toggle
            checked={filters.indoorOnly}
            onChange={(next) => setFilters({ indoorOnly: next })}
            label="Indoor saja"
            description="Sembunyikan lapangan terbuka."
          />

          <div className="flex gap-3">
            <Button variant="secondary" block onClick={reset}>
              Reset
            </Button>
            <Button block onClick={() => setPanelOpen(false)}>
              Terapkan
            </Button>
          </div>
        </div>
      )}

      {activeCount > 0 && !panelOpen && (
        <div className="flex flex-wrap items-center gap-2">
          {filters.sport && <Chip tone="sage">{SPORT_LABEL[filters.sport]}</Chip>}
          {filters.maxPrice !== DEFAULT_FILTERS.maxPrice && (
            <Chip tone="accent">≤ {formatIdrShort(filters.maxPrice)}/jam</Chip>
          )}
          {filters.maxDistance !== DEFAULT_FILTERS.maxDistance && (
            <Chip tone="accent">≤ {filters.maxDistance} km</Chip>
          )}
          {filters.indoorOnly && <Chip tone="sage">Indoor</Chip>}
        </div>
      )}

      <div className="flex flex-col gap-3.5">
        <p aria-live="polite" className="text-base text-neutral-700">
          {venues.isLoading
            ? 'Mencari venue…'
            : venues.data
              ? `${venues.data.length} venue ditemukan`
              : ''}
        </p>
        <AsyncList
          isLoading={venues.isLoading}
          error={venues.error}
          data={venues.data}
          onRetry={() => void venues.refetch()}
          skeleton={<ListSkeleton count={4} />}
          empty={
            <EmptyState
              title="Tidak ada yang cocok"
              body="Coba longgarkan filter harga atau perlebar jaraknya."
              action={
                <Button variant="secondary" onClick={reset}>
                  Reset filter
                </Button>
              }
            />
          }
        >
          {(rows) => (
            <div className="flex flex-col gap-3.5">
              {rows.map((venue) => (
                <VenueCard key={venue.id} venue={venue} />
              ))}
            </div>
          )}
        </AsyncList>
      </div>
    </Screen>
  )
}
