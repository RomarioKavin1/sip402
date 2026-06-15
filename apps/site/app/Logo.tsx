// Logo.tsx — the sip402 brand mark + wordmark.
// Mark: a cobalt app-icon tile with a white "sip" droplet and a payment slot
// (a nod to x402 "Payment Required"). Wordmark: "sip" in ink, "402" in cobalt.
// Both scale cleanly; `size` controls the mark's square px.

export function Mark({ size = 28 }: { size?: number; rounded?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="m-tile" gradientUnits="userSpaceOnUse" x1="256" y1="0" x2="256" y2="512">
          <stop stopColor="#2B82FF" />
          <stop offset="1" stopColor="#0050CC" />
        </linearGradient>
        <radialGradient id="m-sheen" gradientUnits="userSpaceOnUse" cx="256" cy="92" r="320">
          <stop stopColor="#FFFFFF" stopOpacity="0.22" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="m-drop" gradientUnits="userSpaceOnUse" x1="256" y1="120" x2="256" y2="420">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#EAF2FF" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill="url(#m-tile)" />
      <rect width="512" height="512" rx="116" fill="url(#m-sheen)" />
      <path
        d="M256 116 C 308 196 350 252 350 316 a 94 94 0 1 1 -188 0 C 162 252 204 196 256 116 Z"
        fill="url(#m-drop)"
      />
      <rect x="194" y="346" width="124" height="24" rx="12" fill="url(#m-tile)" />
      <ellipse cx="224" cy="226" rx="16" ry="30" fill="#FFFFFF" fillOpacity="0.55" transform="rotate(-20 224 226)" />
    </svg>
  );
}

export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Mark size={size} />
      <span
        className="font-bold tracking-tight text-ink"
        style={{ fontSize: size * 0.66, letterSpacing: "-0.02em" }}
      >
        sip<span className="text-primary">402</span>
      </span>
    </span>
  );
}
