# Working on DeskShell

This project is built by agents. If you find placeholders, hardcoded values, or
anything else that looks wrong, tell the user — they may not be aware.

## Read this first

| Document | What it is | Who owns it |
|---|---|---|
| [description.md](description.md) | The product idea, in the user's own words | Human — do not rewrite |
| [plan.md](plan.md) | The original skeleton plan | Human — do not rewrite |
| [DESIGN.md](DESIGN.md) | Architecture and the rules the code must follow | Agents — keep current |
| [docs/LEARNINGS.md](docs/LEARNINGS.md) | Mistakes already made, and their fixes | Agents — append |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What is planned next | Agents — keep current |

Before changing behaviour, check `DESIGN.md` for the rule you are about to
break. Before debugging tooling, check `docs/LEARNINGS.md` — the answer is
probably already there.

## Commands

```bash
npm start                  # Tauri dev window + Vite (this is the app)
npm run dev                # Vite only; this is tauri.conf's beforeDevCommand
npm test -- --run          # Frontend tests (vitest)
npx svelte-check           # Type-check the Svelte + TS sources
npm run build              # Frontend production build
cd src-tauri && cargo test # Backend tests
```

There is no `npm run check` script. Do not invent script names — read
`package.json` first.

## Conventions

- **Rust is the source of truth.** The TypeScript `World` is a read mirror
  rebuilt from `get_world_state`. Never let the two diverge silently.
- **Nothing is folder-specific.** Any entity can parent any other entity, so
  avoid folder-only naming, icons, or assumptions.
- **Filesystem and ECS move together.** A reparent that changes the on-disk
  location must update both, or reconcile them if one is already correct.
- **Long work never blocks the main thread.** Tauri commands that scan the
  filesystem or serialise the world are `async`.
- **Every user-visible outcome gets honest feedback.** Success, cancellation,
  and failure are three different toasts (see `src/lib/stores/toasts.ts`), and
  a toast is only shown once the thing it describes has actually happened.

## After a task

Update `DESIGN.md` if you changed a rule, append to `docs/LEARNINGS.md` if you
lost time to something avoidable, and prune `docs/ROADMAP.md` if you finished an
item. Keep this file short — it is read in full, every time.
