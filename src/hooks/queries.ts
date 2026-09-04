import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AppNotification,
  Booking,
  ChatMessage,
  ChatThread,
  Activity,
  ActivityTally,
  BookingPurpose,
  ClubSettings,
  Complaint,
  ComplaintDraft,
  ComplaintStatus,
  Court,
  CourtDraft,
  MerchCategory,
  MerchItem,
  MerchItemDraft,
  MerchOrder,
  MerchOrderStatus,
  MerchPayMode,
  OpenMatch,
  PaymentMethod,
  Review,
  ReviewSummary,
  Slot,
  Sport,
  SparringInvite,
  Team,
  Tournament,
  TournamentRegistration,
  User,
  Venue,
} from '@/types'
import { apiDelete, apiGet, apiPatch, apiPost, qs } from '@/lib/api'
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
  memberships: ['memberships'] as const,
  registrations: ['tournament-registrations'] as const,
  sparring: ['sparring'] as const,
  activities: ['activities'] as const,
  settings: ['club-settings'] as const,
  adminCourts: ['admin-courts'] as const,
  chat: (id: string) => ['chat', id] as const,
  merch: (category: MerchCategory | null) => ['merch', category] as const,
  merchItem: (id: string) => ['merch', 'item', id] as const,
  merchOrders: ['merch-orders'] as const,
  adminMerch: ['admin-merch'] as const,
  adminMerchOrders: ['admin-merch-orders'] as const,
  complaints: ['complaints'] as const,
  complaint: (id: string) => ['complaint', id] as const,
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

/** Poin domain berubah lewat server tiruan, bukan di store auth. */
export function useAdjustPoints() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (delta: number) => apiPost<User>('/api/me/points', { delta }),
    onSuccess: (user) => client.setQueryData(queryKeys.me, user),
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
  purpose: BookingPurpose
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

export interface ActivityFeed {
  activities: Activity[]
  tally: ActivityTally
  matchesPlayed: number
  pointsFromActivities: number
}

/** Catatan aktivitas; membacanya juga mengkreditkan poin yang belum masuk. */
export function useActivities() {
  return useQuery({
    queryKey: queryKeys.activities,
    queryFn: ({ signal }) => apiGet<ActivityFeed>('/api/activities', signal),
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
      void client.invalidateQueries({ queryKey: queryKeys.activities })
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

export interface Memberships {
  teams: string[]
  tournaments: string[]
  openMatches: string[]
}

export function useMemberships() {
  return useQuery({
    queryKey: queryKeys.memberships,
    queryFn: ({ signal }) => apiGet<Memberships>('/api/memberships', signal),
  })
}

/** Gabung atau keluar dari open match. */
export function useJoinMatch(id: string | undefined) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (action: 'join' | 'leave') =>
      apiPost<OpenMatch>(`/api/open-matches/${id}/${action}`, {}),
    onSuccess: (match) => {
      client.setQueryData(queryKeys.openMatch(match.id), match)
      void client.invalidateQueries({ queryKey: ['open-matches'] })
      void client.invalidateQueries({ queryKey: queryKeys.memberships })
    },
  })
}

export function useMarkNotificationRead() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<AppNotification>(`/api/notifications/${id}/read`, {}),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.notifications })
    },
  })
}

export function useMarkAllNotificationsRead() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => apiPost<AppNotification[]>('/api/notifications/read-all', {}),
    onSuccess: (list) => {
      client.setQueryData(queryKeys.notifications, list)
    },
  })
}

export function useWriteReview(venueId: string | undefined) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { rating: number; body: string }) =>
      apiPost<Review>(`/api/venues/${venueId}/reviews`, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.reviews(venueId ?? '') })
      // Rating venue ikut berubah, jadi kartu dan detailnya sudah basi.
      void client.invalidateQueries({ queryKey: queryKeys.venue(venueId ?? '') })
      void client.invalidateQueries({ queryKey: ['venues'] })
    },
  })
}

export function useJoinTeam(id: string | undefined) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => apiPost<Team>(`/api/teams/${id}/join`, {}),
    onSuccess: (team) => {
      client.setQueryData(queryKeys.team(team.id), team)
      void client.invalidateQueries({ queryKey: queryKeys.teams })
      void client.invalidateQueries({ queryKey: queryKeys.memberships })
    },
  })
}

export function useRequestSparring(id: string | undefined) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (message?: string) => apiPost<SparringInvite>(`/api/teams/${id}/spar`, { message }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.notifications })
    },
  })
}

export interface RegisterResult {
  tournament: Tournament
  registration: TournamentRegistration
}

export function useRegisterTournament() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, method }: { id: string; method: PaymentMethod }) =>
      apiPost<RegisterResult>(`/api/tournaments/${id}/register`, { method }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.tournaments })
      void client.invalidateQueries({ queryKey: queryKeys.memberships })
      void client.invalidateQueries({ queryKey: queryKeys.registrations })
    },
  })
}

export function useRegistrations() {
  return useQuery({
    queryKey: queryKeys.registrations,
    queryFn: ({ signal }) =>
      apiGet<TournamentRegistration[]>('/api/tournaments/registrations', signal),
  })
}

export function useSparring() {
  return useQuery({
    queryKey: queryKeys.sparring,
    queryFn: ({ signal }) => apiGet<SparringInvite[]>('/api/sparring', signal),
  })
}

export function useRespondSparring() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      apiPost<SparringInvite>(`/api/sparring/${id}/respond`, { accept }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.sparring })
      void client.invalidateQueries({ queryKey: queryKeys.notifications })
    },
  })
}

/* ── Dasbor admin klub ─────────────────────────────────────────────────── */

export function useClubSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: ({ signal }) => apiGet<ClubSettings>('/api/admin/settings', signal),
  })
}

/** Menyimpan sebagian pengaturan; server tetap yang memvalidasi. */
export function useSaveClubSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<ClubSettings>) =>
      apiPatch<ClubSettings>('/api/admin/settings', patch),
    onSuccess: (settings) => {
      client.setQueryData(queryKeys.settings, settings)
      // Jam buka & tarif ikut mengubah venue klub, jadi grid slot sudah basi.
      void client.invalidateQueries({ queryKey: ['venue'] })
      void client.invalidateQueries({ queryKey: ['venues'] })
      void client.invalidateQueries({ queryKey: queryKeys.adminCourts })
    },
  })
}

export function useAdminCourts() {
  return useQuery({
    queryKey: queryKeys.adminCourts,
    queryFn: ({ signal }) => apiGet<Court[]>('/api/admin/courts', signal),
  })
}

function invalidateCourts(client: ReturnType<typeof useQueryClient>) {
  void client.invalidateQueries({ queryKey: queryKeys.adminCourts })
  void client.invalidateQueries({ queryKey: ['venue'] })
  void client.invalidateQueries({ queryKey: ['venues'] })
}

export function useAddCourt() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (draft: CourtDraft) => apiPost<Court[]>('/api/admin/courts', draft),
    onSuccess: () => invalidateCourts(client),
  })
}

export function useUpdateCourt() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: CourtDraft }) =>
      apiPatch<Court[]>(`/api/admin/courts/${id}`, draft),
    onSuccess: () => invalidateCourts(client),
  })
}

export function useDeleteCourt() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete<Court[]>(`/api/admin/courts/${id}`),
    onSuccess: () => invalidateCourts(client),
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

/* ── Toko merchandise ──────────────────────────────────────────────────── */

export function useMerch(category: MerchCategory | null) {
  return useQuery({
    queryKey: queryKeys.merch(category),
    queryFn: ({ signal }) => apiGet<MerchItem[]>(`/api/merch${qs({ category })}`, signal),
  })
}

export function useMerchItem(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.merchItem(id ?? ''),
    queryFn: ({ signal }) => apiGet<MerchItem>(`/api/merch/${id}`, signal),
    enabled: Boolean(id),
  })
}

export interface MerchOrderInput {
  variantId: string
  qty: number
  payMode: MerchPayMode
  paymentMethod?: PaymentMethod
}

/**
 * Memesan mengubah tiga hal sekaligus: stok barang, saldo poin, dan daftar
 * pesanan. Ketiganya dibatalkan cache-nya, kalau tidak layar akan memuji
 * pesanan berhasil sambil tetap menampilkan stok dan poin yang lama.
 */
export function useOrderMerch(itemId: string | undefined) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: MerchOrderInput) =>
      apiPost<MerchOrder>(`/api/merch/${itemId}/order`, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['merch'] })
      void client.invalidateQueries({ queryKey: queryKeys.merchOrders })
      void client.invalidateQueries({ queryKey: queryKeys.me })
    },
  })
}

export function useMerchOrders() {
  return useQuery({
    queryKey: queryKeys.merchOrders,
    queryFn: ({ signal }) => apiGet<MerchOrder[]>('/api/merch-orders', signal),
  })
}

export function useCancelMerchOrder() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<MerchOrder>(`/api/merch-orders/${id}/cancel`, {}),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['merch'] })
      void client.invalidateQueries({ queryKey: queryKeys.merchOrders })
      void client.invalidateQueries({ queryKey: queryKeys.me })
    },
  })
}

/* ── Toko: sisi admin ──────────────────────────────────────────────────── */

export function useAdminMerch() {
  return useQuery({
    queryKey: queryKeys.adminMerch,
    queryFn: ({ signal }) => apiGet<MerchItem[]>('/api/admin/merch', signal),
  })
}

function invalidateMerch(client: ReturnType<typeof useQueryClient>) {
  void client.invalidateQueries({ queryKey: queryKeys.adminMerch })
  void client.invalidateQueries({ queryKey: ['merch'] })
}

export function useAddMerchItem() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (draft: MerchItemDraft) => apiPost<MerchItem[]>('/api/admin/merch', draft),
    onSuccess: () => invalidateMerch(client),
  })
}

export function useUpdateMerchItem() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: MerchItemDraft }) =>
      apiPatch<MerchItem[]>(`/api/admin/merch/${id}`, draft),
    onSuccess: () => invalidateMerch(client),
  })
}

export function useAdminMerchOrders() {
  return useQuery({
    queryKey: queryKeys.adminMerchOrders,
    queryFn: ({ signal }) => apiGet<MerchOrder[]>('/api/admin/merch-orders', signal),
  })
}

export function useSetMerchOrderStatus() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: MerchOrderStatus }) =>
      apiPatch<MerchOrder[]>(`/api/admin/merch-orders/${id}`, { status }),
    onSuccess: (orders) => {
      client.setQueryData(queryKeys.adminMerchOrders, orders)
      void client.invalidateQueries({ queryKey: queryKeys.merchOrders })
      // Membatalkan mengembalikan stok dan poin — keduanya jadi basi.
      void client.invalidateQueries({ queryKey: ['merch'] })
      void client.invalidateQueries({ queryKey: queryKeys.me })
    },
  })
}

/* ── Aduan & pesan ke admin ────────────────────────────────────────────── */

export function useComplaints() {
  return useQuery({
    queryKey: queryKeys.complaints,
    queryFn: ({ signal }) => apiGet<Complaint[]>('/api/complaints', signal),
  })
}

export function useComplaint(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.complaint(id ?? ''),
    queryFn: ({ signal }) => apiGet<Complaint>(`/api/complaints/${id}`, signal),
    enabled: Boolean(id),
  })
}

export function useCreateComplaint() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (draft: ComplaintDraft & { body: string }) =>
      apiPost<Complaint>('/api/complaints', draft),
    onSuccess: (complaint) => {
      client.setQueryData(queryKeys.complaint(complaint.id), complaint)
      void client.invalidateQueries({ queryKey: queryKeys.complaints })
    },
  })
}

/** Balasan dari sisi mana pun — server yang menentukan perannya. */
export function useReplyComplaint(id: string | undefined) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => apiPost<Complaint>(`/api/complaints/${id}/messages`, { body }),
    onSuccess: (complaint) => {
      client.setQueryData(queryKeys.complaint(complaint.id), complaint)
      void client.invalidateQueries({ queryKey: queryKeys.complaints })
    },
  })
}

export function useSetComplaintStatus(id: string | undefined) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (status: ComplaintStatus) =>
      apiPatch<Complaint>(`/api/complaints/${id}/status`, { status }),
    onSuccess: (complaint) => {
      client.setQueryData(queryKeys.complaint(complaint.id), complaint)
      void client.invalidateQueries({ queryKey: queryKeys.complaints })
    },
  })
}
