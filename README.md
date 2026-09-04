# DBTC — Dukuh Bima Tennis Club

Aplikasi booking lapangan olahraga + komunitas. Mobile-first web app berbentuk
Android, jalan tanpa server — seluruh backend disimulasikan MSW.

> **Catatan merek.** App ini lahir sebagai "Lapangin", sebuah marketplace
> multi-venue lintas cabang, lalu diganti merek jadi DBTC atas permintaan.
> Fiturnya tidak dipangkas: 18 layar dan seluruh alurnya tetap seperti semula,
> termasuk pencarian lintas venue dan tujuh cabang olahraga. Kalau nantinya
> app ini memang hanya untuk satu klub tenis, layar pencarian venue dan
> pemilih cabang adalah bagian pertama yang layak dipertimbangkan ulang.

App ini punya **dua bagian**: frontend Vite, dan server autentikasi sungguhan
di `server/`. Jalankan keduanya:

```bash
npm install && npm --prefix server install
```

```bash
npm run server
```

```bash
npm run dev
```

Buka URL yang dicetak Vite. Tanpa kredensial penyedia apa pun, alur masuk lewat
nomor HP dan email tetap bisa diselesaikan — kodenya ditampilkan di layar
(hanya di luar produksi).

---

## Perintah

| Perintah             | Guna                                               |
| -------------------- | -------------------------------------------------- |
| `npm run dev`        | Dev server (MSW aktif otomatis)                    |
| `npm run build`      | Typecheck + build produksi                         |
| `npm run verify`     | `lint` + `typecheck` + `test` — gerbang sebelum PR |
| `npm test`           | Vitest sekali jalan                                |
| `npm run test:watch` | Vitest mode tonton                                 |
| `npm run format`     | Prettier                                           |

---

## Autentikasi

Auth **sudah nyata**: server Express + SQLite di `server/`, dengan sesi yang
bisa dicabut, sandi ter-hash, OTP berbatas, dan OAuth 2.0. Sisa endpoint
(venue, booking, turnamen) **masih dilayani MSW** di dalam browser. Migrasi
bertahap, dan proxy `/api/auth` di `vite.config.ts` yang menandai batasnya.

| Metode             | Keadaan                                                   |
| ------------------ | --------------------------------------------------------- |
| Nomor HP + OTP     | Jalan penuh. Tanpa Twilio, kode dicetak ke log server.    |
| Email + kata sandi | Jalan penuh, termasuk verifikasi email.                   |
| Google             | Alur OAuth lengkap; menunggu `GOOGLE_CLIENT_ID/SECRET`.   |
| Facebook           | Alur OAuth lengkap; menunggu `FACEBOOK_CLIENT_ID/SECRET`. |

Yang tidak dikonfigurasi **melaporkan dirinya belum siap** — tombolnya
dinonaktifkan dengan alasan, dan endpoint-nya membalas 501 yang menyebut
variabel mana yang perlu diisi. Tidak ada yang berpura-pura berhasil.

### Keputusan yang layak diperiksa

- **Sesi opaque, bukan JWT.** Token acak 32 byte; yang disimpan hanya HMAC-nya.
  Database yang bocor tidak langsung memberi sesi yang bisa dipakai, dan sesi
  bisa dicabut seketika — hal yang tidak bisa dilakukan JWT sebelum kedaluwarsa.
- **Kode OTP di-hash**, bersama nomornya. Yang bisa membaca database tetap
  tidak bisa membaca kode yang sedang berlaku.
- **scrypt dari pustaka standar** untuk sandi. Memory-hard, dan satu dependensi
  lebih sedikit.
- **Pesan gagal masuk selalu sama** untuk email tak terdaftar dan sandi salah.
  Membedakannya akan membocorkan alamat mana yang punya akun.
- **Nomor dinormalkan ke E.164** sebelum apa pun, jadi `08…`, `62…`, dan
  `+62…` bukan tiga akun berbeda — dan normalisasi itu ikut sampai ke rate
  limiter, bukan berhenti di validasi.
- **PKCE S256** untuk Google, dengan `state` disimpan di server, sekali pakai.
- **Peran admin diturunkan dari `ADMIN_CONTACTS`**, bukan disimpan sekali lalu
  dilupakan. Tanpa ini tidak ada jalan menjadi admin sama sekali.

Rem yang dipasang: OTP kedaluwarsa 5 menit, maksimal 5 tebakan lalu kodenya
hangus, jeda kirim ulang 60 detik, dan maksimal 5 kode per nomor per jam.
Semuanya ditegakkan di server — tombol yang di-disable di UI bukan pengaman.

### Menyalakan penyedia sungguhan

Salin `server/.env.example` jadi `server/.env`, lalu isi yang dibutuhkan.
Semua kredensial berhenti di proses server; tidak ada satu pun yang sampai ke
browser.

| Variabel                    | Untuk                                                    |
| --------------------------- | -------------------------------------------------------- |
| `ADMIN_CONTACTS`            | Nomor/email pengurus, dipisah koma — jadi admin otomatis |
| `TOKEN_PEPPER`              | **Wajib diganti di produksi**; mem-hash token sesi & OTP |
| `GOOGLE_CLIENT_ID/SECRET`   | Masuk dengan Google                                      |
| `FACEBOOK_CLIENT_ID/SECRET` | Masuk dengan Facebook                                    |
| `TWILIO_*`                  | Pengiriman OTP lewat SMS                                 |
| `SMTP_*`                    | Pengiriman email verifikasi                              |

Redirect URI yang perlu didaftarkan di Google/Meta:
`http://localhost:5173/api/auth/oauth/<google|facebook>/callback`

## Arsitektur

Empat lapisan, dari dalam ke luar. Aturannya satu arah: lapisan luar boleh
mengimpor yang di dalam, tidak sebaliknya.

```
src/types      ── model domain, tanpa dependensi apa pun
   ▲
src/lib        ── aturan bisnis murni (harga, poin, split bill, slot)
   ▲              fungsi biasa, tanpa React, di sinilah tes unit menggigit
src/mocks      ── backend tiruan: handler MSW + "database" in-memory
src/hooks      ── TanStack Query membungkus HTTP; Zustand memegang state alur
src/store
   ▲
src/routes     ── satu berkas per layar
src/components ── primitif UI + kartu domain + kerangka layar
```

**Kenapa aturan bisnis dipisah dari komponen.** Perhitungan harga, pembulatan
split bill, batas penukaran poin, dan validasi slot bersambung semuanya hidup
di `src/lib` sebagai fungsi murni. Mereka bisa diuji tanpa merender apa pun,
dan komponen tinggal memanggil — jadi tidak ada aturan yang diam-diam
tergandakan di dua layar dengan hasil berbeda.

### Peta folder

```
src/
├─ types/index.ts          Sport, Venue, Court, Slot, Booking, SplitBill,
│                          OpenMatch, Team, Tournament, Review, Notification, User
├─ lib/
│  ├─ pricing.ts           harga dari slot terpilih (bukan tarif × jam)
│  ├─ points.ts            1 pt / Rp1.000; tukar kelipatan 100; batas 30%
│  ├─ split.ts             bagi rata, sisa pembulatan ke host
│  ├─ slots.ts             pilihan harus bersambung; deteksi bentrok berulang
│  ├─ dates.ts             format Indonesia (date-fns locale id)
│  ├─ money.ts             Rp145.000 / Rp65rb (Intl id-ID)
│  ├─ calendar.ts          pembangun berkas .ics (escaping + lipatan per oktet)
│  ├─ share.ts             Web Share API dengan jalur mundur papan klip
│  ├─ api.ts               pembungkus fetch + ApiError bertipe
│  └─ storage.ts           localStorage bernamespace `lapangin:`
├─ mocks/
│  ├─ seed.ts              venue Bandung, nama Indonesia, harga rupiah
│  ├─ db.ts                ketersediaan slot deterministik + booking in-memory
│  ├─ handlers.ts          seluruh endpoint /api/*
│  └─ browser.ts server.ts transport MSW untuk app dan untuk tes
├─ store/
│  ├─ auth.ts              user + token, tersimpan di localStorage
│  ├─ draft.ts             state machine alur booking
│  └─ preferences.ts      area, radius, notifikasi per jenis, kurangi animasi
├─ hooks/
│  ├─ queries.ts           seluruh hook TanStack Query
│  └─ useSearchFilters.ts  filter pencarian yang hidup di URL
├─ components/
│  ├─ ui/                  Button, Icon, primitives, states (skeleton/empty/error)
│  ├─ layout/              AndroidFrame, Screen, BottomNav
│  └─ domain/              kartu venue/open match/turnamen/tim, ikon cabang
├─ routes/                 18 layar brief + Pengaturan & kotak ajakan sparring
└─ styles/
   ├─ tokens.css           satu-satunya tempat nilai warna mentah boleh ada
   └─ global.css           reset + utilitas
```

### Rute

| Rute                  | Layar                                            | Bottom nav |
| --------------------- | ------------------------------------------------ | ---------- |
| `/login`              | 01 Masuk / onboarding                            | —          |
| `/`                   | 02 Home (tab Venue) · 13 Home v2 (tab Komunitas) | ✓          |
| `/search`             | 03 Cari & filter                                 | —          |
| `/venue/:id`          | 04 Detail venue                                  | —          |
| `/venue/:id/schedule` | 05 Pilih lapangan & jam                          | —          |
| `/booking/summary`    | 06 Ringkasan + split bill                        | —          |
| `/booking/payment`    | 07 Pembayaran + countdown                        | —          |
| `/booking/:id/ticket` | 08 E-tiket QR                                    | —          |
| `/bookings`           | 09 Booking saya                                  | ✓          |
| `/profile`            | 10 Profil & poin                                 | ✓          |
| `/venue/:id/reviews`  | 11 Ulasan                                        | —          |
| `/notifications`      | 12 Notifikasi                                    | —          |
| `/match`              | 14 Cari lawan · 16 daftar tim                    | ✓          |
| `/tournaments`        | 15 Turnamen                                      | —          |
| `/team/:id`           | 16 Tim & komunitas                               | —          |
| `/match/:id`          | 17 Detail open match                             | —          |
| `/chat/:id`           | 18 Obrolan grup + kartu split bill               | —          |

Layar 02 dan 13 adalah dua wajah home yang sama-sama diminta brief, jadi
keduanya jadi tab di rute `/` alih-alih dua URL yang bersaing.

---

## Perilaku yang benar-benar berjalan

**Slot picker.** Strip 14 hari, tab lapangan, grid per jam. Pilihan majemuk
wajib bersambung: slot yang tidak menempel di ujung blok ditolak dengan alasan,
dan slot di tengah tidak bisa dilepas supaya blok tidak terbelah. Harga dihitung
ulang tiap perubahan — prime time 18.00–21.00 bertarif 20% lebih tinggi, dan
lapangan premium punya tarif sendiri, jadi total datang dari penjumlahan slot,
bukan `tarif × jam`.

**Jadwal berulang.** Toggle "Ulangi tiap Jumat, 4 minggu" memvalidasi setiap
slot di minggu-minggu berikutnya ke server dan melaporkan minggu mana yang
bentrok. Selama masih ada bentrokan, tombol Lanjut terkunci.

**Pencarian.** Query di-debounce 350 ms; query dan seluruh filter tersimpan di
URL search params, jadi hasil pencarian bisa dibagikan lewat link dan tombol
back/forward peramban mengembalikan filter sebelumnya.

**Alur booking sebagai state machine.**

```
draft ──goToSummary──▶ summary ──attachBooking──▶ awaitingPayment ──confirm──▶ confirmed
  ▲                       │                            │
  └───ubah pilihan────────┴──────hold habis────────────┘
```

Menyentuh pilihan slot menjatuhkan stage kembali ke `draft` dan melepas booking
yang sudah dibuat di server — draft basi tidak akan pernah bisa dibayar.
Penjaganya `canPay()` di store, bukan sekadar tombol yang di-disable.

**Countdown pembayaran.** Hold 10 menit, sumber kebenarannya deadline dari
server — refresh halaman tidak mereset waktu. Begitu habis, slot dilepas dan
layar menjelaskan apa yang terjadi alih-alih melempar user keluar.

**Split bill.** Tambah/hapus peserta, nominal per orang dihitung ulang tiap
kali. Rupiah tidak punya pecahan sen, jadi pembagian dibulatkan ke bawah dan
**sisanya ditanggung host** — supaya angka yang ditagih ke tiap peserta selalu
sama persis. Progres lunas tampil di Booking saya dan di kartu chat.

**Poin loyalitas.** 1 poin per Rp1.000. Penukaran hanya kelipatan 100 poin
(100 pt = Rp10.000), dibatasi 30% dari subtotal — batas itu juga dibulatkan ke
kelipatan 100 supaya angka yang ditawarkan selalu bisa ditukar.

**E-tiket.** QR dibangkitkan dari kode booking dengan `qrcode.react` (SVG
inline), jadi tetap bisa dibuka setelah halaman termuat sekali. Tombol
Bagikan memakai Web Share API dan jatuh ke papan klip kalau tidak ada;
Kalender mengunduh berkas .ics yang dibangun sendiri — lengkap dengan
pengingat 1 jam sebelum main dan RRULE mingguan untuk booking berulang.

**Aksi komunitas.** Gabung/batal open match, gabung tim, ajak sparring, dan
daftar turnamen semuanya memukul server tiruan dan mengubah data: kuota
bergerak, slot kosong berkurang, tombol berganti jadi keadaan "sudah". Ajakan
sparring muncul sebagai notifikasi baru.

**Notifikasi.** Bisa ditandai dibaca satu per satu atau sekaligus, dan titik
merah di Home menghitung yang benar-benar belum dibaca — bukan hiasan tetap.
Jenis yang dimatikan di Pengaturan benar-benar hilang dari daftar.

**Ajakan sparring.** Punya kotak sendiri dengan dua sisi: yang masuk butuh
jawaban (terima/tolak), yang terkirim menunggu jawaban tim lain. Menjawab
memunculkan notifikasi dan, kalau diterima, pintasan untuk langsung booking
lapangannya.

**Biaya daftar turnamen.** Kuota baru bergerak setelah biaya dibayar — mendaftar
dan membayar bukan dua hal terpisah. "Bayar di tempat" menghasilkan pendaftaran
berstatus _menunggu_, bukan _lunas_, dan bedanya terlihat di kartu.

**Pengaturan.** Area, radius bawaan pencarian, notifikasi per jenis, dan
"kurangi animasi" — semuanya tersimpan lokal dan langsung berpengaruh:
area mengubah header Home, radius jadi bawaan filter pencarian, dan kurangi
animasi memasang `data-reduce-motion` di root dokumen sehingga satu aturan CSS
menjinakkan seluruh transisi sekaligus.

**Ulasan.** Bisa ditulis dari layar ulasan. Rating venue dihitung ulang dari
ulasan yang benar-benar ada, supaya angka di kartu venue tidak pernah
bertentangan dengan daftar ulasannya sendiri.

**Persistensi.** Auth, draft booking, preferensi, dan seluruh isi backend
tiruan disimpan di localStorage dengan prefiks `lapangin:`. Booking, ulasan,
ajakan, dan pendaftaran turnamen bertahan melewati reload halaman.

Snapshot membawa nomor versi dan stempel tanggal. Data contoh dibuat relatif
terhadap "hari ini", jadi snapshot dari hari lain dibuang alih-alih dipulihkan —
tanpa itu app akan menampilkan jadwal kemarin sebagai jadwal hari ini. Pengaturan
punya tombol reset yang mengembalikan semuanya ke keadaan awal, dan penghapusan
hanya menyentuh kunci berprefiks `lapangin:`.

---

## Lapisan data

`src/mocks/handlers.ts` melayani seluruh `/api/*` dengan latensi buatan
300–800 ms supaya skeleton benar-benar terlihat (dimatikan otomatis saat tes).

Ketersediaan slot dihitung dari hash FNV-1a atas `lapangan + tanggal + jam`,
bukan `Math.random()`. Konsekuensinya penting: grid tidak berubah tiap render,
dan pertanyaan "apakah Jumat depan jam 19.00 kosong?" selalu dijawab sama —
tanpa itu deteksi bentrok jadwal berulang tidak bisa dipercaya.

### Memicu state error

State error di app ini nyata, bukan hiasan. Cara memancingnya:

| Kasus                     | Cara memicu                                                |
| ------------------------- | ---------------------------------------------------------- |
| Server error saat mencari | ketik `error` di kotak pencarian                           |
| Slot direbut saat bayar   | booking **Lap. 1** mana pun pada **jam 21.00**, lalu Bayar |
| Hold pembayaran habis     | diamkan layar pembayaran 10 menit                          |
| Slot keburu diambil       | pilih slot yang baru saja dikunci booking lain             |

---

## Tes

`npm run verify:all` menjalankan keduanya — **211 tes**: 168 frontend
(19 berkas) dan 43 server (2 berkas).

Tes server menembak app Express yang sama dengan yang dijalankan produksi,
lewat HTTP sungguhan — jadi yang diuji bukan cuma logikanya tapi juga
perkabelannya: rute, kode status, dan bentuk balasan.

**Unit (`src/lib/*.test.ts`)** — perhitungan harga, penukaran poin dan batas
30%, pembulatan split bill (termasuk pembuktian bahwa jumlah seluruh bagian
sama persis dengan total), validasi slot bersambung, deteksi bentrok berulang,
pembangunan berkas .ics (escaping, lipatan baris per oktet, RRULE), jalur mundur
berbagi, dan lapisan data tiruan (determinisme ketersediaan slot, snapshot, dan
reset yang tidak menyentuh kunci aplikasi lain).

**Komponen (`src/routes/*.test.tsx`)** — aturan pilih slot di grid nyata,
kedaluwarsanya countdown pembayaran beserta efeknya ke state machine,
sinkronisasi filter ⇄ URL termasuk debounce, reset, state kosong, dan state
error, gabung/batal open match beserta penolakan saat kuota penuh, tandai
notifikasi dibaca, tulis ulasan termasuk validasi dan perhitungan ulang
rata-rata, terima/tolak ajakan sparring, pembayaran biaya daftar turnamen
(termasuk bukti kuota tidak bergerak sebelum dibayar), dan preferensi yang
benar-benar mengubah tampilan.

Tes komponen memakai handler MSW yang sama dengan app, jadi yang diuji kontrak
sungguhan — bukan mock yang ditulis ulang khusus untuk tes.

### Satu hal khusus di setup tes

`src/test/setup.ts` melepas `AbortSignal` dari setiap `fetch`. Lingkungan jsdom
mengganti `AbortController` global dengan miliknya sendiri, sementara `fetch`
bawaan Node menolak signal yang bukan instance miliknya — tanpa pembungkus itu
setiap permintaan gagal di tes meski kodenya benar di peramban. Pembatalan
request tetap aktif di aplikasi sungguhan.

---

## Sistem visual

Seluruh warna, radius, dan font berasal dari custom property di
`src/styles/tokens.css`, dipetakan ke nama Tailwind di `tailwind.config.ts`.
Tidak ada satu pun nilai heksadesimal di dalam komponen.

Palet diambil dari lambang DBTC dengan menyampel pikselnya, bukan dikira-kira:

| Peran       | Nilai     | Asal di lambang                       |
| ----------- | --------- | ------------------------------------- |
| Ground      | `#f3e7d1` | kertas krem di balik lambang          |
| Aksen       | `#c9a03c` | cincin dalam, tipografi, bola tenis   |
| Aksen kedua | `#26503a` | cincin luar, daun laurel, senar raket |

Krem DBTC praktis identik dengan ground design system Organic yang dipakai
sebelumnya (`#f5ead8`), jadi ganti merek hanya perlu menukar dua peran aksen —
terracotta → emas, sage → hijau — tanpa menyentuh satu komponen pun.

- Ground krem `--color-bg`, permukaan `--color-surface`
- Aksen emas `--color-accent`, aksen kedua hijau hutan `--color-accent-2`
- Heading Caprasimo, body Figtree
- Tombol dan input pill 999px, kontainer `--radius-lg`
- Ikon Lucide, `strokeWidth` 2.75 dipatok sekali di `components/ui/Icon.tsx`
- Ukuran teks terkecil 11px; target sentuh minimal 44px (`min-h-touch`)
- Foto venue diwakili blok warna beraksen + bentuk bulat dekoratif yang posisinya
  deterministik dari `seed`, bukan ilustrasi SVG

Struktur ramp-nya diturunkan dari design system **Organic** di project Claude
Design "Booking Court Mobile App" (`_ds/organic-…/styles.css`); nilainya dari
lambang DBTC. Bingkai perangkat diadaptasi dari starter `android-frame.jsx` di
project yang sama, dengan warnanya ditarik ke token, bukan palet Material
bawaan starter.

Aset lambang ada di `public/`: `logo-dbtc-512.jpg` (layar masuk),
`logo-dbtc-192.jpg` (header Home & ikon iOS), `favicon-dbtc.png`, dan
`logo-dbtc-original.jpg` sebagai sumber 1254×1254 yang tidak dikompres ulang.

### Aksesibilitas

Elemen semantik, semua input berlabel, ring fokus `2px solid var(--color-accent)`
yang selalu terlihat, `aria-live` untuk status pilihan slot dan countdown
pembayaran, grid slot bisa dioperasikan penuh dari keyboard, dan tiap daftar
punya keadaan memuat (skeleton, bukan spinner), kosong, dan gagal.

---

## Asumsi yang diambil

1. **Slot selalu 1 jam.** Semua aturan bersambung, harga, dan pembulatan
   dibangun di atas ini. Durasi 30 menit atau 90 menit butuh perubahan model.
2. **Jarak disajikan server.** `distanceKm` datang jadi dari backend; app tidak
   minta izin geolokasi maupun menghitung jarak sendiri.
3. **Prime time 18.00–21.00 naik 20%.** Angka tebakan yang wajar, bukan tarif
   asli — dan aturannya di satu tempat (`src/mocks/db.ts` → `priceFor`).
4. **Biaya layanan Rp5.000 flat per booking.**
5. **Tier loyalitas** Rookie / Reguler / Pro / Legend di ambang 0 / 500 / 2.000 /
   5.000 poin — angka karangan, gampang diganti di `src/lib/points.ts`.
6. **Sisa pembulatan split bill ke host.** Alternatifnya menyebar sisa ke
   beberapa orang, tapi itu membuat tiap orang ditagih angka berbeda tanpa
   alasan yang bisa dijelaskan.
7. **Hold pembayaran 10 menit** sesuai brief; venue asli biasanya 15–30 menit.
8. **Login lewat nomor HP tanpa OTP sungguhan.** Layar OTP belum dibuat; nomor
   yang valid langsung diterima.
9. **Lokasi dipatok "Bandung Utara"** dan tidak bisa diganti — pemilih lokasi
   belum ada.
10. **Satu bahasa (Indonesia).** Tidak ada infrastruktur i18n; teks ditulis
    langsung di komponen.

## Yang masih mock

- **Venue selain klub** masih data contoh Bandung. Data klub sendiri diisi
  lewat dasbor admin — lihat bagian "Dasbor admin klub".
- **Iuran keanggotaan** hanya angka yang ditampilkan; belum ada penagihan
  maupun status anggota yang kedaluwarsa.
- **Seluruh backend.** Tidak ada server, tidak ada database. Datanya hidup di
  memori dan disalin ke localStorage peramban ini saja — tidak ada yang sampai
  ke perangkat lain, dan snapshot dibuang saat harinya berganti.
- **Pembayaran.** Tidak ada gateway. Menekan Bayar langsung mengonfirmasi;
  QRIS/VA/kartu hanya pilihan, tidak menghasilkan kode bayar sungguhan.
- **Foto venue.** Blok warna beraksen, bukan foto.
- **Verifikasi nomor HP lewat SMS sungguhan** menunggu akun Twilio; alurnya
  sudah lengkap, hanya salurannya yang masih log server.
- **Lupa kata sandi** belum ada. Tabel dan tipenya sudah menyiapkan tujuan
  `reset`, tapi layar dan endpoint-nya belum dibuat.
- **Menautkan akun** sesudah masuk (mis. menambah Google ke akun yang sudah
  ada) belum ada; penautan hanya terjadi otomatis saat emailnya cocok.
- **Notifikasi push** tidak ada, dan sengaja tidak dipalsukan: push sungguhan
  butuh service worker dengan kunci VAPID dan server yang mengirim — tanpa itu
  yang bisa dibuat hanyalah tiruan yang menyesatkan. Yang ada: daftar notifikasi
  di dalam app, dengan preferensi per jenis yang benar-benar berlaku.
- **Chat** mengirim pesan ke store tiruan; tidak ada realtime, karena itu juga
  butuh server (WebSocket atau SSE). Polling bisa saja dipasang, tapi itu meniru
  bentuknya tanpa memberi sifatnya.
- **Waktu sparring** belum bisa dinegosiasikan — ajakan keluar dikirim tanpa
  usulan jam, dan menerima ajakan tidak otomatis mengunci lapangan.

## Dasbor admin klub

Data klub tidak lagi ditanam di kode. Admin mengisinya sendiri lewat **Profil →
Dasbor klub**, dan yang diisi langsung dipakai app:

| Diatur di                        | Berpengaruh ke                               |
| -------------------------------- | -------------------------------------------- |
| Jumlah & nama lapangan           | Tab lapangan di layar pilih jadwal           |
| Tarif dasar & tarif per lapangan | Harga tiap slot                              |
| Jendela prime time & pengalinya  | Jam mana yang lebih mahal, dan berapa        |
| Jam buka & tutup                 | Jam mana saja yang muncul di grid slot       |
| Nama, alamat, area               | Kartu venue, detail venue, header Home       |
| Iuran & potongan anggota         | Ditampilkan di tarif; belum menagih otomatis |

Aturan prime time dulu ditanam di `priceFor()` sebagai 18–21 ×1,2. Sekarang
datang dari pengaturan, boleh melewati tengah malam (mis. 20–01), dan venue
selain milik klub tetap memakai aturan bawaan.

Validasinya di server, bukan cuma di form — form bisa dilewati, endpoint tidak.
Lapangan terakhir tidak bisa dihapus, dan lapangan yang masih punya booking
mendatang menolak dihapus sambil menyebut jumlahnya.

Peran disimpan di `User.role`. Rute `/admin` dijaga di klien supaya menunya
tidak muncul untuk anggota biasa; penjaga sebenarnya tetap di server, karena
penjaga klien bisa dilewati.

### Yang masih perlu diisi

Nilai awalnya sengaja ditulis apa adanya — alamatnya "Alamat belum diisi" dan
tarifnya bulat — supaya ketahuan bahwa itu belum data DBTC. Dasbor menandainya
"Belum lengkap" sampai alamatnya diisi.

Venue **selain** klub (GOR Cendana dan kawan-kawan) masih data contoh Bandung
dan tidak bisa diubah dari dasbor; itu memang milik pihak lain di dalam cerita
app ini.

Masih berguna kalau ada: **foto lapangan asli** (minimal 3, rasio 4:3) untuk
menggantikan blok warna placeholder, ketentuan pembatalan, dan aturan poin
loyalitas yang sudah disepakati.
