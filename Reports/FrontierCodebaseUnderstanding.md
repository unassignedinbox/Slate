# Frontier (cleaner rebuild): codebase understanding

**Source:** `SultanAladin/Frontier`, branch `arena/73e163a3-frontier`, HEAD `ea2c748`. Cloned to `/home/user/ref/Frontier`.

## TL;DR

- Frontier is a general-purpose, cross-platform editor with reusable engine code. The legacy migration is complete.
- Rules are binding: Vulkan primary, Slang shaders, TOML via toml++ for C++ config, GLFW owns windows, Windows binaries by default.
- Scratch work goes in `_ClaudeScratch/` (never committed). Evidence goes in `Exhibits/`. No commit or push without instruction.
- A general 3D solid bevel, chamfer or fillet does **not** exist here. The closest pieces are a mesh bevel and 2D sketch fillets.

## 1. Mandatory reading and rules

`CLAUDE.md` and `AGENTS.md` both require reading four skill documents at session start. I read the opening sections
of all four, not the full text. The full text should be read before any naming, formatting or presentation work.

| Document | Governs |
|---|---|
| `EngineDocs/AgenticInstuctions/SKILL-Naming.md` | Names, banned vocabulary, name construction |
| `EngineDocs/AgenticInstuctions/SKILL-formatting.md` | Source and document formatting |
| `EngineDocs/AgenticInstuctions/SKILL-Emoji.md` | Approved emoji set only |
| `EngineDocs/AgenticInstuctions/SKILL-CompactOutputProtocol.md` | Tables and diagrams over prose |

Key rules from `CLAUDE.md` and `SKILL-Naming.md`:

| Area | Rule |
|---|---|
| Graphics | Vulkan primary; Slang shaders |
| Config | All engine-authored C++ config and serialisation is TOML via toml++; inspect existing codecs before adding a format |
| Windows | GLFW owns windows; Windows binaries by default |
| Content | Use `ContentDirectory` and `EngineContent/`. Do not add `AssetDirectory` or `UI/Assets/` |
| Third-party code | Under the ignored `ExternalPackages/` folder, pinned |
| Naming | Banned words include `Kernel`, `Core`, `Base`, `Data`, `Info`, `Manager`, `Handler`, `Controller`, `Service`, `Utility`, `Helper`, `Node`, `Module`, `Object`, `Commit`, `Parent`, `Child` (kinship words are barred as a category) |
| Evidence | Visible evidence under `Exhibits/`; never claim verification without a test |
| GitHub Actions | Ask first, unless the user explicitly authorises a specific run |

Note: recent commits on this branch carry CI-trigger tags such as `[skip ci]` and `[publish-windows-unsigned-preview]`.
Those tags are the repository's own mechanism. Do not trigger any workflow without approval.

## 2. Layout

| Path | Contents |
|---|---|
| `Engine/` | Reusable engine code: `ContentInterchange`, `Diagnostics`, `Interface`, `Lifecycle`, `Render` (blank by request, tracker 011) |
| `Internal/` | `Authoring`, `EngineContext`, `Graphics`, `Interface`, `Platform`. `Authoring` holds the CAD-adjacent code |
| `Executables/` | Applications: `Editor`, `ParametricSketcher`, `SimulationSandbox`, `TextureBake`, `TexturePaint`, `UVEditor`, `Validation` |
| `UI/` | `Editor`, `TextureStudio` |
| `Documentation/` | `Tracker.md`, `FolderStructure.md`, `Rules/`, `Plans/`, `Research/`, `Prototypes/` (includes `CadWorkspace.html`) |
| `EngineContent/` | Fonts (`FontArchives/`), icons (`Icons/`) |
| `EngineDocs/AgenticInstuctions/` | The four skill documents |
| `Exhibits/`, `SourceImages/`, `memory/`, `Automation/`, `Applications/`, `Experimental/` | Evidence, artwork, session memory, tooling, prototypes |

About 745 `.h` and `.cpp` files. The workspace-wide listing truncates, so use targeted `find` or `grep`.

## 3. Work tracker (`Documentation/Tracker.md`)

16 items. Status counts: 1 Intentional, 1 Excluded, 3 Partial, 4 Open, 7 checked or implemented.

| Status | IDs | Meaning |
|---|---|---|
| Open | 003, 004, 012, 013 | 003 prototypes live in Documentation; 004 inherited `Internal` tree needs an ownership audit; 012 imported naming and formatting violations; 013 source and artwork permissions need owner review |
| Partial | 001, 005, 006 | 001 UI imported, rest deliberately absent; 005 old maps and backlog conflict; 006 Windows binary and GPU checks pending |
| Excluded | 011 | Scene renderer. Render directory left blank by request |

## 4. CAD-relevant pieces

| File | What it does | Limit |
|---|---|---|
| `Internal/Authoring/ParametricAuthoring/Operations/Fillet/ParametricSketchFillet.{h,cpp}` | Fillets corners of 2D sketch curves | Sketch corners only |
| `Internal/Authoring/Modeling/Draughting/DraughtFillet.{h,cpp}` | Draughting-side fillet | Not examined in detail |
| `Internal/Authoring/PolygonAuthoring/Operations/Bevel/PolygonBevel.{h,cpp}` | Mesh bevel | Mesh only. Uses heuristic clamps and auto-merges welds. No exact B-rep |
| `Executables/Validation/SketchModelViewport/SketchModelFilletModal.{h,cpp}` | Fillet dialog for the sketch-model viewport | UI for the fillet above |
| `Documentation/Prototypes/CadWorkspace.html` | CAD workspace prototype (HTML) | Prototype only |
| `Documentation/REFERENCE-CadAnalyticPrimitives.md` | Reference notes on analytic primitives | Reference only |

**No general 3D solid bevel, chamfer or fillet exists in this repository.** The Frontier-side solid blend work is in the
older `Frontier-` repository, SolidArc (see `Reports/SolidBlendGeneralisation/REPORT.md`).

## 5. Hygiene issues found

- **Mojibake:** 27 of about 745 `.h` and `.cpp` files, plus some `.md` and `.slang` files, contain UTF-8 emoji that were
  decoded as Latin-1 (for example `ðŸ§©` where 🧩 should be). Fix as a separate change.
- **Commit tags:** see section 1 note on `[skip ci]` and publish tags.

## 6. What I have not done

- Have not built the cleaner repo. cmake is not installed in this sandbox, and the Vulkan and Windows targets were not tried.
- Have not read the full text of the four skill documents, and have not read the full Tracker plan files.
- Have not made any edit, commit or push in `Frontier`.
