import React from 'react';

/** ৳1,501.50 for amounts with paisa, ৳1,500 for whole taka. Uses the South Asian grouping (1,00,000). */
export function taka(amount: number) {
  const whole = Number.isInteger(amount);
  return `৳${amount.toLocaleString('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function minutesSince(iso: string | null, now = Date.now()) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

export function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * Loads data now and again every `intervalMs` while the tab is visible, so screens shared by
 * the floor and the kitchen stay current without a manual refresh.
 */
export function usePolling<T>(load: () => Promise<T>, intervalMs: number, deps: React.DependencyList) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const loadRef = React.useRef(load);
  loadRef.current = load;

  const refresh = React.useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load.');
    }
  }, []);

  React.useEffect(() => {
    setData(null);
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, refresh, setData };
}

/** Re-renders every `ms` so timers on screen keep counting between fetches. */
export function useNow(ms = 15_000) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return now;
}
