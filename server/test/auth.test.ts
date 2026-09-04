import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { resetDatabase } from '../src/db.ts'
import { hashPassword, verifyPassword, codeChallenge, newOtpCode } from '../src/crypto.ts'
import {
  checkPassword,
  createSession,
  createUser,
  issueOtp,
  normaliseEmail,
  normalisePhone,
  revokeSession,
  userForSession,
  verifyOtp,
  consumeEmailToken,
  issueEmailToken,
  OTP_MAX_ATTEMPTS,
} from '../src/auth.ts'

beforeAll(() => {
  process.env.NODE_ENV = 'test'
})

afterEach(async () => {
  await resetDatabase()
})

describe('normalisePhone', () => {
  it('menyatukan bentuk 08…, 62…, dan +62… jadi satu', async () => {
    const target = '+628128845119'
    expect(normalisePhone('08128845119')).toBe(target)
    expect(normalisePhone('628128845119')).toBe(target)
    expect(normalisePhone('+62 812 8845 119')).toBe(target)
    expect(normalisePhone('0812-8845-119')).toBe(target)
  })

  it('menolak nomor yang bukan seluler Indonesia', async () => {
    expect(normalisePhone('0217654321')).toBeNull() // diawali 2, bukan 8
    expect(normalisePhone('0812')).toBeNull() // terlalu pendek
    expect(normalisePhone('081288451190000000')).toBeNull() // terlalu panjang
    expect(normalisePhone('bukan nomor')).toBeNull()
  })
})

describe('normaliseEmail', () => {
  it('menurunkan huruf besar dan memangkas spasi', async () => {
    expect(normaliseEmail('  Raka@Email.COM ')).toBe('raka@email.com')
  })

  it('menolak bentuk yang jelas bukan email', async () => {
    expect(normaliseEmail('raka')).toBeNull()
    expect(normaliseEmail('raka@')).toBeNull()
    expect(normaliseEmail('raka@email')).toBeNull()
  })
})

describe('checkPassword', () => {
  it('menuntut panjang minimal serta huruf dan angka', async () => {
    expect(checkPassword('pendek1')).not.toBeNull()
    expect(checkPassword('semuahurufsaja')).not.toBeNull()
    expect(checkPassword('12345678')).not.toBeNull()
    expect(checkPassword('rahasia123')).toBeNull()
  })
})

describe('hash kata sandi', () => {
  it('memverifikasi sandi yang benar dan menolak yang salah', async () => {
    const hash = await hashPassword('rahasia123')
    expect(await verifyPassword('rahasia123', hash)).toBe(true)
    expect(await verifyPassword('rahasia124', hash)).toBe(false)
  })

  it('menghasilkan hash berbeda untuk sandi yang sama', async () => {
    // Salt acak — dua akun bersandi sama tidak boleh terlihat sama.
    expect(await hashPassword('rahasia123')).not.toBe(await hashPassword('rahasia123'))
  })

  it('menolak hash yang bentuknya rusak tanpa melempar', async () => {
    expect(await verifyPassword('rahasia123', 'bukan-hash')).toBe(false)
    expect(await verifyPassword('rahasia123', 'scrypt$xx')).toBe(false)
  })
})

describe('sesi', () => {
  it('menukar token dengan user, lalu berhenti setelah dicabut', async () => {
    const user = await createUser({ name: 'Raka', phone: '+628128845119', phoneVerified: true })
    const { token } = await createSession(user.id)

    expect((await userForSession(token))?.id).toBe(user.id)
    await revokeSession(token)
    expect(await userForSession(token)).toBeUndefined()
  })

  it('menolak token karangan', async () => {
    expect(await userForSession('token-asal')).toBeUndefined()
  })
})

describe('OTP', () => {
  const phone = '+628128845119'

  it('menerbitkan kode 6 digit', async () => {
    const issued = await issueOtp(phone)
    expect(issued.ok).toBe(true)
    if (issued.ok) expect(issued.code).toMatch(/^\d{6}$/)
  })

  it('menerima kode yang benar tepat sekali', async () => {
    const issued = await issueOtp(phone)
    if (!issued.ok) throw new Error('gagal menerbitkan')

    expect((await verifyOtp(phone, issued.code)).ok).toBe(true)
    // Sekali pakai: kode yang sama tidak boleh berlaku dua kali.
    expect((await verifyOtp(phone, issued.code)).ok).toBe(false)
  })

  it('menolak kode milik nomor lain', async () => {
    const issued = await issueOtp(phone)
    if (!issued.ok) throw new Error('gagal menerbitkan')
    expect((await verifyOtp('+628999999999', issued.code)).ok).toBe(false)
  })

  it('mengunci kode setelah percobaan salah habis', async () => {
    const issued = await issueOtp(phone)
    if (!issued.ok) throw new Error('gagal menerbitkan')
    const salah = issued.code === '000000' ? '111111' : '000000'

    for (let i = 1; i < OTP_MAX_ATTEMPTS; i += 1) {
      const check = await verifyOtp(phone, salah)
      expect(check.ok).toBe(false)
      if (!check.ok) expect(check.attemptsLeft).toBe(OTP_MAX_ATTEMPTS - i)
    }

    const last = await verifyOtp(phone, salah)
    expect(last.ok).toBe(false)
    if (!last.ok) expect(last.reason).toBe('tooManyAttempts')

    // Setelah dikunci, kode yang benar pun tidak lagi diterima.
    expect((await verifyOtp(phone, issued.code)).ok).toBe(false)
  })

  it('menolak kode yang sudah kedaluwarsa', async () => {
    const issued = await issueOtp(phone)
    if (!issued.ok) throw new Error('gagal menerbitkan')

    const nanti = new Date(Date.now() + 6 * 60_000)
    const check = await verifyOtp(phone, issued.code, nanti)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toBe('expired')
  })

  it('menahan permintaan ulang yang terlalu cepat', async () => {
    expect((await issueOtp(phone)).ok).toBe(true)
    const lagi = await issueOtp(phone)
    expect(lagi.ok).toBe(false)
    if (!lagi.ok) {
      expect(lagi.reason).toBe('cooldown')
      expect(lagi.retryAfterSeconds).toBeGreaterThan(0)
    }
  })

  it('membatasi jumlah kode per jam', async () => {
    let at = new Date()
    for (let i = 0; i < 5; i += 1) {
      expect((await issueOtp(phone, at)).ok).toBe(true)
      at = new Date(at.getTime() + 61_000)
    }
    const keenam = await issueOtp(phone, at)
    expect(keenam.ok).toBe(false)
    if (!keenam.ok) expect(keenam.reason).toBe('rateLimit')
  })

  it('menghanguskan kode lama begitu kode baru terbit', async () => {
    const pertama = await issueOtp(phone)
    if (!pertama.ok) throw new Error('gagal')
    const kedua = await issueOtp(phone, new Date(Date.now() + 61_000))
    if (!kedua.ok) throw new Error('gagal')

    expect((await verifyOtp(phone, pertama.code)).ok).toBe(false)
    expect((await verifyOtp(phone, kedua.code)).ok).toBe(true)
  })

  it('menghasilkan kode acak, bukan berurutan', async () => {
    const kode = new Set(Array.from({ length: 50 }, () => newOtpCode()))
    expect(kode.size).toBeGreaterThan(40)
  })
})

describe('token email', () => {
  it('sekali pakai dan terikat pada tujuannya', async () => {
    const user = await createUser({ name: 'Raka', email: 'raka@email.com' })
    const token = await issueEmailToken(user.id, 'verify')

    // Tujuan salah ditolak walaupun tokennya benar.
    expect(await consumeEmailToken(token, 'reset')).toBeUndefined()
    expect((await consumeEmailToken(token, 'verify'))?.id).toBe(user.id)
    expect(await consumeEmailToken(token, 'verify')).toBeUndefined()
  })
})

describe('PKCE', () => {
  it('menghasilkan challenge base64url tanpa padding', async () => {
    const challenge = codeChallenge('verifier-contoh')
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(challenge).not.toContain('=')
  })

  it('deterministik untuk verifier yang sama', async () => {
    expect(codeChallenge('abc')).toBe(codeChallenge('abc'))
    expect(codeChallenge('abc')).not.toBe(codeChallenge('abd'))
  })
})

describe('peran admin', () => {
  it('memberi member biasa saat daftar admin kosong', async () => {
    const user = await createUser({ name: 'Raka', phone: '+628128845119' })
    expect(user.role).toBe('member')
  })

  it('mengangkat kontak yang ada di daftar jadi admin', async () => {
    const { config } = await import('../src/config.ts')
    const asli = [...config.adminContacts]
    // @ts-expect-error daftar admin sengaja ditimpa untuk kasus ini saja
    config.adminContacts = ['+628128845119', 'ketua@dbtc.id']

    expect((await createUser({ name: 'Ketua', phone: '+628128845119' })).role).toBe('admin')
    expect((await createUser({ name: 'Sekre', email: 'ketua@dbtc.id' })).role).toBe('admin')
    expect((await createUser({ name: 'Lain', phone: '+628999999999' })).role).toBe('member')

    // @ts-expect-error dikembalikan supaya tidak mencemari kasus lain
    config.adminContacts = asli
  })

  it('menyelaraskan peran saat daftar berubah', async () => {
    const { config } = await import('../src/config.ts')
    const { syncRole } = await import('../src/auth.ts')
    const user = await createUser({ name: 'Raka', phone: '+628128845119' })
    expect(user.role).toBe('member')

    // @ts-expect-error pengurus ditambahkan setelah akunnya terlanjur ada
    config.adminContacts = ['+628128845119']
    expect((await syncRole(user)).role).toBe('admin')

    // @ts-expect-error daftar dikosongkan untuk menguji penurunan peran
    config.adminContacts = []
    expect((await syncRole({ ...user, role: 'admin' })).role).toBe('member')
  })
})
