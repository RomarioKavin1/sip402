# DESIGN.md — sip402

Aesthetic: **warm-ink ledger**. Deep warm-dark, one committed amber accent, mono earned for data. Color strategy: **Committed** (amber carries identity). Avoid: crypto-neon, terminal-green, editorial-serif, SaaS hero-metric template, all shared absolute bans (no side-stripe borders, no gradient text, no glassmorphism-by-default, no identical card grids).

## Color (OKLCH — never #000/#fff, every neutral tinted warm)

```
--ink:        oklch(0.15 0.012 65);   /* page bg — warm near-black */
--ink-2:      oklch(0.185 0.013 65);  /* raised surface / panels */
--ink-3:      oklch(0.225 0.014 64);  /* hover / inset */
--line:       oklch(0.30 0.014 64);   /* hairline borders (full borders only) */
--line-soft:  oklch(0.26 0.012 64);
--text:       oklch(0.94 0.012 78);   /* primary text, warm off-white */
--text-dim:   oklch(0.72 0.016 72);   /* secondary */
--text-faint: oklch(0.55 0.014 70);   /* tertiary / metadata */

--amber:      oklch(0.82 0.155 78);   /* THE accent: ticker, CTA, money, active */
--amber-deep: oklch(0.70 0.15 70);    /* amber pressed / on-amber-bg text base */
--amber-glow: oklch(0.82 0.155 78 / 0.14); /* faint amber wash, used sparingly */

--revert:     oklch(0.64 0.17 33);    /* THE chain says no — cap revert / danger only */
--confirmed:  oklch(0.74 0.10 150);   /* small "confirmed on-chain" check only */
```

Usage: amber for the live ticker, the primary CTA, active grant state, the "spend" beat. Revert (terracotta) ONLY for the dry-tab cap-exceeded moment and destructive (revoke). Confirmed-green only as a tiny receipt checkmark. Everything else is warm neutral. Do not scatter color.

## Type
- **Display + body:** `Hanken Grotesk` (Google Fonts). Weights 400/500/600/800. Tight tracking on big headings (-0.02em to -0.03em). Hero headline huge via `clamp()`.
- **Data / numbers / addresses / ticker:** `JetBrains Mono` (Google Fonts), 400/500/700. The ticker is mono, tabular-nums, large.
- Brand (hero/docs) headings use fluid `clamp()`. Product (dashboard) uses a fixed rem scale.
- Body line length 65–75ch. Light-on-dark: +0.06 line-height.

## Layout
- Hero: left-aligned, asymmetric, long-scroll with deliberate pacing. NOT a centered icon-title-subtitle stack. One dominant idea per fold.
- Dashboard: predictable product grid; clear 3-beat structure (Grant / Spend / Enforce) so the flow reads top-to-bottom.
- Generous, varied spacing (`clamp()` on brand). Cards only where they're the right affordance; never nested. Most sections need no container.
- Hairlines are full 1px borders in `--line`, never side-stripes.

## Motion
- Brand: one tasteful staggered hero reveal (ease-out-expo, ~600ms). Restrained.
- Dashboard: 150–250ms, state-conveying only. The **ticker counts up** on each draw (animate the number, not layout). The cap-revert flashes the revert color once. No decorative motion.

## Components
- **Ticker:** the centerpiece. Large mono tabular-nums amber number that animates upward per draw; a thin progress rail toward the cap. On revert, a single terracotta pulse + "cap reached on-chain" line.
- **Receipt row:** mono, time · agent · $amount · tx↗ (Basescan). Subtle confirmed check. Dense, ledger-like.
- **Step markers:** Grant / Spend / Enforce as a clear 3-beat spine the dashboard follows.
- **Buttons:** amber solid for primary (Grant / Run); ghost hairline for secondary; revert-tinted ghost for Revoke. Full set of states (hover/focus/active/disabled/loading).
- **Proof links:** mono Basescan/npm links with a small ↗.

## Voice / copy
No em dashes. No restated headings. Short, frank, metered. Numbers do the talking.
