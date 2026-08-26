import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { findVenue } from '@/mocks/db'
import { renderWithProviders } from '@/test/utils'
import { AdminCourtsScreen } from './AdminCourtsScreen'

function renderCourts() {
  return renderWithProviders(<AdminCourtsScreen />, { route: '/admin/lapangan' })
}

const sheet = () => screen.getByRole('dialog')

describe('AdminCourtsScreen', () => {
  it('menampilkan lapangan klub beserta asal tarifnya', async () => {
    renderCourts()
    expect(await screen.findByText('Lap. 1')).toBeInTheDocument()
    // Tanpa tarif khusus, lapangan ikut tarif dasar klub.
    expect(screen.getAllByText('Ikut tarif dasar').length).toBeGreaterThan(0)
  })

  it('menambah lapangan baru', async () => {
    const user = userEvent.setup()
    renderCourts()
    await screen.findByText('Lap. 1')

    await user.click(screen.getByRole('button', { name: /Tambah lapangan/ }))
    await user.type(within(sheet()).getByRole('textbox', { name: 'Nama lapangan' }), 'Lap. 3')
    await user.type(within(sheet()).getByRole('textbox', { name: 'Jenis permukaan' }), 'Gravel')
    await user.click(within(sheet()).getByRole('button', { name: 'Simpan' }))

    expect(await screen.findByText('Lap. 3')).toBeInTheDocument()
    expect(await screen.findByText(/Lap\. 3 ditambahkan/)).toBeInTheDocument()
  })

  it('menolak nama lapangan yang sudah dipakai', async () => {
    const user = userEvent.setup()
    renderCourts()
    await screen.findByText('Lap. 1')

    await user.click(screen.getByRole('button', { name: /Tambah lapangan/ }))
    await user.type(within(sheet()).getByRole('textbox', { name: 'Nama lapangan' }), 'Lap. 1')
    await user.type(within(sheet()).getByRole('textbox', { name: 'Jenis permukaan' }), 'Gravel')
    await user.click(within(sheet()).getByRole('button', { name: 'Simpan' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Sudah ada lapangan')
    // Sheet tetap terbuka supaya isian tidak hilang.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('menyimpan tarif khusus untuk satu lapangan', async () => {
    const user = userEvent.setup()
    renderCourts()
    await screen.findByText('Lap. 1')

    await user.click(screen.getByRole('button', { name: 'Ubah Lap. 1' }))
    await user.type(within(sheet()).getByRole('spinbutton', { name: /Tarif khusus/ }), '95000')
    await user.click(within(sheet()).getByRole('button', { name: 'Simpan' }))

    expect(await screen.findByText('Rp95.000/jam')).toBeInTheDocument()
  })

  it('menolak menghapus lapangan terakhir', async () => {
    // Sisakan satu lapangan saja sebelum layar dibuka.
    const venue = findVenue('v-dbtc')!
    venue.courts = venue.courts.slice(0, 1)

    const user = userEvent.setup()
    renderCourts()
    await screen.findByText('Lap. 1')

    await user.click(screen.getByRole('button', { name: 'Hapus Lap. 1' }))
    await user.click(screen.getByRole('button', { name: 'Hapus' }))

    expect(await screen.findByText(/minimal satu lapangan/)).toBeInTheDocument()
    expect(screen.getByText('Lap. 1')).toBeInTheDocument()
  })

  it('meminta konfirmasi sebelum menghapus', async () => {
    const user = userEvent.setup()
    renderCourts()
    await screen.findByText('Lap. 2')

    await user.click(screen.getByRole('button', { name: 'Hapus Lap. 2' }))
    // Konfirmasi muncul dulu; belum ada yang terhapus.
    expect(screen.getByRole('button', { name: 'Hapus' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Batal' }))

    expect(screen.getByText('Lap. 2')).toBeInTheDocument()
  })

  it('menghapus lapangan yang tidak punya booking mendatang', async () => {
    const user = userEvent.setup()
    renderCourts()
    await screen.findByText('Lap. 2')

    await user.click(screen.getByRole('button', { name: 'Hapus Lap. 2' }))
    await user.click(screen.getByRole('button', { name: 'Hapus' }))

    await waitFor(() => expect(screen.queryByText('Lap. 2')).not.toBeInTheDocument())
    expect(await screen.findByText(/Lap\. 2 dihapus/)).toBeInTheDocument()
  })
})
