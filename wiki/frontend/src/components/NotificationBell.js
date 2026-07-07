import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Bell, X, Cake, PartyPopper, Gift } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { celebrateBurst } from '../lib/confetti';
import { toast } from 'sonner';

const POLL_MS = 60_000;

const NotificationBell = ({ onWishClick }) => {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState([]);
  const [count, setCount] = useState(0);
  const wrapRef = useRef(null);
  const seenIdsRef = useRef(new Set());
  const firstLoadRef = useRef(true);

  const fetchNotifs = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const items = data.notifications || [];
      setNotifs(items);
      setCount(items.length);
      // Pop a celebratory toast for newly arrived birthday notifications (not on initial load)
      if (!firstLoadRef.current) {
        items.forEach((n) => {
          if (!seenIdsRef.current.has(n.id) && n.type === 'birthday') {
            toast(n.title, { description: n.body, icon: '🎂' });
            celebrateBurst({ x: 0.92, y: 0.08 });
          }
        });
      }
      items.forEach((n) => seenIdsRef.current.add(n.id));
      firstLoadRef.current = false;
    } catch {
      // silent
    }
  }, [token]);

  useEffect(() => {
    fetchNotifs();
    const t = setInterval(fetchNotifs, POLL_MS);
    return () => clearInterval(t);
  }, [fetchNotifs]);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const dismiss = async (id) => {
    setNotifs((prev) => prev.filter((n) => n.id !== id));
    setCount((c) => Math.max(0, c - 1));
    try {
      await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/notifications/${encodeURIComponent(id)}/dismiss`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // silent
    }
  };

  const handleWish = (recipient) => {
    setOpen(false);
    // Dispatch global event so the BirthdaySpotlight widget can open its wish modal
    window.dispatchEvent(new CustomEvent('open-birthday-wish', { detail: recipient }));
    onWishClick && onWishClick(recipient);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid="notification-bell-button"
        aria-label={`Notifications${count ? `, ${count} unread` : ''}`}
        className="group relative flex h-11 w-11 items-center justify-center rounded-full border border-[#908DCE]/30 bg-[#111120]/75 shadow-[0_12px_24px_-18px_rgba(0,0,0,0.6)] transition-colors hover:bg-[rgba(144,141,206,0.16)]"
      >
        <Bell size={16} className="text-foreground group-hover:text-[#ED00ED]" />
        {count > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#ED00ED] px-1 text-[10px] font-bold text-white shadow-lg"
            data-testid="notification-badge"
          >
            {count}
          </motion.span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="absolute right-0 z-50 mt-3 w-[340px] max-w-[92vw] overflow-hidden rounded-[1.5rem] border border-[rgba(144,141,206,0.25)] bg-[#111120]/95 shadow-[0_28px_60px_-30px_rgba(0,0,0,0.6)] backdrop-blur-xl"
            data-testid="notification-dropdown"
          >
            <div className="flex items-center justify-between border-b border-[#908DCE]/18 px-4 py-3">
              <p className="text-sm font-bold text-foreground">Notifications</p>
              {count > 0 && (
                <span className="rounded-full border border-[#ED00ED]/30 bg-[#ED00ED]/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {count} new
                </span>
              )}
            </div>

            <div className="max-h-[400px] overflow-y-auto">
              {notifs.length === 0 ? (
                <div className="px-4 py-10 text-center" data-testid="notifications-empty">
                  <Bell size={28} className="mx-auto mb-2 text-[#908DCE]" />
                  <p className="text-sm text-foreground-muted">You're all caught up</p>
                  <p className="mt-1 text-[11px] text-foreground-muted">New birthday wishes will appear here.</p>
                </div>
              ) : (
                notifs.map((n) => {
                  const isSelf = n.type === 'birthday_self';
                  const isWish = n.type === 'birthday_wish';
                  const Icon = isWish ? Gift : isSelf ? PartyPopper : Cake;
                  return (
                    <div
                      key={n.id}
                      data-testid={`notification-${n.id}`}
                      className="group relative border-b border-[#908DCE]/12 px-4 py-3 transition-colors hover:bg-[rgba(144,141,206,0.12)]"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#ED00ED]/20 bg-[rgba(237,0,237,0.12)]">
                          <Icon size={16} className="text-[#ED00ED]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold leading-tight text-foreground">{n.title}</p>
                          <p className="mt-0.5 text-xs leading-snug text-foreground-muted">{n.body}</p>
                          {!isSelf && !isWish && (
                            <button
                              onClick={() => handleWish(n.recipient)}
                              data-testid={`notification-wish-${n.recipient?.email}`}
                              className="mt-2 inline-flex items-center gap-1 rounded-full border border-[#ED00ED]/30 bg-[#ED00ED]/10 px-2.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-[#ED00ED]/20"
                            >
                              <Gift size={11} /> Send a wish
                            </button>
                          )}
                        </div>
                        <button
                          onClick={() => dismiss(n.id)}
                          data-testid={`dismiss-notif-${n.id}`}
                          className="rounded-md p-1 text-foreground-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[rgba(144,141,206,0.16)] hover:text-foreground"
                          aria-label="Dismiss"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default NotificationBell;
