import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AtSign, Plus, Smartphone, Unlink } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { LinkState, SignInMethod } from '@/lib/authApi'
import {
  fetchLinkState,
  fetchProviders,
  linkEmail,
  requestLinkOtp,
  startLinkOAuth,
  unlinkMethod,
  verifyLinkOtp,
} from '@/lib/authApi'
import { useAuthStore } from '@/store/auth'
import { useToast } from '@/hooks/useToast'
import { Screen, ScreenHeader } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { OtpInput } from '@/components/ui/OtpInput'
import { Toast } from '@/components/ui/Toast'
import { Chip, TextField } from '@/components/ui/primitives'
import { ErrorState, SkeletonBlock } from '@/components/ui/states'

const METHOD_LABEL: Record<SignInMethod, string> = {
  phone: 'Nomor HP',
  email: 'Email & kata sandi',
  google: 'Google',
  facebook: 'Facebook',
}

const METHOD_ICON: Record<SignInMethod, LucideIcon> = {
  phone: Smartphone,
  email: AtSign,
  google: AtSign,
  facebook: AtSign,
}

/** Pesan balik dari putaran OAuth penyambungan. */
const OAUTH_MESSAGE: Record<string, string> = {
  provider_taken: 'Akun penyedia itu sudah tersambung ke akun DBTC lain.',
  link_user_missing: 'Sesi penyambungan sudah tidak berlaku. Coba lagi.',
  exchange_failed: 'Penyedia menolak permintaan. Coba lagi.',
  bad_state: 'Permintaan tidak cocok dengan yang dimulai dari sini. Coba lagi.',
}

/**
 * Menyambungkan beberapa cara masuk ke satu akun.
 *
 * Layar sendiri, bukan disisipkan ke Profil: menambah nomor butuh langkah
 * OTP dan menambah email butuh kata sandi — keduanya alur bertingkat yang
 * tidak muat di dalam daftar.
 */
export function AccountLinkScreen() {
  const token = useAuthStore((s) => s.token)
  const setUser = useAuthStore((s) => s.setUser)
  const client = useQueryClient()
  const [params, setParams] = useSearchParams()
  const { toast, show } = useToast()
  const [adding, setAdding] = useState<'phone' | 'email' | null>(null)

  const providers = useQuery({ queryKey: ['auth-providers'], queryFn: fetchProviders })
  const state = useQuery({
    queryKey: ['link-state'],
    queryFn: () => fetchLinkState(token!),
    enabled: Boolean(token),
  })

  /*
   * Putaran OAuth kembali ke sini lewat query string. Dibaca sekali lalu
   * dibersihkan, supaya me-refresh halaman tidak memunculkan pesan yang sama
   * berulang-ulang.
   */
  useEffect(() => {
    const linked = params.get('linked')
    const error = params.get('error')
    if (!linked && !error) return
    if (linked) {
      show(`${METHOD_LABEL[linked as SignInMethod] ?? linked} berhasil disambungkan.`)
      void state.refetch()
    } else if (error) {
      show(OAUTH_MESSAGE[error] ?? 'Penyambungan gagal.')
    }
    setParams({}, { replace: true })
    // Sengaja hanya bergantung pada params: efek ini membaca pesan sekali.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  function applied(next: LinkState, message: string) {
    client.setQueryData(['link-state'], next)
    // Profil di layar lain membaca user dari store, jadi ia ikut disegarkan.
    setUser(next.user)
    setAdding(null)
    show(message)
  }

  const unlink = useMutation({
    mutationFn: (method: SignInMethod) => unlinkMethod(token!, method),
    onSuccess: (next) => applied(next, 'Cara masuk dilepas.'),
    onError: (error) => show(error.message),
  })

  const startOAuth = useMutation({
    mutationFn: (provider: 'google' | 'facebook') => startLinkOAuth(token!, provider),
    onSuccess: ({ url }) => {
      window.location.href = url
    },
    onError: (error) => show(error.message),
  })

  if (state.isLoading) {
    return (
      <Screen>
        <ScreenHeader title="Cara masuk" />
        <SkeletonBlock className="h-40 w-full rounded-lg" />
      </Screen>
    )
  }

  if (state.error || !state.data) {
    return (
      <Screen>
        <ScreenHeader title="Cara masuk" />
        <ErrorState
          body={state.error?.message ?? 'Tidak bisa memuat cara masuk.'}
          onRetry={() => void state.refetch()}
        />
      </Screen>
    )
  }

  const methods = state.data.methods
  const satuSatunya = methods.length <= 1

  return (
    <Screen overlay={<Toast toast={toast} />}>
      <ScreenHeader title="Cara masuk" />

      <p className="-mt-2 text-base text-neutral-700">
        Satu akun boleh punya beberapa cara masuk. Semuanya mendarat di akun yang sama — booking,
        poin, dan riwayat mainmu tidak terpecah.
      </p>

      <section className="flex flex-col gap-2.5">
        <h2 className="text-xl">Sudah tersambung</h2>
        {methods.map((method) => (
          <div key={method} className="flex items-center gap-3.5 rounded-lg bg-surface p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-accent2-200 text-accent2-800">
              <Icon icon={METHOD_ICON[method]} size={19} />
            </span>
            <div className="flex flex-1 flex-col">
              <span className="text-md font-bold">{METHOD_LABEL[method]}</span>
              <span className="text-sm text-neutral-700">{detailFor(method, state.data)}</span>
            </div>
            <button
              type="button"
              aria-label={`Lepas ${METHOD_LABEL[method]}`}
              disabled={satuSatunya || unlink.isPending}
              onClick={() => unlink.mutate(method)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-bg disabled:opacity-35"
            >
              <Icon icon={Unlink} size={17} />
            </button>
          </div>
        ))}

        {satuSatunya && (
          <p className="text-sm text-neutral-600">
            Ini satu-satunya cara masuk ke akunmu, jadi belum bisa dilepas. Sambungkan cara lain
            dulu — tidak ada layar pemulihan yang bisa menolong akun tanpa cara masuk.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2.5">
        <h2 className="text-xl">Tambah cara masuk</h2>

        {!methods.includes('phone') &&
          (adding === 'phone' ? (
            <AddPhone
              token={token!}
              onCancel={() => setAdding(null)}
              onDone={(next) => applied(next, 'Nomor HP tersambung.')}
            />
          ) : (
            <AddButton icon={Smartphone} label="Nomor HP" onClick={() => setAdding('phone')} />
          ))}

        {!methods.includes('email') &&
          (adding === 'email' ? (
            <AddEmail
              token={token!}
              onCancel={() => setAdding(null)}
              onDone={(next) =>
                applied(next, 'Email tersambung. Cek kotak masuk untuk verifikasi.')
              }
            />
          ) : (
            <AddButton
              icon={AtSign}
              label="Email & kata sandi"
              onClick={() => setAdding('email')}
            />
          ))}

        {(['google', 'facebook'] as const).map((provider) =>
          methods.includes(provider) ? null : (
            <div key={provider} className="flex flex-col gap-1">
              <Button
                variant="secondary"
                block
                disabled={!providers.data?.[provider] || startOAuth.isPending}
                onClick={() => startOAuth.mutate(provider)}
              >
                <Icon icon={Plus} size={16} />
                Sambungkan {METHOD_LABEL[provider]}
              </Button>
              {providers.data && !providers.data[provider] && (
                <span className="text-center text-sm text-neutral-600">
                  Belum dikonfigurasi di server ini.
                </span>
              )}
            </div>
          ),
        )}

        {methods.length === 4 && (
          <p className="text-base text-neutral-700">
            Semua cara masuk sudah tersambung ke akun ini.
          </p>
        )}
      </section>
    </Screen>
  )
}

function detailFor(method: SignInMethod, state: LinkState): string {
  if (method === 'phone') return state.user.phone ?? 'Tersambung'
  if (method === 'email') return state.user.email ?? 'Tersambung'
  return state.identities.find((i) => i.provider === method)?.email ?? 'Tertaut'
}

function AddButton({
  icon,
  label,
  onClick,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  return (
    <Button variant="secondary" block onClick={onClick}>
      <Icon icon={icon} size={16} />
      Tambah {label}
    </Button>
  )
}

/** Menyambungkan nomor: minta kode, lalu buktikan nomornya benar milikmu. */
function AddPhone({
  token,
  onCancel,
  onDone,
}: {
  token: string
  onCancel: () => void
  onDone: (next: LinkState) => void
}) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [devCode, setDevCode] = useState<string | null>(null)

  const request = useMutation({
    mutationFn: () => requestLinkOtp(token, phone),
    onSuccess: (result) => {
      setSent(result.phone)
      setDevCode(result.devCode ?? null)
    },
  })

  const verify = useMutation({
    mutationFn: () => verifyLinkOtp(token, sent!, code),
    onSuccess: onDone,
  })

  return (
    <div className="flex flex-col gap-3.5 rounded-lg bg-surface p-4">
      <h3 className="text-md font-bold">Tambah nomor HP</h3>

      {sent === null ? (
        <>
          <TextField
            label="Nomor HP"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0812 8845 1190"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={request.error?.message}
          />
          <div className="flex gap-3">
            <Button variant="secondary" block onClick={onCancel} disabled={request.isPending}>
              Batal
            </Button>
            <Button block disabled={request.isPending} onClick={() => request.mutate()}>
              {request.isPending ? 'Mengirim…' : 'Kirim kode'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-base text-neutral-700">Kami kirim 6 angka ke {sent}.</p>
          {devCode && (
            <p className="rounded-md bg-accent2-200 px-3.5 py-2.5 text-sm text-accent2-900">
              Mode pengembangan — kodenya <strong>{devCode}</strong>. Di produksi ini dikirim lewat
              SMS dan tidak pernah tampil di sini.
            </p>
          )}
          <OtpInput value={code} onChange={setCode} disabled={verify.isPending} />
          {verify.error && (
            <p role="alert" className="text-base text-accent-700">
              {verify.error.message}
            </p>
          )}
          <div className="flex gap-3">
            <Button variant="secondary" block onClick={onCancel} disabled={verify.isPending}>
              Batal
            </Button>
            <Button
              block
              disabled={code.length !== 6 || verify.isPending}
              onClick={() => verify.mutate()}
            >
              {verify.isPending ? 'Memeriksa…' : 'Sambungkan'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

/** Menyambungkan email selalu sekalian kata sandinya — lihat catatan di server. */
function AddEmail({
  token,
  onCancel,
  onDone,
}: {
  token: string
  onCancel: () => void
  onDone: (next: LinkState) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const link = useMutation({
    mutationFn: () => linkEmail(token, email, password),
    onSuccess: onDone,
  })

  return (
    <div className="flex flex-col gap-3.5 rounded-lg bg-surface p-4">
      <h3 className="text-md font-bold">Tambah email & kata sandi</h3>
      <p className="text-base text-neutral-700">
        Kata sandi ikut dibuat sekarang — email saja belum bisa dipakai masuk.
      </p>

      <TextField
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="nama@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <TextField
        label="Kata sandi"
        type="password"
        autoComplete="new-password"
        placeholder="Minimal 8 karakter, ada huruf dan angka"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={link.error?.message}
      />

      <div className="flex items-center gap-2">
        <Chip tone="sage">Perlu verifikasi</Chip>
        <span className="text-sm text-neutral-600">Kode verifikasi dikirim setelah disimpan.</span>
      </div>

      <div className="flex gap-3">
        <Button variant="secondary" block onClick={onCancel} disabled={link.isPending}>
          Batal
        </Button>
        <Button block disabled={link.isPending} onClick={() => link.mutate()}>
          {link.isPending ? 'Menyimpan…' : 'Sambungkan'}
        </Button>
      </div>
    </div>
  )
}
