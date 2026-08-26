import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { ReviewsScreen } from './ReviewsScreen'

function renderReviews(id = 'v-cendana') {
  return renderWithProviders(<ReviewsScreen />, {
    route: `/venue/${id}/reviews`,
    path: '/venue/:id/reviews',
  })
}

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Tulis ulasan/ }))
  return screen.getByRole('textbox', { name: /Ceritakan pengalamanmu/ })
}

describe('ReviewsScreen — tulis ulasan', () => {
  it('menampilkan ringkasan rating dan distribusi bintang', async () => {
    renderReviews()
    // v-cendana: lima ulasan seed, rata-rata 4,4.
    expect(await screen.findByText('4,4')).toBeInTheDocument()
    expect(screen.getByText('5 ulasan')).toBeInTheDocument()
  })

  it('mengunci tombol Kirim sebelum bintang dipilih', async () => {
    const user = userEvent.setup()
    renderReviews()
    await openForm(user)

    expect(screen.getByRole('button', { name: 'Kirim' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '5 bintang' }))
    expect(screen.getByRole('button', { name: 'Kirim' })).toBeEnabled()
  })

  it('menolak ulasan yang terlalu pendek dengan pesan dari server', async () => {
    const user = userEvent.setup()
    renderReviews()
    const textarea = await openForm(user)

    await user.click(screen.getByRole('button', { name: '4 bintang' }))
    await user.type(textarea, 'bagus')
    await user.click(screen.getByRole('button', { name: 'Kirim' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('minimal 10 karakter')
    // Form tetap terbuka supaya isian tidak hilang.
    expect(screen.getByRole('button', { name: 'Kirim' })).toBeInTheDocument()
  })

  it('menambahkan ulasan baru ke daftar dan menghitung ulang rata-rata', async () => {
    const user = userEvent.setup()
    renderReviews()
    await screen.findByText('5 ulasan')
    const textarea = await openForm(user)

    await user.click(screen.getByRole('button', { name: '1 bintang' }))
    await user.type(textarea, 'Lampunya mati terus, lapangan licin waktu hujan.')
    await user.click(screen.getByRole('button', { name: 'Kirim' }))

    expect(await screen.findByText(/Lampunya mati terus/)).toBeInTheDocument()
    // Enam ulasan sekarang, dan rata-rata turun karena bintang satu.
    await waitFor(() => expect(screen.getByText('6 ulasan')).toBeInTheDocument())
    expect(screen.getByText('3,8')).toBeInTheDocument()
    expect(await screen.findByText(/Ulasan kamu sudah tayang/)).toBeInTheDocument()
  })

  it('menutup form setelah ulasan terkirim', async () => {
    const user = userEvent.setup()
    renderReviews()
    const textarea = await openForm(user)

    await user.click(screen.getByRole('button', { name: '5 bintang' }))
    await user.type(textarea, 'Lapangannya terawat, penjaganya ramah sekali.')
    await user.click(screen.getByRole('button', { name: 'Kirim' }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Kirim' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: /Tulis ulasan/ })).toBeInTheDocument()
  })
})
