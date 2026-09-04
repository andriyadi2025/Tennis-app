import type { ClubSettings, Court, PrimeTime, Slot, Venue } from '../../../shared/types.ts'

/**
 * Ketersediaan slot, di server sungguhan.
 *
 * Perbedaan penting dari server tiruan yang digantikannya: dulu keterisian
 * ditebak dari hash id lapangan, supaya grid tampak seperti venue sungguhan
 * tanpa ada booking apa pun. Di sini yang menutup slot cuma dua hal — booking
 * yang benar-benar ada, dan jam yang sudah lewat. Grid yang lengang di server
 * baru memang menggambarkan keadaannya.
 */

const DEFAULT_PRIME: PrimeTime = { from: 18, to: 21, multiplier: 1.2 }

/** Jendela prime time boleh melewati tengah malam, mis. 20.00–01.00. */
export function isPrimeHour(hour: number, prime: PrimeTime): boolean {
  if (prime.from <= prime.to) return hour >= prime.from && hour <= prime.to
  return hour >= prime.from || hour <= prime.to
}

export function priceFor(venue: Venue, court: Court, hour: number, settings: ClubSettings): number {
  const base = court.pricePerHourIdr ?? venue.pricePerHourIdr
  // Venue selain milik klub memakai aturan bawaan: pengaturan klub tidak
  // berlaku atas harga milik pihak lain.
  const prime = venue.id === settings.venueId ? settings.primeTime : DEFAULT_PRIME
  // Dibulatkan ke Rp1.000 terdekat — harga lapangan tidak pernah berkoma.
  return isPrimeHour(hour, prime) ? Math.round((base * prime.multiplier) / 1_000) * 1_000 : base
}

export function buildSlots(
  venue: Venue,
  court: Court,
  dayIso: string,
  settings: ClubSettings,
  taken: ReadonlySet<string>,
): Slot[] {
  const day = new Date(dayIso)
  day.setHours(0, 0, 0, 0)
  const { open, close } = venue.openHours
  const now = Date.now()
  const slots: Slot[] = []

  for (let hour = open; hour < close; hour += 1) {
    const starts = new Date(day)
    starts.setHours(hour, 0, 0, 0)
    const iso = starts.toISOString()
    // Jam yang sudah lewat diperlakukan sebagai penuh, bukan disembunyikan —
    // supaya grid tetap punya bentuk yang sama sepanjang hari.
    const past = starts.getTime() < now
    slots.push({
      courtId: court.id,
      startsAt: iso,
      status: past || taken.has(iso) ? 'booked' : 'available',
      priceIdr: priceFor(venue, court, hour, settings),
    })
  }
  return slots
}

/** Jam-jam yang ditempati sebuah booking, satu ISO per jam. */
export function hoursOf(startsAt: string, hours: number): string[] {
  return Array.from({ length: hours }, (_, i) =>
    new Date(new Date(startsAt).getTime() + i * 3_600_000).toISOString(),
  )
}
