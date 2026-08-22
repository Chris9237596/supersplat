# Gaussian Pick Architecture Spike Report

> SPIKE ONLY — not production. Do not merge until decision is made.

## Option A — dedicated `splat.index` pick pass (spike prototype)

- Spike patch applied to viewer bundle: **yes**
- Browser test ran: **yes**
- WebGPU backend: **no (WebGL2)**
- Viewer depth pick still works at center: **no**
- Gaussian index hits in grid scan: **0**
- Sample indices: (none)
- Pick target non-zero pixels (sample grid): **0**
- Pick pass instancingCount: **0**
- Pick pass variant SCA_GAUSSIAN_INDEX_PICK: **false**

### Option A design notes
- Uses `SCA_GAUSSIAN_INDEX_PICK` shader define on pick MI only.
- Encodes `encodePickOutput(vGaussianIndex + 1u)` where `vGaussianIndex = splat.index`.
- Does **not** toggle `enableIds` / `pcId` (avoids work-buffer format churn).
- Depth picker chunk patches remain independent (unregister during index pass only).
- No global `vPickId + 1` string replacement.

## Option B — newer engine / PR #8556 compute pick (static survey)

- Project devDependency engine: **2.21.1**
- Exported viewer engine: **unknown** (viewer **?**)
- `prepareForPicking`: **true**
- `Picker.getSelectionAsync`: **true**
- `Picker.getWorldPointAsync`: **true**
- `enableIds` API: **true**
- PR #8556 markers (GSplatLocalDispatch / compute-local): **false**
- Picker.getSelectionAsync returns MeshInstance | GSplatComponent (component-level, not gaussian index)

- Engine pc.Picker.getSelectionAsync identifies GSplatComponent (entity/placement), not splat.index.
- SuperSplat Viewer ships a separate depth Picker (pick/pickSurface) for world position — not engine pc.Picker.
- Engine 2.21.1 does NOT contain PR #8556 compute local GSplat pick (GSplatLocalDispatchSet).
- PR #8556 merged after 2.21.1; requires newer engine than project devDependency for compute splat-ID pick.

## Comparison matrix

| Criterion | Option A (splat.index spike) | Option B (engine upgrade / #8556) |
|---|---|---|
| Numeric Gaussian ID | Unverified / no hits in spike run | Not in 2.21.x — needs engine > 2.21.1 |
| WebGPU | Tested WebGL2 fallback | Unknown until engine+viewer co-upgrade |
| SOG index alignment | Uses `splat.index` (same concept as editor) | Must verify compute pick ID == export SOG order |
| Disturbs depth pick | Needs check | Likely no if viewer depth picker kept separate |
| Viewer bundle patching | Moderate — scoped shader branch + pick MI define | High — rebundle viewer on newer engine |
| Maintenance risk | Medium (shader chunk drift on viewer updates) | Lower long-term if upstream owns pick |
| Performance | One extra RGBA8 pick pass on demand | Compute pick may be faster on unified path |
| Storyline runtime fit | Good if WebGPU hit confirmed | Best if upstream ID matches SOG export |

## Recommendation

**Primary: Option A (dedicated `splat.index` pick pass)** — engine 2.21.x lacks PR #8556; viewer upgrade alone (1.28.0) does not add per-Gaussian pick.

Re-run Option A browser spike with WebGPU (`npx playwright install chromium`) to confirm non-zero pick target before implementation.

## Files

- `tools/spike/splat-index-pick-patch.ts` — Option A spike patch
- `tools/spike/engine-pick-survey.ts` — Option B static survey
- `tools/spike-out/index.spike-a.js` — patched viewer bundle for spike
