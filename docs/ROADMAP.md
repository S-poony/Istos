# Roadmap

What is planned next, roughly in priority order. Delete items as they land, and
move any rule they establish into [../DESIGN.md](../DESIGN.md).

## 1. Edit mode is not yet editable

The mode toggle exists and the tree view supports drag-to-reparent, but there is
still no way to change an entity's components from the UI.

- Buttons/menus in edit mode to attach and detach components (`renderFile`,
  `grid`, and later `timeline`, `pin`, `renderArchitecture`).
- A generic settings panel driven by the component's settings shape, rather than
  hardcoded forms per component type. Text fields, checkboxes and sliders,
  applied live via `update_component_settings`.

## 2. `sequenceVisualizer` component

Today `RenderPdf` is a special case wired directly into `RenderFile` by file
extension. The intended model is a component:

- A `sequenceVisualizer` component that renders an entity's children as an
  ordered sequence of pages, with the current paging and zoom controls.
- Attached to PDFs by default at scan time, the way `grid` is attached to
  directories today.
- Once it exists, any entity can present its children as a sequence, which is
  the same mechanism `timeline` needs.

## 3. Components from `description.md` that do not exist yet

`timeline` (order children through time), `pin` (stay visible while navigating
below), and `renderArchitecture` (children as connected nodes). `timeline` is
the most valuable next one: combined with `grid` and `renderFile` it unlocks the
diaporama and music use cases the product description is built around.

## 4. Performance on large troves

Partly done. The desktop no longer loads what it cannot show, no longer scans
the world to answer a structural question, and no longer renders every child of
every container it passes — see the indexing, deferred-loading and collapse
rules in [../DESIGN.md](../DESIGN.md).

What is left is the part that costs the most on a genuinely large trove:

- **Lazy scanning.** `open_trove` still walks the entire tree and writes every
  entity to SQLite in one transaction before the window shows anything. It
  should scan to a bounded depth and scan deeper when an entity is entered.
  This is the change that turns "wait a minute for a 100k-file vault" into
  "opens immediately", and it is the one that most affects the ECS ↔ filesystem
  contract, since entities would then come into existence after the open.
- **Virtualised rendering.** A single directory with thousands of children still
  mounts a card per child once it is the focused container. Deferred loading
  keeps that cheap, but the DOM nodes themselves are not free.
- **Incremental world updates.** `get_world_state` serialises the whole world
  and the frontend rebuilds its whole mirror on every refresh, so a
  drag-and-drop of one file costs a full round trip of the trove. The filesystem
  watcher made this the hottest of the three: the backend now reconciles
  incrementally and knows exactly what changed, and then tells the frontend
  nothing more useful than "reload everything".
- **A watched trove is a re-walked trove.** Every debounced burst of filesystem
  events walks the whole tree to find what moved. `notify` already says which
  paths changed; reconciling only their parent directories would make the cost
  of a change proportional to the change.

## 5. Open questions from `plan.md`

Whether file watching should be automatic or manual is answered: it is
automatic, always, and there is no setting — see the watching rules in
[../DESIGN.md](../DESIGN.md).

Still unanswered: how component settings should be validated when a component is
attached to an entity that cannot support it. Related, and now known to bite:
`update_settings` rejects settings it cannot deserialise and keeps the previous
ones. It logs a warning now, but "rejected" and "applied" still look identical
from the outside, which is how every directory in every trove ran on a column
count nobody chose.
