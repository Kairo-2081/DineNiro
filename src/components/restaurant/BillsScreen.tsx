import React from 'react';
import { clockTime, taka, usePolling } from '../../lib/format';
import { PAYMENT_METHODS, type PaymentMethod, type Receipt } from '../../types';
import { ErrorNote, Motif } from '../ui';
import { ScreenHeader } from './Rail';
import { can, useWorkspace } from './workspace';

const METHOD_LABELS: Record<PaymentMethod, string> = { cash: 'Cash', card: 'Card', bkash: 'bKash', nagad: 'Nagad' };

/** The printed slip, sized for 80 mm thermal paper. Before payment it is marked as a bill, not a receipt. */
function PrintedReceipt({ receipt }: { receipt: Receipt }) {
  const { bill, lines, restaurant } = receipt;
  const paid = bill.status === 'paid';
  const change = bill.payments.reduce((n, p) => n + (p.tendered !== null ? p.tendered - p.amount : 0), 0);
  const row = (label: React.ReactNode, value: React.ReactNode, strong = false) => (
    <div className={`flex justify-between gap-2 ${strong ? 'text-[15px] font-semibold' : ''}`}><span>{label}</span><span>{value}</span></div>
  );
  return (
    <div className="print-area mx-auto flex w-[310px] flex-col gap-2.5 bg-[#fbf7f0] px-4 pb-6 pt-5 font-mono text-xs leading-relaxed text-[#1a0f08] shadow-[0_10px_30px_rgb(0_0_0/0.45)]">
      <div className="text-center font-display text-[26px] font-semibold leading-none">{restaurant.name}</div>
      <div className="text-center">{restaurant.address}, {restaurant.area}<br />{restaurant.phone}{restaurant.vatBin && <><br />BIN {restaurant.vatBin}</>}</div>
      <div className="border-t border-dashed border-[#6b5643]" />
      {!paid && <div className="text-center font-semibold">BILL: NOT A RECEIPT</div>}
      {row(`${paid ? 'Receipt' : 'Bill'} #${String(bill.number).padStart(4, '0')}`, new Date(paid ? bill.paidAt! : bill.createdAt).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: 'numeric', minute: '2-digit' }))}
      {row(`Table ${bill.tableLabel} · ${bill.guests} guests`, bill.serverName ?? '')}
      <div className="border-t border-dashed border-[#6b5643]" />
      {lines.map((l) => (
        <div key={l.id}>
          {row(`${l.quantity} ${l.name}`, (l.unitPrice * l.quantity).toLocaleString('en-IN', { minimumFractionDigits: 2 }))}
          {l.options.length > 0 && <div className="pl-4 italic">{l.options.join(', ')}</div>}
        </div>
      ))}
      <div className="border-t border-dashed border-[#6b5643]" />
      {row('Subtotal', bill.subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 }))}
      {bill.discount > 0 && row('Discount', `-${bill.discount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`)}
      {bill.serviceCharge > 0 && row(`Service ${bill.serviceChargePct}%`, bill.serviceCharge.toLocaleString('en-IN', { minimumFractionDigits: 2 }))}
      {bill.vat > 0 && row(`VAT ${bill.vatPct}%`, bill.vat.toLocaleString('en-IN', { minimumFractionDigits: 2 }))}
      {row('TOTAL ৳', bill.total.toLocaleString('en-IN', { minimumFractionDigits: 2 }), true)}
      {bill.payments.map((p) => row(METHOD_LABELS[p.method] + (p.reference ? ` ${p.reference}` : ''), p.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })))}
      {change > 0 && row('Change', change.toLocaleString('en-IN', { minimumFractionDigits: 2 }))}
      {restaurant.receiptFooter && <><div className="border-t border-dashed border-[#6b5643]" /><div className="text-center">{restaurant.receiptFooter}</div></>}
    </div>
  );
}

function PaymentForm({ receipt, onPaid }: { receipt: Receipt; onPaid: (r: Receipt) => void }) {
  const { calls } = useWorkspace();
  const { bill } = receipt;
  const remaining = Math.round((bill.total - bill.paid) * 100) / 100;
  const [method, setMethod] = React.useState<PaymentMethod>('cash');
  const [ways, setWays] = React.useState(1);
  const share = Math.min(remaining, Math.ceil((bill.total / ways) * 100) / 100);
  const [amount, setAmount] = React.useState(String(remaining));
  const [tendered, setTendered] = React.useState('');
  const [reference, setReference] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => { setAmount(String(ways > 1 ? share : remaining)); }, [ways, remaining, share]);

  const value = Number(amount);
  const cashIn = Number(tendered);
  const change = method === 'cash' && tendered ? Math.round((cashIn - value) * 100) / 100 : 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await calls.pay(bill.id, {
        method, amount: value,
        tendered: method === 'cash' && tendered ? cashIn : undefined,
        reference: method === 'bkash' || method === 'nagad' || method === 'card' ? reference.trim() || undefined : undefined,
      });
      setTendered('');
      setReference('');
      onPaid(await calls.receipt(bill.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the payment.');
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <ErrorNote message={error} />
      <div className="flex flex-col gap-2.5">
        <h3 className="eyebrow m-0">Split</h3>
        <div className="flex items-center justify-between rounded-md border border-gold-line bg-surface px-4 py-3">
          <span className="text-[15px]">Ways</span>
          <span className="flex items-center gap-4">
            <button type="button" className="h-11 w-11 cursor-pointer rounded-full border border-[#5a4430] bg-surface-2 text-xl text-cream" aria-label="One fewer way" onClick={() => setWays(Math.max(1, ways - 1))}>−</button>
            <span className="min-w-6 text-center text-xl font-semibold">{ways}</span>
            <button type="button" className="h-11 w-11 cursor-pointer rounded-full border border-[#5a4430] bg-surface-2 text-xl text-cream" aria-label="One more way" onClick={() => setWays(Math.min(20, ways + 1))}>+</button>
          </span>
          <span className="text-lg font-semibold text-[#e8b77d]">{ways > 1 ? `${taka(Math.ceil((bill.total / ways) * 100) / 100)} each` : 'Whole bill'}</span>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <h3 className="eyebrow m-0">Payment {bill.payments.length + 1}{ways > 1 ? ` of ${ways}` : ''}</h3>
        <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-4 gap-2.5">
          {PAYMENT_METHODS.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
              className={`min-h-16 cursor-pointer rounded-md text-[15px] font-semibold ${method === m ? 'border-2 border-[#e8b77d] bg-[#261a12] text-[#e8b77d]' : 'border border-gold-line bg-surface-2 text-cream'}`}>
              {METHOD_LABELS[m]}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">Amount (৳)<input className="input text-lg font-semibold" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        {method === 'cash' ? (
          <label className="field">Cash received (৳)<input className="input text-lg font-semibold" inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={String(Math.ceil(value / 500) * 500 || '')} /></label>
        ) : (
          <label className="field">{method === 'card' ? 'Card slip number (optional)' : 'Transaction ID'}
            <input className="input" required={method !== 'card'} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
          </label>
        )}
      </div>
      {change > 0 && <div className="flex items-center justify-between rounded bg-ok-bg px-4 py-3 text-ok"><span>Change due</span><span className="text-xl font-semibold">{taka(change)}</span></div>}
      {change < 0 && <p className="m-0 text-sm text-warn">Cash received is less than the amount.</p>}
      <button type="submit" className="btn btn-gold min-h-16 text-[15px]" disabled={busy || !(value > 0) || change < 0}>Take {taka(value || 0)}</button>
    </form>
  );
}

function BillDetail({ billId, onChanged }: { billId: string; onChanged: () => void }) {
  const { calls, role } = useWorkspace();
  const { data: receipt, error, setData } = usePolling(() => calls.receipt(billId), 20_000, [calls, billId]);
  const [discount, setDiscount] = React.useState('');
  const [discountError, setDiscountError] = React.useState<string | null>(null);

  if (!receipt) return <div className="p-8"><ErrorNote message={error} />{!error && <p className="text-muted">Loading…</p>}</div>;
  const { bill } = receipt;
  const applyDiscount = async () => {
    setDiscountError(null);
    try {
      await calls.prepareBill(bill.orderId, Number(discount) || 0);
      setData(await calls.receipt(billId));
      setDiscount('');
      onChanged();
    } catch (err) {
      setDiscountError(err instanceof Error ? err.message : 'Could not apply the discount.');
    }
  };

  return (
    <div className="flex flex-wrap gap-8 p-6 sm:p-8">
      <div className="flex flex-none flex-col items-center gap-4">
        <PrintedReceipt receipt={receipt} />
        <button type="button" className="btn w-[310px]" onClick={() => window.print()}>{bill.status === 'paid' ? 'Print receipt' : 'Print bill'}</button>
      </div>
      <div className="flex min-w-[300px] flex-1 flex-col gap-5">
        <div className="flex items-baseline justify-between">
          <h2 className="m-0 font-display text-4xl italic">Table {bill.tableLabel}</h2>
          <span className="text-[28px] font-semibold text-[#e8b77d]">{taka(bill.total)}</span>
        </div>
        {bill.status === 'paid' ? (
          <p className="m-0 rounded bg-ok-bg px-4 py-3 text-ok">Paid in full at {clockTime(bill.paidAt!)}. The table is free again.</p>
        ) : (
          <>
            {bill.paid > 0 && <p className="m-0 text-muted">{taka(bill.paid)} paid · <span className="font-semibold text-cream">{taka(Math.round((bill.total - bill.paid) * 100) / 100)} left</span></p>}
            {can.supervise(role) && bill.payments.length === 0 && (
              <div className="flex flex-wrap items-end gap-2.5">
                <label className="field flex-1">Discount on food (৳)<input className="input" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder={bill.discount ? String(bill.discount) : '0'} /></label>
                <button type="button" className="btn" onClick={() => void applyDiscount()}>Apply</button>
              </div>
            )}
            <ErrorNote message={discountError} />
            {can.takePayment(role) ? <PaymentForm receipt={receipt} onPaid={(r) => { setData(r); onChanged(); }} /> : <p className="m-0 text-muted">A cashier or manager takes the payment.</p>}
          </>
        )}
      </div>
    </div>
  );
}

export function BillsScreen({ billId }: { billId?: string }) {
  const { calls, go } = useWorkspace();
  const { data: bills, error, refresh } = usePolling(() => calls.bills(), 10_000, [calls]);
  // With no bill chosen, show the oldest open one, and keep showing it after it is paid.
  const [autoId, setAutoId] = React.useState<string | undefined>();
  const firstOpen = bills?.find((b) => b.status === 'open')?.id;
  React.useEffect(() => { if (!autoId && firstOpen) setAutoId(firstOpen); }, [autoId, firstOpen]);
  const selected = billId ?? autoId ?? firstOpen;

  return (
    <div className="flex min-h-screen flex-1 flex-wrap">
      <aside aria-label="Bills" className="relative isolate flex w-full flex-col gap-4 border-r border-gold-hair bg-surface px-5 py-6 lg:w-[320px] lg:flex-none">
        <Motif name="cardamom" className="pointer-events-none absolute -bottom-6 -right-6 -z-10 h-32 w-32 text-gold opacity-10" />
        <ScreenHeader title="Bills" />
        <ErrorNote message={error} />
        {bills?.length === 0 && <p className="m-0 text-sm text-muted">No bills yet today. Print one from a table's order.</p>}
        <ul className="m-0 flex list-none flex-col p-0">
          {bills?.map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => go({ name: 'bills', billId: b.id })} aria-current={b.id === selected ? 'true' : undefined}
                className={`flex w-full cursor-pointer items-center gap-3 border-0 border-b border-gold-hair bg-transparent px-2 py-3 text-left text-cream ${b.id === selected ? 'bg-[#261a12]' : 'hover:bg-surface-2'}`}>
                <span className="flex flex-1 flex-col gap-1">
                  <span className="text-sm font-semibold">#{String(b.number).padStart(4, '0')} · Table {b.tableLabel}</span>
                  <span className="text-xs text-faint">{clockTime(b.paidAt ?? b.createdAt)} · {b.status === 'paid' ? (b.methods || 'paid') : b.paid > 0 ? `${taka(b.paid)} paid` : 'waiting'}</span>
                </span>
                <span className="text-sm font-semibold">{taka(b.total)}</span>
                <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${b.status === 'paid' ? 'bg-ok-bg text-ok' : 'bg-warn-bg text-warn'}`}>{b.status === 'paid' ? 'Paid' : 'Open'}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main className="min-w-0 flex-1">
        {selected ? <BillDetail key={selected} billId={selected} onChanged={() => void refresh()} /> : <p className="p-8 text-muted">Choose a bill.</p>}
      </main>
    </div>
  );
}
