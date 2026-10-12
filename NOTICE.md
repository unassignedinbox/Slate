# Design reference and dependency notices

The requested design reference is [SultanAladin/Frontier-](https://github.com/SultanAladin/Frontier-), specifically the experimental browser editor under `Experimental/FrontierEditor` and its association with Project-Zero.

This Slate implementation uses that project's charcoal/card-based inspector as a design reference. It is a standalone browser application; no Frontier native engine sources, vendor icon files, or other repository assets have been copied into this checkout. The UI illustrations and procedural road/detail geometry in `src/` were implemented here. The Frontier name identifies the requested reference, not a claim of an upstream/native integration or endorsement.

Runtime dependencies include React, Three.js, Lucide React, and Fontsource-distributed DM Sans and IBM Plex Mono fonts. Their license files and notices are included in the installed npm packages. Development dependencies include Vite, Playwright, and Sparticuz Chromium. Keep the appropriate dependency notices when distributing a production build.
