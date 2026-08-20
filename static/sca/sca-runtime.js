/**
 * SCA3D runtime bootstrap for exported viewer packages.
 * Annotations are embedded in settings.json; project.json is loaded for click rules.
 */
;(function () {
  const DEFAULT_PROJECT_URL = './project.json'

  /**
   * @param {string} [url]
   */
  async function loadProject(url = DEFAULT_PROJECT_URL) {
    if (window.__SCA3D_EMBEDDED_PROJECT__) {
      const project = window.__SCA3D_EMBEDDED_PROJECT__
      if (!project || project.version !== 1 || !Array.isArray(project.hotspots)) {
        throw new Error('[SCA3D] invalid embedded project: expected { version: 1, hotspots: [] }')
      }

      console.log(`[SCA3D] project loaded: ${project.hotspots.length} hotspot(s) from embedded preview data`)
      return project
    }

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`[SCA3D] failed to load project: ${url} (${response.status})`)
    }

    const project = await response.json()
    if (!project || project.version !== 1 || !Array.isArray(project.hotspots)) {
      throw new Error('[SCA3D] invalid project.json: expected { version: 1, hotspots: [] }')
    }

    console.log(`[SCA3D] project loaded: ${project.hotspots.length} hotspot(s) from ${url}`)
    return project
  }

  /**
   * Map viewer annotations to project hotspots via extras.id.
   * @param {object[]} annotations
   * @param {object[]} hotspots
   */
  function buildRegistry(annotations, hotspots) {
    const byId = new Map(hotspots.map((hotspot) => [hotspot.id, hotspot]))
    const registry = new Map()

    for (const annotation of annotations) {
      const id = annotation?.extras?.id
      if (typeof id === 'string' && byId.has(id)) {
        registry.set(annotation, byId.get(id))
      }
    }

    return registry
  }

  /**
   * @param {{ canvas: HTMLCanvasElement, settingsJson: object, config: object, main: Function }} args
   */
  async function bootstrapViewer({ canvas, settingsJson, config, main }) {
    const project = await loadProject()
    const annotations = Array.isArray(settingsJson?.annotations) ? settingsJson.annotations : []
    const registry = buildRegistry(annotations, project.hotspots)
    const viewer = await main(canvas, settingsJson, config)

    window.SCA3D = window.SCA3D || {}
    window.SCA3D.state = window.SCA3D.state || {}
    window.SCA3D.state.project = project
    window.SCA3D.state.registry = registry
    window.SCA3D.state.viewer = viewer

    if (typeof initHotspotBridge === 'function') {
      initHotspotBridge(viewer, { project, registry })
    } else {
      console.warn('[SCA3D] hotspot bridge not available')
    }

    return viewer
  }

  window.SCA3D = window.SCA3D || {}
  window.SCA3D.loadProject = loadProject
  window.SCA3D.bootstrapViewer = bootstrapViewer
})()
