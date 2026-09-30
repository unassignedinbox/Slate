# Renderer backlog

This folder mirrors the render-finishing checklist in `FlattenedEngine/Docs/Roadmap.md` so project planning has one
readable, engine-owned account of outstanding work.

- `SectionE_OwnerList.md` — active native-host validation requirements for rows #29–#39.

## Evidence rule

The retired standalone CPU mirrors, custom evidence images, and patch bundles are not retained as validation evidence.
A CPU reference is labeled as a CPU reference. Render, editor, and motion evidence for Project-Zero and Project-Drive
must come from the shared `Frontier.exe` host and identify the project specification, scene, render mode, and capture
boundary.

## Priority

1. Run Project-Zero's authored 20 × 20 material scene through the shared host and capture visibility raster, Surfel
   GI, and ReSTIR from multiple native camera angles.
2. Integrate Project-Drive's authored scene through the same host, then capture vehicle materials, native editor
   structure, and live driving motion.
3. Validate the engine-owned `VK_KHR_ray_query` option on RT-capable hardware and preserve timing with native
   provenance.
