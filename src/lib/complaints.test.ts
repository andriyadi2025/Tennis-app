import { describe, expect, it } from 'vitest'
import type { Complaint, ComplaintMessage } from '@/types'
import {
  awaitingAdmin,
  countAwaitingAdmin,
  isOpen,
  lastMessage,
  sortByActivity,
  statusAfterReply,
  validateDraft,
  validateReply,
} from './complaints'

function message(overrides: Partial<ComplaintMessage> = {}): ComplaintMessage {
  return {
    id: 'cm-1',
    complaintId: 'c-1',
    authorRole: 'member',
    authorName: 'Raka',
    body: 'Lampu lapangan 2 mati sejak kemarin.',
    sentAt: '2026-09-03T10:00:00.000Z',
    ...overrides,
  }
}

function complaint(overrides: Partial<Complaint> = {}): Complaint {
  return {
    id: 'c-1',
    code: 'ADU-A1B2',
    userId: 'u-raka',
    userName: 'Raka Pratama',
    category: 'lapangan',
    subject: 'Lampu lapangan 2 mati',
    status: 'baru',
    createdAt: '2026-09-03T10:00:00.000Z',
    updatedAt: '2026-09-03T10:00:00.000Z',
    relatedKind: null,
    relatedId: null,
    relatedLabel: null,
    messages: [message()],
    ...overrides,
  }
}

describe('statusAfterReply', () => {
  it('memindahkan aduan baru ke diproses begitu klub membalas', () => {
    // Kalau tidak, daftar penuh "Baru" yang sebenarnya sudah dijawab.
    expect(statusAfterReply('baru', 'admin')).toBe('diproses')
  })

  it('membiarkan aduan baru tetap baru kalau anggota menambah keterangan', () => {
    expect(statusAfterReply('baru', 'member')).toBe('baru')
  })

  it('membuka lagi aduan selesai kalau anggota menulis lagi', () => {
    // Anggota menulis lagi berarti persoalannya belum beres baginya.
    expect(statusAfterReply('selesai', 'member')).toBe('diproses')
  })

  it('tidak membuka lagi aduan selesai karena balasan admin', () => {
    expect(statusAfterReply('selesai', 'admin')).toBe('selesai')
  })

  it('membiarkan yang sedang diproses tetap diproses', () => {
    expect(statusAfterReply('diproses', 'admin')).toBe('diproses')
    expect(statusAfterReply('diproses', 'member')).toBe('diproses')
  })
})

describe('menunggu jawaban klub', () => {
  it('menandai aduan yang pesan terakhirnya dari anggota', () => {
    expect(awaitingAdmin(complaint())).toBe(true)
  })

  it('tidak menandai yang sudah dibalas klub', () => {
    const dibalas = complaint({
      status: 'diproses',
      messages: [message(), message({ id: 'cm-2', authorRole: 'admin', authorName: 'Admin DBTC' })],
    })
    expect(awaitingAdmin(dibalas)).toBe(false)
  })

  it('tidak menandai aduan yang sudah selesai', () => {
    expect(awaitingAdmin(complaint({ status: 'selesai' }))).toBe(false)
  })

  it('menghitung berapa yang menunggu, untuk lencana dasbor', () => {
    const rows = [
      complaint(),
      complaint({ id: 'c-2', status: 'selesai' }),
      complaint({ id: 'c-3', status: 'diproses' }),
    ]
    expect(countAwaitingAdmin(rows)).toBe(2)
  })
})

describe('isOpen & lastMessage', () => {
  it('menganggap baru dan diproses masih terbuka', () => {
    expect(isOpen('baru')).toBe(true)
    expect(isOpen('diproses')).toBe(true)
    expect(isOpen('selesai')).toBe(false)
  })

  it('mengambil pesan paling akhir, bukan paling awal', () => {
    const dua = complaint({ messages: [message(), message({ id: 'cm-2', body: 'Terakhir' })] })
    expect(lastMessage(dua)?.body).toBe('Terakhir')
  })
})

describe('sortByActivity', () => {
  it('menaikkan yang paling baru bergerak, bukan yang paling baru dibuat', () => {
    const lama = complaint({ id: 'c-lama', updatedAt: '2026-09-01T10:00:00.000Z' })
    const baru = complaint({ id: 'c-baru', updatedAt: '2026-09-04T10:00:00.000Z' })
    expect(sortByActivity([lama, baru]).map((c) => c.id)).toEqual(['c-baru', 'c-lama'])
  })

  it('tidak mengubah array aslinya', () => {
    const rows = [
      complaint({ id: 'a', updatedAt: '2026-09-01T00:00:00.000Z' }),
      complaint({ id: 'b' }),
    ]
    sortByActivity(rows)
    expect(rows.map((c) => c.id)).toEqual(['a', 'b'])
  })
})

describe('validasi', () => {
  const isi = 'Lampu lapangan 2 mati sejak kemarin sore.'

  it('menerima aduan yang wajar', () => {
    expect(validateDraft({ subject: 'Lampu mati', body: isi })).toBeNull()
  })

  it('menolak judul atau isi yang terlalu pendek', () => {
    expect(validateDraft({ subject: 'aa', body: isi })).toMatch(/Judul terlalu pendek/)
    expect(validateDraft({ subject: 'Lampu mati', body: 'rusak' })).toMatch(/lebih jelas/)
  })

  it('mengabaikan spasi kosong sebagai isi', () => {
    expect(validateDraft({ subject: '    ', body: isi })).toMatch(/Judul terlalu pendek/)
  })

  it('menolak kiriman yang tidak wajar panjangnya', () => {
    expect(validateDraft({ subject: 'x'.repeat(81), body: isi })).toMatch(/80 karakter/)
    expect(validateDraft({ subject: 'Lampu mati', body: 'x'.repeat(2_001) })).toMatch(/2.000/)
  })

  it('menolak balasan kosong', () => {
    expect(validateReply('   ')).toMatch(/tidak boleh kosong/)
    expect(validateReply('Sudah diperbaiki.')).toBeNull()
  })
})
