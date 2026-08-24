# SCA local workspace

Persistent working area for editor reference projects, runtime exports, and parity reports. Nothing here is part of the build output (`dist/`, `static/`).

## Layout

| Path | Purpose |
|------|---------|
| `project/current.ssproj` | Current editor reference project (copy or symlink your working `.ssproj` here). |
| `runtime/latest/` | Latest exported runtime package (unzipped contents of `sca-runtime-package.zip`). |
| `compare/reports/` | Parity and audit reports (mask remap, rig pose, fixed-matrix tests, etc.). |

**Storyline / offline:** use `storyline.html` from the runtime package (self-contained, works under `file://`). Use `index.html` for LMS/http hosting.

## Usage

1. Save or copy the editor project to `project/current.ssproj`.
2. Export **SCA Runtime Package** from the editor and unzip into `runtime/latest/`.
3. Run compare tools or manual checks; write outputs under `compare/reports/`.

Large or machine-local artifacts under this tree are gitignored; only this README and directory placeholders are tracked.
