import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { store } from '@/mocks/db'
import { renderWithProviders } from '@/test/utils'
import { SparringScreen } from './SparringScreen'

function renderSparring() {
  return renderWithProviders(<SparringScreen />, { route: '/sparring' })
}

/** Kartu ajakan dari tim tertentu, dicari lewat judulnya. */
async function cardFor(teamName: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: teamName })
  const article = heading.closest('article')
  if (!article) throw new Error(`Kartu untuk ${teamName} tidak ditemukan`)
  return article
}

describe('SparringScreen', () => {
  it('memisahkan ajakan masuk dari yang terkirim', async () => {
    const user = userEvent.setup()
    renderSparring()

    // Kotak masuk: dua menunggu + satu yang sudah diterima.
    expect(await screen.findByRole('heading', { name: 'Bandung Hoops' })).toBeInTheDocument()
    expect(screen.queryByText('Kamu mengajak')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /Terkirim/ }))

    expect(await screen.findByText(/Kamu mengajak/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Bandung Hoops' })).not.toBeInTheDocument()
  })

  it('menghitung ajakan yang masih menunggu di label tab', async () => {
    renderSparring()
    expect(await screen.findByRole('tab', { name: 'Masuk (2)' })).toBeInTheDocument()
  })

  it('menerima ajakan dan menawarkan booking lapangan', async () => {
    const user = userEvent.setup()
    renderSparring()

    const card = await cardFor('Bandung Hoops')
    await user.click(within(card).getByRole('button', { name: /Terima/ }))

    expect(await screen.findByText(/disetujui/)).toBeInTheDocument()
    const updated = await cardFor('Bandung Hoops')
    await waitFor(() => expect(within(updated).getByText('Diterima')).toBeInTheDocument())
    expect(within(updated).getByText('Booking lapangannya')).toBeInTheDocument()
    // Tombol jawaban hilang setelah dijawab.
    expect(within(updated).queryByRole('button', { name: /Terima/ })).not.toBeInTheDocument()
  })

  it('menolak ajakan tanpa menyentuh yang lain', async () => {
    const user = userEvent.setup()
    renderSparring()

    // Dua ajakan menunggu di kotak masuk sebelum dijawab.
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Terima/ })).toHaveLength(2))

    const card = await cardFor('Bandung Hoops')
    await user.click(within(card).getByRole('button', { name: /Tolak/ }))

    await waitFor(async () =>
      expect(within(await cardFor('Bandung Hoops')).getByText('Ditolak')).toBeInTheDocument(),
    )
    // Tepat satu yang terjawab; sisanya masih menunggu.
    expect(screen.getAllByRole('button', { name: /Terima/ })).toHaveLength(1)
  })

  it('menolak menjawab ajakan yang sudah dijawab', async () => {
    // sp-1 dijadikan sudah diterima sebelum layar dibuka.
    const invite = store.sparring.find((s) => s.id === 'sp-1')!
    invite.status = 'diterima'

    renderSparring()

    const card = await cardFor('Bandung Hoops')
    expect(within(card).queryByRole('button', { name: /Terima/ })).not.toBeInTheDocument()
    expect(within(card).getByText('Diterima')).toBeInTheDocument()
  })

  it('menampilkan state kosong ketika belum ada ajakan terkirim', async () => {
    store.sparring = store.sparring.filter((s) => s.direction !== 'keluar')
    const user = userEvent.setup()
    renderSparring()

    await screen.findByRole('tab', { name: /Terkirim/ })
    await user.click(screen.getByRole('tab', { name: /Terkirim/ }))

    expect(await screen.findByText('Belum ada ajakan terkirim')).toBeInTheDocument()
  })
})
