# Slate — Agent Instructions

Vulkan-based engine and painting application. `Engine/` holds engine source, `Docs/` holds specification
and planning documents, `ExternalPackages/` holds vendored dependencies (never edit).

---

## 🔴 Read before writing code — and only then

These files are authoritative and override all defaults. Read them **before the first line of C, C++,
shader, or engine Markdown you produce** in a session:

- `AgenticInstuctions/SKILL-Naming.md` — ALL naming (banned words + how to construct a name)
- `AgenticInstuctions/SKILL-Formatting.md` — formatting, alignment, and the approved emoji whitelist

**Do not load `AgenticInstuctions/SKILL-ResearchFirst.md` or `Mimo.md`.** Those are for the
Mimo general-purpose agent only. This file is for code work only.

**Do not read them for non-code work.** Questions, explanations, planning discussion, file searches,
and chat-only answers do not touch these files. The trigger is *generating code or engine documents*,
not *talking about them*.

Once read, they bind everything downstream: identifiers, folder names, headers, alignment, emoji.
Check output against them before returning it.

---

## 🔴 Scratch folder — keep the workspace clean

All disposable agent output goes in `_AgentScratch/` — never beside source, never at repo root.
`logs/` (build logs, command output) · `build/` (throwaway `.obj`, compile probes) · `tmp/` (staging,
scratch `.cpp`, experiments, self-invented probes and drivers).

- Fully git-ignored; nothing in it is ever committed.
- A requested prototype is **not** scratch — write it to its real destination directly. Never leave the
  only copy of a deliverable in scratch.

---

## 🔴 Where documents may be written

Plans, notes, reports, and summaries go in chat. Write a file only on explicit instruction.
`AgenticInstuctions/` holds skill files only — nothing else goes there.

`Docs/Technical Engine Directory Structure & Architectur.md` is the layer map (L0…L6). Stay close to it
and update it whenever a folder or subsystem is added, moved, or renamed.

### 🔴 README discipline — stop the sprawl

- A README is written **only** to explain **how to use** an entity / subsystem / tool we deliver — nothing
  else. One README per delivered thing, living in `Docs/`. Do not scatter READMEs beside source, at repo
  root, or inside content folders, and do not invent a new README for scratch, probes, or intermediate work.
- Everything else — what has been done, what was tried, what did not work, what was rejected, performance
  measurements with the **date** each was taken, and any important notes — goes in a **notes** document in
  `Docs/`, alongside any relevant images. Keep it factual and dated; do not open a fresh file per attempt.

### 🔴 Plans live in `Plans/`, sorted by standing

Plans are the one document family that is filed rather than kept in chat, and each belongs in exactly one
subfolder by its current standing:

| Folder            | Holds                                                              |
|-------------------|-------------------------------------------------------------------|
| `Plans/Ongoing`   | Plans actively being worked                                         |
| `Plans/Completed` | Plans whose work has shipped (dated when it moved here)             |
| `Plans/Deferred`  | Plans intentionally postponed (for example deferred fuel/thermal)  |
| `Plans/Research`  | Research and investigation notes that precede a plan               |

When a plan changes standing, **move the file** between these folders rather than leaving a stale copy.

---

## 🔴 Projects and shared facilities

- `Projects/` is where projects go. Each project owns its `ProjectName.frontier` specification, content, and
  project-specific code image. It is never a copy of another project.
- `Frontier.exe` is the sole windowed host. It owns the window, device, renderer, global editor, input, camera,
  celestial environment, and shared engine facilities. A project never owns a windowed `main` or its own renderer.
- A project DLL crosses the versioned `CodeInterchange` C ABI. It carries only project-specific scene construction,
  simulation, camera behaviour, and editor panels. Changing it must not rebuild shared engine translation units.
- `Project-Zero` is a project opened by Frontier, not a host source donor. Do not copy `GameExecution.cpp`, use
  `PROJECT_ZERO_SOURCES`, include another project's source, or launch a new project through Project-Zero.
- The migration is active in the build routes: create and open projects through `Frontier.exe ProjectName.frontier`.
  `Tools/Build/ProjectOwnershipChecks.py` rejects a returned project windowed entry, copied `GameExecution.cpp`,
  `PROJECT_ZERO_SOURCES` reuse, project-to-project source include, or a non-Zero specification that resolves through
  Project-Zero.
- Shared authoring tools used to make content, not shipped in a project, live under `Engine/AuthoringTools/`.
  Example: SolidArc lives at `Engine/AuthoringTools/SolidArc`; project content and scripts consuming it stay with
  that project.

---

## 🔴 Visual proof for every C++ class / entity added to a project

Every time a C++ class or entity is added to a project, deliver a **visual proof** in `VisualProof/<Feature>/`
— a rendered image, a log, or some other visible artefact that shows the thing actually working. "It
compiles" is not proof. The proof is a CPU mirror where possible (dependency-free, no window), and it
self-checks so a regression fails loudly.

---

## Build & tooling

- **Shell = PowerShell.** Run every `.bat` and `.ps1` through the PowerShell tool, never Bash (Bash
  mangles Windows paths and `cmd` parsing). Use PowerShell syntax (`$env:VAR`, `$null`).
- Build configuration is build-system agnostic (`Module.toml` + orchestration scripts). CMake is not
  used.
- 🔴 **When you change the build, update every toolchain — not just CMake/g++.** The primary target is
  **MSVC** via the PowerShell orchestration scripts. Adding a source, include path, define, or link
  library to one toolchain and forgetting the MSVC path is the single most common way a build breaks on the
  user's machine. A build change is not done until the MSVC path, the `Module.toml`/orchestration path, and
  any CMake/g++ helper paths all carry it.
- Ask before building or running any test, probe, or validation executable. "It compiles" is not a
  deliverable unless it was asked for.

---

## C++ & Architecture Rules

- C++20 standard, `/MD` in every configuration, `SLATE_DEBUG` for debug selection, `_DEBUG` never.
- Every exported computation carries `SLATE_DECLARES_PRECISION(...)` naming what it claims and what it consumes. The transitivity rule is a `static_assert`, not a review item.
- Identities are `Identity<Subject>` with distinct tags. A `PartitionIdentity` must not be passable where an `OwnerIdentity` is expected — conflict 15 was exactly that mistake surviving the whole series.
- Absence carries a reason. Use `Deliver<T>` with a `Refusal`, not `std::optional`, wherever a document says something is rejected or reported.
- A `Convergent` computation returns `ConvergentResult<T>` and never a bare value. `02` §5: a solver that returns its last iterate at the ceiling is indistinguishable from one that converged.
- Prefer `constexpr` and compile-time checks over runtime validation wherever a gate can be expressed that way. Half of `00` §11 is mechanisable in the type system.
- No exceptions across a unit seam. No `new`/`delete` outside an extent slicer.
- Vendor spellings are verbatim: `VkBuffer`, `VkPipeline`, `ImDrawData`.
- Do not reference any rules outside of the project or memory.
- 🚧 **Direction: one engine binary; projects are opened by it.** `Frontier.exe` bundles shared engine facilities
  once and opens `ProjectName.frontier`. Project-specific C++ arrives through a versioned project DLL, so editing a
  project does not rebuild the engine executable. `Project-Zero` is one project, never another project's host.
  The implementation sequence and C ABI guarantee are in
  [`Plans/Ongoing/FrontierProjectLoadingMigration.md`](Plans/Ongoing/FrontierProjectLoadingMigration.md).

---

## Viewing HTML prototypes

Do not ask the user to load a sandbox dev server — the sandbox is wiped often and without warning, so the
server dies and the link rots. Commit the file, push the branch, then hand over a **raw.githack.com** link
pinned to the commit:

```
https://raw.githack.com/unassignedinbox/Slate/<commit-sha>/<path-to-file>
```

For example:

```
https://raw.githack.com/unassignedinbox/Slate/adb69a3e50f8e72f9cd305a7ff5649d3b192cb21/Exhibits/Workbench/SDFGlobalIllumination/SDFGlobalIllumination.html
```

Rules that follow from this:

- Pin the **commit SHA**, never a branch name. A branch link changes under the user's feet and will not match
  what was described.
- **Push before handing over the link.** githack serves from GitHub; an unpushed commit 404s.
- Anything the page loads must be **committed and referenced relative to the repository**, because githack
  serves the repository and nothing else. Fonts come from `Frontier/EngineContent/Fonts/`; a path that only
  resolves on a local server is a broken page.
- Re-issue a fresh link after every push. The old SHA keeps serving the old file, which is worse than a 404
  because it looks like the fix did not work.

## Verifying a prototype without a browser

The sandbox has no browser, and the Google and Playwright binary CDNs are blocked, so a prototype cannot be
screenshotted. Harness it in Node instead — but harness it against the **real library**:

- `npm install three@<version>` and import the genuine `three`, `OrbitControls` and `RoomEnvironment`. Stub
  **only** the WebGL context and the DOM, because the sandbox genuinely has neither.
- Never hand-write a stub of a third-party class. A stub written to match the code under test cannot fail.
  `controls.userData = {}` once hid a `TypeError` that left the whole page blank, because `OrbitControls`
  extends `EventDispatcher` and has no `userData`.
- Say plainly what was verified and what was not. "The geometry is correct and the module initialises" is not
  "it looks right".

## Do not pass a displacement off as topology

A regular grid wrapped into a torus is watertight no matter what you do to it, so a zero boundary / zero
non-manifold audit on one proves nothing at all. When the task is to build geometry *as a modeller would*,
gate the thing that actually distinguishes the two:

- Does the authored curve **place** the geometry, or is it merely sampled onto a fixed grid? Count how many of
  the curve's nodes have a vertex ring on them.
- Are the walls **walls**? Measure the angle. A moulded tread block wall is 85–90°; a displaced heightfield
  produces 50–60° ramps.
- Report both numbers next to the manifold audit, and never report the manifold audit on its own.

---

## Design references

- **Entity + Editor System** — [`Docs/EntityEditorSystem.md`](Docs/EntityEditorSystem.md)
  How every entity we add carries its editor-side presence: user-chosen SVG icon + folder, a user-designed
  inspector (declarative slider components or a hand-drawn panel), and an optional dedicated editor window that
  opens the entity in isolation (Unreal asset-editor style). All `#if FRONTIER_EDITOR`-guarded, compiled out of
  shipping. Design only — no code yet.
- **Rendering pipeline report** — [`Docs/RenderingPipelineReport.md`](Docs/RenderingPipelineReport.md)
  What the frame is made of (the ReSTIR kernel is 92–99 % of it), why the Nanite/draw-call idea won't help here
  (cluster culling + indirect draws already exist), and where the real performance wins are.
