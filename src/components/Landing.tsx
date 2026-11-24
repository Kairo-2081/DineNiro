import React from 'react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { ApplyForm } from './ApplyForm';
import { ErrorNote, Motif, TopBar } from './ui';
import { BrandSeal } from './brand';

function SignInForm({ onApply }: { onApply: () => void }) {
  const { setSession } = useAuth();
  const [identifier, setIdentifier] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSession(await api.login(identifier.trim(), password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="panel relative isolate flex flex-col gap-5 overflow-hidden p-8" aria-labelledby="signin-title">
      <Motif name="anise" className="pointer-events-none absolute -right-10 -top-10 -z-10 h-44 w-44 text-gold opacity-10" />
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Staff &amp; owners</span>
        <h2 id="signin-title" className="m-0 font-display text-4xl font-medium italic">Sign in</h2>
      </div>
      <ErrorNote message={error} />
      <label className="field">
        Email or username
        <input className="input" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
      </label>
      <label className="field">
        Password
        <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <button type="submit" className="btn btn-gold min-h-[52px]" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <p className="m-0 text-center text-sm text-muted">
        Running a restaurant?{' '}
        <button type="button" onClick={onApply} className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-[#e8b77d] underline-offset-4 hover:underline">
          Apply to join DineNiro
        </button>
      </p>
    </form>
  );
}

export function Landing() {
  const [applying, setApplying] = React.useState(false);

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="relative isolate mx-auto max-w-[1320px] overflow-hidden px-6 py-12 sm:px-8 lg:py-20">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: 'radial-gradient(ellipse 50% 60% at 25% 35%, #2e1d12 0%, transparent 70%)' }} />
        {applying ? (
          <ApplyForm onCancel={() => setApplying(false)} />
        ) : (
          <div className="grid items-center gap-12 lg:grid-cols-[1.2fr_1fr]">
            <section className="relative flex flex-col gap-6">
              <Motif name="thali" className="pointer-events-none absolute -left-24 -top-24 -z-10 h-[420px] w-[420px] text-gold opacity-[0.07]" />
              <BrandSeal size={168} animate className="mb-2" />
              <span className="eyebrow">Restaurant operations</span>
              <h1 className="m-0 font-display text-6xl font-medium leading-[0.95] sm:text-7xl">
                Run the floor, <span className="gold-text italic">the kitchen</span> and the bill from one place.
              </h1>
              <p className="m-0 max-w-[52ch] text-lg leading-relaxed text-muted">
                DineNiro gives each restaurant its own workspace: the floor plan, orders, the kitchen display, billing,
                reservations, stock and reports, with a role for everyone on your team.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <button type="button" className="btn btn-gold min-h-[52px]" onClick={() => setApplying(true)}>Apply for your restaurant</button>
              </div>
              <div className="mt-6 grid max-w-xl grid-cols-3 gap-px overflow-hidden rounded-md border border-gold-line bg-gold-line text-sm">
                {[['Floor', 'Tables & orders'], ['Kitchen', 'Live tickets'], ['Office', 'Stock & reports']].map(([title, text]) => (
                  <div key={title} className="flex flex-col gap-1.5 bg-surface p-4">
                    <span className="font-display text-xl italic">{title}</span>
                    <span className="text-faint">{text}</span>
                  </div>
                ))}
              </div>
            </section>
            <div className="order-first lg:order-none"><SignInForm onApply={() => setApplying(true)} /></div>
          </div>
        )}
      </main>
    </div>
  );
}
