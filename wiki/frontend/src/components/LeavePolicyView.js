import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar, Clock, Sun, Moon, Briefcase, Heart, Baby, UserCheck,
  HandHeart, Sparkles, AlertTriangle, Check, X, ChevronDown,
  FileText, Home, Coffee, Fingerprint, Calculator, TrendingUp,
  ShieldAlert, ScrollText, Building2
} from 'lucide-react';

/* ------------------------------- DATA ------------------------------- */

const LEAVE_TYPES = [
  {
    id: 'el',
    code: 'EL',
    name: 'Earned Leave',
    days: 18,
    accent: 'from-primary to-[#C084FC]',
    accentSoft: 'bg-primary/10 border-primary/30 text-primary',
    icon: Briefcase,
    accrual: 'Monthly · Prorated by DOJ',
    detail: [
      { label: 'Probation', value: 'Eligible to avail' },
      { label: 'Duration', value: 'Full Day only' },
      { label: 'Apply before', value: 'Minimum 3 days in advance' },
      { label: 'Clubbing', value: 'With CL or SL (with approval)' },
      { label: 'Carry forward', value: 'Up to 30 days to next year' },
      { label: 'Encashment', value: 'Only on separation' },
    ],
    transition: 'Implemented effective 1st June 2026 — existing employees receive proportionate credit from the effective date; new joiners get prorated EL based on DOJ.',
  },
  {
    id: 'cl',
    code: 'CL',
    name: 'Casual Leave',
    days: 7,
    accent: 'from-amber-500 to-orange-500',
    accentSoft: 'bg-amber-500/10 border-amber-500/30 text-amber-200',
    icon: Coffee,
    accrual: 'Half-yearly · Prorated by DOJ',
    detail: [
      { label: 'Probation', value: 'NOT eligible' },
      { label: 'Duration', value: 'Half Day or Full Day' },
      { label: 'Apply', value: 'Same day allowed in genuine emergencies' },
      { label: 'Consecutive limit', value: 'Max 3 consecutive CLs' },
      { label: 'Clubbing', value: 'EL ✓ · SL ✗' },
      { label: 'Year-end', value: 'Unused balance lapses' },
    ],
    transition: null,
  },
  {
    id: 'sl',
    code: 'SL',
    name: 'Sick Leave',
    days: 7,
    accent: 'from-rose-500 to-pink-500',
    accentSoft: 'bg-rose-500/10 border-rose-500/30 text-rose-200',
    icon: HandHeart,
    accrual: 'Yearly · Prorated by DOJ',
    detail: [
      { label: 'Probation', value: 'Eligible to avail' },
      { label: 'Apply', value: 'Same day allowed in genuine medical situations' },
      { label: 'Medical doc', value: 'Required for > 3 consecutive days' },
      { label: 'Without doc', value: 'May convert to LOP' },
      { label: 'Clubbing', value: 'EL ✓ · CL ✗' },
      { label: 'Year-end', value: 'Unused balance lapses' },
    ],
    transition: null,
  },
];

const SPECIAL_LEAVES = [
  {
    id: 'maternity',
    name: 'Maternity Leave',
    icon: Baby,
    color: 'text-pink-300',
    summary: 'Up to 26 weeks paid · governed by Maternity Benefit Act, 1961',
    bullets: [
      'Up to 26 weeks paid leave for the first two surviving children.',
      'Up to 12 weeks paid leave if the employee already has two or more surviving children.',
      'Can be availed up to 8 weeks before the expected delivery date; balance post childbirth.',
      'Miscarriage / MTP: up to 6 weeks leave (less than 2 surviving children).',
      'Legal adoption of an infant under 3 months: up to 12 weeks leave.',
      'Intimate HR in advance with supporting medical documentation.',
    ],
  },
  {
    id: 'paternity',
    name: 'Paternity Leave',
    icon: UserCheck,
    color: 'text-sky-300',
    summary: '5 working days · within 30 days of childbirth/adoption',
    bullets: [
      'All eligible male employees → 5 working days.',
      'Must generally be availed within 30 days of childbirth or adoption.',
    ],
  },
  {
    id: 'bereavement',
    name: 'Bereavement Leave',
    icon: Heart,
    color: 'text-accent',
    summary: 'Up to 3 working days · immediate family',
    bullets: [
      'Up to 3 working days in the unfortunate event of the demise of an immediate family member.',
    ],
  },
  {
    id: 'marriage',
    name: 'Marriage Leave',
    icon: Sparkles,
    color: 'text-amber-300',
    summary: '5 working days · once during tenure',
    bullets: [
      '5 working days available during your tenure with the organization.',
      'May be availed only once during employment with the Company.',
    ],
  },
];

const COMBINATION_RULES = [
  { combo: 'EL + CL', allowed: true, note: 'Subject to approval' },
  { combo: 'EL + SL', allowed: true, note: 'Subject to approval' },
  { combo: 'CL + SL', allowed: false, note: 'Not permitted' },
];

const ATTENDANCE_RULES = [
  { time: '10:00 AM – 7:00 PM', label: 'Official working hours', icon: Sun, tone: 'text-accent' },
  { time: '9 hours', label: 'Daily working hours required', icon: Clock, tone: 'text-pink-300' },
  { time: '30 minutes', label: 'Grace period', icon: TrendingUp, tone: 'text-amber-300' },
  { time: 'Mon – Fri', label: 'Standard working days', icon: Calendar, tone: 'text-sky-300' },
];

const LATE_TIERS = [
  { range: 'Up to 10:30 AM', label: 'On time', tone: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  { range: '10:30 – 11:30 AM', label: 'Late comer · max 3 / month', tone: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  { range: '4th+ late instance', label: 'Warning letter or LOP', tone: 'bg-orange-500/10 text-orange-300 border-orange-500/30' },
  { range: 'After 11:30 AM (no intimation)', label: 'Marked Absent', tone: 'bg-rose-500/10 text-rose-300 border-rose-500/30' },
];

const TABS = [
  { id: 'overview', label: 'Overview', icon: ScrollText },
  { id: 'attendance', label: 'Attendance', icon: Fingerprint },
  { id: 'leaves', label: 'Leave Types', icon: Calendar },
  { id: 'special', label: 'Special Leaves', icon: Heart },
  { id: 'rules', label: 'Combinations & Flex', icon: Home },
  { id: 'calc', label: 'Balance Calculator', icon: Calculator },
];

/* ------------------------------ HELPERS ----------------------------- */

const fade = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.25 },
};

/* ------------------------------ TABS UI ----------------------------- */

const OverviewTab = () => (
  <motion.div {...fade} className="space-y-6">
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/15 via-primary/8 to-pink-500/15 p-6">
      <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-primary/15 blur-3xl pointer-events-none" />
      <div className="relative">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] tracking-widest font-semibold px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30">GRT/ALP/POL/V-2</span>
          <span className="text-[10px] tracking-widest font-semibold px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-200 border border-pink-500/30">EFFECTIVE 1 JUNE 2026</span>
        </div>
        <h2 className="text-2xl font-heading font-bold text-foreground mb-2">Built for clarity, fairness & flexibility</h2>
        <p className="text-sm text-foreground/90 max-w-2xl">
          This policy lays down the attendance, leave, and work-discipline framework for every on-roll member at Ethara AI — so you always know what to expect, how to plan, and where to apply.
        </p>
      </div>
    </div>

    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {[
        { label: 'Earned Leaves', value: '18', sub: 'days / year', icon: Briefcase, tone: 'text-accent' },
        { label: 'Casual Leaves', value: '7', sub: 'days / year', icon: Coffee, tone: 'text-amber-300' },
        { label: 'Sick Leaves', value: '7', sub: 'days / year', icon: HandHeart, tone: 'text-rose-300' },
        { label: 'WFH days', value: '2', sub: 'per month', icon: Home, tone: 'text-sky-300' },
      ].map(({ label, value, sub, icon: Ic, tone }) => (
        <div key={label} className="relative rounded-xl bg-background-card/60 border border-border p-4 hover:border-accent/40 transition-colors">
          <Ic size={16} className={`${tone} mb-2`} />
          <p className="text-3xl font-bold text-foreground leading-none">{value}</p>
          <p className="text-[11px] text-foreground-muted mt-1">{sub}</p>
          <p className="text-[10px] uppercase tracking-wider text-foreground-muted font-semibold mt-2">{label}</p>
        </div>
      ))}
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className="rounded-xl bg-background-card/60 border border-border p-5">
        <Building2 size={16} className="text-accent mb-2" />
        <p className="text-xs uppercase tracking-wider font-semibold text-foreground-muted">Scope</p>
        <p className="text-sm text-foreground mt-1">All on-roll employees of Ethara AI.</p>
      </div>
      <div className="rounded-xl bg-background-card/60 border border-border p-5">
        <Calendar size={16} className="text-pink-300 mb-2" />
        <p className="text-xs uppercase tracking-wider font-semibold text-foreground-muted">Leave Cycle</p>
        <p className="text-sm text-foreground mt-1">January → December every calendar year.</p>
      </div>
      <div className="rounded-xl bg-background-card/60 border border-border p-5">
        <FileText size={16} className="text-amber-300 mb-2" />
        <p className="text-xs uppercase tracking-wider font-semibold text-foreground-muted">Apply via</p>
        <p className="text-sm text-foreground mt-1">GreytHR only · No verbal/Slack/WhatsApp approvals.</p>
      </div>
    </div>

    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
      <AlertTriangle size={16} className="text-amber-300 shrink-0 mt-0.5" />
      <p className="text-xs text-amber-100/90">
        Leave is <strong>not a matter of right</strong> — it may be approved or rejected based on business exigencies, operational requirements, and workflow dependency.
      </p>
    </div>
  </motion.div>
);

const AttendanceTab = () => (
  <motion.div {...fade} className="space-y-6">
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {ATTENDANCE_RULES.map((r) => (
        <div key={r.label} className="rounded-xl bg-background-card/60 border border-border p-4 hover:border-accent/40 transition-colors">
          <r.icon size={18} className={`${r.tone} mb-2`} />
          <p className="text-base font-bold text-foreground">{r.time}</p>
          <p className="text-[11px] text-foreground-muted mt-1">{r.label}</p>
        </div>
      ))}
    </div>

    <div className="rounded-xl bg-background-card/60 border border-border p-5">
      <div className="flex items-center gap-2 mb-3">
        <Fingerprint size={16} className="text-accent" />
        <h3 className="text-sm font-semibold text-foreground">How attendance is captured</h3>
      </div>
      <ul className="text-sm text-foreground space-y-1.5">
        <li className="flex items-start gap-2"><Check size={14} className="text-emerald-400 shrink-0 mt-0.5" /> Biometric attendance system only — no other source is valid unless approved by HR.</li>
        <li className="flex items-start gap-2"><Check size={14} className="text-emerald-400 shrink-0 mt-0.5" /> 1-hour lunch break allowed; 9 working hours daily required.</li>
        <li className="flex items-start gap-2"><Check size={14} className="text-emerald-400 shrink-0 mt-0.5" /> Biometric issues must be reported to HR via official email — verbal regularization requests aren't entertained.</li>
      </ul>
    </div>

    <div>
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Clock size={16} className="text-pink-300" /> Late-coming ladder
      </h3>
      <div className="space-y-2">
        {LATE_TIERS.map((t, i) => (
          <motion.div
            key={t.range}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className="flex items-center gap-3 p-3 rounded-lg bg-background-card/50 border border-border"
          >
            <div className="w-7 h-7 rounded-full bg-secondary text-xs font-bold flex items-center justify-center text-foreground">{i + 1}</div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">{t.range}</p>
              <p className="text-xs text-foreground-muted">{t.label}</p>
            </div>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${t.tone}`}>{i === 0 ? 'OK' : i === 1 ? 'WATCH' : i === 2 ? 'CAUTION' : 'ABSENT'}</span>
          </motion.div>
        ))}
      </div>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div className="rounded-xl bg-background-card/60 border border-border p-5">
        <Sun size={16} className="text-amber-300 mb-2" />
        <p className="text-xs uppercase tracking-wider font-semibold text-foreground-muted">Extended Working</p>
        <p className="text-sm text-foreground mt-1">
          For late-evening work due to business, the reporting manager must email HR the same day with employee name, code, and expected reporting time the next day. Late beyond approved time = Absent.
        </p>
      </div>
      <div className="rounded-xl bg-background-card/60 border border-border p-5">
        <Moon size={16} className="text-sky-300 mb-2" />
        <p className="text-xs uppercase tracking-wider font-semibold text-foreground-muted">Night Shift / Overnight</p>
        <p className="text-sm text-foreground mt-1">
          Manager must clearly intimate HR whether the employee will report late, or be marked as Present / WFH / Leave for the day.
        </p>
      </div>
    </div>
  </motion.div>
);

const LeaveCard = ({ leave, expanded, onToggle }) => {
  const Ic = leave.icon;
  return (
    <motion.div
      layout
      data-testid={`leave-card-${leave.id}`}
      className={`rounded-2xl border border-border bg-background-card/40 overflow-hidden transition-colors ${expanded ? 'border-accent/40' : 'hover:border-accent/40'}`}
    >
      <button
        onClick={() => onToggle(leave.id)}
        data-testid={`leave-card-toggle-${leave.id}`}
        className="w-full flex items-center gap-4 p-5 text-left"
      >
        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${leave.accent} flex items-center justify-center shadow-lg shrink-0`}>
          <Ic size={20} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <h4 className="text-lg font-bold text-foreground">{leave.name}</h4>
            <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${leave.accentSoft}`}>{leave.code}</span>
          </div>
          <p className="text-xs text-foreground-muted mt-0.5">{leave.accrual}</p>
        </div>
        <div className="text-right shrink-0 mr-2">
          <p className="text-3xl font-bold text-foreground leading-none">{leave.days}</p>
          <p className="text-[10px] uppercase tracking-wider text-foreground-muted">days / yr</p>
        </div>
        <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={16} className="text-foreground-muted" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 border-t border-border pt-4">
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                {leave.detail.map((d) => (
                  <div key={d.label} className="flex items-baseline gap-2">
                    <dt className="text-[11px] uppercase tracking-wider text-foreground-muted font-semibold w-32 shrink-0">{d.label}</dt>
                    <dd className="text-sm text-foreground flex-1">{d.value}</dd>
                  </div>
                ))}
              </dl>
              {leave.transition && (
                <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3 flex items-start gap-2">
                  <Sparkles size={13} className="text-accent shrink-0 mt-0.5" />
                  <p className="text-xs text-foreground/90">{leave.transition}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const LeavesTab = () => {
  const [expanded, setExpanded] = useState('el');
  const toggle = (id) => setExpanded((e) => (e === id ? null : id));
  return (
    <motion.div {...fade} className="space-y-3" data-testid="leaves-tab">
      {LEAVE_TYPES.map((l) => (
        <LeaveCard key={l.id} leave={l} expanded={expanded === l.id} onToggle={toggle} />
      ))}
      <div className="mt-4 rounded-xl border border-border bg-background-card/40 p-4 flex items-start gap-3">
        <Calendar size={14} className="text-pink-300 shrink-0 mt-0.5" />
        <p className="text-xs text-foreground">
          <strong>Planning rule:</strong> Apply ELs at least <strong>3 days in advance</strong>. CLs / SLs may be applied same-day only in genuine emergencies. EL/CL/SL credit is prorated based on your Date of Joining.
        </p>
      </div>
    </motion.div>
  );
};

const SpecialTab = () => {
  const [open, setOpen] = useState('maternity');
  return (
    <motion.div {...fade} className="space-y-3">
      {SPECIAL_LEAVES.map((s) => {
        const Ic = s.icon;
        const isOpen = open === s.id;
        return (
          <div key={s.id} className={`rounded-xl border border-border bg-background-card/40 overflow-hidden transition-colors ${isOpen ? 'border-accent/40' : 'hover:border-accent/40'}`}>
            <button
              onClick={() => setOpen(isOpen ? null : s.id)}
              data-testid={`special-leave-toggle-${s.id}`}
              className="w-full flex items-center gap-4 p-4 text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                <Ic size={18} className={s.color} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{s.name}</p>
                <p className="text-[11px] text-foreground-muted truncate">{s.summary}</p>
              </div>
              <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
                <ChevronDown size={14} className="text-foreground-muted" />
              </motion.div>
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  className="overflow-hidden"
                >
                  <ul className="px-5 pb-4 pt-1 space-y-1.5">
                    {s.bullets.map((b, i) => (
                      <li key={i} className="text-sm text-foreground flex items-start gap-2">
                        <span className="text-pink-400 mt-1">•</span> <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </motion.div>
  );
};

const RulesTab = () => (
  <motion.div {...fade} className="space-y-6">
    <div>
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Calendar size={16} className="text-accent" /> Leave combination rules
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {COMBINATION_RULES.map((c) => (
          <motion.div
            key={c.combo}
            whileHover={{ y: -2 }}
            className={`rounded-xl border p-4 flex items-center justify-between gap-3 ${c.allowed ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5'}`}
          >
            <div>
              <p className="text-base font-bold text-foreground">{c.combo}</p>
              <p className="text-[11px] text-foreground-muted mt-0.5">{c.note}</p>
            </div>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${c.allowed ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
              {c.allowed ? <Check size={18} /> : <X size={18} />}
            </div>
          </motion.div>
        ))}
      </div>
    </div>

    <div>
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Sparkles size={16} className="text-amber-300" /> Workplace flexibility <span className="text-[10px] text-foreground-muted font-normal">(Subject to management approval)</span>
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-background-card/40 p-5 hover:border-accent/40 transition-colors">
          <div className="flex items-center gap-2 mb-2">
            <Home size={16} className="text-sky-300" />
            <p className="text-sm font-semibold text-foreground">Work From Home</p>
          </div>
          <p className="text-2xl font-bold text-foreground">2 <span className="text-sm text-foreground-muted font-normal">days / month</span></p>
          <p className="text-xs text-foreground-muted mt-1">Subject to manager approval, business requirements & management discretion. <strong>Not an entitlement.</strong></p>
        </div>
        <div className="rounded-xl border border-border bg-background-card/40 p-5 hover:border-accent/40 transition-colors">
          <div className="flex items-center gap-2 mb-2">
            <HandHeart size={16} className="text-pink-300" />
            <p className="text-sm font-semibold text-foreground">Menstruation Leave</p>
          </div>
          <p className="text-2xl font-bold text-foreground">1 <span className="text-sm text-foreground-muted font-normal">day / month</span></p>
          <p className="text-xs text-foreground-muted mt-1">For female employees, with prior intimation, approval & management discretion.</p>
        </div>
      </div>
    </div>

    <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-4 flex items-start gap-3">
      <ShieldAlert size={16} className="text-rose-300 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-rose-200 mb-1">Compliance & discipline</p>
        <p className="text-xs text-rose-100/80 leading-relaxed">
          Only GreytHR entries and HR-approved leaves are valid for attendance & payroll. Unauthorized absence, misuse, or attendance manipulation may attract warning letters, LOP, or further disciplinary action.
        </p>
      </div>
    </div>
  </motion.div>
);

const CalcTab = () => {
  const today = new Date();
  const [doj, setDoj] = useState(`${today.getFullYear()}-01-01`);
  const projection = useMemo(() => {
    if (!doj) return null;
    const dt = new Date(doj + 'T00:00:00');
    if (Number.isNaN(dt.getTime())) return null;
    const year = today.getFullYear();
    const start = dt.getFullYear() === year ? dt : new Date(year, 0, 1);
    const monthsRemaining = 12 - start.getMonth() - (start.getDate() > 15 ? 1 : 0);
    const months = Math.max(0, Math.min(12, monthsRemaining));
    // EL accrues monthly: 18/12 = 1.5/month
    const el = +(months * 1.5).toFixed(1);
    // CL accrues half-yearly: 7 total - prorate by half-year participation
    const cl = months >= 12 ? 7 : months >= 6 ? 4 : months >= 1 ? Math.round((months / 12) * 7) : 0;
    // SL credited yearly prorated
    const sl = months >= 12 ? 7 : Math.round((months / 12) * 7);
    return { months, el, cl, sl, year };
  }, [doj, today]);

  return (
    <motion.div {...fade} className="space-y-5">
      <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 to-accent/5 p-6">
        <div className="flex items-center gap-2 mb-1">
          <Calculator size={16} className="text-accent" />
          <h3 className="text-sm font-semibold text-foreground">Your projected leave balance for {projection?.year}</h3>
        </div>
        <p className="text-xs text-foreground-muted mb-4">Enter your Date of Joining — we'll estimate your prorated leave credits for the current calendar year (Jan–Dec cycle).</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block flex-1 min-w-[200px]">
            <span className="text-[10px] uppercase tracking-wider text-foreground-muted font-semibold">Date of Joining</span>
            <input
              type="date"
              value={doj}
              onChange={(e) => setDoj(e.target.value)}
              max={today.toISOString().split('T')[0]}
              data-testid="leave-calc-doj"
              className="mt-1 w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
            />
          </label>
        </div>
      </div>

      {projection && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { label: 'Earned Leave', value: projection.el, full: 18, tone: 'from-primary to-[#C084FC]', accent: 'text-primary' },
            { label: 'Casual Leave', value: projection.cl, full: 7, tone: 'from-amber-500 to-orange-500', accent: 'text-amber-200' },
            { label: 'Sick Leave', value: projection.sl, full: 7, tone: 'from-rose-500 to-pink-500', accent: 'text-rose-200' },
          ].map((p) => {
            const pct = Math.min(100, (p.value / p.full) * 100);
            return (
              <motion.div
                key={p.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                data-testid={`leave-calc-${p.label.toLowerCase().split(' ')[0]}`}
                className="rounded-xl border border-border bg-background-card/60 p-4"
              >
                <p className={`text-xs uppercase tracking-wider font-semibold ${p.accent}`}>{p.label}</p>
                <p className="text-3xl font-bold text-foreground mt-1">{p.value}<span className="text-sm text-foreground-muted font-normal"> / {p.full}</span></p>
                <div className="mt-3 h-1.5 rounded-full bg-secondary overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full bg-gradient-to-r ${p.tone}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                  />
                </div>
                <p className="text-[10px] text-foreground-muted mt-2">{projection.months} months · prorated</p>
              </motion.div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-foreground-muted italic">
        Estimates only. Actual balances may differ based on probation status, leave taken, and EL transition rules (effective 1st June 2026). For exact figures, check GreytHR.
      </p>
    </motion.div>
  );
};

/* ---------------------------- MAIN COMPONENT ------------------------ */

const LeavePolicyView = () => {
  const [tab, setTab] = useState('overview');
  return (
    <div data-testid="leave-policy-view" className="space-y-6">
      <header className="rounded-2xl overflow-hidden border border-border bg-gradient-to-br from-background via-primary/10 to-background p-6 relative">
        <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-primary/20 blur-3xl pointer-events-none" aria-hidden />
        <div className="absolute -bottom-20 -left-20 w-72 h-72 rounded-full bg-pink-500/15 blur-3xl pointer-events-none" aria-hidden />
        <div className="relative">
          <p className="text-[10px] uppercase tracking-widest text-accent font-semibold mb-2">Ethara AI · People Operations</p>
          <h1 className="text-3xl md:text-4xl font-heading font-bold text-foreground mb-2">Attendance &amp; Leave Policy</h1>
          <p className="text-sm text-foreground/80 max-w-2xl">
            Everything you need to know about working hours, leaves, and time-off at Ethara AI — explorable, interactive, and always up-to-date.
          </p>
        </div>
      </header>

      <div className="sticky top-0 z-20 -mx-1 px-1 py-2 backdrop-blur-md bg-background/80 border-b border-border" data-testid="leave-policy-tabs">
        <div className="flex gap-1 overflow-x-auto scrollbar-none">
          {TABS.map((t) => {
            const Ic = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                data-testid={`leave-tab-${t.id}`}
                className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-primary/15 text-primary border border-primary/40'
                    : 'text-foreground-muted hover:text-foreground hover:bg-[rgba(144,141,206,0.10)] border border-transparent'
                }`}
              >
                <Ic size={13} />
                {t.label}
                {active && (
                  <motion.span
                    layoutId="active-leave-tab"
                    className="absolute inset-0 rounded-lg ring-1 ring-primary/30 pointer-events-none"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab}>
          {tab === 'overview' && <OverviewTab />}
          {tab === 'attendance' && <AttendanceTab />}
          {tab === 'leaves' && <LeavesTab />}
          {tab === 'special' && <SpecialTab />}
          {tab === 'rules' && <RulesTab />}
          {tab === 'calc' && <CalcTab />}
        </motion.div>
      </AnimatePresence>

      <footer className="rounded-xl border border-border bg-background-card/40 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-foreground-muted">
          Governed by Haryana Shops &amp; Commercial Establishments provisions · The Company may amend, modify or withdraw any provision at any time.
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] tracking-widest font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">V-2</span>
          <span className="text-[10px] tracking-widest font-semibold px-2 py-0.5 rounded-full bg-pink-500/15 text-pink-200 border border-pink-500/30">Effective 1 June 2026</span>
        </div>
      </footer>
    </div>
  );
};

export default LeavePolicyView;
