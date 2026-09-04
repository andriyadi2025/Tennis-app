import { useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Pencil, Plus, Receipt, Trash2 } from 'lucide-react'
import type { MerchCategory, MerchItem, MerchItemDraft } from '@/types'
import { MERCH_CATEGORY_LABEL } from '@/types'
import { useAddMerchItem, useAdminMerch, useUpdateMerchItem } from '@/hooks/queries'
import { useToast } from '@/hooks/useToast'
import { totalStock } from '@/lib/merch'
import { formatIdr } from '@/lib/money'
import { Screen, ScreenHeader, StickyBar } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { NumberField } from '@/components/ui/NumberField'
import { Toast } from '@/components/ui/Toast'
import { Chip, TextField, Toggle } from '@/components/ui/primitives'
import { AsyncList, EmptyState, RowSkeleton } from '@/components/ui/states'

const CATEGORIES = Object.keys(MERCH_CATEGORY_LABEL) as MerchCategory[]

interface FormState {
  name: string
  category: MerchCategory
  description: string
  /** Kosong berarti "tidak dijual dengan cara ini" — bukan nol. */
  priceIdr: string
  pricePoints: string
  variants: { label: string; stock: string }[]
  membersOnly: boolean
  active: boolean
}

function emptyForm(): FormState {
  return {
    name: '',
    category: 'apparel',
    description: '',
    priceIdr: '',
    pricePoints: '',
    variants: [{ label: 'Satu ukuran', stock: '0' }],
    membersOnly: false,
    active: true,
  }
}

function formFrom(item: MerchItem): FormState {
  return {
    name: item.name,
    category: item.category,
    description: item.description,
    priceIdr: item.priceIdr === null ? '' : String(item.priceIdr),
    pricePoints: item.pricePoints === null ? '' : String(item.pricePoints),
    variants: item.variants.map((v) => ({ label: v.label, stock: String(v.stock) })),
    membersOnly: item.membersOnly,
    active: item.active,
  }
}

/**
 * Kotak kosong berarti "tidak dijual dengan cara itu", nol berarti "gratis".
 * Keduanya harus bisa dibedakan, jadi harga ditahan sebagai string sampai
 * dikirim — memaksanya jadi number lebih awal membuat kosong dan nol sama.
 */
function toDraft(form: FormState): MerchItemDraft {
  const parse = (text: string) => (text.trim() === '' ? null : Number(text))
  return {
    name: form.name,
    category: form.category,
    description: form.description,
    priceIdr: parse(form.priceIdr),
    pricePoints: parse(form.pricePoints),
    variants: form.variants.map((v) => ({ label: v.label, stock: Number(v.stock || 0) })),
    membersOnly: form.membersOnly,
    active: form.active,
  }
}

/** Kelola barang toko: tambah, ubah harga, atur stok, sembunyikan. */
export function AdminMerchScreen() {
  const items = useAdminMerch()
  const [editing, setEditing] = useState<MerchItem | 'baru' | null>(null)
  const { toast, show } = useToast()

  return (
    <Screen
      overlay={<Toast toast={toast} />}
      bottom={
        <StickyBar>
          <Button size="lg" block onClick={() => setEditing('baru')}>
            <Icon icon={Plus} size={19} />
            Tambah barang
          </Button>
        </StickyBar>
      }
    >
      <ScreenHeader
        title="Barang toko"
        action={
          <Link
            to="/admin/toko/pesanan"
            aria-label="Pesanan masuk"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-surface"
          >
            <Icon icon={Receipt} size={19} />
          </Link>
        }
      />

      <AsyncList
        isLoading={items.isLoading}
        error={items.error}
        data={items.data}
        onRetry={() => void items.refetch()}
        skeleton={<RowSkeleton count={4} />}
        empty={
          <EmptyState
            title="Katalog masih kosong"
            body="Tambahkan barang pertama supaya toko punya isi."
          />
        }
      >
        {(rows) => (
          <ul className="flex flex-col gap-2.5">
            {rows.map((item) => (
              <li key={item.id}>
                <ItemRow item={item} onEdit={() => setEditing(item)} />
              </li>
            ))}
          </ul>
        )}
      </AsyncList>

      <p className="text-sm text-neutral-600">
        Barang tanpa harga rupiah hanya bisa ditukar poin, dan sebaliknya. Menonaktifkan barang
        menyembunyikannya dari katalog tanpa menghapus riwayat pesanannya.
      </p>

      {editing && (
        <ItemSheet
          item={editing === 'baru' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null)
            show(message)
          }}
        />
      )}
    </Screen>
  )
}

function ItemRow({ item, onEdit }: { item: MerchItem; onEdit: () => void }) {
  const stok = totalStock(item)
  return (
    <div
      className={clsx(
        'flex items-center gap-3.5 rounded-lg bg-surface p-4',
        !item.active && 'opacity-60',
      )}
    >
      <div className="flex flex-1 flex-col gap-1">
        <span className="text-md font-bold leading-snug">{item.name}</span>
        <span className="text-sm text-neutral-700">
          {item.priceIdr !== null && formatIdr(item.priceIdr)}
          {item.priceIdr !== null && item.pricePoints !== null && ' · '}
          {item.pricePoints !== null && `${item.pricePoints.toLocaleString('id-ID')} poin`}
        </span>
        <div className="flex flex-wrap gap-1.5">
          <Chip tone={stok > 0 ? 'outline' : 'accent'}>{stok > 0 ? `Stok ${stok}` : 'Habis'}</Chip>
          {item.membersOnly && <Chip tone="sage">Anggota</Chip>}
          {!item.active && <Chip tone="neutral">Nonaktif</Chip>}
        </div>
      </div>
      <button
        type="button"
        aria-label={`Ubah ${item.name}`}
        onClick={onEdit}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-bg"
      >
        <Icon icon={Pencil} size={17} />
      </button>
    </div>
  )
}

const SHEET_FORM = 'form-barang'

function ItemSheet({
  item,
  onClose,
  onSaved,
}: {
  item: MerchItem | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [form, setForm] = useState<FormState>(item ? formFrom(item) : emptyForm())
  const add = useAddMerchItem()
  const update = useUpdateMerchItem()
  const save = item ? update : add
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  function submit() {
    const draft = toDraft(form)
    const done = () => onSaved(item ? 'Barang diperbarui.' : 'Barang ditambahkan.')
    if (item) update.mutate({ id: item.id, draft }, { onSuccess: done })
    else add.mutate(draft, { onSuccess: done })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item ? `Ubah ${item.name}` : 'Tambah barang'}
      className="sheet-backdrop absolute inset-0 z-20 flex flex-col justify-end"
    >
      <button
        type="button"
        aria-label="Tutup"
        className="flex-1 cursor-default"
        onClick={onClose}
      />

      <div className="scroll-area flex max-h-[90%] flex-col gap-5 rounded-t-lg bg-bg px-5 pb-5 pt-6">
        <h2 className="text-3xl">{item ? 'Ubah barang' : 'Barang baru'}</h2>

        {/* noValidate: batas sungguhannya divalidasi server, yang pesannya
            bisa ditampilkan — bukan diblokir diam-diam oleh peramban. */}
        <form
          id={SHEET_FORM}
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <TextField
            label="Nama barang"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Jersey latihan DBTC"
          />

          <div className="flex flex-col gap-2">
            <span className="text-sm text-neutral-700">Kategori</span>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={form.category === value}
                  onClick={() => set('category', value)}
                  className={clsx(
                    'min-h-touch rounded-pill px-4 text-base font-semibold transition-colors',
                    form.category === value
                      ? 'bg-accent2-600 text-accent2-100'
                      : 'border border-divider text-text hover:bg-neutral-200',
                  )}
                >
                  {MERCH_CATEGORY_LABEL[value]}
                </button>
              ))}
            </div>
          </div>

          <TextField
            label="Keterangan"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Bahan, ukuran, catatan pengambilan"
          />

          <NumberField
            label="Harga rupiah"
            prefix="Rp"
            hint="Kosongkan kalau barang ini hanya bisa ditukar poin."
            min={0}
            value={form.priceIdr}
            onChange={(next) => set('priceIdr', next)}
          />

          <NumberField
            label="Harga poin"
            suffix="poin"
            hint="Kosongkan kalau barang ini tidak bisa ditukar poin."
            min={0}
            value={form.pricePoints}
            onChange={(next) => set('pricePoints', next)}
          />

          <section className="flex flex-col gap-2.5">
            <h3 className="text-xl">Varian & stok</h3>
            {form.variants.map((variant, index) => (
              <div key={index} className="flex items-end gap-2.5">
                <div className="flex-1">
                  <TextField
                    label={`Varian ${index + 1}`}
                    value={variant.label}
                    onChange={(e) =>
                      set(
                        'variants',
                        form.variants.map((v, i) =>
                          i === index ? { ...v, label: e.target.value } : v,
                        ),
                      )
                    }
                    placeholder="M"
                  />
                </div>
                <div className="w-28">
                  <NumberField
                    label="Stok"
                    min={0}
                    value={variant.stock}
                    onChange={(next) =>
                      set(
                        'variants',
                        form.variants.map((v, i) => (i === index ? { ...v, stock: next } : v)),
                      )
                    }
                  />
                </div>
                <button
                  type="button"
                  aria-label={`Hapus varian ${index + 1}`}
                  disabled={form.variants.length === 1}
                  onClick={() =>
                    set(
                      'variants',
                      form.variants.filter((_, i) => i !== index),
                    )
                  }
                  className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-surface disabled:opacity-40"
                >
                  <Icon icon={Trash2} size={16} />
                </button>
              </div>
            ))}
            <Button
              variant="secondary"
              onClick={() => set('variants', [...form.variants, { label: '', stock: '0' }])}
            >
              <Icon icon={Plus} size={16} />
              Tambah varian
            </Button>
          </section>

          <Toggle
            checked={form.membersOnly}
            onChange={(next) => set('membersOnly', next)}
            label="Khusus anggota"
            description="Hanya anggota berbayar yang bisa memesan."
          />

          <Toggle
            checked={form.active}
            onChange={(next) => set('active', next)}
            label="Tampilkan di katalog"
            description="Matikan untuk menyembunyikan tanpa menghapus."
          />

          {save.error && (
            <p role="alert" className="text-base text-accent-700">
              {save.error.message}
            </p>
          )}
        </form>

        <div className="flex gap-3">
          <Button variant="secondary" block onClick={onClose} disabled={save.isPending}>
            Batal
          </Button>
          <Button type="submit" form={SHEET_FORM} block disabled={save.isPending}>
            {save.isPending ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </div>
      </div>
    </div>
  )
}
