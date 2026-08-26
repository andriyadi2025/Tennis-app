import { setupServer } from 'msw/node'
import { handlers } from './handlers'

/** Dipakai tes komponen — MSW yang sama, transport-nya saja yang beda. */
export const server = setupServer(...handlers)
