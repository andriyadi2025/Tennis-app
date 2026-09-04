/**
 * Tipe domain tinggal di `shared/` supaya server memakai definisi yang sama
 * persis, bukan salinan yang akan menyimpang. Berkas ini tinggal jadi pintu
 * masuknya untuk klien, supaya seluruh impor `@/types` tidak perlu diubah.
 */
export * from '../../shared/types.ts'
