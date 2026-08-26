import clsx from 'clsx'
import type { PaymentMethod } from '@/types'
import { PAYMENT_LABEL } from '@/types'
import { Icon } from '@/components/ui/Icon'
import { PAYMENT_METHODS } from './paymentMethods'
import type { PaymentMethodOption } from './paymentMethods'

export function PaymentMethodPicker({
  name,
  value,
  onChange,
  disabled = false,
  compact = false,
  methods = PAYMENT_METHODS,
}: {
  /** Nama grup radio — wajib unik kalau ada dua picker di satu halaman. */
  name: string
  value: PaymentMethod
  onChange: (method: PaymentMethod) => void
  disabled?: boolean
  /** Versi ringkas tanpa keterangan, untuk sheet yang sempit. */
  compact?: boolean
  methods?: PaymentMethodOption[]
}) {
  return (
    <fieldset className="flex flex-col gap-2.5" disabled={disabled}>
      <legend className="sr-only">Pilih metode pembayaran</legend>
      {methods.map(({ id, icon, note }) => {
        const active = value === id
        return (
          <label
            key={id}
            className={clsx(
              'flex min-h-touch cursor-pointer items-center gap-3.5 rounded-lg px-4 transition-colors',
              compact ? 'py-2.5' : 'py-3.5',
              active ? 'bg-accent-100 ring-2 ring-accent' : 'bg-surface',
              disabled && 'opacity-50',
            )}
          >
            <input
              type="radio"
              name={name}
              value={id}
              checked={active}
              onChange={() => onChange(id)}
              className="sr-only"
            />
            <span
              aria-hidden
              className={clsx(
                'flex shrink-0 items-center justify-center rounded-pill',
                compact ? 'h-9 w-9' : 'h-11 w-11',
                active ? 'bg-accent text-bg' : 'bg-neutral-200 text-neutral-800',
              )}
            >
              <Icon icon={icon} size={compact ? 17 : 20} />
            </span>
            <span className="flex flex-1 flex-col">
              <span className="text-md font-bold">{PAYMENT_LABEL[id]}</span>
              {!compact && <span className="text-sm text-neutral-700">{note}</span>}
            </span>
            <span
              aria-hidden
              className={clsx(
                'h-5 w-5 shrink-0 rounded-pill border-2',
                active ? 'border-accent bg-accent ring-4 ring-inset ring-bg' : 'border-neutral-400',
              )}
            />
          </label>
        )
      })}
    </fieldset>
  )
}
