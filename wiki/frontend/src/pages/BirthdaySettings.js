import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Cake, Settings, Save, Search, Loader2, ShieldCheck, Sparkles, CalendarHeart, Users as UsersIcon } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const BirthdaySettings = () => {
  const { token, user } = useAuth();
  const [settings, setSettings] = useState({ enabled: true, upcoming_window_days: 7 });
  const [savingSettings, setSavingSettings] = useState(false);
  const [users, setUsers] = useState([]);
  const [rosterStats, setRosterStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState({}); // email -> dob string
  const [savingRow, setSavingRow] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, uRes, rRes] = await Promise.all([
        fetch(`${process.env.REACT_APP_BACKEND_URL}/api/birthdays/settings`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${process.env.REACT_APP_BACKEND_URL}/api/users`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${process.env.REACT_APP_BACKEND_URL}/api/birthdays/roster/stats`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const sData = await sRes.json();
      const uData = await uRes.json();
      const rData = rRes.ok ? await rRes.json() : null;
      if (sData.settings) setSettings({ ...settings, ...sData.settings });
      setUsers(uData.users || []);
      setRosterStats(rData);
    } catch {
      toast.error('Could not load birthday settings');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const updateSettings = async (patch) => {
    setSavingSettings(true);
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/birthdays/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.detail || 'Failed to save');
        return;
      }
      toast.success('Settings updated');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSavingSettings(false);
    }
  };

  const saveDob = async (email) => {
    const value = edits[email];
    if (!value) return;
    setSavingRow(email);
    try {
      const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/users/${encodeURIComponent(email)}/dob`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dob: value }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Birthday saved for ${email}`);
        setUsers((prev) => prev.map((u) => (u.email === email ? { ...u, dob: value } : u)));
        setEdits((prev) => { const n = { ...prev }; delete n[email]; return n; });
      } else {
        toast.error(data.detail || 'Failed to save');
      }
    } catch {
      toast.error('Failed to save');
    } finally {
      setSavingRow(null);
    }
  };

  const filtered = users
    .filter((u) => {
      const q = search.toLowerCase();
      if (!q) return true;
      return (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
    })
    .sort((a, b) => {
      // Users with no DOB first
      const aHas = !!a.dob, bHas = !!b.dob;
      if (aHas !== bHas) return aHas ? 1 : -1;
      return (a.name || '').localeCompare(b.name || '');
    });

  const withDob = users.filter((u) => !!u.dob).length;
  const total = users.length;

  if (loading) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="animate-spin text-primary" size={28} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-6 lg:p-10">
          {/* Header */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/20 via-primary/5 to-accent/20 border border-border p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-[rgba(144,141,206,0.12)] backdrop-blur-md flex items-center justify-center border border-accent/25">
                  <Cake size={22} className="text-primary" />
                </div>
                <div className="flex-1">
                  <h1 className="text-2xl font-heading font-bold text-foreground mb-1" data-testid="birthday-settings-title">
                    Birthday Celebrations
                  </h1>
                  <p className="text-sm text-foreground-muted">
                    Make every team member feel special. Manage notifications and bulk-set employee birthdays here.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Settings panel */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="glass-card rounded-xl p-5" data-testid="settings-card-enabled">
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck size={14} className="text-accent" />
                <p className="text-[11px] font-semibold tracking-wider text-foreground-muted">FEATURE STATUS</p>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">Birthday notifications</p>
                  <p className="text-[11px] text-foreground-muted mt-0.5">Toggle the entire feature on/off</p>
                </div>
                <button
                  onClick={() => updateSettings({ enabled: !settings.enabled })}
                  disabled={savingSettings}
                  data-testid="toggle-birthday-enabled"
                  className={`relative w-11 h-6 rounded-full transition-colors ${settings.enabled ? 'bg-primary' : 'bg-secondary'}`}
                  aria-pressed={settings.enabled}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${settings.enabled ? 'translate-x-5' : ''}`}
                  />
                </button>
              </div>
            </div>

            <div className="glass-card rounded-xl p-5" data-testid="settings-card-window">
              <div className="flex items-center gap-2 mb-2">
                <CalendarHeart size={14} className="text-primary" />
                <p className="text-[11px] font-semibold tracking-wider text-foreground-muted">UPCOMING WINDOW</p>
              </div>
              <p className="text-sm font-semibold text-foreground mb-2">Show next</p>
              <select
                value={settings.upcoming_window_days}
                onChange={(e) => updateSettings({ upcoming_window_days: parseInt(e.target.value, 10) })}
                data-testid="select-upcoming-window"
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60"
              >
                {[3, 7, 14, 21, 30].map((d) => (
                  <option key={d} value={d}>{d} days</option>
                ))}
              </select>
            </div>

            <div className="glass-card rounded-xl p-5" data-testid="settings-card-stats">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={14} className="text-amber-300" />
                <p className="text-[11px] font-semibold tracking-wider text-foreground-muted">COVERAGE</p>
              </div>
              <p className="text-3xl font-bold text-foreground" data-testid="dob-coverage">
                {withDob}<span className="text-base text-foreground-muted font-normal">/{total}</span>
              </p>
              <p className="text-[11px] text-foreground-muted mt-0.5">
                Employees with birthday on file ({total > 0 ? Math.round((withDob / total) * 100) : 0}%)
              </p>
              <div className="mt-2 h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-accent to-primary rounded-full transition-all"
                  style={{ width: `${total > 0 ? (withDob / total) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>

          {/* Roster Stats Panel */}
          {rosterStats && rosterStats.total > 0 && (
            <div className="glass-card rounded-xl p-5 mb-6" data-testid="roster-stats-panel">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <UsersIcon size={16} className="text-accent" />
                  <h2 className="text-base font-semibold text-foreground">Company Birthday Roster</h2>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[rgba(144,141,206,0.15)] text-accent border border-accent/25">
                    {rosterStats.total} employees
                  </span>
                </div>
                <p className="text-[11px] text-foreground-muted">
                  {rosterStats.with_dob}/{rosterStats.total} with DOB on file
                </p>
              </div>
              <p className="text-[10px] tracking-wider font-semibold text-foreground-muted mb-2">BIRTHDAYS BY MONTH</p>
              <div className="grid grid-cols-12 gap-1.5">
                {MONTH_LABELS.map((label, idx) => {
                  const mm = String(idx + 1).padStart(2, '0');
                  const row = (rosterStats.by_month || []).find((m) => m.month === mm);
                  const count = row ? row.count : 0;
                  const max = Math.max(...(rosterStats.by_month || []).map((m) => m.count), 1);
                  const heightPct = (count / max) * 100;
                  return (
                    <div key={mm} className="flex flex-col items-center gap-1" data-testid={`month-bar-${mm}`}>
                      <div className="w-full h-16 bg-secondary rounded-md flex items-end overflow-hidden">
                        <div
                          className="w-full bg-gradient-to-t from-accent to-primary transition-all"
                          style={{ height: `${heightPct}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-foreground-muted font-medium">{label}</p>
                      <p className="text-[10px] text-foreground font-semibold">{count}</p>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-foreground-muted mt-3">
                Roster is the canonical source for birthday notifications. To refresh, run <code className="px-1 py-0.5 rounded bg-secondary text-foreground">python -m scripts.import_roster</code> with an updated Excel file.
              </p>
            </div>
          )}

          {/* Bulk DOB editor */}
          <div className="glass-card rounded-xl">
            <div className="px-5 py-4 border-b border-border/80 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                  <Settings size={16} className="text-accent" />
                  Employee Birthdays
                </h2>
                <p className="text-[11px] text-foreground-muted mt-0.5">Set or update each employee's date of birth</p>
              </div>
              <div className="relative w-56">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search employees..."
                  data-testid="employee-search"
                  className="w-full pl-9 pr-3 py-2 bg-secondary border border-border rounded-lg text-xs text-foreground placeholder-foreground-muted focus:outline-none focus:border-primary/60"
                />
              </div>
            </div>

            <div className="divide-y divide-border/60">
              {filtered.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-foreground-muted">No employees match your search.</div>
              ) : (
                filtered.map((u) => {
                  const editing = edits[u.email] !== undefined;
                  const value = editing ? edits[u.email] : (u.dob || '');
                  const isSelf = u.email === user?.email;
                  return (
                    <div key={u.email} className="px-5 py-3 flex items-center gap-4" data-testid={`dob-row-${u.email}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{u.name} {isSelf && <span className="text-[10px] text-accent">(you)</span>}</p>
                        <p className="text-[11px] text-foreground-muted truncate">{u.email}</p>
                      </div>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                        u.role === 'admin' ? 'bg-primary/15 text-primary' :
                        u.role === 'hr' ? 'bg-amber-500/10 text-amber-400' :
                        'bg-[rgba(144,141,206,0.15)] text-accent'
                      }`}>{u.role}</span>
                      <input
                        type="date"
                        value={value}
                        max={new Date().toISOString().split('T')[0]}
                        onChange={(e) => setEdits({ ...edits, [u.email]: e.target.value })}
                        data-testid={`dob-input-${u.email}`}
                        className="bg-secondary border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/60 w-36"
                      />
                      <button
                        onClick={() => saveDob(u.email)}
                        disabled={savingRow === u.email || !editing || edits[u.email] === u.dob}
                        data-testid={`save-dob-${u.email}`}
                        className="inline-flex items-center gap-1 bg-primary hover:bg-primary-hover disabled:bg-secondary disabled:text-foreground-muted disabled:cursor-not-allowed text-white text-[11px] font-semibold px-2.5 py-1.5 rounded-md transition-colors"
                      >
                        {savingRow === u.email ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                        Save
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default BirthdaySettings;
