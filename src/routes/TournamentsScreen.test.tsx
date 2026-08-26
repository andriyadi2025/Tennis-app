import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { store } from '@/mocks/db'
import { renderWithProviders } from '@/test/utils'
import { TournamentsScreen } from './TournamentsScreen'

function renderTournaments() {
  return renderWithProviders(<TournamentsScreen />, { route: '/tournaments' })
}

async function cardFor(name: RegExp): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name })
  const article = heading.closest('article')
  if (!article) throw new Error('Kartu turnamen tidak ditemukan')
  return article
}

const sheet = () => screen.getByRole('dialog')

describe('TournamentsScreen — biaya daftar', () => {
  it('menampilkan biaya daftar di tombol, bukan hanya kata Daftar', async () => {
    renderTournaments()
    const card = await cardFor(/DBTC Open/)
    expect(within(card).getByRole('button', { name: /Daftar · Rp150\.000/ })).toBeInTheDocument()
  })

  it('mengunci turnamen yang pendaftarannya sudah ditutup', async () => {
    renderTournaments()
    const card = await cardFor(/Buah Batu Futsal League/)
    expect(within(card).getByRole('button', { name: 'Pendaftaran ditutup' })).toBeDisabled()
  })

  it('tidak menaikkan kuota sebelum pembayaran dikonfirmasi', async () => {
    const user = userEvent.setup()
    renderTournaments()

    const card = await cardFor(/DBTC Open/)
    expect(within(card).getByText('24/32 peserta')).toBeInTheDocument()

    await user.click(within(card).getByRole('button', { name: /Daftar ·/ }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    // Sheet terbuka tapi belum dibayar — kuota harus diam.
    expect(within(await cardFor(/DBTC Open/)).getByText('24/32 peserta')).toBeInTheDocument()

    await user.click(within(sheet()).getByRole('button', { name: 'Batal' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(within(await cardFor(/DBTC Open/)).getByText('24/32 peserta')).toBeInTheDocument()
  })

  it('menaikkan kuota dan menandai lunas setelah bayar', async () => {
    const user = userEvent.setup()
    renderTournaments()

    const card = await cardFor(/DBTC Open/)
    await user.click(within(card).getByRole('button', { name: /Daftar ·/ }))
    await screen.findByRole('dialog')
    await user.click(within(sheet()).getByRole('button', { name: 'Bayar & daftar' }))

    expect(await screen.findByText(/Pendaftaran lunas/)).toBeInTheDocument()
    const updated = await cardFor(/DBTC Open/)
    await waitFor(() => expect(within(updated).getByText('25/32 peserta')).toBeInTheDocument())
    expect(within(updated).getByText('Kamu sudah terdaftar')).toBeInTheDocument()
    expect(within(updated).getByText('Lunas')).toBeInTheDocument()
  })

  it('menandai bayar di tempat sebagai belum lunas', async () => {
    const user = userEvent.setup()
    renderTournaments()

    const card = await cardFor(/DBTC Open/)
    await user.click(within(card).getByRole('button', { name: /Daftar ·/ }))
    await screen.findByRole('dialog')
    await user.click(within(sheet()).getByRole('radio', { name: /Bayar di tempat/ }))
    await user.click(within(sheet()).getByRole('button', { name: 'Bayar & daftar' }))

    expect(await screen.findByText(/Bayar Rp150\.000 di lokasi/)).toBeInTheDocument()
    const updated = await cardFor(/DBTC Open/)
    await waitFor(() => expect(within(updated).getByText('Bayar di tempat')).toBeInTheDocument())
  })

  it('menolak pendaftaran ketika kuota sudah penuh', async () => {
    const t = store.tournaments.find((x) => x.id === 'trn-1')!
    t.slotsTaken = t.slotsTotal

    renderTournaments()

    const card = await cardFor(/DBTC Open/)
    expect(within(card).getByRole('button', { name: 'Kuota penuh' })).toBeDisabled()
  })
})
