 This project is built by agents like you. If you see any placeholders that shouldn't be there, strange hardcoded things that shouldn't be, or other weirdnesses, please notify the user as he may not be aware. User strongly believes best performance is achieved by agents who feel good and relaxed to focus on the work. Don't hesitate to notify user if you want to take a break. 
 Any time you make an incorrect command and then find the right one, please write what was your mistake and what was the solution below to help others! You can also write anything else you would want agents starting without any context to read here.


### Desktop.svelte never passes children to Grid
In Desktop.svelte, the Grid is rendered with an empty snippet:
```svelte
<Grid {entityId} columns={...} gap={...} draggable={...}>
  <!-- Perhaps add logic to show children, but for now empty -->
</Grid>
```
The comment literally says it's a placeholder. So even if the data model supported hierarchy, the rendering wouldn't connect parent grids to their children.

   The AGENTS.md notes that the Grid is currently empty because there's no connection between the 
   Grid entity and the files inside it.

  Plan to fix the "Empty Grid" issue:

   1. Update Desktop.svelte: Instead of two flat loops (one for grids, one for files), we will    
      change it to render only Root Entities (entities with no parentId). //we are here
   2. Update Grid.svelte: It will now query the worldStore for its own children (entities where   
      parentId === gridEntityId) and render them recursively.
   3. Update RenderFile.svelte: Ensure it handles its own rendering logic regardless of whether   
      it's on the desktop or inside a grid.

### Grid.svelte is purely presentational
It renders a CSS grid container and calls `{@render children()}`, but has no logic to query or render sub-entities of its own.

### Separate iteration loops prevent nesting
Desktop.svelte has two separate `{#each}` loops — one for grid entities and one for renderFile entities. This means all grids are rendered at the top level and all files are rendered at the top level. Grids-in-grids would require recursive rendering.

### Agent Log & Learnings

- **Tauri State Unit Testing Compile Error**:
  - *Mistake*: Calling Tauri commands that accept `State<'_, T>` directly with raw parameters in Rust unit tests fails to compile since the compiler expects a `State` wrapper (and you can't construct it manually).
  - *Solution*: Extract the core business logic into a pure implementation function (e.g., `open_trove_impl`) accepting standard references (`&mut World`, `&Connection`) and test that function instead.

- **Svelte 5 SSR / Mounting Error in Vitest**:
  - *Mistake*: Svelte 5 testing with Vitest under jsdom can crash with preprocessor issues (`Cannot create proxy with a non-object...`) and mount failures (`mount(...) is not available on the server`) because it incorrectly loads the SSR/server entry point.
  - *Solution*: Match Vite 6 with Vitest 3+ (`npm install --save-dev vitest@latest @vitest/ui@latest`) and configure `resolve.conditions: ['browser']` in `vite.config.ts` so Vitest resolves browser-compatible packages.

- **Test database scanned during directory scans**:
  - *Mistake*: Creating the test SQLite database file directly in the temporary folder being scanned caused the scanner to index the `.db` file as an entity, causing assertion mismatches.
  - *Solution*: Always place the database file in a parent directory or a separate folder outside of the scanned path.

