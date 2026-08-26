import type { LoyaltyTier } from '@/types'

/** 1 poin per Rp1.000 belanja. */
export const IDR_PER_POINT = 1_000
/** Penukaran hanya kelipatan 100 poin. */
export const REDEEM_STEP_POINTS = 100
/** 100 poin = Rp10.000. */
export const IDR_PER_REDEEM_STEP = 10_000
/** Potongan maksimum 30% dari subtotal. */
export const MAX_REDEEM_RATIO = 0.3

/** Poin yang didapat dari sebuah transaksi (dibulatkan ke bawah). */
export function pointsEarned(subtotalIdr: number): number {
  if (subtotalIdr <= 0) return 0
  return Math.floor(subtotalIdr / IDR_PER_POINT)
}

/** Rupiah yang diwakili sejumlah poin. */
export function pointsToIdr(points: number): number {
  return (points / REDEEM_STEP_POINTS) * IDR_PER_REDEEM_STEP
}

/**
 * Poin maksimum yang boleh ditukar: dibatasi saldo user, kelipatan 100,
 * dan tidak melebihi 30% subtotal.
 */
export function maxRedeemablePoints(balance: number, subtotalIdr: number): number {
  if (balance < REDEEM_STEP_POINTS || subtotalIdr <= 0) return 0
  const capIdr = subtotalIdr * MAX_REDEEM_RATIO
  const capPoints = Math.floor(capIdr / IDR_PER_REDEEM_STEP) * REDEEM_STEP_POINTS
  const balancePoints = Math.floor(balance / REDEEM_STEP_POINTS) * REDEEM_STEP_POINTS
  return Math.max(0, Math.min(capPoints, balancePoints))
}

export interface RedeemResult {
  /** Poin yang benar-benar terpakai setelah dibulatkan & dibatasi. */
  points: number
  discountIdr: number
  /** Alasan kalau permintaan dipangkas — dipakai untuk pesan di UI. */
  clampedBy: 'none' | 'balance' | 'cap' | 'step'
}

/** Menukar poin jadi potongan, dengan seluruh aturan pembatas diterapkan. */
export function redeemPoints(
  requestedPoints: number,
  balance: number,
  subtotalIdr: number,
): RedeemResult {
  const requested = Math.max(0, Math.floor(requestedPoints))
  if (requested === 0) return { points: 0, discountIdr: 0, clampedBy: 'none' }

  const stepped = Math.floor(requested / REDEEM_STEP_POINTS) * REDEEM_STEP_POINTS
  const max = maxRedeemablePoints(balance, subtotalIdr)
  const points = Math.min(stepped, max)

  let clampedBy: RedeemResult['clampedBy'] = 'none'
  if (points < requested) {
    if (stepped < requested && stepped <= max) clampedBy = 'step'
    else if (balance < requested) clampedBy = 'balance'
    else clampedBy = 'cap'
  }

  return { points, discountIdr: pointsToIdr(points), clampedBy }
}

const TIER_THRESHOLDS: ReadonlyArray<{ tier: LoyaltyTier; min: number }> = [
  { tier: 'Legend', min: 5_000 },
  { tier: 'Pro', min: 2_000 },
  { tier: 'Reguler', min: 500 },
  { tier: 'Rookie', min: 0 },
]

export function tierFor(points: number): LoyaltyTier {
  return TIER_THRESHOLDS.find((t) => points >= t.min)?.tier ?? 'Rookie'
}

export interface TierProgress {
  tier: LoyaltyTier
  next: LoyaltyTier | null
  pointsToNext: number
  /** 0–1, untuk progress bar. */
  ratio: number
}

export function tierProgress(points: number): TierProgress {
  const tier = tierFor(points)
  const idx = TIER_THRESHOLDS.findIndex((t) => t.tier === tier)
  const current = TIER_THRESHOLDS[idx]
  const upper = idx > 0 ? TIER_THRESHOLDS[idx - 1] : undefined
  if (!current || !upper) {
    return { tier, next: null, pointsToNext: 0, ratio: 1 }
  }
  const span = upper.min - current.min
  const gained = points - current.min
  return {
    tier,
    next: upper.tier,
    pointsToNext: Math.max(0, upper.min - points),
    ratio: span > 0 ? Math.min(1, Math.max(0, gained / span)) : 1,
  }
}
