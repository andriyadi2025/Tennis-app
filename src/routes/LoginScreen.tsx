import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Smartphone } from 'lucide-react'
import type { User } from '@/types'
import { apiPost } from '@/lib/api'
import { useAuthStore } from '@/store/auth'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { TextField } from '@/components/ui/primitives'

interface LoginResponse {
  user: User
  token: string
}

/** Akun contoh yang selalu diterima mock backend. */
const DEMO_PHONE = '081288451190'

interface LocationState {
  from?: string
}

/** 01 · Masuk / onboarding. */
export function LoginScreen() {
  const [phone, setPhone] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const signIn = useAuthStore((s) => s.signIn)
  const user = useAuthStore((s) => s.user)

  const from = (location.state as LocationState | null)?.from ?? '/'

  const login = useMutation({
    mutationFn: (value: string) => apiPost<LoginResponse>('/api/auth/login', { phone: value }),
    onSuccess: (data) => {
      signIn(data.user, data.token)
      navigate(from, { replace: true })
    },
  })

  if (user) return <Navigate to={from} replace />

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    login.mutate(phone)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <div className="scroll-area flex flex-1 flex-col gap-8 px-6 pb-6 pt-10">
        {/* Blok bentuk bulat sebagai grafis pembuka — bukan ilustrasi. */}
        <div aria-hidden className="relative h-40 shrink-0">
          <span className="absolute left-0 top-2 h-32 w-32 rounded-pill bg-accent-300" />
          <span className="absolute left-20 top-10 h-24 w-24 rounded-pill bg-accent2-300 opacity-90" />
          <span className="absolute left-40 top-0 h-16 w-16 rounded-pill bg-accent-200" />
        </div>

        <div className="flex flex-col gap-3">
          <h1 className="text-4xl">Lapangin</h1>
          <p className="text-lg text-neutral-700">
            Booking lapangan, cari lawan, main bareng. Semua dari satu app.
          </p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <TextField
            label="Nomor HP"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0812 8845 1190"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            leading={<Icon icon={Smartphone} size={18} className="text-accent-700" />}
            hint="Kami kirim kode OTP untuk verifikasi."
            error={login.error?.message}
          />
          <Button type="submit" size="lg" block disabled={login.isPending}>
            {login.isPending ? 'Menghubungkan…' : 'Lanjut'}
          </Button>
          {/* Status dibacakan screen reader tanpa memindahkan fokus. */}
          <p aria-live="polite" className="sr-only">
            {login.isPending ? 'Sedang masuk' : login.isError ? 'Gagal masuk' : ''}
          </p>
        </form>

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-divider" />
          <span className="text-sm text-neutral-600">atau</span>
          <span className="h-px flex-1 bg-divider" />
        </div>

        <div className="flex flex-col gap-3">
          {/* Jalur demo: langsung memakai nomor akun contoh. */}
          <Button
            variant="secondary"
            size="lg"
            block
            disabled={login.isPending}
            onClick={() => login.mutate(DEMO_PHONE)}
          >
            Masuk dengan akun demo
          </Button>
          <p className="px-2 text-center text-sm text-neutral-600">
            Dengan lanjut, kamu setuju pada Syarat Layanan dan Kebijakan Privasi Lapangin.
          </p>
        </div>
      </div>
    </div>
  )
}
