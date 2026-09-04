import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type {
  ChargeRequest,
  ChargeResult,
  PaymentProvider,
  PaymentStatus,
  WebhookEvent,
} from './provider.ts'

/**
 * Penyedia tiruan untuk pengembangan, dipakai saat kredensial Midtrans belum
 * diisi.
 *
 * Ia **mengatakan dirinya simulator** — hasil charge menyebut
 * `channel: 'simulator'`, dan layar menampilkannya apa adanya. Yang tidak
 * boleh terjadi adalah app mengaku sudah menerima uang padahal tidak ada
 * gerbang di baliknya.
 *
 * Alurnya tetap alur sungguhan: charge → webhook bertanda tangan → lunas.
 * Webhook-nya ditandatangani HMAC seperti penyedia asli, jadi jalur
 * verifikasi yang dipakai produksi ikut terjalani setiap hari — bukan cabang
 * kode yang baru pertama kali berjalan saat rilis.
 */
export class SimulatorProvider implements PaymentProvider {
  readonly name = 'simulator' as const
  readonly #secret: string

  constructor(secret: string) {
    this.#secret = secret
  }

  /** Tanda tangan yang sama dipakai saat membuat dan memeriksa webhook. */
  sign(paymentId: string, status: PaymentStatus, amountIdr: number): string {
    return createHmac('sha256', this.#secret)
      .update(`${paymentId}|${status}|${Math.round(amountIdr)}`)
      .digest('hex')
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    const reference = `sim-${randomUUID().slice(0, 12)}`
    return {
      reference,
      redirectUrl: null,
      /*
       * Muatan QR-nya sengaja bukan format QRIS sungguhan. QR yang tampak sah
       * tapi tidak bisa dibayar adalah kebohongan yang paling meyakinkan;
       * yang ini jelas-jelas menyebut dirinya simulasi.
       */
      qrString: `SIMULASI-DBTC|${request.paymentId}|${Math.round(request.amountIdr)}`,
      virtualAccount: null,
      channel: 'simulator',
    }
  }

  verifyWebhook(
    rawBody: string,
    _headers: Record<string, string | undefined>,
  ): WebhookEvent | null {
    let body: {
      paymentId?: string
      reference?: string
      status?: PaymentStatus
      amountIdr?: number
      signature?: string
    }
    try {
      body = JSON.parse(rawBody) as typeof body
    } catch {
      return null
    }

    const { paymentId, status, amountIdr, signature } = body
    if (!paymentId || !status || typeof amountIdr !== 'number' || !signature) return null
    if (!['pending', 'settled', 'expired', 'failed'].includes(status)) return null

    const expected = this.sign(paymentId, status, amountIdr)
    const given = Buffer.from(signature, 'utf8')
    const mine = Buffer.from(expected, 'utf8')
    if (given.length !== mine.length || !timingSafeEqual(given, mine)) return null

    return {
      paymentId,
      reference: body.reference ?? paymentId,
      status,
      amountIdr: Math.round(amountIdr),
      raw: body,
    }
  }
}
