import React from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import type { PlatformStats, RestaurantStatus, RestaurantStatusChange, RestaurantSummary } from '../../types';
import { ErrorNote, formatDate, HeroBand, Initials, Motif, StatusBadge, TopBar } from '../ui';

const TABS: { status: RestaurantStatus; label: string }[] = [
  { status: 'pending', label: 'Pending' },
  { status: 'approved', label: 'Active' },
  { status: 'suspended', label: 'Suspended' },
  { status: 'rejected', label: 'Rejected' },
];

/** The moves an admin can make from each status. Rejecting and suspending need a reason. */
const ACTIONS: Record<RestaurantStatus, { to: RestaurantStatus; label: string; needsReason: boolean; primary?: boolean }[]> = {
  pending: [{ to: 'rejected', label: 'Reject', needsReason: true }, { to: 'approved', label: 'Approve', needsReason: false, primary: true }],
  approved: [{ to: 'suspended', label: 'Suspend', needsReason: true }],
  suspended: [{ to: 'approved', label: 'Reinstate', needsReason: false, primary: true }],
  rejected: [{ to: 'pending', label: 'Reopen', needsReason: false }],
};

function RestaurantCard({ restaurant, onChanged }: { restaurant: RestaurantSummary; onChanged: () => void }) {
  const [reasonFor, setReasonFor] = React.useState<RestaurantStatus | null>(null);
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const apply = async (to: RestaurantStatus, withReason = '') => {
    setBusy(true);
    setError(null);
    try {
      await api.setRestaurantStatus(restaurant.id, to, withReason);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the status.');
      setBusy(false);
    }
  };

  const missing = [!restaurant.tradeLicenceNo && 'Trade licence', !restaurant.vatBin && 'VAT BIN'].filter(Boolean) as string[];

  return (
    <article className="panel flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="m-0 font-display text-[28px] font-medium leading-tight">{restaurant.name}</h3>
            <StatusBadge status={restaurant.status} />
          </div>
          <p className="m-0 text-sm text-muted">
            {[restaurant.area, restaurant.city, restaurant.cuisine].filter(Boolean).join(' · ')} · {restaurant.phone}
          </p>
          <p className="m-0 text-sm text-muted">{restaurant.address}</p>
          <div className="flex flex-wrap gap-2 pt-1 text-xs font-semibold">
            <span className={`rounded-full px-2.5 py-1.5 ${restaurant.tradeLicenceNo ? 'bg-ok-bg text-ok' : 'bg-warn-bg text-warn'}`}>
              {restaurant.tradeLicenceNo ? `✓ Trade licence ${restaurant.tradeLicenceNo}` : '! Trade licence missing'}
            </span>
            <span className={`rounded-full px-2.5 py-1.5 ${restaurant.vatBin ? 'bg-ok-bg text-ok' : 'bg-warn-bg text-warn'}`}>
              {restaurant.vatBin ? `✓ BIN ${restaurant.vatBin}` : '! VAT BIN missing'}
            </span>
          </div>
          {restaurant.statusReason && <p className="m-0 text-sm italic text-danger">“{restaurant.statusReason}”</p>}
        </div>
        <div className="flex min-w-[170px] flex-col gap-1.5 text-xs text-faint">
          Owner
          <span className="flex items-center gap-2.5 text-sm text-cream"><Initials name={restaurant.ownerName} />
            <span className="flex flex-col gap-1"><span className="font-semibold">{restaurant.ownerName}</span><span className="text-xs text-muted">{restaurant.ownerEmail}</span></span>
          </span>
          <span className="pt-2">Applied {formatDate(restaurant.createdAt)} · {restaurant.staffCount} staff</span>
        </div>
      </div>

      <ErrorNote message={error} />
      {reasonFor ? (
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void apply(reasonFor, reason.trim()); }}>
          <label className="field min-w-[260px] flex-1">
            Reason ({reasonFor === 'rejected' ? 'shown to the owner' : 'shown to the owner and staff'})
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus maxLength={1000} />
          </label>
          <button type="button" className="btn" onClick={() => { setReasonFor(null); setReason(''); }}>Cancel</button>
          <button type="submit" className="btn btn-danger" disabled={busy || !reason.trim()}>Confirm {reasonFor === 'rejected' ? 'rejection' : 'suspension'}</button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          {restaurant.status === 'pending' && missing.length > 0 && (
            <span className="mr-auto text-xs text-warn">{missing.join(' and ')} not provided: check before approving.</span>
          )}
          {ACTIONS[restaurant.status].map((action) => (
            <button key={action.to} type="button" disabled={busy}
              className={`btn ${action.primary ? 'btn-gold' : action.needsReason ? 'btn-danger' : ''}`}
              onClick={() => (action.needsReason ? setReasonFor(action.to) : void apply(action.to))}>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

export function AdminConsole() {
  const { session, logout } = useAuth();
  const [tab, setTab] = React.useState<RestaurantStatus>('pending');
  const [stats, setStats] = React.useState<PlatformStats | null>(null);
  const [restaurants, setRestaurants] = React.useState<RestaurantSummary[] | null>(null);
  const [audit, setAudit] = React.useState<RestaurantStatusChange[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const [nextStats, list, trail] = await Promise.all([api.platformStats(), api.restaurants(tab), api.auditTrail()]);
      setStats(nextStats);
      setRestaurants(list);
      setAudit(trail);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load restaurants.');
    }
  }, [tab]);

  React.useEffect(() => { setRestaurants(null); void load(); }, [load]);

  const count = (status: RestaurantStatus) => (stats ? stats[status] : 0);

  return (
    <div className="min-h-screen">
      <TopBar>
        <span className="rounded-[3px] border border-[#5a4430] px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-soft">Platform admin</span>
        <span className="flex-1" />
        <span className="text-sm text-muted">{session?.account.name}</span>
        <button type="button" className="btn" onClick={() => void logout()}>Sign out</button>
      </TopBar>

      <main className="mx-auto flex max-w-[1320px] flex-col gap-6 px-6 py-8 sm:px-8">
        <HeroBand eyebrow="Restaurants" title="Approvals">
          <div className="flex gap-8 text-right text-sm text-muted">
            <div><div className="text-2xl font-semibold text-cream">{stats?.approved ?? '–'}</div>live restaurants</div>
            <div><div className="text-2xl font-semibold text-cream">{stats?.activeStaff ?? '–'}</div>active staff</div>
          </div>
        </HeroBand>

        <ErrorNote message={error} />
        <div role="tablist" aria-label="Restaurant status" className="flex flex-wrap gap-7 border-b border-gold-hair">
          {TABS.map((t) => (
            <button key={t.status} type="button" role="tab" aria-selected={tab === t.status} onClick={() => setTab(t.status)}
              className={`-mb-px flex min-h-11 cursor-pointer items-center gap-2 border-0 border-b-2 bg-transparent px-1 text-sm font-medium ${tab === t.status ? 'border-gold text-cream' : 'border-transparent text-muted hover:text-cream'}`}>
              {t.label}
              <span className="rounded-full bg-[#261a12] px-2 py-0.5 text-xs font-semibold text-[#e8b77d]">{count(t.status)}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-start gap-6">
          <section aria-label="Restaurants" className="flex min-w-0 flex-[999_1_620px] flex-col gap-3.5">
            {restaurants === null && <p className="text-muted">Loading…</p>}
            {restaurants?.length === 0 && (
              <p className="m-0 rounded-md border border-dashed border-[rgb(216_179_124/0.22)] p-10 text-center text-muted">No restaurants in this list.</p>
            )}
            {restaurants?.map((r) => <RestaurantCard key={r.id} restaurant={r} onChanged={() => void load()} />)}
          </section>

          <aside aria-label="Audit trail" className="relative isolate flex flex-[1_1_320px] flex-col gap-3.5 overflow-hidden rounded-sm bg-raised px-6 py-7">
            <div aria-hidden="true" className="pointer-events-none absolute inset-[7px] border border-[rgb(216_179_124/0.38)]" />
            <Motif name="anise" className="pointer-events-none absolute -right-8 -top-8 -z-10 h-36 w-36 text-gold opacity-10" />
            <span className="eyebrow">Audit trail</span>
            <h2 className="m-0 font-display text-[30px] font-medium italic leading-tight">Status changes</h2>
            {audit.length === 0 && <p className="m-0 text-sm text-muted">Nothing yet.</p>}
            {audit.map((change) => (
              <div key={change.id} className="flex flex-col gap-1 border-b border-gold-hair py-2.5">
                <span className="text-sm leading-snug">
                  <span className="font-semibold">{change.restaurantName}</span>{' '}
                  {change.oldStatus ? `${change.oldStatus} → ${change.newStatus}` : 'applied'}
                  {change.reason && <span className="text-muted">: {change.reason}</span>}
                </span>
                <span className="text-xs text-faint">{change.changedByName ?? 'Removed account'} · {formatDate(change.changedAt)}</span>
              </div>
            ))}
          </aside>
        </div>
      </main>
    </div>
  );
}
