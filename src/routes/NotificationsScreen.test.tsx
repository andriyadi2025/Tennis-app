import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { NotificationsScreen } from './NotificationsScreen'

function renderNotifications() {
  return renderWithProviders(<NotificationsScreen />, { route: '/notifications' })
}

const unreadDots = () => screen.queryAllByLabelText('Belum dibaca')

describe('NotificationsScreen', () => {
  it('mengelompokkan notifikasi per rentang waktu', async () => {
    renderNotifications()
    // Dicari sebagai heading: "Kemarin" juga muncul sebagai stempel waktu baris.
    expect(await screen.findByRole('heading', { name: 'Hari ini' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Kemarin' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Minggu ini' })).toBeInTheDocument()
  })

  it('menandai satu notifikasi dibaca saat dibuka', async () => {
    const user = userEvent.setup()
    renderNotifications()

    await waitFor(() => expect(unreadDots()).toHaveLength(2))
    const row = screen.getByText('Pembayaran berhasil').closest('a')!
    await user.click(within(row).getByText('Pembayaran berhasil'))

    await waitFor(() => expect(unreadDots()).toHaveLength(1))
  })

  it('menandai semua dibaca sekaligus', async () => {
    const user = userEvent.setup()
    renderNotifications()

    await waitFor(() => expect(unreadDots()).toHaveLength(2))
    await user.click(screen.getByRole('button', { name: 'Tandai semua' }))

    await waitFor(() => expect(unreadDots()).toHaveLength(0))
  })

  it('menyembunyikan tombol Tandai semua ketika tidak ada yang belum dibaca', async () => {
    const user = userEvent.setup()
    renderNotifications()

    await waitFor(() => expect(unreadDots()).toHaveLength(2))
    await user.click(screen.getByRole('button', { name: 'Tandai semua' }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Tandai semua' })).not.toBeInTheDocument(),
    )
  })
})
