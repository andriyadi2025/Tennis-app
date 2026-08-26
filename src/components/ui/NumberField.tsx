import { useId } from 'react'
import clsx from 'clsx'

/**
 * Input angka untuk form admin. Nilainya ditahan sebagai string supaya kotak
 * bisa dikosongkan sementara saat mengetik — memaksanya jadi number di tiap
 * ketukan membuat angka melompat sendiri dan mustahil disunting.
 */
export function NumberField({
  label,
  value,
  onChange,
  hint,
  suffix,
  prefix,
  min,
  max,
  disabled = false,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  hint?: string
  /** Satuan di kanan, mis. "/jam" atau "%". */
  suffix?: string
  /** Satuan di kiri, mis. "Rp". */
  prefix?: string
  min?: number
  max?: number
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-neutral-700">
        {label}
      </label>
      <div
        className={clsx(
          'flex min-h-touch items-center gap-2 rounded-pill bg-surface px-5',
          disabled && 'opacity-50',
        )}
      >
        {prefix && <span className="shrink-0 text-lg text-neutral-600">{prefix}</span>}
        {/*
          `step="any"` disengaja. `step` bukan sekadar loncatan tombol panah —
          ia juga membentuk kisi nilai yang dianggap sah. Dengan min=1000 dan
          step=5000, angka 60.000 tidak ada di kisi itu, dan peramban memblokir
          submit tanpa bilang apa-apa: tombol Simpan diam, form terlihat benar.
          Batas sungguhannya divalidasi server, yang pesannya bisa ditampilkan.
        */}
        <input
          id={id}
          type="number"
          inputMode="numeric"
          step="any"
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent text-lg tabular-nums text-text focus:outline-none"
        />
        {suffix && <span className="shrink-0 text-lg text-neutral-600">{suffix}</span>}
      </div>
      {hint && <span className="px-2 text-sm text-neutral-600">{hint}</span>}
    </div>
  )
}
