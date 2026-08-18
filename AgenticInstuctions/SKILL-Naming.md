# SKILL-Naming — Engine Naming Generation (Authoritative, Strict)

Never recall names from memory. Construct every name strictly from physical or mathematical mechanism.

Synced to `DOC/Foundation/04-UnitDirectoryStructure.md` §0 and `DOC/Foundation/00-DirectoryStructure.md`
§1.1, which are the current authority. Where an older document disagrees, this file wins.

## Generation Procedure

① State the physical mechanism in one plain sentence (memory layout, geometric transform, numerical
process, spatial relation).
② Extract the technical verb and the target noun; fuse them into a compound identifier that describes
the mechanism and reality, not the category.
③ Modules and folders MUST follow the two-word PascalCase formula `<Subject><Role>` using the closed
Role suffix list below and nothing else.

If a candidate is rejected at any gate, restart from step ①.

## Closed Role Suffixes — Final, 19 Entries

| Suffix           | Technical meaning                                                      | Owns memory |
|------------------|------------------------------------------------------------------------|-------------|
| `Sequence`       | Ordered workflow — strokes, layer order, revisions, poses               | Yes         |
| `Codec`          | Stream translation — image, vector, audio, binary                      | No          |
| `Exchange`       | Transfer across a system, vendor or hardware edge                      | Yes         |
| `Interchange`    | Standardised protocol or platform-abstracted translation               | Yes         |
| `Extension`      | A vendor-declared optional capability, negotiated and then held        | Yes         |
| `Solver`         | Equation systems — linear, constraint, unwrap, boolean                 | No          |
| `Integrator`     | Quadrature and accumulation — time stepping, coverage, moments         | No          |
| `Classifier`     | Geometric and statistical predicates                                    | No          |
| `Projection`     | Transform between spaces — geometric, spectral, colour                 | No          |
| `Specification`  | Parametric schema                                                       | Yes         |
| `Structure`      | Topology — B-rep, polyhedral, skeletal, sparse                         | Yes         |
| `Space`          | Spatial subdivision — tile, voxel, byte extent, recursive subdivision   | Yes         |
| `Index`          | Slot ledger — generational tokens, interning, spatial hashing          | Yes         |
| `Metrics`        | Diagnostic measurement — log sinks, markers, timing                    | Yes         |
| `Scheduler`      | Task and priority ordering                                              | Yes         |
| `Queue`          | Task execution — thread pools, command and event queues                | Yes         |
| `Panel`          | UI presentation — workspace, control, overlay                          | No          |
| `Host`           | Executable target entry point                                           | Yes         |
| `Depot`          | A store of derived, evictable, reconstructible artefacts keyed by content | Yes       |

`Extension` is narrow: it names a queried, enabled and owned optional vendor capability
(`DiagnosticExtension` holds `VK_EXT_debug_utils`). It is not a general spelling for "an edge" — use
`Exchange` for that.

## 🔴 Retired Suffixes — Never Use as a Role

`Boundary`, `Region`, and `Tree` are retired from the suffix list. `Boundary` named every category of edge
at once — OS, vendor, hardware, protocol — which made it the least informative suffix; it is replaced by
`Exchange` / `Interchange` / `Extension`, chosen by *what crosses*.

| Retired                      | Replacement                                                              |
|------------------------------|--------------------------------------------------------------------------|
| `Region` (allocation extent) | `Space` — a bounded storage extent that is sliced and reclaimed          |
| `Tree` (topology)            | `Structure` — for example `BoundingStructure`                            |
| `Tree` (recursive subdivision) | `Space` — for example `OctantSpace`, `AxisSpace`                       |
| `Boundary` (any edge)        | `Exchange` / `Interchange` / `Extension` per the table above             |

## Word Substitutions — Fixed Once, Mechanically

The addendum bans `Cadence`, `Binding`, `Submission`, `Footprint`, `Region`, `Tree`, `Vacancy`. It is
the later statement and it wins. Substitutions are fixed here rather than decided per module.

| Retired      | Replacement                | Mechanism the replacement states                      |
|--------------|----------------------------|--------------------------------------------------------|
| `Vacancy…`   | `Occupancy…`               | States the occupied set; the free set is its complement |
| `Binding…`   | `Descriptor…`              | Names the Vulkan object actually held                  |
| `Submission…`| `Command…`                 | Names what is recorded, not the verb                   |
| `Cadence…`   | `Cycle…` / `Slot…`          | Completion-ordered reuse, or one reusable position                               |
| `Footprint…` | `Extent…` / `Slot…`        | Measured extent, or the slot it occupies               |

## Recording Cycle Vocabulary

The recording cycle uses the following closed spellings. `Rotation` remains reserved for actual angular or quaternion mechanisms.

| Spelling | Mechanism |
|----------|-----------|
| `CycleScheduler` | Orders completion-gated reuse of recording slots |
| `CycleSlot` | Fence and semaphores ordering one reusable position |
| `RecordingSlotCount` | Number of reusable recording positions |
| `SlotOrdinal` | One position within that count |
| `RecordingOrdinal` | Monotonic recording number counted from bring-up |
| `PerSlot` | Content replicated once for every reusable position |
| `RecordedSlot` | Measurements retained for one reusable position |
| `TimestampsPerSlot` | Timestamp count claimed by each reusable position |
| `CompletedRecordings` | Number of recordings advanced since bring-up |

## Full Substitution Record

A search for a retired spelling must land here rather than returning nothing.

| Retired                    | Replacement              | Mechanism the replacement states                       |
|----------------------------|--------------------------|---------------------------------------------------------|
| `Layer0_HardwareBoundary`  | `Layer0_DeviceExchange`  | Records and control crossing the device edge           |
| `Layer0_PlatformBoundary`  | `Layer0_PlatformInterchange` | One translated surface over three operating systems |
| `Layer5_PresentationPanel` | `Layer5_DisplayPanel`    | What is shown, and the pacing that shows it            |
| `VulkanBoundary`           | `VulkanExchange`         | Loader C-ABI and device handles crossing the vendor edge |
| `DisplayBoundary`          | `WindowExchange`         | Native window handle ⇄ `VkSurfaceKHR`                  |
| `StorageBoundary`          | `StorageExchange`        | Byte ranges crossing from the storage device           |
| `DiagnosticBoundary`       | `DiagnosticExtension`    | An optional vendor capability, queried and held        |
| `FileBoundary`             | `FileInterchange`        | One stream surface over three file systems             |
| `DynamicBoundary`          | `CodeInterchange`        | Compiled code plus a verified interface hash crossing in |
| `LaneBoundary`             | `InstructionExchange`    | Selects an instruction-set specialisation at runtime    |
| `InputBoundary`            | `InputExchange`          | Timestamped device samples crossing in                 |
| `ClipboardBoundary`        | `ClipboardExchange`      | Text and imagery crossing to and from the OS           |
| `WindowBoundary` (UI)      | `WindowInterchange`      | One window surface over three window systems           |
| `TimelineBoundary`         | `TickSequence`           | Monotonically increasing ordering points               |
| `HeapSpace`                | `ByteSpace`              | Raw byte extents, sliced and reclaimed                 |
| `DeviceClassifier`         | `VendorClassifier`       | Scores vendor implementations into a capability set    |
| `RotationScheduler`        | `CycleScheduler`         | Orders reuse of N cyclic recording slots               |
| `PresentationSequence`     | `DisplayScheduler`       | Paces image transitions against a latency target       |
| `ViewportPanel` (Vulkan)   | `CameraPanel`            | Assembles multiple projections into one image          |
| `ViewportPanel` (UI)       | `WorkspacePanel`         | The workspace surface the artist works inside          |
| `ExecutionMetrics`         | `HardwareMetrics`        | Measures hardware execution duration and depth         |
| `FeedbackIndex`            | `RequestQueue`           | Device-written page demands, drained with latency      |
| `RequestScheduler`         | `PromotionScheduler`     | Budget-bounded promotion and eviction ordering         |
| `SelectionIndex`           | `IntersectionIndex`      | Which surface a pixel resolved to                      |
| `MembershipIndex`          | `EnrollmentIndex`        | Which slots are enrolled in a named subset             |
| `ArchiveInterchange`       | `FormatCodec`            | Versioned stream layout and migration                  |
| `ParameterSpecification`   | `PropertySpecification`  | Typed, named, validated property declarations          |
| `HistoryStack`             | `RevisionSequence`       | Ordered, scrubbable sequence of committed transactions |
| `BakeSpecification`        | `TransferSpecification`  | Parameters of a high-to-low geometric transfer         |
| `StampSample`              | `ImpressionSample`       | One resolved brush impression on the surface           |
| `AuthoringFrame`           | `AuthoringProjection`    | The view and projection matrices frozen at authoring time |
| `PredicateClassifier`      | `OrientationClassifier`  | Classifies sign of orientation determinants            |

## Fallible Return Vocabulary

These spellings are distinct mechanisms and never interchangeable generic return wrappers.

| Spelling              | Standing | Mechanism |
|-----------------------|----------|-----------|
| `Deliver<Content>`    | Approved | One fallible call either delivers `Content` or carries a `Refusal`. This is the public spelling; `ContentDelivery<Content>` is its contract-local declaration and is never named outside `DeliveryContract.h`. |
| `Response<Content>`   | Reserved | Content answering a previously declared request. It is not a general function return. |
| `Status<Content>`     | Reserved | A diagnostic reading observed at one declared instant. Its diagnostic subject must be stated before introduction. |
| `Expected<Content>`   | Reserved | Resource content anticipated from an asynchronous acquisition. Its pending, arrived and refused conditions must be specified before introduction. |
| `Resolution<Content>` | Reserved | Content produced by a declared resolution procedure. It applies only where `Resolve` is the actual technical operation. |

A reserved spelling records intent only. It must not enter C++ until its full mechanism, ownership and refusal behaviour are declared.

## Banned Words

Banned OO / AI tropes — Manager, Handler, Processor, Controller, Service, Utility, Helper, Node, Frame,
Module, Core, System, Backend, Pass, Stage, Harness, Shell, Entity, Element, Subsystem, Hierarchy, Data,
Info (use Information), Object, Item, Thing, Kind, Base, flag, state, value.

⚠️ `Kind` is banned in prose as well as in identifiers, because it is the word that gets reached for when a
mechanism has not yet been named. State the discriminating mechanism instead: a recording declares a `Command`,
a decal declares its `Source`, a layer declares its `Content`. Neighbouring vague spellings — `Type`, `Sort`,
`Variety`, `Flavour`, `Category`, `Class` used as a noun — carry the same defect and are rejected with it.

Banned family / kinship terms (whole category barred) — Parent, Child, Sibling, Sister, Neighbor,
Ancestor, Descendant, Orphan.

Banned structural words — Table, Map, Block, Digest, Model, Handle, Store, Bridge, Atlas, Substrate,
Fabric, Cache, Evaluator, Evaluate, Journal, Resolver, Mesh, Pool, Registry, Catalog, Repository,
Directory, Vault, Arena, Inventory, Ledger, Plan, Filter, Grid, Array, Dispatcher, Memory, Buffer,
Pipeline, Flow, Composite, Compose, Composition, Allocation, Shell, Tier, Nesting, Stratum, Mip,
Messenger, Probe, Blend, History, Bake, Stamp.

Banned addendum words — Cadence, Binding, Submission, Footprint, Region, Tree, Vacancy.

## Mathematical Vocabulary Exemption

A term is permitted anywhere — folder, file, type, function — when it names a *defined mathematical or
physical object* rather than a software category. A graph is the pair (V, E). A predicate is a function
into {true, false}. A quadrature is an approximation of a definite integral. Banning these does not
raise precision, it lowers it, because the replacement is always vaguer than the term it displaces.

Exempted under this clause — `Graph`, `Predicate`, `Quadrature`, `Interpolant`, `Field`, `Kernel` (the
convolution or integration kernel, never "the OS kernel"), `Partition` (domain decomposition), `Region`,
`Space`, `Tree`.

⚠️ The exemption is **narrow**. It licenses the term only where the mathematical object is genuinely what
is meant. `NodeGraph` is exempt; `SceneGraph` meaning "the scene manager" is not. `Predicate` in
`OrientationPredicate` is exempt; `PredicateHandler` is not. `Region` and `Tree` remain retired as *role
suffixes* regardless of this exemption — the exemption covers mathematical usage, not module naming.

Named individual exemptions — `UvSurfaceDepot` keeps `Surface`; `SpatialReach` keeps `Reach`.

## Formatting Rules

- ALL internal identifiers (folders, files, classes, variables, functions) use PascalCase.
- Zero shorthand — full words only: Parameter not Param, Windowing not Wsi, Allocation not Alloc,
  Specification not Spec, Information not Info.
- Zero single-letter names. Zero `k` constant prefixes — use `MinimumBoundary`, `ToleranceThreshold`.

## Identifier Rules

- Variables: never mirror the class type as the variable name. Forbidden `TopologyCluster
  TopologyCluster`; required `ActiveTopologyCluster` or `PrimaryTopologyCluster`.
- Instance suffixes: Instance, Entry, Slot.
- Booleans: never prefix with `is` / `has` / `can`. State the property directly as a noun phrase —
  `BoundaryCondition`, `ClosedEnabled`, `VisibilityEnabled`.
- Functions: PascalCase domain-specific technical verbs only — Solve, Integrate, Traverse, Construct,
  Resolve, Reclaim, Linearize, Classify, Project. CRUD and vague verbs are strictly banned — Get, Set,
  Process, Handle, Manage, Commit, Compose, Draw, Update, Evaluate.

## Variable Register

Sibling spellings reserved for *identifiers* — locals, members and parameters — so that a module name and
the things inside it do not collide. These are never folder names.

| Module         | Reserved identifier spellings                  |
|----------------|------------------------------------------------|
| `RequestQueue` | `RequestQueue`, `ReturnIndex`, `PageQueue`     |
| `BrickSpace`   | `SparseSpace`, `VoxelSpace`, `CellSpace`       |

`ReturnIndex` names the readback half specifically; `PageQueue` names the drained arrival order.
`SparseSpace` is the occupancy hierarchy, `VoxelSpace` the sampled lattice, `CellSpace` one brick's
interior subdivision.

## Gates

- Reject generic categories, framework jargon, and power words (Apex, Nexus).
- Subject uniqueness: a Subject word appears at most once within a given layer.
- Third-party API exemption: direct Vulkan / SDK calls mirror the vendor API verbatim (for example
  `VkDeviceCreateInfo`). All internal engine code enforces the full internal naming rules.

Purpose — every identifier and module folder must document its exact spatial, mathematical, or
structural mechanism.
