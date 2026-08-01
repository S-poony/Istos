# DeskShell — Design

The rules the code follows and the reasoning behind them. The product idea lives
in [description.md](description.md) and the original skeleton in
[plan.md](plan.md); this document is what those become once they meet an
implementation. If code and this document disagree, one of them is a bug.

---

## 1. What DeskShell is

A file explorer for people who work in the same few folders every day.

General-purpose explorers are tuned for browsing an entire computer, so they
show every folder the same way. DeskShell inverts that: you spend time laying
out a folder once, and get a view tailored to that folder forever after. An
artist checking an image should see the image, not a filename they have to click.

The unit of work is a **trove** — a directory the user opens, comparable to an
Obsidian vault. Everything inside it becomes part of one entity graph.

There are two modes:

- **Edit mode** — change the entity structure, attach and detach components,
  edit component settings.
- **Live mode** — navigate the result, which is effectively a small static site
  generated from the user's own files.

The long-term goal is that a trove can be published as a custom static website
built directly from files on disk.

---

## 2. The model

### Files are entities, entities can parent anything

There is no separate notion of "folder". Every file is an entity, and every
entity can be the parent of other entities. An image can contain files. This is
the central idea and it constrains a lot of the UI: **no folder-specific icons,
names, or assumptions**. Containers are `.entity-wrapper`, labelled with the
parent's filename or `Entity #ID` — never "folder".

The predicate is `isContainer` — "does this entity have a `grid`", not "is this
a folder". Icons follow the same rule: they may describe how an entity
*renders* (audio, video, image, text), never whether it holds children. An
entity with children gets the same neutral mark as one without; the toggle
arrow already says there is something inside.

### The ECS ↔ filesystem contract

Structural changes are mirrored to disk wherever they can be. Moving image A —
which holds file B — into folder C moves both A and B on disk.

Two rules follow, both learned the hard way:

- The root parent is `Option::None` / `null`, never the id `0`. Entity ids start
  at `0`, so `0` is a legitimate destination and cannot double as a sentinel.
- A move whose source and destination paths are already equal is **not** a no-op.
  Skip the filesystem rename, but still update `parent_ids` and persist —
  otherwise stale parenting survives and the next reorder fails.

### Entity, Component, System

- **Entity** — a `u64` (Rust) / `number` (TS). Identity only.
- **Component** — a `componentType` string plus a free-form `settings` object,
  stored per entity. Components combine freely; that combination is the product.
- **System** — a function over all entities matching a component query.

Components are stored as `HashMap<EntityId, Vec<Box<dyn Component>>>` in Rust and
`Map<EntityId, Component[]>` in TypeScript. Note that a TS `Entity` carries only
`id` and `parentId` — components are looked up through the world
(`world.getComponents(id)`), never through `entity.components`.

### Component catalogue

| Component | Status | Settings | Purpose |
|---|---|---|---|
| `renderFile` | implemented | `targetPath?`, `scale`, `position` | Renders a file — itself by default, or another entity |
| `grid` | implemented | `columns`, `gap`, `order?` | Arranges children in space |
| `timeline` | planned | `duration`, `loop` | Arranges children in time |
| `pin` | planned | `visible` | Stays visible while navigating below |
| `renderArchitecture` | planned | `layout` | Children as connected nodes |

At scan time every file gets `renderFile`; every directory gets `grid` **and**
`renderFile`, so a directory is visible as an item and as a container.

---

## 3. Architecture

```
Svelte components  ──reads──  Svelte stores  ──wraps──  World (TS mirror)
        │                                                     ▲
        │ invoke()                                            │ get_world_state
        ▼                                                     │
Tauri commands  ──mutates──  World (Rust, source of truth)  ──┴── SQLite
```

**Rust owns the truth.** The TypeScript `World` is a read mirror, rebuilt
wholesale from `get_world_state`. The frontend never mutates its mirror and
hopes the backend agrees: it invokes a command, then reloads. The mirror exists
so rendering can be reactive without crossing IPC on every frame.

**SQLite stores entities, components and config** in an EAV shape, which matches
the ECS naturally. Root ordering lives in `config`, child ordering lives in the
parent's `grid` component settings.

### Command surface

`open_trove`, `get_world_state`, `add_component`, `remove_component`,
`update_component_settings`, `reorder_children`, `move_entity`.

### Threading rule

**A Tauri command that touches the filesystem or serialises the world is
`async`.** Synchronous commands run on the main thread, so scanning a large
trove froze the window — including the file dialog, which made it impossible to
open a second trove until the first finished. `open_trove` and `get_world_state`
are async for this reason.

Because Tauri requires async command futures to be `Send`, and
`std::sync::MutexGuard` is not, the async command body must not hold a guard
itself. Each one delegates to a plain synchronous helper
(`open_trove_locked`, `world_snapshot_locked`) that does the locking. Follow this
pattern when making other commands async.

### Serialisation across the boundary

Rust's `Option::None` becomes JSON `null`, not `undefined`. Filter `null` at
deserialisation and always test `x === undefined || x === null` when checking
for a root. Testing only for `undefined` silently breaks all root rendering.

---

## 4. Feedback and long-running work

Opening a trove is the one action that can take real time, so it defines the
pattern for the rest.

- **A single in-flight operation.** `openTroveFlow` holds a re-entrancy latch and
  publishes `troveOpening`; the button disables itself and shows a spinner. A
  second request returns `{ status: 'busy' }` rather than racing the first.
- **Report only what actually happened.** The flow resolves to `opened`,
  `empty`, `cancelled`, `busy`, or `failed`. Success is reported *after* the new
  state is in the store and Svelte has flushed the DOM (`await tick()`), and it
  carries the entity count the store actually holds. Announcing success before
  the desktop has changed is a lie the user will catch.
- **Three severities, one shell.** Success, info and error toasts share
  `.toast` and differ only by `--status-color`, drawn from the `--success`,
  `--danger`, `--info` variables in `app.css`. A cancellation is *info*, not
  success. Errors persist until dismissed and use `role="alert"`; the others
  auto-dismiss and use `role="status"`. Never use a raw `alert()`.
- **Recoverable failures do not replace the screen.** Only a startup failure
  renders the full-screen error state. A failed trove open is a toast — the app
  keeps whatever it was already showing.

---

## 5. Layout and rendering

### Grid sizing

Scale columns down to the child count when a container holds fewer children than
its configured column count:

```ts
let gridColumns = $derived(
  children.length > 0 && children.length < columns ? children.length : columns
);
```

Without this, a folder containing one folder containing one file compounds into
an unreadably tiny cell.

Always use `minmax(0, 1fr)`, never bare `1fr`:

```css
grid-template-columns: repeat(var(--grid-columns), minmax(0, 1fr));
grid-auto-rows: minmax(min-content, max-content);
align-items: stretch;
```

Root wrappers take only the space they need and never shrink
(`height: fit-content; flex-shrink: 0`). Nested wrappers use
`height: auto; min-height: 0` and let the grid row size them — percentage heights
here produce tall empty boxes that overflow.

**Only the root wrapper draws a card; nested wrappers draw a rail.** A full box
at every level adds its own padding and bottom border, so a chain of nested
containers ended in a ladder of near-identical horizontal lines — one per level —
stacked at the bottom of the trove. Nested wrappers instead use a 2px
`border-left` and left padding: rails run alongside content and never accumulate
into lines across it. The header's rule under the name is likewise root-only, and
nested names step down in size and weight.

### Card aspect ratios

A card's shape comes from its content's real dimensions when those are known,
and from an orientation default otherwise.

- Images and video report orientation via `onload` / `onloadedmetadata`;
  landscape wins ties.
- PDFs report their first page's size through `onFirstPageSize`, which sets
  `--card-aspect` inline. **A PDF is not assumed to be portrait** — a slide deck
  is landscape and should look like one.
- Defaults when nothing has been measured: portrait `3 / 4`
  (`min-height: 180px`, `max-height: 400px`), landscape `16 / 9`
  (`min-height: 120px`), audio `min-height: 82px`, unclassified `120px`.

These minimums cover the caption as well as the content. Sizing a card to its
player or page alone leaves the caption to squeeze it.

### Cards, names and clicks

Everything the desktop draws for a single entity is a **card** (`.render-file`):
content on top, a caption underneath. There is no second kind of card.

The caption is how an entity says its name. It is one line, secondary colour,
truncated — present on every card, never competing with the content — and it
carries a count when the entity holds other entities. Below `84px` of card width
it disappears, because an ellipsis costs more than it tells. The name is the
entity's own (`getEntityDisplayName`): the last path segment, and `Entity #ID`
when there is no path. **A container is never named after one of its children** —
borrowing a child's name made a container claim to be a file it merely held.

Placeholders show a neutral mark and the file's extension. No icon may imply
"folder" or "file": any entity can contain any other, so the distinction the
icon would be drawing does not exist.

**A click belongs to the innermost thing that handles it.** Cards and containers
are clickable — clicking one focuses that entity — and they also contain real
controls. `isInteractiveTarget` (`src/lib/interaction.ts`) walks from the event
target up to the handler's own element and reports whether the click landed on a
control; the handler then focuses only if it did not. Two rules make this safe:

- The walk **stops at `currentTarget`**. Matching against the whole document
  would make a nested card mistake an ancestor for one of its own controls.
- The handler calls `stopPropagation()` **either way**. Returning early without
  it lets the click bubble to the ancestor card, which focuses the wrong entity —
  the exact bug, moved up one level.

A subtree that is interactive without being a form control marks itself
`data-interactive`.

### Depth and navigation

Inline nesting stops at `MAX_DEPTH` (`src/lib/constants.ts`). At the limit an
entity is **not** replaced by a different kind of thing: its `grid` simply stops
applying, and what remains is its `renderFile` — the same card the desktop draws
for it anywhere else, marked `.collapsed` and captioned with its child count.
Entering it is what shows its children. A bespoke "deep entity" widget was tried
and removed: it duplicated card chrome, drifted from the app's styling, and gave
one class of entity a shape no component asked for.

Focusing an entity sets `focusedEntityStore`; a breadcrumb bar renders the
ancestor chain back to the trove root. Opening a new trove clears the focus,
since the previous id means nothing in the new world.

`MAX_DEPTH` applies to **live mode only**. The tree view is finite and safe to
expand fully; its nodes start expanded, with manual collapse preserved.

### Mode switching

Both views stay mounted and are toggled with `.hidden { display: none !important }`.
Using `{#if}` would destroy and rebuild every rendered file on each toggle.

---

## 6. The PDF viewer

`RenderPdf` is currently wired in by file extension. It should become a
`sequenceVisualizer` component (see [docs/ROADMAP.md](docs/ROADMAP.md)); until
then these rules hold.

**Zoom is a factor of the fit scale, not an absolute PDF scale.** "100%" means
"fitted to this container", which is the only definition that means the same
thing in a 200px grid cell and a full window. Range `0.25`–`8`, stepped by
`0.25`, and **clamped rather than refused** — a click at the boundary lands on
the limit instead of silently doing nothing. Because zoom is relative, a resize
recomputes the fit without discarding the user's zoom.

**Fit modes.** Fit-page by default (`min` of the width and height ratios),
togglable to fit-width. A floor of `0.05` keeps a page in a tiny cell from
collapsing to nothing.

**One render per state change.** The renderer waits until it knows the current
page's own dimensions before painting, so the first paint is already at the
fitted scale — not a paint at `1.0` followed by a second at fit. Page metadata is
fetched once per page and cached with the page number it belongs to, so zooming
and resizing never refetch. While a new page's metadata is loading, the previous
page stays on screen.

**Every async continuation is generation-guarded.** Document loads, page
metadata fetches and renders each hold a monotonic counter and bail out if
superseded. A slow response for a document the user has navigated away from must
never overwrite current state. Renders are cancelled before the canvas is
resized, since resizing clears it.

**Sharpness.** The canvas backing store is `viewport × devicePixelRatio` with a
matching render transform, while the CSS box stays at the logical size.

**Controls shrink before they are dropped, and are dropped before they are
crushed.** The toolbar wraps and its controls shrink through container queries.
Past that, a measured `toolbarLevel` removes whole groups from the DOM, least
essential first: fit-mode and reset go, then the entire zoom section, then the
toolbar itself. Page navigation survives longest. A button too small to read or
hit is worse than no button — and in a thumbnail-sized cell a toolbar takes more
room than the page it serves.

Two things keep that honest. A **zero-sized measurement means "not laid out
yet", not "no room"**, so the toolbar is never hidden for a frame on mount. And
when the zoom controls disappear, **`zoomFactor` resets to 1** — zoom can only be
changed from controls that are now gone, so leaving it set would strand the page
at a scale the user cannot undo.

The container has no `min-height` — the host grid cell owns sizing, and a
`min-height` here pushed the toolbar out of small cells.

**Scrolling reaches both edges.** The scroll container is a flex box and the
canvas wrapper uses `margin: auto`. Centring with `justify-content` makes the
overflow past the scroll origin unreachable once the page is wider than the
container.

---

## 7. Testing

Frontend tests run under JSDOM with Vitest, on `pool: 'forks'`. **Do not set
`pool: 'vmForks'`** — it hangs the suite indefinitely with no output.

Backend logic is tested through pure functions (`open_trove_impl`,
`move_entity_impl`) rather than Tauri commands, which cannot be constructed with
a `State` wrapper in a unit test.

JSDOM does no layout, so anything that sizes itself from a measured box would be
stuck at 0×0 and untestable. `src/__tests__/setup.ts` exports `resizeElement`,
which sets an element's client size and notifies the mock `ResizeObserver`; a
test states a size and asserts what the component does with it.

Environment-level traps — `vi.mock` hoisting, PDF.js needing `DOMMatrix`, JSDOM
lacking `DragEvent` — are recorded in [docs/LEARNINGS.md](docs/LEARNINGS.md).
