# Working agreements for agents in this repo

## Do not run live tests. Do not use puppeteer.

Do **not** drive the game in a real browser to check your work. Specifically, do
not:

- run `puppeteer` / `puppeteer-core` in any form, including `tools/shoot.mjs`,
  `tools/shootat.mjs` and `tools/perf.mjs`
- attach to a running Chrome over the remote-debugging port (`localhost:9222`),
  by any means
- open, navigate, script or screenshot tabs in the user's browser
- start, restart or interfere with the dev server

These tools exist for the **user** to run. An agent running them takes over a
browser the user is playing in, and a "measurement" taken that way describes the
tab's debugging state as much as it describes the code.

## Verify like this instead

1. **`npx vite build`** — the one check you own. It catches syntax errors,
   bad imports and broken module graphs, and it touches nothing live.
2. **Read the code.** Trace the call path and say what you expect to happen.
3. **Hand the check to the user.** State exactly what to run or look at and
   which number or behaviour would confirm or refute your claim. Then wait.

Report what you actually verified and what you did not. "The build passes and
the logic reads correctly; I have not seen it run" is a complete and acceptable
answer. Claiming more than the build proves is not.

## Re-read before you write

Files in this repo change between your reads and your writes — the user edits
alongside you. Before overwriting any file you did not create in the current
turn, re-read it. Prefer targeted edits over whole-file rewrites; a rewrite from
a stale copy silently deletes whatever landed in between.

## In-game diagnostics belong on screen

The HUD carries the performance panel (`P` toggles it): the CPU cost split into
simulation, our own node walk and three's render; real GPU time from a timer
query; draw calls, triangles, live program and geometry counts; and the render
scale with the reason the scaler chose it. Keys `0`–`6` toggle shadows, pin the
render scale, and hide content classes for bisecting.

When you need a new measurement, **add a row to the HUD** and ask the user to
read it. That keeps the instrument in the product, where the user can use it
too, instead of in a script only an agent runs.
