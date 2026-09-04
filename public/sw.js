/*
 * Service worker untuk notifikasi push.
 *
 * Sengaja tidak melakukan caching apa pun. Service worker yang menyimpan
 * cache tanpa strategi invalidasi yang dipikirkan adalah cara paling andal
 * untuk menyajikan versi lama app kepada orang yang sudah me-refresh
 * berkali-kali — dan yang dibutuhkan di sini cuma push.
 *
 * Berkas ini disajikan apa adanya dari `public/`, jadi ia JavaScript biasa,
 * bukan TypeScript: service worker didaftarkan lewat URL dan tidak melewati
 * bundler.
 */

self.addEventListener('install', () => {
  // Langsung aktif; tanpa ini versi baru menunggu semua tab lama ditutup.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  /*
   * Muatan yang tidak bisa dibaca tetap memunculkan notifikasi umum.
   * Beberapa layanan push mengirim ping tanpa isi, dan diam sepenuhnya
   * membuat orang mengira push-nya rusak.
   */
  let payload = { title: 'DBTC', body: 'Ada pembaruan di app.', href: '/notifications' }
  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch {
    // Biarkan nilai bawaannya.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: payload.tag || 'dbtc',
      // Notifikasi dengan tag yang sama saling mengganti, dan `renotify`
      // membuat yang baru tetap berbunyi alih-alih diganti diam-diam.
      renotify: Boolean(payload.tag),
      data: { href: payload.href || '/notifications' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const href = (event.notification.data && event.notification.data.href) || '/notifications'

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      /*
       * Tab yang sudah terbuka difokuskan dan diarahkan, bukan dibuka tab
       * baru. Mengetuk lima notifikasi tidak seharusnya meninggalkan lima
       * salinan app.
       */
      for (const client of all) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client) await client.navigate(href)
          return
        }
      }
      await self.clients.openWindow(href)
    })(),
  )
})
