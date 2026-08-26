import { Banknote, Building2, CreditCard, QrCode, Smartphone } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { PaymentMethod } from '@/types'

export interface PaymentMethodOption {
  id: PaymentMethod
  icon: LucideIcon
  note: string
}

/**
 * Daftar metode pembayaran, dipakai layar pembayaran booking dan pendaftaran
 * turnamen. Satu sumber supaya keduanya tidak perlahan berbeda.
 */
export const PAYMENT_METHODS: PaymentMethodOption[] = [
  { id: 'qris', icon: QrCode, note: 'Scan pakai app bank atau e-wallet apa pun' },
  { id: 'ewallet', icon: Smartphone, note: 'GoPay, OVO, DANA, ShopeePay' },
  { id: 'va', icon: Building2, note: 'BCA, Mandiri, BNI, BRI' },
  { id: 'card', icon: CreditCard, note: 'Visa, Mastercard' },
  { id: 'onsite', icon: Banknote, note: 'Bayar tunai saat datang' },
]
