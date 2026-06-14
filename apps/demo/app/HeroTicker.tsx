"use client";

import { useEffect, useRef, useState } from "react";

// Decorative live-feel ticker for the hero. Counts small USDC "sips" upward
// toward a soft cap, then holds. Purely visual; mirrors the dashboard motif.
const CAP = 1.0;

export default function HeroTicker() {
  const [value, setValue] = useState(0);
  const ref = useRef(0);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const m = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (m.matches) {
        setValue(0.847291);
        return;
      }
    }
    const id = setInterval(() => {
      if (ref.current >= CAP) {
        ref.current = 0; // loop the tab
      } else {
        // variable-cost sips, like real per-token draws
        ref.current = Math.min(CAP, ref.current + Math.random() * 0.045 + 0.005);
      }
      setValue(ref.current);
    }, 700);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="font-mono text-2xl font-bold tabular-nums text-amber sm:text-3xl">
      ${value.toFixed(6)}
    </span>
  );
}
