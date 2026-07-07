import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { 
  BarChart3, Eye, Users, Search, RefreshCw, 
  Clock, TrendingUp, Activity, ChevronRight, FileText, Zap,
  X, Timer, User, ShieldAlert, ArrowUpDown, ArrowUp, ArrowDown,
  Filter, Download, Calendar, SearchIcon
} from 'lucide-react';

const API = process.env.REACT_APP_BACKEND_URL;
const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

const fmtDuration = (secs) => {
  if (!secs || secs < 1) return '0s';
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
};

const timeAgo = (ts) => {
  if (!ts) return '';
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const eventLabel = (type) => ({ page_view: 'Viewed', login: 'Logged in', search: 'Searched', page_duration: 'Spent time on' }[type] || type);
const eventIcon = (type) => ({ page_view: Eye, login: Users, search: Search, page_duration: Timer }[type] || Activity);

const StatCard = ({ icon: Icon, label, total, today, accent, testId, onClick }) => (
  <motion.div 
    variants={item} 
    whileHover={onClick ? { y: -3 } : undefined}
    onClick={onClick}
    className={`glass-card stat-card rounded-xl p-5 group ${onClick ? 'cursor-pointer' : ''}`}
    data-testid={testId}
  >
    <div className="flex items-center justify-between mb-3">
      <div className={`p-2.5 rounded-lg ${accent} group-hover:scale-110 transition-transform`}>
        <Icon size={18} className="text-white" />
      </div>
      <span className="text-2xl font-bold text-foreground font-heading">{total}</span>
    </div>
    <p className="text-sm font-medium text-foreground">{label}</p>
    <div className="flex items-center justify-between mt-1">
      <p className="text-xs text-foreground-muted">{today > 0 ? `+${today} today` : 'No activity today'}</p>
      {onClick && <span className="text-[10px] text-primary opacity-0 group-hover:opacity-100 transition-opacity">Click for details</span>}
    </div>
  </motion.div>
);

const DetailModal = ({ isOpen, onClose, title, icon: Icon, children }) => (
  <AnimatePresence>
    {isOpen && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={e => e.stopPropagation()}
          className="glass-card rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl"
          data-testid="detail-modal"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
            <div className="flex items-center gap-3">
              {Icon && <Icon size={18} className="text-primary" />}
              <h2 className="text-base font-heading font-semibold text-foreground">{title}</h2>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[rgba(144,141,206,0.10)] transition-colors" data-testid="close-modal-btn">
              <X size={18} className="text-foreground-muted" />
            </button>
          </div>
          <div className="overflow-y-auto max-h-[calc(80vh-64px)] p-6">
            {children}
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);

const AnalyticsDashboard = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [topPages, setTopPages] = useState([]);
  const [userActivity, setUserActivity] = useState([]);
  const [hourlyData, setHourlyData] = useState([]);
  const [searchQueries, setSearchQueries] = useState([]);
  const [recentEvents, setRecentEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [activeModal, setActiveModal] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // User Activity filters & sort
  const [uaSearch, setUaSearch] = useState('');
  const [uaVisibleCols, setUaVisibleCols] = useState({ page_views: true, searches: true, logins: true, last_active: true });
  const [uaSortKey, setUaSortKey] = useState(null);
  const [uaSortDir, setUaSortDir] = useState('desc');
  const [uaDateFrom, setUaDateFrom] = useState('');
  const [uaDateTo, setUaDateTo] = useState('');
  const [uaShowFilters, setUaShowFilters] = useState(false);

  const isAdmin = user?.role === 'admin';

  const fetchAll = useCallback(async (showRefresh = false) => {
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    if (showRefresh) setRefreshing(true);
    try {
      const [ov, pv, ua, hr, sq, re] = await Promise.all([
        fetch(`${API}/api/analytics/overview`, { headers }).then(r => r.json()),
        fetch(`${API}/api/analytics/page-views`, { headers }).then(r => r.json()),
        fetch(`${API}/api/analytics/user-activity`, { headers }).then(r => r.json()),
        fetch(`${API}/api/analytics/hourly`, { headers }).then(r => r.json()),
        fetch(`${API}/api/analytics/search-queries`, { headers }).then(r => r.json()),
        fetch(`${API}/api/analytics/recent`, { headers }).then(r => r.json()),
      ]);
      setOverview(ov);
      setTopPages(pv.pages || []);
      setUserActivity(ua.users || []);
      setHourlyData(hr.hours || []);
      setSearchQueries(sq.queries || []);
      setRecentEvents(re.events || []);
      setLastUpdated(new Date());
    } catch (e) { console.error('fetch failed:', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { if (isAdmin) fetchAll(); else setLoading(false); }, [fetchAll, isAdmin]);

  useEffect(() => {
    if (!autoRefresh || !isAdmin) return;
    const interval = setInterval(() => fetchAll(), 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchAll, isAdmin]);

  const openStatDetail = async (eventType) => {
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    setActiveModal(eventType);
    setDetailLoading(true);
    try {
      const res = await fetch(`${API}/api/analytics/detail/${eventType}`, { headers });
      const data = await res.json();
      setDetailData(data);
    } catch (e) { console.error('fetch failed:', e); }
    finally { setDetailLoading(false); }
  };

  const openUserDetail = async (email) => {
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    setActiveModal('user_detail');
    setDetailLoading(true);
    try {
      const res = await fetch(`${API}/api/analytics/user-detail/${encodeURIComponent(email)}`, { headers });
      const data = await res.json();
      setDetailData(data);
    } catch (e) { console.error('fetch failed:', e); }
    finally { setDetailLoading(false); }
  };

  const closeModal = () => { setActiveModal(null); setDetailData(null); };

  // Filtered & sorted user activity (pure derivation, no mutation)
  const getFilteredUserActivity = () => {
    let data = [...userActivity];
    // Search filter
    if (uaSearch.trim()) {
      const q = uaSearch.toLowerCase();
      data = data.filter(u => u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q));
    }
    // Date range filter
    if (uaDateFrom) {
      const from = new Date(uaDateFrom).getTime();
      data = data.filter(u => u.last_active && new Date(u.last_active).getTime() >= from);
    }
    if (uaDateTo) {
      const to = new Date(uaDateTo).getTime() + 86400000; // end of day
      data = data.filter(u => u.last_active && new Date(u.last_active).getTime() <= to);
    }
    // Sort
    if (uaSortKey) {
      data.sort((a, b) => {
        let va, vb;
        if (uaSortKey === 'last_active') {
          va = a.last_active ? new Date(a.last_active).getTime() : 0;
          vb = b.last_active ? new Date(b.last_active).getTime() : 0;
        } else {
          va = a[uaSortKey] || 0;
          vb = b[uaSortKey] || 0;
        }
        return uaSortDir === 'asc' ? va - vb : vb - va;
      });
    }
    return data;
  };

  const maxHourly = Math.max(...(hourlyData.length ? hourlyData.map(h => h.page_view + h.login + h.search) : [1]), 1);

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 ml-0 lg:ml-64 p-8 flex items-center justify-center">
          <div className="text-center" data-testid="access-denied">
            <ShieldAlert size={48} className="mx-auto mb-4 text-red-400" />
            <h2 className="text-xl font-heading font-bold text-foreground mb-2">Admin Access Required</h2>
            <p className="text-sm text-foreground-muted mb-4">The analytics dashboard is restricted to administrators.</p>
            <button onClick={() => navigate('/dashboard')} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary-hover transition-colors">
              Back to Dashboard
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 ml-0 lg:ml-64 p-8 flex items-center justify-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent" />
        </main>
      </div>
    );
  }

  const ov = overview || { page_views: {}, logins: {}, searches: {}, users: {} };
  const modalTitle = { page_view: 'Page Views Detail', login: 'Login Activity', search: 'Search Queries Detail', user_detail: 'User Activity Detail' };
  const modalIcon = { page_view: Eye, login: Users, search: Search, user_detail: User };

  return (
    <div className="flex min-h-screen bg-background" data-testid="analytics-dashboard">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6 lg:p-10">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-foreground-muted mb-5">
            <Link to="/dashboard" className="hover:text-primary transition-colors">Home</Link>
            <ChevronRight size={14} />
            <span className="text-foreground">Analytics</span>
          </div>

          {/* Hero Header — matches Dashboard.js Digital Nexus style */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <div className="relative rounded-2xl bg-gradient-to-br from-background-card via-background-card to-primary/10 border border-border/40 p-8 lg:p-10 overflow-hidden">
              <div className="absolute top-0 right-0 w-72 h-72 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
              <div className="relative z-10 flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20">
                      <BarChart3 size={22} className="text-primary" />
                    </div>
                    <h1 className="text-2xl lg:text-3xl font-heading font-bold text-foreground" data-testid="analytics-title">Wiki Analytics</h1>
                  </div>
                  <p className="text-sm text-foreground-muted leading-relaxed max-w-xl">
                    Live usage tracking across the wiki — page views, user engagement, and search patterns.
                    {lastUpdated && <span className="ml-2 text-foreground-muted">Updated {timeAgo(lastUpdated.toISOString())}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => setAutoRefresh(!autoRefresh)} data-testid="auto-refresh-toggle"
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-all ${autoRefresh ? 'bg-primary/15 border-primary/30 text-primary shadow-[0_0_12px_rgba(237,0,237,0.15)]' : 'bg-secondary border-border text-foreground-muted'}`}>
                    <Zap size={12} />{autoRefresh ? 'Live' : 'Paused'}
                  </button>
                  <button onClick={() => fetchAll(true)} disabled={refreshing} data-testid="refresh-button"
                    className="p-2 rounded-lg bg-secondary border border-border text-foreground-muted hover:text-primary hover:border-primary/30 transition-all">
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Stats Cards */}
          <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard icon={Eye} label="Page Views" total={ov.page_views.total || 0} today={ov.page_views.today || 0} accent="bg-[#ED00ED]/80" testId="stat-page-views" onClick={() => openStatDetail('page_view')} />
            <StatCard icon={Users} label="Logins" total={ov.logins.total || 0} today={ov.logins.today || 0} accent="bg-[#38BDF8]/80" testId="stat-logins" onClick={() => openStatDetail('login')} />
            <StatCard icon={Search} label="Searches" total={ov.searches.total || 0} today={ov.searches.today || 0} accent="bg-amber-600/80" testId="stat-searches" onClick={() => openStatDetail('search')} />
            <StatCard icon={Users} label="Active Users" total={ov.users.active_today || 0} today={0} accent="bg-emerald-600/80" testId="stat-active-users" />
          </motion.div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column */}
            <div className="lg:col-span-2 space-y-6">
              {/* Top Pages */}
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-xl p-6" data-testid="top-pages-section">
                <div className="flex items-center gap-2 mb-4">
                  <FileText size={16} className="text-primary" />
                  <h2 className="text-sm font-heading font-semibold text-foreground">Most Viewed Pages</h2>
                  <button onClick={() => openStatDetail('page_view')} className="ml-auto text-[10px] text-primary hover:underline">See all</button>
                </div>
                {topPages.length === 0 ? (
                  <p className="text-xs text-foreground-muted py-6 text-center">No page views recorded yet. Browse wiki pages to generate data.</p>
                ) : (
                  <div className="space-y-1">
                    {topPages.slice(0, 8).map((p, i) => (
                      <div key={p.slug} onClick={() => openStatDetail('page_view')} className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-primary/5 transition-colors cursor-pointer group" data-testid={`page-row-${i}`}>
                        <span className="text-xs font-bold text-foreground-muted w-5">{i + 1}</span>
                        <div className="flex-1 min-w-0"><p className="text-sm text-foreground truncate group-hover:text-primary transition-colors">{p.title}</p></div>
                        <div className="flex items-center gap-1.5">
                          <Eye size={12} className="text-foreground-muted" />
                          <span className="text-sm font-semibold text-primary">{p.views}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>

              {/* Hourly Heatmap */}
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.1 } }} className="glass-card rounded-xl p-6" data-testid="hourly-section">
                <div className="flex items-center gap-2 mb-4">
                  <Clock size={16} className="text-primary" />
                  <h2 className="text-sm font-heading font-semibold text-foreground">Activity by Hour (Last 7 Days)</h2>
                </div>
                <div className="flex items-end gap-[3px] h-28">
                  {hourlyData.map((h) => {
                    const total = h.page_view + h.login + h.search;
                    const pct = (total / maxHourly) * 100;
                    return (
                      <div key={h.hour} className="flex-1 flex flex-col items-center gap-1 group relative">
                        <div className="absolute -top-8 glass text-xs text-foreground px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                          {h.hour}:00 — {total} events
                        </div>
                        <div className="w-full rounded-sm transition-colors" style={{ height: `${Math.max(pct, 3)}%`, backgroundColor: total === 0 ? 'rgb(33,32,58)' : `rgba(237,0,237,${0.3 + (pct / 100) * 0.7})` }} />
                        {h.hour % 6 === 0 && <span className="text-[10px] text-foreground-muted">{h.hour}</span>}
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-center gap-4 mt-3 text-[10px] text-foreground-muted">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-primary/30" /> Low</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-primary/60" /> Medium</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-primary" /> High</span>
                </div>
              </motion.div>

              {/* User Activity Table */}
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.2 } }} className="glass-card rounded-xl p-6" data-testid="user-activity-section">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Users size={16} className="text-primary" />
                    <h2 className="text-sm font-heading font-semibold text-foreground">User Activity</h2>
                    <span className="text-[10px] text-foreground-muted ml-1">Click a user for details</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setUaShowFilters(f => !f)} data-testid="ua-toggle-filters"
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-lg border transition-all ${uaShowFilters ? 'bg-primary/15 border-primary/30 text-primary' : 'bg-secondary border-border text-foreground-muted hover:text-foreground'}`}>
                      <Filter size={12} /> Filters
                    </button>
                    <button onClick={() => {
                      const cols = ['User', 'Email', 'Role',
                        ...(uaVisibleCols.page_views ? ['Views'] : []),
                        ...(uaVisibleCols.searches ? ['Searches'] : []),
                        ...(uaVisibleCols.logins ? ['Logins'] : []),
                        ...(uaVisibleCols.last_active ? ['Last Active'] : [])
                      ];
                      const filteredData = getFilteredUserActivity();
                      const rows = filteredData.map(u => [
                        u.name, u.email, u.role,
                        ...(uaVisibleCols.page_views ? [u.page_views] : []),
                        ...(uaVisibleCols.searches ? [u.searches] : []),
                        ...(uaVisibleCols.logins ? [u.logins] : []),
                        ...(uaVisibleCols.last_active ? [u.last_active ? new Date(u.last_active).toLocaleString() : ''] : [])
                      ]);
                      const csv = [cols.join(','), ...rows.map(r => r.join(','))].join('\n');
                      const blob = new Blob([csv], { type: 'text/csv' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a'); a.href = url; a.download = 'user_activity.csv'; a.click();
                      URL.revokeObjectURL(url);
                    }} data-testid="ua-export-csv"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-lg bg-secondary border border-border text-foreground-muted hover:text-primary hover:border-primary/30 transition-all">
                      <Download size={12} /> CSV
                    </button>
                  </div>
                </div>

                {/* Filter Controls */}
                <AnimatePresence>
                  {uaShowFilters && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                      <div className="mb-4 p-4 rounded-lg bg-secondary/40 border border-border/60 space-y-3" data-testid="ua-filter-panel">
                        {/* Search */}
                        <div className="relative">
                          <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted" />
                          <input
                            type="text" value={uaSearch} onChange={e => setUaSearch(e.target.value)} placeholder="Search by name or email..."
                            data-testid="ua-search-input"
                            className="w-full pl-9 pr-4 py-2 bg-secondary border border-border rounded-lg text-xs text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </div>
                        {/* Column toggles */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] text-foreground-muted font-medium uppercase tracking-wider">Columns:</span>
                          {[
                            { key: 'page_views', label: 'Views', icon: Eye },
                            { key: 'searches', label: 'Searches', icon: Search },
                            { key: 'logins', label: 'Logins', icon: Users },
                            { key: 'last_active', label: 'Last Active', icon: Clock }
                          ].map(col => (
                            <button key={col.key}
                              onClick={() => setUaVisibleCols(prev => ({ ...prev, [col.key]: !prev[col.key] }))}
                              data-testid={`ua-col-toggle-${col.key}`}
                              className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded-md border transition-all ${uaVisibleCols[col.key] ? 'bg-primary/15 border-primary/30 text-primary' : 'bg-secondary border-border text-foreground-muted'}`}>
                              <col.icon size={11} /> {col.label}
                            </button>
                          ))}
                        </div>
                        {/* Date range for Last Active */}
                        {uaVisibleCols.last_active && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] text-foreground-muted font-medium uppercase tracking-wider">Active between:</span>
                            <div className="flex items-center gap-2">
                              <Calendar size={12} className="text-foreground-muted" />
                              <input type="date" value={uaDateFrom} onChange={e => setUaDateFrom(e.target.value)} data-testid="ua-date-from"
                                className="px-2 py-1.5 bg-secondary border border-border rounded text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40" />
                              <span className="text-[10px] text-foreground-muted">to</span>
                              <input type="date" value={uaDateTo} onChange={e => setUaDateTo(e.target.value)} data-testid="ua-date-to"
                                className="px-2 py-1.5 bg-secondary border border-border rounded text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40" />
                              {(uaDateFrom || uaDateTo) && (
                                <button onClick={() => { setUaDateFrom(''); setUaDateTo(''); }} className="text-[10px] text-red-400 hover:text-red-300">Clear</button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {(() => {
                  const filtered = getFilteredUserActivity();
                  const SortIcon = ({ col }) => {
                    if (uaSortKey !== col) return <ArrowUpDown size={11} className="text-foreground-muted" />;
                    return uaSortDir === 'asc' ? <ArrowUp size={11} className="text-primary" /> : <ArrowDown size={11} className="text-primary" />;
                  };
                  const toggleSort = (col) => {
                    if (uaSortKey === col) setUaSortDir(d => d === 'asc' ? 'desc' : 'asc');
                    else { setUaSortKey(col); setUaSortDir('desc'); }
                  };

                  if (userActivity.length === 0) return <p className="text-xs text-foreground-muted py-6 text-center">No user activity recorded yet.</p>;
                  if (filtered.length === 0) return (
                    <div className="py-8 text-center" data-testid="ua-no-data">
                      <Search size={28} className="mx-auto mb-2 text-foreground-muted" />
                      <p className="text-xs text-foreground-muted">No users match the current filters.</p>
                      <button onClick={() => { setUaSearch(''); setUaDateFrom(''); setUaDateTo(''); setUaVisibleCols({ page_views: true, searches: true, logins: true, last_active: true }); }}
                        className="mt-2 text-[11px] text-primary hover:underline">Reset filters</button>
                    </div>
                  );

                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-foreground-muted border-b border-border/60">
                            <th className="text-left py-2 pr-4">User</th>
                            {uaVisibleCols.page_views && (
                              <th className="text-center py-2 px-2 cursor-pointer select-none hover:text-primary transition-colors" onClick={() => toggleSort('page_views')} data-testid="ua-sort-views">
                                <span className="inline-flex items-center gap-1">Views <SortIcon col="page_views" /></span>
                              </th>
                            )}
                            {uaVisibleCols.searches && (
                              <th className="text-center py-2 px-2 cursor-pointer select-none hover:text-primary transition-colors" onClick={() => toggleSort('searches')} data-testid="ua-sort-searches">
                                <span className="inline-flex items-center gap-1">Searches <SortIcon col="searches" /></span>
                              </th>
                            )}
                            {uaVisibleCols.logins && (
                              <th className="text-center py-2 px-2 cursor-pointer select-none hover:text-primary transition-colors" onClick={() => toggleSort('logins')} data-testid="ua-sort-logins">
                                <span className="inline-flex items-center gap-1">Logins <SortIcon col="logins" /></span>
                              </th>
                            )}
                            {uaVisibleCols.last_active && (
                              <th className="text-right py-2 pl-2 cursor-pointer select-none hover:text-primary transition-colors" onClick={() => toggleSort('last_active')} data-testid="ua-sort-last-active">
                                <span className="inline-flex items-center gap-1">Last Active <SortIcon col="last_active" /></span>
                              </th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((u) => (
                            <tr key={u.email} onClick={() => openUserDetail(u.email)} className="border-b border-border/30 hover:bg-primary/5 cursor-pointer group transition-colors" data-testid={`user-row-${u.email}`}>
                              <td className="py-2.5 pr-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">{u.name?.charAt(0)?.toUpperCase() || '?'}</div>
                                  <div>
                                    <p className="text-foreground text-xs font-medium group-hover:text-primary transition-colors">{u.name}</p>
                                    <p className="text-foreground-muted text-[10px]">{u.email}</p>
                                  </div>
                                </div>
                              </td>
                              {uaVisibleCols.page_views && <td className="text-center py-2.5 text-xs text-foreground">{u.page_views}</td>}
                              {uaVisibleCols.searches && <td className="text-center py-2.5 text-xs text-foreground">{u.searches}</td>}
                              {uaVisibleCols.logins && <td className="text-center py-2.5 text-xs text-foreground">{u.logins}</td>}
                              {uaVisibleCols.last_active && <td className="text-right py-2.5 text-[10px] text-foreground-muted">{timeAgo(u.last_active)}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-[10px] text-foreground-muted mt-2 text-right">{filtered.length} of {userActivity.length} users</p>
                    </div>
                  );
                })()}
              </motion.div>
            </div>

            {/* Right Column */}
            <div className="space-y-6">
              {/* Live Feed */}
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.05 } }} className="glass-card rounded-xl p-6" data-testid="activity-feed-section">
                <div className="flex items-center gap-2 mb-4">
                  <Activity size={16} className="text-primary" />
                  <h2 className="text-sm font-heading font-semibold text-foreground">Live Activity</h2>
                  {autoRefresh && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
                </div>
                {recentEvents.length === 0 ? (
                  <p className="text-xs text-foreground-muted py-6 text-center">No activity yet.</p>
                ) : (
                  <div className="space-y-1 max-h-80 overflow-y-auto scrollbar-hide">
                    {recentEvents.slice(0, 15).map((ev, i) => {
                      const Ic = eventIcon(ev.event_type);
                      return (
                        <div key={`${ev.user_email}-${ev.timestamp}-${i}`} className="flex items-start gap-2.5 py-2 px-2 rounded-lg hover:bg-primary/5 transition-colors cursor-pointer" onClick={() => openUserDetail(ev.user_email)}>
                          <div className="p-1 rounded bg-secondary mt-0.5 shrink-0"><Ic size={11} className="text-primary" /></div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-foreground">
                              <span className="font-medium text-foreground">{ev.user_name}</span>
                              <span className="text-foreground-muted ml-1">({ev.user_email})</span>
                              {' '}{eventLabel(ev.event_type)}
                              {ev.metadata?.page_title && <span className="text-primary"> {ev.metadata.page_title}</span>}
                              {ev.metadata?.query && <span className="text-amber-400"> "{ev.metadata.query}"</span>}
                              {ev.metadata?.duration_seconds && <span className="text-primary"> ({fmtDuration(ev.metadata.duration_seconds)})</span>}
                            </p>
                            <p className="text-[10px] text-foreground-muted mt-0.5">{timeAgo(ev.timestamp)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.div>

              {/* Top Searches */}
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.15 } }} className="glass-card rounded-xl p-6" data-testid="search-queries-section">
                <div className="flex items-center gap-2 mb-4">
                  <Search size={16} className="text-primary" />
                  <h2 className="text-sm font-heading font-semibold text-foreground">Top Searches</h2>
                  <button onClick={() => openStatDetail('search')} className="ml-auto text-[10px] text-primary hover:underline">Details</button>
                </div>
                {searchQueries.length === 0 ? (
                  <p className="text-xs text-foreground-muted py-4 text-center">No searches recorded yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {searchQueries.slice(0, 8).map((q, i) => (
                      <div key={`${q.query}-${i}`} onClick={() => openStatDetail('search')} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-primary/5 transition-colors cursor-pointer">
                        <span className="text-xs text-foreground truncate flex-1">"{q.query}"</span>
                        <span className="text-xs font-medium text-primary ml-2">{q.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>

              {/* Quick Stats */}
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.3 } }} className="glass-card rounded-xl p-6" data-testid="quick-stats-section">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp size={16} className="text-primary" />
                  <h2 className="text-sm font-heading font-semibold text-foreground">Quick Stats</h2>
                </div>
                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between"><span className="text-foreground-muted">Total Users</span><span className="text-foreground font-medium">{ov.users.total || 0}</span></div>
                  <div className="flex justify-between"><span className="text-foreground-muted">Active Today</span><span className="text-foreground font-medium">{ov.users.active_today || 0}</span></div>
                  <div className="flex justify-between"><span className="text-foreground-muted">Views This Week</span><span className="text-foreground font-medium">{ov.page_views.week || 0}</span></div>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </main>

      {/* Detail Modals */}
      <DetailModal
        isOpen={!!activeModal && activeModal !== 'user_detail'}
        onClose={closeModal}
        title={modalTitle[activeModal] || ''}
        icon={modalIcon[activeModal]}
      >
        {detailLoading ? (
          <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
        ) : detailData ? (
          <div className="space-y-6">
            {activeModal === 'page_view' && detailData.time_spent?.length > 0 && (
              <div>
                <h3 className="text-xs font-heading font-semibold text-foreground-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Timer size={12} /> Time Spent Per Page
                </h3>
                <div className="space-y-2">
                  {detailData.time_spent.map((t, i) => (
                    <div key={`${t.slug || t.title}-${i}`} className="flex items-center justify-between py-2 px-3 rounded-lg bg-secondary/50 hover:bg-[rgba(144,141,206,0.10)] transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground truncate">{t.title}</p>
                        <p className="text-[10px] text-foreground-muted">{t.sessions} session{t.sessions !== 1 ? 's' : ''}</p>
                      </div>
                      <div className="text-right shrink-0 ml-4">
                        <p className="text-sm font-semibold text-primary">{fmtDuration(t.total_seconds)}</p>
                        <p className="text-[10px] text-foreground-muted">avg {fmtDuration(t.avg_seconds)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <h3 className="text-xs font-heading font-semibold text-foreground-muted uppercase tracking-wider mb-3">
                Activity Log ({detailData.events?.length || 0} events)
              </h3>
              <div className="space-y-1 max-h-72 overflow-y-auto scrollbar-hide">
                {detailData.events?.slice(0, 50).map((ev, i) => {
                  const Ic = eventIcon(ev.event_type);
                  return (
                    <div key={i} className="flex items-start gap-2.5 py-2 px-3 rounded-lg hover:bg-[rgba(144,141,206,0.10)] transition-colors">
                      <div className="p-1 rounded bg-secondary mt-0.5 shrink-0"><Ic size={11} className="text-primary" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground">
                          <span className="font-semibold text-foreground">{ev.user_name}</span>
                          <span className="text-foreground-muted ml-1">({ev.user_role})</span>
                          {ev.metadata?.page_title && <span className="text-primary ml-1">— {ev.metadata.page_title}</span>}
                          {ev.metadata?.query && <span className="text-amber-400 ml-1">— "{ev.metadata.query}"</span>}
                        </p>
                        <p className="text-[10px] text-foreground-muted mt-0.5">{timeAgo(ev.timestamp)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </DetailModal>

      <DetailModal
        isOpen={activeModal === 'user_detail'}
        onClose={closeModal}
        title="User Activity Detail"
        icon={User}
      >
        {detailLoading ? (
          <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
        ) : detailData?.user ? (
          <div className="space-y-6">
            <div className="flex items-center gap-4 pb-4 border-b border-border/60">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-lg font-bold text-primary">
                {detailData.user.name?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div>
                <h3 className="text-base font-heading font-semibold text-foreground">{detailData.user.name}</h3>
                <p className="text-xs text-foreground-muted">{detailData.user.email} &middot; {detailData.user.role}</p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-lg font-bold text-primary">{fmtDuration(detailData.total_time_seconds)}</p>
                <p className="text-[10px] text-foreground-muted">Total time on wiki</p>
              </div>
            </div>
            {detailData.page_times?.length > 0 && (
              <div>
                <h3 className="text-xs font-heading font-semibold text-foreground-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Timer size={12} /> Time Spent Per Page
                </h3>
                <div className="space-y-2">
                  {detailData.page_times.map((pt, i) => (
                    <div key={`${pt.slug || pt.title}-${i}`} className="flex items-center justify-between py-2 px-3 rounded-lg bg-secondary/50">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground truncate">{pt.title}</p>
                        <p className="text-[10px] text-foreground-muted">{pt.visits} visit{pt.visits !== 1 ? 's' : ''} &middot; avg {fmtDuration(pt.avg_seconds)}</p>
                      </div>
                      <span className="text-sm font-semibold text-primary shrink-0 ml-4">{fmtDuration(pt.total_seconds)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <h3 className="text-xs font-heading font-semibold text-foreground-muted uppercase tracking-wider mb-3">
                Full Activity Log ({detailData.events?.length || 0})
              </h3>
              <div className="space-y-1 max-h-60 overflow-y-auto scrollbar-hide">
                {detailData.events?.slice(0, 50).map((ev, i) => {
                  const Ic = eventIcon(ev.event_type);
                  return (
                    <div key={i} className="flex items-start gap-2.5 py-1.5 px-2 rounded hover:bg-primary/5 transition-colors">
                      <div className="p-1 rounded bg-secondary mt-0.5 shrink-0"><Ic size={10} className="text-primary" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground">
                          {eventLabel(ev.event_type)}
                          {ev.metadata?.page_title && <span className="text-primary"> {ev.metadata.page_title}</span>}
                          {ev.metadata?.query && <span className="text-amber-400"> "{ev.metadata.query}"</span>}
                          {ev.metadata?.duration_seconds && <span className="text-primary"> ({fmtDuration(ev.metadata.duration_seconds)})</span>}
                        </p>
                        <p className="text-[10px] text-foreground-muted">{timeAgo(ev.timestamp)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </DetailModal>
    </div>
  );
};

export default AnalyticsDashboard;
