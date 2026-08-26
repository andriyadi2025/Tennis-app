import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_PREFERENCES, usePreferencesStore } from '@/store/preferences'
import { renderWithProviders } from '@/test/utils'
import { SettingsScreen } from './SettingsScreen'
import { NotificationsScreen } from './NotificationsScreen'

function renderSettings() {
  return renderWithProviders(<SettingsScreen />, { route: '/settings' })
}

describe('SettingsScreen', () => {
  beforeEach(() => {
    usePreferencesStore.setState(DEFAULT_PREFERENCES)
  })

  it('menyimpan area pilihan ke store dan localStorage', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Bandung Selatan' }))

    expect(usePreferencesStore.getState().area).toBe('Bandung Selatan')
    // Kunci bernamespace — bukan mencemari localStorage origin ini.
    expect(window.localStorage.getItem('lapangin:preferences')).toContain('Bandung Selatan')
  })

  it('menyimpan radius bawaan pencarian', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole('button', { name: '5 km' }))

    expect(usePreferencesStore.getState().defaultRadiusKm).toBe(5)
  })

  it('mematikan satu jenis notifikasi', async () => {
    const user = userEvent.setup()
    renderSettings()

    expect(usePreferencesStore.getState().notify.booking).toBe(true)
    await user.click(screen.getByRole('switch', { name: 'Booking' }))

    expect(usePreferencesStore.getState().notify.booking).toBe(false)
  })

  it('mengembalikan seluruh preferensi ke bawaan', async () => {
    const user = userEvent.setup()
    usePreferencesStore.setState({ area: 'Bandung Timur', defaultRadiusKm: 2 })
    renderSettings()

    await user.click(screen.getByRole('button', { name: /Kembalikan preferensi bawaan/ }))

    expect(usePreferencesStore.getState().area).toBe(DEFAULT_PREFERENCES.area)
    expect(usePreferencesStore.getState().defaultRadiusKm).toBe(DEFAULT_PREFERENCES.defaultRadiusKm)
  })

  it('meminta konfirmasi sebelum reset data contoh', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole('button', { name: /Reset data contoh/ }))

    // Peringatan muncul lebih dulu; belum ada yang terhapus.
    expect(await screen.findByRole('alert')).toHaveTextContent('akan hilang')
    await user.click(screen.getByRole('button', { name: 'Batal' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})

describe('Preferensi notifikasi berpengaruh ke daftar', () => {
  beforeEach(() => {
    usePreferencesStore.setState(DEFAULT_PREFERENCES)
  })

  it('menyembunyikan jenis yang dimatikan', async () => {
    renderWithProviders(<NotificationsScreen />, { route: '/notifications' })
    expect(await screen.findByText('Pembayaran berhasil')).toBeInTheDocument()

    usePreferencesStore.getState().toggleNotify('payment')

    await waitFor(() => expect(screen.queryByText('Pembayaran berhasil')).not.toBeInTheDocument())
    // Jenis lain tetap tampil.
    expect(screen.getByText('Bagas gabung open match kamu')).toBeInTheDocument()
  })

  it('menjelaskan kalau semua jenis sedang dimatikan', async () => {
    usePreferencesStore.setState({
      notify: { booking: false, payment: false, match: false, promo: false, community: false },
    })
    renderWithProviders(<NotificationsScreen />, { route: '/notifications' })

    expect(await screen.findByText(/sedang dimatikan di Pengaturan/)).toBeInTheDocument()
  })
})
