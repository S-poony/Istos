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

### The trove is watched, and reconciled rather than rescanned

The open trove is watched recursively (`src-tauri/src/watch.rs`, the `notify`
crate) and there is no way to turn that off. A file explorer showing a folder as
it was ten minutes ago is simply wrong, and a toggle would only make it wrong
silently.

**A change on disk reconciles the world; it does not rebuild it.** Entity ids
are what focus, the live view list and every stored `grid` order are written in
terms of, so clearing the world renumbers everything — and a file appearing in a
folder would throw the user out of wherever they were standing. `sync_trove_impl`
matches entities to disk **by their `renderFile` path**: a path still there keeps
its entity and its id, a new path gets a new entity, a vanished path loses one,
and parenting follows the disk. An entity with no path is not something the
filesystem can speak for and is left alone.

Four rules keep it safe:

- **One walk.** `scan_tree` is shared by `open_trove_impl` and `sync_trove_impl`.
  Two copies would drift, and the drift would read as entities that appear on a
  rescan and vanish on the next open.
- **A failed scan changes nothing.** An unreadable root returns `Err` before the
  world is touched — `open_trove_impl` clears only *after* the walk succeeds.
  An unplugged drive must not be data loss. A directory *inside* the trove that
  cannot be read is skipped with a warning instead, or one unreadable folder
  would mean a watched trove that can never reconcile again.
- **Bursts are one change.** Events are debounced to a quiet period; unzipping an
  archive is dozens of events and one reconciliation.
- **The watch ends before the world it describes does.** `open_trove` stops
  watching before it rescans, and a watch generation counter retires any worker
  still mid-debounce. A watcher reporting the old root against the new world
  would find that none of its paths match and reconcile the whole trove away.

Only structural events count — `Create`, `Remove`, `Modify(Name)`. A file's
*contents* changing does not change the entity graph, and reacting to it would
re-walk the trove every time an editor saves.

The backend emits `trove-changed` **only when something actually changed**,
carrying what changed; the frontend reloads its mirror. There is no toast: the
user did not ask for this, and the new card appearing is the feedback. If the
focused entity is gone, the user lands on the deepest step of the breadcrumb
trail that survived — usually the parent of whatever was deleted.

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

At scan time every directory gets `grid` **and** `renderFile`, so it is visible
as an item and as a container; **everything that is not a directory** gets
`renderFile`. Testing `is_file()` instead left sockets and other exotica with an
entity and no components at all — present in the world, invisible in every view.

The scan keeps a set of canonicalised directories it has already read.
`is_dir()` follows symlinks, so a link pointing at one of its own ancestors is a
cycle the walk cannot see: it reads the same directory under a new path forever,
creating entities the whole time. Canonicalising is the only form in which "have
I been here" is answerable.

Directory-ness and the sort key are read once per entry, never from inside a
comparator — `is_dir()` is a `stat` call, and asking for it during a sort turned
one directory into O(n log n) syscalls. It stays `is_dir()` rather than
`DirEntry::file_type()` on purpose: a link to a directory should be browsable
like the directory it points at, so the cycle is handled by remembering where
the scan has been, not by refusing to follow.

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
`update_component_settings`, `reorder_children`, `move_entity`, `open_path`,
`open_with`, `reveal_in_file_manager`.

One event goes the other way: `trove-changed`, emitted by the filesystem watcher
when the trove on disk stopped matching the world.

### The TypeScript mirror is indexed

Every question the renderer asks the world on a hot path is answered from an
index, not a scan. `getChildren` used to walk every entity in the world, and the
desktop asks it once per rendered node — so drawing a trove was quadratic in its
size. `World` maintains parent → children, entity → component type, and
component type → entities, and caches sorted children, ordered children and
display names.

The caches return **the same array instance** until something invalidates them.
That is a correctness rule as much as a speed one: a keyed `{#each}` over a
freshly built array re-runs on every reactive tick even when the contents are
identical, tearing down and rebuilding cards that never changed.

Anything that changes structure, ordering, or a component a name is read from
calls `invalidateDerived()`. Invalidation is wholesale rather than surgical —
loads, reparents and reorders are user-scale events, so precision would buy
nothing and could go stale.

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

**A grid's `columns` is a ceiling, not a count.** It says how wide a cell would
*like* to be; the grid then lays down as many cells of at least
`MIN_CARD_WIDTH` as genuinely fit, which is never more than the configured
number and is often fewer.

```css
--cell: max(
  var(--card-min),
  (100% - (var(--grid-columns) - 1) * var(--grid-gap)) / var(--grid-columns)
);
grid-template-columns: repeat(auto-fill, minmax(min(var(--cell), 100%), 1fr));
```

Obeying the count at any cost is what produced slivers: three columns inside
three columns inside three columns left each card a ninth of the window, and
because a card also had a minimum height, the only thing it could do as space
ran out was get thinner. The `max()` is the legibility floor; the
`min(…, 100%)` keeps a container narrower than one card from overflowing.

Scaling the ideal down to the child count is still right, so a container holding
one thing shows it at full width rather than in a lonely sliver:

```ts
let gridColumns = $derived(
  children.length > 0 && children.length < columns ? children.length : columns
);
```

**Cards size themselves, not their row.** `align-items: start`, and no
`height: 100%` on the card. `stretch` made a row as tall as its tallest member
and handed that height to everything in it, which meant `aspect-ratio` was
decorative and a text file beside a wide image was squeezed to a few unreadable
lines.

Root wrappers take only the space they need and never shrink
(`height: fit-content; flex-shrink: 0`). Nested wrappers use
`height: auto; min-height: 0` — percentage heights here produce tall empty boxes
that overflow.

### Running out of room: collapse, do not squeeze

Below `DENSE_WIDTH` there is no room for even one legible card, so the grid stops
drawing cards and draws rows: the same cards, marked `.dense`, with their bodies
omitted entirely and their captions kept. A card narrower than its own caption
costs more space than it conveys.

The measurement comes from a `ResizeObserver` on the grid itself, not from
nesting depth — depth is a poor proxy for space, and a container query could not
also stop the card from *loading* what it has no room to show. **A zero-sized
measurement means "not laid out yet", not "no room".**

A dense entity does not expand inline, for the same reason a deep one does not:
there is nowhere to put what is inside.

### Only the focused container renders everything

A nested container renders at most `MAX_INLINE_CHILDREN` children and offers the
rest behind a control that focuses it. The focused container is never capped —
it is the thing the user asked to look at. A directory of five thousand files
rendered as passing context is five thousand cards nobody requested.

### Nothing loads before it can be seen

A card does no fetching, decoding or PDF parsing until it comes near the
viewport (`src/lib/visibility.ts`, one shared `IntersectionObserver` for the
whole app). Two rules keep it honest:

- **Visibility is one-way.** The observer stops watching after the first hit, so
  a card that scrolls away — or whose view is hidden while the user looks
  elsewhere — keeps its work. Unloading on exit would mean navigating back
  re-fetched everything, which is the cost the mechanism exists to avoid.
- **No observer means visible.** JSDOM cannot answer the question, and a test
  that renders a card still expects to see its contents. Guessing "hidden" would
  also hide content from a real browser lacking the API, which is the worse of
  the two failures.

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
- **A PDF card takes the same floor as a text card** (`.pdf-file`, 240–520px,
  above every orientation default). A PDF card is not a picture of a page: it
  carries a toolbar under the page and a caption under that, out of the same
  box. At the 120px landscape floor the viewer ended up shorter than its own
  toolbar needs and dropped it entirely, leaving a page the user could neither
  read nor turn.

**A PDF card must have a definite height in every context, because the viewer
inside it has no intrinsic size.** It measures its box and renders the page to
fit, so a card sized by its content is a feedback loop — the card is as tall as
the canvas, the canvas is drawn to fit the card, and each pass rounds down. A
PDF drawn at the top level of a trove shrank a little more every time it was
looked at. This is why the PDF rule is a bare `.render-file.pdf-file` and not a
`.grid-container >` selector: a card is a child of a grid *or* of the view, and
the ones in the view had no height rule at all. Every other kind of content can
be sized by its container; this one cannot.

**A focused card is the whole view and is sized as one.** A focused PDF gets a
definite `78vh`, so opening it means the page fills the window rather than a
card-sized box of it. The selector needs both halves
(`.desktop-view > … .focused`): the view the user came from is still mounted,
and the same card is still in its grid there.
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

### The context menu

Right-clicking any card, container or tree node opens one menu: **Open**, **Open
with…**, **Reveal in Explorer**. It follows the same innermost-wins rule as a
left-click — the handler stops propagation, so right-clicking a card inside a
container is not a request for the container's menu — and it does not also
navigate.

**There is one menu, at the app root.** Cards publish to `contextMenu`; they do
not each own a menu. A menu per card is a component and a set of listeners per
entity, for a thing the user sees one of at a time.

An entity with no `renderFile` path has no file for the system to act on. The
menu still opens, with its items disabled and a line saying why — a right-click
that does nothing at all reads as a broken app.

Only failures are announced. The window that opens is its own confirmation, and
a toast for every open would be noise; a failure is invisible without one.

The three system commands live in `src-tauri/src/commands/system.rs` and use
`std::process::Command` per platform rather than one shared call, because the
correct incantation differs enough per platform that hiding it would be a lie.
Exit status is never inspected: `explorer.exe` returns non-zero even when it has
done exactly what was asked.

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

**Navigating does not destroy what it leaves behind.** Each focus target is a
view, and visited views stay mounted and hidden — the same trick the mode toggle
uses. Swapping a keyed `{#each}` on focus tore down every card on the desktop,
so stepping into a folder and back re-fetched every text file, re-decoded every
image and re-parsed every PDF that had been on screen a moment earlier.

Three rules keep that from becoming a leak:

- **Bounded.** Past `MAX_LIVE_VIEWS` the least recently visited view is dropped,
  never the one on screen. Keeping every view ever opened would hold a whole
  trove's media in memory, which is the problem the mechanism solves.
- **Pruned.** A view whose entity no longer exists — a new trove, a move — is
  dropped. The trove root always survives.
- **Never reordered.** Recency lives in a plain map beside the array, because a
  keyed `{#each}` that reorders moves real DOM nodes, and there is no reason to
  move a hidden subtree to record that it was visited recently.

The effect that maintains the list reads focus and the world and **`untrack`s
the list itself**. Reading it reactively would make the effect depend on its own
output: every write would schedule another run, which would write again.

**Scroll position is part of a view, and has to be carried by hand.** All views
share one scroll container and a hidden view is `display: none`, so while a
short view is on screen the container has nothing left to scroll and the browser
clamps it to 0 — the position the user was at is not something the DOM keeps.
`Desktop.svelte` records it on scroll, per view, and restores it after the view
list has reached the DOM. Two details: the restore is guarded so the scroll
event it provokes cannot record a not-yet-laid-out position over the one being
restored, and a view dropped from the list drops its remembered position with
it, since it will be rebuilt from scratch anyway.

There is exactly **one scroll container in live mode**. A `min-height` on
`.desktop-container` made it taller than the `<main>` holding it on a short
window, so the desktop scrolled in two places at once.

`MAX_DEPTH` applies to **live mode only**. The tree view is finite and safe to
expand to any depth, and never replaces a node with a summary — but only its top
level starts open. Expanding everything meant opening a trove mounted a node per
file before the user had asked to see any of them. Manual expansion and collapse
are preserved for as long as a node lives.

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
