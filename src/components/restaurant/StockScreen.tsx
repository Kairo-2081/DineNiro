import React from 'react';
import { taka, usePolling } from '../../lib/format';
import { STOCK_UNITS, type Ingredient, type MenuItem, type StockMovement, type StockUnit } from '../../types';
import { ErrorNote, Motif } from '../ui';
import { ScreenHeader } from './Rail';
import { can, useWorkspace } from './workspace';

const amount = (n: number, unit: string) => `${Number(n.toFixed(3)).toLocaleString('en-IN')} ${unit}`;
const REASON_LABEL: Record<StockMovement['reason'], string> = { sale: 'Sold', void: 'Void returned', delivery: 'Delivery', count: 'Count', waste: 'Waste' };

function status(i: Ingredient) {
  const days = i.usedPerDay > 0 ? i.onHand / i.usedPerDay : null;
  if (i.onHand <= 0) return { label: 'Out', style: 'bg-[#b5402a] text-[#fff1e2]', bar: '#d9654b' };
  if (i.parLevel > 0 && i.onHand < i.parLevel * 0.5) return { label: days !== null && days < 1 ? 'Runs out today' : 'Low', style: 'bg-[#b5402a] text-[#fff1e2]', bar: '#d9654b' };
  if (i.parLevel > 0 && i.onHand < i.parLevel) return { label: 'Below par', style: 'bg-warn-bg text-warn', bar: '#e8b77d' };
  return { label: days !== null ? `~${Math.max(1, Math.round(days))} days` : 'OK', style: 'bg-ok-bg text-ok', bar: '#8dbf8f' };
}

function StockActions({ ingredient, onChanged }: { ingredient: Ingredient; onChanged: () => void }) {
  const { calls, role } = useWorkspace();
  const [kind, setKind] = React.useState<'delivery' | 'count' | 'waste'>('delivery');
  const [quantity, setQuantity] = React.useState('');
  const [cost, setCost] = React.useState('');
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const { data: history, refresh } = usePolling(() => calls.stockHistory(ingredient.id), 30_000, [calls, ingredient.id]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setDone(null);
    try {
      await calls.recordStock(ingredient.id, {
        kind, quantity: Number(quantity), unitCost: kind === 'delivery' && cost ? Number(cost) : undefined, note: note.trim() || undefined,
      });
      setDone(kind === 'delivery' ? 'Delivery recorded.' : kind === 'count' ? 'Count saved.' : 'Waste recorded.');
      setQuantity(''); setCost(''); setNote('');
      onChanged();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="eyebrow">{ingredient.category}</span>
        <h2 className="m-0 font-display text-[34px] font-medium italic leading-tight">{ingredient.name}</h2>
        <span className="text-sm text-muted">{amount(ingredient.onHand, ingredient.unit)} on hand · par {amount(ingredient.parLevel, ingredient.unit)} · {taka(ingredient.unitCost)}/{ingredient.unit}</span>
      </div>
      <div role="tablist" aria-label="Record" className="grid grid-cols-3 gap-2">
        {(['delivery', 'count', 'waste'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)}
            className={`min-h-11 cursor-pointer rounded-md text-[13px] font-semibold ${kind === k ? 'border-2 border-[#e8b77d] bg-[#261a12] text-[#e8b77d]' : 'border border-gold-line bg-surface-2 text-cream'}`}>
            {k === 'delivery' ? 'Delivery' : k === 'count' ? 'Count' : 'Waste'}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <ErrorNote message={error} />
        {done && <p role="status" className="m-0 rounded bg-ok-bg px-3 py-2 text-sm text-ok">{done}</p>}
        <label className="field">{kind === 'count' ? `Counted on the shelf (${ingredient.unit})` : `Quantity (${ingredient.unit})`}
          <input className="input" inputMode="decimal" required value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </label>
        {kind === 'delivery' && can.supervise(role) && (
          <label className="field">New price per {ingredient.unit} (৳, optional)<input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder={String(ingredient.unitCost)} /></label>
        )}
        <label className="field">{kind === 'waste' ? 'Why was it thrown away?' : 'Note (optional)'}
          <input className="input" required={kind === 'waste'} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'delivery' ? 'Invoice number' : ''} />
        </label>
        <button type="submit" className="btn btn-gold">{kind === 'delivery' ? 'Add delivery' : kind === 'count' ? 'Save count' : 'Record waste'}</button>
      </form>
      <div className="flex flex-col">
        <span className="eyebrow pb-1.5">History</span>
        {history?.length === 0 && <p className="m-0 text-sm text-muted">Nothing recorded yet.</p>}
        {history?.map((m) => (
          <div key={m.id} className="flex items-start justify-between gap-3 border-b border-gold-hair py-2 text-sm">
            <span className="flex flex-col gap-0.5">
              <span>{REASON_LABEL[m.reason]}{m.dish ? `: ${m.dish}` : ''}{m.tableLabel ? ` (${m.tableLabel})` : ''}</span>
              <span className="text-xs text-faint">{new Date(m.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}{m.recordedByName ? ` · ${m.recordedByName}` : ''}{m.note ? ` · ${m.note}` : ''}</span>
            </span>
            <span className={`font-semibold tabular-nums ${m.change < 0 ? 'text-danger' : 'text-ok'}`}>{m.change > 0 ? '+' : ''}{amount(m.change, ingredient.unit)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function IngredientForm({ ingredient, onDone }: { ingredient?: Ingredient; onDone: () => void }) {
  const { calls } = useWorkspace();
  const [form, setForm] = React.useState({
    name: ingredient?.name ?? '', category: ingredient?.category ?? '', unit: ingredient?.unit ?? 'kg' as StockUnit,
    parLevel: ingredient ? String(ingredient.parLevel) : '', unitCost: ingredient ? String(ingredient.unitCost) : '', supplier: ingredient?.supplier ?? '',
  });
  const [error, setError] = React.useState<string | null>(null);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await calls.saveIngredient({
        id: ingredient?.id, name: form.name.trim(), category: form.category.trim() || undefined, unit: form.unit,
        parLevel: Number(form.parLevel) || 0, unitCost: Number(form.unitCost) || 0, supplier: form.supplier.trim() || undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-md border border-gold-line bg-surface-2 p-4 sm:grid-cols-3">
      <div className="sm:col-span-3"><ErrorNote message={error} /></div>
      <label className="field sm:col-span-2">Ingredient<input className="input" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <label className="field">Unit
        <select className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as StockUnit })}>
          {STOCK_UNITS.map((u) => <option key={u} value={u}>{u === 'pc' ? 'pieces' : u}</option>)}
        </select>
      </label>
      <label className="field">Category<input className="input" maxLength={60} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Meat, Dairy, Dry goods…" /></label>
      <label className="field">Par level ({form.unit})<input className="input" inputMode="decimal" value={form.parLevel} onChange={(e) => setForm({ ...form, parLevel: e.target.value })} /></label>
      <label className="field">Cost per {form.unit} (৳)<input className="input" inputMode="decimal" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} /></label>
      <label className="field sm:col-span-2">Supplier<input className="input" maxLength={120} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></label>
      <div className="flex items-end justify-end gap-2"><button type="button" className="btn" onClick={onDone}>Cancel</button><button type="submit" className="btn btn-gold">Save</button></div>
    </form>
  );
}

function RecipeEditor({ dish, ingredients, onSaved }: { dish: MenuItem; ingredients: Ingredient[]; onSaved: () => void }) {
  const { calls, role } = useWorkspace();
  const [lines, setLines] = React.useState<{ ingredientId: string; quantity: string }[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const editable = can.supervise(role);

  React.useEffect(() => {
    let current = true;
    setLines(null);
    setSaved(false);
    calls.recipe(dish.id).then((r) => { if (current) setLines(r.map((l) => ({ ingredientId: l.ingredientId, quantity: String(l.quantity) }))); });
    return () => { current = false; };
  }, [calls, dish.id]);

  if (!lines) return <p className="text-muted">Loading…</p>;
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const cost = lines.reduce((n, l) => n + (Number(l.quantity) || 0) * (byId.get(l.ingredientId)?.unitCost ?? 0), 0);
  const pct = dish.price > 0 ? Math.round((cost / dish.price) * 100) : 0;
  const save = async () => {
    setError(null);
    try {
      await calls.saveRecipe(dish.id, lines.filter((l) => l.ingredientId).map((l) => ({ ingredientId: l.ingredientId, quantity: Number(l.quantity) })));
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the recipe.');
    }
  };

  return (
    <div className="relative isolate flex flex-col gap-3 overflow-hidden rounded-sm bg-raised px-6 py-7">
      <div aria-hidden="true" className="pointer-events-none absolute inset-[7px] border border-[rgb(216_179_124/0.38)]" />
      <Motif name="steam" className="pointer-events-none absolute -right-8 -top-6 -z-10 h-36 w-36 text-gold opacity-10" />
      <span className="eyebrow">Recipe · used per plate</span>
      <h2 className="m-0 font-display text-[32px] font-medium italic leading-tight">{dish.name}</h2>
      <p className="m-0 text-[13px] text-muted">When a waiter sends this dish to the kitchen, these amounts come off stock.</p>
      <ErrorNote message={error} />
      {lines.map((line, index) => {
        const ing = byId.get(line.ingredientId);
        return (
          <div key={index} className="flex items-end gap-2 border-b border-gold-hair pb-2.5">
            <label className="field flex-1"><span className="sr-only">Ingredient</span>
              <select className="input" disabled={!editable} value={line.ingredientId} onChange={(e) => setLines(lines.map((l, i) => i === index ? { ...l, ingredientId: e.target.value } : l))}>
                <option value="">Choose…</option>
                {ingredients.filter((i) => i.active || i.id === line.ingredientId).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </label>
            <label className="field w-[84px] flex-none"><span className="sr-only">Amount</span>
              <input className="input" inputMode="decimal" disabled={!editable} value={line.quantity} onChange={(e) => setLines(lines.map((l, i) => i === index ? { ...l, quantity: e.target.value } : l))} />
            </label>
            <span className="w-8 pb-3 text-sm text-muted">{ing?.unit ?? ''}</span>
            {editable && <button type="button" aria-label="Remove ingredient" className="min-h-11 cursor-pointer border-0 bg-transparent px-1 text-lg text-danger" onClick={() => setLines(lines.filter((_, i) => i !== index))}>×</button>}
          </div>
        );
      })}
      {editable && <button type="button" className="w-fit cursor-pointer border-0 bg-transparent p-0 text-sm font-semibold text-[#e8b77d]" onClick={() => setLines([...lines, { ingredientId: '', quantity: '' }])}>+ Add ingredient</button>}
      <div className="flex items-baseline justify-between pt-1">
        <span className="text-sm text-muted">Food cost / plate</span>
        <span className="text-xl font-semibold text-[#e8b77d]">{taka(Math.round(cost * 100) / 100)} <span className={`text-[13px] font-medium ${pct > 40 ? 'text-warn' : 'text-muted'}`}>· {pct}% of {taka(dish.price)}</span></span>
      </div>
      {editable && (
        <div className="flex items-center justify-end gap-3">
          {saved && <span role="status" className="text-sm text-ok">Saved</span>}
          <button type="button" className="btn btn-gold" onClick={() => void save()}>Save recipe</button>
        </div>
      )}
    </div>
  );
}

export function StockScreen() {
  const { calls, role } = useWorkspace();
  const { data: ingredients, error, refresh } = usePolling(() => calls.ingredients(), 30_000, [calls]);
  const { data: menu, refresh: refreshMenu } = usePolling(() => calls.menu(), 60_000, [calls]);
  const [tab, setTab] = React.useState<'ingredients' | 'recipes'>('ingredients');
  const [filter, setFilter] = React.useState('all');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [dishId, setDishId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Ingredient | 'new' | null>(null);

  const list = (ingredients ?? []).filter((i) => i.active);
  const low = list.filter((i) => i.parLevel > 0 && i.onHand < i.parLevel);
  const value = list.reduce((n, i) => n + Math.max(0, i.onHand) * i.unitCost, 0);
  const usedToday = list.reduce((n, i) => n + i.usedToday * i.unitCost, 0);
  const categories = [...new Set(list.map((i) => i.category))];
  const shown = list.filter((i) => filter === 'all' || (filter === 'low' ? low.includes(i) : i.category === filter));
  const selected = list.find((i) => i.id === selectedId) ?? null;
  const dishes = (menu ?? []).flatMap((c) => c.items);
  const dish = dishes.find((d) => d.id === dishId) ?? null;
  const reload = () => { void refresh(); void refreshMenu(); };

  return (
    <div className="flex min-h-screen min-w-0 flex-1 flex-wrap">
      <main className="flex min-w-0 flex-[999_1_620px] flex-col gap-5 px-6 py-6 sm:px-8">
        <ScreenHeader title={<>Stock <Motif name="cardamom" className="h-8 w-8 text-gold-soft opacity-70" /></>}>
          <div role="tablist" aria-label="Stock view" className="flex gap-2">
            {(['ingredients', 'recipes'] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={`min-h-11 cursor-pointer rounded-full border px-5 text-[13px] font-medium capitalize ${tab === t ? 'border-[#efe4d2] bg-[#efe4d2] text-[#1a0f08]' : 'border-gold-line bg-surface-2 text-muted'}`}>{t}</button>
            ))}
          </div>
        </ScreenHeader>
        <ErrorNote message={error} />

        {tab === 'ingredients' ? (
          <>
            {low.length > 0 && (
              <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-[#8a3a26] bg-danger-bg px-4 py-3">
                <span className="h-2.5 w-2.5 flex-none rounded-full bg-[#f2a08c]" />
                <span className="text-sm"><span className="font-bold">{low.length} {low.length === 1 ? 'ingredient is' : 'ingredients are'} below par:</span> {low.map((i) => i.name).join(', ')}.</span>
              </div>
            )}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
              {[['Stock value on hand', taka(Math.round(value))], ['Below par', `${low.length} of ${list.length}`], ['Used today', taka(Math.round(usedToday))]].map(([k, v]) => (
                <div key={k} className="panel flex flex-col gap-2 p-4"><span className="text-[13px] text-muted">{k}</span><span className="text-2xl font-semibold">{v}</span></div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div role="tablist" aria-label="Filter ingredients" className="flex flex-wrap gap-2">
                {[['all', `All (${list.length})`], ['low', `Below par (${low.length})`], ...categories.map((c) => [c, c])].map(([k, label]) => (
                  <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
                    className={`min-h-10 cursor-pointer rounded-full border px-4 text-[13px] font-medium ${filter === k ? 'border-[#efe4d2] bg-[#efe4d2] text-[#1a0f08]' : 'border-gold-line bg-surface-2 text-muted'}`}>{label}</button>
                ))}
              </div>
              {can.supervise(role) && <button type="button" className="btn" onClick={() => setEditing('new')}>Add ingredient</button>}
            </div>
            {editing && <IngredientForm ingredient={editing === 'new' ? undefined : editing} onDone={() => { setEditing(null); reload(); }} />}
            {ingredients && list.length === 0 && <p className="m-0 text-muted">No ingredients yet. Add what the kitchen buys, then give each dish a recipe.</p>}
            <div className="overflow-x-auto rounded-md border border-gold-line bg-surface">
              <table className="w-full min-w-[680px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-gold-soft">
                    {['Ingredient', 'On hand vs par', 'Cost', 'Used / day', 'Status'].map((h) => <th key={h} className="border-b border-gold-line px-4 py-3 font-semibold">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((i) => {
                    const s = status(i);
                    const ratio = i.parLevel > 0 ? Math.max(0, Math.min(1, i.onHand / i.parLevel)) : 1;
                    return (
                      <tr key={i.id} onClick={() => setSelectedId(i.id)} className={`cursor-pointer border-b border-gold-hair ${i.id === selectedId ? 'bg-[#261a12]' : 'hover:bg-surface-2'}`}>
                        <td className="px-4 py-3"><button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-left text-cream" onClick={() => setSelectedId(i.id)}>
                          <span className="block font-semibold">{i.name}</span><span className="text-xs text-faint">{i.category}{i.supplier ? ` · ${i.supplier}` : ''}</span></button></td>
                        <td className="px-4 py-3"><div className="flex items-center gap-2.5">
                          <div className="h-2 w-24 overflow-hidden rounded bg-[#2e2118]"><div className="h-full" style={{ width: `${Math.round(ratio * 100)}%`, background: s.bar }} /></div>
                          <span className="font-semibold">{amount(i.onHand, i.unit)}</span><span className="text-faint">/ {amount(i.parLevel, i.unit)}</span></div></td>
                        <td className="px-4 py-3">{taka(i.unitCost)}/{i.unit}</td>
                        <td className="px-4 py-3">{i.usedPerDay > 0 ? amount(i.usedPerDay, i.unit) : '—'}</td>
                        <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${s.style}`}>{s.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <p className="m-0 text-sm text-muted">Give each dish a recipe so stock comes off as it sells, and see what each plate costs you.</p>
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5 p-0">
              {dishes.map((d) => (
                <li key={d.id}>
                  <button type="button" onClick={() => setDishId(d.id)} aria-pressed={d.id === dishId}
                    className={`flex w-full cursor-pointer flex-col gap-1.5 rounded-md border p-3.5 text-left text-cream ${d.id === dishId ? 'border-[#e8b77d] bg-[#261a12]' : 'border-gold-line bg-surface-2'}`}>
                    <span className="font-display text-xl font-medium">{d.name}</span>
                    <span className="text-xs text-muted">
                      {d.foodCost === null ? 'No recipe yet' : `Food cost ${taka(d.foodCost)} · ${Math.round((d.foodCost / d.price) * 100)}%`}
                      {d.portionsLeft !== null && ` · ${d.portionsLeft} left`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
      <aside className="relative isolate flex w-full flex-col gap-4 overflow-hidden border-l border-gold-hair bg-surface px-6 py-7 lg:w-[360px] lg:flex-none">
        <div aria-hidden="true" className="kantha absolute inset-x-0 top-0 -z-10" />
        <div className="pt-3">
          {tab === 'ingredients' ? (
            selected ? (
              <>
                <StockActions key={selected.id} ingredient={selected} onChanged={reload} />
                {can.supervise(role) && <button type="button" className="btn mt-4 w-full" onClick={() => setEditing(selected)}>Edit ingredient</button>}
              </>
            ) : <p className="m-0 text-muted">Choose an ingredient to record a delivery, a count or waste, and to see its history.</p>
          ) : dish && ingredients ? (
            <RecipeEditor key={dish.id} dish={dish} ingredients={ingredients} onSaved={reload} />
          ) : <p className="m-0 text-muted">Choose a dish to set its recipe.</p>}
        </div>
      </aside>
    </div>
  );
}
