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

## 4. Filesystem watching

The world is only rebuilt when a trove is opened. Changes made outside the app
are invisible until reopened. The `notify` crate on the Rust side, pushing
events to the frontend, would close this gap.

## 5. Performance on large troves

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
  drag-and-drop of one file costs a full round trip of the trove.

## 6. Open questions from `plan.md`

Still unanswered: whether file watching should be automatic or manual, and how
component settings should be validated when a component is attached to an entity
that cannot support it.
