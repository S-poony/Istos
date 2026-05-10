# DeskShell — Project Skeleton Plan

## Overview

DeskShell is a desktop shell that treats folders and files as an **Entity Component System (ECS)**.  
Built with **Svelte + TypeScript** (frontend) and **Rust** (backend via **Tauri v2**), with **SQLite** for persistence.

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

### 2.3 System

- A **System** is a function that runs on all entities matching a component query.
- Systems are registered in the World and run in order.

**Skeleton systems:**

| System | Query | Behavior |
|--------|-------|----------|
| `GridLayoutSystem` | entities with `grid` component | Computes positions for child entities based on grid settings. |
| `RenderSystem` | entities with `renderFile` component | Determines how to render each file (image, text, etc.). |

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

1. **Trove path**: Should the trove path be configurable at runtime (file picker) or set once in config?
2. **File watching**: For the skeleton, should we implement file system watching (e.g., `notify` crate) or just load once?
3. **Component settings UI**: For the skeleton, should we build a generic settings panel or hardcode the grid/renderFile settings?
4. **Image rendering**: For `renderFile`, should we support only images initially, or also text files and folders?

---

## 7. Next Steps

Once this plan is approved, the implementation will proceed in **Act Mode** following the steps above. The result will be a runnable Tauri v2 app with:
- A custom ECS core in both Rust and TypeScript
- `renderFile` and `grid` components working
- Edit mode / Live mode toggle
- SQLite persistence
- A basic desktop view rendering files in a grid