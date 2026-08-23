/**
 * Runtime Viewer capability detection (exported package only).
 * Detects features — not browser names.
 */
;(function () {
  window.SCA3D = window.SCA3D || {}

  /**
   * @returns {boolean}
   */
  function detectWebGL2() {
    try {
      const canvas = document.createElement('canvas')
      return !!canvas.getContext('webgl2')
    } catch {
      return false
    }
  }

  /**
   * @returns {Promise<boolean>}
   */
  async function detectWebGPU() {
    try {
      if (!navigator.gpu || typeof navigator.gpu.requestAdapter !== 'function') {
        return false
      }
      const adapter = await navigator.gpu.requestAdapter()
      return !!adapter
    } catch {
      return false
    }
  }

  /**
   * @returns {boolean}
   */
  function detectPointerEvents() {
    return typeof window.PointerEvent === 'function'
  }

  /**
   * @returns {boolean}
   */
  function detectTouch() {
    try {
      return (
        (typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0) ||
        'ontouchstart' in window
      )
    } catch {
      return false
    }
  }

  /**
   * @returns {boolean}
   */
  function detectIframe() {
    try {
      return window.parent !== window
    } catch {
      return true
    }
  }

  /**
   * @returns {boolean}
   */
  function detectCrossOriginIsolated() {
    try {
      return window.crossOriginIsolated === true
    } catch {
      return false
    }
  }

  /**
   * @param {object} [partial]
   */
  function assignCapabilities(partial) {
    window.SCA3D.capabilities = {
      webgpu: false,
      webgl2: detectWebGL2(),
      pointerEvents: detectPointerEvents(),
      touch: detectTouch(),
      iframe: detectIframe(),
      crossOriginIsolated: detectCrossOriginIsolated(),
      ...(window.SCA3D.capabilities && typeof window.SCA3D.capabilities === 'object' ?
        window.SCA3D.capabilities :
        {}),
      ...partial,
    }
  }

  assignCapabilities({ webgpu: false })

  /**
   * Probe async capabilities (WebGPU adapter). Safe when unavailable.
   */
  async function refreshAsyncCapabilities() {
    const webgpu = await detectWebGPU()
    assignCapabilities({ webgpu })
    return window.SCA3D.capabilities
  }

  /**
   * @param {string} message
   */
  function showRuntimeError(message) {
    if (!message) {
      return
    }

    let el = document.getElementById('sca-runtime-error')
    if (!el) {
      el = document.createElement('div')
      el.id = 'sca-runtime-error'
      el.setAttribute('role', 'alert')
      el.style.cssText = [
        'position:fixed',
        'inset:0',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'padding:24px',
        'box-sizing:border-box',
        'background:#111',
        'color:#f5f5f5',
        'font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif',
        'text-align:center',
        'z-index:99999',
      ].join(';')
      document.body.appendChild(el)
    }

    el.textContent = message
  }

  /**
   * @param {object} message
   */
  function safePostMessageToParent(message) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, '*')
      }
    } catch (error) {
      window.scaDebug?.('navigation', '[SCA3D] postMessage skipped:', error)
    }
  }

  /**
   * @param {object} [viewer]
   */
  function logRuntimeCompatibilitySummary(viewer) {
    if (!window.SCA3D?.debug?.runtimeCompatibility) {
      return
    }

    const caps = window.SCA3D.capabilities ?? {}
    const device = viewer?.global?.app?.graphicsDevice
    const renderer = device?.isWebGPU ? 'webgpu' : 'webgl2'
    const picker = window.SCA3D?.runtimePicker?.backendId ?? 'none'

    console.log(
      '[SCA RUNTIME COMPAT]\n' +
      `webgpu=${!!caps.webgpu}\n` +
      `webgl2=${!!caps.webgl2}\n` +
      `iframe=${!!caps.iframe}\n` +
      `pointerEvents=${!!caps.pointerEvents}\n` +
      `touch=${!!caps.touch}\n` +
      `picker=${picker}\n` +
      `renderer=${renderer}`
    )
  }

  window.SCA3D.assignCapabilities = assignCapabilities
  window.SCA3D.refreshAsyncCapabilities = refreshAsyncCapabilities
  window.SCA3D.showRuntimeError = showRuntimeError
  window.SCA3D.safePostMessageToParent = safePostMessageToParent
  window.SCA3D.logRuntimeCompatibilitySummary = logRuntimeCompatibilitySummary

  void refreshAsyncCapabilities()
})()
