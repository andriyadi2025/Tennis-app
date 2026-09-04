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
  /** Menentukan kegiatannya tercatat sebagai Bermain atau Berlatih. */
  purpose: BookingPurpose
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

export type Role = 'member' | 'admin'

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
  /** Hanya `admin` yang boleh membuka dasbor pengaturan klub. */
  role: Role
  /** Anggota berbayar dapat potongan tarif sewa. */
  isMember: boolean
}

/* ── Pengaturan klub ──────────────────────────────────────────────────────
 * Nilai-nilai yang dulu ditanam di kode — jam buka, tarif, jendela prime
 * time — sekarang tinggal di sini supaya admin klub bisa mengubahnya sendiri
 * tanpa perlu rilis baru.
 * ─────────────────────────────────────────────────────────────────────── */

export interface PrimeTime {
  /** Jam mulai prime time, 0–23. */
  from: number
  /** Jam terakhir yang masih prime time, 0–23 (inklusif). */
  to: number
  /** Pengali tarif; 1.2 berarti +20%. */
  multiplier: number
}

export interface MembershipSettings {
  /** Iuran keanggotaan per bulan. */
  duesMonthlyIdr: number
  /** Potongan tarif sewa untuk anggota, 0–0.9. */
  memberDiscount: number
}

/** Profil dan aturan harga lapangan milik klub sendiri. */
export interface ClubSettings {
  venueId: string
  name: string
  address: string
  district: string
  openHours: OpenHours
  /** Tarif dasar per jam; tiap lapangan boleh menimpanya sendiri. */
  basePricePerHourIdr: number
  serviceFeeIdr: number
  primeTime: PrimeTime
  membership: MembershipSettings
  /** Poin partisipasi per jenis kegiatan. */
  activityPoints: ActivityPoints
}

/** Lapangan seperti yang diisi admin — belum punya id sampai disimpan. */
export interface CourtDraft {
  name: string
  sport: Sport
  indoor: boolean
  surface: string
  /** Kosong berarti ikut tarif dasar klub. */
  pricePerHourIdr: number | null
}

/* ── Catatan aktivitas ────────────────────────────────────────────────────
 * Empat jenis kegiatan yang dicatat klub. Catatannya **diturunkan** dari
 * data yang sudah ada — booking lunas, open match yang diikuti, pendaftaran
 * turnamen, ajakan sparring yang diterima — bukan ditulis terpisah. Satu
 * sumber kebenaran berarti tidak ada catatan yang bisa menyimpang dari
 * kejadiannya.
 * ─────────────────────────────────────────────────────────────────────── */

export type ActivityKind = 'bermain' | 'berlatih' | 'mainBersama' | 'lomba'

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  bermain: 'Bermain',
  berlatih: 'Berlatih',
  mainBersama: 'Main bersama',
  lomba: 'Lomba',
}

/** Dari mana catatan ini berasal; dipakai supaya tidak tercatat dua kali. */
export type ActivitySource = 'booking' | 'openMatch' | 'tournament' | 'sparring'

export interface Activity {
  /** `sumber:id` — stabil, jadi poinnya tidak pernah dikreditkan dobel. */
  id: string
  kind: ActivityKind
  source: ActivitySource
  sourceId: string
  title: string
  sport: Sport
  occurredAt: string
  venueName: string | null
  /** Nama orang atau tim yang ikut, kalau ada. */
  withNames: string[]
  /** Poin partisipasi untuk jenis ini saat kegiatannya tercatat. */
  pointsEarned: number
}

/** Ringkasan per jenis untuk ditampilkan di profil. */
export type ActivityTally = Record<ActivityKind, number>

/** Poin partisipasi per jenis kegiatan — diatur admin. */
export type ActivityPoints = Record<ActivityKind, number>

/** Tujuan sebuah booking: main biasa atau latihan. */
export type BookingPurpose = 'bermain' | 'berlatih'

export const PURPOSE_LABEL: Record<BookingPurpose, string> = {
  bermain: 'Main biasa',
  berlatih: 'Latihan',
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

/* ── Toko merchandise ─────────────────────────────────────────────────────
 * Barang klub bisa dibeli dengan uang, ditukar dengan poin, atau keduanya —
 * admin yang menentukan per barang. Harga poin **tidak** diturunkan dari
 * harga rupiah: kaus Rp250.000 boleh saja ditebus 1.500 poin kalau klub mau
 * memurahkannya untuk anggota setia. Menurunkannya otomatis akan memaksa
 * satu kurs untuk seluruh katalog.
 * ─────────────────────────────────────────────────────────────────────── */

export type MerchCategory = 'apparel' | 'perlengkapan' | 'aksesori' | 'konsumsi'

export const MERCH_CATEGORY_LABEL: Record<MerchCategory, string> = {
  apparel: 'Apparel',
  perlengkapan: 'Perlengkapan',
  aksesori: 'Aksesori',
  konsumsi: 'Konsumsi',
}

/**
 * Ukuran atau warna. Stok tinggal di sini, bukan juga di barang: dua tempat
 * menyimpan stok akan menyimpang begitu satu varian terjual.
 */
export interface MerchVariant {
  id: string
  /** "M", "Merah", atau "Satu ukuran" untuk barang tanpa pilihan. */
  label: string
  stock: number
}

export interface MerchItem {
  id: string
  name: string
  category: MerchCategory
  description: string
  photo: PhotoBlock
  /** Harga rupiah; null berarti hanya bisa ditukar poin. */
  priceIdr: number | null
  /** Harga poin; null berarti hanya bisa dibeli dengan uang. */
  pricePoints: number | null
  variants: MerchVariant[]
  /** Sebagian barang hanya untuk anggota berbayar. */
  membersOnly: boolean
  /** Barang nonaktif hilang dari katalog tapi riwayat pesanannya tetap ada. */
  active: boolean
}

/** Barang seperti yang diisi admin — belum punya id sampai disimpan. */
export interface MerchItemDraft {
  name: string
  category: MerchCategory
  description: string
  priceIdr: number | null
  pricePoints: number | null
  variants: { label: string; stock: number }[]
  membersOnly: boolean
  active: boolean
}

/** Dibayar uang, atau ditebus poin. Bukan campuran keduanya. */
export type MerchPayMode = 'uang' | 'poin'

export const MERCH_PAY_LABEL: Record<MerchPayMode, string> = {
  uang: 'Bayar',
  poin: 'Tukar poin',
}

export type MerchOrderStatus = 'menunggu' | 'disiapkan' | 'siapDiambil' | 'selesai' | 'batal'

export const MERCH_STATUS_LABEL: Record<MerchOrderStatus, string> = {
  menunggu: 'Menunggu konfirmasi',
  disiapkan: 'Disiapkan',
  siapDiambil: 'Siap diambil',
  selesai: 'Selesai',
  batal: 'Dibatalkan',
}

export interface MerchOrder {
  id: string
  /** Kode ambil, ditunjukkan ke petugas klub. */
  code: string
  itemId: string
  /** Nama dan varian disalin: barang boleh berubah nama, pesanan lama tidak. */
  itemName: string
  variantId: string
  variantLabel: string
  qty: number
  payMode: MerchPayMode
  /** Terisi hanya kalau payMode `uang`. */
  paymentMethod: PaymentMethod | null
  /** Total rupiah; 0 kalau ditebus poin. */
  totalIdr: number
  /** Poin yang dipotong; 0 kalau dibayar uang. */
  pointsSpent: number
  /** Poin belanja yang didapat; 0 kalau ditebus poin. */
  pointsEarned: number
  status: MerchOrderStatus
  createdAt: string
}

/* ── Aduan & pesan ke admin ───────────────────────────────────────────────
 * Satu utas dipakai bersama: anggota menulis, admin membalas di utas yang
 * sama. Tidak ada kotak masuk terpisah — dua salinan percakapan yang sama
 * adalah cara tercepat membuat jawaban admin tidak pernah sampai.
 * ─────────────────────────────────────────────────────────────────────── */

export type ComplaintCategory =
  'lapangan' | 'kebersihan' | 'pembayaran' | 'pelayanan' | 'toko' | 'lainnya'

export const COMPLAINT_CATEGORY_LABEL: Record<ComplaintCategory, string> = {
  lapangan: 'Kondisi lapangan',
  kebersihan: 'Kebersihan & fasilitas',
  pembayaran: 'Pembayaran & poin',
  pelayanan: 'Pelayanan petugas',
  toko: 'Pesanan toko',
  lainnya: 'Lainnya',
}

/** `baru` belum dijawab siapa pun; `selesai` bisa terbuka lagi kalau dibalas. */
export type ComplaintStatus = 'baru' | 'diproses' | 'selesai'

export const COMPLAINT_STATUS_LABEL: Record<ComplaintStatus, string> = {
  baru: 'Baru',
  diproses: 'Diproses',
  selesai: 'Selesai',
}

export interface ComplaintMessage {
  id: string
  complaintId: string
  /** Peran penulis, bukan idnya — yang dilihat pembaca adalah "kamu" vs "klub". */
  authorRole: Role
  authorName: string
  body: string
  sentAt: string
}

export interface Complaint {
  id: string
  /** Kode aduan yang bisa disebut anggota saat menanyakan kabarnya. */
  code: string
  userId: string
  userName: string
  category: ComplaintCategory
  subject: string
  status: ComplaintStatus
  createdAt: string
  /** Waktu pesan terakhir — dasar urutan daftar. */
  updatedAt: string
  /** Booking atau pesanan toko yang diadukan, kalau ada. */
  relatedKind: 'booking' | 'merchOrder' | null
  relatedId: string | null
  relatedLabel: string | null
  messages: ComplaintMessage[]
}

export interface ComplaintDraft {
  category: ComplaintCategory
  subject: string
  body: string
  relatedKind: 'booking' | 'merchOrder' | null
  relatedId: string | null
}
