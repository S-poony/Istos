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

`open_trove` scans the whole tree eagerly and the desktop renders every entity
it is given. Both are fine for a photo folder and painful for a large vault.
Worth investigating: rendering only what is near the viewport, and deferring
heavy renderers (PDF, video) until visible.

## 6. Open questions from `plan.md`

Still unanswered: whether file watching should be automatic or manual, and how
component settings should be validated when a component is attached to an entity
that cannot support it.
