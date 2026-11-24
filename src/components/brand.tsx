import React from 'react';

/*
 * DineNiro's logo: a fork and spoon crossed in brass, alone on a disc (the mark)
 * or with the name and tagline inside a double ring (the seal).
 * Below about 64 px use the mark; the seal's tagline stops being readable.
 */

const FORK = 'M-3.5 -17.6V-26.4a.55 .55 0 0 1 1.1 0V-19.2H-1.53V-26.4a.55 .55 0 0 1 1.1 0V-19.2H.43V-26.4a.55 .55 0 0 1 1.1 0V-19.2H2.4V-26.4a.55 .55 0 0 1 1.1 0V-17.6C3.5 -13.5 1.2 -11 .8 -8.5V10C.8 14 1.9 17 1.9 21.5C1.9 24.5 1.1 26 0 26C-1.1 26-1.9 24.5-1.9 21.5C-1.9 17-.8 14-.8 10V-8.5C-1.2 -11-3.5 -13.5-3.5 -17.6Z';
const SPOON = 'M-.7 -13C-.8 -10-.8 -9-.8 -6V10C-.8 14-1.9 17-1.9 21.5C-1.9 24.5-1.1 26 0 26C1.1 26 1.9 24.5 1.9 21.5C1.9 17 .8 14 .8 10V-6C.8 -9 .8 -10 .7 -13Z';

const BRASS = ['#f6e2b6', '#d8b37c', '#8f6a35'];
const INK = '#0b0705';

function useGradientId() {
  return `dn${React.useId().replace(/[^a-zA-Z0-9]/g, '')}`;
}

function Brass({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor={BRASS[0]} />
      <stop offset="0.5" stopColor={BRASS[1]} />
      <stop offset="1" stopColor={BRASS[2]} />
    </linearGradient>
  );
}

/** The fork and spoon, crossed at the origin. The spoon is outlined in the background colour so the two read apart. */
function Cutlery({ fill, background, forkClass, spoonClass, transform }: {
  fill: string; background: string; forkClass?: string; spoonClass?: string; transform?: [string, string];
}) {
  return (
    <>
      <g className={forkClass} transform={transform?.[0]} fill={fill}><path d={FORK} /></g>
      <g className={spoonClass} transform={transform?.[1]} fill={fill} stroke={background} strokeWidth={1.1} paintOrder="stroke" strokeLinejoin="round">
        <ellipse cx="0" cy="-19.6" rx="4.3" ry="7.1" />
        <path d={SPOON} />
      </g>
    </>
  );
}

/**
 * The mark on its own: for the browser tab, sidebar, headers and anywhere under 64 px.
 * `tone="mono"` is black on white, for thermal receipts.
 */
export function BrandMark({ size = 40, tone = 'brass', title, className }: {
  size?: number; tone?: 'brass' | 'mono'; title?: string; className?: string;
}) {
  const id = useGradientId();
  const mono = tone === 'mono';
  const background = mono ? '#000' : INK;
  const fill = mono ? '#fff' : `url(#${id})`;
  // Small sizes get slightly larger cutlery so the prongs don't vanish.
  const scale = size <= 32 ? 1 : 0.86;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className}
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {!mono && <defs><Brass id={id} /></defs>}
      <circle cx="32" cy="32" r="31" fill={background} />
      {/* On the app's near-black screens the disc needs an edge to read as a disc. */}
      {!mono && size >= 28 && <circle cx="32" cy="32" r="30" fill="none" stroke={fill} strokeWidth={size >= 48 ? 1 : 1.6} opacity="0.75" />}
      <Cutlery fill={fill} background={background}
        transform={[`translate(32 32.4) rotate(-22) scale(${scale})`, `translate(32 32.4) rotate(22) scale(${scale})`]} />
    </svg>
  );
}

/**
 * The full round logo. With `animate`, the fork and spoon swing shut, then the name,
 * rule and tagline come in. It plays once, and not at all for people who reduce motion.
 */
export function BrandSeal({ size = 240, animate = false, className }: { size?: number; animate?: boolean; className?: string }) {
  const id = useGradientId();
  const fill = `url(#${id})`;
  return (
    <svg width={size} height={size} viewBox="0 0 400 400" role="img" aria-label="DineNiro, from the floor to the bill"
      className={`dn-seal${animate ? ' is-animated' : ''}${className ? ` ${className}` : ''}`}>
      <defs><Brass id={id} /></defs>
      <circle cx="200" cy="200" r="198" fill={INK} />
      <circle cx="200" cy="200" r="186" fill="none" stroke={fill} strokeWidth="2.4" />
      <circle cx="200" cy="200" r="178" fill="none" stroke={fill} strokeWidth="0.8" opacity="0.6" />
      <Cutlery fill={fill} background={INK} forkClass="dn-fork" spoonClass="dn-spoon" />
      <text className="dn-name" x="200" y="246" textAnchor="middle" fontFamily="'Cormorant Garamond', serif" fontWeight="600" fontSize="66" fill="#f4e9da">
        Dine<tspan fontStyle="italic" fontWeight="500" fill="#d8b37c">Niro</tspan>
      </text>
      {/* Solid colour: a gradient sized to its own box can't paint a line with no height. */}
      <path className="dn-rule" d="M158 268h84" stroke="#d8b37c" strokeWidth="1.2" />
      <text className="dn-tag" x="201.2" y="298" textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="600" fontSize="13" letterSpacing="2.4" fill="#d8b37c">
        FROM THE FLOOR TO THE BILL
      </text>
    </svg>
  );
}

/** Mark and name side by side, for top bars. */
export function BrandLockup({ size = 38 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-3">
      <BrandMark size={size} />
      <span className="font-display font-semibold leading-none text-cream" style={{ fontSize: size * 0.8 }}>
        Dine<span className="font-medium italic text-gold">Niro</span>
      </span>
    </span>
  );
}
