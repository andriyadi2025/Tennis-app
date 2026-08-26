import type { LucideIcon } from 'lucide-react'
import { CircleDot, Dumbbell, Goal, Target, Trophy, Volleyball, Zap } from 'lucide-react'
import type { Sport } from '@/types'

/**
 * Pemetaan cabang → ikon Lucide. Lucide tidak punya ikon raket badminton,
 * jadi cabang tanpa padanan langsung memakai glyph terdekat yang tetap
 * terbaca dalam satu keluarga bentuk — bukan ikon buatan sendiri.
 */
export const SPORT_ICON: Record<Sport, LucideIcon> = {
  badminton: Zap,
  futsal: Goal,
  basketball: CircleDot,
  tennis: Target,
  padel: Dumbbell,
  volleyball: Volleyball,
  miniSoccer: Trophy,
}

/** Nada warna bergantian supaya baris kategori tidak monoton satu warna. */
export function sportTone(sport: Sport): 'accent' | 'sage' {
  const index = Object.keys(SPORT_ICON).indexOf(sport)
  return index % 2 === 0 ? 'accent' : 'sage'
}
