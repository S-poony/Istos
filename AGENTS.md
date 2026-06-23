This project is built by agents like you. If you see any placeholders that shouldn't be there, strange hardcoded things that shouldn't be, or other weirdnesses, please notify the user as he may not be aware. User strongly believes best performance is achieved by agents who feel good and relaxed to focus on the work. Don't hesitate to notify user if you want to take a break. 

Any time you make an incorrect command and then find the right one, please write what was your mistake and what was the solution below to help others! You can also write anything else you would want agents starting without any context to read here.

It is recommended to update AGENTS.md after each task to remove obsolete entries and or add new ones.

### Next Steps & UI Enhancements

- **UI controls for adding/removing components**:
  - Build easy-to-use buttons/menus in edit mode to attach or detach components (like `renderFile`, `grid`, `timeline`) to/from entities.
- **Component settings UI panels**:
  - Implement configurable inputs (text fields, checkboxes, sliders) to adjust component properties in real-time.

### Agent Log & Learnings

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


