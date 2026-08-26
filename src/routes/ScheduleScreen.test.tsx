import { beforeEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Slot } from '@/types'
import { server } from '@/mocks/server'
import { useDraftStore } from '@/store/draft'
import { renderWithProviders } from '@/test/utils'
import { ScheduleScreen } from './ScheduleScreen'

/**
 * Grid slot dipatok lewat handler khusus, bukan mengandalkan ketersediaan
 * hasil hash — supaya aturan pemilihan diuji terhadap papan yang pasti:
 * 15.00 dan 18.00 penuh, sisanya kosong.
 */
const BOOKED_HOURS = [15, 18]

function fixedSlots(dayIso: string): Slot[] {
  const day = new Date(dayIso)
  day.setHours(0, 0, 0, 0)
  return [15, 16, 17, 18, 19, 20, 21].map((hour) => {
    const starts = new Date(day)
    starts.setHours(hour, 0, 0, 0)
    return {
      courtId: 'v-cendana-c3',
      startsAt: starts.toISOString(),
      status: BOOKED_HOURS.includes(hour) ? ('booked' as const) : ('available' as const),
      priceIdr: 65_000,
    }
  })
}

function useFixedGrid() {
  server.use(
    http.get('/api/venues/:id/slots', ({ request }) => {
      const url = new URL(request.url)
      return HttpResponse.json(fixedSlots(url.searchParams.get('date') ?? new Date().toISOString()))
    }),
  )
}

function renderSchedule() {
  return renderWithProviders(<ScheduleScreen />, {
    route: '/venue/v-cendana/schedule',
    path: '/venue/:id/schedule',
  })
}

/** Tombol jam di grid — dibedakan dari chip lapangan lewat label aria-nya. */
function hourButton(hour: number): HTMLElement {
  const label = `${String(hour).padStart(2, '0')}.00`
  return screen.getByRole('button', { name: new RegExp(`^${label},`) })
}

describe('ScheduleScreen — aturan pilih slot', () => {
  beforeEach(() => {
    useDraftStore.getState().reset()
    useFixedGrid()
  })

  async function ready() {
    // Tunggu sampai lapangan default terpilih dan grid termuat.
    await waitFor(() => expect(hourButton(19)).toBeInTheDocument(), { timeout: 5_000 })
  }

  it('menandai slot penuh sebagai tidak bisa dipilih', async () => {
    renderSchedule()
    await ready()
    expect(hourButton(18)).toBeDisabled()
    expect(hourButton(19)).toBeEnabled()
  })

  it('memilih satu jam dan menampilkan rentangnya', async () => {
    const user = userEvent.setup()
    renderSchedule()
    await ready()

    await user.click(hourButton(19))

    expect(hourButton(19)).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText(/Dipilih 19\.00 – 20\.00/)).toBeInTheDocument()
  })

  it('menerima jam yang bersambung', async () => {
    const user = userEvent.setup()
    renderSchedule()
    await ready()

    await user.click(hourButton(19))
    await user.click(hourButton(20))

    expect(hourButton(20)).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText(/Dipilih 19\.00 – 21\.00/)).toBeInTheDocument()
    expect(useDraftStore.getState().startsAt).toHaveLength(2)
  })

  it('menolak jam yang tidak bersambung dan menjelaskan alasannya', async () => {
    const user = userEvent.setup()
    renderSchedule()
    await ready()

    await user.click(hourButton(19))
    await user.click(hourButton(21))

    expect(await screen.findByText(/Pilih jam yang bersambung/)).toBeInTheDocument()
    expect(hourButton(21)).toHaveAttribute('aria-pressed', 'false')
    // Pilihan sebelumnya tetap utuh — penolakan tidak mengubah apa pun.
    expect(useDraftStore.getState().startsAt).toHaveLength(1)
    expect(hourButton(19)).toHaveAttribute('aria-pressed', 'true')
  })

  it('menolak melepas jam di tengah blok', async () => {
    const user = userEvent.setup()
    renderSchedule()
    await ready()

    await user.click(hourButton(19))
    await user.click(hourButton(20))
    await user.click(hourButton(21))
    expect(useDraftStore.getState().startsAt).toHaveLength(3)

    await user.click(hourButton(20))

    expect(await screen.findByText(/tidak bisa dilepas/)).toBeInTheDocument()
    expect(useDraftStore.getState().startsAt).toHaveLength(3)
  })

  it('melepas jam di ujung blok', async () => {
    const user = userEvent.setup()
    renderSchedule()
    await ready()

    await user.click(hourButton(19))
    await user.click(hourButton(20))
    await user.click(hourButton(20))

    await waitFor(() => expect(useDraftStore.getState().startsAt).toHaveLength(1))
    expect(hourButton(20)).toHaveAttribute('aria-pressed', 'false')
  })

  it('mengunci tombol Lanjut selama belum ada jam dipilih', async () => {
    const user = userEvent.setup()
    renderSchedule()
    await ready()

    expect(screen.getByRole('button', { name: 'Lanjut' })).toBeDisabled()
    await user.click(hourButton(19))
    expect(screen.getByRole('button', { name: 'Lanjut' })).toBeEnabled()
  })
})
