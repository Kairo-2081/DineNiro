import React from 'react';
import { BrandLockup } from './brand';
import type { RestaurantStatus, StaffRole } from '../types';

/** Gold line drawings from the design. Decorative only. */
type MotifName = 'anise' | 'thali' | 'chili' | 'mint' | 'cardamom' | 'steam';

const MOTIFS: Record<MotifName, React.ReactNode> = {
  anise: (
    <g strokeWidth={2} strokeLinejoin="round">
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <path key={a} transform={`rotate(${a})`} d="M0 -6C8 -16 8 -34 0 -46C-8 -34 -8 -16 0 -6Z" />
      ))}
      <circle r={6} />
    </g>
  ),
  thali: (
    <g strokeWidth={1} strokeLinecap="round">
      <circle r={47} /><circle r={41} /><circle r={39} strokeDasharray="1.5 2.5" />
      <circle cx={-17} cy={-17} r={11} /><circle cx={-17} cy={-17} r={8} />
      <circle cx={17} cy={-19} r={10} /><circle cx={17} cy={-19} r={7} />
      <circle cx={22} cy={13} r={11} /><circle cx={22} cy={13} r={8} />
      <path d="M-30 12C-24 -2 2 -2 8 12C2 24 -24 26 -30 12Z" />
      <circle cx={-20} cy={12} r={0.8} /><circle cx={-13} cy={9} r={0.8} /><circle cx={-7} cy={14} r={0.8} /><circle cx={-2} cy={10} r={0.8} />
    </g>
  ),
  chili: (
    <g strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M-38 34C-12 32 18 14 28 -22C30 -30 22 -32 20 -26C10 2 -10 20 -40 26C-44 28 -42 34 -38 34Z" />
      <path d="M26 -26C28 -36 34 -42 42 -40" />
    </g>
  ),
  mint: (
    <g strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M-36 34C-32 -8 8 -38 40 -40C40 -8 8 30 -36 34Z" />
      <path d="M-36 34C-6 8 14 -14 40 -40" />
    </g>
  ),
  cardamom: (
    <g strokeWidth={2} strokeLinecap="round" transform="rotate(30)">
      <path d="M0 -40C20 -20 20 20 0 42C-20 20 -20 -20 0 -40Z" />
      <path d="M0 -40C7 -12 7 14 0 42" />
    </g>
  ),
  steam: (
    <g strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M-40 6H40C38 28 22 40 0 40C-22 40 -38 28 -40 6Z" />
      <path d="M-14 -14C-22 -22 -6 -28 -14 -38M2 -16C-6 -24 10 -30 2 -42M18 -14C10 -22 26 -28 18 -38" />
    </g>
  ),
};

export function Motif({ name, className = '', style }: { name: MotifName; className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="-50 -50 100 100" fill="none" stroke="currentColor" aria-hidden="true" className={className} style={style}>
      {MOTIFS[name]}
    </svg>
  );
}

export function TopBar({ children }: { children?: React.ReactNode }) {
  return (
    <header className="border-b border-[rgb(216_179_124/0.22)] bg-gradient-to-b from-[#0e0805] to-ink-deep">
      <div className="mx-auto flex min-h-[72px] max-w-[1320px] flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3 sm:px-8">
        <BrandLockup />
        {children}
      </div>
      <div className="kantha" aria-hidden="true" />
    </header>
  );
}

/** Framed page heading with a spotlight and scattered spices, as in the owner pages of the design. */
export function HeroBand({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="panel relative isolate flex min-h-[170px] flex-wrap items-end justify-between gap-4 overflow-hidden px-8 pb-7 pt-9"
      style={{ background: 'radial-gradient(ellipse 55% 130% at 80% 40%, #3A2414 0%, #1E130C 48%, #140C08 85%)' }}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 text-[#D9B48A]">
        <div className="absolute inset-2 border border-[rgb(216_179_124/0.22)]" />
        <Motif name="thali" className="absolute -top-16 right-32 h-[300px] w-[300px] opacity-20" />
        <Motif name="anise" className="absolute right-[460px] top-6 h-16 w-16 rotate-12 opacity-30" />
        <Motif name="chili" className="absolute -bottom-3 right-8 h-28 w-28 opacity-25" />
        <Motif name="mint" className="absolute -bottom-5 right-[520px] h-24 w-24 opacity-20" />
        <Motif name="cardamom" className="absolute right-6 top-3 h-16 w-16 opacity-25" />
      </div>
      <div className="flex flex-col gap-2.5">
        <span className="eyebrow">{eyebrow}</span>
        <h1 className="m-0 font-display text-5xl font-medium italic leading-none sm:text-[56px]">{title}</h1>
      </div>
      {children}
    </div>
  );
}

const STATUS_STYLES: Record<RestaurantStatus, string> = {
  pending: 'bg-warn-bg text-warn',
  approved: 'bg-ok-bg text-ok',
  suspended: 'bg-danger-bg text-danger',
  rejected: 'bg-danger-bg text-danger',
};

export function StatusBadge({ status }: { status: RestaurantStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1.5 text-xs font-semibold capitalize ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

export const ROLE_LABELS: Record<StaffRole, string> = {
  owner: 'Owner', manager: 'Manager', waiter: 'Waiter', chef: 'Chef', cashier: 'Cashier', host: 'Host',
};

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="m-0 rounded-[3px] border border-[#8a3a26] bg-danger-bg px-3.5 py-2.5 text-sm text-danger">{message}</p>;
}

export function Initials({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join('');
  return (
    <span aria-hidden="true" className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-[#5a4430] bg-[#261a12] text-[13px] font-semibold">
      {initials || '·'}
    </span>
  );
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
