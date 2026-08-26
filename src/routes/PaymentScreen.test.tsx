import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import type { Booking } from '@/types'
import { server } from '@/mocks/server'
import { useDraftStore } from '@/store/draft'
import { renderWithProviders } from '@/test/utils'
import { PaymentScreen } from './PaymentScreen'

const BOOKING_ID = 'bk-test'

function bookingWithDeadline(deadline: Date): Booking {
  const starts = new Date(2026, 7, 29, 19, 0, 0, 0)
  const ends = new Date(2026, 7, 29, 21, 0, 0, 0)
  return {
    id: BOOKING_ID,
    venueId: 'v-cendana',
    venueName: 'GOR Cendana',
    courtId: 'v-cendana-c3',
    courtName: 'Lap. 3',
    sport: 'badminton',
    range: { startsAt: starts.toISOString(), endsAt: ends.toISOString(), hours: 2 },
    recurrence: null,
    addOns: [],
    splitBill: null,
    status: 'awaitingPayment',
    paymentMethod: null,
    code: 'DBTC-TEST12',
    subtotalIdr: 156_000,
    pointsRedeemed: 0,
    discountIdr: 0,
    serviceFeeIdr: 5_000,
    totalIdr: 161_000,
    createdAt: new Date().toISOString(),
    paymentDeadline: deadline.toISOString(),
  }
}

function serveBooking(deadline: Date) {
  server.use(
    http.get(`/api/bookings/${BOOKING_ID}`, () => HttpResponse.json(bookingWithDeadline(deadline))),
  )
}

/** Menaruh draft di stage awaitingPayment, seperti setelah layar ringkasan. */
function primeDraft(deadline: Date) {
  useDraftStore.getState().reset()
  useDraftStore.setState({
    venueId: 'v-cendana',
    venueName: 'GOR Cendana',
    courtId: 'v-cendana-c3',
    courtName: 'Lap. 3',
    sport: 'badminton',
    date: new Date(2026, 7, 29).toISOString(),
    startsAt: [new Date(2026, 7, 29, 19).toISOString()],
    stage: 'awaitingPayment',
    bookingId: BOOKING_ID,
    paymentDeadline: deadline.toISOString(),
  })
}

describe('PaymentScreen — hitung mundur hold', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    useDraftStore.getState().reset()
  })

  it('menampilkan sisa waktu dari deadline server', async () => {
    const deadline = new Date(Date.now() + 10 * 60_000)
    primeDraft(deadline)
    serveBooking(deadline)

    renderWithProviders(<PaymentScreen />, { route: '/booking/payment' })

    // 10 menit penuh — mendekati 10:00, bukan angka yang dihitung ulang klien.
    expect(await screen.findByText(/^(10:00|09:59)$/)).toBeInTheDocument()
    expect(screen.getByText('Selesaikan dalam')).toBeInTheDocument()
  })

  it('menghitung mundur seiring waktu berjalan', async () => {
    const deadline = new Date(Date.now() + 10 * 60_000)
    primeDraft(deadline)
    serveBooking(deadline)

    renderWithProviders(<PaymentScreen />, { route: '/booking/payment' })
    await screen.findByText(/^(10:00|09:59)$/)

    await vi.advanceTimersByTimeAsync(65_000)

    await waitFor(() => expect(screen.getByText(/^(08:55|08:54)$/)).toBeInTheDocument())
  })

  it('menutup pembayaran begitu hold habis', async () => {
    // Hold tinggal 3 detik: cukup untuk render sekali sebelum kedaluwarsa.
    const deadline = new Date(Date.now() + 3_000)
    primeDraft(deadline)
    serveBooking(deadline)

    renderWithProviders(<PaymentScreen />, { route: '/booking/payment' })
    await screen.findByText('Selesaikan dalam')

    await vi.advanceTimersByTimeAsync(4_000)

    expect(await screen.findByText('Waktu pembayaran habis')).toBeInTheDocument()
    expect(screen.getByText('00:00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Bayar/ })).toBeDisabled()
  })

  it('menjatuhkan draft kembali ke stage draft saat hold habis', async () => {
    const deadline = new Date(Date.now() + 3_000)
    primeDraft(deadline)
    serveBooking(deadline)

    renderWithProviders(<PaymentScreen />, { route: '/booking/payment' })
    await screen.findByText('Selesaikan dalam')
    expect(useDraftStore.getState().canPay()).toBe(true)

    await vi.advanceTimersByTimeAsync(4_000)

    // Draft basi tidak boleh bisa dibayar — dijaga store, bukan hanya tombol.
    await waitFor(() => expect(useDraftStore.getState().stage).toBe('draft'))
    expect(useDraftStore.getState().canPay()).toBe(false)
    expect(useDraftStore.getState().paymentDeadline).toBeNull()
    // Id booking dipertahankan supaya layar bisa tetap menjelaskan apa yang
    // kedaluwarsa alih-alih melempar user keluar.
    expect(useDraftStore.getState().bookingId).toBe(BOOKING_ID)
  })
})
