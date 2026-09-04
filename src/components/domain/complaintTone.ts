import type { ComplaintStatus } from '@/types'

/**
 * Warna chip per status aduan. Ditaruh terpisah dari komponennya mengikuti
 * pola `paymentMethods.ts`: konstanta yang dipakai beberapa layar tidak
 * tinggal di file komponen, supaya hot reload tetap bekerja.
 */
export const COMPLAINT_STATUS_TONE: Record<ComplaintStatus, 'accent' | 'sage' | 'neutral'> = {
  baru: 'accent',
  diproses: 'neutral',
  selesai: 'sage',
}
