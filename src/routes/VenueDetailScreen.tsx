import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AirVent,
  Car,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coffee,
  Droplet,
  Landmark,
  MapPin,
  Shirt,
  Store,
  Wifi,
} from 'lucide-react'
import type { Facility, Venue } from '@/types'
import { FACILITY_LABEL, SPORT_LABEL } from '@/types'
import { useVenue, useVenueReviews } from '@/hooks/queries'
import { useDraftStore } from '@/store/draft'
import { formatDistance, formatIdr } from '@/lib/money'
import { LinkButton } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Chip, RatingValue, VenuePhoto } from '@/components/ui/primitives'
import { ErrorState, SkeletonBlock } from '@/components/ui/states'
import { StickyBar } from '@/components/layout/Screen'
import type { LucideIcon } from 'lucide-react'

const FACILITY_ICON: Record<Facility, LucideIcon> = {
  parkir: Car,
  toilet: Droplet,
  ruangGanti: Shirt,
  kantin: Coffee,
  wifi: Wifi,
  musholla: Landmark,
  ac: AirVent,
  tribun: Store,
  sewaAlat: Store,
}

/** 04 · Detail venue — galeri, fasilitas, harga, CTA sticky. */
export function VenueDetailScreen() {
  const { id } = useParams<{ id: string }>()
  const venue = useVenue(id)
  const reviews = useVenueReviews(id)
  const setVenue = useDraftStore((s) => s.setVenue)

  if (venue.isLoading) return <VenueDetailSkeleton />
  if (venue.error || !venue.data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-5 bg-bg px-5 py-6">
        <ErrorState
          body={venue.error?.message ?? 'Venue tidak ditemukan.'}
          onRetry={() => void venue.refetch()}
        />
        <Link to="/search" className="text-center text-base font-semibold text-accent-700">
          Kembali ke pencarian
        </Link>
      </div>
    )
  }

  const data = venue.data
  const firstSport = data.sport[0]

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <div className="scroll-area flex flex-1 flex-col gap-6 pb-6">
        <Gallery venue={data} />

        <div className="flex flex-col gap-6 px-5">
          <div className="flex flex-col gap-2.5">
            <h1 className="text-4xl">{data.name}</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-base text-neutral-700">
              <RatingValue value={data.rating} />
              <Link to={`/venue/${data.id}/reviews`} className="font-semibold text-accent-700">
                {data.reviewCount} ulasan
              </Link>
              <span className="inline-flex items-center gap-1.5">
                <Icon icon={MapPin} size={14} />
                {formatDistance(data.distanceKm)}
              </span>
            </div>
            <p className="text-base text-neutral-700">{data.address}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {data.sport.map((s) => (
              <Chip key={s} tone="sage">
                {SPORT_LABEL[s]}
              </Chip>
            ))}
            <Chip tone={data.indoor ? 'accent' : 'neutral'}>
              {data.indoor ? 'Indoor' : 'Outdoor'}
            </Chip>
            <Chip tone="neutral">
              <Icon icon={Clock} size={13} />
              {String(data.openHours.open).padStart(2, '0')}.00 –{' '}
              {String(data.openHours.close).padStart(2, '0')}.00
            </Chip>
          </div>

          <section className="flex flex-col gap-3">
            <h2 className="text-3xl">Fasilitas</h2>
            <ul className="grid grid-cols-2 gap-2.5">
              {data.facilities.map((f) => (
                <li key={f} className="flex items-center gap-2.5 rounded-md bg-surface px-3.5 py-3">
                  <Icon icon={FACILITY_ICON[f]} size={17} className="text-accent2-700" />
                  <span className="text-base">{FACILITY_LABEL[f]}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-3xl">Lapangan & harga</h2>
            <ul className="flex flex-col gap-2.5">
              {data.courts.map((court) => (
                <li
                  key={court.id}
                  className="flex items-center gap-3 rounded-md bg-surface px-4 py-3"
                >
                  <div className="flex flex-1 flex-col">
                    <span className="text-md font-bold">{court.name}</span>
                    <span className="text-sm text-neutral-700">
                      {SPORT_LABEL[court.sport]} · {court.surface} ·{' '}
                      {court.indoor ? 'indoor' : 'outdoor'}
                    </span>
                  </div>
                  <span className="font-heading text-lg text-accent-700">
                    {formatIdr(court.pricePerHourIdr ?? data.pricePerHourIdr)}
                    <span className="font-body text-sm text-neutral-600">/jam</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-neutral-600">
              Jam prime time (18.00–21.00) dikenakan tarif 20% lebih tinggi.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-3xl">Ulasan</h2>
              <Link
                to={`/venue/${data.id}/reviews`}
                className="inline-flex items-center gap-1 text-base font-semibold text-accent-700"
              >
                Semua
                <Icon icon={ChevronRight} size={15} />
              </Link>
            </div>
            {reviews.isLoading ? (
              <SkeletonBlock className="h-20 w-full" />
            ) : reviews.data && reviews.data.reviews.length > 0 ? (
              <blockquote className="flex flex-col gap-2 rounded-lg bg-surface p-4">
                <RatingValue value={reviews.data.reviews[0]?.rating ?? 0} />
                <p className="text-base">{reviews.data.reviews[0]?.body}</p>
                <cite className="text-sm not-italic text-neutral-600">
                  {reviews.data.reviews[0]?.authorName}
                </cite>
              </blockquote>
            ) : (
              <p className="text-base text-neutral-700">Belum ada ulasan untuk venue ini.</p>
            )}
          </section>
        </div>
      </div>

      <StickyBar>
        <div className="flex flex-col">
          <span className="text-sm text-neutral-700">Mulai dari</span>
          <span className="font-heading text-2xl text-accent-700">
            {formatIdr(data.pricePerHourIdr)}
            <span className="font-body text-sm text-neutral-600">/jam</span>
          </span>
        </div>
        <LinkButton
          to={`/venue/${data.id}/schedule`}
          size="lg"
          className="flex-1"
          // Menyimpan venue ke draft sebelum pindah supaya layar jadwal
          // tidak perlu menebak konteksnya.
          onClick={() => {
            if (firstSport) setVenue(data.id, data.name, firstSport)
          }}
        >
          Pilih jadwal
        </LinkButton>
      </StickyBar>
    </div>
  )
}

function Gallery({ venue }: { venue: Venue }) {
  const navigate = useNavigate()
  const [index, setIndex] = useState(0)
  const photo = venue.photos[index] ?? venue.photos[0]

  return (
    <div className="relative">
      {photo && <VenuePhoto photo={photo} className="h-56 w-full" rounded="rounded-none" />}
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label="Kembali"
        className="absolute left-5 top-4 flex h-11 w-11 items-center justify-center rounded-pill bg-bg"
      >
        <Icon icon={ChevronLeft} size={20} />
      </button>
      {venue.photos.length > 1 && (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
          {venue.photos.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Foto ${i + 1}`}
              aria-current={i === index}
              className={
                i === index
                  ? 'h-2.5 w-6 rounded-pill bg-bg'
                  : 'h-2.5 w-2.5 rounded-pill bg-bg opacity-60'
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

function VenueDetailSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 bg-bg pb-6" aria-hidden>
      <SkeletonBlock className="h-56 w-full rounded-none" />
      <div className="flex flex-col gap-4 px-5">
        <SkeletonBlock className="h-7 w-2/3 rounded-pill" />
        <SkeletonBlock className="h-4 w-1/2 rounded-pill" />
        <SkeletonBlock className="h-4 w-3/4 rounded-pill" />
        <div className="grid grid-cols-2 gap-2.5 pt-2">
          {Array.from({ length: 6 }, (_, i) => (
            <SkeletonBlock key={i} className="h-12" />
          ))}
        </div>
      </div>
    </div>
  )
}
