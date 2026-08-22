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
  }

  const existing = window.SCA3D.debug && typeof window.SCA3D.debug === 'object' ?
    window.SCA3D.debug :
    {}

  window.SCA3D.debug = { ...defaults, ...existing }

  /** @param {'picking'|'regions'|'cards'|'navigation'|'camera'|'export'|'runtimeCompatibility'} category */
  function scaDebug(category, ...args) {
    const flags = window.SCA3D?.debug
    if (!flags || !flags[category]) {
      return
    }
    console.log(...args)
  }

  window.scaDebug = scaDebug
  window.SCA3D.scaDebug = scaDebug

  // Legacy aliases: debugHoverPick -> debug.picking, cameraDebugVerbose -> debug.camera
})()
