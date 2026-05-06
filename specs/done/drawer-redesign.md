# Spec: Right-Drawer Visual Redesign

## Context

The right-hand drawer (`pkgs/static/src/App.tsx` `<div className={styles.sidebar}>`) has accreted ~10 collapsible sections of heterogeneous origin and styling. Section headings are visually weak and stylistically inconsistent across components, so it's hard to scan top-down for "where do I change tile padding?" or "where do I toggle atom labels?".

Per [discussion][discuss]: the user prefers keeping the single tall drawer (vs. an icon-rail / VSCode-style activity bar) but wants better visual hierarchy — bolder headings, per-section icons, color accents, persistent collapse state, and a hotkey to collapse all (or all-but-most-recent) sections.

This spec is **independent of** [`specs/diff-mode-and-legend.md`][diff-spec] and [`specs/input-vs-output-comparison.md`][cmp-spec] — none of them depend on each other; the drawer redesign is purely visual/UX and can land before, after, or between those.

## Inventory of current sections

The drawer renders top-to-bottom in [`App.tsx`][app] (≈L1474–L1576):

| # | Section            | Component                                                            | Heading style                                | Collapse state                       | Visible when                |
| - | ------------------ | -------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------ | --------------------------- |
| 1 | Cached Files (`N`) | [`VolumeGallery.tsx`][vg]                                            | inline button, 13 px / 600 / `#aaa`, `▶`/`▼` | sessionStorage `elvis-gallery-collapsed`  | `opfsStore` ready           |
| 2 | Settings           | [`Settings.tsx`][settings]                                           | inline button, 13 px / 600 / `#aaa`, `▶`/`▼` | sessionStorage `elvis-settings-collapsed` | always                      |
| 3 | Load from URL      | [`URLInput.tsx`][url]                                                | inline button, 13 px / 600 / `#aaa`, `▶`/`▼` | sessionStorage (similar key)              | always                      |
| — | Fetch status       | inline `<div>`                                                       | n/a (status line, not a section)             | n/a                                  | `fetchStatus` set           |
| 4 | Examples           | inline `<details>` in `App.tsx` (≈L1332)                             | unstyled native `<summary>`, 12 px / `#999`  | sessionStorage `elvis-examples-open`      | always                      |
| 5 | Surface            | [`Controls.tsx`][controls]                                           | `summary.sectionTitle`: 12 px / 600 / uppercase / `#888`, native disclosure triangle, bordered card | none (always defaults to `open`) | `primaryFile` loaded        |
| 6 | Heatmap            | `Controls.tsx`                                                       | same as Surface                              | none                                 | `useHeatmap && primaryFile` |
| 7 | Display            | `Controls.tsx`                                                       | same as Surface                              | none                                 | `primaryFile`               |
| 8 | Tiling             | `Controls.tsx`                                                       | same as Surface                              | open driven by `hasTiling`           | `primaryFile`               |
| 9 | Camera             | `Controls.tsx`                                                       | same as Surface                              | none                                 | `primaryFile`               |
| 10| Slice              | `Controls.tsx`                                                       | same as Surface                              | none                                 | `primaryFile`               |
| — | + Add file…        | inline button                                                        | n/a                                          | n/a                                  | always                      |

**Findings:**

- The drawer uses **two completely different heading conventions**: inline-styled `<button>` (sections 1–3) vs. `<details>/<summary>` styled by [`Controls.module.css`][css] (sections 5–10). Section 4 (Examples) is a third style — a bare native `<details>` with no styling at all. Unifying these is a prerequisite for any visual-cue work.
- Sections 1–3 persist collapsed state in `sessionStorage` (lost across browser restarts); sections 5–10 don't persist at all and always boot `open`.
- The user's task description mentions "(per-file) Surface, Heatmap" — in current `App.tsx` there's only ever **one** `<Controls>` block (driven by `primaryFile`), even in `ComparisonView` (multi-file). So per-file is aspirational, not status quo. See [Open questions](#open-questions).
- No icon library is currently in use anywhere in the project — the only icons are inline SVGs (`ResetIcon` in `Controls.tsx`, `GithubIcon` for SpeedDial). MUI is available (`@mui/material` dep in `pkgs/static`) and includes `@mui/icons-material` access via Emotion, but is not yet listed.

## Recommendation: Light-touch redesign

Three options were considered (per task description):

- **Light-touch (recommended).** Bolder headings + per-section icon + subtle color accent + localStorage-persistent collapse + collapse-all hotkey. Single drawer, no layout change. Lowest risk, highest payoff per LOC. Keeps Ryan's preferred "all in one drawer" model intact.
- **Mid-touch.** Light-touch + group sections into 2–3 top-level *categories* ("Data" = Cached/URL/Examples, "Visualization" = Surface/Heatmap/Display, "View" = Tiling/Camera/Slice) with a thin parent heading. Adds nesting but introduces a 2nd layer of collapse — risk of fiddly UX. Defer until after light-touch ships and the drawer is concretely re-evaluated.
- **Heavy-touch.** VSCode-style icon rail on the left edge of the drawer; clicking an icon swaps which single section is shown (or scrolls/anchors to it). User explicitly leaned away from this in [discussion][discuss] ("I wonder if … j/w") and the volume of inter-section state inspection (e.g. you frequently want Surface + Display visible simultaneously) argues against single-section view modes.

**Pick light-touch.** Below assumes that.

**Shipped 2026-05-06** as the light-touch path:
- `pkgs/core/src/components/DrawerSection.tsx` — shared collapsible section
  with icon, accent stripe, badge, localStorage-persistent collapse, and
  one-shot legacy-key migration.
- `lucide-react` adopted for the icon set (~+3 KB gz total for 9 icons).
- All 6 `Controls.tsx` sections + the 3 standalone components
  (`VolumeGallery`, `Settings`, `URLInput`) + the inline Examples
  `<details>` migrated to `DrawerSection`.
- Hotkeys via `useAction`: `[` collapse-all, `]` expand-all, `;`
  focus-last (originally `\` per spec, but conflicted with the existing
  `\f t` chord — see commit cd550ee).
- Reduced-motion + `:focus-visible` styling included in the CSS module.

Deferred (out of scope as planned):
- Mid-touch / heavy-touch options.
- Light-mode accent CSS-var split (LM theme hasn't landed).
- Section reordering / drag-and-drop.
- Compact mode toggle.

### 1. Unify heading components

Extract a shared `<DrawerSection>` component (likely under `pkgs/core/src/components/DrawerSection.tsx`) that all 10 sections use. Props:

```ts
interface DrawerSectionProps {
  id: string                  // for localStorage key + a11y
  title: string               // 'Cached Files', 'Surface', etc.
  icon: ReactNode             // 16 px lucide icon (see §3)
  accent: string              // hex string like '#4a9eff' (see §4)
  badge?: ReactNode           // e.g. count for Cached Files
  defaultOpen?: boolean       // initial state if no LS entry
  forceOpen?: boolean         // override LS, e.g. Tiling auto-opens when active
  children: ReactNode
}
```

Internally renders a styled `<details>` (preferred over button + `{!collapsed && ...}` because native disclosure semantics work for a11y and the platform CSS `::details-content` machinery), with:

- Custom-styled `<summary>` overriding the native triangle (use `::-webkit-details-marker { display: none }` and our own chevron span).
- Left border / left accent stripe (3 px) in `accent` color.
- Heading text: 13 px / 600 / `#ddd` (LM: `#222`), removing the current 12 px uppercase letter-spaced treatment (which feels too "form section" for a tool panel).
- Icon: 16 px, sits left of the title, `color: accent`.
- Right-aligned chevron + optional `badge`.

Migrate all 10 sections to use this. The "Examples" `<details>` and the three button-headed sections converge to the same thing.

### 2. Persistent collapsed state

- Use `localStorage` (not `sessionStorage`). User explicitly mentioned wanting persistence; sessionStorage today is a known UX papercut (collapse state lost on every browser restart).
- Single key per section: `elvis.drawer.${id}.open` = `"1"` or `"0"`.
- Migrate existing keys (`elvis-gallery-collapsed`, `elvis-settings-collapsed`, `elvis-examples-open`) on first read: read old key, write new key, delete old. One-shot migration in `DrawerSection`'s init.
- `defaultOpen` default: `true` for Surface/Display/Camera; `false` for Cached Files / Settings / Load from URL / Examples / Heatmap / Tiling / Slice. (i.e. only sections you'd want immediately visible after page load with a material loaded.)
- `forceOpen` semantics for sections like Tiling: when `tilePadding > 0` we still want the section auto-open even if user collapsed it last session, **once**, on the transition from inactive→active. Mechanism: bump a "force-open generation" prop and have `DrawerSection` open itself when generation changes. Avoids permanently overriding user's preference.

### 3. Icons

Pick **`lucide-react`**. Rationale:

- Tree-shakeable, ESM, TS-native. `pnpm add lucide-react` in `pkgs/core`. Roughly 4 KB per icon imported.
- The set covers everything we need without compromise (see mapping below).
- Avoids pulling in MUI icons just for this (MUI is already a dep in `static` but the icons package is a separate large surface; lucide is leaner).
- Already widely used in Ryan's other JS projects (verify in `~/c/jc-taxes`, `~/c/scrns`, etc., before adopting; if a different lib is the de facto standard there, defer to it).

Per-section icon mapping (lucide names):

| Section       | Icon                  | Lucide name        |
| ------------- | --------------------- | ------------------ |
| Cached Files  | database / hard drive | `Database`         |
| Settings      | gear                  | `Settings2`        |
| Load from URL | link / cloud download | `Link2` or `Globe` |
| Examples      | sparkles / book-open  | `Sparkles`         |
| Surface       | sphere / orbit (TBD)  | `Globe` (overlap with URL — pick `Atom` for Surface, `Link2` for URL) |
| Heatmap       | flame / paintbrush    | `Flame`            |
| Display       | eye                   | `Eye`              |
| Tiling        | grid 3×3              | `Grid3x3`          |
| Camera        | camera / video        | `Camera`           |
| Slice         | scissors / layers     | `Layers`           |

Bike-shed in the PR; the column above is just a reasonable starting point. (Watch for Surface vs. Atoms confusion — `Atom` icon shows the nucleus + electron rings, which is a fair stand-in for the iso-surface that surrounds the atoms.)

### 4. Accent colors

Re-use the existing palette where possible (the project already uses `#4a9eff` as a primary blue accent — see `slider`, `axisBtnActive`, `accent-color` declarations in [`Controls.module.css`][css]).

Per-section accent (DM values; LM TBD when LM lands):

| Section       | Accent     | Note                                                                    |
| ------------- | ---------- | ----------------------------------------------------------------------- |
| Cached Files  | `#7c8a9c`  | neutral slate (storage)                                                 |
| Settings      | `#9aa0a6`  | neutral grey (chrome)                                                   |
| Load from URL | `#4a9eff`  | primary blue (input action)                                             |
| Examples      | `#c8a25b`  | warm sand (curated content)                                             |
| Surface       | `#5fb3d4`  | cool cyan — matches "iso surface" perception                            |
| Heatmap       | `#ff8a3d`  | warm orange — matches turbo's hot side; signals "color-rendering mode"  |
| Display       | `#a78bfa`  | violet (chrome / visibility flags)                                      |
| Tiling        | `#7dd3a1`  | green (geometric repetition)                                            |
| Camera        | `#f5a3a3`  | rose (motion / framing)                                                 |
| Slice         | `#f0c674`  | yellow (cross-section "knife" highlight)                                |

Use accents as: 3 px left stripe on the open `<details>`, icon color, and a 1 px-thin top border that picks up the accent at ~30% opacity. **Do not** tint section backgrounds (will fight the canvas + look noisy when 5+ sections are open). Verify against existing element-pill colors in [`Controls.tsx`][controls] L208 to avoid clashes.

When light mode lands (separate work), expose accents as CSS variables in `:root` / `[data-theme="light"]` so the same component renders fine in both. Stub now: define `--drawer-accent-cached: #7c8a9c;` etc. in a single CSS module.

### 5. Hotkeys

Wire via `use-kbd` (already in `pkgs/static`). Three actions, namespaced under `drawer:`:

| Action             | Default key | Behavior                                                  |
| ------------------ | ----------- | --------------------------------------------------------- |
| `drawer:collapse`  | `[`         | Collapse all sections                                     |
| `drawer:expand`    | `]`         | Expand all sections                                       |
| `drawer:focus`     | `\`         | Collapse all *except* the most-recently-interacted-with section (the user's "focus mode" idea) |

Rationale: `[` `]` `\` are physically adjacent on QWERTY, unmodified, unused by any browser default, and visually evoke open/close brackets. They're also unused by current Elvis hotkeys (verified: `App.tsx` uses letter keys + arrows + symbols like `,` `.` `/`, but not `[` `]` `\`).

"Most-recently-interacted-with" = last section whose `<details>` toggled open *or* whose body received any `pointerdown`. Track via a `useRef` in the parent (`Sidebar`) — bubbled `pointerdown` listener walks up to find the enclosing `[data-section-id]` and stores it. Persist `lastTouchedSection` in localStorage so `\` works on first keypress after a refresh.

### 6. Integration points

In [`App.tsx`][app] (≈L1474):

- Replace the 6 inline children (`VolumeGallery`, `Settings`, `URLInput`, `fetchStatus`-div, `exampleLinks`, `Controls`) with a `<Sidebar>` shell that renders an array of `<DrawerSection>`s. Section content stays in their existing components — they just become children, not heading-owners.
- `VolumeGallery`, `Settings`, `URLInput` lose their internal heading button + `collapsed` state; they expose plain content components (`<VolumeGalleryBody>`, `<SettingsBody>`, `<URLInputBody>`). The shell wraps them in `<DrawerSection title="…" icon={…} …>`.
- Keep "+ Add file for comparison" button outside the sections (it's an action, not a section).

In [`Controls.tsx`][controls]:

- Replace each of the 6 `<details className={styles.section}>` blocks with `<DrawerSection>`. Internal layout (sliderHeader, controlLabel, etc.) doesn't change.
- The `controlTitle` filename header + element-legend pills stay above the sections — they're a per-file header, not collapsible. (But: consider stickiness or a thin separator above section #5 to make this clear.)

### 7. Out of scope

- LM/DM theme switching beyond exposing accents as CSS vars.
- Icon-rail / activity-bar style (heavy-touch above).
- Section reordering / drag-and-drop. Order stays as listed in the inventory above.
- "Compact mode" toggle (smaller fonts / tighter padding) — see [Open questions](#open-questions).
- Mid-touch grouping into Data / Visualization / View categories.

## Implementation order

Each step is independently committable.

1. **`DrawerSection` component + CSS module.** Build it standalone (no integration yet). Storybook-style: render 3 dummy sections in a scratch route to verify chevron, accent stripe, icon slot, badge slot, hover/focus states. Persist collapse to `localStorage`.
2. **Add `lucide-react` dep** to `pkgs/core`. Smoke-test bundle size impact (`pnpm build` before/after).
3. **Migrate `Controls.tsx`** sections (Surface, Heatmap, Display, Tiling, Camera, Slice) to `DrawerSection`. Visual-only change. Verify in browser ([CIC][cic]) that all 6 still toggle, sliders still work, Tiling auto-opens via `forceOpen` when `tilePadding > 0`.
4. **Migrate `VolumeGallery`, `Settings`, `URLInput`** — extract bodies, wrap with `DrawerSection`. Migrate sessionStorage keys → localStorage on first read. Verify fetch-status div still slots between URL and Examples.
5. **Migrate Examples `<details>`** in `App.tsx` to `DrawerSection`. The most trivial of the migrations.
6. **Hotkeys.** Wire `drawer:collapse` / `drawer:expand` / `drawer:focus` via `useAction`. Implement section-id pubsub (parent-level ref + `pointerdown` bubble) for "most-recently-interacted". Add to `ShortcutsModal` automatically (it reads from `useAction` registrations).
7. **Polish pass.** A11y: keyboard focus ring on summary, `aria-expanded`, color contrast verification on accent stripes. Reduced-motion: don't animate the chevron rotation if `prefers-reduced-motion`. Light-mode accent CSS-var stubs.

## Open questions

- **Icon set.** Confirm `lucide-react` is the right pick vs. `react-icons` (broader, more bloated) or hand-rolled SVGs (consistent with existing `ResetIcon` / `GithubIcon` but tedious). Look at `~/c/scrns`, `~/c/jc-taxes`, `~/c/use-kbd` for prior art before adopting.
- **Compact mode.** Worth a `Settings → Compact drawer` checkbox that drops section padding from `10px` → `4px` and font from 13 → 12? Useful on small laptops where 8+ sections overflow. Defer unless someone actually overflows the viewport.
- **Per-file Surface/Heatmap.** The task description mentions "(per-file) Surface, Heatmap (newly added)", implying the user is anticipating multi-file workflows where each file gets its own iso/opacity controls. Today there's only one `<Controls>` driven by `primaryFile`. Two paths:
  1. **Defer.** When/if per-file controls land, each file's accordion of {Surface, Heatmap} gets nested inside an outer per-file section (one level of nesting). `DrawerSection` should support that already (it's just composition).
  2. **Pre-architect now.** Let `Controls` accept an optional `nested?: boolean` prop that flips section accent stripes from full-width to indented. Probably premature — wait for the use case.
  Recommend (1) — defer.
- **`forceOpen` semantics.** For Tiling specifically, the current behavior (`open={hasTiling}`) means *every render* with `hasTiling=true` re-opens it; if the user collapses Tiling while padding is non-zero they can't keep it closed. Is that the right behavior, or should `forceOpen` only fire on the inactive→active *transition* (preferred — see §2)? Confirm with Ryan.
- **`Examples` heading style today.** It currently uses no `Controls.module.css` styling and a default browser disclosure triangle, breaking visual continuity even before this redesign. Worth calling out: even if the rest of this spec is descoped, *just* migrating Examples to match the existing `sectionTitle` style would be a net win.
- **Section order.** Should "Examples" sit above or below the per-file controls? Today it's between Load-from-URL and Surface, which means with a material loaded the user has to scroll past Examples (rarely changed once the user knows about it) to reach Surface (changed on nearly every interaction). Possible reorder: 1, 2, 3, 4 (load-from-URL), Examples → bottom, then 5–10. Discuss before implementing.
- **Light-mode accents.** Current values are DM-tuned. Do we have a planned LM palette anywhere? If not, derive via `color-mix(in oklch, accent 70%, white)` for LM and gate on `[data-theme="light"]`. Verify against actual canvas background once LM lands.

[discuss]: ../README.md
[diff-spec]: ./diff-mode-and-legend.md
[cmp-spec]: ./input-vs-output-comparison.md
[app]: ../pkgs/static/src/App.tsx
[controls]: ../pkgs/core/src/components/Controls.tsx
[css]: ../pkgs/core/src/components/Controls.module.css
[vg]: ../pkgs/core/src/components/VolumeGallery.tsx
[settings]: ../pkgs/core/src/components/Settings.tsx
[url]: ../pkgs/core/src/components/URLInput.tsx
[cic]: # "check in chrome — verify in a live browser session"
