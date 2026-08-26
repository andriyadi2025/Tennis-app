import { describe, expect, it } from 'vitest'
import { maxRedeemablePoints, pointsEarned, redeemPoints, tierFor, tierProgress } from './points'

describe('pointsEarned', () => {
  it('memberi 1 poin per Rp1.000, dibulatkan ke bawah', () => {
    expect(pointsEarned(145_000)).toBe(145)
    expect(pointsEarned(145_999)).toBe(145)
  })

  it('tidak memberi poin untuk nilai nol atau negatif', () => {
    expect(pointsEarned(0)).toBe(0)
    expect(pointsEarned(-5_000)).toBe(0)
  })
})

describe('maxRedeemablePoints', () => {
  it('membatasi penukaran pada 30% subtotal', () => {
    // 30% dari 200.000 = 60.000 → 600 poin.
    expect(maxRedeemablePoints(10_000, 200_000)).toBe(600)
  })

  it('membulatkan batas ke kelipatan 100 poin', () => {
    // 30% dari 150.000 = 45.000 → 450 poin, dibulatkan turun ke 400.
    expect(maxRedeemablePoints(10_000, 150_000)).toBe(400)
  })

  it('tidak melebihi saldo user', () => {
    expect(maxRedeemablePoints(250, 1_000_000)).toBe(200)
  })

  it('mengembalikan nol kalau saldo di bawah satu langkah', () => {
    expect(maxRedeemablePoints(99, 1_000_000)).toBe(0)
  })
})

describe('redeemPoints', () => {
  it('menukar kelipatan 100 poin menjadi Rp10.000 per langkah', () => {
    const result = redeemPoints(300, 2_000, 200_000)
    expect(result.points).toBe(300)
    expect(result.discountIdr).toBe(30_000)
    expect(result.clampedBy).toBe('none')
  })

  it('membulatkan permintaan ke bawah ke kelipatan 100', () => {
    const result = redeemPoints(250, 2_000, 200_000)
    expect(result.points).toBe(200)
    expect(result.discountIdr).toBe(20_000)
    expect(result.clampedBy).toBe('step')
  })

  it('memangkas di batas 30% dan menandainya sebagai cap', () => {
    // Batas: 30% dari 100.000 = 30.000 → 300 poin.
    const result = redeemPoints(1_000, 5_000, 100_000)
    expect(result.points).toBe(300)
    expect(result.discountIdr).toBe(30_000)
    expect(result.clampedBy).toBe('cap')
  })

  it('memangkas di saldo dan menandainya sebagai balance', () => {
    const result = redeemPoints(900, 400, 1_000_000)
    expect(result.points).toBe(400)
    expect(result.clampedBy).toBe('balance')
  })

  it('menolak permintaan nol atau negatif tanpa error', () => {
    expect(redeemPoints(0, 5_000, 100_000).points).toBe(0)
    expect(redeemPoints(-500, 5_000, 100_000).points).toBe(0)
  })
})

describe('tier', () => {
  it('memetakan poin ke tier yang benar', () => {
    expect(tierFor(0)).toBe('Rookie')
    expect(tierFor(499)).toBe('Rookie')
    expect(tierFor(500)).toBe('Reguler')
    expect(tierFor(2_340)).toBe('Pro')
    expect(tierFor(5_000)).toBe('Legend')
  })

  it('menghitung sisa poin menuju tier berikutnya', () => {
    const progress = tierProgress(2_340)
    expect(progress.tier).toBe('Pro')
    expect(progress.next).toBe('Legend')
    expect(progress.pointsToNext).toBe(2_660)
    expect(progress.ratio).toBeCloseTo(340 / 3_000, 5)
  })

  it('menandai tier tertinggi sebagai selesai', () => {
    const progress = tierProgress(9_000)
    expect(progress.next).toBeNull()
    expect(progress.ratio).toBe(1)
  })
})
