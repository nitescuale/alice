# ALICE Design System — conventions

ALICE is a dark-theme desktop UI (Tauri app). The components are presentational
React primitives styled entirely by the design system's own CSS; you compose
them through **props**, never by writing their internal class names.

## Setup & wrapping

- **No provider needed.** There is no theme/context provider — design tokens are
  global CSS custom properties shipped in `styles.css` (which `@import`s
  `_ds_bundle.css`, where the `:root` token block and all component CSS live).
  As long as `styles.css` is loaded, every component is styled. Don't wrap in a
  ThemeProvider — there isn't one.
- **Dark theme.** Surfaces are dark (`--noir-*`); text is light. Place components
  on a dark background (`--noir-900`/`--noir-950`) so contrast reads correctly.
- **Notifications** is a singleton toast layer: mount `<Notifications />` once near
  the app root, then fire toasts imperatively with `notify({ title, message?,
  variant?: "success" | "error", elapsed? })`. It renders nothing until a toast
  fires.

## Styling idiom — props + tokens, not classes

- **Style components via their props**, not CSS. The variant/size vocabulary:
  - `Button` — `variant`: primary | secondary | ghost | danger; `size`: sm | md | lg; plus `icon`, `loading`.
  - `Badge` — `variant`: default | amber | success | danger | info; `size`: sm | md.
  - `Card` — `variant`: default | outlined | elevated | amber; `padding`: none | sm | md | lg. Compose with `CardHeader` / `CardBody`.
  - `Input` / `Select` — `label`, `hint`, `error`, `icon` (Select also takes `options`, `placeholder`).
  - `Tabs` — `tabs={[{id,label,icon?}]}`, `defaultTab`, and a render-prop `children={(activeId) => …}`.
  - `Modal` — controlled via `open` + `onClose`, optional `title`.
  - `ProgressRing` — `value` (0–100; fill color auto-derives: <50 danger, 50–79 amber, ≥80 success), `size`, `label`.
- **For your own layout glue, use the design tokens** (`var(--token)`), never hard-coded values. Real families (all defined in `_ds_bundle.css` `:root`):
  - Spacing: `--sp-1` … `--sp-6`.
  - Color scales: `--noir-50` … `--noir-950`, `--amber-100` … `--amber-500`, `--success-400/500`, `--danger-400/500`, `--info-400/500`; semantic `--amber`, `--success`, `--danger`, `--info` (+ `--*-bg`).
  - Radius: `--radius-sm | -md | -lg | -xl | -full`.
  - Text sizes: `--text-xs | -sm | -base | -md | -lg | -xl | -2xl | -3xl`.
  - Fonts: `--font-display` (Playfair Display), `--font-body` (DM Sans), `--font-mono` (JetBrains Mono).
  - Borders: `--border-subtle | -medium | -accent`. Shadows: `--shadow-sm | -md | -lg | -glow`.

## Where the truth lives

- Tokens + component CSS: `_ds_bundle.css` (reachable from `styles.css`). Read it before styling.
- Per-component API + usage: each `components/<group>/<Name>/<Name>.d.ts` and `<Name>.prompt.md`.

## Idiomatic snippet

```tsx
import { Card, CardHeader, CardBody, Badge, Button } from "alice";

<div style={{ background: "var(--noir-900)", padding: "var(--sp-5)" }}>
  <Card variant="elevated" padding="lg">
    <CardHeader>
      <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-lg)" }}>
          Deep Learning
        </span>
        <Badge variant="amber">12 questions</Badge>
      </div>
    </CardHeader>
    <CardBody>
      <Button variant="primary">Commencer l'entraînement</Button>
    </CardBody>
  </Card>
</div>
```
