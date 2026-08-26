import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LocationProbe, renderWithProviders } from '@/test/utils'
import { SearchScreen } from './SearchScreen'

function renderSearch(route = '/search') {
  return renderWithProviders(<SearchScreen />, { route, extra: <LocationProbe /> })
}

function url(): string {
  return screen.getByTestId('location').textContent ?? ''
}

describe('SearchScreen — filter tersinkron dengan URL', () => {
  it('menulis cabang olahraga ke search params', async () => {
    const user = userEvent.setup()
    renderSearch()

    await user.click(screen.getByRole('button', { name: 'Futsal' }))

    await waitFor(() => expect(url()).toContain('sport=futsal'))
  })

  it('membaca filter dari URL saat pertama dibuka', async () => {
    renderSearch('/search?sport=padel&indoor=1')

    expect(screen.getByRole('button', { name: 'Padel' })).toHaveAttribute('aria-pressed', 'true')
    // Ringkasan filter aktif ikut mencerminkan URL.
    expect(await screen.findByText('Indoor')).toBeInTheDocument()
  })

  it('menghapus parameter saat filter dimatikan lagi', async () => {
    const user = userEvent.setup()
    renderSearch('/search?sport=futsal')

    await user.click(screen.getByRole('button', { name: 'Futsal' }))

    await waitFor(() => expect(url()).not.toContain('sport='))
  })

  it('menaruh query pencarian ke URL setelah jeda debounce', async () => {
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox', { name: /Cari venue/ }), 'padel')

    // Debounce 350ms — URL menyusul, bukan berubah tiap ketikan.
    await waitFor(() => expect(url()).toContain('q=padel'), { timeout: 4_000 })
  })

  it('mengembalikan semua filter ke bawaan lewat tombol Reset', async () => {
    const user = userEvent.setup()
    renderSearch('/search?sport=futsal&indoor=1&maxDistance=2')

    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await user.click(screen.getByRole('button', { name: 'Reset' }))

    await waitFor(() => expect(url()).toBe('/search'))
  })

  it('menyimpan jarak maksimum yang dipilih ke URL', async () => {
    const user = userEvent.setup()
    renderSearch()

    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await user.click(screen.getByRole('button', { name: '5 km' }))

    await waitFor(() => expect(url()).toContain('maxDistance=5'))
  })

  it('menampilkan state kosong ketika tidak ada venue yang cocok', async () => {
    // Padel indoor di bawah 2 km tidak ada di data contoh.
    renderSearch('/search?sport=padel&maxDistance=2&maxPrice=50000')

    expect(await screen.findByText('Tidak ada yang cocok')).toBeInTheDocument()
  })

  it('menampilkan state error ketika server gagal', async () => {
    // Handler mock sengaja mengembalikan 500 untuk query "error".
    renderSearch('/search?q=error')

    expect(await screen.findByRole('alert')).toHaveTextContent('Server sedang sibuk')
  })
})
