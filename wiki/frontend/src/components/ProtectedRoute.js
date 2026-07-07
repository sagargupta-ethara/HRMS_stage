import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ProtectedRoute = ({ children, allowedRoles = [] }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="gradient-radial flex items-center justify-center min-h-screen bg-background px-6">
        <div className="dashboard-panel text-center max-w-md rounded-2xl p-8">
          <h1 className="text-2xl font-heading font-bold text-foreground mb-2">Employee Wiki session required</h1>
          <p className="text-foreground-muted mb-6">Your HRMS sign-in unlocks the Wiki automatically — no separate login needed. Open the Wiki from the employee sidebar after signing in to HRMS.</p>
          <a
            href="/dashboard/employee"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Go to HRMS sign-in
          </a>
        </div>
      </div>
    );
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

export default ProtectedRoute;
