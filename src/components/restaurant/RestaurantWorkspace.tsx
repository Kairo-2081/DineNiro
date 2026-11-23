import React from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import type { Restaurant, RestaurantMembership } from '../../types';
import { ErrorNote, HeroBand, Motif, ROLE_LABELS, StatusBadge, TopBar } from '../ui';
import { StaffManager } from './StaffManager';

const STATUS_COPY = {
  pending: {
    title: 'Your application is being reviewed',
    body: 'A DineNiro admin checks every restaurant before it goes live. Once approved, you can add your team here.',
  },
  rejected: {
    title: 'Your application was not approved',
    body: 'Contact the DineNiro team if you think this is a mistake. They can reopen your application.',
  },
  suspended: {
    title: 'This restaurant is suspended',
    body: 'Staff cannot use DineNiro here until a platform admin reinstates the restaurant.',
  },
} as const;

function RestaurantDetails({ restaurant }: { restaurant: Restaurant }) {
  const rows: [string, string][] = [
    ['Phone', restaurant.phone],
    ['Address', `${restaurant.address}, ${restaurant.area}, ${restaurant.city}`],
    ['Cuisine', restaurant.cuisine || '—'],
    ['Trade licence', restaurant.tradeLicenceNo || 'Not provided'],
    ['VAT BIN', restaurant.vatBin || 'Not provided'],
  ];
  return (
    <aside className="relative isolate flex flex-col gap-3 overflow-hidden rounded-sm bg-raised px-6 py-7" aria-label="Restaurant details">
      <div aria-hidden="true" className="pointer-events-none absolute inset-[7px] border border-[rgb(216_179_124/0.38)]" />
      <Motif name="steam" className="pointer-events-none absolute -right-6 -top-4 -z-10 h-36 w-36 text-gold opacity-10" />
      <span className="eyebrow">Details</span>
      <dl className="m-0 flex flex-col">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 border-b border-gold-hair py-2.5 text-sm">
            <dt className="text-muted">{label}</dt>
            <dd className="m-0 text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

export function RestaurantWorkspace() {
  const { session, logout, refresh } = useAuth();
  const memberships = session?.memberships ?? [];
  const [selectedId, setSelectedId] = React.useState(memberships[0]?.restaurantId ?? '');
  const membership: RestaurantMembership | undefined = memberships.find((m) => m.restaurantId === selectedId) ?? memberships[0];
  const [restaurant, setRestaurant] = React.useState<Restaurant | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!membership) return;
    let current = true;
    setRestaurant(null);
    api.restaurant(membership.restaurantId)
      .then((result) => { if (current) setRestaurant(result.restaurant); })
      .catch((err) => { if (current) setError(err instanceof Error ? err.message : 'Could not load the restaurant.'); });
    return () => { current = false; };
  }, [membership?.restaurantId]);

  const header = (
    <TopBar>
      {memberships.length > 1 && (
        <label className="flex items-center gap-2 text-sm text-muted">
          <span className="sr-only">Restaurant</span>
          <select className="input h-10 w-auto" value={membership?.restaurantId} onChange={(e) => setSelectedId(e.target.value)}>
            {memberships.map((m) => <option key={m.restaurantId} value={m.restaurantId}>{m.restaurantName}</option>)}
          </select>
        </label>
      )}
      <span className="flex-1" />
      <span className="text-sm text-muted">{session?.account.name}{membership && ` · ${ROLE_LABELS[membership.role]}`}</span>
      <button type="button" className="btn" onClick={() => void logout()}>Sign out</button>
    </TopBar>
  );

  if (!membership) {
    return (
      <div className="min-h-screen">
        {header}
        <main className="mx-auto max-w-2xl px-6 py-16">
          <section className="panel flex flex-col gap-3 p-8">
            <h1 className="m-0 font-display text-4xl italic">No restaurant yet</h1>
            <p className="m-0 text-muted">Your account is not part of any restaurant right now. Ask the owner or manager to add you again.</p>
          </section>
        </main>
      </div>
    );
  }

  const approved = membership.restaurantStatus === 'approved';
  const managesTeam = membership.role === 'owner' || membership.role === 'manager';
  const statusCopy = approved ? null : STATUS_COPY[membership.restaurantStatus];

  return (
    <div className="min-h-screen">
      {header}
      <main className="mx-auto flex max-w-[1320px] flex-col gap-6 px-6 py-8 sm:px-8">
        <HeroBand eyebrow={`${ROLE_LABELS[membership.role]} · ${restaurant ? `${restaurant.area}, ${restaurant.city}` : '…'}`} title={membership.restaurantName}>
          <StatusBadge status={membership.restaurantStatus} />
        </HeroBand>
        <ErrorNote message={error} />

        <div className="flex flex-wrap items-start gap-6">
          <div className="flex min-w-0 flex-[999_1_620px] flex-col gap-6">
            {statusCopy && (
              <section className="panel flex flex-col gap-3 p-7" role="status">
                <h2 className="m-0 font-display text-3xl font-medium italic">{statusCopy.title}</h2>
                {membership.statusReason && <p className="m-0 font-medium text-danger">Reason: {membership.statusReason}</p>}
                <p className="m-0 text-muted">{statusCopy.body}</p>
                <div><button type="button" className="btn" onClick={() => void refresh()}>Check again</button></div>
              </section>
            )}
            {approved && managesTeam && session && (
              <StaffManager restaurantId={membership.restaurantId} myRole={membership.role} myUserId={session.account.id} />
            )}
            {approved && !managesTeam && (
              <section className="panel flex flex-col gap-3 p-7">
                <h2 className="m-0 font-display text-3xl font-medium italic">You're on the team</h2>
                <p className="m-0 text-muted">
                  You're signed in as {ROLE_LABELS[membership.role].toLowerCase()} at {membership.restaurantName}.
                  The floor plan, orders and kitchen display will appear here once they are switched on for this restaurant.
                </p>
              </section>
            )}
          </div>
          <div className="flex flex-[1_1_320px] flex-col gap-6">
            {restaurant && <RestaurantDetails restaurant={restaurant} />}
          </div>
        </div>
      </main>
    </div>
  );
}
