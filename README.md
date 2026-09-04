# DBTC — Dukuh Bima Tennis Club

Aplikasi booking lapangan olahraga + komunitas. Mobile-first web app berbentuk
Android, dengan backend Express + SQLite (atau Postgres) yang melayani
autentikasi maupun domain.

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

App butuh **dua proses**: server dan dev server. Tanpa server, tidak ada satu
pun layar yang punya data — bukan lagi MSW yang mengisinya.

| Perintah                | Guna                                                         |
| ----------------------- | ------------------------------------------------------------ |
| `npm run server`        | Server Express (auth + domain) di :4000 — **jalankan dulu**  |
| `npm run dev`           | Dev server Vite di :5173, seluruh `/api` diteruskan ke :4000 |
| `npm run build`         | Typecheck + build produksi                                   |
| `npm run verify`        | `lint` + `typecheck` + `test` klien                          |
| `npm run verify:server` | Typecheck + tes server                                       |
| `npm run verify:all`    | Keduanya — gerbang sebelum PR                                |
| `npm test`              | Vitest sekali jalan                                          |
| `npm run format`        | Prettier                                                     |

---

## Autentikasi

Server Express di `server/`, dengan sesi opaque yang bisa dicabut, sandi
ter-hash scrypt, OTP berbatas, dan OAuth 2.0 + PKCE. Seluruh `/api` —
autentikasi maupun domain — menuju server yang sama.

| Metode             | Keadaan                                                   |
| ------------------ | --------------------------------------------------------- |
| Nomor HP + OTP     | Jalan penuh. Tanpa Twilio, kode dicetak ke log server.    |
| Email + kata sandi | Jalan penuh, termasuk verifikasi email.                   |
| Google             | Alur OAuth lengkap; menunggu `GOOGLE_CLIENT_ID/SECRET`.   |
| Facebook           | Alur OAuth lengkap; menunggu `FACEBOOK_CLIENT_ID/SECRET`. |

### Lupa kata sandi

Balasannya **sama persis** untuk email terdaftar maupun tidak. Membedakannya
mengubah endpoint ini jadi alat memeriksa alamat mana yang punya akun di
sini, dan itu bisa dipakai siapa saja tanpa masuk.

Mengganti sandi **mencabut seluruh sesi**. Kalau tidak, orang yang memakai
sandi lama — termasuk yang membuat pemiliknya perlu me-reset — tetap masuk di
perangkatnya, dan reset itu tidak menyelesaikan apa pun.

Sandi divalidasi **sebelum** token dikonsumsi, supaya salah ketik tidak
menghanguskan kode sekali-pakai.

### Satu akun, beberapa cara masuk

Nomor, email, Google, dan Facebook bisa menempel di satu akun lewat
**Profil → Atur cara masuk**. Semuanya mendarat di akun yang sama, jadi
booking, poin, dan riwayat main tidak terpecah.

Tiga aturan yang menahannya:

- **Selalu sisakan satu cara masuk.** Melepas yang terakhir mengunci orang
  keluar dari akunnya secara permanen — tidak ada layar pemulihan yang bisa
  menolong akun tanpa satu pun cara masuk.
- **Email tanpa sandi tidak dihitung** sebagai cara masuk: tidak ada layar
  yang menerima email saja. Menghitungnya membuat aturan di atas meloloskan
  akun yang sebenarnya sudah terkunci. Melepas email ikut membuang sandinya.
- **Nomor atau email milik akun lain ditolak**, bukan dipindahkan diam-diam.

Sesi dibawa melewati putaran OAuth lewat baris `oauth_states` di basis data,
bukan lewat URL: apa pun di URL bisa diubah pengguna, dan ini menentukan akun
mana yang mendapat identitas baru.

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
shared/        ── model domain + aturan bisnis murni (harga, poin, stok, slot)
   ▲              fungsi biasa, tanpa React, dipakai klien DAN server
   │              di sinilah tes unit menggigit
   ├───────────── server/  ── Express: kepemilikan, transaksi, SSE
   │                         satu antarmuka SQL, dua driver
   ▼
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
shared/                    dipakai klien DAN server — satu definisi, bukan salinan
├─ types.ts                Sport, Venue, Court, Slot, Booking, MerchItem, Complaint…
├─ pricing.ts points.ts    harga dari slot terpilih; 1 pt / Rp1.000
├─ slots.ts split.ts       pilihan bersambung; bagi rata, sisa ke host
├─ activities.ts           catatan main diturunkan dari kejadian
├─ merch.ts complaints.ts  stok & cara bayar; status aduan ikut percakapan
└─ seed.ts dates.ts        data contoh; format Indonesia (date-fns locale id)

server/
├─ src/store/              satu antarmuka SQL, dua driver (SQLite, Postgres)
├─ src/domain/
│  ├─ schema.ts            tabel domain
│  ├─ store.ts             akses data — semuanya per user_id
│  ├─ routes.ts            seluruh endpoint /api/*
│  ├─ slots.ts             grid slot dari booking sungguhan
│  └─ events.ts            hub Server-Sent Events
├─ src/auth.ts routes.ts   sesi, OTP, sandi, OAuth, penyambungan akun
└─ src/config.ts           konfigurasi + pemeriksaan kesiapan deploy

src/
├─ types/index.ts          penerus ke shared/types.ts
├─ lib/
│  ├─ pricing.ts points.ts penerus tipis ke shared/ — aturannya tinggal di sana
│  ├─ split.ts slots.ts    penerus tipis ke shared/
│  ├─ dates.ts             penerus tipis ke shared/
│  ├─ money.ts             Rp145.000 / Rp65rb (Intl id-ID)
│  ├─ calendar.ts          pembangun berkas .ics (escaping + lipatan per oktet)
│  ├─ share.ts             Web Share API dengan jalur mundur papan klip
│  ├─ api.ts               pembungkus fetch + ApiError bertipe
│  └─ storage.ts           localStorage bernamespace `lapangin:`
├─ mocks/                 hanya untuk tes komponen, bukan lagi untuk app
│  ├─ handlers.ts          endpoint tiruan yang dipakai tes
│  └─ server.ts            transport MSW untuk tes
├─ store/
│  ├─ auth.ts              user + token, tersimpan di localStorage
│  ├─ draft.ts             state machine alur booking
│  └─ preferences.ts      area, radius, notifikasi per jenis, kurangi animasi
├─ hooks/
│  ├─ queries.ts           seluruh hook TanStack Query
│  ├─ useLiveChannel.ts    langganan SSE → batalkan cache query
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

Seluruh `/api/*` dilayani server Express — lihat bagian **Backend**. Data
tinggal di SQLite (atau Postgres), bukan di memori peramban, jadi apa yang
dibooking satu orang benar-benar terlihat oleh yang lain.

Ketersediaan slot ditentukan **dua hal saja**: booking yang sudah dibayar, dan
jam yang sudah lewat. Server tiruan yang digantikannya menebak keterisian dari
hash id lapangan supaya grid tampak ramai tanpa ada booking apa pun; grid yang
lengang di server baru memang menggambarkan keadaannya.

`src/mocks/` tetap ada untuk **tes komponen**. Di sana memakai server
sungguhan justru membuat tes bergantung pada proses lain yang harus hidup
lebih dulu.

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

`npm run verify:all` menjalankan keduanya — **401 tes**: 230 frontend
(22 berkas) dan 171 server (8 berkas).

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

Tes komponen memakai handler MSW; tes server menembak app Express yang sama
dengan yang dijalankan produksi. Aturan bisnisnya sendiri diuji sekali di
`shared/` — kedua sisi memanggil fungsi yang sama, jadi mengujinya dua kali
hanya menguji dua pemanggil dari satu kode.

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

## Backend

Satu server Express melayani dua hal: **autentikasi** di `/api/auth` dan
**domain** di `/api`. Keduanya memakai basis data yang sama lewat satu
antarmuka, dan bisa berjalan di atas SQLite maupun Postgres tanpa satu baris
query pun berubah.

### Kenapa domainnya dipindahkan dari MSW

Selama domainnya dilayani MSW di dalam browser, hanya ada **satu orang**. Itu
enak untuk merancang layar — tidak ada proses lain yang harus hidup — tapi
menyembunyikan satu hal yang tidak pernah bisa diuji di sana: kepemilikan.
"Booking siapa ini" bukan pertanyaan yang bisa salah dijawab kalau cuma ada
satu jawaban.

Yang langsung terlihat begitu ada dua orang:

| Sebelum (MSW)                          | Sekarang                                  |
| -------------------------------------- | ----------------------------------------- |
| Slot terisi ditebak dari hash id       | Hanya booking sungguhan yang menutup slot |
| Poin ditukar sebanyak yang klien minta | Dibatasi saldo di server                  |
| Semua booking terlihat                 | Booking orang lain menjawab 404           |
| Poin belanja masuk saat ringkasan      | Masuk saat dibayar                        |

MSW **masih dipakai**, tapi hanya untuk tes komponen: di sana memakai server
sungguhan justru membuat tes bergantung pada proses lain yang harus hidup
lebih dulu.

### Aturan tidak ditulis dua kali

Perhitungan harga, poin, stok, jadwal, dan status aduan tinggal di
`shared/`. Klien dan server mengimpor **berkas yang sama**, bukan salinan.
Menyalinnya berarti dua kesempatan untuk berbeda, dan yang berbeda biasanya
yang jarang dijalankan.

```
shared/         types, pricing, points, slots, split, activities, merch,
                complaints, dates, seed  ← dipakai klien DAN server
src/lib/*.ts    penerus tipis ke shared/, supaya impor `@/lib/...` tetap sama
server/src/     store, routes, events — yang khusus server
```

### SQLite atau Postgres

`DATABASE_URL` yang menentukan. Kalau diisi, Postgres; kalau tidak, berkas
SQLite. Satu variabel, bukan dua yang bisa bertentangan.

SQLite cukup untuk satu instance dan tidak perlu dipasang. Begitu app
dijalankan lebih dari satu proses, berkas SQLite tidak bisa dibagi — dan
membaginya lewat disk jaringan adalah cara yang sudah dikenal untuk
merusaknya.

Yang membuat perpindahan itu mungkin bukan "SQL-nya standar", melainkan tidak
adanya kode lain yang menyentuh driver. Konsekuensinya: **seluruh akses basis
data async**, termasuk driver SQLite yang sebenarnya sinkron. Kalau
antarmukanya sinkron, Postgres tidak akan pernah bisa masuk tanpa menulis
ulang setiap pemanggil — dan penulisan ulang itulah yang biasanya tidak
pernah terjadi.

Adapter Postgres diuji terhadap **pg-mem**, bukan cuma di-typecheck. Dua hal
tidak bisa diuji di sana dan dikatakan apa adanya di tesnya: pg-mem tidak
menghormati `ROLLBACK`, dan menolak menjalankan ulang
`CREATE TABLE IF NOT EXISTS` yang punya primary key. Keduanya diuji di
SQLite. **Postgres sungguhan masih perlu dibuktikan di CI.**

### Realtime

Server-Sent Events, bukan WebSocket: yang dibutuhkan cuma satu arah — server
memberi tahu klien bahwa ada yang berubah. SSE jalan di atas HTTP biasa,
lewat proxy yang sama, tanpa protokol kedua yang perlu diamankan sendiri, dan
browser menyambung ulang otomatis.

Event hanya berkata _"utas ini berubah"_; isinya tetap diambil lewat endpoint
biasa. Dengan begitu tidak ada dua jalur data yang bisa menyimpang, dan pesan
yang terlewat saat koneksi putus tetap ikut terbaca pada pengambilan
berikutnya. Menaruh isi pesan di dalam event berarti kehilangan koneksi sama
dengan kehilangan pesan.

Dipakai obrolan grup, aduan, dan negosiasi sparring.

## Menyiapkan produksi

```bash
TOKEN_PEPPER="$(openssl rand -base64 48)" DATABASE_URL=postgres://… npm start
```

Server **menolak start** di produksi kalau ada masalah fatal:

| Setting        | Fatal kalau                                              |
| -------------- | -------------------------------------------------------- |
| `TOKEN_PEPPER` | masih nilai bawaan repositori, atau di bawah 32 karakter |
| `APP_ORIGIN`   | bukan HTTPS                                              |

Pepper diperiksa terhadap **nilainya**, bukan sekadar "apakah variabelnya
diisi": menyalin nilai dari repositori ke `.env` tetap meninggalkan pepper
yang sudah publik, dan setiap token sesi jadi bisa dipalsukan siapa pun yang
pernah membaca repo ini.

Di luar produksi hanya diberitahukan, tidak memblokir — menghalangi
`npm run dev` karena pepper bawaan akan membuat orang menghapus
pemeriksaannya.

**Mengganti `TOKEN_PEPPER` mencabut seluruh sesi dan OTP yang sedang
berjalan**, karena keduanya di-hash dengannya. Itu memang gunanya saat
darurat; jangan dilakukan tanpa sengaja.

`GET /api/health` melaporkan hal yang sama. Deploy yang salah konfigurasi
tampak persis sama dengan yang benar dari luar; ini yang membedakannya tanpa
perlu membaca log start-up.

## Pembayaran

Menekan Bayar dulu langsung mengonfirmasi booking. Itu berarti app menyatakan
lunas tanpa ada uang yang berpindah ke mana pun.

Alurnya sekarang:

```
tagihan dibuat → penyedia menagih → webhook bertanda tangan → dikonfirmasi
```

Penyedianya **Midtrans Snap**, ditulis langsung tanpa SDK — yang paling sering
salah bukan pemanggilannya melainkan verifikasi webhook, yang di SDK mana pun
tetap harus ditulis sendiri.

### Yang membuat uangnya tidak bisa dipalsukan

| Aturan                                         | Kalau tidak                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| Jumlah dibaca dari catatan                     | Tagihan Rp100 untuk lapangan Rp200.000                                     |
| Tanda tangan dibanding `timingSafeEqual`       | Selisih waktu membocorkannya karakter demi karakter                        |
| Jumlah webhook dicocokkan                      | Tanda tangan sah atas angka salah tetap lolos                              |
| Idempoten lewat `payment_events`               | Kiriman ulang penyedia mengkredit poin dua kali                            |
| Yang lunas tidak berubah lagi                  | Webhook `expire` telat membatalkan yang sudah dibayar                      |
| `capture` ≠ lunas tanpa `fraud_status: accept` | Lapangan terkunci untuk transaksi yang bisa dibatalkan                     |
| Webhook dibaca sebagai teks mentah             | `JSON.parse` lalu `stringify` mengubah byte, tanda tangan tak pernah cocok |

Slot baru dikunci **saat lunas**, bukan saat tagihan dibuat — kalau tidak,
orang bisa memblokir lapangan tanpa membayar sepeser pun. Poin belanja juga
menyusul pembayaran.

### Tanpa kredensial: simulator yang mengatakan dirinya simulator

Layarnya menyebutnya, dan QR-nya berisi penanda simulasi — bukan format QRIS
yang tampak sah tapi tidak bisa dibayar. Jalurnya tetap jalur produksi: ia
merakit webhook bertanda tangan lalu mengirimkannya ke endpoint yang sama,
jadi verifikasi tanda tangan ikut terjalani setiap hari alih-alih jadi cabang
yang baru pertama kali berjalan saat rilis.

Di produksi, tidak adanya `MIDTRANS_*` adalah masalah **fatal** yang
menghentikan start. App yang menerima pesanan dan mengaku lunas tanpa gerbang
mengambil barang orang tanpa uang berpindah.

## Iuran keanggotaan

Tagihan per periode (`YYYY-MM`), unik lewat batasan `(user_id, period)` —
dijaga basis data, bukan kehati-hatian pemanggil: dua permintaan yang datang
bersamaan sama-sama lolos pemeriksaan dan sama-sama menulis.

Orangnya jadi anggota berbayar **hanya setelah iurannya masuk**, lewat jalur
pembayaran yang sama dengan booking dan toko.

## Notifikasi push

Web Push dengan service worker dan kunci VAPID. Sebelumnya push sengaja tidak
dipalsukan; sekarang ia sungguhan, dan tetap jujur soal batasnya.

Kunci VAPID **tidak** dibangkitkan otomatis saat start. Kunci publiknya
tersimpan di setiap langganan peramban — membangkitkannya ulang tiap restart
membuat seluruh langganan yang ada tidak bisa dipakai, tanpa satu pun tanda
bahwa itu yang terjadi. Buat sekali:

```bash
npx web-push generate-vapid-keys
```

Tiga keadaan dikatakan apa adanya, bukan disembunyikan di balik satu tombol
yang kadang bekerja: peramban tidak mendukung, server belum dikonfigurasi, dan
izin sudah ditolak permanen adalah tiga masalah berbeda dengan tiga jalan
keluar berbeda. Izin diminta **saat tombolnya ditekan**, bukan saat app
dibuka — peramban menghitung penolakan yang diminta tanpa konteks, dan sekali
ditolak permanen tidak ada cara memintanya lagi dari dalam app.

Langganan disimpan per **endpoint**, bukan per pasangan (user, endpoint): satu
peramban punya satu endpoint, dan kalau perangkatnya berpindah tangan
langganan itu ikut pemilik barunya. Yang dijawab 404/410 oleh layanan push
dihapus — itu jawaban untuk perangkat yang sudah mencabut izin.

**Yang belum terbukti:** pengiriman sungguhan. Itu menuntut layanan push
peramban (FCM, Mozilla autopush) yang bisa dihubungi dari jaringan dan
langganan dari peramban sungguhan. Yang diuji adalah semua yang ada di sisi
kita: penyimpanan, penolakan saat belum dikonfigurasi, perpindahan pemilik
perangkat, dan pembuangan langganan mati.

## Tim & sparring

Tim dibuat sendiri lewat **Lawan → Buat tim**; pembuatnya langsung jadi
anggota pertama, karena tim tanpa anggota tidak bisa mengajak siapa pun.

Ajakan sparring hanya bisa dikirim atas nama tim yang benar-benar diikuti —
diperiksa di server, bukan cuma disaring di layar — dan hanya terlihat oleh
pihak yang terlibat. Sebelumnya satu tim ditanam di kode untuk semua orang,
jadi setiap ajakan mengaku datang dari tim yang sama dan setiap orang melihat
tawar-menawar tim lain.

Pembuat tidak bisa keluar dari timnya sendiri: tim tanpa pemilik tidak bisa
diubah siapa pun lagi, sementara ajakan atas namanya tetap berjalan tanpa ada
yang bertanggung jawab menjawabnya.

## Menggabungkan dua akun

Mendaftar lewat nomor lalu mendaftar lagi lewat email menghasilkan dua akun.
Menyambungkan kontak tidak menolong — kontaknya sudah dipakai akun lain — jadi
jalannya menggabung, lewat **Profil → Atur cara masuk → Punya dua akun?**

Ini satu-satunya operasi di app yang **tidak bisa dibatalkan**, jadi:

- Isi akun yang akan diserap ditunjukkan sebelum kodenya diminta diketik.
- Syarat slot diperiksa **sebelum** kode dikirim.
- Poin dijumlahkan, bukan diambil yang terbesar.
- Baris yang bentrok pada batasan unik dibuang, bukan dipaksa masuk — satu
  orang, satu kursi turnamen. Jumlah yang dibuang dilaporkan.
- Kontak yang slotnya sudah terisi dilepas dan dilaporkan, bukan menimpa.

## Yang masih mock atau belum ada

- **Venue selain klub** masih data contoh Bandung. Data klub sendiri diisi
  lewat dasbor admin — lihat bagian "Dasbor admin klub".
- **Iuran keanggotaan** ditagihkan dan dibayar, tapi belum ada penagihan
  otomatis tiap bulan maupun status anggota yang kedaluwarsa sendiri —
  tagihannya masih diterbitkan saat diminta.
- **Foto venue dan barang toko.** Blok warna beraksen, bukan foto.
- **SMS dan email sungguhan** menunggu Twilio dan SMTP; alurnya sudah lengkap,
  hanya salurannya yang masih log server.
- **Pengiriman push sungguhan** belum terbukti di sini — lihat bagian
  "Notifikasi push". Jalurnya lengkap; yang belum dijalani adalah layanan push
  peramban yang sesungguhnya.
- **Pengiriman barang** tidak ada sama sekali — semua pesanan diambil di klub.
  Itu keputusan, bukan kekurangan; menambahkannya butuh alamat, kurir, dan
  pelacakan, yang tidak ada gunanya dipalsukan.
- **Membubarkan tim** belum ada; pembuatnya juga belum bisa menyerahkan tim
  ke anggota lain.
- **Menggabungkan lewat email** belum ada; penggabungan sekarang selalu
  diverifikasi lewat nomor HP.
- **Pengembalian dana** tidak ada. Pembayaran yang sudah lunas tidak bisa
  ditarik dari dalam app — itu menuntut alur refund penyedia dan keputusan
  siapa yang berwenang menyetujuinya.

## Poin & riwayat main

Ada **dua sumber poin** yang sengaja dipisah:

| Sumber           | Aturan                          | Diatur di      |
| ---------------- | ------------------------------- | -------------- |
| Poin belanja     | 1 poin per Rp1.000 yang dibayar | tetap          |
| Poin partisipasi | per kegiatan yang selesai       | Dasbor → Tarif |

Poin partisipasi bawaan: Bermain 25, Berlatih 40, Main bersama 50, Lomba 150.
Semuanya bisa diubah admin di **Dasbor klub → Tarif & iuran → Poin partisipasi**.

### Kegiatan dicatat, bukan diketik

Empat jenis kegiatan muncul sendiri di Profil → **Riwayat main**:

| Jenis        | Datang dari                                          |
| ------------ | ---------------------------------------------------- |
| Bermain      | booking lunas bertujuan "main", setelah jamnya lewat |
| Berlatih     | booking lunas bertujuan "latihan"                    |
| Main bersama | open match yang diikuti, dan sparring yang diterima  |
| Lomba        | pendaftaran turnamen, setelah turnamennya mulai      |

Tujuan booking dipilih user di layar Ringkasan — itu satu-satunya masukan
manual. Tidak ada layar "catat kegiatan": kalau kegiatan harus diketik ulang,
catatannya akan selalu tertinggal dari kenyataan.

### Kenapa diturunkan, bukan disimpan

`src/lib/activities.ts` **menurunkan** catatan dari booking, open match,
turnamen, dan sparring setiap kali dibaca — tidak ada tabel `activities`.

Dua tempat menyimpan hal yang sama akan menyimpang: booking dibatalkan tapi
catatannya tertinggal, atau sebaliknya. Dengan diturunkan, catatan tidak bisa
berbeda dari kejadiannya, dan booking lama ikut tercatat surut tanpa migrasi.

Tiga aturan yang menahan penyalahgunaan dan kebohongan angka:

- **Belum terjadi, belum dihitung.** Booking minggu depan bukan kegiatan yang
  sudah dilakukan. Kalau dihitung, orang bisa memanen poin lalu membatalkannya.
- **Sekali kredit saja.** Tiap kegiatan punya id stabil (`booking:bk-1`).
  Membuka Profil sepuluh kali tidak memberi poin sepuluh kali.
- **Riwayat memakai angka yang dulu masuk.** Kalau admin menurunkan poin Lomba
  dari 150 ke 10, baris lama tetap menulis +150 — itu yang benar-benar masuk ke
  saldo. Menghitung ulang riwayat dengan tarif hari ini membuat catatan
  berbohong tentang masa lalu.

Angka "x main" di kartu profil ikut turunan ini (Bermain + Main bersama +
Lomba; Berlatih tidak dihitung sebagai main). Sebelumnya itu angka mati yang
tidak pernah berubah berapa kali pun user main.

## Toko merchandise

Barang klub bisa **dibeli dengan uang**, **ditukar dengan poin**, atau
keduanya — admin yang menentukan per barang di **Dasbor klub → Barang toko**.

| Barang tanpa…     | Artinya                       |
| ----------------- | ----------------------------- |
| harga rupiah      | hanya bisa ditukar poin       |
| harga poin        | hanya bisa dibeli dengan uang |
| dua-duanya terisi | pembeli memilih saat memesan  |

Harga poin **tidak** diturunkan dari harga rupiah. Jersey Rp185.000 boleh
ditebus 1.500 poin kalau klub mau memurahkannya; menurunkannya otomatis akan
memaksa satu kurs untuk seluruh katalog.

### Aturan yang menahan stok dan poin

Semuanya di `src/lib/merch.ts`, dipanggil layar **dan** server. Ditulis dua
kali, yang satu akan ketinggalan — dan yang ketinggalan biasanya yang di
server.

- **Stok tinggal di varian, bukan juga di barang.** Dua tempat menyimpan stok
  akan menyimpang begitu satu varian terjual.
- **Menebus poin tidak menghasilkan poin.** Kalau ia menghasilkan, tiap
  penebusan mengembalikan sebagian ongkosnya dan saldo tidak pernah turun.
  Membeli dengan uang tetap dapat poin belanja seperti biasa (1 per Rp1.000).
- **Membatalkan mengembalikan stok _dan_ poin.** Poin belanja yang sempat
  didapat ikut ditarik: tanpa itu, membeli lalu membatalkan jadi cara mencetak
  poin tanpa membayar apa pun.
- **Pesan penolakan menyebut angkanya** — "Stok M tinggal 4", bukan "stok
  tidak cukup". Orang perlu tahu harus mengubah apa.
- Maksimal 5 per pesanan, supaya satu orang tidak mengosongkan stok sekali
  ketuk.

Pesanan **diambil di klub**, tidak dikirim. Tidak ada alamat, kurir, atau
pelacakan — memasangnya berarti meniru bentuk pengiriman tanpa memberi
sifatnya. Anggota membatalkan sendiri selama status masih "Menunggu
konfirmasi"; setelah itu sudah menyangkut kerja orang lain di klub.

Alur status: Menunggu → Disiapkan → Siap diambil → Selesai. Yang sudah
`Selesai` tidak bisa dibatalkan — barangnya sudah berpindah tangan, dan
membatalkannya hanya akan membohongi stok.

Toko sengaja **tidak** jadi tab kelima: brief mematok empat tab, jadi pintu
masuknya lewat Home dan Profil.

## Aduan & pesan ke admin

**Profil → Bantuan & aduan**, atau tautan dari halaman pesanan toko. Anggota
menulis, klub membalas, di **satu utas yang sama**. Bukan dua layar yang mirip:
kalau tiap peran punya salinan sendiri, cepat atau lambat salah satunya
menampilkan percakapan yang tidak lengkap.

### Status mengikuti percakapan, bukan tombol

`src/lib/complaints.ts` menggerakkan status dari siapa yang menulis terakhir:

| Kejadian                          | Status jadi             |
| --------------------------------- | ----------------------- |
| Klub membalas aduan **Baru**      | Diproses                |
| Anggota membalas yang **Selesai** | Diproses (terbuka lagi) |
| Klub menekan "Tandai Selesai"     | Selesai                 |

Kalau status hanya berubah saat admin menekan sesuatu, daftar akan penuh
"Baru" yang sebenarnya sudah dijawab, dan "Selesai" yang sebenarnya masih
dipersoalkan.

Dasbor admin membuka di tab **"Perlu dijawab"**, bukan "Semua": yang dicari
pengurus saat membuka layar itu adalah pekerjaan yang belum dikerjakan.
Lencana di dasbor menghitung hal yang sama.

Aduan bisa dikaitkan dengan booking atau pesanan toko. Opsional, tapi
ditawarkan lebih dulu — aduan yang menyebut kode transaksi bisa
ditindaklanjuti tanpa bertanya balik.

## Sparring: waktunya dinegosiasikan

Menerima ajakan tanpa waktu yang disepakati tidak menghasilkan apa pun yang
bisa dicatat sebagai kegiatan, jadi server menolaknya dan meminta jamnya
diusulkan lebih dulu.

| Kejadian                                 | Akibatnya                                       |
| ---------------------------------------- | ----------------------------------------------- |
| Usulan waktu dikirim                     | Ajakan memakai jam itu, status "Menunggu"       |
| Usulan baru masuk                        | Usulan lama ditandai **diganti**, bukan dihapus |
| Ajakan yang sudah diterima ditawar ulang | Terbuka lagi jadi "Menunggu"                    |
| Ajakan diterima                          | Usulan terakhir ditandai **diterima**           |

Usulan lama disimpan karena riwayat tawar-menawar itulah yang menjelaskan
bagaimana kedua tim sampai pada jam yang disepakati — dan itu persis yang
dicari saat salah satu pihak merasa jamnya bukan yang ia setujui.

Usulan dari lawan masuk lewat SSE. Tawar-menawar jam yang balasannya baru
terlihat setelah halaman dimuat ulang bukan tawar-menawar, itu
surat-menyurat.

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
| Barang toko, harga, stok varian  | Katalog toko dan apa yang bisa ditebus poin  |
| Status pesanan toko              | Yang dilihat anggota di halaman pesanannya   |

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

Riwayat main bawaan (tiga booking lewat dan satu turnamen) adalah data contoh,
supaya Riwayat main tidak tampak kosong saat pertama dibuka. Semuanya melewati
penurunan yang sama dengan kegiatan sungguhan — bukan angka yang ditulis
langsung ke layar. Hapus dari `seed()` di `src/mocks/db.ts` kalau app dipakai
dengan data asli.

Masih berguna kalau ada: **foto lapangan asli** (minimal 3, rasio 4:3) untuk
menggantikan blok warna placeholder, ketentuan pembatalan, dan aturan poin
loyalitas yang sudah disepakati.
