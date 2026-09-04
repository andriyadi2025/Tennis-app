/**
 * Gerbang pembayaran di balik satu antarmuka.
 *
 * Polanya sama dengan saluran SMS dan email: kalau kredensialnya tidak diisi,
 * yang dipakai adalah **simulator** — dan simulator itu mengatakan dirinya
 * simulator, bukan berpura-pura jadi Midtrans. Yang tidak boleh terjadi
 * adalah app mengaku "sudah dibayar" padahal tidak ada uang yang berpindah
 * ke mana pun.
 *
 * Dua hal yang menentukan benar-tidaknya integrasi ini, dan keduanya ada di
 * sisi server:
 *
 * 1. **Jumlahnya dihitung dari catatan, bukan dari permintaan.** Klien cuma
 *    menyebut apa yang mau dibayar; berapa besarnya ditentukan booking atau
 *    pesanan yang tersimpan. Menerima angka dari klien berarti menerima
 *    tagihan seratus rupiah untuk lapangan dua ratus ribu.
 *
 * 2. **Yang menyatakan lunas adalah penyedia, lewat webhook bertanda tangan.**
 *    Bukan klien yang kembali dari halaman pembayaran — halaman itu bisa
 *    dibuka langsung oleh siapa saja.
 */

export type PaymentKind = 'booking' | 'merch' | 'dues'

export type PaymentStatus = 'pending' | 'settled' | 'expired' | 'failed'

export interface ChargeRequest {
  /** Id pembayaran di sisi kita — dipakai penyedia sebagai order id. */
  paymentId: string
  amountIdr: number
  /** Cara bayar yang dipilih; penyedia boleh mempersempitnya. */
  method: string
  customer: { id: string; name: string; email: string | null; phone: string | null }
  description: string
  expiresAt: string
}

export interface ChargeResult {
  /** Acuan di sisi penyedia, untuk mencocokkan webhook. */
  reference: string
  /** Halaman pembayaran penyedia, kalau alurnya lewat redirect. */
  redirectUrl: string | null
  /** Muatan QRIS mentah, kalau penyedia mengembalikannya. */
  qrString: string | null
  /** Nomor virtual account, kalau metodenya VA. */
  virtualAccount: string | null
  /** Saluran yang benar-benar dipakai — `simulator` bukan penyedia sungguhan. */
  channel: 'midtrans' | 'simulator'
}

export interface WebhookEvent {
  paymentId: string
  reference: string
  status: PaymentStatus
  /** Jumlah yang dilaporkan penyedia, untuk dicocokkan dengan catatan kita. */
  amountIdr: number
  raw: unknown
}

export interface PaymentProvider {
  readonly name: 'midtrans' | 'simulator'
  charge(request: ChargeRequest): Promise<ChargeResult>
  /**
   * Memeriksa tanda tangan lalu menerjemahkan muatan webhook.
   *
   * Mengembalikan `null` kalau tanda tangannya tidak cocok. Bukan melempar:
   * webhook yang tidak sah adalah keadaan yang diharapkan — siapa pun bisa
   * mengirim POST ke endpoint publik — dan bukan kesalahan program.
   */
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookEvent | null
}
