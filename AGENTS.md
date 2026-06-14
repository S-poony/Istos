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

