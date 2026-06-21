# design-sync notes — ALICE Design System

Repo-specific gotchas for future syncs. One bullet per learning.

## Build / shape
- `alice` is a **Tauri app, not a published component library** — there is no `dist/` of
  components and no library build script (`npm run build` builds the whole Vite app).
  We sync in **package shape, synth-entry mode** from `src/components/*.tsx`
  (pinned via `componentSrcMap`). No `--entry` dist path.
- `node_modules/` is the repo's own dev install (react, react-dom, lucide-react present).
  We did **not** run `npm ci` (it would tear down the working app install for no gain —
  the converter only needs `node_modules` to resolve react/lucide-react for esbuild).
  `--node-modules` points at the repo-root `node_modules`.
- 9 components, all pure presentational primitives. Only `Modal` and `Notifications`
  import `lucide-react` (icons) — bundled in. No component imports `../api`.

## Styling
- Tokens: `src/styles/tokens.css` (`:root { --* }`) — `cfg.tokensGlob`.
- Component CSS: `src/styles/components.css` — `cfg.cssEntry`. Uses `var(--*)` from tokens.
- Fonts: DM Sans / Playfair Display / JetBrains Mono loaded via a **Google Fonts
  `@import url(...)`** at the top of `tokens.css` → `[FONT_REMOTE]` (load at runtime,
  nothing to ship). Expect no `[FONT_MISSING]`.

## Re-sync risks
- Synth-entry mode tracks `src/` directly — any refactor of `src/components/` paths
  means updating `componentSrcMap`.
- Fonts depend on Google Fonts being reachable at render time (remote `@import`).
- `Notifications` and `Modal` are stateful/overlay — previews may need `cardMode`
  overrides (single/column) and composed open states.
