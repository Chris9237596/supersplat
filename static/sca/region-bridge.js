/**
 * Bridges runtime Region clicks to application-level region events.
 */
;(function () {
  const SOURCE = 'SCA3DViewer'
  const EVENT_TYPE = 'regionClicked'
  const DOM_EVENT_NAME = 'sca3d:regionClicked'

  /**
   * @param {string} regionId
   */
  function emitRegionClicked(regionId) {
    if (!regionId) {
      console.warn('[SCA3D] regionClicked ignored: missing regionId')
      return
    }

    const message = {
      source: SOURCE,
      type: EVENT_TYPE,
      payload: { regionId },
    }

    console.log(`[SCA3D] regionClicked: ${regionId}`)

    window.dispatchEvent(
      new CustomEvent(DOM_EVENT_NAME, {
        detail: { regionId },
      })
    )

    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, '*')
    }
  }

  /**
   * @param {object} region
   */
  function handleRegionClick(region) {
    if (!region?.id) {
      console.warn('[SCA3D] region click ignored: region has no id')
      return
    }

    if (region.interaction?.clickable === false) {
      console.log(`[SCA3D] region click ignored (not clickable): ${region.id}`)
      return
    }

    emitRegionClicked(region.id)
  }

  /**
   * @param {object[]} regions
   */
  function buildRegionById(regions) {
    const byId = new Map()
    if (!Array.isArray(regions)) {
      return byId
    }

    for (const region of regions) {
      if (region?.id) {
        byId.set(region.id, region)
      }
    }

    return byId
  }

  /**
   * @param {object} viewer
   * @param {{ project?: object }} [runtime]
   */
  function initRegionBridge(viewer, runtime = {}) {
    window.SCA3D = window.SCA3D || {}
    window.SCA3D.state = window.SCA3D.state || {}
    window.SCA3D.state.project = runtime.project ?? window.SCA3D.state.project
    window.SCA3D.state.viewer = viewer

    const regions = window.SCA3D.state.project?.regions ?? []
    const byId = buildRegionById(regions)
    window.SCA3D.state.regionById = byId

    console.log(`[SCA3D] region bridge ready (${byId.size} mapped region(s))`)
  }

  window.initRegionBridge = initRegionBridge
  window.SCA3D = window.SCA3D || {}
  window.SCA3D.handleRegionClick = handleRegionClick
  window.SCA3D.emitRegionClicked = emitRegionClicked
})()
