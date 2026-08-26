import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { server } from '@/mocks/server'
import { store } from '@/mocks/db'
import { renderWithProviders } from '@/test/utils'
import { MatchDetailScreen } from './MatchDetailScreen'

function renderMatch(id = 'om-1') {
  return renderWithProviders(<MatchDetailScreen />, {
    route: `/match/${id}`,
    path: '/match/:id',
  })
}

const joinButton = () =>
  screen.getByRole('button', { name: /Gabung sekarang|Batal gabung|Slot penuh/ })

describe('MatchDetailScreen — gabung open match', () => {
  it('menampilkan slot kosong sebanyak sisa kuota', async () => {
    renderMatch()
    // om-1: 5 dari 8 terisi, jadi 3 slot kosong.
    await waitFor(() => expect(screen.getAllByText('Slot kosong')).toHaveLength(3))
  })

  it('menambah pemain dan mengubah tombol setelah gabung', async () => {
    const user = userEvent.setup()
    renderMatch()
    await screen.findByText('5/8 terisi')

    await user.click(joinButton())

    expect(await screen.findByText('6/8 terisi')).toBeInTheDocument()
    expect(await screen.findByText(/Berhasil gabung/)).toBeInTheDocument()
    // Satu slot kosong terpakai.
    expect(screen.getAllByText('Slot kosong')).toHaveLength(2)
  })

  it('bisa membatalkan gabung dan mengembalikan slot', async () => {
    const user = userEvent.setup()
    renderMatch()
    await screen.findByText('5/8 terisi')

    await user.click(joinButton())
    await screen.findByText('6/8 terisi')

    await user.click(await screen.findByRole('button', { name: 'Batal gabung' }))

    expect(await screen.findByText('5/8 terisi')).toBeInTheDocument()
    expect(await screen.findByText(/keluar dari sesi ini/)).toBeInTheDocument()
  })

  it('mengunci tombol dan tidak memanggil server saat kuota sudah penuh', async () => {
    // om-3 dibuat penuh lebih dulu supaya kondisinya nyata, bukan disimulasikan.
    const match = store.openMatches.find((m) => m.id === 'om-3')!
    match.players = Array.from({ length: match.slotsTotal }, (_, i) => ({
      id: `filler-${i}`,
      name: `Pemain ${i}`,
      level: 'pemula' as const,
    }))

    renderMatch('om-3')

    const button = await screen.findByRole('button', { name: 'Slot penuh' })
    expect(button).toBeDisabled()
    expect(screen.queryByText('Slot kosong')).not.toBeInTheDocument()
  })

  it('menampilkan pesan server ketika gabung ditolak', async () => {
    server.use(
      http.post('/api/open-matches/:id/join', () =>
        HttpResponse.json(
          { code: 'MATCH_FULL', message: 'Yah, slotnya baru saja penuh.' },
          { status: 409 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderMatch()
    await screen.findByText('5/8 terisi')

    await user.click(joinButton())

    expect(await screen.findByText('Yah, slotnya baru saja penuh.')).toBeInTheDocument()
    // Jumlah pemain tidak boleh bergerak setelah penolakan.
    expect(screen.getByText('5/8 terisi')).toBeInTheDocument()
  })
})
