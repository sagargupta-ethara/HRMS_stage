import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays, ChevronRight, Flag, Sparkles, Globe, Calendar, Clock,
  TrendingUp, PartyPopper, Filter, ListChecks, LayoutGrid
} from 'lucide-react';
import Sidebar from '../components/Sidebar';

/* ------------------------------- DATA ------------------------------- */

const HOLIDAYS_2026 = [
  // Fixed (Gazetted)
  { date: '2026-01-26', day: 'Monday',    occasion: 'Republic Day',                   type: 'Gazetted', emoji: '🇮🇳' },
  { date: '2026-03-21', day: 'Saturday',  occasion: 'Id-ul-Fitr',                     type: 'Gazetted', emoji: '🌙' },
  { date: '2026-04-03', day: 'Friday',    occasion: 'Good Friday',                    type: 'Gazetted', emoji: '✝️' },
  { date: '2026-05-27', day: 'Wednesday', occasion: 'Id-ul-Zuha (Bakrid)',            type: 'Gazetted', emoji: '🌙' },
  { date: '2026-08-15', day: 'Saturday',  occasion: 'Independence Day',               type: 'Gazetted', emoji: '🇮🇳' },
  { date: '2026-10-02', day: 'Friday',    occasion: "Mahatma Gandhi's Birthday",       type: 'Gazetted', emoji: '🕊️' },
  { date: '2026-10-20', day: 'Tuesday',   occasion: 'Dussehra (Vijay Dashmi)',        type: 'Gazetted', emoji: '🏹' },
  { date: '2026-11-08', day: 'Sunday',    occasion: 'Diwali (Deepavali)',             type: 'Gazetted', emoji: '🪔' },
  { date: '2026-11-24', day: 'Tuesday',   occasion: "Guru Nanak's Birthday",          type: 'Gazetted', emoji: '🙏' },
  { date: '2026-12-25', day: 'Friday',    occasion: 'Christmas Day',                  type: 'Gazetted', emoji: '🎄' },
  // Restricted
  { date: '2026-01-14', day: 'Wednesday', occasion: 'Pongal',                         type: 'Restricted', emoji: '🌾' },
  { date: '2026-01-23', day: 'Friday',    occasion: 'Vasant Panchami',                type: 'Restricted', emoji: '📚' },
  { date: '2026-02-15', day: 'Sunday',    occasion: 'Maha Shivaratri',                type: 'Restricted', emoji: '🕉️' },
  { date: '2026-03-19', day: 'Thursday',  occasion: 'Ugadi / Gudi Padwa',             type: 'Restricted', emoji: '🌿' },
  { date: '2026-03-26', day: 'Thursday',  occasion: 'Ram Navami',                     type: 'Restricted', emoji: '🏹' },
  { date: '2026-03-31', day: 'Tuesday',   occasion: 'Mahavir Jayanti',                type: 'Restricted', emoji: '☸️' },
  { date: '2026-05-01', day: 'Friday',    occasion: 'Buddha Purnima',                 type: 'Restricted', emoji: '☸️' },
  { date: '2026-06-26', day: 'Friday',    occasion: 'Muharram',                       type: 'Restricted', emoji: '🌙' },
  { date: '2026-08-26', day: 'Wednesday', occasion: "Prophet Mohammad's Birthday (Id-e-Milad)", type: 'Restricted', emoji: '🌙' },
  { date: '2026-08-26', day: 'Wednesday', occasion: 'Onam',                           type: 'Restricted', emoji: '🌺' },
  { date: '2026-08-28', day: 'Friday',    occasion: 'Raksha Bandhan',                 type: 'Restricted', emoji: '🪢' },
  { date: '2026-09-04', day: 'Friday',    occasion: 'Janmashtami',                    type: 'Restricted', emoji: '🦚' },
  { date: '2026-09-14', day: 'Monday',    occasion: 'Ganesh Chaturthi',               type: 'Restricted', emoji: '🐘' },
  { date: '2026-10-29', day: 'Thursday',  occasion: 'Karva Chauth',                   type: 'Restricted', emoji: '🌕' },
  { date: '2026-11-09', day: 'Monday',    occasion: 'Govardhan Puja',                 type: 'Restricted', emoji: '⛰️' },
  { date: '2026-11-11', day: 'Wednesday', occasion: 'Bhai Dooj',                      type: 'Restricted', emoji: '🪔' },
  { date: '2026-11-15', day: 'Sunday',    occasion: 'Chhath Puja',                    type: 'Restricted', emoji: '☀️' },
  { date: '2026-12-24', day: 'Thursday',  occasion: 'Christmas Eve',                  type: 'Restricted', emoji: '🌟' },
];

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const TYPE_META = {
  Gazetted:   { label: 'Gazetted',   accent: 'from-primary to-accent', soft: 'bg-primary/10 text-primary border-primary/30',   icon: Flag,      desc: 'Compulsory company holiday — office closed.' },
  Restricted: { label: 'Restricted', accent: 'from-amber-500 to-orange-500',   soft: 'bg-amber-500/10 text-amber-200 border-amber-500/30',     icon: Sparkles,  desc: 'Optional — pick & choose with prior approval.' },
};

/* ------------------------------ HELPERS ----------------------------- */

const parseDate = (s) => new Date(s + 'T00:00:00');
const startOfToday = () => {
  const d = new Date();
  d.setHours(0,0,0,0);
  return d;
};
const fmtFull = (s) => parseDate(s).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtShort = (s) => parseDate(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const monthIdx = (s) => parseDate(s).getMonth();

/* --------------------------- SUB-COMPONENTS ------------------------- */

const CountdownTile = ({ holiday }) => {
  if (!holiday) {
    return (
      <div className="rounded-2xl border border-border bg-background-card p-5 text-center">
        <PartyPopper size={20} className="mx-auto text-accent mb-2" />
        <p className="text-sm text-foreground">All 2026 holidays are behind us 🎉</p>
        <p className="text-[11px] text-foreground-muted mt-1">Calendar will refresh for the new year.</p>
      </div>
    );
  }
  const today = startOfToday();
  const dt = parseDate(holiday.date);
  const days = Math.max(0, Math.round((dt - today) / 86400000));
  const isToday = days === 0;
  const meta = TYPE_META[holiday.type];
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-primary/8 to-accent/15 p-6"
      data-testid="next-holiday-tile"
    >
      <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-primary/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-12 w-48 h-48 rounded-full bg-accent/10 blur-3xl pointer-events-none" />
      <div className="relative flex items-center gap-5">
        <div className="text-6xl select-none" aria-hidden>{holiday.emoji}</div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-primary font-semibold mb-1">
            {isToday ? "Today's holiday" : 'Next holiday'}
          </p>
          <h2 className="text-2xl md:text-3xl font-heading font-bold text-foreground truncate">{holiday.occasion}</h2>
          <p className="text-sm text-foreground-muted mt-1">{fmtFull(holiday.date)}</p>
          <div className="flex items-center gap-2 mt-3">
            <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${meta.soft}`}>{meta.label}</span>
            {isToday ? (
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 animate-pulse">Live today</span>
            ) : (
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30">In {days} {days === 1 ? 'day' : 'days'}</span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

const StatTile = ({ value, label, sub, tone, icon: Ic }) => (
  <div className="rounded-xl bg-background-card border border-border p-4 hover:border-accent/40 transition-colors">
    <Ic size={16} className={`${tone} mb-2`} />
    <p className="text-3xl font-bold text-foreground leading-none">{value}</p>
    <p className="text-[11px] text-foreground-muted mt-1">{sub}</p>
    <p className="text-[10px] uppercase tracking-wider text-foreground-muted font-semibold mt-2">{label}</p>
  </div>
);

const MonthlyDistribution = ({ holidays, selectedMonth, onSelectMonth }) => {
  const counts = useMemo(() => {
    const c = Array(12).fill(0);
    holidays.forEach((h) => { c[monthIdx(h.date)] += 1; });
    return c;
  }, [holidays]);
  const max = Math.max(1, ...counts);
  return (
    <div className="rounded-xl border border-border bg-background-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <CalendarDays size={14} className="text-accent" /> Year at a glance
        </h3>
        <p className="text-[10px] text-foreground-muted uppercase tracking-wider font-semibold">click a month to filter</p>
      </div>
      <div className="grid grid-cols-12 gap-1.5">
        {MONTHS.map((m, i) => {
          const count = counts[i];
          const active = selectedMonth === i;
          const heightPct = (count / max) * 100;
          return (
            <button
              key={m}
              onClick={() => onSelectMonth(active ? null : i)}
              data-testid={`holiday-month-bar-${i + 1}`}
              className={`flex flex-col items-center gap-1 group rounded-md p-1 transition-colors ${active ? 'bg-primary/15' : 'hover:bg-[rgba(144,141,206,0.10)]'}`}
              aria-pressed={active}
            >
              <div className={`w-full h-16 rounded-md flex items-end overflow-hidden border ${active ? 'border-primary/40 bg-primary/10' : 'border-border bg-background'}`}>
                <div
                  className={`w-full rounded-md transition-all ${active ? 'bg-gradient-to-t from-primary to-accent' : 'bg-gradient-to-t from-accent/30 to-accent/60 group-hover:from-primary/70 group-hover:to-primary'}`}
                  style={{ height: `${heightPct}%`, minHeight: count ? 6 : 0 }}
                />
              </div>
              <p className={`text-[10px] font-semibold ${active ? 'text-primary' : 'text-foreground-muted'}`}>{m}</p>
              <p className={`text-[10px] ${active ? 'text-foreground' : 'text-foreground-muted'} font-bold leading-none`}>{count || '·'}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const HolidayCard = ({ h, idx, view }) => {
  const meta = TYPE_META[h.type];
  const dt = parseDate(h.date);
  const day = dt.getDate();
  const isPast = dt < startOfToday();
  const today = startOfToday();
  const daysUntil = Math.round((dt - today) / 86400000);
  const isToday = daysUntil === 0;

  if (view === 'grid') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: idx * 0.02 }}
        whileHover={{ y: -2 }}
        data-testid={`holiday-card-${h.date}-${h.occasion.replace(/\s+/g, '-')}`}
        className={`relative overflow-hidden rounded-xl border ${isToday ? 'border-emerald-500/50 ring-2 ring-emerald-500/20' : 'border-border hover:border-accent/40'} bg-background-card transition-all`}
      >
        <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${meta.accent} opacity-80`} />
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className={`shrink-0 flex flex-col items-center justify-center w-14 h-14 rounded-lg bg-background border border-border ${isPast ? 'opacity-50' : ''}`}>
              <p className="text-[9px] uppercase tracking-wider text-foreground-muted font-semibold leading-none mb-0.5">{MONTH_FULL[dt.getMonth()].slice(0,3)}</p>
              <p className="text-2xl font-bold text-foreground leading-none">{day}</p>
            </div>
            <div className="text-3xl select-none" aria-hidden>{h.emoji}</div>
          </div>
          <div>
            <h4 className={`text-sm font-bold leading-snug ${isPast ? 'text-foreground-muted' : 'text-foreground'}`}>{h.occasion}</h4>
            <p className="text-[11px] text-foreground-muted mt-1">{h.day}</p>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${meta.soft}`}>{meta.label}</span>
            {isToday ? (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">Today</span>
            ) : isPast ? (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary text-foreground-muted border border-border">Past</span>
            ) : (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/25">{daysUntil}d</span>
            )}
          </div>
        </div>
      </motion.div>
    );
  }
  // list view
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: idx * 0.015 }}
      whileHover={{ x: 4 }}
      data-testid={`holiday-row-${h.date}-${h.occasion.replace(/\s+/g, '-')}`}
      className={`group flex items-center gap-4 p-3 rounded-xl border ${isToday ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-border bg-background-card hover:bg-[rgba(144,141,206,0.10)] hover:border-accent/40'} transition-all`}
    >
      <div className={`shrink-0 flex flex-col items-center justify-center w-12 h-12 rounded-lg bg-background border border-border ${isPast ? 'opacity-50' : ''}`}>
        <p className="text-[9px] uppercase tracking-wider text-foreground-muted font-semibold leading-none">{MONTH_FULL[dt.getMonth()].slice(0,3)}</p>
        <p className="text-lg font-bold text-foreground leading-none mt-0.5">{day}</p>
      </div>
      <div className="text-2xl select-none" aria-hidden>{h.emoji}</div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold truncate ${isPast ? 'text-foreground-muted' : 'text-foreground'}`}>{h.occasion}</p>
        <p className="text-[11px] text-foreground-muted">{h.day} · {fmtShort(h.date)}</p>
      </div>
      <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${meta.soft}`}>{meta.label}</span>
      <div className="shrink-0 w-16 text-right">
        {isToday ? (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">Today</span>
        ) : isPast ? (
          <span className="text-[10px] text-foreground-muted">Past</span>
        ) : (
          <span className="text-[10px] font-semibold text-accent">in {daysUntil}d</span>
        )}
      </div>
    </motion.div>
  );
};

/* ---------------------------- MAIN PAGE ---------------------------- */

const HolidayCalendarPage = () => {
  const navigate = useNavigate();
  const [typeFilter, setTypeFilter] = useState('all'); // all | Gazetted | Restricted
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [view, setView] = useState('grid'); // grid | list
  const [showPast, setShowPast] = useState(true);

  const sorted = useMemo(
    () => [...HOLIDAYS_2026].sort((a, b) => a.date.localeCompare(b.date)),
    []
  );

  const today = startOfToday();
  const nextHoliday = useMemo(
    () => sorted.find((h) => parseDate(h.date) >= today) || null,
    [sorted, today]
  );

  const filtered = useMemo(() => {
    return sorted.filter((h) => {
      if (typeFilter !== 'all' && h.type !== typeFilter) return false;
      if (selectedMonth !== null && monthIdx(h.date) !== selectedMonth) return false;
      if (!showPast && parseDate(h.date) < today) return false;
      return true;
    });
  }, [sorted, typeFilter, selectedMonth, showPast, today]);

  const stats = useMemo(() => ({
    total: sorted.length,
    gazetted: sorted.filter((h) => h.type === 'Gazetted').length,
    restricted: sorted.filter((h) => h.type === 'Restricted').length,
    upcoming: sorted.filter((h) => parseDate(h.date) >= today).length,
  }), [sorted, today]);

  return (
    <div className="flex min-h-screen bg-background" data-testid="holiday-calendar-page">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6 lg:p-10">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-xs text-foreground-muted mb-6">
            <button onClick={() => navigate('/dashboard')} className="hover:text-foreground transition-colors">Home</button>
            <ChevronRight size={12} />
            <span className="text-foreground">HR</span>
            <ChevronRight size={12} />
            <span className="text-primary">Holiday Calendar</span>
          </div>

          {/* Header */}
          <header className="rounded-2xl overflow-hidden border border-border bg-gradient-to-br from-background-card via-primary/10 to-background-card p-6 relative mb-6">
            <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-primary/20 blur-3xl pointer-events-none" aria-hidden />
            <div className="absolute -bottom-20 -left-20 w-72 h-72 rounded-full bg-accent/15 blur-3xl pointer-events-none" aria-hidden />
            <div className="relative">
              <p className="text-[10px] uppercase tracking-widest text-primary font-semibold mb-2">Ethara AI · People Operations</p>
              <h1 className="text-3xl md:text-4xl font-heading font-bold text-foreground mb-2" data-testid="holiday-calendar-title">Holiday Calendar 2026</h1>
              <p className="text-sm text-foreground-muted max-w-2xl">
                Every Gazetted and Restricted holiday for the calendar year — explorable by month, type, or timeline. Plan your time off with confidence.
              </p>
            </div>
          </header>

          {/* Next holiday hero */}
          <div className="mb-6">
            <CountdownTile holiday={nextHoliday} />
          </div>

          {/* Stat tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6" data-testid="holiday-stats">
            <StatTile value={stats.total}      label="Total holidays" sub="in 2026"        tone="text-accent" icon={CalendarDays} />
            <StatTile value={stats.gazetted}   label="Gazetted"       sub="company-wide"    tone="text-primary" icon={Flag} />
            <StatTile value={stats.restricted} label="Restricted"     sub="optional, pick & choose" tone="text-amber-300" icon={Sparkles} />
            <StatTile value={stats.upcoming}   label="Upcoming"       sub="left this year"  tone="text-accent" icon={TrendingUp} />
          </div>

          {/* Monthly distribution */}
          <div className="mb-6">
            <MonthlyDistribution holidays={sorted} selectedMonth={selectedMonth} onSelectMonth={setSelectedMonth} />
          </div>

          {/* Filters bar */}
          <div className="sticky top-0 z-20 -mx-1 px-1 py-3 backdrop-blur-md bg-background/80 border-b border-border mb-4 flex flex-wrap items-center gap-2" data-testid="holiday-filters">
            <div className="flex items-center gap-1">
              {[
                { id: 'all',        label: 'All',         icon: Globe },
                { id: 'Gazetted',   label: 'Gazetted',    icon: Flag },
                { id: 'Restricted', label: 'Restricted',  icon: Sparkles },
              ].map((t) => {
                const active = typeFilter === t.id;
                const Ic = t.icon;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTypeFilter(t.id)}
                    data-testid={`holiday-filter-${t.id}`}
                    className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      active ? 'bg-primary/15 text-primary border border-primary/40' : 'text-foreground-muted hover:text-foreground hover:bg-[rgba(144,141,206,0.10)] border border-transparent'
                    }`}
                  >
                    <Ic size={12} /> {t.label}
                  </button>
                );
              })}
            </div>

            <div className="h-5 w-px bg-border mx-1" />

            <button
              onClick={() => setShowPast((p) => !p)}
              data-testid="holiday-toggle-past"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${showPast ? 'border-border text-foreground-muted hover:text-foreground hover:bg-[rgba(144,141,206,0.10)]' : 'border-primary/40 bg-primary/15 text-primary'}`}
            >
              <Clock size={12} /> {showPast ? 'Hide past' : 'Show past'}
            </button>

            {selectedMonth !== null && (
              <button
                onClick={() => setSelectedMonth(null)}
                data-testid="holiday-clear-month"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 transition-colors"
              >
                <Filter size={12} /> {MONTH_FULL[selectedMonth]} ·  clear
              </button>
            )}

            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setView('grid')}
                data-testid="holiday-view-grid"
                className={`p-1.5 rounded-lg text-xs border transition-colors ${view === 'grid' ? 'bg-primary/15 text-primary border-primary/40' : 'border-transparent text-foreground-muted hover:text-foreground hover:bg-[rgba(144,141,206,0.10)]'}`}
                aria-label="Grid view"
              >
                <LayoutGrid size={14} />
              </button>
              <button
                onClick={() => setView('list')}
                data-testid="holiday-view-list"
                className={`p-1.5 rounded-lg text-xs border transition-colors ${view === 'list' ? 'bg-primary/15 text-primary border-primary/40' : 'border-transparent text-foreground-muted hover:text-foreground hover:bg-[rgba(144,141,206,0.10)]'}`}
                aria-label="List view"
              >
                <ListChecks size={14} />
              </button>
            </div>
          </div>

          {/* Results */}
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-border bg-background-card p-8 text-center">
              <Calendar size={28} className="mx-auto text-foreground-muted mb-2" />
              <p className="text-sm text-foreground-muted">No holidays match your filters.</p>
              <button
                onClick={() => { setTypeFilter('all'); setSelectedMonth(null); setShowPast(true); }}
                className="mt-3 text-xs font-semibold text-primary hover:text-primary-hover"
              >
                Reset filters
              </button>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={view + typeFilter + selectedMonth + showPast}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className={view === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3' : 'space-y-2'}
                data-testid={`holiday-${view}-container`}
              >
                {filtered.map((h, i) => (
                  <HolidayCard key={`${h.date}-${h.occasion}`} h={h} idx={i} view={view} />
                ))}
              </motion.div>
            </AnimatePresence>
          )}

          {/* Footer */}
          <div className="mt-8 rounded-xl border border-border bg-background-card p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${TYPE_META.Gazetted.soft}`}>{TYPE_META.Gazetted.label}</span>
                <p className="text-xs text-foreground-muted">{TYPE_META.Gazetted.desc}</p>
              </div>
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${TYPE_META.Restricted.soft}`}>{TYPE_META.Restricted.label}</span>
                <p className="text-xs text-foreground-muted">{TYPE_META.Restricted.desc}</p>
              </div>
            </div>
            <p className="text-[10px] text-foreground-muted mt-3">Calendar list as published by HR · Ethara AI 2026 · Subject to revisions communicated separately by HR.</p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default HolidayCalendarPage;
