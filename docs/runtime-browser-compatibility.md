# SCA Runtime Viewer — Browser Compatibility

This document describes **exported runtime package** compatibility only. Editor features (File System Access, IndexedDB recovery, WebGPU export acceleration) are separate and not required by the runtime Viewer.

## Baseline

- **Required:** WebGL2 (`canvas.getContext('webgl2')`)
- **Optional:** WebGPU (`?webgpu` URL flag; default export uses WebGL2)
- **Assets:** relative paths from `index.html` (`./index.js`, `./index.sog`, `./project.json`, etc.)

## Capability detection

Runtime sets `window.SCA3D.capabilities` via `sca-runtime-capabilities.js`:

| Field | Meaning |
|-------|---------|
| `webgpu` | `navigator.gpu.requestAdapter()` succeeded |
| `webgl2` | WebGL2 context available |
| `pointerEvents` | Pointer Events API present |
| `touch` | Touch input likely available |
| `iframe` | `window.parent !== window` |
| `crossOriginIsolated` | `crossOriginIsolated === true` |

No user-agent sniffing is used.

## Compatibility matrix

Status legend: **Expected** = designed to work; **Tested** = manually verified in this project; **Known limitation** = intentional or documented constraint.

| Browser | WebGPU | WebGL2 fallback | Hotspots | Regions | Cards | Navigation | iframe | Storyline bridge |
|---------|--------|-----------------|----------|---------|-------|------------|--------|------------------|
| Chrome | Expected (opt-in `?webgpu`) | Expected | Expected | Expected | Expected | Expected | Expected | Expected |
| Edge | Expected (opt-in `?webgpu`) | Expected | Expected | Expected | Expected | Expected | Expected | Expected |
| Brave | Known limitation (often no WebGPU) | Expected | Expected | Expected | Expected | Expected | Expected | Expected |
| Firefox | Known limitation (no WebGPU in typical builds) | Expected | Expected | Expected | Expected | Expected | Expected | Expected |

### Notes

- **Default renderer:** WebGL2. Append `?webgpu` to opt into WebGPU when supported.
- **Region highlight tint:** Full combined hover/selected tint runs on WebGL2. WebGPU renderer skips GPU tint patch (picker, cursor, cards still work).
- **Region picker fallback:** WebGPU ID-buffer pick when on WebGPU renderer; **centers** projection pick on WebGL2 (and when WebGPU pick unavailable).
- **Storyline bridge:** Outbound only via `window.parent.postMessage({ source: 'SCA3DViewer', type, payload }, '*')`. No `GetPlayer()` dependency. Same-origin parent DOM is never read.

## Storyline / iframe message contract

### Hotspot click

```json
{
  "source": "SCA3DViewer",
  "type": "hotspotClicked",
  "payload": { "hotspotId": "hotspot_01" }
}
```

### Region click

```json
{
  "source": "SCA3DViewer",
  "type": "regionClicked",
  "payload": { "regionId": "region_01" }
}
```

DOM events: `sca3d:hotspotClicked`, `sca3d:regionClicked`.

## Debug

Enable startup diagnostic (one log block):

```js
window.SCA3D.debug.runtimeCompatibility = true
```

Reload exported `index.html`.

## Dev iframe test

`tools/compat-test.html` embeds an exported viewer in an iframe and logs parent-side postMessage events. Not included in production ZIP export.

## Manual testing still required

- Real Storyline Web Object embed (cross-origin LMS host)
- Firefox WebGL2 + Region centers picker at scale
- Brave WebGL2-only path on target hardware
- Touch tap activation (hover not expected on pure touch)
