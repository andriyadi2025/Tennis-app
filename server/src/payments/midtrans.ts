import { createHash, timingSafeEqual } from 'node:crypto'
import type {
  ChargeRequest,
  ChargeResult,
  PaymentProvider,
  PaymentStatus,
  WebhookEvent,
} from './provider.ts'

/**
 * Midtrans Snap — gerbang pembayaran yang lazim dipakai di Indonesia.
 *
 * Ditulis langsung tanpa SDK: yang dibutuhkan cuma dua panggilan HTTP dan
 * satu pemeriksaan tanda tangan, dan bagian yang paling sering salah justru
 * bukan pemanggilannya melainkan **verifikasi webhook** — yang di SDK mana
 * pun tetap harus ditulis sendiri.
 */

interface MidtransConfig {
  serverKey: string
  clientKey: string
  /** Sandbox saat mengembangkan; produksi hanya kalau sengaja dinyalakan. */
  production: boolean
}

/**
 * Status Midtrans dipetakan ke tiga keadaan yang app ini pedulikan.
 *
 * `capture` tanpa `fraud_status: accept` **tidak** dianggap lunas: transaksi
 * kartu yang tertahan pemeriksaan penipuan bisa dibatalkan belakangan, dan
 * mengonfirmasi booking atas dasar itu berarti mengunci lapangan untuk uang
 * yang belum tentu jadi.
 */
function mapStatus(raw: { transaction_status?: string; fraud_status?: string }): PaymentStatus {
  const status = raw.transaction_status
  if (status === 'settlement') return 'settled'
  if (status === 'capture') return raw.fraud_status === 'accept' ? 'settled' : 'pending'
  if (status === 'pending') return 'pending'
  if (status === 'expire') return 'expired'
  // deny, cancel, failure, refund, chargeback — semuanya berarti tidak jadi.
  return 'failed'
}

export class MidtransProvider implements PaymentProvider {
  readonly name = 'midtrans' as const
  readonly #config: MidtransConfig

  constructor(config: MidtransConfig) {
    this.#config = config
  }

  get #snapUrl(): string {
    return this.#config.production
      ? 'https://app.midtrans.com/snap/v1/transactions'
      : 'https://app.sandbox.midtrans.com/snap/v1/transactions'
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    const auth = Buffer.from(`${this.#config.serverKey}:`).toString('base64')

    const response = await fetch(this.#snapUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        transaction_details: {
          order_id: request.paymentId,
          // Midtrans menolak pecahan; rupiah memang tidak pernah berkoma.
          gross_amount: Math.round(request.amountIdr),
        },
        customer_details: {
          first_name: request.customer.name,
          email: request.customer.email ?? undefined,
          phone: request.customer.phone ?? undefined,
        },
        item_details: [
          {
            id: request.paymentId,
            price: Math.round(request.amountIdr),
            quantity: 1,
            name: request.description.slice(0, 50),
          },
        ],
        expiry: {
          unit: 'minute',
          duration: Math.max(
            1,
            Math.round((new Date(request.expiresAt).getTime() - Date.now()) / 60_000),
          ),
        },
      }),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Midtrans menolak permintaan (${response.status}): ${detail.slice(0, 200)}`)
    }

    const body = (await response.json()) as { token?: string; redirect_url?: string }
    if (!body.redirect_url) throw new Error('Midtrans tidak mengembalikan URL pembayaran.')

    return {
      reference: body.token ?? request.paymentId,
      redirectUrl: body.redirect_url,
      qrString: null,
      virtualAccount: null,
      channel: 'midtrans',
    }
  }

  /**
   * Tanda tangan Midtrans: SHA-512 dari
   * `order_id + status_code + gross_amount + server_key`.
   *
   * Dibandingkan dengan `timingSafeEqual`, bukan `===`. Perbandingan string
   * biasa berhenti di karakter pertama yang berbeda, dan selisih waktunya
   * cukup untuk menebak tanda tangan satu karakter demi satu karakter.
   */
  verifyWebhook(
    rawBody: string,
    _headers: Record<string, string | undefined>,
  ): WebhookEvent | null {
    let body: {
      order_id?: string
      status_code?: string
      gross_amount?: string
      signature_key?: string
      transaction_id?: string
      transaction_status?: string
      fraud_status?: string
    }
    try {
      body = JSON.parse(rawBody) as typeof body
    } catch {
      return null
    }

    const { order_id: orderId, status_code: statusCode, gross_amount: gross } = body
    if (!orderId || !statusCode || !gross || !body.signature_key) return null

    const expected = createHash('sha512')
      .update(`${orderId}${statusCode}${gross}${this.#config.serverKey}`)
      .digest('hex')

    const given = Buffer.from(body.signature_key, 'utf8')
    const mine = Buffer.from(expected, 'utf8')
    if (given.length !== mine.length || !timingSafeEqual(given, mine)) return null

    return {
      paymentId: orderId,
      reference: body.transaction_id ?? orderId,
      status: mapStatus(body),
      amountIdr: Math.round(Number(gross)),
      raw: body,
    }
  }
}
