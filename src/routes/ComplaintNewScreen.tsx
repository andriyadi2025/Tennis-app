import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import type { ComplaintCategory } from '@/types'
import { COMPLAINT_CATEGORY_LABEL } from '@/types'
import { useBookings, useCreateComplaint, useMerchOrders } from '@/hooks/queries'
import { validateDraft } from '@/lib/complaints'
import { formatDateShort } from '@/lib/dates'
import { Screen, ScreenHeader, StickyBar } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/primitives'

const CATEGORIES = Object.keys(COMPLAINT_CATEGORY_LABEL) as ComplaintCategory[]
const FORM_ID = 'form-aduan'

/**
 * Menulis aduan baru.
 *
 * Rujukan ke booking atau pesanan bersifat pilihan, tapi ditawarkan lebih
 * dulu: aduan yang menyebut kode transaksi bisa ditindaklanjuti tanpa
 * bertanya balik, dan itu menghemat satu putaran percakapan.
 */
export function ComplaintNewScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const create = useCreateComplaint()
  const bookings = useBookings()
  const orders = useMerchOrders()

  const [category, setCategory] = useState<ComplaintCategory>(
    (params.get('kategori') as ComplaintCategory | null) ?? 'lapangan',
  )
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [related, setRelated] = useState(params.get('terkait') ?? '')
  const [touched, setTouched] = useState(false)

  const invalid = validateDraft({ subject, body })
  const showError = touched && invalid

  function submit() {
    setTouched(true)
    if (invalid) return
    const [kind, id] = related ? related.split(':') : [null, null]
    create.mutate(
      {
        category,
        subject,
        body,
        relatedKind: kind === 'booking' || kind === 'merchOrder' ? kind : null,
        relatedId: id ?? null,
      },
      { onSuccess: (complaint) => navigate(`/bantuan/${complaint.id}`, { replace: true }) },
    )
  }

  return (
    <Screen
      bottom={
        <StickyBar>
          <Button type="submit" form={FORM_ID} size="lg" block disabled={create.isPending}>
            {create.isPending ? 'Mengirim…' : 'Kirim ke klub'}
          </Button>
        </StickyBar>
      }
    >
      <ScreenHeader title="Tulis pesan" />

      {/* noValidate: batas panjang divalidasi di sini dan di server, dengan
          pesan yang bisa dibaca — bukan diblokir diam-diam oleh peramban. */}
      <form
        id={FORM_ID}
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <section className="flex flex-col gap-2.5">
          <h2 className="text-xl">Kategori</h2>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={category === value}
                onClick={() => setCategory(value)}
                className={clsx(
                  'min-h-touch rounded-pill px-4 text-base font-semibold transition-colors',
                  category === value
                    ? 'bg-accent2-600 text-accent2-100'
                    : 'border border-divider text-text hover:bg-neutral-200',
                )}
              >
                {COMPLAINT_CATEGORY_LABEL[value]}
              </button>
            ))}
          </div>
        </section>

        <TextField
          label="Judul"
          placeholder="Mis. Lampu Lap. 2 mati"
          value={subject}
          maxLength={80}
          onChange={(e) => setSubject(e.target.value)}
          error={showError && invalid.startsWith('Judul') ? invalid : undefined}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="aduan-isi" className="text-sm text-neutral-700">
            Ceritakan masalahnya
          </label>
          <textarea
            id="aduan-isi"
            rows={6}
            maxLength={2_000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Kapan kejadiannya, di lapangan mana, dan apa yang kamu alami."
            className="rounded-lg bg-surface px-4 py-3.5 text-lg text-text placeholder:text-neutral-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <div className="flex justify-between gap-3 px-2">
            <span className="text-sm text-accent-700">
              {showError && !invalid.startsWith('Judul') ? invalid : ''}
            </span>
            <span className="shrink-0 text-sm text-neutral-600 tabular-nums">
              {body.length}/2.000
            </span>
          </div>
        </div>

        <section className="flex flex-col gap-1.5">
          <label htmlFor="aduan-terkait" className="text-sm text-neutral-700">
            Kaitkan dengan transaksi (opsional)
          </label>
          <select
            id="aduan-terkait"
            value={related}
            onChange={(e) => setRelated(e.target.value)}
            className="min-h-touch rounded-pill bg-surface px-5 text-lg text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Tidak terkait transaksi</option>
            {(bookings.data ?? []).map((b) => (
              <option key={b.id} value={`booking:${b.id}`}>
                Booking {b.code} · {b.venueName} · {formatDateShort(b.range.startsAt)}
              </option>
            ))}
            {(orders.data ?? []).map((o) => (
              <option key={o.id} value={`merchOrder:${o.id}`}>
                Pesanan {o.code} · {o.itemName}
              </option>
            ))}
          </select>
          <span className="px-2 text-sm text-neutral-600">
            Menyebut kode transaksi membuat klub tidak perlu bertanya balik.
          </span>
        </section>

        {create.error && (
          <p role="alert" className="text-base text-accent-700">
            {create.error.message}
          </p>
        )}
      </form>
    </Screen>
  )
}
