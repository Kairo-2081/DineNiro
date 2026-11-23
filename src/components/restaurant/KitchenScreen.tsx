import React from 'react';
import { minutesSince, useNow, usePolling } from '../../lib/format';
import type { KitchenTicket, Station, TicketStatus } from '../../types';
import { STATIONS } from '../../types';
import { ErrorNote, Motif } from '../ui';
import { ScreenHeader } from './Rail';
import { can, useWorkspace } from './workspace';

const COLUMNS: { status: TicketStatus; title: string; action: string; button: string }[] = [
  { status: 'new', title: 'New', action: 'Start', button: 'bg-[#e8b77d] text-[#1a0f08]' },
  { status: 'cooking', title: 'Cooking', action: 'Mark ready', button: 'bg-[#8dbf8f] text-[#0f1a10]' },
  { status: 'ready', title: 'Ready to serve', action: 'Served', button: 'border-t border-[rgb(216_179_124/0.22)] bg-[#2a1d14] text-cream' },
];

const LATE_MINUTES = 15;
const STATION_LABELS: Record<Station, string> = { kitchen: 'Curry', tandoor: 'Tandoor', bar: 'Drinks', dessert: 'Dessert' };

function timerStyle(minutes: number, status: TicketStatus) {
  if (status !== 'ready' && minutes > LATE_MINUTES) return 'bg-[#b5402a] text-[#fff1e2]';
  if (minutes >= 10) return 'bg-[#3a2a14] text-[#f2c894]';
  return 'bg-[#16241a] text-[#a9d6ab]';
}

function Ticket({ ticket, column, now, station, onMoved }: {
  ticket: KitchenTicket; column: (typeof COLUMNS)[number]; now: number; station: Station | 'all'; onMoved: () => void;
}) {
  const { calls, role } = useWorkspace();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const since = ticket.status === 'ready' ? ticket.readyAt : ticket.sentAt;
  const minutes = minutesSince(since, now);
  const late = ticket.status !== 'ready' && minutes > LATE_MINUTES;
  const items = ticket.items.filter((i) => !i.void && (station === 'all' || i.station === station));
  const mayMove = can.cook(role) || (role === 'waiter' && ticket.status === 'ready');
  if (items.length === 0) return null;

  const move = async () => {
    setBusy(true);
    setError(null);
    try {
      await calls.advance(ticket.id, ticket.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not move the ticket.');
    }
    setBusy(false);
    onMoved();
  };

  return (
    <article className={`flex flex-col rounded-md border bg-raised ${late ? 'border-[#b5402a]' : 'border-gold-line'}`}>
      <div className="flex items-center justify-between px-4 pb-2.5 pt-3.5">
        <div className="flex flex-col gap-1">
          <span className="font-display text-[32px] font-semibold leading-none">{ticket.tableLabel}</span>
          <span className="text-xs text-muted">#{ticket.number} · {ticket.serverName ?? '—'}</span>
        </div>
        <span className={`rounded px-2.5 py-2 text-lg font-bold tabular-nums ${timerStyle(minutes, ticket.status)}`}>
          {minutes}m{late && <span className="sr-only"> late</span>}
        </span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2.5 px-4 pb-3.5 pt-1">
        {items.map((i) => (
          <li key={i.id} className="flex flex-col gap-0.5">
            <span className="text-lg font-semibold leading-tight"><span className="text-[#e8b77d]">{i.quantity}×</span> {i.name}</span>
            {(i.options.length > 0 || i.note) && <span className="pl-7 text-sm font-medium italic text-[#f2c894]">{[...i.options, i.note].filter(Boolean).join(' · ')}</span>}
          </li>
        ))}
      </ul>
      {error && <div className="px-4 pb-3"><ErrorNote message={error} /></div>}
      {mayMove && (
        <button type="button" disabled={busy} onClick={() => void move()}
          className={`min-h-14 w-full cursor-pointer rounded-b-md border-0 text-sm font-bold uppercase tracking-[0.14em] disabled:opacity-60 ${column.button}`}>
          {column.action}
        </button>
      )}
    </article>
  );
}

export function KitchenScreen() {
  const { calls } = useWorkspace();
  const now = useNow(10_000);
  const { data, error, refresh } = usePolling(() => calls.kitchen(), 5_000, [calls]);
  const [station, setStation] = React.useState<Station | 'all'>('all');
  // The server's clock decides how late a ticket is, so a tablet with the wrong time still shows the truth.
  const skew = data ? new Date(data.serverTime).getTime() - Date.now() : 0;
  const tickets = data?.tickets ?? [];
  const active = tickets.filter((t) => t.status !== 'served');
  const late = active.filter((t) => t.status !== 'ready' && minutesSince(t.sentAt, now + skew) > LATE_MINUTES).length;

  return (
    <main className="flex min-h-screen flex-1 flex-col gap-4 bg-[#0e0805] px-6 py-6">
      <ScreenHeader title={<>Kitchen <Motif name="steam" className="h-8 w-8 text-gold-soft opacity-70" /></>}>
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-sm text-muted">{active.length} open{late > 0 && <> · <span className="font-semibold text-danger">{late} late</span></>}</span>
          <div role="tablist" aria-label="Station" className="flex flex-wrap gap-2">
            {(['all', ...STATIONS] as const).map((s) => (
              <button key={s} type="button" role="tab" aria-selected={station === s} onClick={() => setStation(s)}
                className={`min-h-11 cursor-pointer rounded-full border px-4 text-[13px] font-medium ${station === s ? 'border-[#efe4d2] bg-[#efe4d2] text-[#1a0f08]' : 'border-gold-line bg-surface-2 text-muted'}`}>
                {s === 'all' ? 'All stations' : STATION_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      </ScreenHeader>
      <ErrorNote message={error} />
      <div className="grid flex-1 gap-4 md:grid-cols-3">
        {COLUMNS.map((column) => {
          const list = tickets.filter((t) => t.status === column.status)
            .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
          return (
            <section key={column.status} aria-label={column.title} className="flex min-h-0 flex-col gap-3">
              <div className="flex items-center justify-between border-b border-[rgb(216_179_124/0.22)] pb-2.5">
                <h2 className="eyebrow m-0 text-xs">{column.title}</h2>
                <span className="text-[13px] font-semibold text-muted">{list.length}</span>
              </div>
              <div className="flex flex-col gap-3 pb-5">
                {list.map((t) => <Ticket key={t.id} ticket={t} column={column} now={now + skew} station={station} onMoved={() => void refresh()} />)}
                {data && list.length === 0 && <p className="m-0 py-6 text-center text-sm text-faint">Nothing here.</p>}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
