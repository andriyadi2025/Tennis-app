import { useState } from 'react'
import type { FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { PenLine, Star } from 'lucide-react'
import type { ReviewSummary } from '@/types'
import { useVenue, useVenueReviews, useWriteReview } from '@/hooks/queries'
import { formatRelative } from '@/lib/dates'
import { Screen, ScreenHeader } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Toast } from '@/components/ui/Toast'
import { useToast } from '@/hooks/useToast'
import { Avatar, Chip, ProgressBar, RatingStars } from '@/components/ui/primitives'
import { AsyncList, EmptyState, RowSkeleton, SkeletonBlock } from '@/components/ui/states'

/** 11 · Ulasan — ringkasan rating + distribusi bintang. */
export function ReviewsScreen() {
  const { id } = useParams<{ id: string }>()
  const venue = useVenue(id)
  const reviews = useVenueReviews(id)
  const { toast, show } = useToast()

  return (
    <Screen overlay={<Toast toast={toast} />}>
      <ScreenHeader title={venue.data?.name ?? 'Ulasan'} />

      {reviews.isLoading ? (
        <SkeletonBlock className="h-36 w-full rounded-lg" />
      ) : reviews.data ? (
        <SummaryPanel summary={reviews.data.summary} />
      ) : null}

      <ReviewForm venueId={id} onDone={() => show('Ulasan kamu sudah tayang. Terima kasih.')} />

      <AsyncList
        isLoading={reviews.isLoading}
        error={reviews.error}
        data={reviews.data?.reviews}
        onRetry={() => void reviews.refetch()}
        skeleton={<RowSkeleton count={4} />}
        empty={
          <EmptyState
            title="Belum ada ulasan"
            body="Jadi yang pertama menulis pengalaman main di sini."
          />
        }
      >
        {(rows) => (
          <ul className="flex flex-col gap-3.5">
            {rows.map((review) => (
              <li key={review.id} className="flex flex-col gap-2.5 rounded-lg bg-surface p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={review.authorName} size={40} tone="neutral" />
                  <div className="flex flex-1 flex-col">
                    <span className="text-base font-semibold">{review.authorName}</span>
                    <span className="text-sm text-neutral-600">
                      {formatRelative(review.createdAt)}
                    </span>
                  </div>
                  <RatingStars value={review.rating} size={13} />
                </div>
                <p className="text-base">{review.body}</p>
                {review.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {review.tags.map((tag) => (
                      <Chip key={tag} tone="sage">
                        {tag}
                      </Chip>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </AsyncList>
    </Screen>
  )
}

/** Form tulis ulasan — pemilih bintang + isi, divalidasi di server. */
function ReviewForm({ venueId, onDone }: { venueId: string | undefined; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState(0)
  const [body, setBody] = useState('')
  const write = useWriteReview(venueId)

  if (!open) {
    return (
      <Button variant="secondary" block onClick={() => setOpen(true)}>
        <Icon icon={PenLine} size={16} />
        Tulis ulasan
      </Button>
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    write.mutate(
      { rating, body },
      {
        onSuccess: () => {
          setOpen(false)
          setRating(0)
          setBody('')
          onDone()
        },
      },
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-lg bg-surface p-4">
      <h2 className="text-xl">Tulis ulasan</h2>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-base text-neutral-700">Berapa bintang?</legend>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`${n} bintang`}
              aria-pressed={rating === n}
              onClick={() => setRating(n)}
              className="flex h-11 w-11 items-center justify-center rounded-pill"
            >
              <Star
                size={26}
                strokeWidth={2.75}
                className={n <= rating ? 'fill-accent text-accent' : 'text-neutral-400'}
              />
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="review-body" className="text-base text-neutral-700">
          Ceritakan pengalamanmu
        </label>
        <textarea
          id="review-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder="Lapangannya gimana? Fasilitasnya? Parkirnya?"
          className="rounded-md border border-divider bg-bg px-4 py-3 text-base placeholder:text-neutral-600 focus:outline-none"
        />
      </div>

      {write.error && (
        <p role="alert" className="text-base text-accent-700">
          {write.error.message}
        </p>
      )}

      <div className="flex gap-3">
        <Button variant="secondary" block onClick={() => setOpen(false)}>
          Batal
        </Button>
        <Button type="submit" block disabled={rating === 0 || write.isPending}>
          {write.isPending ? 'Mengirim…' : 'Kirim'}
        </Button>
      </div>
    </form>
  )
}

function SummaryPanel({ summary }: { summary: ReviewSummary }) {
  return (
    <section className="flex gap-5 rounded-lg bg-surface p-5">
      <div className="flex flex-col items-center gap-1.5">
        <span className="font-heading text-4xl">
          {summary.average.toFixed(1).replace('.', ',')}
        </span>
        <RatingStars value={summary.average} size={13} />
        <span className="text-sm text-neutral-600">{summary.total} ulasan</span>
      </div>

      {/* Distribusi bintang, 5 di atas. */}
      <ul className="flex flex-1 flex-col justify-center gap-1.5">
        {[5, 4, 3, 2, 1].map((star) => {
          const count = summary.distribution[star - 1] ?? 0
          const ratio = summary.total === 0 ? 0 : count / summary.total
          return (
            <li key={star} className="flex items-center gap-2.5">
              <span className="w-3 text-sm text-neutral-700">{star}</span>
              <span className="flex-1">
                <ProgressBar
                  ratio={ratio}
                  tone="accent"
                  label={`${star} bintang: ${count} ulasan`}
                />
              </span>
              <span className="w-6 text-right text-sm text-neutral-600">{count}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
