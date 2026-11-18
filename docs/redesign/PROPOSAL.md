# X-Ray Lens redesign: art direction and proposal

Status: implemented in PRs 16 to 20 (the README update is PR 6 itself), 2026-11-18.
Before frames: `docs/redesign/before/` (desktop-idle, desktop-diagnosis, mobile-idle, mobile-diagnosis).

## What is weak today (from the before frames)

1. A row of form controls sits at the top. On a 390 px screen it fills the whole first screen, and the image gets about a quarter of it.
2. The scan half of the split looks almost the same as the target. Nothing on screen says "the machine sees this".
3. The divider is a 1 px line with a small pill grip. There is no weight and no edge glow.
4. Regions are 12 px numbered squares with dashed outlines. They do not connect to the diagnosis panel.
5. The diagnosis is a plain text column. The token saving appears only as "99.3%" in a 4-cell grid; nobody sees it happen.
6. Demo mode shows "VLM inference time 415 ms" with no label saying it is simulated. That breaks the rule: never present demo output as a live call.
7. 1 px sharp boxes everywhere (toolbar, panel, telemetry grid, buttons).

## Art direction (one paragraph)

An inspection microscope on a dark bench. The image is the specimen, lit from the top left. Everything else is precision hardware around it: a bevelled lens knob on a rail, a recessed readout window, a small tray of slides.
- **Material:** soft rounded bodies with one light source (135 deg). Each has a bevel highlight on the top-left rim and a contact shadow at the lower right. Readouts sit in recessed wells. No hairline frames.
- **Colour:** stage #0C1014, text #ECE8DF, and one hot accent family: paint #FF5A1F, paint-hi #FFB347, paint-deep #A8300F. The accent appears only where the machine acts: the scan edge, the lock-on brackets, the caret and the saving bar.
- **Type:**
  - Bricolage Grotesque 700 for the one title;
  - Instrument Sans for labels;
  - Martian Mono for every number and every streamed field.
- **Motion:** two springs only, the same as the portfolio, compiled to CSS `linear()` tokens.
  - SPRING_SOFT (90/12, ~880 ms, ~7% overshoot) for things with mass: the lens, the flight.
  - SPRING_SNAPPY (520/30, ~350 ms) for controls and snaps.
  - No linear tweens and no plain opacity fades. One loud motion at a time; everything else holds still.
- **Light pools and grain** behind the stage. No grid.
- `prefers-reduced-motion`: every element renders in its finished state, with no sweep, no flight and no typing.

## Proposal by area

### 1. Stage as hero
- The image takes the full width at the top, with a rounded 24 px radius and a recessed bezel. On desktop the readout docks to its right; on mobile it docks under it.
- The title shrinks to one line above the stage. The tagline moves to a caption under the stage.
- Mobile: the image is the first thing visible at 390 x 844.

### 2. Lens as a real instrument
- **Real input:** a native `<input type="range">` (visually hidden, full height of the stage) drives everything. Keyboard, touch and screen readers work for free. This replaces today's `div role="slider"`.
- **Knob:** a bevelled knob rides a rail under the stage. The divider follows the input through a spring, so a fast drag overshoots slightly and settles.
- **Scan edge:** a glowing 2 px accent edge with a soft bloom.
- **Scan side:** the base image is darkened to about 35% and the heatmap is drawn on it in a clear colormap (dark to paint-deep to paint to paint-hi). The colormap is applied in CSS/canvas to the existing overlay image; the backend stays unchanged.
- A small legend chip reads "CV diff, 10 ms".
- **Circle lens mode:** see question 4.

### 3. Regions lock on
- After inspect returns, each region gets four rounded corner brackets. They start at 1.6x size, converge with SPRING_SNAPPY, flash once in paint-hi, then settle to a quiet paint ring.
- A mono label types in beside each region: `R1 · 63x44`.
- Regions lock on one after another, about 90 ms apart.
- Hover or focus brightens the brackets. Each region stays a real `<button>` with the same aria-label.

### 4. Region to diagnosis: connected transition
- Clicking a region captures its rect. A layer holding the baseline|target crop pair (the same PNG sent to the VLM) flies from the region box to the readout's "specimen" slot with SPRING_SOFT, using a FLIP transform.
- The region keeps a pinned state, so the link stays visible.

### 5. Diagnosis as instrument readout
- The readout is a recessed window with labelled rows: CATEGORY, SEVERITY, CONFIDENCE, EVIDENCE, ACTION.
- The raw SSE stream is parsed as it arrives by a new pure function, `partialReport(raw)`: tolerant partial-JSON parsing that returns the fields complete so far plus the one in progress. It gets Vitest tests.
- Each row fills as its field arrives, with a paint caret on the active row. The confidence bar springs to its value. The severity chip snaps in.
- The raw JSON moves behind a "raw" disclosure. It is kept for honesty, no longer the main view.
- An error keeps today's message, styled as a readout fault line.

### 6. Full frame vs regions: the saving you can see
Two horizontal bars in the readout:
- **Tokens:** both bars start at full-frame length (`full_frame_tokens`, live from /api/inspect). The ROI bar then springs down to `roi_tokens`, and the counter rolls to the saving %.
- **Latency:** see question 3.

Every number carries a small tag:
- `live` for numbers from the current request;
- `measured` for numbers from the README benchmark;
- `simulated` for anything from demo mode.

The demo's 415 ms gets the `simulated` tag. This fixes weakness 6.

### 7. Presets and uploads as a tray
- A compact tray under the stage shows 3 preset slides (thumbnail chips) and one "+ your pair" chip that opens a small sheet for baseline/target files.
- Sensitivity becomes a small knob or slider in the tray, still a real range input.
- The backend selector: see question 5.

### 8. Guided first-run sweep
- On first view (IntersectionObserver, once per session, stored in sessionStorage with try/catch), the lens sweeps 15% to 85% and back to 50% over about 2.6 s with SPRING_SOFT.
- Then the regions lock on, then a one-line hint appears: "Pick a region".
- Any user input cancels it. Reduced motion skips it.

## Phase 2 PR plan (one PR per area, in order)

| # | Branch | Scope | New pure logic, tested first |
|---|---|---|---|
| 1 | `feat/design-tokens-tray` | Tokens, springs, material, fonts, light pools, stage layout, tray | `spring.ts` (springStep, `linear()` string) |
| 2 | `feat/lens-instrument` | Real range input, knob, inertia, scan edge, colormap, sweep | `inertia.ts`, `sweep.ts` (pure timeline) |
| 3 | `feat/region-lockon` | Brackets, flash, typed labels, pinned state | `stagger.ts` |
| 4 | `feat/readout-stream` | `partialReport`, field rows, caret, flight | `partialReport.ts`, `flip.ts` |
| 5 | `feat/savings-bench` | Token and latency bars, provenance tags | `savings.ts` |
| 6 | `docs/redesign-readme` | README image, board update | none |

Evidence for each PR:
- before and after at 1440x900 and 390x844;
- contact sheets of 8 frames, about 120 ms apart;
- a short video (Playwright `recordVideo`, already installed; no new tools);
- an honest "still weak" list;
- at least two critique-and-fix iterations.

Unchanged: backend, CV pipeline, API contract, rate limits, benchmark numbers. Demo stays the default and stays free.

## Constraints that need an owner decision

- **Line budget:** frontend `src` is at 603 of 610 non-blank lines. This redesign cannot fit in 7 lines.
- **Fonts:** they are new third-party assets.
- **Latency:** there is no live full-frame latency number.

## Owner decisions (2026-11-18)

- Line budget: frontend `src` non-test TS/TSX is raised to 1,500 lines, then to 1,600 for the polish PR (focus trap, diagnosis dock, thumbnails). CSS, tests and mocks are not counted.
- Fonts: self-hosted with `@fontsource` (3 npm packages, all OFL).
- Latency bar: uses the measured benchmark (Haiku 17,838 vs 10,034 ms), tagged `measured`. The live ROI time is shown separately, tagged `live`, or `simulated` in demo mode.
- Lens: split mode only, plus hold to peek at the baseline. The circle lens is removed.
- Backend selector (default, not asked): a small "engine" chip at the end of the tray. It shows Demo with a `free` tag; the other engines sit behind it.
