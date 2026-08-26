import { useParams } from 'react-router-dom'
import type { ReviewSummary } from '@/types'
import { useVenue, useVenueReviews } from '@/hooks/queries'
import { formatRelative } from '@/lib/dates'
import { Screen, ScreenHeader } from '@/components/layout/Screen'
import { Avatar, Chip, ProgressBar, RatingStars } from '@/components/ui/primitives'
import { AsyncList, EmptyState, RowSkeleton, SkeletonBlock } from '@/components/ui/states'

/** 11 · Ulasan — ringkasan rating + distribusi bintang. */
export function ReviewsScreen() {
  const { id } = useParams<{ id: string }>()
  const venue = useVenue(id)
  const reviews = useVenueReviews(id)

  return (
    <Screen>
      <ScreenHeader title={venue.data?.name ?? 'Ulasan'} />

      {reviews.isLoading ? (
        <SkeletonBlock className="h-36 w-full rounded-lg" />
      ) : reviews.data ? (
        <SummaryPanel summary={reviews.data.summary} />
      ) : null}

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
