import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'

/** Query client baru tiap tes: tidak ada cache yang bocor antar kasus. */
function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

/** Menampilkan URL saat ini supaya tes bisa memeriksa sinkronisasi filter. */
export function LocationProbe() {
  const location = useLocation()
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  )
}

interface Options {
  /** URL awal, mis. "/venue/v-cendana/schedule". */
  route?: string
  /** Pola rute kalau komponen memakai useParams. */
  path?: string
  extra?: ReactNode
}

export function renderWithProviders(ui: ReactElement, options: Options = {}): RenderResult {
  const { route = '/', path, extra } = options
  const client = makeClient()

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        {path ? <Routes>{<Route path={path} element={ui} />}</Routes> : ui}
        {extra}
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
