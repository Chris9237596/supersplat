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

    window.scaDebug?.('navigation', `[SCA3D] hotspotClicked: ${hotspotId}`)

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

    if (hotspot.interaction?.clickable === false) {
      window.scaDebug?.('navigation', `[SCA3D] hotspot click ignored (not clickable): ${hotspot.id}`)
      return
    }

    if (hotspot.click?.enabled === false) {
      window.scaDebug?.('navigation', `[SCA3D] hotspot click ignored (disabled): ${hotspot.id}`)
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
   * @param {object[]} hotspots
   */
  function buildHotspotById(hotspots) {
    const byId = new Map()
    if (!Array.isArray(hotspots)) {
      return byId
    }

    for (const hotspot of hotspots) {
      if (hotspot?.id) {
        byId.set(hotspot.id, hotspot)
      }
    }

    return byId
  }

  /**
   * @param {unknown} annotation
   * @param {Map<string, object>} byId
   * @param {number} index
   */
  function resolveHotspotFromAnnotation(annotation, byId, index) {
    const id = annotation?.extras?.id
    if (typeof id === 'string' && id.trim() && byId.has(id.trim())) {
      return byId.get(id.trim())
    }

    const fallbackId = resolveLegacyHotspotId(annotation, index)
    return byId.get(fallbackId) ?? { id: fallbackId }
  }

  /**
   * @param {object} viewer
   * @param {{ project?: object }} [runtime]
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
    window.SCA3D.state.viewer = viewer

    const byId = buildHotspotById(window.SCA3D.state.project?.hotspots)
    const legacyIndex = new Map(
      annotations.map((annotation, index) => [annotation, index])
    )

    const onAnnotationActivate = (annotation) => {
      const index = legacyIndex.get(annotation)
      if (index === undefined) {
        console.warn('[SCA3D] hotspotClicked ignored: unknown annotation')
        return
      }

      handleHotspotClick(resolveHotspotFromAnnotation(annotation, byId, index))
    }

    events.on('annotation.activate', onAnnotationActivate)

    console.log(`[SCA3D] hotspot bridge ready (${byId.size || annotations.length} mapped hotspot(s))`)
  }

  window.initHotspotBridge = initHotspotBridge
  window.SCA3D = window.SCA3D || {}
  window.SCA3D.handleHotspotClick = handleHotspotClick
  window.SCA3D.emitHotspotClicked = emitHotspotClicked
})()
