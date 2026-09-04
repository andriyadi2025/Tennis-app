import { config } from '../config.ts'
import { MidtransProvider } from './midtrans.ts'
import { SimulatorProvider } from './simulator.ts'
import type { PaymentProvider } from './provider.ts'

export type {
  ChargeRequest,
  ChargeResult,
  PaymentKind,
  PaymentProvider,
  PaymentStatus,
  WebhookEvent,
} from './provider.ts'
export { MidtransProvider } from './midtrans.ts'
export { SimulatorProvider } from './simulator.ts'

/**
 * Penyedia dipilih dari konfigurasi, bukan dari flag terpisah: kalau kunci
 * Midtrans ada, Midtrans; kalau tidak, simulator yang menyebut dirinya
 * simulator.
 */
let cached: PaymentProvider | null = null

export function paymentProvider(): PaymentProvider {
  if (cached) return cached
  const { serverKey, clientKey, production } = config.midtrans
  cached =
    serverKey && clientKey
      ? new MidtransProvider({ serverKey, clientKey, production })
      : // Pepper sesi dipakai ulang sebagai kunci tanda tangan simulator: ia
        // sudah acak, sudah wajib diganti di produksi, dan simulator tidak
        // pernah aktif di produksi.
        new SimulatorProvider(config.tokenPepper)
  return cached
}

/** Hanya untuk tes: memaksa penyedia tertentu. */
export function setPaymentProvider(provider: PaymentProvider | null): void {
  cached = provider
}

export function paymentsConfigured(): boolean {
  return Boolean(config.midtrans.serverKey && config.midtrans.clientKey)
}
