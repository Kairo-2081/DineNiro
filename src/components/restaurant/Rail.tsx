import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Motif } from '../ui';
import { SCREENS_FOR_ROLE, useWorkspace, type Screen, type ScreenName } from './workspace';

const ICONS: Record<ScreenName, React.ReactNode> = {
  floor: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><circle cx="17.5" cy="17.5" r="3.5" /></>,
  order: <><path d="M9 3h6v3H9z" /><path d="M7 4.5H5V21h14V4.5h-2" /><path d="M8.5 11h7M8.5 15h4.5" /></>,
  kitchen: <><path d="M6 13a4 4 0 1 1 2.2-7.3A4 4 0 0 1 15.8 5.7 4 4 0 1 1 18 13v7H6z" /><path d="M6 16.5h12" /></>,
  bills: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  bookings: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  setup: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>,
  team: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.4M17.5 14.8c2 .7 3.4 2.4 4 5.2" /></>,
};

const LABELS: Record<ScreenName, string> = { floor: 'Floor', order: 'Order', kitchen: 'Kitchen', bills: 'Bills', bookings: 'Bookings', setup: 'Setup', team: 'Team' };

export function Icon({ name, className = 'h-6 w-6' }: { name: ScreenName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

/** The side menu from the tablet design. */
export function Rail() {
  const { role, screen, go, session } = useWorkspace();
  const { logout } = useAuth();
  const current = screen.name === 'order' ? 'floor' : screen.name;
  const initials = session.account.name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');

  return (
    <nav aria-label="Main" className="sticky top-0 flex h-screen w-[76px] flex-none flex-col items-center gap-1.5 border-r border-gold-hair bg-ink-deep px-1 py-5 sm:w-[88px]">
      <div className="relative isolate mb-3 flex h-[60px] w-[60px] items-center justify-center">
        <Motif name="anise" className="absolute inset-0 -z-10 text-gold opacity-40" />
        <span className="gold-text font-display text-[28px] italic">Dn</span>
      </div>
      {SCREENS_FOR_ROLE[role].map((name) => {
        const active = current === name;
        return (
          <button key={name} type="button" onClick={() => go({ name } as Screen)} aria-current={active ? 'page' : undefined}
            className={`flex h-16 w-[68px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border text-[11px] font-medium transition-colors sm:w-[72px] ${active
              ? 'border-[rgb(216_179_124/0.35)] bg-gradient-to-b from-[rgb(216_179_124/0.14)] to-[rgb(216_179_124/0.04)] text-[#e8b77d] shadow-[inset_2px_0_0_#d8b37c]'
              : 'border-transparent bg-transparent text-muted hover:bg-surface-2 hover:text-cream'}`}>
            <Icon name={name} />
            {LABELS[name]}
          </button>
        );
      })}
      <div className="flex-1" />
      <span title={session.account.name} className="flex h-10 w-10 items-center justify-center rounded-full border border-[#5a4430] bg-[#261a12] text-[13px] font-semibold">{initials}</span>
      <button type="button" onClick={() => void logout()} className="mt-1 min-h-11 cursor-pointer border-0 bg-transparent text-[11px] font-medium text-muted hover:text-cream">
        Sign out
      </button>
    </nav>
  );
}

/** Page heading used by every service screen: restaurant (switchable) above the screen title. */
export function ScreenHeader({ title, children, back }: { title: React.ReactNode; children?: React.ReactNode; back?: React.ReactNode }) {
  const { session, membership, switchRestaurant } = useWorkspace();
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        {back}
        {session.memberships.length > 1 ? (
          <label className="eyebrow flex items-center gap-2">
            <span className="sr-only">Restaurant</span>
            <select value={membership.restaurantId} onChange={(e) => switchRestaurant(e.target.value)}
              className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] uppercase tracking-[inherit] text-gold-soft">
              {session.memberships.map((m) => <option key={m.restaurantId} value={m.restaurantId}>{m.restaurantName}</option>)}
            </select>
          </label>
        ) : (
          <span className="eyebrow">{membership.restaurantName}</span>
        )}
        <h1 className="m-0 flex items-center gap-3 font-display text-[42px] font-medium italic leading-none">{title}</h1>
      </div>
      {children}
    </div>
  );
}
