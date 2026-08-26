import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AppNotification,
  Booking,
  ChatMessage,
  ChatThread,
  OpenMatch,
  PaymentMethod,
  Review,
  ReviewSummary,
  Slot,
  Sport,
  Team,
  Tournament,
  User,
  Venue,
} from '@/types'
import { apiGet, apiPost, qs } from '@/lib/api'
import { dayKey } from '@/lib/dates'

export const queryKeys = {
  me: ['me'] as const,
  venues: (params: VenueSearchParams) => ['venues', params] as const,
  venue: (id: string) => ['venue', id] as const,
  reviews: (id: string) => ['venue', id, 'reviews'] as const,
  slots: (venueId: string, courtId: string, date: string) =>
    ['venue', venueId, 'slots', courtId, date] as const,
  addOns: ['addons'] as const,
  bookings: ['bookings'] as const,
  booking: (id: string) => ['booking', id] as const,
  openMatches: (sport: Sport | null) => ['open-matches', sport] as const,
  openMatch: (id: string) => ['open-match', id] as const,
  tournaments: ['tournaments'] as const,
  teams: ['teams'] as const,
  team: (id: string) => ['team', id] as const,
  notifications: ['notifications'] as const,
  chat: (id: string) => ['chat', id] as const,
}

export interface VenueSearchParams {
  q: string
  sport: Sport | null
  minPrice: number
  maxPrice: number
  maxDistance: number
  indoorOnly: boolean
}

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => apiGet<User>('/api/me', signal),
    staleTime: 5 * 60_000,
  })
}

export function useVenues(params: VenueSearchParams) {
  return useQuery({
    queryKey: queryKeys.venues(params),
    queryFn: ({ signal }) =>
      apiGet<Venue[]>(
        `/api/venues${qs({
          q: params.q,
          sport: params.sport,
          minPrice: params.minPrice,
          maxPrice: params.maxPrice,
          maxDistance: params.maxDistance,
          indoor: params.indoorOnly ? '1' : '',
        })}`,
        signal,
      ),
  })
}

export function useVenue(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.venue(id ?? ''),
    queryFn: ({ signal }) => apiGet<Venue>(`/api/venues/${id}`, signal),
    enabled: Boolean(id),
  })
}

export function useVenueReviews(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.reviews(id ?? ''),
    queryFn: ({ signal }) =>
      apiGet<{ reviews: Review[]; summary: ReviewSummary }>(`/api/venues/${id}/reviews`, signal),
    enabled: Boolean(id),
  })
}

export function useSlots(venueId: string | undefined, courtId: string | undefined, date: Date) {
  const key = dayKey(date)
  return useQuery({
    queryKey: queryKeys.slots(venueId ?? '', courtId ?? '', key),
    queryFn: ({ signal }) =>
      apiGet<Slot[]>(
        `/api/venues/${venueId}/slots${qs({ courtId: courtId ?? '', date: date.toISOString() })}`,
        signal,
      ),
    enabled: Boolean(venueId && courtId),
  })
}

export interface AddOnOption {
  id: string
  label: string
  priceIdr: number
}

export function useAddOns() {
  return useQuery({
    queryKey: queryKeys.addOns,
    queryFn: ({ signal }) => apiGet<AddOnOption[]>('/api/addons', signal),
    staleTime: Infinity,
  })
}

export interface RecurrenceCheckInput {
  courtId: string
  startsAt: string[]
  weeks: number
}

export interface RecurrenceCheckResult {
  conflicts: { weekOffset: number; startsAt: string[] }[]
}

export function useRecurrenceCheck() {
  return useMutation({
    mutationFn: (input: RecurrenceCheckInput) =>
      apiPost<RecurrenceCheckResult>('/api/availability/check', input),
  })
}

export interface CreateBookingInput {
  venueId: string
  courtId: string
  startsAt: string[]
  recurrenceWeeks: number
  addOnIds: string[]
  pointsRedeemed: number
}

export function useCreateBooking() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateBookingInput) => apiPost<Booking>('/api/bookings', input),
    onSuccess: (booking) => {
      client.setQueryData(queryKeys.booking(booking.id), booking)
      void client.invalidateQueries({ queryKey: queryKeys.bookings })
    },
  })
}

export function useBookings() {
  return useQuery({
    queryKey: queryKeys.bookings,
    queryFn: ({ signal }) => apiGet<Booking[]>('/api/bookings', signal),
  })
}

export function useBooking(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.booking(id ?? ''),
    queryFn: ({ signal }) => apiGet<Booking>(`/api/bookings/${id}`, signal),
    enabled: Boolean(id),
  })
}

export function usePayBooking() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, method }: { id: string; method: PaymentMethod }) =>
      apiPost<Booking>(`/api/bookings/${id}/pay`, { method }),
    onSuccess: (booking) => {
      client.setQueryData(queryKeys.booking(booking.id), booking)
      void client.invalidateQueries({ queryKey: queryKeys.bookings })
      // Slot yang baru dikunci membuat semua grid slot basi.
      void client.invalidateQueries({ queryKey: ['venue'] })
    },
  })
}

export function useSaveSplitBill() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, splitBill }: { id: string; splitBill: Booking['splitBill'] }) =>
      apiPost<Booking>(`/api/bookings/${id}/split`, { splitBill }),
    onSuccess: (booking) => {
      client.setQueryData(queryKeys.booking(booking.id), booking)
      void client.invalidateQueries({ queryKey: queryKeys.bookings })
    },
  })
}

export function useOpenMatches(sport: Sport | null) {
  return useQuery({
    queryKey: queryKeys.openMatches(sport),
    queryFn: ({ signal }) => apiGet<OpenMatch[]>(`/api/open-matches${qs({ sport })}`, signal),
  })
}

export function useOpenMatch(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.openMatch(id ?? ''),
    queryFn: ({ signal }) => apiGet<OpenMatch>(`/api/open-matches/${id}`, signal),
    enabled: Boolean(id),
  })
}

export function useTournaments() {
  return useQuery({
    queryKey: queryKeys.tournaments,
    queryFn: ({ signal }) => apiGet<Tournament[]>('/api/tournaments', signal),
  })
}

export function useTeams() {
  return useQuery({
    queryKey: queryKeys.teams,
    queryFn: ({ signal }) => apiGet<Team[]>('/api/teams', signal),
  })
}

export function useTeam(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.team(id ?? ''),
    queryFn: ({ signal }) => apiGet<Team>(`/api/teams/${id}`, signal),
    enabled: Boolean(id),
  })
}

export function useNotifications() {
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: ({ signal }) => apiGet<AppNotification[]>('/api/notifications', signal),
  })
}

export function useChat(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.chat(id ?? ''),
    queryFn: ({ signal }) => apiGet<ChatThread>(`/api/chats/${id}`, signal),
    enabled: Boolean(id),
  })
}

export function useSendMessage(chatId: string | undefined) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => apiPost<ChatMessage>(`/api/chats/${chatId}/messages`, { body }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.chat(chatId ?? '') })
    },
  })
}
