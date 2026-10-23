import type { Product } from "@meridian/taxonomy";

const DIALS: Record<string, { face: string; ring: string; text: string }> = {
  blue: { face: "#0f3b66", ring: "#0b2a4a", text: "#e2e8f0" },
  black: { face: "#111827", ring: "#030712", text: "#e5e7eb" },
  green: { face: "#14532d", ring: "#052e16", text: "#dcfce7" },
  white: { face: "#f8fafc", ring: "#cbd5e1", text: "#334155" },
  grey: { face: "#64748b", ring: "#334155", text: "#f8fafc" },
  brown: { face: "#6b4423", ring: "#3f2a16", text: "#fef3c7" },
  silver: { face: "#dbe3ea", ring: "#94a3b8", text: "#334155" },
  champagne: { face: "#e8d8a8", ring: "#b99a55", text: "#4a3a16" },
  orange: { face: "#c2410c", ring: "#7c2d12", text: "#ffedd5" }
};

const STRAPS: Record<string, { main: string; edge: string; stitch: string }> = {
  steel: { main: "#9aa6b2", edge: "#5f6b78", stitch: "#d7dee6" },
  titanium: { main: "#8a949c", edge: "#565f66", stitch: "#cfd6db" },
  leather: { main: "#5a3823", edge: "#2f1d12", stitch: "#c8a97d" },
  rubber: { main: "#26313c", edge: "#111820", stitch: "#4b5a68" },
  mesh: { main: "#aeb8c2", edge: "#6b747d", stitch: "#e2e8f0" },
  fabric: { main: "#4b5d46", edge: "#2d3a2a", stitch: "#b9c6b2" }
};

export function WatchSVG({ product, size = 360 }: { product: Product; size?: number }) {
  const dial = DIALS[product.attributes.dial] ?? DIALS.black!;
  const strap = STRAPS[product.attributes.strap] ?? STRAPS.steel!;
  return (
    <svg
      width={size}
      height={size * 1.32}
      viewBox="0 0 320 422"
      role="img"
      aria-label={`Illustration of ${product.description}`}
      className="watch-svg"
    >
      <defs>
        <linearGradient id={`case-${product.id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f1f5f9" />
          <stop offset="45%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#475569" />
        </linearGradient>
        <linearGradient id={`glass-${product.id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.32" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0.02" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.18" />
        </linearGradient>
      </defs>
      <rect x="112" y="4" width="96" height="116" rx="26" fill={strap.main} />
      <rect x="112" y="4" width="96" height="116" rx="26" fill="none" stroke={strap.edge} strokeWidth="3" />
      {[24, 44, 64, 84].map((y) => (
        <line key={`t-${y}`} x1="132" y1={y} x2="188" y2={y} stroke={strap.stitch} strokeWidth="1.4" strokeDasharray="3 5" />
      ))}
      <rect x="112" y="302" width="96" height="116" rx="26" fill={strap.main} />
      <rect x="112" y="302" width="96" height="116" rx="26" fill="none" stroke={strap.edge} strokeWidth="3" />
      {[322, 342, 362, 382].map((y) => (
        <line key={`b-${y}`} x1="132" y1={y} x2="188" y2={y} stroke={strap.stitch} strokeWidth="1.4" strokeDasharray="3 5" />
      ))}
      <rect x="76" y="118" width="18" height="36" rx="5" fill={strap.edge} />
      <rect x="226" y="118" width="18" height="36" rx="5" fill={strap.edge} />
      <circle cx="160" cy="211" r="112" fill={`url(#case-${product.id})`} />
      <circle cx="160" cy="211" r="108" fill="#0f172a" />
      <circle cx="160" cy="211" r="96" fill={`url(#glass-${product.id})`} />
      <circle cx="160" cy="211" r="96" fill={dial.face} />
      <circle cx="160" cy="211" r="99" fill="none" stroke={dial.ring} strokeWidth="6" />
      <circle cx="160" cy="211" r="88" fill="none" stroke={dial.text} strokeOpacity="0.2" strokeWidth="1.2" />
      {Array.from({ length: 12 }, (_, i) => {
        const angle = (i * 30 * Math.PI) / 180;
        const inner = 78;
        const outer = i % 3 === 0 ? 88 : 84;
        return (
          <line
            key={i}
            x1={160 + Math.sin(angle) * inner}
            y1={211 - Math.cos(angle) * inner}
            x2={160 + Math.sin(angle) * outer}
            y2={211 - Math.cos(angle) * outer}
            stroke={dial.text}
            strokeWidth={i % 3 === 0 ? 4 : 2}
            strokeLinecap="round"
            opacity="0.9"
          />
        );
      })}
      <text x="160" y="170" textAnchor="middle" fill={dial.text} fontSize="13" letterSpacing="3" opacity="0.8">
        MERIDIAN
      </text>
      <text x="160" y="257" textAnchor="middle" fill={dial.text} fontSize="8" letterSpacing="1.5" opacity="0.65">
        AUTOMATIC · 300 M
      </text>
      <line x1="160" y1="211" x2="160" y2="160" stroke={dial.text} strokeWidth="4" strokeLinecap="round" />
      <line x1="160" y1="211" x2="196" y2="230" stroke={dial.text} strokeWidth="3" strokeLinecap="round" />
      <line x1="160" y1="211" x2="140" y2="246" stroke="#b91c1c" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="160" cy="211" r="5" fill={dial.text} />
      <rect x="270" y="200" width="10" height="24" rx="3" fill="#94a3b8" stroke="#475569" strokeWidth="1.5" />
      <text x="160" y="414" textAnchor="middle" fill="#64748b" fontSize="10" letterSpacing="1">
        {product.attributes.caseSize} MM · {product.attributes.strap.toUpperCase()} · {product.attributes.movement.toUpperCase()}
      </text>
    </svg>
  );
}
