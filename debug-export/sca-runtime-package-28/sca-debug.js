/**
 * Central runtime debug flags for SCA viewer scripts.
 * Enable in devtools, e.g. window.SCA3D.debug.regions = true
 */
;(function () {
  window.SCA3D = window.SCA3D || {}

  const defaults = {
    picking: false,
    regions: false,
    cards: false,
    navigation: false,
    camera: false,
    export: false,
    runtimeCompatibility: false,
    runtimeEvents: false,
  }

  const existing = window.SCA3D.debug && typeof window.SCA3D.debug === 'object' ?
    window.SCA3D.debug :
    {}

  window.SCA3D.debug = { ...defaults, ...existing }

  /** @param {'picking'|'regions'|'cards'|'navigation'|'camera'|'export'|'runtimeCompatibility'|'runtimeEvents'} category */
  function scaDebug(category, ...args) {
    const flags = window.SCA3D?.debug
    if (!flags || !flags[category]) {
      return
    }
    console.log(...args)
  }

  window.scaDebug = scaDebug
  window.SCA3D.scaDebug = scaDebug

  window.SCA3D.debugState = function debugState() {
    const state = window.SCA3D?.state ?? {}
    const snapshot = {
      activeTarget: state.activeTarget ?? null,
      selectedRegionId: state.selectedRegionId ?? null,
      selectedHotspotId: state.selectedHotspotId ?? null,
      hoverRegionId: state.hoverRegionId ?? null,
      regionVisited: state.regionVisited ?? {},
      regionPulsePlayback: state.regionPulsePlayback ?? null,
    }
    console.log('[SCA3D debugState]', snapshot)
    return snapshot
  }

  // Legacy aliases: debugHoverPick -> debug.picking, cameraDebugVerbose -> debug.camera
})()
