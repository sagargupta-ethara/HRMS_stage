import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AuthProvider } from './context/AuthContext';
import { Toaster } from './components/ui/sonner';
import ProtectedRoute from './components/ProtectedRoute';
import Sidebar, { PersistentSidebarContext } from './components/Sidebar';

import Dashboard from './pages/Dashboard';
import WikiCategory from './pages/WikiCategory';
import WikiPage from './pages/WikiPage';
import WikiPageEdit from './pages/WikiPageEdit';
import UserManagement from './pages/UserManagement';
import Profile from './pages/Profile';
import GrievanceSubmit from './pages/GrievanceSubmit';
import GrievanceManage from './pages/GrievanceManage';
import TrainingGetStarted from './pages/TrainingGetStarted';
import DeepLearning from './pages/DeepLearning';
import ProcessFlowPage from './pages/ProcessFlowPage';
import HolidayCalendarPage from './pages/HolidayCalendarPage';
import AnalyticsDashboard from './pages/AnalyticsDashboard';
import BirthdaySettings from './pages/BirthdaySettings';

const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
};

const WikiRouteTransition = () => {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        initial={pageTransition.initial}
        animate={pageTransition.animate}
        exit={pageTransition.exit}
        transition={pageTransition.transition}
        className="wiki-route-stage min-h-screen"
      >
        <Outlet />
      </motion.div>
    </AnimatePresence>
  );
};

const WikiShell = () => (
  <PersistentSidebarContext.Provider value>
    <div className="dashboard-shell flex min-h-screen bg-background">
      <Sidebar persistent />
      <div className="min-w-0 flex-1">
        <WikiRouteTransition />
      </div>
    </div>
  </PersistentSidebarContext.Provider>
);

function App() {
  const basename = process.env.REACT_APP_BASENAME || "";

  return (
    <AuthProvider>
      <Router basename={basename}>
        <div className="min-h-screen bg-background">
          <Routes>
            <Route path="/login" element={<Navigate to="/dashboard" replace />} />
            <Route path="/register" element={<Navigate to="/dashboard" replace />} />
            <Route path="/forgot-password" element={<Navigate to="/dashboard" replace />} />
            
            <Route element={
              <ProtectedRoute>
                <WikiShell />
              </ProtectedRoute>
            }>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/wiki/:categoryId" element={<WikiCategory />} />
              <Route path="/wiki/:categoryId/:subcategory" element={<WikiCategory />} />
              <Route path="/wiki/page/:slug" element={<WikiPage />} />
              <Route path="/wiki/edit/:slug" element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <WikiPageEdit />
                </ProtectedRoute>
              } />
              <Route path="/admin/users" element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <UserManagement />
                </ProtectedRoute>
              } />
              <Route path="/profile" element={<Profile />} />
              <Route path="/grievances/submit" element={<GrievanceSubmit />} />
              <Route path="/grievances/manage" element={
                <ProtectedRoute allowedRoles={['admin', 'hr']}>
                  <GrievanceManage />
                </ProtectedRoute>
              } />
              <Route path="/training/get-started" element={<TrainingGetStarted />} />
              <Route path="/training/deep-learning" element={<DeepLearning />} />
              <Route path="/training/deep-learning/:docId" element={<DeepLearning />} />
              <Route path="/process-flow" element={<ProcessFlowPage />} />
              <Route path="/hr/holiday-calendar" element={<HolidayCalendarPage />} />
              <Route path="/analytics" element={<AnalyticsDashboard />} />
              <Route path="/admin/birthdays" element={
                <ProtectedRoute allowedRoles={['admin', 'hr']}>
                  <BirthdaySettings />
                </ProtectedRoute>
              } />
            </Route>
            
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
          
          <Toaster 
            position="top-right"
            theme="dark"
            richColors
          />
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
