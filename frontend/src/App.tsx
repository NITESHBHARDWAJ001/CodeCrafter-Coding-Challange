import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAdmin, RequireAuth } from './auth/AuthContext';
import { AdminLayout, StudentLayout } from './components/Layouts';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from './pages/Auth';
import Dashboard from './pages/Dashboard';
import { ProgramDetailPage, ProgramsPage } from './pages/Programs';
import LeaderboardPage from './pages/LeaderboardPage';
import ProfilePage from './pages/Profile';
import { VerifyPage } from './pages/Verify';
import {
  AdminAnalyticsPage, AdminCertificatesPage, AdminChallengesPage, AdminDashboard, AdminLeaderboardsPage, AdminParticipantsPage,
  AdminProgramPage, AdminPrograms, AdminSettingsPage, AdminSyncPage,
} from './pages/admin/AdminPages';

export default function App() {
  return (
    <Routes>
      {/* public */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify/:code" element={<VerifyPage />} />

      {/* signed-in students */}
      <Route element={<RequireAuth />}>
        <Route element={<StudentLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="programs" element={<ProgramsPage />} />
          <Route path="programs/:id" element={<ProgramDetailPage />} />
          <Route path="leaderboard" element={<LeaderboardPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>

        {/* admins (server enforces this too; this only hides the UI) */}
        <Route element={<RequireAdmin />}>
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="programs" element={<AdminPrograms />} />
            <Route path="programs/:id" element={<AdminProgramPage />} />
            <Route path="challenges" element={<AdminChallengesPage />} />
            <Route path="participants" element={<AdminParticipantsPage />} />
            <Route path="leaderboards" element={<AdminLeaderboardsPage />} />
            <Route path="sync" element={<AdminSyncPage />} />
            <Route path="certificates" element={<AdminCertificatesPage />} />
            <Route path="analytics" element={<AdminAnalyticsPage />} />
            <Route path="settings" element={<AdminSettingsPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
