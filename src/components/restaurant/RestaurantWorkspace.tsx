import React from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import type { Restaurant, RestaurantMembership } from '../../types';
import { ErrorNote, HeroBand, Motif, ROLE_LABELS, StatusBadge, TopBar, Wordmark } from '../ui';
import { BillsScreen } from './BillsScreen';
import { BookingsScreen } from './BookingsScreen';
import { FloorScreen } from './FloorScreen';
import { KitchenScreen } from './KitchenScreen';
import { OrderScreen } from './OrderScreen';
import { Rail, ScreenHeader } from './Rail';
import { SetupScreen } from './SetupScreen';
import { StaffManager } from './StaffManager';
import { can, homeScreen, SCREENS_FOR_ROLE, useWorkspace, WorkspaceContext, type Screen } from './workspace';

const STATUS_COPY = {
  pending: {
    title: 'Your application is being reviewed',
    body: 'A DineNiro admin checks every restaurant before it goes live. Once approved, you can set up your tables and menu and add your team.',
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

function TeamScreen() {
  const { membership, session, restaurant } = useWorkspace();
  return (
    <main className="flex min-w-0 flex-1 flex-col gap-6 px-6 py-6 sm:px-8">
      <ScreenHeader title="Team" />
      <div className="flex flex-wrap items-start gap-6">
        <div className="min-w-0 flex-[999_1_560px]">
          <StaffManager restaurantId={membership.restaurantId} myRole={membership.role} myUserId={session.account.id} />
        </div>
        <div className="flex-[1_1_320px]"><RestaurantDetails restaurant={restaurant} /></div>
      </div>
    </main>
  );
}

function CurrentScreen({ screen }: { screen: Screen }) {
  switch (screen.name) {
    case 'order': return <OrderScreen key={screen.orderId} orderId={screen.orderId} />;
    case 'kitchen': return <KitchenScreen />;
    case 'bills': return <BillsScreen billId={screen.billId} />;
    case 'bookings': return <BookingsScreen />;
    case 'setup': return <SetupScreen />;
    case 'team': return <TeamScreen />;
    default: return <FloorScreen />;
  }
}

/** The working app for an approved restaurant: side menu plus one screen at a time. */
function ServiceShell({ membership, restaurant, setRestaurant, switchRestaurant }: {
  membership: RestaurantMembership; restaurant: Restaurant; setRestaurant: (r: Restaurant) => void; switchRestaurant: (id: string) => void;
}) {
  const { session } = useAuth();
  const [screen, setScreen] = React.useState<Screen>(() => homeScreen(membership.role));
  const calls = React.useMemo(() => api.at(membership.restaurantId), [membership.restaurantId]);
  const go = React.useCallback((next: Screen) => {
    const allowed = SCREENS_FOR_ROLE[membership.role];
    setScreen(next.name === 'order' || allowed.includes(next.name) ? next : homeScreen(membership.role));
    window.scrollTo(0, 0);
  }, [membership.role]);

  const afterSeating = React.useCallback((orderId: string) => {
    go(can.order(membership.role) ? { name: 'order', orderId } : { name: 'floor' });
  }, [go, membership.role]);

  const value = React.useMemo(() => ({
    session: session!, membership, role: membership.role, restaurant, setRestaurant, calls, screen, go, afterSeating, switchRestaurant,
  }), [session, membership, restaurant, setRestaurant, calls, screen, go, afterSeating, switchRestaurant]);

  return (
    <WorkspaceContext.Provider value={value}>
      <div className="flex min-h-screen">
        <Rail />
        <div className="flex min-w-0 flex-1"><CurrentScreen screen={screen} /></div>
      </div>
    </WorkspaceContext.Provider>
  );
}

function StatusPage({ membership, restaurant, error }: { membership: RestaurantMembership; restaurant: Restaurant | null; error: string | null }) {
  const { session, logout, refresh } = useAuth();
  const statusCopy = membership.restaurantStatus === 'approved' ? null : STATUS_COPY[membership.restaurantStatus];
  return (
    <div className="min-h-screen">
      <TopBar>
        <span className="flex-1" />
        <span className="text-sm text-muted">{session?.account.name} · {ROLE_LABELS[membership.role]}</span>
        <button type="button" className="btn" onClick={() => void logout()}>Sign out</button>
      </TopBar>
      <main className="mx-auto flex max-w-[1320px] flex-col gap-6 px-6 py-8 sm:px-8">
        <HeroBand eyebrow={`${ROLE_LABELS[membership.role]} · ${restaurant ? `${restaurant.area}, ${restaurant.city}` : '…'}`} title={membership.restaurantName}>
          <StatusBadge status={membership.restaurantStatus} />
        </HeroBand>
        <ErrorNote message={error} />
        <div className="flex flex-wrap items-start gap-6">
          {statusCopy && (
            <section className="panel flex min-w-0 flex-[999_1_620px] flex-col gap-3 p-7" role="status">
              <h2 className="m-0 font-display text-3xl font-medium italic">{statusCopy.title}</h2>
              {membership.statusReason && <p className="m-0 font-medium text-danger">Reason: {membership.statusReason}</p>}
              <p className="m-0 text-muted">{statusCopy.body}</p>
              <div><button type="button" className="btn" onClick={() => void refresh()}>Check again</button></div>
            </section>
          )}
          <div className="flex flex-[1_1_320px] flex-col gap-6">{restaurant && <RestaurantDetails restaurant={restaurant} />}</div>
        </div>
      </main>
    </div>
  );
}

export function RestaurantWorkspace() {
  const { session, logout } = useAuth();
  const memberships = session?.memberships ?? [];
  const [selectedId, setSelectedId] = React.useState(memberships[0]?.restaurantId ?? '');
  const membership = memberships.find((m) => m.restaurantId === selectedId) ?? memberships[0];
  const [restaurant, setRestaurant] = React.useState<Restaurant | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!membership) return;
    let current = true;
    setRestaurant(null);
    setError(null);
    api.restaurant(membership.restaurantId)
      .then((result) => { if (current) setRestaurant(result.restaurant); })
      .catch((err) => { if (current) setError(err instanceof Error ? err.message : 'Could not load the restaurant.'); });
    return () => { current = false; };
  }, [membership?.restaurantId]);

  if (!membership) {
    return (
      <div className="min-h-screen">
        <TopBar><span className="flex-1" /><button type="button" className="btn" onClick={() => void logout()}>Sign out</button></TopBar>
        <main className="mx-auto max-w-2xl px-6 py-16">
          <section className="panel flex flex-col gap-3 p-8">
            <h1 className="m-0 font-display text-4xl italic">No restaurant yet</h1>
            <p className="m-0 text-muted">Your account is not part of any restaurant right now. Ask the owner or manager to add you again.</p>
          </section>
        </main>
      </div>
    );
  }

  if (membership.restaurantStatus !== 'approved') return <StatusPage membership={membership} restaurant={restaurant} error={error} />;
  if (!restaurant) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4" aria-busy={!error}>
        <Wordmark size={44} />
        <ErrorNote message={error} />
      </div>
    );
  }
  return (
    <ServiceShell key={membership.restaurantId} membership={membership} restaurant={restaurant}
      setRestaurant={setRestaurant} switchRestaurant={setSelectedId} />
  );
}
