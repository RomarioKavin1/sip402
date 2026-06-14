# DESIGN.md — sip402 (Meta commerce language)

Confident hardware-merchandiser surfaces: stark white canvas, tight typographic hierarchy, big soft-rounded cards. A two-tier CTA system — **black** pill primaries on marketing surfaces, **cobalt** pill primaries inside the buy-now / demo flow — paired with a ghost-outline secondary. Optimistic VF (substituted by **Inter** with `ss01`+`ss02`) carries everything. Flat by default; subtle shadows are a commerce-flow signal only.

## Colors
### Brand & accent
- `--primary` **cobalt #0064e0** — the buy-now CTA color. ONLY inside the demo's action flow + commerce panels, never on marketing. `--primary-deep` #0143b5 (pressed / active link). `--primary-subdued` #e7f0ff (soft cobalt callout tint).
- `--ink-button` **#16181d** — the BLACK marketing-surface primary CTA. `--on-primary` #ffffff (text on cobalt/black pills).
- `--accent-oculus` #7c3aed (rare VR-category accent). Otherwise the brand is monochrome outside product imagery.

### Surface
- `--canvas` #ffffff (page + card surface) · `--canvas-soft` #f0f2f5 (soft-cloud: thumbnails, search-pill, tracks) · `--canvas-card` #ffffff.
- `--hairline` #d2d6dc (input borders) · `--hairline-soft` #e4e6eb (card/footer/section dividers).

### Text (on white)
- `--ink` **#0a1417** deep-ink — headlines + primary body. `--ink-secondary` #3b4248 (charcoal). `--ink-mute` #6b7280 (steel/slate: section labels, captions). `--body` #1c2b33.

### Semantic
- `--success` #16a34a (in-stock/affirm) · `--warning` #f5c33b (promo banners/limited-time, text on it is ink) · `--attention` #f59e0b · `--critical` #e02e2e (errors, the demo's cap-revert / dry-tab signal).

## Typography
**Inter** (Optimistic VF substitute), `ss01`+`ss02` on every heading. Weights: **500** display/headings, **300** editorial subheads, **400** body, **700** buttons/labels/emphasis. Negative tracking on body (-0.01em).

| token | size | weight | line-height | feat | use |
|---|---|---|---|---|---|
| display-xxl | 64 | 500 | 1.15 | ss01,ss02 | hero |
| display-xl | 48 | 500 | 1.17 | ss | section opener |
| display-lg | 36 | 500 | 1.25 | ss | subsection headline |
| display-md | 28 | 500 | 1.21 | ss | compact title |
| heading-lg | 24 | 500 | 1.25 | ss | card title |
| subtitle-lg | 18 | 700 | 1.44 | — | bold callout / FAQ q |
| body-md | 16 | 400 | 1.5 | — | body |
| body-sm | 14 | 400 | 1.43 | — | secondary/helper |
| label | 12–13 | 700 | 1.33 | — | UPPERCASE section label / badge / button |

## Layout
4px base; 8px dominant. Marketing sections ~80px apart, product/demo ~64px, tight groups 32px. Card padding 32px (24px on icon tiles). Container ~1200–1280px. Whitespace is photography-first; copy gets oxygen.

## Elevation
Predominantly flat. L0 = hairline-soft border, no shadow (all marketing cards). L1 = `0 1px 4px rgba(20,22,26,0.12)` — commerce/sticky panels ONLY (the demo's action + summary cards). Shadows signal "checkout," not marketing.

## Shapes
Radius: 8px inputs/option cards · 16px feature/FAQ cards · 24px warranty/ghost tiles · **32px** photographic feature cards + big promo strips · **9999px (full) every button, pill tab, badge, chip** (buttons are NEVER squared) · 50% swatches/icon buttons.

## Components
- **button-primary (marketing):** black pill — `--ink-button` bg, white text, 14px/700, padding 14px 30px, radius full.
- **button-buy (commerce/demo):** cobalt pill — `--primary` bg, white text, same shape. ONLY in the demo's action flow.
- **button-secondary (ghost):** transparent, `--ink` text, 2px `--ink` border, radius full.
- **promo-banner:** full-width strip ABOVE the nav — `--ink` (dark) or `--warning` (yellow) bg, one-line offer + inline link, 14px/700.
- **pill-tab nav:** inactive = white, `--ink` text, 1px `--hairline` border; active = `--ink` fill, white text, no border.
- **card-product-feature:** white, 32px radius, 32px padding, 1px `--hairline-soft` border, no shadow.
- **card-promo-strip:** `--ink` dark fill, white text, 32px radius — for code/console/dark callouts.
- **card-icon-feature:** white, 16px radius, 24px padding, hairline-soft border.
- **card-checkout-summary (commerce):** white, 16px radius, hairline-soft border, L1 shadow.
- **input:** white, 1px `--hairline`, 8px radius, 44px tall; focus → 2px cobalt; error → `--critical`.
- **badge:** full-radius pill, 12px/700; promo=warning/ink, success/critical=fill+white.
- **footer:** white, hairline-soft top border, dense columns, `--ink-mute` links.

## sip402-specific
- **Marketing (`/`, `/docs`):** white canvas, big weight-500 `ss01/ss02` display, 300-weight editorial subheads, **black** pill + ghost CTAs, 32px white feature cards with hairline borders, dark promo-strip cards for code. A thin promo banner above the nav for the on-chain-evidence line.
- **Demo (`/dashboard`) = the buy-now flow:** **cobalt** pill for the single primary action (Connect/Open/Run); white checkout-summary cards with the subtle L1 shadow; the ticker is large weight-500; the cap rail fills cobalt on a `--canvas-soft` track; cap-revert / dry-tab uses `--critical`; the streaming console is a dark `--ink` promo-strip card with white text.

## Do / Don't
DO: cobalt ONLY for the demo/buy CTA (scarce = meaningful); black `--ink-button` for marketing primaries + ghost secondary; full-radius on every button/pill/badge; 32px on photo cards, 16px on icon tiles; `ss01`+`ss02` together on every heading; 300-weight editorial subheads for rhythm.
DON'T: use cobalt for marketing primaries; add accent colors beyond cobalt (+ rare oculus purple); square any pill; ship feature cards without rounding; heavy shadows on marketing (elevation is a commerce signal); em dashes.
