import clsx from 'clsx'
import type { ToastState } from '@/hooks/useToast'

export function Toast({ toast }: { toast: ToastState | null }) {
  return (
    // Wadahnya selalu ada supaya pembaca layar mengumumkan perubahan isinya.
    <div
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-24 z-10 flex justify-center px-5"
    >
      {toast && (
        <p
          className={clsx(
            'rounded-pill px-5 py-3 text-base font-semibold shadow-md',
            toast.tone === 'sukses'
              ? 'bg-accent2-700 text-accent2-100'
              : 'bg-accent-700 text-accent-100',
          )}
        >
          {toast.message}
        </p>
      )}
    </div>
  )
}
