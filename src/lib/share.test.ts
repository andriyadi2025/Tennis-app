import { afterEach, describe, expect, it, vi } from 'vitest'
import { share } from './share'

const payload = {
  title: 'Booking Lapangin',
  text: 'Main badminton di GOR Cendana.',
  url: 'https://lapangin.app/booking/bk-1/ticket',
}

function stubNavigator(value: Partial<Navigator>) {
  vi.stubGlobal('navigator', value)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('share', () => {
  it('memakai Web Share API kalau tersedia', async () => {
    const shareFn = vi.fn().mockResolvedValue(undefined)
    stubNavigator({ share: shareFn })

    await expect(share(payload)).resolves.toBe('shared')
    expect(shareFn).toHaveBeenCalledWith(payload)
  })

  it('jatuh ke papan klip kalau Web Share tidak ada', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubNavigator({ clipboard: { writeText } as unknown as Clipboard })

    await expect(share(payload)).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalledWith(`${payload.text}\n${payload.url}`)
  })

  it('memperlakukan pembatalan share sebagai bukan kegagalan', async () => {
    const abort = new DOMException('dibatalkan', 'AbortError')
    const writeText = vi.fn()
    stubNavigator({
      share: vi.fn().mockRejectedValue(abort),
      clipboard: { writeText } as unknown as Clipboard,
    })

    // User menutup share sheet — tidak boleh diam-diam menyalin sebagai gantinya.
    await expect(share(payload)).resolves.toBe('unsupported')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('jatuh ke papan klip kalau share gagal karena alasan lain', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubNavigator({
      share: vi.fn().mockRejectedValue(new Error('tidak diizinkan')),
      clipboard: { writeText } as unknown as Clipboard,
    })

    await expect(share(payload)).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalled()
  })

  it('melaporkan unsupported kalau tidak ada jalan sama sekali', async () => {
    stubNavigator({})
    await expect(share(payload)).resolves.toBe('unsupported')
  })

  it('melaporkan unsupported kalau papan klip menolak', async () => {
    stubNavigator({
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('ditolak')),
      } as unknown as Clipboard,
    })
    await expect(share(payload)).resolves.toBe('unsupported')
  })
})
