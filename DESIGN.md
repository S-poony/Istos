# Project Design Decisions & Architecture

This document serves as the single source of truth for the architecture, layout system, and integration decisions made across the DeskShell codebase. It provides guidelines and context for future enhancements and development by agent and human developers alike.

---

## 1. Layout & CSS Grid System

### Column Shrinking with Low Item Counts
- **Problem**: In a standard grid container (e.g., 4 columns), folders containing fewer items (like a single child) only occupy a fraction of the horizontal space, leaving empty columns. If that single child is a folder that also contains only one element, this effect compounds recursively, resulting in extremely tiny, squished inner containers.
- **Decision**: Dynamically scale the grid columns to match the item count when there are fewer children than the default/configured columns:
  ```typescript
  let gridColumns = $derived(
    children.length > 0 && children.length < columns ? children.length : columns
  );
  ```
- **Result**: Low-item and single-item folders collapse their grids to use fewer columns, allowing child items to naturally take up 100% of the available width, preserving readability and aspect ratios.

### Column Overflow prevention
- **Decision**: Avoid using `grid-template-columns: repeat(N, 1fr)` directly in nested layouts since `1fr` translates to `minmax(auto, 1fr)`. This prevents columns from shrinking below the content's intrinsic minimum size. Always use:
  ```css
  grid-template-columns: repeat(var(--grid-columns), minmax(0, 1fr));
  ```
  to allow columns to shrink to fit the parent boundaries.

---

## 2. Media Rendering & Aspect Ratio Spanning

### Media Dimension Detection & Aspect Ratios
- **Decision**: Use `onload` (for `img`) and `onloadedmetadata` (for `video`) events to dynamically classify media file dimensions as `portrait` or `landscape` (landscape wins on tie).
- **Height Constraints**:
  - Grid cells containing files use specific CSS aspects ratios and height bounds to prevent cards from stretching to match natural content dimensions (which breaks grid lines).
  - **Portrait**: `aspect-ratio: 3 / 4`, with a `min-height: 180px` and `max-height: 400px`.
  - **Landscape**: `aspect-ratio: 16 / 9`, with a `min-height: 120px`.
  - **Audio**: Minimum height of `54px`.

---

## 3. ECS Parenting & Serialization

### Generic Entity Parenting
- **Decision**: Do not assume folders have unique icons or folder-specific wrapper names. In our entity-component-system (ECS) model, any file/entity (e.g., an image) can hold other files. Wrap layouts in a generic `.entity-wrapper` with a header displaying the parent's filename/path or fallback `Entity #ID` without folder assumptions.

### Null vs Undefined Deserialization
- **Decision**: Rust's `Option::None` serializes to `null` in JSON. When parsing in TypeScript/JavaScript:
  - Filter out `null` during deserialization: `parentId !== undefined && parentId !== null`.
  - Use defensive checks in stores and components: `parentId === undefined || parentId === null` to reliably detect root entities. Strictly checking for `undefined` will break root rendering.

---

## 4. Tauri Integration & Native Configurations

### Native Drag-and-Drop Interception
- **Decision**: Tauri v2 captures window-level drag-and-drop events by default. This overrides and blocks standard HTML5 frontend drag-and-drop event handlers (showing a system-wide "stop sign" cursor).
- **Rule**: Explicitly disable native drag-and-drop in `src-tauri/tauri.conf.json` for the main window:
  ```json
  "dragDropEnabled": false
  ```

### Unit Testing commands with Tauri State
- **Decision**: Tauri commands accepting `State<'_, T>` cannot easily be instantiated directly in Rust unit tests.
- **Rule**: Extract core business logic to pure helper functions accepting standard references (e.g. `&mut World`, `&Connection`) and test those pure helpers rather than invoking the Tauri commands directly in tests.

---

## 5. Frontend Drag & Drop Event Handling

### Event Bubbling & Stop Propagation
- **Decision**: Restrict drag/drop handlers exclusively to row elements (`.tree-node`) in `TreeView`/`TreeNode` rather than parent wraps to avoid bubble-up overrides. Always call `e.stopPropagation()` in `handleDragOver` and `handleDrop` to isolate event scopes.

### Testing under JSDOM
- **Decision**: JSDOM lacks native `DragEvent` support and `clientY` mouse properties. 
- **Rule**: Mock DragEvents in Vitest using `Event` and inject mock coordinates:
  ```typescript
  const event = new Event('dragover', { bubbles: true });
  Object.defineProperty(event, 'clientY', { value: 150 });
  fireEvent(element, event);
  ```
- **Reactivity Flush**: Svelte 5 renders updates asynchronously. Always use `await tick()` in unit tests after firing drop/drag events to allow Svelte scheduler to flush updates before making DOM class assertions.
