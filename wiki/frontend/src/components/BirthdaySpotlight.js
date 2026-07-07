import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cake, PartyPopper, Send, X, Gift, Sparkles, Heart, Loader2, CalendarHeart } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';
import { celebrateBurst } from '../lib/confetti';

const QUICK_WISHES = [
  '🎉 Happy birthday! Wishing you an amazing year ahead!',
  '🎂 Have the most fantastic day — you deserve it!',
  '✨ Many happy returns! Cake on us today 🍰',
  '💜 Hope your day is as awesome as you are!',
];

// Soft palette used across cards (deterministic per user)
const GRADIENTS = [
  'from-[rgba(197,203,232,0.16)] via-[#19182C] to-[rgba(237,0,237,0.10)]',
  'from-[rgba(144,141,206,0.20)] via-[#19182C] to-[rgba(246,224,246,0.10)]',
  'from-[rgba(142,158,232,0.16)] via-[#19182C] to-[rgba(245,221,208,0.08)]',
  'from-[rgba(160,153,232,0.18)] via-[#19182C] to-[rgba(197,203,232,0.12)]',
  'from-[rgba(249,225,242,0.12)] via-[#19182C] to-[rgba(197,203,232,0.14)]',
];

const gradientFor = (email) => {
  let h = 0;
  for (let i = 0; i < (email || '').length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
};

const Avatar = ({ user, size = 56 }) => {
  const profilePictureSrc = user.profile_picture?.startsWith('/')
    ? `${process.env.REACT_APP_BACKEND_URL}${user.profile_picture}`
    : `${process.env.REACT_APP_BACKEND_URL}/api/auth/profile/picture/${user.profile_picture}`;
  const initials = (user.name || user.email || '?')
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  if (user.profile_picture) {
    return (
      <img
        src={profilePictureSrc}
        alt={user.name}
        style={{ width: size, height: size }}
        className="rounded-full object-cover border-2 border-[rgba(144,141,206,0.35)] shadow-[0_18px_32px_-22px_rgba(0,0,0,0.6)]"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-full flex items-center justify-center border-2 border-[rgba(144,141,206,0.35)] bg-gradient-to-br from-[#908DCE] to-[#ED00ED] text-white font-bold shadow-[0_18px_32px_-22px_rgba(0,0,0,0.65)]"
    >
      <span style={{ fontSize: size * 0.36 }}>{initials}</span>
    </div>
  );
};

const SpotlightCard = ({ person, onWishClick, onViewWishes, idx }) => {
  const gradient = gradientFor(person.email);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.05, type: 'spring', damping: 22 }}
      data-testid={`birthday-spotlight-${person.email}`}
      className={`relative overflow-hidden rounded-[1.75rem] border border-[rgba(144,141,206,0.25)] bg-gradient-to-br ${gradient} p-5 shadow-[0_28px_60px_-34px_rgba(0,0,0,0.6)]`}
    >
      {/* floating balloons */}
      <motion.div
        animate={{ y: [0, -6, 0], rotate: [-3, 3, -3] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -top-3 -right-2 text-3xl select-none pointer-events-none"
        aria-hidden
      >
        🎈
      </motion.div>
      <motion.div
        animate={{ y: [0, -8, 0], rotate: [3, -3, 3] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 0.4 }}
        className="absolute top-6 right-8 text-2xl select-none pointer-events-none opacity-80"
        aria-hidden
      >
        🎈
      </motion.div>

      <div className="flex items-start gap-4 relative">
        <Avatar user={person} size={60} />
        <div className="flex-1 min-w-0">
          <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-[#ED00ED]/30 bg-[rgba(237,0,237,0.12)] px-2 py-0.5 text-[10px] font-semibold tracking-wider text-primary">
            <Cake size={10} /> TODAY'S STAR
          </div>
          <h3 className="truncate text-lg font-bold text-foreground" data-testid={`birthday-name-${person.email}`}>
            {person.name}
          </h3>
          <p className="truncate text-xs text-foreground-muted">
            {person.department}{person.ecode && !person.email?.endsWith('@roster.local') ? ` · ${person.email}` : person.ecode ? ` · ${person.ecode}` : person.email ? ` · ${person.email}` : ''}
          </p>
          <p className="mt-2 text-sm italic text-foreground-muted">"{person.tagline}"</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          onClick={() => onViewWishes(person)}
          data-testid={`view-wishes-${person.email}`}
          className="group/wishes flex items-center gap-1.5 text-xs text-foreground-muted transition-colors hover:text-primary"
          title="Read the wishes"
        >
          <Heart size={12} className="text-[#ED00ED] transition-transform group-hover/wishes:scale-110" />
          <span data-testid={`wish-count-${person.email}`} className="underline decoration-dotted underline-offset-2">
            {person.wish_count} {person.wish_count === 1 ? 'wish' : 'wishes'} so far
          </span>
        </button>
        <button
          onClick={() => onWishClick(person)}
          data-testid={`wish-button-${person.email}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#ED00ED]/30 bg-[rgba(144,141,206,0.18)] px-3 py-1.5 text-xs font-semibold text-foreground transition-all hover:border-[#ED00ED]/50 hover:bg-primary hover:text-white active:scale-95"
        >
          <Gift size={13} /> Send a wish
        </button>
      </div>
    </motion.div>
  );
};

const UpcomingItem = ({ person, idx }) => {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: idx * 0.04 }}
      data-testid={`upcoming-birthday-${person.email}`}
      className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-[rgba(144,141,206,0.12)]"
    >
      <Avatar user={person} size={36} />
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{person.name}</p>
        <p className="truncate text-[11px] text-foreground-muted">{person.department}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs font-semibold text-primary">
          in {person.days_until} {person.days_until === 1 ? 'day' : 'days'}
        </p>
        <p className="text-[10px] text-foreground-muted">
          {new Date(person.next_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </p>
      </div>
    </motion.div>
  );
};

const WishModal = ({ open, person, onClose, onSent }) => {
  const { token, user } = useAuth();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) setMessage('');
  }, [open, person?.email]);

  const handleSend = async (text) => {
    const msg = (text || message).trim();
    if (!msg) {
      toast.error('Write a wish first!');
      return;
    }
    if (msg.length > 280) {
      toast.error('Keep it under 280 characters');
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/birthdays/wish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ recipient_email: person.email, message: msg }),
      });
      const data = await res.json();
      if (res.ok) {
        celebrateBurst({ x: 0.5, y: 0.5 });
        toast.success(`Wish sent to ${person.name.split(' ')[0]}! 🎉`);
        onSent && onSent();
        onClose();
      } else {
        toast.error(data.detail || 'Failed to send wish');
      }
    } catch {
      toast.error('Failed to send wish');
    } finally {
      setSending(false);
    }
  };

  if (!person) return null;
  const isSelf = person.email === user?.email;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={onClose}
          data-testid="wish-modal-backdrop"
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: 'spring', damping: 24 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md overflow-hidden rounded-[1.75rem] border border-[rgba(144,141,206,0.25)] bg-[#111120] shadow-[0_30px_70px_-32px_rgba(0,0,0,0.7)]"
            data-testid="wish-modal"
          >
            <div className={`relative border-b border-[#908DCE]/18 bg-gradient-to-br ${gradientFor(person.email)} px-6 py-5`}>
              <button
                onClick={onClose}
                data-testid="wish-modal-close"
                className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(144,141,206,0.18)] text-foreground-muted transition-colors hover:bg-[rgba(144,141,206,0.3)] hover:text-foreground"
              >
                <X size={14} />
              </button>
              <div className="flex items-center gap-3">
                <Avatar user={person} size={52} />
                <div>
                  <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                    {isSelf ? 'Your big day 🎉' : 'Send a wish to'}
                  </p>
                  <h3 className="text-lg font-bold text-foreground">{person.name}</h3>
                  <p className="text-xs text-foreground-muted">{person.department}</p>
                </div>
              </div>
            </div>

            {isSelf ? (
              <div className="p-6 text-center">
                <PartyPopper size={36} className="mx-auto mb-3 text-[#ED00ED]" />
                <p className="text-sm text-foreground-muted">
                  Today's all about you! Sit back, enjoy the cake 🎂 — wishes are pouring in.
                </p>
                <button
                  onClick={onClose}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
                >
                  Thanks! 💜
                </button>
              </div>
            ) : (
              <div className="p-5 space-y-4">
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold tracking-wider text-foreground-muted">QUICK WISHES</label>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_WISHES.map((q) => (
                      <button
                        key={q}
                        onClick={() => setMessage(q)}
                        data-testid={`quick-wish-${q.slice(0, 10)}`}
                        className="rounded-full border border-[rgba(144,141,206,0.25)] bg-[rgba(144,141,206,0.12)] px-2.5 py-1 text-[11px] text-foreground-muted transition-colors hover:border-[#ED00ED]/40 hover:bg-[rgba(144,141,206,0.2)] hover:text-foreground"
                      >
                        {q.slice(0, 28)}…
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold tracking-wider text-foreground-muted">YOUR MESSAGE</label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={3}
                    maxLength={280}
                    placeholder="Write something warm..."
                    data-testid="wish-message-input"
                    className="w-full resize-none rounded-xl border border-[rgba(144,141,206,0.25)] bg-[#0B0B12] px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted focus:border-[#ED00ED]/50 focus:outline-none focus:ring-2 focus:ring-[#ED00ED]/20"
                  />
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-foreground-muted">{message.length}/280</span>
                    <span className="flex items-center gap-1 text-[10px] text-foreground-muted">
                      <Sparkles size={10} /> Be kind, be warm
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => handleSend()}
                  disabled={sending || !message.trim()}
                  data-testid="send-wish-button"
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-[rgba(144,141,206,0.18)] disabled:text-foreground-muted"
                >
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={14} />}
                  {sending ? 'Sending…' : 'Send wish'}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const WishWall = ({ open, person, onClose }) => {
  const { token, user } = useAuth();
  const [wishes, setWishes] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !person?.email) return;
    setLoading(true);
    fetch(`${process.env.REACT_APP_BACKEND_URL}/api/birthdays/wishes/${encodeURIComponent(person.email)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => setWishes(d.wishes || []))
      .catch((e) => console.error('fetch wishes failed:', e))
      .finally(() => setLoading(false));
  }, [open, person?.email, token]);

  if (!person) return null;
  const isSelf = person.email === user?.email;
  const firstName = (person.name || '').split(' ')[0];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={onClose}
          data-testid="wish-wall-backdrop"
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: 'spring', damping: 24 }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-[1.75rem] border border-[rgba(144,141,206,0.25)] bg-[#111120] shadow-[0_30px_70px_-32px_rgba(0,0,0,0.7)]"
            data-testid="wish-wall-modal"
          >
            <div className={`relative shrink-0 border-b border-[#908DCE]/18 bg-gradient-to-br ${gradientFor(person.email)} px-6 py-5`}>
              <button
                onClick={onClose}
                data-testid="wish-wall-close"
                className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(144,141,206,0.18)] text-foreground-muted hover:bg-[rgba(144,141,206,0.3)] hover:text-foreground"
              >
                <X size={14} />
              </button>
              <div className="flex items-center gap-3">
                <Avatar user={person} size={52} />
                <div>
                  <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                    {isSelf ? 'Your wish wall 💜' : `Wishes for ${firstName}`}
                  </p>
                  <h3 className="flex items-center gap-2 text-lg font-bold text-foreground">
                    <Heart size={16} className="text-[#ED00ED]" /> {wishes.length} {wishes.length === 1 ? 'wish' : 'wishes'}
                  </h3>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3" data-testid="wish-wall-list">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={20} className="animate-spin text-[#ED00ED]" />
                </div>
              ) : wishes.length === 0 ? (
                <div className="text-center py-10">
                  <Gift size={32} className="mx-auto mb-3 text-[#908DCE]" />
                  <p className="text-sm text-foreground-muted">No wishes yet — be the first to send one!</p>
                </div>
              ) : (
                wishes.map((w, i) => {
                  const initials = (w.sender_name || w.sender_email || '?')
                    .split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
                  const sentAt = new Date(w.created_at);
                  const timeStr = sentAt.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                  return (
                    <motion.div
                      key={w.id || `${w.sender_email}-${i}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      data-testid={`wish-item-${i}`}
                      className="flex items-start gap-3 rounded-xl border border-[rgba(144,141,206,0.2)] bg-background-card p-3 transition-colors hover:border-[#ED00ED]/30"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#908DCE] to-[#ED00ED] text-xs font-bold text-white">
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-foreground">{w.sender_name || w.sender_email}</p>
                          <p className="shrink-0 text-[10px] text-foreground-muted">{timeStr}</p>
                        </div>
                        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-snug text-foreground-muted">{w.message}</p>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between border-t border-[#908DCE]/18 bg-[#0B0B12]/60 px-5 py-3">
              <p className="text-[10px] text-foreground-muted">All wishes sent today (IST)</p>
              <button
                onClick={onClose}
                data-testid="wish-wall-done"
                className="rounded-md px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-[#ED00ED]/10 hover:text-primary-hover"
              >
                Done
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const BirthdaySpotlight = () => {
  const { token } = useAuth();
  const [today, setToday] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [wishTarget, setWishTarget] = useState(null);
  const [wallTarget, setWallTarget] = useState(null);
  const confettiFired = useRef(false);

  const fetchAll = useCallback(async () => {
    try {
      const [t, u] = await Promise.all([
        fetch(`${process.env.REACT_APP_BACKEND_URL}/api/birthdays/today`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${process.env.REACT_APP_BACKEND_URL}/api/birthdays/upcoming?days=7`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const tData = await t.json();
      const uData = await u.json();
      setToday(tData.birthdays || []);
      setUpcoming(uData.upcoming || []);
      setEnabled(tData.enabled !== false);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Listen for global "open-birthday-wish" event (fired from NotificationBell)
  useEffect(() => {
    const handler = (e) => {
      if (e.detail) setWishTarget(e.detail);
    };
    window.addEventListener('open-birthday-wish', handler);
    return () => window.removeEventListener('open-birthday-wish', handler);
  }, []);

  // Subtle confetti on first reveal when there's a birthday today
  useEffect(() => {
    if (!loading && today.length > 0 && !confettiFired.current) {
      confettiFired.current = true;
      setTimeout(() => celebrateBurst({ x: 0.5, y: 0.25 }), 400);
    }
  }, [loading, today]);

  if (loading) return null;
  if (!enabled) return null;
  if (today.length === 0 && upcoming.length === 0) return null;

  return (
    <>
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
        data-testid="birthday-spotlight-widget"
        aria-label="Birthday Spotlight"
      >
        <div className="flex items-center gap-2 mb-3">
          <Cake size={16} className="text-[#ED00ED]" />
          <h2 className="text-base font-heading font-semibold text-foreground">
            {today.length > 0 ? 'Birthdays today' : 'Coming up this week'}
          </h2>
          {today.length > 0 && (
            <span className="rounded-full border border-[#ED00ED]/30 bg-[#ED00ED]/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              {today.length} celebrating
            </span>
          )}
        </div>

        {today.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            {today.map((p, i) => (
              <SpotlightCard key={p.email} person={p} idx={i} onWishClick={setWishTarget} onViewWishes={setWallTarget} />
            ))}
          </div>
        )}

        {upcoming.length > 0 && (
          <div className="dashboard-panel rounded-[1.5rem] p-2" data-testid="upcoming-birthdays-list">
            <div className="flex items-center justify-between px-2 py-1.5 mb-1">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
                <CalendarHeart size={11} /> Upcoming this week
              </p>
              <p className="text-[10px] text-foreground-muted">{upcoming.length} {upcoming.length === 1 ? 'person' : 'people'}</p>
            </div>
            <div className="space-y-0.5">
              {upcoming.map((p, i) => (
                <UpcomingItem key={p.email} person={p} idx={i} />
              ))}
            </div>
          </div>
        )}
      </motion.section>

      <WishModal
        open={!!wishTarget}
        person={wishTarget}
        onClose={() => setWishTarget(null)}
        onSent={fetchAll}
      />

      <WishWall
        open={!!wallTarget}
        person={wallTarget}
        onClose={() => setWallTarget(null)}
      />
    </>
  );
};

export default BirthdaySpotlight;
