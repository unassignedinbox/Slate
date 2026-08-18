# Slate — Agent Instructions

Vulkan-based engine and painting application. `Engine/` holds engine source, `DOC/` holds specification
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

`DOC/Technical Engine Directory Structure & Architectur.md` is the layer map (L0…L6). Stay close to it
and update it whenever a folder or subsystem is added, moved, or renamed.

---

## Build & tooling

- **Shell = PowerShell.** Run every `.bat` and `.ps1` through the PowerShell tool, never Bash (Bash
  mangles Windows paths and `cmd` parsing). Use PowerShell syntax (`$env:VAR`, `$null`).
- Build configuration is build-system agnostic (`Module.toml` + orchestration scripts). CMake is not
  used.
- Ask before building or running any test, probe, or validation executable. "It compiles" is not a
  deliverable unless it was asked for.

---

## C++ & Architecture Rules

- C++20 standard, `/MD` in every configuration, `SLATE_DEBUG` for debug selection, `_DEBUG` never.
- Every exported computation carries `SLATE_DECLARES_PRECISION(...)` naming what it claims and what it consumes. The transitivity rule is a `static_assert`, not a review item.
- Identities are `Identity<Subject>` with distinct tags. A `PartitionIdentity` must not be passable where an `OccupantIdentity` is expected — conflict 15 was exactly that mistake surviving the whole series.
- Absence carries a reason. Use `Deliver<T>` with a `Refusal`, not `std::optional`, wherever a document says something is refused or reported.
- A `Convergent` computation returns `ConvergentResult<T>` and never a bare value. `02` §5: a solver that returns its last iterate at the ceiling is indistinguishable from one that converged.
- Prefer `constexpr` and compile-time checks over runtime validation wherever a gate can be expressed that way. Half of `00` §11 is mechanisable in the type system.
- No exceptions across a unit seam. No `new`/`delete` outside an extent slicer.
- Vendor spellings are verbatim: `VkBuffer`, `VkPipeline`, `ImDrawData`.
- Do not reference any rules outside of the project or memory.

