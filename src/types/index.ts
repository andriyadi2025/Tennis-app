/** Cabang olahraga yang didukung DBTC. */
export type Sport =
  'badminton' | 'futsal' | 'basketball' | 'tennis' | 'padel' | 'volleyball' | 'miniSoccer'

export const SPORTS: readonly Sport[] = [
  'badminton',
  'futsal',
  'basketball',
  'tennis',
  'padel',
  'volleyball',
  'miniSoccer',
] as const

/** Label Bahasa Indonesia untuk tiap cabang. */
export const SPORT_LABEL: Record<Sport, string> = {
  badminton: 'Badminton',
  futsal: 'Futsal',
  basketball: 'Basket',
  tennis: 'Tenis',
  padel: 'Padel',
  volleyball: 'Voli',
  miniSoccer: 'Mini Soccer',
}

export interface GeoPoint {
  lat: number
  lng: number
}

/**
 * Placeholder foto venue. Brief melarang ilustrasi SVG kompleks: tiap foto
 * diwakili blok warna beraksen + bentuk bulat dekoratif.
 */
export interface PhotoBlock {
  /** Token ramp yang dipakai sebagai warna blok. */
  tone: 'accent' | 'accent2' | 'neutral'
  /** Step ramp (200–400) supaya kontras teks tetap aman. */
  step: 200 | 300 | 400
  /** Seed penempatan bentuk bulat dekoratif — deterministik, bukan acak. */
  seed: number
}

export type Facility =
  'parkir' | 'toilet' | 'ruangGanti' | 'kantin' | 'wifi' | 'musholla' | 'ac' | 'tribun' | 'sewaAlat'

export const FACILITY_LABEL: Record<Facility, string> = {
  parkir: 'Parkir luas',
  toilet: 'Toilet',
  ruangGanti: 'Ruang ganti',
  kantin: 'Kantin',
  wifi: 'WiFi',
  musholla: 'Musholla',
  ac: 'AC',
  tribun: 'Tribun',
  sewaAlat: 'Sewa alat',
}

export interface Court {
  id: string
  venueId: string
  /** "Lap. 3" */
  name: string
  sport: Sport
  indoor: boolean
  surface: string
  /** Override harga venue kalau lapangan ini beda tarif. */
  pricePerHourIdr?: number
}

export interface OpenHours {
  /** Jam buka, 0–23. */
  open: number
  /** Jam tutup eksklusif, 1–24. */
  close: number
}

export interface Venue {
  id: string
  name: string
  sport: Sport[]
  address: string
  district: string
  geo: GeoPoint
  rating: number
  reviewCount: number
  photos: PhotoBlock[]
  facilities: Facility[]
  courts: Court[]
  pricePerHourIdr: number
  openHours: OpenHours
  indoor: boolean
  /** Jarak dari lokasi user, km. Disajikan server (mock) — bukan dihitung klien. */
  distanceKm: number
}

export type SlotStatus = 'available' | 'selected' | 'booked'

export interface Slot {
  courtId: string
  /** ISO 8601, awal jam. Slot selalu berdurasi 1 jam. */
  startsAt: string
  status: SlotStatus
  priceIdr: number
}

export interface Recurrence {
  /** Ulangi mingguan pada hari yang sama. */
  weekly: true
  /** Termasuk minggu pertama (booking aslinya). */
  weeks: number
}

export interface AddOn {
  id: string
  label: string
  priceIdr: number
  qty: number
}

export interface SplitParticipant {
  id: string
  name: string
  /** Host menanggung sisa pembulatan. */
  isHost: boolean
}

export interface SplitBill {
  participants: SplitParticipant[]
  /** Nominal dasar per orang (hasil pembagian ke bawah). */
  amountPerPersonIdr: number
  /** Sisa pembulatan, selalu ditanggung host. */
  hostRemainderIdr: number
  /** Id peserta yang sudah bayar. */
  paidBy: string[]
}

export type PaymentMethod = 'qris' | 'ewallet' | 'va' | 'card' | 'onsite'

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  qris: 'QRIS',
  ewallet: 'E-wallet',
  va: 'Virtual Account',
  card: 'Kartu debit/kredit',
  onsite: 'Bayar di tempat',
}

export type BookingStatus = 'draft' | 'summary' | 'awaitingPayment' | 'confirmed' | 'expired'

export interface BookingRange {
  /** ISO 8601 awal slot pertama. */
  startsAt: string
  /** ISO 8601 akhir slot terakhir (eksklusif). */
  endsAt: string
  /** Jumlah slot 1 jam. */
  hours: number
}

export interface Booking {
  id: string
  venueId: string
  venueName: string
  courtId: string
  courtName: string
  sport: Sport
  range: BookingRange
  recurrence: Recurrence | null
  addOns: AddOn[]
  splitBill: SplitBill | null
  status: BookingStatus
  paymentMethod: PaymentMethod | null
  /** Kode tiket, dipakai membangkitkan QR. */
  code: string
  subtotalIdr: number
  /** Potongan dari penukaran poin. */
  pointsRedeemed: number
  discountIdr: number
  serviceFeeIdr: number
  totalIdr: number
  createdAt: string
  /** Batas waktu bayar (ISO) — hold 10 menit. */
  paymentDeadline: string | null
}

export interface OpenMatchPlayer {
  id: string
  name: string
  level: SkillLevel
}

export type SkillLevel = 'pemula' | 'menengah' | 'mahir'

export const LEVEL_LABEL: Record<SkillLevel, string> = {
  pemula: 'Pemula',
  menengah: 'Menengah',
  mahir: 'Mahir',
}

export interface OpenMatch {
  id: string
  title: string
  sport: Sport
  venueId: string
  venueName: string
  district: string
  startsAt: string
  hours: number
  level: SkillLevel
  pricePerPersonIdr: number
  slotsTotal: number
  players: OpenMatchPlayer[]
  hostName: string
  note: string
  chatId: string
}

export interface Team {
  id: string
  name: string
  sport: Sport
  city: string
  memberCount: number
  members: OpenMatchPlayer[]
  wins: number
  losses: number
  photo: PhotoBlock
  about: string
}

export type TournamentStatus = 'pendaftaran' | 'berlangsung' | 'selesai'

export interface Tournament {
  id: string
  name: string
  sport: Sport
  venueName: string
  city: string
  startsAt: string
  endsAt: string
  entryFeeIdr: number
  prizePoolIdr: number
  slotsTotal: number
  slotsTaken: number
  status: TournamentStatus
  photo: PhotoBlock
}

export interface Review {
  id: string
  venueId: string
  authorName: string
  rating: number
  createdAt: string
  body: string
  /** Tag singkat, mis. "lapangan bersih". */
  tags: string[]
}

export interface ReviewSummary {
  average: number
  total: number
  /** Jumlah ulasan per bintang, indeks 0 = 1 bintang. */
  distribution: [number, number, number, number, number]
}

export type NotificationKind = 'booking' | 'payment' | 'match' | 'promo' | 'community'

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  body: string
  createdAt: string
  read: boolean
  /** Rute tujuan saat diketuk. */
  href: string | null
}

export type LoyaltyTier = 'Rookie' | 'Reguler' | 'Pro' | 'Legend'

export interface User {
  id: string
  name: string
  phone: string
  email: string
  points: number
  tier: LoyaltyTier
  joinedAt: string
  favouriteSport: Sport
  matchesPlayed: number
}

export type SparringStatus = 'menunggu' | 'diterima' | 'ditolak'

/**
 * Ajakan sparring antar tim. Arahnya dicatat eksplisit: `masuk` perlu jawaban
 * dari user, `keluar` sedang menunggu jawaban tim lain.
 */
export interface SparringInvite {
  id: string
  direction: 'masuk' | 'keluar'
  fromTeamId: string
  fromTeamName: string
  toTeamId: string
  toTeamName: string
  sport: Sport
  /** Usulan waktu main; boleh belum ditentukan. */
  proposedAt: string | null
  venueName: string | null
  message: string
  status: SparringStatus
  createdAt: string
}

export type TournamentPaymentStatus = 'lunas' | 'menunggu'

export interface TournamentRegistration {
  id: string
  tournamentId: string
  tournamentName: string
  entryFeeIdr: number
  paymentMethod: PaymentMethod
  paymentStatus: TournamentPaymentStatus
  registeredAt: string
  code: string
}

/** Preferensi yang bisa diubah user di layar Pengaturan. */
export interface Preferences {
  /** Notifikasi per jenis — mematikan salah satu menyembunyikannya dari daftar. */
  notify: Record<NotificationKind, boolean>
  /** Kota/area yang dipakai Home dan pencarian. */
  area: string
  /** Radius bawaan pencarian, km. */
  defaultRadiusKm: number
  /** Mengurangi animasi di luar setelan sistem. */
  reduceMotion: boolean
}

export const AREAS = [
  'Bandung Utara',
  'Bandung Tengah',
  'Bandung Selatan',
  'Bandung Timur',
] as const

export interface ChatMessage {
  id: string
  chatId: string
  authorId: string
  authorName: string
  body: string
  sentAt: string
  /** Pesan sistem berisi kartu split bill. */
  splitCardBookingId?: string
}

export interface ChatThread {
  id: string
  title: string
  subtitle: string
  bookingId: string | null
  messages: ChatMessage[]
}
