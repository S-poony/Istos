# Learnings

Mistakes already made on this project, and what fixed them. Append here when you
lose time to something avoidable; the goal is that nobody pays the same cost
twice. Rules that constrain how the app must behave belong in
[../DESIGN.md](../DESIGN.md), not here.

## Tooling & environment

**Tauri dev command infinite loop.** Setting `"dev": "tauri dev"` in
`package.json` while `tauri.conf.json` sets `"beforeDevCommand": "npm run dev"`
recurses and hangs the machine. Keep `"dev": "vite"` and use a separate
`"start": "tauri dev"`.

**Verify npm scripts before running them.** `npm run check` does not exist.
Read `package.json` instead of guessing. Frontend validation is
`npm test -- --run`.

**Rust formatting may not be installed.** `cargo fmt -- --check && cargo test`
stops before the tests run if `rustfmt` is missing. Run `cargo test` on its own,
and install with `rustup component add rustfmt` if you need formatting checks.

**Cargo accepts one positional test filter.** `cargo test a b` fails. Use a
shared prefix (`cargo test test_move_`) or separate commands.

**PowerShell statement separators.** `npm install A && npm install B` fails in
older PowerShell. Use `;`, or install everything in one command.

## Testing

**Svelte 5 SSR / mount errors under Vitest.** `Cannot create proxy with a
non-object` and `mount(...) is not available on the server` mean Vitest resolved
the SSR entry point. Match Vite 6 with Vitest 3+ and set
`resolve.conditions: ['browser']` in `vite.config.ts`.

**The `vmForks` pool can hang.** With `pool: 'vmForks'` the run can sit at
`RUN v4.x` forever without producing output. `--pool=forks` runs the same suite
in a few seconds. If a test run seems to hang, try the pool before suspecting
your test.

**`vi.mock` factories are hoisted.** Referencing a file-scope variable inside a
`vi.mock()` factory throws `Cannot access '...' before initialization`. Declare
shared mocks with `vi.hoisted()` and destructure them.

**`vi.clearAllMocks()` keeps implementations.** It clears recorded calls only,
so a `mockImplementation` set in `vi.hoisted()` survives `beforeEach`. If a test
overrides an implementation, restore it in that test.

**PDF.js needs DOM globals that JSDOM lacks.** Importing `pdfjs-dist` under
JSDOM throws `ReferenceError: DOMMatrix is not defined` at module load. Polyfill
`DOMMatrix` and canvas `getContext` in `src/__tests__/setup.ts`. Return the mock
context directly — do not call through to JSDOM's unimplemented `getContext`, or
passing tests drown in warnings.

**Drag and drop under JSDOM.** There is no global `DragEvent` and no `clientY`.
Use `new Event('dragover', { bubbles: true })` with
`Object.defineProperty(event, 'clientY', { value })`, and `await tick()` before
asserting, because Svelte 5 flushes updates asynchronously.

**Keep the test database out of the scanned folder.** Creating the SQLite file
inside the temp directory being scanned makes the scanner index it as an entity.
Put it in a parent or sibling directory.

**Tauri commands taking `State<'_, T>` are not directly testable.** You cannot
construct a `State` wrapper. Extract the logic into a pure function over
`&mut World` / `&Connection` (as `open_trove_impl` and `move_entity_impl` do)
and test that.

## Rust / backend

**Entity ID `0` is a real ID.** ECS ids start at `0`, so `0` cannot double as a
"root" sentinel. Represent the root parent as `Option::None` / `null`.

**Windows path joining with an empty suffix.** `destination.join(suffix)` with an
empty `suffix` appends a trailing separator, turning a file path into a
directory-like path that then fails `exists()`. Use the destination as-is when
the stripped suffix is empty, and normalise legacy trailing separators when
reading stored paths.

**A no-op move must still reconcile parenting.** Returning early when source and
destination paths are equal leaves a stale `parent_id`, and the next reorder
fails with `Entity N is not a child of M`. Skip only the filesystem rename;
still update `parent_ids` and persist.

## Frontend

**`null` vs `undefined` across the IPC boundary.** Rust's `Option::None`
serialises to `null`. Checking only `parentId !== undefined` leaves
`parentId = null` on entities, and later `parentId === undefined` checks fail for
every root, so nothing renders. Filter `null` at deserialisation and use
`x === undefined || x === null` in stores and components.

**Entities do not carry their components.** `worldStore.entities.get(id)` returns
an `Entity` holding only `id` and `parentId`; `entity.components` is `undefined`
and `.map` throws. Use `$worldStore.getComponents(id)` or `getComponent(id, type)`.

**Tauri v2 swallows HTML5 drag and drop.** The webview-level handler is on by
default and produces a system-wide "stop" cursor. Set
`"dragDropEnabled": false` on the window in `src-tauri/tauri.conf.json`.

**Drag handlers belong on rows, not wrappers.** Handlers on `.tree-node-wrapper`
receive bubbled events from children and override the real drop target. Put them
on `.tree-node` and call `e.stopPropagation()`.

**Click handlers on nested wrappers need `stopPropagation`.** Without it a click
on a nested entity bubbles to its ancestor, whose handler runs last and wins, so
nested entities cannot be entered.

**Centring an overflowing flex item hides part of it.** With
`justify-content: center`, content wider than the scroll container overflows past
the scroll origin and the leading edge becomes unreachable. Give the child
`margin: auto` instead.

**`repeat(N, 1fr)` overflows nested grids.** `1fr` means `minmax(auto, 1fr)`,
which refuses to shrink below the children's min-content size. Use
`repeat(N, minmax(0, 1fr))`.

**`height: 100%` on media stretches grid rows.** Letting `img`/`video`/text fill
an unconstrained parent makes the parent adopt the content's intrinsic height,
producing thousand-pixel rows. Classify orientation on load and constrain the
card with an aspect ratio.

**Percentage heights on nested wrappers collapse them.** `height: 100%` plus
`min-height: fit-content` inside `minmax(min-content, max-content)` rows is
ambiguous and produces tall empty boxes that overflow. Use `height: auto;
min-height: 0;` and let `align-items: stretch` size the row.

**Flex children shrink by default.** `display: flex; flex-direction: column` on
`.desktop-container` squashes root entity wrappers into thin strips. Set
`flex-shrink: 0; height: fit-content` on `.entity-wrapper.root` and let the
container scroll.

**Do not unmount views to switch modes.** Toggling edit/live with `{#if}`
destroys and rebuilds every rendered file. Render both and toggle visibility
with a `.hidden { display: none !important; }` class.
