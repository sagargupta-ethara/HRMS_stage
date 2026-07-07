import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import BirthdaySpotlight from '../components/BirthdaySpotlight';
import NotificationBell from '../components/NotificationBell';
import { useAuth } from '../context/AuthContext';
import { FileText, Clock, ArrowRight, Search, X, BookOpen, CalendarDays, MessageSquareWarning } from 'lucide-react';
import { toast } from 'sonner';

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };

const Dashboard = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [categories, setCategories] = useState([]);
  const [recentPages, setRecentPages] = useState([]);
  const [loading, setLoading] = useState(true);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef(null);
  const debounceRef = useRef(null);

  // Close search on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search
  const doSearch = useCallback(async (q) => {
    if (!q || q.length < 2) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    try {
      const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/search?q=${encodeURIComponent(q)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  }, [token]);

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 300);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSearchFocused(false);
  };

  const handleResultClick = (route) => {
    clearSearch();
    navigate(route);
  };

  const resultIcon = (type) => {
    const icons = { wiki: FileText, document: BookOpen, holiday: CalendarDays, grievance: MessageSquareWarning };
    const Icon = icons[type] || FileText;
    return <Icon size={16} />;
  };

  const resultColor = (type) => {
    const colors = { wiki: 'text-foreground', document: 'text-[#908DCE]', holiday: 'text-[#ED00ED]', grievance: 'text-[#C58BD6]' };
    return colors[type] || 'text-primary';
  };

  const resultLabel = (type) => {
    const labels = { wiki: 'Wiki', document: 'Document', holiday: 'Holiday', grievance: 'Grievance' };
    return labels[type] || type;
  };

  const fetchData = useCallback(async () => {
    try {
      const [categoriesRes, pagesRes] = await Promise.all([
        fetch(`${process.env.REACT_APP_BACKEND_URL}/api/wiki/categories`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${process.env.REACT_APP_BACKEND_URL}/api/wiki/pages`, { headers: { 'Authorization': `Bearer ${token}` } })
      ]);
      const categoriesData = await categoriesRes.json();
      const pagesData = await pagesRes.json();
      setCategories(categoriesData.categories || []);
      setRecentPages(pagesData.pages?.slice(0, 5) || []);
    } catch (error) { toast.error('Failed to fetch dashboard data'); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);
  const categoryTones = {
    foundation: 'bg-[rgba(197,203,232,0.14)] text-[#C5CBE8]',
    operations: 'bg-[rgba(144,141,206,0.22)] text-[#A9ADD6]',
    hr: 'bg-[rgba(237,0,237,0.14)] text-[#ED6BED]',
    training: 'bg-[#ED00ED] text-white',
  };

  if (loading) {
    return (
      <div className="dashboard-shell flex">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#ED00ED]"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-shell flex min-h-screen">
      <Sidebar />
      <main className="dashboard-soft-grid flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6 lg:p-10">
          {/* Hero Header */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
            <div className="dashboard-hero relative overflow-hidden rounded-[2rem] p-8 lg:p-10">
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute -top-16 -right-10 h-48 w-48 rounded-full bg-[#ED00ED]/12 blur-3xl" />
                <div className="absolute bottom-0 left-10 h-40 w-40 rounded-full bg-[#908DCE]/18 blur-3xl" />
              </div>
              <div className="relative z-10">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between mb-3">
                  <div>
                    <div className="dashboard-ribbon inline-flex rounded-full px-4 py-1.5 text-[11px] font-bold uppercase shadow-sm">
                      Company Knowledge Base
                    </div>
                    <p className="mt-4 text-sm font-medium tracking-wide text-foreground-muted">
                      {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                    </p>
                  </div>
                  <NotificationBell />
                </div>
                <h1 className="text-3xl lg:text-5xl font-heading font-extrabold text-foreground mb-3" data-testid="dashboard-title">
                  Welcome back, {user?.name?.split(' ')[0]}
                </h1>
                <p className="max-w-3xl text-sm leading-7 text-foreground-muted" data-testid="dashboard-intro">
                  Search the knowledge base, browse policies and process docs, and stay on top of company updates — all in one place.
                </p>

                {/* Search Bar */}
                <div className="relative mt-6 max-w-2xl" ref={searchRef}>
                  <div className={`dashboard-search-shell flex items-center rounded-2xl px-4 py-3 transition-all ${
                    searchFocused ? 'is-focused' : ''
                  }`}>
                    <Search size={18} className={`shrink-0 transition-colors ${searchFocused ? 'text-[#ED00ED]' : 'text-foreground-muted'}`} />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={handleSearchChange}
                      onFocus={() => setSearchFocused(true)}
                      placeholder="Search wiki, documents, holidays, grievances..."
                      data-testid="dashboard-search-input"
                      className="dashboard-search-input ml-3 flex-1 bg-transparent text-sm text-foreground outline-none"
                    />
                    {searchQuery && (
                      <button onClick={clearSearch} className="text-foreground-muted hover:text-foreground transition-colors" data-testid="search-clear-button">
                        <X size={16} />
                      </button>
                    )}
                    {searching && <div className="ml-2 h-4 w-4 shrink-0 animate-spin rounded-full border-t-2 border-[#ED00ED]" />}
                  </div>

                  {/* Results dropdown */}
                  <AnimatePresence>
                    {searchFocused && searchQuery.length >= 2 && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute top-full left-0 right-0 z-50 mt-3 overflow-hidden rounded-2xl border border-[rgba(144,141,206,0.25)] bg-[#111120]/95 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.6)] backdrop-blur-xl"
                        data-testid="search-results-dropdown"
                      >
                        {searchResults.length === 0 && !searching ? (
                          <div className="px-4 py-6 text-center">
                            <p className="text-sm text-foreground-muted">No results for "{searchQuery}"</p>
                          </div>
                        ) : (
                          <div className="max-h-80 overflow-y-auto py-1">
                            {searchResults.map((r, i) => (
                              <button
                                key={`${r.type}-${i}`}
                                onClick={() => handleResultClick(r.route)}
                                data-testid={`search-result-${i}`}
                                className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[rgba(144,141,206,0.12)]"
                              >
                                <div className={`mt-0.5 shrink-0 ${resultColor(r.type)}`}>
                                  {resultIcon(r.type)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <p className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-[#ED00ED]">{r.title}</p>
                                    <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-md ${
                                      r.type === 'wiki' ? 'bg-[rgba(144,141,206,0.18)] text-foreground' :
                                      r.type === 'document' ? 'bg-[#908DCE]/18 text-accent' :
                                      r.type === 'holiday' ? 'bg-[#ED00ED]/10 text-primary' :
                                      'bg-[rgba(144,141,206,0.16)] text-[#A9ADD6]'
                                    }`}>{resultLabel(r.type)}</span>
                                  </div>
                                  <p className="truncate text-xs text-foreground-muted">{r.subtitle}</p>
                                  {r.snippet && <p className="mt-0.5 truncate text-xs text-foreground-muted">{r.snippet}</p>}
                                </div>
                                <ArrowRight size={14} className="mt-1 shrink-0 text-[#908DCE] transition-all group-hover:translate-x-0.5 group-hover:text-[#ED00ED]" />
                              </button>
                            ))}
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Birthday Spotlight */}
          <BirthdaySpotlight />

          {/* Two-Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
            {/* Categories - 3 cols */}
            <motion.div variants={container} initial="hidden" animate="show" className="lg:col-span-3">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-heading font-bold uppercase tracking-[0.12em] text-foreground">Categories</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {categories.map((category) => (
                  <motion.div
                    key={category.id}
                    variants={item}
                    whileHover={{ y: -3 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => navigate(`/wiki/${category.id}`)}
                    data-testid={`category-card-${category.id}`}
                    className="dashboard-panel dashboard-panel-hover cursor-pointer rounded-[1.5rem] p-5 group"
                  >
                    <div className="mb-3 flex items-center gap-3">
                      <div className={`rounded-2xl p-3 shadow-sm transition-transform group-hover:scale-105 ${categoryTones[category.id] || 'bg-[rgba(197,203,232,0.14)] text-[#C5CBE8]'}`}>
                        <FileText size={18} />
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.2em] text-[#908DCE]">Section</p>
                        <h3 className="text-sm font-bold text-foreground transition-colors group-hover:text-[#ED00ED]">{category.name}</h3>
                      </div>
                    </div>
                    <p className="mb-4 text-sm leading-6 text-foreground-muted">
                      Jump into {category.name.toLowerCase()} resources, references, and updates curated for quick browsing.
                    </p>
                    <div className="flex items-center text-xs font-semibold uppercase tracking-[0.14em] text-[#ED00ED] transition-colors">
                      <span>Explore</span>
                      <ArrowRight size={12} className="ml-1 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* Recent Updates - 2 cols */}
            <motion.div variants={container} initial="hidden" animate="show" className="lg:col-span-2">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-heading font-bold uppercase tracking-[0.12em] text-foreground">Recent Updates</h2>
              </div>

              {recentPages.length === 0 ? (
                <div className="dashboard-panel rounded-[1.5rem] p-8 text-center" data-testid="no-pages-message">
                  <FileText className="mx-auto mb-3 text-[#908DCE]" size={40} />
                  <p className="text-sm text-foreground-muted">No pages yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {recentPages.map((page) => (
                    <motion.div
                      key={page.slug}
                      variants={item}
                      whileHover={{ x: 4 }}
                      onClick={() => navigate(`/wiki/page/${page.slug}`)}
                      data-testid={`recent-page-${page.slug}`}
                      className="dashboard-panel dashboard-panel-hover cursor-pointer rounded-[1.35rem] p-4 group"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 rounded-xl bg-[rgba(144,141,206,0.18)] p-2 text-foreground transition-colors group-hover:bg-[#ED00ED] group-hover:text-white">
                          <FileText size={14} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="truncate text-sm font-bold text-foreground transition-colors group-hover:text-[#ED00ED]">{page.title}</h3>
                          <div className="mt-1 flex items-center gap-2 text-xs text-foreground-muted">
                            <Clock size={10} />
                            <span>{new Date(page.updated_at).toLocaleDateString()}</span>
                            <span className="h-1 w-1 rounded-full bg-[#908DCE]" />
                            <span className="capitalize">{page.category}</span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
