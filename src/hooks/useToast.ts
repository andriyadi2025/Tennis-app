import { useCallback, useEffect, useRef, useState } from 'react'

export type ToastTone = 'sukses' | 'gagal'

export interface ToastState {
  message: string
  tone: ToastTone
  /** Naik tiap kali toast dipanggil, supaya pesan sama berturut-turut tetap memicu timer baru. */
  nonce: number
}

/**
 * Umpan balik singkat untuk aksi yang tidak berpindah layar — gabung match,
 * daftar turnamen, salin kode. Sengaja sekecil ini: satu pesan pada satu
 * waktu, tidak ada antrean, tidak ada pustaka.
 */
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timer = useRef<number | null>(null)

  const show = useCallback((message: string, tone: ToastTone = 'sukses') => {
    setToast((prev) => ({ message, tone, nonce: (prev?.nonce ?? 0) + 1 }))
  }, [])

  useEffect(() => {
    if (!toast) return
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(null), 3_500)
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [toast])

  return { toast, show }
}
