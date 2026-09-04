import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import './styles/global.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data domain berubah pelan; refetch saat fokus hanya bikin skeleton
      // berkedip. Yang benar-benar perlu segera terlihat — pesan obrolan —
      // datang lewat SSE, bukan lewat polling.
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
})

/*
 * Tidak ada lagi backend tiruan di dalam browser.
 *
 * Seluruh /api sekarang menuju server Express yang sama dengan yang
 * dijalankan produksi. MSW tetap ada, tapi hanya untuk tes komponen: di sana
 * memakai server sungguhan justru membuat tes bergantung pada proses lain
 * yang harus hidup lebih dulu.
 */
function bootstrap(): void {
  const container = document.getElementById('root')
  if (!container) throw new Error('#root tidak ditemukan')

  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
}

bootstrap()
