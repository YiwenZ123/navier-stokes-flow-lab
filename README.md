# Navier–Stokes Flow Lab

Interactive, browser-based CFD demonstrations for learning incompressible Navier–Stokes time stepping, free-surface flow and one-dimensional linear advection.

[Live demo](https://navier-stoke.lovableglobe2.chatgpt.site/) · [中文说明](README.zh-CN.md) · [MIT license](LICENSE)

[Explicit time stepping](https://navier-stoke.lovableglobe2.chatgpt.site/explicit.html) · [Implicit MAC](https://navier-stoke.lovableglobe2.chatgpt.site/mac.html) · [Comparison](https://navier-stoke.lovableglobe2.chatgpt.site/compare.html) · [Wave impact](https://navier-stoke.lovableglobe2.chatgpt.site/waves.html) · [1D advection](https://navier-stoke.lovableglobe2.chatgpt.site/advection.html)

## Features

- A bilingual homepage presents the three-dimensional incompressible Navier–Stokes equations and introduces the teaching modules with screenshots of the working experiments.
- The homepage replays the wave lesson’s MAC dam-break simulation on a 120 × 60 grid, with water striking a fixed 0.70 m square obstacle. It uses precomputed solver frames so playback does not repeat the numerical solve.
- All five teaching modules use a collapsible parameter sidebar; hiding it keeps the current calculation and settings. Wide screens start open, while compact screens start closed. The modules remember wide and compact preferences separately, except for the sandboxed explicit animation: it keeps its current visibility until a reload or layout change.
- Explicit Navier–Stokes time-stepping animation with pressure iterations, workflow diagrams and equations.
- Implicit MAC projection for Navier–Stokes, including face-velocity and combined-velocity arrows.
- Comparison of these two Navier–Stokes solution methods at the same physical time, with selectable time steps, initial conditions and Jacobi / Gauss–Seidel / SOR iterations.
- A Navier–Stokes wave-impact application: a 2D tank with square, circular and triangular obstacle cross-sections, adjustable size and position, and three spatial resolutions.
- Free-surface, velocity and pressure views, pressure history, and force per unit span.
- A one-dimensional advection lab with 10 finite-difference schemes, five built-in profiles and a custom initial-condition curve editor. Adjust the grid, CFL number and positive or negative transport velocity; compare numerical curves with the exact solution.
- A draggable curve editor with smooth or linear interpolation, linked periodic endpoints, coordinate inputs, and undo/redo. Both schemes sample the same curve on the selected grid; editing restarts both calculations, and the curve is saved in the browser for the current site address.
- Export custom curves as JSON and import them on another device or site address. The file stores control points, interpolation and endpoint linking; import restarts both schemes at t = 0 while keeping the selected schemes, grid and time step.
- Advection error and mass diagnostics, a single-step stencil inspector, and CSV export.
- English and Chinese interfaces; English is the default.

## Run locally

No build step or npm dependencies are required. Use Python 3 to serve the static files:

```sh
git clone https://github.com/YiwenZ123/navier-stokes-flow-lab.git
cd navier-stokes-flow-lab
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

Open the [homepage](http://127.0.0.1:8000/) and choose a teaching module. The explicit time-stepping page is now [explicit.html](http://127.0.0.1:8000/explicit.html); the other module paths remain unchanged.

Serve the files over HTTP: opening an HTML file directly does not fully support the JavaScript modules and comparison worker. The explicit animation loads its pinned Floating UI and Lucide dependencies from a CDN, so that view requires network access for those resources. The other solvers run locally in the browser. Custom curves are stored per browser origin, including the port. A different local server address may start with the default curve; use JSON export/import to carry your curve across addresses or changing offline ports.

## Tests

Node.js 22 or later is required for the numerical checks. The release was verified using Node.js 24.19.0.

```sh
npm test
```

Individual checks are also available:

```sh
npm run test:iterations
npm run test:stability
npm run test:waves
npm run test:advection
npm run test:custom-profile
npm run test:curve-file
npm run test:home-wave
npm run check:grid
```

The tests cover iterative solvers, discrete pressure-projection identities, time-step comparisons, hydrostatic equilibrium, solid boundaries, particle collisions, wave-obstacle geometries, the one-dimensional advection schemes, and custom-curve interpolation and shared initial conditions, validated JSON curve import/export, and agreement of all 361 homepage replay frames with a fresh MAC solve.

## Project layout

- `dist/` — the directly served application, styles and solvers. `index.html` is the homepage; `explicit.html` contains the explicit time-stepping lesson.
- `tests/` — numerical checks using Node's built-in assertions.
- `scripts/sync-spatial-grid.mjs` — synchronizes the shared periodic grid with the sandboxed explicit animation.
- `scripts/generate-home-wave.mjs` — regenerates the homepage replay from the wave solver; run `npm run generate:home-wave` after changing that solver, then check `npm run test:home-wave`.
- `licenses/` — third-party license notices.

`dist/explicit-ns-animation.html` preserves the original Chinese animation. The enhanced animation is `dist/explicit-ns-presets.html`. Both retain their existing iframe sandbox and Content Security Policy.

## Numerical scope

These are educational demonstrations. The wave solver uses a staggered MAC grid, pressure projection, marker particles for the free surface, and a grid-aligned approximation of the obstacle. It models a fixed **2D cross-section**, with atmospheric pressure at the free surface and impermeable, free-slip solid boundaries.

Grid resolution, velocity interpolation and marker tracking introduce numerical error. Wave-impact pressures and forces illustrate trends; quantitative engineering predictions require convergence studies and experimental validation. The comparison page's growth thresholds are demonstration criteria, not general stability guarantees.

The advection lab solves constant-speed linear transport on a periodic one-dimensional domain. It overlays the translated initial profile as an exact reference and reports errors at grid points. The CFL and scheme controls expose numerical diffusion, dispersion and unstable growth; a bounded animation does not by itself establish stability.

## License

Project code is released under the [MIT License](LICENSE), copyright 2026 YiwenZ123. Third-party dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
