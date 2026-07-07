import React, { createContext, useContext, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, FileText, Users, ChevronDown,
  Menu, X, MessageSquareWarning, ClipboardList, BarChart3, Cake, UserRound
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const PersistentSidebarContext = createContext(false);

const SIDEBAR_CATEGORIES = [
  { id: 'foundation', name: 'Foundation', subcategories: ['Core Values', 'What We Do', 'Organigram'] },
  { id: 'operations', name: 'Operations', subcategories: ['Process Flow'] },
  { id: 'hr', name: 'HR', subcategories: ['Leave Policy', 'Holiday Calendar', 'Code of Conduct', 'FAQs'] },
  { id: 'training', name: 'Training & Learning', subcategories: ['Deep Learning', 'Training: Get Started'] }
];

const HRMS_PROFILE_DASHBOARD_PATH = '/dashboard/employee';
const EXPANDED_STORAGE_KEY = 'ethara_wiki_sidebar_expanded';

const Sidebar = ({ persistent = false }) => {
  const hasPersistentSidebar = useContext(PersistentSidebarContext);
  const { user } = useAuth();
  const location = useLocation();
  const [expandedCategories, setExpandedCategories] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(EXPANDED_STORAGE_KEY) || '{}') || {};
    } catch {
      return {};
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(expandedCategories));
    } catch {
      // Ignore storage errors; the sidebar still works without persistence.
    }
  }, [expandedCategories]);

  const toggleCategory = (categoryId) => {
    setExpandedCategories(prev => ({ ...prev, [categoryId]: !prev[categoryId] }));
  };

  const isActive = (path) => location.pathname === path;

  const getSubLink = (category, sub) => {
    if (category.id === 'training' && sub === 'Training: Get Started') return '/training/get-started';
    if (category.id === 'training' && sub === 'Deep Learning') return '/training/deep-learning';
    if (category.id === 'operations' && sub === 'Process Flow') return '/process-flow';
    if (category.id === 'hr' && sub === 'Holiday Calendar') return '/hr/holiday-calendar';
    const slugMap = {
      'Core Values': '/wiki/page/core-values',
      'What We Do': '/wiki/page/what-we-do',
      'Organigram': '/wiki/page/organization-chart',
      'Leave Policy': '/wiki/page/leave-policy',
      'Code of Conduct': '/wiki/page/code-of-conduct',
      'FAQs': '/wiki/page/faqs',
    };
    if (slugMap[sub]) return slugMap[sub];
    return `/wiki/${category.id}/${sub.toLowerCase().replace(/\s+/g, '-')}`;
  };

  const getCategoryLink = (category) => {
    // Foundation and HR get landing pages; others go to first sub-tab
    if (category.id === 'foundation') return '/wiki/foundation';
    if (category.id === 'hr') return '/wiki/hr';
    const firstSub = category.subcategories[0];
    return getSubLink(category, firstSub);
  };

  const isCategoryActive = (category) => {
    if (location.pathname === `/wiki/${category.id}`) return true;
    return category.subcategories.some(sub => location.pathname === getSubLink(category, sub));
  };

  useEffect(() => {
    const active = SIDEBAR_CATEGORIES.find((category) => {
      if (location.pathname === `/wiki/${category.id}`) return true;
      return category.subcategories.some((sub) => location.pathname === getSubLink(category, sub));
    });
    if (!active) return;
    setExpandedCategories((prev) => (prev[active.id] ? prev : { ...prev, [active.id]: true }));
  }, [location.pathname]);

  if (hasPersistentSidebar && !persistent) {
    return null;
  }

  const getTestId = (category, sub) => {
    if (sub === 'Training: Get Started') return 'training-get-started-link';
    if (sub === 'Deep Learning') return 'training-deep-learning-link';
    if (sub === 'Process Flow') return 'process-flow-link';
    if (sub === 'Holiday Calendar') return 'holiday-calendar-link';
    return `subcategory-link-${sub.toLowerCase().replace(/\s+/g, '-')}`;
  };

  const birthdayAccent = 'bg-primary/10 text-primary';
  const grievanceAccent = 'bg-amber-500/10 text-amber-400';

  const NavItem = ({ to, icon: Icon, label, testId, activeMatch, accent }) => {
    const active = activeMatch ? activeMatch(location.pathname) : isActive(to);
    return (
      <Link
        to={to}
        data-testid={testId}
        onClick={() => setMobileOpen(false)}
        className={`sidebar-link flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all text-sm ${
          active
            ? `${accent || 'bg-primary/10 text-primary'} active`
            : 'text-[rgba(197,203,232,0.62)] hover:text-foreground hover:bg-[rgba(144,141,206,0.10)]'
        }`}
      >
        <Icon size={18} className={active && !accent ? 'text-primary' : ''} />
        <span className="font-medium">{label}</span>
      </Link>
    );
  };

  const ExternalNavItem = ({ href, icon: Icon, label, testId }) => (
    <a
      href={href}
      data-testid={testId}
      onClick={() => setMobileOpen(false)}
      className="sidebar-link flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all text-sm text-[rgba(197,203,232,0.62)] hover:text-foreground hover:bg-[rgba(144,141,206,0.10)]"
    >
      <Icon size={18} />
      <span className="font-medium">{label}</span>
    </a>
  );

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-5 pb-4">
        <Link to="/dashboard" className="flex items-center gap-2.5">
          <img src={`${process.env.PUBLIC_URL || ''}/ethara-logo-white.png`} alt="Ethara AI" className="h-7 w-auto" />
        </Link>
        <p className="mt-1.5 ml-0.5 text-[11px] tracking-wide text-foreground-muted">
          COMPANY WIKI
        </p>
      </div>

      <div className="mx-4 h-px bg-gradient-to-r from-transparent via-[rgba(144,141,206,0.25)] to-transparent" />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto scrollbar-hide px-3 py-4 space-y-1">
        <NavItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" testId="dashboard-nav-link" />
        {user?.role === 'admin' && <NavItem to="/analytics" icon={BarChart3} label="Analytics" testId="analytics-nav-link" />}

        <div className="pt-5 pb-1">
          <p className="px-4 mb-2 text-[10px] font-semibold tracking-widest text-accent">WIKI</p>
        </div>

        {SIDEBAR_CATEGORIES.map((category) => (
          <div key={category.id}>
            <div className={`flex items-center rounded-xl transition-all text-sm ${
              isCategoryActive(category)
                ? 'text-foreground bg-[rgba(144,141,206,0.14)]'
                : 'text-[rgba(197,203,232,0.62)] hover:text-foreground hover:bg-[rgba(144,141,206,0.10)]'
            }`}>
              <Link
                to={getCategoryLink(category)}
                data-testid={`category-${category.id}-link`}
                className="flex-1 flex items-center gap-3 px-4 py-2"
                onClick={() => setMobileOpen(false)}
              >
                <FileText size={16} />
                <span className="font-medium">{category.name}</span>
              </Link>
              <button
                onClick={() => toggleCategory(category.id)}
                data-testid={`category-${category.id}-toggle`}
                className="px-3 py-2 transition-colors hover:text-primary"
              >
                <motion.div animate={{ rotate: expandedCategories[category.id] ? 180 : 0 }} transition={{ duration: 0.2 }}>
                  <ChevronDown size={14} />
                </motion.div>
              </button>
            </div>

            <AnimatePresence initial={false}>
              {expandedCategories[category.id] && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <div className="ml-5 mt-0.5 space-y-0.5 border-l pl-3 border-[rgba(144,141,206,0.18)]">
                    {category.subcategories.map((sub) => {
                      const to = getSubLink(category, sub);
                      return (
                        <Link
                          key={sub}
                          to={to}
                          data-testid={getTestId(category, sub)}
                          onClick={() => setMobileOpen(false)}
                          className={`block px-3 py-1.5 text-xs rounded-md transition-all ${
                            isActive(to)
                              ? 'text-primary bg-primary/10'
                              : 'text-foreground-muted hover:text-foreground hover:bg-[rgba(144,141,206,0.10)]'
                          }`}
                        >
                          {sub}
                        </Link>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}

        {user?.role === 'admin' && (
          <>
            <div className="pt-4 pb-1">
              <p className="px-4 mb-2 text-[10px] font-semibold tracking-widest text-accent">ADMIN</p>
            </div>
            <NavItem to="/admin/users" icon={Users} label="Manage Users" testId="admin-users-nav-link" />
            <NavItem to="/admin/birthdays" icon={Cake} label="Birthdays" testId="admin-birthdays-nav-link" accent={isActive('/admin/birthdays') ? birthdayAccent : ''} />
          </>
        )}

        {user?.role === 'hr' && (
          <>
            <div className="pt-4 pb-1">
              <p className="px-4 mb-2 text-[10px] font-semibold tracking-widest text-accent">HR TOOLS</p>
            </div>
            <NavItem to="/admin/birthdays" icon={Cake} label="Birthdays" testId="hr-birthdays-nav-link" accent={isActive('/admin/birthdays') ? birthdayAccent : ''} />
          </>
        )}

        <div className="pt-4 pb-1">
          <p className="px-4 mb-2 text-[10px] font-semibold tracking-widest text-accent">GRIEVANCE</p>
        </div>
        <NavItem
          to="/grievances/submit"
          icon={MessageSquareWarning}
          label="Submit Grievance"
          testId="submit-grievance-nav-link"
          accent={isActive('/grievances/submit') ? grievanceAccent : ''}
        />
        {(user?.role === 'admin' || user?.role === 'hr') && (
          <NavItem to="/grievances/manage" icon={ClipboardList} label="Manage Grievances" testId="manage-grievances-nav-link" />
        )}
      </nav>

      {/* Footer */}
      <div className="p-3 space-y-1">
        <div className="mb-2 h-px bg-gradient-to-r from-transparent via-[rgba(144,141,206,0.25)] to-transparent" />
        <ExternalNavItem href={HRMS_PROFILE_DASHBOARD_PATH} icon={UserRound} label="Back to Profile" testId="back-to-profile-footer-link" />
        <div className="px-4 py-2">
          <p className="truncate text-xs text-foreground">{user?.name}</p>
          <p className="truncate text-[11px] text-foreground-muted">{user?.email}</p>
          <span className={`inline-block mt-1.5 px-2 py-0.5 text-[10px] font-medium rounded-md capitalize ${
            user?.role === 'admin'
              ? 'bg-primary/15 text-primary'
              : user?.role === 'hr'
                ? 'bg-amber-500/10 text-amber-400'
                : 'bg-[rgba(144,141,206,0.15)] text-accent'
          }`}>
            {user?.role === 'hr' ? 'HR' : user?.role}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-xl border bg-background-card text-foreground border-[rgba(144,141,206,0.22)]"
        data-testid="mobile-menu-toggle"
      >
        {mobileOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      <aside className="hidden lg:block w-72 h-screen sticky top-0 overflow-hidden border-r bg-[rgba(8,8,16,0.97)] backdrop-blur-md border-[rgba(144,141,206,0.12)]">
        <SidebarContent />
      </aside>

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="lg:hidden fixed inset-0 z-40 backdrop-blur-sm bg-black/60"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="lg:hidden fixed left-0 top-0 z-50 h-screen w-72 overflow-hidden border-r bg-[#080810] border-[rgba(144,141,206,0.12)]"
            >
              <SidebarContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default Sidebar;
