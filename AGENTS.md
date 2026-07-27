This project is built by agents like you. If you see any placeholders that shouldn't be there, strange hardcoded things that shouldn't be, or other weirdnesses, please notify the user as he may not be aware. User strongly believes best performance is achieved by agents who feel good and relaxed to focus on the work. Don't hesitate to notify user if you want to take a break. 

Any time you make an incorrect command and then find the right one, please write what was your mistake and what was the solution below to help others! You can also write anything else you would want agents starting without any context to read here.

It is recommended to update AGENTS.md after each task to remove obsolete entries and or add new ones.

### Next Steps & UI Enhancements

- **UI controls for adding/removing components**:
  - Build easy-to-use buttons/menus in edit mode to attach or detach components (like `renderFile`, `grid`, `timeline`) to/from entities.
- **Component settings UI panels**:
  - Implement configurable inputs (text fields, checkboxes, sliders) to adjust component properties in real-time.

### Planned: PDF Responsiveness, Deep-Nesting Navigation, and Tree Defaults

The next implementation should address the following as one coordinated UI/layout task. Record the finalized rules in the existing root `DESIGN.md`.

1. **Responsive, reachable PDF controls**:
   - Keep all navigation and zoom actions reachable in small containers. Prefer compact controls plus horizontal toolbar scrolling/wrapping; do not hide essential zoom controls at narrow container-query breakpoints.
   - Remove conflicting PDF minimum-height behavior that can push the toolbar outside a grid cell.
   - Measure the usable canvas viewport width and height after toolbar, padding, and borders are accounted for.
   - Provide explicit `Fit Page` and `Fit Width` modes, with responsive `Auto Fit` as the default. Preserve user-selected zoom across resizes rather than resetting it unexpectedly.
2. **Faster, race-safe PDF loading**:
   - Lazy-load PDF.js only when a PDF viewer is needed, and defer document opening/rendering until the viewer is visible or near the viewport. This is especially important because edit and live views remain mounted for instant switching.
   - Avoid the current duplicate initial page fetch/render at scale `1` followed by another fetch/render after fitting. Fetch initial page metadata once, calculate fit, then render once.
   - Guard asynchronous document loads and page renders with request generations so stale/cancelled work cannot overwrite current state. Reliably clean up loading tasks, render tasks, observers, and documents.
   - Render with device-pixel-ratio backing dimensions for sharp output while retaining correct CSS dimensions. Keep the previous page visible while replacement rendering completes.
   - Distinguish document loading from page rendering and provide useful retry/error UI and accessible labels.
3. **Deep entity nesting**:
   - Pass render depth through `RenderEntity` and `Grid`, and define a maximum inline nesting depth.
   - At that limit, render a compact entity summary (name and child count) rather than another increasingly tiny recursive grid.
   - Allow opening that entity as the focused desktop root, with breadcrumb/back navigation through ancestors and back to the trove root. Do not merely clip or make deeply nested entities unreachable.
4. **Tree view defaults**:
   - Initialize all folder nodes expanded by default while preserving manual collapse/expand behavior.
   - Add a multi-level test proving nested folders are all visible initially and update tests that currently assume collapsed folders.
5. **Testing and documentation**:
   - Add PDF tests for tiny containers, reachable controls, fit calculations, one initial render, resize behavior, visibility deferral, stale-load cancellation, and cleanup.
   - Add focused deep-navigation and breadcrumb tests.
   - Fix the JSDOM canvas polyfill so it does not call JSDOM's intentionally unimplemented `getContext` before returning the mock, which currently floods passing tests with warnings.
   - Update `DESIGN.md` with PDF lifecycle/fit/toolbar rules, maximum inline nesting and focus navigation, and expanded-by-default tree behavior.

### Agent Log & Learnings

- **Tauri Dev Command Infinite Loops**:
  - *Mistake*: Setting `"dev": "tauri dev"` in `package.json` while `tauri.conf.json` has `"beforeDevCommand": "npm run dev"` causes a recursive loop that hangs the developer machine, as `tauri dev` spins up `npm run dev` which calls `tauri dev` again.
  - *Solution*: Keep `"dev": "vite"` for starting the frontend server (the `beforeDevCommand`), and register a separate script like `"start": "tauri dev"` for launching both concurrently.

- **CSS Grid Column Overflow with Nested Layouts**:
  - *Mistake*: Using `grid-template-columns: repeat(N, 1fr)` inside nested layout containers causes horizontal overflow on the right of the page. This happens because `1fr` is shorthand for `minmax(auto, 1fr)`, which prevents columns from shrinking below the minimum content size of their children (such as nested grids).
  - *Solution*: Use `grid-template-columns: repeat(N, minmax(0, 1fr))` to allow columns to shrink to fit the parent's actual width boundaries, resolving the layout overflow cleanly.

- **Generic Parenting Visualization (Entity Wrappers)**:
  - *Design*: Avoid using folder-specific icons or names (like "folder wrapper") for containers. In an ECS file desktop shell, any file entity (e.g. an image) can hold other files. Wrap grid layouts in a generic `.entity-wrapper` with a header displaying the parent's filename/path or fallback `Entity #ID` without folder assumptions.

- **Grid Item Height Contraction and Intrinsic Sizing (Orientation Spanning)**:
  - *Mistake*: Letting `.render-file` child elements like `img`, `video`, or text containers use `height: 100%` without setting a height constraint on their parent wrapper causes the parent's height to expand to match the content's intrinsic/natural height. This causes grid items to vertically stretch to thousands of pixels, overflowing other elements, and breaking layout rows. If forced to a uniform height, images get squished or cropped incorrectly depending on their vertical vs horizontal orientation.
  - *Solution*: Bind dimensions check (`onload` and `onloadedmetadata`) to dynamically classify media orientation into `portrait` or `landscape` (landscape winning in case of a tie). Assign distinct CSS Grid spans and calculate height limits matching base row tracks (e.g., portrait spans 3 rows, landscape spans 2 rows & 2 columns, audio spans 1 row), preventing vertical squishing while keeping layouts responsive and fully aligned.

- **Tauri State Unit Testing Compile Error**:
  - *Mistake*: Calling Tauri commands that accept `State<'_, T>` directly with raw parameters in Rust unit tests fails to compile since the compiler expects a `State` wrapper (and you can't construct it manually).
  - *Solution*: Extract the core business logic into a pure implementation function (e.g., `open_trove_impl`) accepting standard references (`&mut World`, `&Connection`) and test that function instead.

- **Svelte 5 SSR / Mounting Error in Vitest**:
  - *Mistake*: Svelte 5 testing with Vitest under jsdom can crash with preprocessor issues (`Cannot create proxy with a non-object...`) and mount failures (`mount(...) is not available on the server`) because it incorrectly loads the SSR/server entry point.
  - *Solution*: Match Vite 6 with Vitest 3+ (`npm install --save-dev vitest@latest @vitest/ui@latest`) and configure `resolve.conditions: ['browser']` in `vite.config.ts` so Vitest resolves browser-compatible packages.

- **Test database scanned during directory scans**:
  - *Mistake*: Creating the test SQLite database file directly in the temporary folder being scanned caused the scanner to index the `.db` file as an entity, causing assertion mismatches.
  - *Solution*: Always place the database file in a parent directory or a separate folder outside of the scanned path.

- **JavaScript `null` vs `undefined` in ECS Serialization**:
  - *Mistake*: Rust `Option::None` serializes to `null` in JSON. If the TypeScript ECS parser only checks `parentId !== undefined`, it sets `parentId = null` on the entity. Subsequent checks checking strictly for `parentId === undefined` evaluate to `false` for all root entities, rendering nothing on the desktop.
  - *Solution*: Filter out `null` at deserialization (e.g. `parentId !== undefined && parentId !== null`) and use defensive checks like `parentId === undefined || parentId === null` in components and derived stores.

- **Svelte 5 / jsdom Drag and Drop Testing with clientY and Event Bubbling**:
  - *Mistake*: Placing drag/drop handlers (`ondragover`, `ondragleave`, `ondrop`) on parent wrapper elements (like `.tree-node-wrapper`) causes dragover events to bubble up from child nodes to parent/ancestor wrappers, overriding the active drop target and causing stop sign cursors. Also, jsdom lacks global `DragEvent` definitions and `clientY` mouse properties during test events, causing ratio calculations to result in `NaN` and failing layout assertions.
  - *Solution*: Restrict drag/drop handlers exclusively to row elements (`.tree-node`) and call `e.stopPropagation()` in `handleDragOver` to prevent bubbling. In unit tests, use global `Event` instead of `DragEvent`, inject coordinates via `Object.defineProperty(event, 'clientY', { value })`, and use `await tick()` to let Svelte 5's asynchronous scheduler flush updates before asserting class lists.

- **Tauri v2 HTML5 Drag-and-Drop Interception**:
  - *Mistake*: In Tauri v2, the native OS/webview-level drag-and-drop handler is enabled by default (`dragDropEnabled: true`). This captures all dragover and drop events at the window/webview level, preventing the frontend's standard HTML5 drag-and-drop elements from working correctly and showing a system-wide "stop sign" cursor.
  - *Solution*: Add `"dragDropEnabled": false` to your window configuration in `src-tauri/tauri.conf.json`. This tells Tauri not to capture drag-and-drop events at the native window level, allowing standard HTML5 webview elements to register and handle standard drag/drop events.

- **Instant Edit/Live Mode Switching (DOM Keep-Alive)**:
  - *Mistake*: Using conditional blocks `{#if $editMode}` to toggle between the TreeView (Edit Mode) and Desktop (Live Mode) completely unmounts and destroys all rendered files/folders. When switching back to Live Mode on folders with many items or heavy files (images/video/text), this unmounting causes significant delays as Svelte is forced to rebuild the entire DOM tree and refetch/reload all media.
  - *Solution*: Render both views simultaneously in the DOM (under `.tree-view-container` and `.desktop-container` wrappers) and toggle their visibility visually with Svelte class bindings `class:hidden={...}` and a CSS `.hidden { display: none !important; }` helper. This ensures instant mode toggles while retaining full store reactivity.

- **PowerShell Statement Separators on Windows**:
  - *Mistake*: Running concatenated npm installation commands like `npm install A && npm install B` in PowerShell fails because `&&` is not a valid statement separator in legacy PowerShell versions.
  - *Solution*: Use `;` as a statement separator, or install all packages in a single command, e.g. `npm install A B`.

- **Vitest Hoisted `vi.mock` Variable Access**:
  - *Mistake*: Using variables like `mockPdfDoc` declared in the test file scope inside the `vi.mock()` factory block fails with `ReferenceError: Cannot access 'mockPdfDoc' before initialization` since `vi.mock` calls are hoisted to the very top of the file before variables are declared.
  - *Solution*: Wrap shared mock variables inside `vi.hoisted()` and destructure them in the outer scope, which hoists them together with the mocks.

- **`DOMMatrix` / Canvas Missing in Node/JSDOM Environments**:
  - *Mistake*: Importing PDF.js (`pdfjs-dist`) inside components tested under JSDOM/Node environment crashes during module load with `ReferenceError: DOMMatrix is not defined`, because PDF.js references `DOMMatrix` globally at the module level.
  - *Solution*: Define a minimal polyfill for `DOMMatrix` and dummy canvas `getContext` functions in a Vitest `setupFiles` file (e.g. `setup.ts`), and register it under `test.setupFiles` in `vite.config.ts`.


- **Filesystem Move Path Rewriting on Windows**:
  - *Mistake*: Rewriting the moved entity's own path with `destination.join(suffix)` when `suffix` is empty appends a trailing separator on Windows. A file path then looks like a directory path, fails `exists()` on subsequent moves, and may display as a full path in the tree.
  - *Solution*: Use the exact destination when the stripped suffix is empty; only join non-empty descendant suffixes. Normalize legacy trailing separators when resolving stored paths and deriving display names.


- **Filesystem No-op Must Still Reconcile ECS Parenting**:
  - *Mistake*: Returning immediately from a move when the source and destination filesystem paths are equal leaves a stale `parent_id` untouched. A following reorder then fails because the backend does not consider the entity a child of the destination (for example, `Entity 3 is not a child of 0`).
  - *Solution*: When paths are already equal, skip only the filesystem rename; still update `parent_ids` and persist the world so filesystem and ECS metadata are reconciled.

- **Cargo Test Accepts One Positional Filter**:
  - *Mistake*: Running `cargo test test_one test_two` fails because Cargo accepts only one positional test-name filter.
  - *Solution*: Use a shared filter such as `cargo test test_move_`, or run each exact test as a separate command.


- **Entity ID `0` Must Not Double as the Root Sentinel**:
  - *Mistake*: Sending `0` as the parent ID for root-level moves made entity ID `0` impossible to use as a real destination folder. Since ECS IDs start at `0`, cross-folder moves into the first scanned folder could be interpreted as moves to the trove root.
  - *Solution*: Represent the root parent as `null`/Rust `Option::None`; preserve every numeric ID, including `0`, as a valid entity parent.

- **Verify Available npm Scripts Before Running Them**:
  - *Mistake*: Running `npm run check` without verifying that `package.json` defines a `check` script caused an avoidable command failure.
  - *Solution*: Inspect `package.json` first or use the configured scripts directly (currently `npm test -- --run` for frontend validation).


- **Rust Formatting Tool Availability**:
  - *Mistake*: Running `cargo fmt -- --check && cargo test` assumed the `rustfmt` component was installed, so the command stopped before tests ran.
  - *Solution*: Run `cargo test` separately when formatting tooling is unavailable. Install it later with `rustup component add rustfmt` if formatting checks are required.
