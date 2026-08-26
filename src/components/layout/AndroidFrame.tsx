import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

/**
 * Bingkai perangkat Android: status bar di atas, gesture nav pill di bawah.
 * Dipisah dari konten layar supaya tiap rute cukup mengisi area di tengah dan
 * tinggi penuhnya sudah dijamin di sini.
 *
 * Diadaptasi dari starter `android-frame.jsx` di project Claude Design, tapi
 * warnanya ditarik dari token Organic, bukan palet Material bawaan starter.
 */

function StatusBar() {
  const [clock, setClock] = useState(() => formatClock(new Date()))

  useEffect(() => {
    const timer = window.setInterval(() => setClock(formatClock(new Date())), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div
      aria-hidden
      className="relative flex h-10 shrink-0 items-center justify-between px-4 text-sm text-text"
    >
      <span className="font-semibold tabular-nums">{clock}</span>
      {/* Punch-hole kamera */}
      <span className="absolute left-1/2 top-2 h-6 w-6 -translate-x-1/2 rounded-pill bg-neutral-900" />
      <span className="flex items-center gap-1.5">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 13.3L.67 5.97a10.37 10.37 0 0114.66 0L8 13.3z" />
        </svg>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
          <path d="M14.67 14.67V1.33L1.33 14.67h13.34z" />
        </svg>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
          <rect x="3.75" y="2" width="8.5" height="13" rx="1.5" />
          <rect x="5.5" y="0.9" width="5" height="2" rx="0.5" />
        </svg>
      </span>
    </div>
  )
}

function formatClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function GestureNav() {
  return (
    <div aria-hidden className="flex h-6 shrink-0 items-center justify-center">
      <span className="h-1 w-28 rounded-pill bg-text opacity-40" />
    </div>
  )
}

export function AndroidFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-0 sm:p-6">
      <div
        className="flex h-full w-full flex-col overflow-hidden bg-bg sm:h-[892px] sm:max-h-full sm:w-[412px] sm:rounded-[18px] sm:border-8 sm:shadow-lg"
        style={{ borderColor: 'var(--frame-border)' }}
      >
        <StatusBar />
        {/* min-h-0 supaya anak yang scroll tidak mendorong bingkai. */}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        <GestureNav />
      </div>
    </div>
  )
}
