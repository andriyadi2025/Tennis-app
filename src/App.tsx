import { useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AndroidFrame } from '@/components/layout/AndroidFrame'
import { BottomNav } from '@/components/layout/BottomNav'
import { useAuthStore } from '@/store/auth'
import { usePreferencesStore } from '@/store/preferences'

import { LoginScreen } from '@/routes/LoginScreen'
import { HomeScreen } from '@/routes/HomeScreen'
import { SearchScreen } from '@/routes/SearchScreen'
import { VenueDetailScreen } from '@/routes/VenueDetailScreen'
import { ReviewsScreen } from '@/routes/ReviewsScreen'
import { ScheduleScreen } from '@/routes/ScheduleScreen'
import { SummaryScreen } from '@/routes/SummaryScreen'
import { PaymentScreen } from '@/routes/PaymentScreen'
import { TicketScreen } from '@/routes/TicketScreen'
import { BookingsScreen } from '@/routes/BookingsScreen'
import { ProfileScreen } from '@/routes/ProfileScreen'
import { NotificationsScreen } from '@/routes/NotificationsScreen'
import { MatchScreen } from '@/routes/MatchScreen'
import { MatchDetailScreen } from '@/routes/MatchDetailScreen'
import { TournamentsScreen } from '@/routes/TournamentsScreen'
import { TeamScreen } from '@/routes/TeamScreen'
import { ChatScreen } from '@/routes/ChatScreen'
import { SparringScreen } from '@/routes/SparringScreen'
import { SettingsScreen } from '@/routes/SettingsScreen'
import { AdminScreen } from '@/routes/admin/AdminScreen'
import { AdminCourtsScreen } from '@/routes/admin/AdminCourtsScreen'
import { AdminPricingScreen } from '@/routes/admin/AdminPricingScreen'
import { AdminClubScreen } from '@/routes/admin/AdminClubScreen'

/** Rute tingkat atas — hanya di sini bottom nav muncul. */
function TabLayout() {
  return (
    <>
      <Outlet />
      <BottomNav />
    </>
  )
}

/**
 * Rute admin dijaga di klien supaya menu dan halamannya tidak muncul untuk
 * anggota biasa. Penjaga sebenarnya tetap di server: tiap endpoint admin
 * menolak yang bukan admin, karena penjaga di klien bisa dilewati.
 */
function RequireAdmin() {
  const user = useAuthStore((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') return <Navigate to="/profile" replace />
  return <Outlet />
}

function RequireAuth() {
  const user = useAuthStore((s) => s.user)
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

export function App() {
  const reduceMotion = usePreferencesStore((s) => s.reduceMotion)

  /*
   * Preferensi ini dipasang di root dokumen, bukan diteruskan sebagai prop,
   * supaya satu aturan CSS bisa menjinakkan seluruh animasi sekaligus —
   * termasuk yang ada di dalam komponen yang tidak tahu-menahu soal setelan.
   */
  useEffect(() => {
    document.documentElement.toggleAttribute('data-reduce-motion', reduceMotion)
  }, [reduceMotion])

  return (
    <AndroidFrame>
      <Routes>
        <Route path="/login" element={<LoginScreen />} />

        <Route element={<RequireAuth />}>
          {/* Berbagi bottom nav */}
          <Route element={<TabLayout />}>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/match" element={<MatchScreen />} />
            <Route path="/bookings" element={<BookingsScreen />} />
            <Route path="/profile" element={<ProfileScreen />} />
          </Route>

          {/* Kedalaman kedua — tanpa bottom nav, ada tombol kembali */}
          <Route path="/search" element={<SearchScreen />} />
          <Route path="/venue/:id" element={<VenueDetailScreen />} />
          <Route path="/venue/:id/reviews" element={<ReviewsScreen />} />
          <Route path="/venue/:id/schedule" element={<ScheduleScreen />} />
          <Route path="/booking/summary" element={<SummaryScreen />} />
          <Route path="/booking/payment" element={<PaymentScreen />} />
          <Route path="/booking/:id/ticket" element={<TicketScreen />} />
          <Route path="/notifications" element={<NotificationsScreen />} />
          <Route path="/match/:id" element={<MatchDetailScreen />} />
          <Route path="/tournaments" element={<TournamentsScreen />} />
          <Route path="/team/:id" element={<TeamScreen />} />
          <Route path="/chat/:id" element={<ChatScreen />} />
          <Route path="/sparring" element={<SparringScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />

          {/* Dasbor admin klub */}
          <Route element={<RequireAdmin />}>
            <Route path="/admin" element={<AdminScreen />} />
            <Route path="/admin/lapangan" element={<AdminCourtsScreen />} />
            <Route path="/admin/tarif" element={<AdminPricingScreen />} />
            <Route path="/admin/klub" element={<AdminClubScreen />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AndroidFrame>
  )
}
