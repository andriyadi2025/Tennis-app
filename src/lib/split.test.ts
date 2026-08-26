import { describe, expect, it } from 'vitest'
import type { SplitParticipant } from '@/types'
import {
  addParticipant,
  amountFor,
  computeSplit,
  isFullyPaid,
  paidAmount,
  paidRatio,
  removeParticipant,
  splitTotal,
  togglePaid,
} from './split'

const host: SplitParticipant = { id: 'p1', name: 'Raka', isHost: true }
const others: SplitParticipant[] = [
  { id: 'p2', name: 'Dimas', isHost: false },
  { id: 'p3', name: 'Rani', isHost: false },
]

describe('computeSplit', () => {
  it('membagi rata kalau total habis dibagi', () => {
    const split = computeSplit(150_000, [host, ...others])
    expect(split.amountPerPersonIdr).toBe(50_000)
    expect(split.hostRemainderIdr).toBe(0)
  })

  it('membebankan sisa pembulatan ke host', () => {
    // 145.000 / 3 = 48.333,33 → tiap orang 48.333, sisa 1 rupiah ke host.
    const split = computeSplit(145_000, [host, ...others])
    expect(split.amountPerPersonIdr).toBe(48_333)
    expect(split.hostRemainderIdr).toBe(1)
    expect(amountFor(split, 'p1')).toBe(48_334)
    expect(amountFor(split, 'p2')).toBe(48_333)
  })

  it('menjaga jumlah bagian sama persis dengan total', () => {
    const split = computeSplit(145_000, [host, ...others])
    expect(splitTotal(split)).toBe(145_000)
    const sum = split.participants.reduce((s, p) => s + amountFor(split, p.id), 0)
    expect(sum).toBe(145_000)
  })

  it('tetap benar untuk sisa yang lebih besar', () => {
    // 100.000 / 7 = 14.285,71 → 14.285 per orang, sisa 5 ke host.
    const seven = [
      host,
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `x${i}`,
        name: `Orang ${i}`,
        isHost: false,
      })),
    ]
    const split = computeSplit(100_000, seven)
    expect(split.amountPerPersonIdr).toBe(14_285)
    expect(split.hostRemainderIdr).toBe(5)
    expect(splitTotal(split)).toBe(100_000)
  })

  it('menangani daftar peserta kosong tanpa membagi dengan nol', () => {
    const split = computeSplit(100_000, [])
    expect(split.amountPerPersonIdr).toBe(0)
    expect(split.hostRemainderIdr).toBe(0)
  })

  it('mengembalikan nol untuk peserta yang tidak ada', () => {
    const split = computeSplit(150_000, [host])
    expect(amountFor(split, 'tidak-ada')).toBe(0)
  })
})

describe('menambah dan menghapus peserta', () => {
  it('menghitung ulang bagian saat peserta bertambah', () => {
    const split = computeSplit(150_000, [host])
    expect(split.amountPerPersonIdr).toBe(150_000)
    const next = addParticipant(split, others[0]!, 150_000)
    expect(next.participants).toHaveLength(2)
    expect(next.amountPerPersonIdr).toBe(75_000)
  })

  it('mengabaikan peserta duplikat', () => {
    const split = computeSplit(150_000, [host])
    const next = addParticipant(split, host, 150_000)
    expect(next.participants).toHaveLength(1)
  })

  it('mempertahankan status lunas peserta lain saat ada yang dihapus', () => {
    let split = computeSplit(150_000, [host, ...others])
    split = togglePaid(split, 'p2')
    split = togglePaid(split, 'p3')
    const next = removeParticipant(split, 'p3', 150_000)
    expect(next.paidBy).toEqual(['p2'])
    expect(next.amountPerPersonIdr).toBe(75_000)
  })
})

describe('progres pembayaran', () => {
  it('menghitung nominal terkumpul termasuk sisa host', () => {
    let split = computeSplit(145_000, [host, ...others])
    split = togglePaid(split, 'p1')
    expect(paidAmount(split)).toBe(48_334)
    expect(paidRatio(split)).toBeCloseTo(48_334 / 145_000, 5)
    expect(isFullyPaid(split)).toBe(false)
  })

  it('menandai lunas saat semua peserta membayar', () => {
    let split = computeSplit(145_000, [host, ...others])
    split = togglePaid(split, 'p1')
    split = togglePaid(split, 'p2')
    split = togglePaid(split, 'p3')
    expect(isFullyPaid(split)).toBe(true)
    expect(paidRatio(split)).toBe(1)
    expect(paidAmount(split)).toBe(145_000)
  })

  it('bisa membatalkan tanda lunas', () => {
    let split = computeSplit(150_000, [host])
    split = togglePaid(split, 'p1')
    split = togglePaid(split, 'p1')
    expect(split.paidBy).toHaveLength(0)
  })
})
