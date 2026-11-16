# Navier–Stokes Flow Lab

Interactive, browser-based CFD demonstrations for learning incompressible Navier–Stokes time stepping, free-surface flow and one-dimensional linear advection.

[Live demo](https://navier-stoke.lovableglobe2.chatgpt.site/) · [中文说明](README.zh-CN.md) · [MIT license](LICENSE)

## Features

- Explicit time-stepping animation with pressure iterations, workflow diagrams and equations.
- Implicit MAC projection animation, including face-velocity and combined-velocity arrows.
- Comparisons at the same physical time, with selectable time steps, initial conditions and Jacobi / Gauss–Seidel / SOR iterations.
- A 2D wave-impact tank with square, circular and triangular obstacle cross-sections, adjustable size and position, and three spatial resolutions.
- Free-surface, velocity and pressure views, pressure history, and force per unit span.
- A one-dimensional advection lab with 10 finite-difference schemes and five initial profiles. Adjust the grid, CFL number and positive or negative transport velocity; compare numerical curves with the exact solution.
- Advection error and mass diagnostics, a single-step stencil inspector, and CSV export.
- English and Chinese interfaces; English is the default.

## Run locally

No build step or npm dependencies are required. Use Python 3 to serve the static files:

```sh
git clone https://github.com/YiwenZ123/navier-stokes-flow-lab.git
cd navier-stokes-flow-lab
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

Open [http://127.0.0.1:8000/](http://127.0.0.1:8000/). Use the navigation to open the other demonstrations.

Serve the files over HTTP: opening an HTML file directly does not fully support the JavaScript modules and comparison worker. The explicit animation loads its pinned Floating UI and Lucide dependencies from a CDN, so that view requires network access for those resources. The other solvers run locally in the browser.

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
npm run check:grid
```

The tests cover iterative solvers, discrete pressure-projection identities, time-step comparisons, hydrostatic equilibrium, solid boundaries, particle collisions, wave-obstacle geometries, and the one-dimensional advection schemes.

## Project layout

- `dist/` — the directly served application, styles and solvers.
- `tests/` — numerical checks using Node's built-in assertions.
- `scripts/sync-spatial-grid.mjs` — synchronizes the shared periodic grid with the sandboxed explicit animation.
- `licenses/` — third-party license notices.

`dist/explicit-ns-animation.html` preserves the original Chinese animation. The enhanced animation is `dist/explicit-ns-presets.html`. Both retain their existing iframe sandbox and Content Security Policy.

## Numerical scope

These are educational demonstrations. The wave solver uses a staggered MAC grid, pressure projection, marker particles for the free surface, and a grid-aligned approximation of the obstacle. It models a fixed **2D cross-section**, with atmospheric pressure at the free surface and impermeable, free-slip solid boundaries.

Grid resolution, velocity interpolation and marker tracking introduce numerical error. Wave-impact pressures and forces illustrate trends; quantitative engineering predictions require convergence studies and experimental validation. The comparison page's growth thresholds are demonstration criteria, not general stability guarantees.

The advection lab solves constant-speed linear transport on a periodic one-dimensional domain. It overlays the translated initial profile as an exact reference and reports errors at grid points. The CFL and scheme controls expose numerical diffusion, dispersion and unstable growth; a bounded animation does not by itself establish stability.

## License

Project code is released under the [MIT License](LICENSE), copyright 2026 YiwenZ123. Third-party dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
