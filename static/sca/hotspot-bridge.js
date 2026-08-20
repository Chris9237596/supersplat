/**
 * Bridges SuperSplat annotation clicks to application-level hotspot events.
 * Hotspot identity comes from project registry when available, otherwise extras.id.
 */
;(function () {
  const SOURCE = 'SCA3DViewer'
  const EVENT_TYPE = 'hotspotClicked'
  const DOM_EVENT_NAME = 'sca3d:hotspotClicked'
  const DEFAULT_CLICK_ACTION = { type: 'event', eventName: EVENT_TYPE }

  /**
   * @param {string} hotspotId
   */
  function emitHotspotClicked(hotspotId) {
    if (!hotspotId) {
      console.warn('[SCA3D] hotspotClicked ignored: missing hotspotId')
      return
    }

    const message = {
      source: SOURCE,
      type: EVENT_TYPE,
      payload: { hotspotId },
    }

    console.log(`[SCA3D] hotspotClicked: ${hotspotId}`)

    window.dispatchEvent(
      new CustomEvent(DOM_EVENT_NAME, {
        detail: { hotspotId },
      })
    )

    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, '*')
    }
  }

  /**
   * @param {unknown} annotation
   * @param {number} index
   */
  function resolveLegacyHotspotId(annotation, index) {
    const extras = annotation?.extras
    if (extras && typeof extras === 'object' && typeof extras.id === 'string' && extras.id.trim()) {
      return extras.id.trim()
    }

    const fallbackId = `hotspot_${index + 1}`
    console.warn(
      `[SCA3D] annotation at index ${index} has no project mapping; using fallback "${fallbackId}"`
    )
    return fallbackId
  }

  /**
   * @param {object} hotspot
   */
  function handleHotspotClick(hotspot) {
    if (!hotspot?.id) {
      console.warn('[SCA3D] hotspot click ignored: hotspot has no id')
      return
    }

    if (hotspot.click?.enabled === false) {
      console.log(`[SCA3D] hotspot click ignored (disabled): ${hotspot.id}`)
      return
    }

    const action = hotspot.click?.action ?? DEFAULT_CLICK_ACTION
    if (action.type === 'event' && (action.eventName === EVENT_TYPE || !action.eventName)) {
      emitHotspotClicked(hotspot.id)
      return
    }

    console.warn(`[SCA3D] unsupported click action for "${hotspot.id}"`, action)
  }

  /**
   * @param {object} viewer
   * @param {{ project?: object, registry?: Map<unknown, object> }} [runtime]
   */
  function initHotspotBridge(viewer, runtime = {}) {
    const global = viewer?.global
    const events = global?.events
    const annotations = global?.settings?.annotations

    if (!events || !Array.isArray(annotations)) {
      console.warn('[SCA3D] hotspot bridge not initialized: viewer not ready')
      return
    }

    window.SCA3D = window.SCA3D || {}
    window.SCA3D.state = window.SCA3D.state || {}
    window.SCA3D.state.project = runtime.project ?? window.SCA3D.state.project
    window.SCA3D.state.registry = runtime.registry ?? window.SCA3D.state.registry
    window.SCA3D.state.viewer = viewer

    const legacyIndex = new Map(
      annotations.map((annotation, index) => [annotation, index])
    )

    const onAnnotationActivate = (annotation) => {
      const registry = window.SCA3D?.state?.registry
      if (registry?.has(annotation)) {
        handleHotspotClick(registry.get(annotation))
        return
      }

      const index = legacyIndex.get(annotation)
      if (index === undefined) {
        console.warn('[SCA3D] hotspotClicked ignored: unknown annotation')
        return
      }

      emitHotspotClicked(resolveLegacyHotspotId(annotation, index))
    }

    events.on('annotation.activate', onAnnotationActivate)

    const hotspotCount = window.SCA3D?.state?.registry?.size ?? annotations.length
    console.log(`[SCA3D] hotspot bridge ready (${hotspotCount} mapped hotspot(s))`)
  }

  window.initHotspotBridge = initHotspotBridge
  window.SCA3D = window.SCA3D || {}
  window.SCA3D.emitHotspotClicked = emitHotspotClicked
})()
