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

**Never `npm install` into this `node_modules` from a non-Windows machine.**
Installing a Linux-native binary (`@rollup/rollup-linux-x64-gnu`) to make the
suite run in a Linux sandbox made npm re-evaluate every optional platform
package: it created a directory for each one and left them all *empty*,
including `@rollup/rollup-win32-x64-msvc`. `npm start` then died with
`Cannot find module @rollup/rollup-win32-x64-msvc` — a message that blames npm's
optional-dependency bug and sends you off to delete `node_modules`, when the
real cause was a cross-platform install. `--no-save --no-package-lock` does not
protect against this; it only spares `package.json` and the lockfile.

To recover, `npm i` on Windows, or extract the package's tarball
(`npm pack @rollup/rollup-win32-x64-msvc@<version>`) straight into the empty
directory.

**The way to run the suite off-Windows: a scratch checkout, not a copied
`node_modules`.** Copying 288 MB of `node_modules` across a mounted Windows
filesystem takes minutes and often fails outright on symlinks. Copy only the
sources and configs into a local scratch directory and `npm ci` there — it takes
about five seconds and touches nothing the Windows install depends on:

```bash
D=$(mktemp -d) && cp package.json package-lock.json vite.config.ts \
  tsconfig.json svelte.config.js index.html "$D"/ && cp -r src "$D"/ \
  && (cd "$D" && npm ci && npx vitest run)
```

Re-sync with `rm -rf "$D/src" && cp -r src "$D"/` between runs.

**A suite that hangs at `RUN v4.x` is not always the pool.** The `vmForks`
warning below is real, but running vitest against a project on a *mounted
network filesystem* produces exactly the same symptom — no output for many
minutes, with the worker processes alive. Check where the project is before
suspecting the config.

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

**The `vmForks` pool hangs. `vite.config.ts` now uses `forks`.** With
`pool: 'vmForks'` the run sat at `RUN v4.x` forever without producing output;
`forks` runs the same suite in a few seconds. This was left as a known trap in
the config for a while, which cost everyone who then had to rediscover it —
recording a workaround is not the same as applying it. If a test run seems to
hang, check the pool before suspecting your test.

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

**A serde struct with one non-`Option` field nobody passes rejects the whole
object.** `GridSettings::draggable` was a plain `bool`, so the scan's
`{"columns": 3, "gap": 10}` failed to deserialise entirely, `update_settings`
swallowed the error, and every directory in every trove silently kept the
4-column default instead of the 3 the scan asked for. `#[serde(default)]` on the
field nobody mentions, and a `warn!` in `update_settings` so the next one is not
silent too.

**Clear the world after the scan succeeds, not before.** `open_trove_impl`
cleared first and then walked, so a folder that could not be read left the user
with an empty world and no way back. Walk, then clear, then build.

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

**`is_dir()` follows symlinks, so a directory walk can loop forever.** A link
pointing at one of its own ancestors is read again under a new path, creating
entities until memory runs out. Keep a set of canonicalised directories already
visited.

**`is_dir()` is also a syscall.** Calling it from inside a sort comparator makes
sorting one directory O(n log n) `stat`s. Read the flag once per entry — from
`DirEntry::file_type()`, which comes from the directory entry itself — and sort
precomputed tuples.

**`#[cfg]` on a block does not make it a tail expression.** Writing
`#[cfg(windows)] { spawn(...) }` as the last thing in a function discards the
value and the function returns `()`. Put each platform's logic in its own
`#[cfg]`-gated `fn` and call it.

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

**A clickable card swallows its own controls' clicks.** Once the card had an
`onclick` that focuses the entity, clicking the PDF's next-page button both
paged the document *and* navigated into the card. Guard with
`isInteractiveTarget` (`src/lib/interaction.ts`), and still call
`stopPropagation()` on the ignored click — skipping it just moves the same bug
onto the ancestor card.

**Measuring for layout: zero is not a size.** A `ResizeObserver` and
`clientWidth` both report `0` before layout. Treating that as a real measurement
made the PDF toolbar decide it had no room and hide itself on every mount — and
under JSDOM, which never lays out, it hid itself permanently and took the tests
with it. Ignore non-positive measurements and keep the pre-measurement default.

**Nested boxes stack their borders.** Giving every nesting level a padded,
bordered card produced a ladder of horizontal lines at the bottom of a deep
trove, one per level. Reserve the full box for the root and show nesting with a
`border-left` rail.

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

**`display: none` throws away a scroll position.** Hiding a view clamps the
shared scroll container to 0, and showing it again does not bring the position
back — the browser has nothing left to remember it with. Record `scrollTop` per
view on scroll and restore it after the switch, guarding the restore so the
scroll event it provokes cannot record a clamped 0 over the value being put
back. Under JSDOM `scrollTop` is permanently 0, so a test has to redefine the
property on the element to have anything to assert about.

**Two scroll containers, one page.** `.desktop-container` carried `height: 100%`
*and* `min-height: 500px`, so on a short window it outgrew the `<main>` it sits
in and both scrolled. Everything that reads or writes a scroll position then
disagrees with what the user is looking at.

**Do not unmount views to switch modes.** Toggling edit/live with `{#if}`
destroys and rebuilds every rendered file. Render both and toggle visibility
with a `.hidden { display: none !important; }` class. The same applies to
navigating between focus targets — see the view list in `Desktop.svelte`.

**A helper that scans is a helper that is called in a loop.** `getChildren`
walked every entity in the world to find one node's children, which reads as
harmless until you notice the desktop calls it once per rendered node on every
reactive tick. Index the structure once at load; the fix is smaller than the
comment explaining why it was needed.

**Returning a fresh array from a `$derived` rebuilds the DOM.** Even when the
contents are identical, a new array instance makes a keyed `{#each}` re-run and
tear down its blocks. Cache derived collections and return the same instance
until something actually invalidates them.

**An `$effect` that writes state it also reads loops.** Maintaining a list
inside an effect that reads the list makes every write schedule another run.
Wrap the list access in `untrack()` so the effect depends only on its real
inputs.

**`aspect-ratio` loses to `height`.** A card carrying both
`aspect-ratio: 16 / 9` and `height: 100%` in a grid row with
`align-items: stretch` gets its height from the row, so the aspect ratio never
applies and every card in a row is as tall as the tallest one. If cards should
size themselves, they need `align-items: start` and no explicit height.

**`repeat(N, …)` obeys N at any cost.** A fixed column count has no way to say
"not below this width", so nesting multiplies the divisor and cards become
slivers. `repeat(auto-fill, minmax(min(max(floor, ideal), 100%), 1fr))` treats
the configured count as a ceiling and the floor as non-negotiable — and needs no
measurement, so there is no reflow on mount.

**`display: none` does not stop an `IntersectionObserver` from having already
fired.** Gate loading on the *first* intersection and unobserve, rather than
tracking visibility continuously; otherwise hiding a view and showing it again
reloads everything it holds, which is the opposite of the intent.

**Give JSDOM an `IntersectionObserver` that says "visible".** Without the API,
`typeof IntersectionObserver === 'undefined'` is the only signal, and every test
asserting on a card's contents depends on the fallback being "show it". The mock
in `src/__tests__/setup.ts` reports intersection on `observe()` by default;
`deferVisibility(true)` holds it back for tests that are about deferral.
