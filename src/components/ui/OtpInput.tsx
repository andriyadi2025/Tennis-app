import { useRef } from 'react'
import type { ClipboardEvent, KeyboardEvent } from 'react'
import clsx from 'clsx'

const LENGTH = 6

/**
 * Enam kotak angka. Kelihatannya sepele, tapi yang membuatnya terasa benar
 * justru hal-hal kecil: fokus berpindah sendiri, Backspace di kotak kosong
 * mundur ke kotak sebelumnya, dan menempel kode enam angka sekaligus mengisi
 * semuanya — bukan cuma kotak pertama.
 */
export function OtpInput({
  value,
  onChange,
  disabled = false,
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([])
  const digits = value.padEnd(LENGTH, ' ').slice(0, LENGTH).split('')

  function setDigit(index: number, digit: string) {
    const next = digits
      .map((d, i) => (i === index ? digit : d))
      .join('')
      .trimEnd()
    onChange(next.replace(/\s/g, ''))
    if (digit && index < LENGTH - 1) boxes.current[index + 1]?.focus()
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && !digits[index]?.trim() && index > 0) {
      event.preventDefault()
      boxes.current[index - 1]?.focus()
      setDigit(index - 1, '')
    }
    if (event.key === 'ArrowLeft' && index > 0) boxes.current[index - 1]?.focus()
    if (event.key === 'ArrowRight' && index < LENGTH - 1) boxes.current[index + 1]?.focus()
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, LENGTH)
    if (!pasted) return
    event.preventDefault()
    onChange(pasted)
    boxes.current[Math.min(pasted.length, LENGTH - 1)]?.focus()
  }

  return (
    <div className="flex justify-center gap-2" role="group" aria-label="Kode verifikasi 6 angka">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            boxes.current[index] = el
          }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          disabled={disabled}
          aria-label={`Angka ke-${index + 1}`}
          value={digit.trim()}
          onChange={(e) => setDigit(index, e.target.value.replace(/\D/g, '').slice(-1))}
          onKeyDown={(e) => onKeyDown(index, e)}
          onPaste={onPaste}
          className={clsx(
            'h-14 w-12 rounded-md bg-surface text-center font-heading text-2xl tabular-nums',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            disabled && 'opacity-50',
          )}
        />
      ))}
    </div>
  )
}
