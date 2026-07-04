# Design System - Markonverter for Ozon

## Product Context

- **What this is:** A Chrome/Chromium extension that compares Ozon product prices across saved pickup points.
- **Where it appears:** Inside Ozon product pages, Ozon delivery selectors, and the extension options page.
- **User mindset:** The user is shopping or debugging pickup-point prices. The UI must feel like a compact Ozon tool, not a separate dashboard.
- **Design source:** Derived from Ozon BrandLab and current Ozon product UI patterns. Ozon's official brand colors are Ozon blue `#005BFF` and Ozon magenta `#F1117E`.

## Design Direction

- **Aesthetic:** Clean Ozon-adjacent ecommerce utility.
- **Mood:** Light, compact, direct, trustworthy.
- **Density:** High enough to fit inside Ozon's price column, but not cramped.
- **Do not use:** Dark industrial surfaces, amber accents, terminal styling, decorative gradients, grain textures, large marketing sections, or monospace branding.
- **Brand relationship:** Markonverter is an overlay for Ozon, so it should blend into Ozon's light product UI while remaining clearly an extension.

## Core Principles

- Fit into Ozon before expressing Markonverter.
- Make prices and pickup-point names the visual priority.
- Use color for action and state, not decoration.
- Keep controls predictable: blue primary buttons, neutral secondary buttons, red destructive buttons.
- Avoid layout shifts on hover, loading, collapse, delete, and save states.
- Never make raw Ozon ids or technical diagnostics look like primary content.

## Color

### Brand Tokens

- Ozon blue: `#005BFF`
- Ozon blue hover: `#004CE0`
- Ozon blue pressed: `#003FB8`
- Ozon blue soft: `#EAF2FF`
- Ozon blue border: `#B8D2FF`
- Ozon magenta: `#F1117E`
- Ozon magenta soft: `#FFF0F7`

### Neutral Tokens

- Page background: `#F5F7FA`
- Panel surface: `#FFFFFF`
- Subtle surface: `#F7F9FC`
- Muted surface: `#EEF3FA`
- Border: `#DCE3EE`
- Strong border: `#C7D1DE`
- Primary text: `#17233C`
- Secondary text: `#53627A`
- Muted text: `#7B8798`
- Disabled text: `#A6B0BF`

### Semantic Tokens

- Success: `#10A35A`
- Success soft: `#EAF8F1`
- Warning: `#F59F00`
- Warning soft: `#FFF6E0`
- Danger: `#E5484D`
- Danger soft: `#FFF0F0`
- Info: `#005BFF`
- Info soft: `#EAF2FF`

### Color Rules

- Use Ozon blue for primary actions, focus rings, selected states, and links.
- Use magenta sparingly for small brand accents or exceptional highlights. Do not pair blue and magenta inside the same button, badge, row state, or gradient.
- Use neutral text and borders for most structure. The UI should read mostly white/blue, not multicolor.
- Use green only for best/confirmed price states. Use red only for errors and destructive actions.
- Preserve WCAG AA contrast for text and actionable controls.

## Typography

- Use the system sans stack: `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`.
- Do not load remote fonts from extension pages or content scripts.
- Avoid monospace except for short technical fragments that genuinely need fixed-width alignment.
- Letter spacing is `0`.
- Product-panel base text: `13px`.
- Options-page base text: `14px`.
- Price values: `15px-18px`, semibold or bold, tabular numbers if available.
- Labels and helper text: `12px-13px`.
- Avoid uppercase eyebrow labels except for very small utility labels where they reduce ambiguity.

## Spacing

- Base unit: `4px`.
- Tight gaps: `4px-6px`.
- Control gaps: `8px`.
- Row padding in product panel: `10px-12px`.
- Section padding in options: `16px-20px`.
- Keep fixed-format controls stable with explicit min-height, width, grid tracks, or reserved action space.

## Shape And Elevation

- Radius:
  - Product panel: `8px`.
  - Rows, inputs, buttons: `8px`.
  - Small icon buttons: `8px`.
  - Pills/badges: `999px` only for status chips.
- Shadows:
  - Prefer borders over shadows inside Ozon pages.
  - Floating fallback panel may use a light shadow: `0 8px 28px rgba(23, 35, 60, 0.14)`.
  - Do not use heavy dark shadows.

## Product Page Panel

- The injected panel must fit inside Ozon's price-card container. Do not widen Ozon's layout.
- Use a white panel with a subtle border and a compact blue header or blue accent line.
- Collapsed state should remain recognizable, short, and stable in width.
- Price rows should use a two-column layout where space allows: pickup point on the left, price/status on the right.
- On narrow containers, rows stack with price below name.
- The cheapest/confirmed best row may use a soft green background and a green left border.
- Failed/unavailable rows may use soft red only around the status/action area, not the whole panel.
- Hidden destructive row actions must keep reserved layout space so hover/focus does not resize rows.
- Fixture/debug tools are secondary utility controls and should be visually quieter than price comparison rows.

## Options Page

- The options page is a settings tool, not a marketing page.
- Use a light page background, white sections, restrained borders, and compact controls.
- Keep a simple header with product name, short purpose text, and a small Ozon/price context chip.
- Avoid hero treatment, large cards, decorative backgrounds, and dark mode.
- Keep language, currency, and pickup-point management as separate full-width sections.
- Saved pickup rows should prioritize human-readable names, compare state, order controls, and delete controls.

## Delivery Selector Helper

- Injected controls in Ozon delivery rows must look like small Ozon-adjacent actions:
  - Blue primary action for saving.
  - Neutral saved/disabled state.
  - Compact height and no full-row takeover.
- Controls must consume pointer, click, and keyboard events before Ozon row handlers see them.
- Do not make saved badges transparent to clicks.
- Avoid adding per-row spinners or noisy badges. Use the existing assist status for loading/feedback.

## Controls

- Primary button: blue fill, white text, `8px` radius.
- Secondary button: white or subtle surface, neutral border, primary text.
- Icon button: square, neutral border, blue hover/focus state, clear `aria-label` and `title`.
- Danger button: red text/border by default, red fill only for confirmation.
- Inputs/selects: white surface, neutral border, blue focus ring.
- Focus ring: `0 0 0 3px rgba(0, 91, 255, 0.16)`.
- Disabled controls must look inactive without disappearing.

## Motion

- Keep motion functional and short.
- Hover/focus transitions: `120ms-160ms`.
- Collapse/expand: `180ms-240ms` with `cubic-bezier(0.16, 1, 0.3, 1)`.
- Do not animate prices, row order, or error states in a way that distracts from shopping.

## Content And Copy

- Russian is the default user-facing language; English remains supported by runtime i18n.
- Use plain action labels: Save, Delete, Capture current, Copy details.
- Keep Ozon-specific nouns consistent: pickup point, PVZ, Ozon point.
- User-facing text must not expose internal ids unless it is a diagnostics/export path.

## Implementation Rules

- `src/content/panel/styles.ts` owns product-panel styling.
- `src/entrypoints/options.html` owns options-page layout and inline CSS.
- `src/content/app.ts` may define generated structure/classes and small helper styles, but avoid redesigning business logic there.
- Keep `dist/` as build output. Update it only through `npm run build` when source changes need a loadable extension.
- If a design choice diverges from this file, document the reason in `wiki/log.md`.

## Verification

- For source UI changes, run:
  - `npm run typecheck`
  - `npm test`
  - `npm run build`
  - `npm run qa:ozon`
- Before signoff, inspect the product panel and options page in a browser or via the fake-Ozon harness.
- State live Ozon status separately from fake-harness success.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-04 | Replaced unrelated gstack design system | The previous file described a dark developer-tool brand and conflicted with Markonverter's Ozon product-page context. |
| 2026-07-04 | Adopted Ozon blue as primary action color | Ozon BrandLab identifies `#005BFF` as the main brand color, and it aligns with Ozon product UI. |
| 2026-07-04 | Kept magenta as rare accent only | Ozon BrandLab pairs blue and magenta as brand colors, but extension UI needs fewer colors and clearer action semantics. |
| 2026-07-04 | Standardized on light surfaces | Markonverter appears inside Ozon shopping pages, where a light compact ecommerce utility is lower risk than a dark overlay. |
