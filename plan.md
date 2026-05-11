# DeskShell — Project Skeleton Plan

## Overview

DeskShell is a desktop shell that improves on the desktop concept by treating folders and files as an **Entity Component System (ECS)**, allowing special rendering attributes and custom layouts.  
Built with **Svelte + TypeScript** (frontend) and **Rust** (backend via **Tauri v2**), with **SQLite** for persistence.

The system treats all files as entities that can be parents of other entities, enabling complex media combinations (e.g., images arranged in time create diaporamas with music and subtitles). Changes to the entity architecture translate to the OS file system where possible.

The goal is to allow users to create custom static websites directly from their computer files, with an **edit mode** for configuring entity architecture and component settings, and a **live mode** for navigating the resulting website.

---

## 1. Project Structure

```
deskshell/
├── src-tauri/                  # Rust backend (Tauri v2)
│   ├── src/
│   │   ├── main.rs             # Tauri entry point
│   │   ├── lib.rs              # Library root, module declarations
│   │   ├── ecs/                # Custom ECS core (Rust)
│   │   │   ├── mod.rs
│   │   │   ├── entity.rs       # Entity ID type & store
│   │   │   ├── component.rs    # Component trait & registry
│   │   │   ├── system.rs       # System trait
│   │   │   └── world.rs        # World: container for entities + components
│   │   ├── db/                 # SQLite persistence layer
│   │   │   ├── mod.rs
│   │   │   └── schema.rs       # Table definitions & migrations
│   │   └── commands/           # Tauri IPC commands
│   │       ├── mod.rs
│   │       └── trove.rs        # Trove (vault) commands
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                        # Svelte frontend (TypeScript)
│   ├── lib/
│   │   ├── ecs/                # ECS mirror (TypeScript)
│   │   │   ├── Entity.ts       # Entity ID
│   │   │   ├── Component.ts    # Component interface & registry
│   │   │   ├── System.ts       # System interface
│   │   │   └── World.ts        # World: entity/component store
│   │   ├── components/         # Svelte components
│   │   │   ├── Desktop.svelte  # Root desktop view
│   │   │   ├── RenderFile.svelte  # Renders a file entity
│   │   │   ├── Grid.svelte     # Grid layout for sub-entities
│   │   │   └── ModeToggle.svelte  # Edit / Live mode switch
│   │   ├── stores/             # Svelte stores
│   │   │   └── world.ts        # Reactive world state
│   │   └── types.ts            # Shared TypeScript types
│   ├── routes/
│   │   ├── +layout.svelte      # App layout (mode toggle, global styles)
│   │   └── +page.svelte        # Main page (renders Desktop)
│   ├── app.html
│   └── app.css
├── package.json
├── svelte.config.js
├── tsconfig.json
├── vite.config.ts
└── plan.md                    # This document
```

---

## 2. ECS Design (Custom, Lightweight)

### 2.1 Entity

- An **Entity** is simply a unique `u64` ID (Rust) / `number` (TypeScript).
- Entities map to filesystem paths (folders or files).
- All files are treated as entities that can be parents of other entities.
- The root trove folder is the root entity.

### 2.2 Component

- A **Component** is data attached to an entity.
- Components are stored in a `HashMap<EntityId, Vec<Box<dyn Component>>>` (Rust) or `Map<EntityId, Component[]>` (TS).
- Each component has a `type` string and a `settings` record (key-value pairs).

**Skeleton components:**

| Component | Settings | Description |
|-----------|----------|-------------|
| `renderFile` | `{ targetPath?: string, scale: number, position: {x, y} }` | Renders a file (self by default, or another entity). |
| `grid` | `{ columns: number, gap: number }` | Arranges sub-entities in a grid layout. |
| `renderArchitecture` | `{ layout: string }` | Renders sub-entities as connected nodes (e.g., mind map style). |
| `timeline` | `{ duration: number, loop: boolean }` | Orders sub-entities through time (e.g., for diaporamas or music). |
| `pin` | `{ visible: boolean }` | Keeps entity visible during navigation (e.g., headers/footers). |

### 2.3 System

- A **System** is a function that runs on all entities matching a component query.
- Systems are registered in the World and run in order.

**Skeleton systems:**

| System | Query | Behavior |
|--------|-------|----------|
| `GridLayoutSystem` | entities with `grid` component | Computes positions for child entities based on grid settings. |
| `RenderSystem` | entities with `renderFile` component | Determines how to render each file (image, text, etc.). |
| `TimelineSystem` | entities with `timeline` component | Manages time-based ordering and playback of sub-entities. |
| `PinSystem` | entities with `pin` component | Ensures pinned entities remain visible during navigation. |

### 2.4 World

- The **World** is the central container holding all entities, components, and systems.
- Provides methods: `create_entity()`, `add_component()`, `get_components()`, `query()`, `run_systems()`.

---

## 3. Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Svelte)                     │
│                                                         │
│  World (TS mirror)  ◄───  Svelte Stores  ───►  UI      │
│       │                                                 │
│       │ Tauri invoke()                                  │
│       ▼                                                 │
├─────────────────────────────────────────────────────────┤
│                    Backend (Rust)                        │
│                                                         │
│  Tauri Commands  ──►  World (Rust)  ──►  SQLite        │
│                           │                             │
│                           ▼                             │
│                    File System Watcher                   │
└─────────────────────────────────────────────────────────┘
```

1. **Rust backend** is the source of truth. It owns the ECS World and persists to SQLite.
2. **TypeScript frontend** mirrors the ECS state for reactive rendering.
3. On startup, Rust loads the trove, builds the ECS world, and sends the initial state to the frontend.
4. User interactions (edit mode changes) are sent via Tauri `invoke()` commands.
5. File system changes are detected by the Rust backend and pushed to the frontend.

---

## 4. Implementation Steps (Skeleton)

### Step 1: Scaffold Tauri v2 + Svelte project
- `npm create tauri-app@latest` with Svelte + TypeScript template.
- Configure `tauri.conf.json` for window title, permissions, etc.

### Step 2: Rust ECS core
- `entity.rs`: `EntityId` newtype, `EntityStore` (simple `HashSet<EntityId>`).
- `component.rs`: `Component` trait with `component_type()` and `as_any()` for downcasting.
- `system.rs`: `System` trait with `run(&self, world: &World)`.
- `world.rs`: `World` struct holding entities, components (`HashMap<EntityId, Vec<ComponentBox>>`), and systems.

### Step 3: Rust SQLite layer
- `schema.rs`: Create tables for entities and components.
- Basic CRUD: save/load world state.

### Step 4: Rust Tauri commands
- `trove.rs`: `open_trove`, `get_world_state`, `add_component`, `remove_component`, `update_component_settings`.

### Step 5: TypeScript ECS mirror
- Mirror the Rust ECS types in TypeScript.
- `World.ts` with the same API (create entity, add component, query).

### Step 6: Svelte UI (skeleton)
- `Desktop.svelte`: Root component, renders the grid of entities.
- `Grid.svelte`: CSS Grid layout for child entities.
- `RenderFile.svelte`: Renders a file (image preview for now, placeholder for other types).
- `ModeToggle.svelte`: Switch between edit mode and live mode.
- `+page.svelte`: Loads world state, renders Desktop.

### Step 7: Wire everything together
- On mount, frontend calls `invoke('get_world_state')` to load initial data.
- Edit mode changes call `invoke('update_component_settings', ...)`.
- Rust responds with updated state, frontend updates stores.

---

## 5. Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ECS location | **Dual (Rust + TS)** | Rust is source of truth; TS mirror enables reactive UI without crossing IPC boundary on every frame. |
| Component storage | **Vec of Box<dyn Component>** | Simple, flexible. Can optimize to archetypes later. |
| SQLite schema | **EAV (Entity-Attribute-Value)** | Fits the ECS model naturally. |
| Rendering | **CSS Grid + HTML/CSS** | Responsive, fast, leverages web platform. |
| Edit vs Live mode | **Svelte reactive switch** | Same components, different interactivity (draggable vs static, editable vs readonly). |

---

## 6. Questions / Open Items

1. **Trove path**: Should the trove path be configurable at runtime (file picker) or set once in config? (Currently set in config)
2. **File watching**: Not implemented yet. Should we add file system watching (e.g., `notify` crate) for live updates?
3. **Component settings UI**: Currently hardcoded for grid/renderFile. Should we build a generic settings panel?
4. **Image rendering**: Currently supports images only. Should we expand to text files, folders, and other types?
5. **Navigation in live mode**: How should users navigate the entity hierarchy in live mode (e.g., clicking folders to drill down)?

---

## 7. Current Status & Next Steps

The skeleton implementation **builds successfully** but is **not yet user-interactive**. The app runs but shows an empty world with no way for users to:
- Select or configure a trove folder
- Add components to entities
- Edit component settings

**What's implemented:**
- ✅ Custom ECS core in Rust and TypeScript
- ✅ `renderFile` and `grid` components (hardcoded in code, not user-addable)
- ✅ Edit mode / Live mode toggle (UI exists but no functionality)
- ✅ SQLite persistence (basic, but no data loaded)
- ✅ Basic desktop view (renders hardcoded entities if any)

**Immediate next steps to make it functional:**
- Implement `open_trove` command to load a folder from config or file picker
- Add UI buttons/menus to add components to entities
- Build basic settings panels for component configuration
- Populate the world with initial entities from the trove folder

**Future phases:**
- Implement additional components: `renderArchitecture`, `timeline`, `pin`
- Add file system watching for live updates
- Expand rendering support (text files, folders, etc.)
- Add navigation and interaction in live mode
- Optimize performance for responsive rendering