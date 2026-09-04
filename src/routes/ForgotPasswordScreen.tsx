import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { AtSign, KeyRound } from 'lucide-react'
import { forgotPassword, resetPassword } from '@/lib/authApi'
import { useAuthStore } from '@/store/auth'
import { Screen, ScreenHeader, StickyBar } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { TextField } from '@/components/ui/primitives'

const FORM_ID = 'form-lupa-sandi'

/**
 * Lupa kata sandi, dua langkah dalam satu layar.
 *
 * Digabung karena keduanya satu urusan: orang yang baru meminta kode sedang
 * menunggu di layar ini juga. Memisahkannya jadi dua rute berarti kode yang
 * baru saja muncul di email harus disalin melewati perpindahan halaman.
 */
export function ForgotPasswordScreen() {
  const navigate = useNavigate()
  const signIn = useAuthStore((s) => s.signIn)

  const [step, setStep] = useState<'minta' | 'atur'>('minta')
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState('')

  const request = useMutation({
    mutationFn: () => forgotPassword(email),
    onSuccess: (result) => {
      setStep('atur')
      setNotice(result.message)
      // Di luar produksi kodenya ikut dikembalikan supaya alurnya bisa
      // diselesaikan tanpa SMTP. Di produksi ini tidak pernah ada.
      if (result.devToken) setToken(result.devToken)
    },
  })

  const reset = useMutation({
    mutationFn: () => resetPassword(token, password),
    onSuccess: (result) => {
      signIn(result.user, result.token, result.identities)
      navigate('/', { replace: true })
    },
  })

  const busy = request.isPending || reset.isPending

  return (
    <Screen
      bottom={
        <StickyBar>
          <Button type="submit" form={FORM_ID} size="lg" block disabled={busy}>
            {step === 'minta'
              ? request.isPending
                ? 'Mengirim…'
                : 'Kirim kode'
              : reset.isPending
                ? 'Menyimpan…'
                : 'Simpan kata sandi baru'}
          </Button>
        </StickyBar>
      }
    >
      <ScreenHeader title="Lupa kata sandi" />

      <form
        id={FORM_ID}
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault()
          if (step === 'minta') request.mutate()
          else reset.mutate()
        }}
      >
        {step === 'minta' ? (
          <>
            <p className="text-base text-neutral-700">
              Masukkan email akunmu. Kami kirim kode untuk membuat kata sandi baru.
            </p>
            <TextField
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="nama@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              leading={<Icon icon={AtSign} size={18} className="text-neutral-600" />}
              error={request.error?.message}
            />
          </>
        ) : (
          <>
            {notice && (
              <p className="rounded-lg bg-accent2-200 px-4 py-3 text-base text-accent2-900">
                {notice}
              </p>
            )}

            <TextField
              label="Kode dari email"
              autoComplete="one-time-code"
              placeholder="Tempel kode di sini"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              leading={<Icon icon={KeyRound} size={18} className="text-neutral-600" />}
            />

            <TextField
              label="Kata sandi baru"
              type="password"
              autoComplete="new-password"
              placeholder="Minimal 8 karakter, ada huruf dan angka"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={reset.error?.message}
            />

            <p className="text-sm text-neutral-600">
              Setelah kata sandi diganti, semua perangkat yang masih masuk akan dikeluarkan —
              termasuk yang bukan kamu.
            </p>

            <button
              type="button"
              onClick={() => setStep('minta')}
              className="min-h-touch text-base font-semibold text-accent-700 underline"
            >
              Salah email? Ganti alamatnya
            </button>
          </>
        )}
      </form>

      <Link to="/login" className="text-center text-base font-semibold text-accent-700 underline">
        Kembali ke halaman masuk
      </Link>
    </Screen>
  )
}
