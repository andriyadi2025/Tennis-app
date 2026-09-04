import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AtSign, Smartphone } from 'lucide-react'
import type { SignInResult } from '@/lib/authApi'
import {
  fetchProviders,
  loginWithEmail,
  oauthUrl,
  registerWithEmail,
  requestOtp,
  verifyOtp,
} from '@/lib/authApi'
import { fetchMe } from '@/lib/authApi'
import { useAuthStore } from '@/store/auth'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { TextField } from '@/components/ui/primitives'
import { OtpInput } from '@/components/ui/OtpInput'

interface LocationState {
  from?: string
}

type Mode = 'pilih' | 'hp' | 'otp' | 'email'

/** 01 · Masuk. Empat metode, semuanya lewat server auth sungguhan. */
export function LoginScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const signIn = useAuthStore((s) => s.signIn)
  const user = useAuthStore((s) => s.user)

  const [mode, setMode] = useState<Mode>('pilih')
  const [phone, setPhone] = useState('')
  const [otpPhone, setOtpPhone] = useState('')
  const [devHint, setDevHint] = useState<string | null>(null)

  const from = (location.state as LocationState | null)?.from ?? '/'
  const providers = useQuery({ queryKey: ['auth-providers'], queryFn: fetchProviders })

  const accept = (result: SignInResult) => {
    signIn(result.user, result.token, result.identities)
    navigate(from, { replace: true })
  }

  /*
   * OAuth kembali sebagai redirect ke /login?token=… — token ditukar dengan
   * profil, lalu dibersihkan dari URL supaya tidak tertinggal di riwayat
   * peramban atau ikut tersalin saat halaman dibagikan.
   */
  const oauthToken = params.get('token')
  const oauthError = params.get('error')
  useEffect(() => {
    if (!oauthToken) return
    let cancelled = false
    void fetchMe(oauthToken)
      .then(({ user: profile, identities }) => {
        if (cancelled) return
        signIn(profile, oauthToken, identities)
        navigate(from, { replace: true })
      })
      .catch(() => {
        if (!cancelled)
          setParams(new URLSearchParams({ error: 'session_invalid' }), { replace: true })
      })
    return () => {
      cancelled = true
    }
  }, [oauthToken, signIn, navigate, from, setParams])

  if (user) return <Navigate to={from} replace />

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <div className="scroll-area flex flex-1 flex-col gap-6 px-6 pb-6 pt-8">
        <div className="flex shrink-0 justify-center">
          <img
            src="/logo-dbtc-512.jpg"
            alt="Lambang Dukuh Bima Tennis Club"
            width={132}
            height={132}
            className="h-32 w-32 rounded-pill"
          />
        </div>

        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-4xl">Dukuh Bima</h1>
          <p className="text-lg text-neutral-700">
            Booking lapangan, cari lawan, main bareng. Semua dari satu app.
          </p>
        </div>

        {oauthError && (
          <p role="alert" className="rounded-lg bg-accent-100 px-4 py-3 text-base text-accent-800">
            {oauthError === 'bad_state'
              ? 'Sesi masuk tidak cocok. Coba lagi dari awal.'
              : oauthError === 'exchange_failed'
                ? 'Penyedia menolak permintaan masuk. Coba lagi.'
                : 'Masuk dibatalkan.'}
          </p>
        )}

        {mode === 'pilih' && (
          <MethodPicker
            googleReady={providers.data?.google ?? false}
            facebookReady={providers.data?.facebook ?? false}
            onPhone={() => setMode('hp')}
            onEmail={() => setMode('email')}
          />
        )}

        {mode === 'hp' && (
          <PhoneStep
            phone={phone}
            setPhone={setPhone}
            smsDelivery={providers.data?.smsDelivery ?? 'log'}
            onSent={(normalised, devCode) => {
              setOtpPhone(normalised)
              setDevHint(devCode ?? null)
              setMode('otp')
            }}
            onBack={() => setMode('pilih')}
          />
        )}

        {mode === 'otp' && (
          <OtpStep
            phone={otpPhone}
            devCode={devHint}
            onDone={accept}
            onBack={() => setMode('hp')}
          />
        )}

        {mode === 'email' && <EmailStep onDone={accept} onBack={() => setMode('pilih')} />}

        <p className="px-2 text-center text-sm text-neutral-600">
          Dengan lanjut, kamu setuju pada Syarat Layanan dan Kebijakan Privasi DBTC.
        </p>
      </div>
    </div>
  )
}

/* ── Pilih metode ────────────────────────────────────────────────────────── */

function MethodPicker({
  googleReady,
  facebookReady,
  onPhone,
  onEmail,
}: {
  googleReady: boolean
  facebookReady: boolean
  onPhone: () => void
  onEmail: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <Button size="lg" block onClick={onPhone}>
        <Icon icon={Smartphone} size={18} />
        Lanjut dengan nomor HP
      </Button>
      <Button variant="secondary" size="lg" block onClick={onEmail}>
        <Icon icon={AtSign} size={18} />
        Lanjut dengan email
      </Button>

      <div className="flex items-center gap-3 py-1">
        <span className="h-px flex-1 bg-divider" />
        <span className="text-sm text-neutral-600">atau</span>
        <span className="h-px flex-1 bg-divider" />
      </div>

      <SocialButton provider="google" label="Masuk dengan Google" ready={googleReady} />
      <SocialButton provider="facebook" label="Masuk dengan Facebook" ready={facebookReady} />
    </div>
  )
}

/**
 * Tombol sosial tetap ditampilkan walau penyedianya belum dikonfigurasi,
 * tapi dinonaktifkan sambil menyebut alasannya. Menyembunyikannya akan
 * membuat orang mengira fiturnya tidak pernah ada.
 */
function SocialButton({
  provider,
  label,
  ready,
}: {
  provider: 'google' | 'facebook'
  label: string
  ready: boolean
}) {
  if (!ready) {
    return (
      <div className="flex flex-col gap-1">
        <Button variant="secondary" size="lg" block disabled>
          {label}
        </Button>
        <span className="px-2 text-center text-sm text-neutral-600">
          Belum dikonfigurasi di server ini.
        </span>
      </div>
    )
  }
  return (
    <a
      href={oauthUrl(provider)}
      className="inline-flex min-h-[54px] w-full items-center justify-center gap-2 rounded-pill border border-divider px-6 font-heading text-xl transition-colors hover:bg-neutral-200"
    >
      {label}
    </a>
  )
}

/* ── Nomor HP ────────────────────────────────────────────────────────────── */

function PhoneStep({
  phone,
  setPhone,
  smsDelivery,
  onSent,
  onBack,
}: {
  phone: string
  setPhone: (value: string) => void
  smsDelivery: 'twilio' | 'log'
  onSent: (normalised: string, devCode?: string) => void
  onBack: () => void
}) {
  const request = useMutation({
    mutationFn: () => requestOtp(phone),
    onSuccess: (result) => onSent(result.phone, result.devCode),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    request.mutate()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
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
        hint={
          smsDelivery === 'twilio'
            ? 'Kami kirim kode 6 angka lewat SMS.'
            : 'Penyedia SMS belum dipasang — kodenya ditampilkan di layar berikutnya.'
        }
        error={request.error?.message}
      />
      <Button type="submit" size="lg" block disabled={request.isPending || phone.trim() === ''}>
        {request.isPending ? 'Mengirim…' : 'Kirim kode'}
      </Button>
      <Button variant="ghost" block onClick={onBack}>
        Pakai cara lain
      </Button>
    </form>
  )
}

/* ── Kode OTP ────────────────────────────────────────────────────────────── */

function OtpStep({
  phone,
  devCode,
  onDone,
  onBack,
}: {
  phone: string
  devCode: string | null
  onDone: (result: SignInResult) => void
  onBack: () => void
}) {
  const [code, setCode] = useState('')
  const [cooldown, setCooldown] = useState(60)

  const verify = useMutation({ mutationFn: () => verifyOtp(phone, code), onSuccess: onDone })
  const resend = useMutation({
    mutationFn: () => requestOtp(phone),
    onSuccess: () => {
      setCooldown(60)
      setCode('')
    },
  })

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1_000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  // Enam angka lengkap langsung dikirim — tidak perlu menekan tombol lagi.
  useEffect(() => {
    if (code.length === 6 && !verify.isPending) verify.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 text-center">
        <h2 className="text-2xl">Masukkan kode</h2>
        <p className="text-base text-neutral-700">Kami kirim 6 angka ke {phone}.</p>
      </div>

      <OtpInput value={code} onChange={setCode} disabled={verify.isPending} />

      {devCode && (
        <p className="rounded-lg bg-accent2-200 px-4 py-3 text-center text-base text-accent2-900">
          Mode pengembangan — kodenya <strong className="font-heading">{devCode}</strong>. Di
          produksi ini dikirim lewat SMS dan tidak pernah tampil di sini.
        </p>
      )}

      <p aria-live="polite" className="min-h-[24px] text-center text-base text-accent-700">
        {verify.error?.message ?? resend.error?.message ?? ''}
      </p>

      <Button
        variant="secondary"
        block
        disabled={cooldown > 0 || resend.isPending}
        onClick={() => resend.mutate()}
      >
        {cooldown > 0 ? `Kirim ulang dalam ${cooldown} detik` : 'Kirim ulang kode'}
      </Button>
      <Button variant="ghost" block onClick={onBack}>
        Ganti nomor
      </Button>
    </div>
  )
}

/* ── Email ───────────────────────────────────────────────────────────────── */

function EmailStep({
  onDone,
  onBack,
}: {
  onDone: (result: SignInResult) => void
  onBack: () => void
}) {
  const [isRegister, setIsRegister] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const submitMutation = useMutation({
    mutationFn: () =>
      isRegister ? registerWithEmail(name, email, password) : loginWithEmail(email, password),
    onSuccess: onDone,
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    submitMutation.mutate()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div role="tablist" className="flex gap-1 rounded-pill bg-surface p-1">
        {(
          [
            [false, 'Masuk'],
            [true, 'Daftar'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={label}
            role="tab"
            type="button"
            aria-selected={isRegister === value}
            onClick={() => setIsRegister(value)}
            className={
              isRegister === value
                ? 'min-h-touch flex-1 rounded-pill bg-accent px-4 font-heading text-md text-bg'
                : 'min-h-touch flex-1 rounded-pill px-4 font-heading text-md text-neutral-700'
            }
          >
            {label}
          </button>
        ))}
      </div>

      {isRegister && (
        <TextField
          label="Nama"
          autoComplete="name"
          placeholder="Nama lengkap"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      )}

      <TextField
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="nama@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        leading={<Icon icon={AtSign} size={18} className="text-accent-700" />}
      />

      <TextField
        label="Kata sandi"
        type="password"
        autoComplete={isRegister ? 'new-password' : 'current-password'}
        placeholder="Minimal 8 karakter"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint={isRegister ? 'Minimal 8 karakter, memuat huruf dan angka.' : undefined}
        error={submitMutation.error?.message}
      />

      <Button type="submit" size="lg" block disabled={submitMutation.isPending}>
        {submitMutation.isPending ? 'Memproses…' : isRegister ? 'Daftar' : 'Masuk'}
      </Button>
      <Button variant="ghost" block onClick={onBack}>
        Pakai cara lain
      </Button>
    </form>
  )
}
