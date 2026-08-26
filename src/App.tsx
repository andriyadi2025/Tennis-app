import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AndroidFrame } from '@/components/layout/AndroidFrame'
import { BottomNav } from '@/components/layout/BottomNav'
import { useAuthStore } from '@/store/auth'

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

/** Rute tingkat atas — hanya di sini bottom nav muncul. */
function TabLayout() {
  return (
    <>
      <Outlet />
      <BottomNav />
    </>
  )
}

function RequireAuth() {
  const user = useAuthStore((s) => s.user)
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

export function App() {
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
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AndroidFrame>
  )
}
