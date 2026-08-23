/**
 * Thin Storyline / host-page adapter for inbound postMessage control of the SCA3D runtime.
 *
 * Calls the public window.SCA3D.* API only. Does not embed Storyline or GetPlayer logic.
 *
 * Storyline example (parent page):
 *
 *   iframe.contentWindow.postMessage({
 *     source: 'SCA3DHost',
 *     type: 'activateRegion',
 *     payload: { regionId: 'region_01' }
 *   }, '*')
 *
 *   window.addEventListener('message', (event) => {
 *     if (event.data?.source !== 'SCA3DViewer') return
 *     if (event.data.type === 'regionVisitedChanged') {
 *       // sync Storyline variables / button states
 *     }
 *   })
 */
;(function () {
  const HOST_SOURCE = 'SCA3DHost'
  const VIEWER_SOURCE = 'SCA3DViewer'
  const VISITED_CHANGED_TYPE = 'regionVisitedChanged'
  const DOM_VISITED_EVENT = 'sca3d:regionVisitedChanged'

  const SUPPORTED_TYPES = new Set([
    'activateRegion',
    'activateHotspot',
    'setRegionVisited',
    'resetRegionVisited',
  ])

  /**
   * @param {unknown} value
   */
  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
  }

  /**
   * @param {unknown} value
   */
  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0
  }

  /**
   * @param {unknown} value
   */
  function parseOptionalBoolean(value) {
    if (value === undefined) {
      return undefined
    }
    if (typeof value === 'boolean') {
      return value
    }
    return undefined
  }

  /**
   * @param {string} message
   */
  function warn(message) {
    console.warn(`[SCA3D Host] ${message}`)
  }

  /**
   * @param {object} message
   */
  function postToParent(message) {
    window.dispatchEvent(
      new CustomEvent(DOM_VISITED_EVENT, {
        detail: message.payload,
      })
    )

    if (!window.parent || window.parent === window) {
      return
    }

    if (typeof window.SCA3D?.safePostMessageToParent === 'function') {
      window.SCA3D.safePostMessageToParent(message)
      return
    }

    try {
      window.parent.postMessage(message, '*')
    } catch (error) {
      window.scaDebug?.('navigation', '[SCA3D] postMessage skipped:', error)
    }
  }

  /**
   * @param {string} regionId
   * @param {boolean} visited
   */
  function emitRegionVisitedChanged(regionId, visited) {
    if (!regionId) {
      return
    }

    const message = {
      source: VIEWER_SOURCE,
      type: VISITED_CHANGED_TYPE,
      payload: {
        regionId,
        visited: !!visited,
      },
    }

    postToParent(message)
  }

  /**
   * @param {string} regionId
   */
  function regionExists(regionId) {
    return window.SCA3D?.state?.regionById?.has?.(regionId) === true
  }

  /**
   * @param {string} hotspotId
   */
  function hotspotExists(hotspotId) {
    return window.SCA3D?.state?.hotspotById?.has?.(hotspotId) === true
  }

  /**
   * @param {Record<string, unknown>} payload
   */
  function buildExternalActivationOptions(payload) {
    /** @type {{ source: string, emitEvent: boolean, emitClick: boolean, markVisited?: boolean, focusCamera?: boolean }} */
    const options = {
      source: 'external',
      emitEvent: false,
      emitClick: false,
    }

    const markVisited = parseOptionalBoolean(payload.markVisited)
    if (markVisited !== undefined) {
      options.markVisited = markVisited
    } else {
      options.markVisited = true
    }

    const focusCamera = parseOptionalBoolean(payload.focusCamera)
    if (focusCamera !== undefined) {
      options.focusCamera = focusCamera
    }

    const showCard = parseOptionalBoolean(payload.showCard)
    if (showCard !== undefined) {
      window.scaDebug?.(
        'navigation',
        `[SCA3D] activateRegion showCard=${showCard} uses region interaction config`
      )
    }

    return options
  }

  /**
   * @param {Record<string, unknown>} payload
   */
  function handleActivateRegion(payload) {
    const regionId = payload.regionId
    if (!isNonEmptyString(regionId)) {
      warn('activateRegion ignored: payload.regionId must be a non-empty string')
      return
    }

    const trimmed = regionId.trim()
    if (!regionExists(trimmed)) {
      warn(`activateRegion ignored: unknown region "${trimmed}"`)
      return
    }

    if (typeof window.SCA3D?.activateRegion !== 'function') {
      warn('activateRegion ignored: SCA3D.activateRegion is unavailable')
      return
    }

    window.SCA3D.activateRegion(trimmed, buildExternalActivationOptions(payload))
  }

  /**
   * @param {Record<string, unknown>} payload
   */
  function handleActivateHotspot(payload) {
    const hotspotId = payload.hotspotId
    if (!isNonEmptyString(hotspotId)) {
      warn('activateHotspot ignored: payload.hotspotId must be a non-empty string')
      return
    }

    const trimmed = hotspotId.trim()
    if (!hotspotExists(trimmed)) {
      warn(`activateHotspot ignored: unknown hotspot "${trimmed}"`)
      return
    }

    if (typeof window.SCA3D?.activateHotspot !== 'function') {
      warn('activateHotspot ignored: SCA3D.activateHotspot is unavailable')
      return
    }

    /** @type {{ source: string, emitEvent: boolean, emitClick: boolean, focusCamera?: boolean }} */
    const options = {
      source: 'external',
      emitEvent: false,
      emitClick: false,
    }

    const focusCamera = parseOptionalBoolean(payload.focusCamera)
    if (focusCamera !== undefined) {
      options.focusCamera = focusCamera
    }

    window.SCA3D.activateHotspot(trimmed, options)
  }

  /**
   * @param {Record<string, unknown>} payload
   */
  function handleSetRegionVisited(payload) {
    const regionId = payload.regionId
    if (!isNonEmptyString(regionId)) {
      warn('setRegionVisited ignored: payload.regionId must be a non-empty string')
      return
    }

    if (typeof payload.visited !== 'boolean') {
      warn('setRegionVisited ignored: payload.visited must be a boolean')
      return
    }

    if (typeof window.SCA3D?.setRegionVisited !== 'function') {
      warn('setRegionVisited ignored: SCA3D.setRegionVisited is unavailable')
      return
    }

    const trimmed = regionId.trim()
    if (!regionExists(trimmed)) {
      warn(`setRegionVisited ignored: unknown region "${trimmed}"`)
      return
    }

    window.SCA3D.setRegionVisited(trimmed, payload.visited)
  }

  /**
   * @param {Record<string, unknown>} payload
   */
  function handleResetRegionVisited(payload) {
    if (typeof window.SCA3D?.resetRegionVisited !== 'function') {
      warn('resetRegionVisited ignored: SCA3D.resetRegionVisited is unavailable')
      return
    }

    const regionId = payload.regionId
    if (regionId === undefined) {
      window.SCA3D.resetRegionVisited()
      return
    }

    if (!isNonEmptyString(regionId)) {
      warn('resetRegionVisited ignored: payload.regionId must be a non-empty string when provided')
      return
    }

    const trimmed = regionId.trim()
    if (!regionExists(trimmed)) {
      warn(`resetRegionVisited ignored: unknown region "${trimmed}"`)
      return
    }

    window.SCA3D.resetRegionVisited(trimmed)
  }

  /**
   * @param {MessageEvent} event
   */
  function handleHostMessage(event) {
    const data = event?.data
    if (!isPlainObject(data)) {
      return
    }

    if (data.source !== HOST_SOURCE) {
      return
    }

    if (typeof data.type !== 'string' || !SUPPORTED_TYPES.has(data.type)) {
      return
    }

    const payload = isPlainObject(data.payload) ? data.payload : {}

    switch (data.type) {
      case 'activateRegion':
        handleActivateRegion(payload)
        break
      case 'activateHotspot':
        handleActivateHotspot(payload)
        break
      case 'setRegionVisited':
        handleSetRegionVisited(payload)
        break
      case 'resetRegionVisited':
        handleResetRegionVisited(payload)
        break
      default:
        break
    }
  }

  function initScaHostBridge() {
    if (window.__SCA3D_HOST_BRIDGE_READY__) {
      return
    }

    window.__SCA3D_HOST_BRIDGE_READY__ = true
    window.addEventListener('message', handleHostMessage)

    window.SCA3D = window.SCA3D || {}
    window.SCA3D.emitRegionVisitedChanged = emitRegionVisitedChanged

    console.log('[SCA3D] host bridge ready')
  }

  window.initScaHostBridge = initScaHostBridge
})()
