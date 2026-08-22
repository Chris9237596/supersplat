/**
 * SCA3D runtime bootstrap for exported viewer packages.
 * Annotations are embedded in settings.json; project.json is loaded for click rules.
 */
;(function () {
  const DEFAULT_PROJECT_URL = './project.json'
  const DEFAULT_ANIMATION_DURATION = 1.5
  const DEFAULT_FOCUS_TRANSITION_DURATION = 0.8
  const DEFAULT_HOME_TRANSITION_DURATION = 1.0
  const DEFAULT_BACKGROUND_COLOR = '#000000'
  const FLY_TO_START_SCALE = 2.5
  const DISABLED_HELP_ACTIONS = new Set([
    'help.action.set-focus',
    'help.action.fly-to-point',
    'help.action.focus-point',
  ])

  const SCA_NAVIGATION_SETTINGS = {
    disableAnnotationCameraNavigation: true,
    navigationTargetsEnabled: true,
  }

  /**
   * @param {unknown} raw
   * @param {number} fallback
   * @param {number} max
   */
  function normalizeTransitionDuration(raw, fallback, max) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return fallback
    }
    return Math.min(max, Math.max(0, raw))
  }

  /**
   * @param {unknown} raw
   */
  function normalizeInteraction(raw) {
    const record = raw && typeof raw === 'object' ? raw : {}
    const focusRaw = record.focusTransition
    const homeRaw = record.homeTransition
    const focusRecord = focusRaw && typeof focusRaw === 'object' ? focusRaw : {}
    const homeRecord = homeRaw && typeof homeRaw === 'object' ? homeRaw : {}

    return {
      focusTransition: {
        duration: normalizeTransitionDuration(
          focusRecord.duration,
          DEFAULT_FOCUS_TRANSITION_DURATION,
          3
        )
      },
      homeTransition: {
        duration: normalizeTransitionDuration(
          homeRecord.duration,
          DEFAULT_HOME_TRANSITION_DURATION,
          5
        )
      }
    }
  }

  /**
   * @param {unknown} raw
   * @returns {'orbit' | 'fly'}
   */
  function normalizeNavigationMode(raw) {
    return raw === 'fly' ? 'fly' : 'orbit'
  }

  /**
   * @param {unknown} raw
   * @returns {'none' | 'flyTo' | 'turntable'}
   */
  function normalizeAnimationType(raw) {
    if (raw === 'flyTo') {
      return 'flyTo'
    }
    if (raw === 'turntable') {
      return 'turntable'
    }
    return 'none'
  }

  /**
   * @param {unknown} raw
   */
  function normalizeTurntable(raw) {
    const record = raw && typeof raw === 'object' ? raw : {}
    const duration = typeof record.duration === 'number' &&
      Number.isFinite(record.duration) &&
      record.duration > 0 ?
      Math.min(record.duration, 120) :
      10

    const degrees = typeof record.degrees === 'number' &&
      Number.isFinite(record.degrees) &&
      record.degrees > 0 ?
      Math.min(record.degrees, 720) :
      360

    return {
      duration,
      direction: record.direction === 'counterclockwise' ? 'counterclockwise' : 'clockwise',
      degrees,
      loop: record.loop !== false,
    }
  }

  /**
   * @param {unknown} raw
   * @returns {number[] | null}
   */
  function normalizeVec3(raw) {
    if (!Array.isArray(raw) || raw.length !== 3) {
      return null
    }
    if (!raw.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      return null
    }
    return [raw[0], raw[1], raw[2]]
  }

  /**
   * @param {unknown} raw
   */
  function normalizeHotspots(raw) {
    const record = raw && typeof raw === 'object' ? raw : {}
    return {
      showCards: record.showCards !== false,
    }
  }

  /**
   * @param {object | undefined} settingsJson
   * @returns {{ position: number[], target: number[], fov: number } | null}
   */
  function fallbackInitialFromSettings(settingsJson) {
    const initial = settingsJson?.cameras?.[0]?.initial
    const position = normalizeVec3(initial?.position)
    const target = normalizeVec3(initial?.target)
    const fov = typeof initial?.fov === 'number' && Number.isFinite(initial.fov) ? initial.fov : 60

    if (!position || !target) {
      return null
    }

    return { position, target, fov }
  }

  /**
   * @param {unknown} raw
   */
  function normalizeBackground(raw) {
    if (!raw || typeof raw !== 'object') {
      return { type: 'color', color: DEFAULT_BACKGROUND_COLOR }
    }

    const record = raw
    if (record.type === 'transparent') {
      return { type: 'transparent' }
    }

    if (record.type === 'image') {
      const imageRaw = record.image
      const image = imageRaw && typeof imageRaw === 'object' ? imageRaw : {}
      const filename = typeof image.filename === 'string' && image.filename.trim() ?
        image.filename.trim() :
        undefined
      return {
        type: 'image',
        image: {
          assetId: typeof image.assetId === 'string' ? image.assetId : 'background',
          ...(filename ? { filename } : {})
        }
      }
    }

    if (record.type === 'panorama') {
      const imageRaw = record.image
      const image = imageRaw && typeof imageRaw === 'object' ? imageRaw : {}
      const filename = typeof image.filename === 'string' && image.filename.trim() ?
        image.filename.trim() :
        undefined
      return {
        type: 'panorama',
        image: {
          assetId: typeof image.assetId === 'string' ? image.assetId : 'background',
          ...(filename ? { filename } : {})
        }
      }
    }

    const color = typeof record.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(record.color.trim()) ?
      record.color.trim().toLowerCase() :
      DEFAULT_BACKGROUND_COLOR

    return { type: 'color', color }
  }

  /**
   * @param {string} assetPath
   */
  function resolveEmbeddedAssetUrl(assetPath) {
    const embedded = window.__SCA3D_EMBEDDED_ASSETS__
    if (embedded && typeof embedded[assetPath] === 'string') {
      return embedded[assetPath]
    }

    return `./${assetPath}`
  }

  /**
   * @param {object} viewer
   */
  function findViewerCameraComponent(viewer) {
    const app = viewer.global?.app
    if (!app?.root?.findByName) {
      return null
    }

    return app.root.findByName('camera')?.camera ?? null
  }

  /**
   * @param {ReturnType<typeof normalizeBackground>} background
   * @param {object} viewer
   */
  function applyViewerBackground(background, viewer) {
    const canvas = document.getElementById('application-canvas')
    let layer = document.getElementById('sca-viewer-background')

    if (!layer) {
      layer = document.createElement('div')
      layer.id = 'sca-viewer-background'
      layer.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:0',
        'pointer-events:none',
        'background-repeat:no-repeat',
        'background-position:center',
        'background-size:cover'
      ].join(';')
      document.body.insertBefore(layer, canvas || document.body.firstChild)
    }

    if (canvas && !canvas.style.position) {
      canvas.style.position = 'fixed'
    }

    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    layer.style.backgroundColor = 'transparent'
    layer.style.backgroundImage = 'none'

    const cameraComponent = findViewerCameraComponent(viewer)

    if (background.type === 'transparent') {
      if (cameraComponent?.clearColor) {
        cameraComponent.clearColor.r = 0
        cameraComponent.clearColor.g = 0
        cameraComponent.clearColor.b = 0
        cameraComponent.clearColor.a = 0
      }
      return
    }

    if (background.type === 'image') {
      const filename = background.image?.filename
      if (filename) {
        const assetPath = `assets/${filename}`
        layer.style.backgroundImage = `url("${resolveEmbeddedAssetUrl(assetPath)}")`
      }

      if (cameraComponent?.clearColor) {
        cameraComponent.clearColor.r = 0
        cameraComponent.clearColor.g = 0
        cameraComponent.clearColor.b = 0
        cameraComponent.clearColor.a = 0
      }
      return
    }

    if (background.type === 'panorama') {
      layer.style.backgroundImage = 'none'
      layer.style.backgroundColor = 'transparent'

      if (cameraComponent?.clearColor) {
        cameraComponent.clearColor.r = 0
        cameraComponent.clearColor.g = 0
        cameraComponent.clearColor.b = 0
        cameraComponent.clearColor.a = 0
      }
      return
    }

    const color = background.color || DEFAULT_BACKGROUND_COLOR
    document.body.style.background = color
    layer.style.backgroundColor = color

    if (cameraComponent?.clearColor) {
      const hex = color.slice(1)
      cameraComponent.clearColor.r = parseInt(hex.slice(0, 2), 16) / 255
      cameraComponent.clearColor.g = parseInt(hex.slice(2, 4), 16) / 255
      cameraComponent.clearColor.b = parseInt(hex.slice(4, 6), 16) / 255
      cameraComponent.clearColor.a = 1
    }
  }

  /**
   * @param {object} project
   * @param {object | undefined} settingsJson
   */
  function normalizeViewerConfig(project, settingsJson) {
    const fallback = fallbackInitialFromSettings(settingsJson) || {
      position: [0, 1, -1],
      target: [0, 0, 0],
      fov: 60
    }

    const raw = project?.viewer
    const rawCamera = raw?.camera || {}
    const rawInitial = rawCamera.initial || {}
    const rawAnimation = rawCamera.animation || {}
    const rawNavigation = raw?.navigation || {}
    const rawInteraction = raw?.interaction

    const position = normalizeVec3(rawInitial.position) || fallback.position
    const target = normalizeVec3(rawInitial.target) || fallback.target
    const fov = typeof rawInitial.fov === 'number' && Number.isFinite(rawInitial.fov) ?
      rawInitial.fov :
      fallback.fov

    let allowedModes = Array.isArray(rawNavigation.allowedModes) ?
      rawNavigation.allowedModes
        .map(normalizeNavigationMode)
        .filter((mode, index, list) => list.indexOf(mode) === index) :
      ['orbit']

    if (allowedModes.length === 0) {
      allowedModes = ['orbit']
    }

    const defaultModeCandidate = normalizeNavigationMode(rawNavigation.defaultMode)
    const defaultMode = allowedModes.includes(defaultModeCandidate) ?
      defaultModeCandidate :
      allowedModes[0]

    const duration = typeof rawAnimation.duration === 'number' &&
      Number.isFinite(rawAnimation.duration) &&
      rawAnimation.duration > 0 ?
      rawAnimation.duration :
      DEFAULT_ANIMATION_DURATION

    const animationType = normalizeAnimationType(rawAnimation.type)
    const turntableRaw = rawAnimation.turntable
    const rawNavTargets = raw?.navigationTargets ?? {}

    return {
      camera: {
        initial: { position, target, fov },
        animation: {
          type: animationType,
          duration,
          turntable: normalizeTurntable(turntableRaw),
        },
      },
      navigation: {
        defaultMode,
        allowedModes
      },
      navigationTargets: {
        enabled: rawNavTargets.enabled !== false,
        hotspots: rawNavTargets.hotspots !== false,
        regions: rawNavTargets.regions !== false,
      },
      interaction: normalizeInteraction(rawInteraction),
      background: normalizeBackground(raw?.background),
      hotspots: normalizeHotspots(raw?.hotspots),
    }
  }

  /**
   * Convert client coordinates to render-target pixels (mirrors viewer.pickGaussian).
   * @param {object} viewer
   * @param {number} clientX
   * @param {number} clientY
   */
  function clientToPickNormalized(viewer, clientX, clientY) {
    const canvas = viewer?.global?.app?.graphicsDevice?.canvas ??
      document.getElementById('application-canvas')
    const device = viewer?.global?.app?.graphicsDevice
    if (!canvas || !device) {
      return null
    }

    const rect = canvas.getBoundingClientRect()
    const width = Math.floor(device.width)
    const height = Math.floor(device.height)
    if (!rect.width || !rect.height || width <= 0 || height <= 0) {
      return null
    }

    const scaleX = width / rect.width
    const scaleY = height / rect.height
    const pixelX = Math.min(width - 1, Math.max(0, Math.floor((clientX - rect.left) * scaleX)))
    const pixelY = Math.min(height - 1, Math.max(0, Math.floor((clientY - rect.top) * scaleY)))

    return {
      nx: pixelX / width,
      ny: pixelY / height,
      pixelX,
      pixelY,
    }
  }

  /**
   * Top navigation: Hotspots + Regions in the viewer annotation nav bar.
   * @param {object} viewer
   * @param {object} project
   * @param {ReturnType<typeof normalizeViewerConfig>} viewerConfig
   */
  function initScaNavigationTargets(viewer, project, viewerConfig) {
    const navConfig = viewerConfig.navigationTargets ?? { enabled: true, hotspots: true, regions: true }

    if (navConfig.enabled === false) {
      return
    }

    const targets = []

    if (navConfig.hotspots !== false) {
      const hotspots = Array.isArray(project?.hotspots) ? project.hotspots : []
      for (const hotspot of hotspots) {
        if (hotspot?.enabled === false) {
          continue
        }
        if (hotspot?.interaction?.showInNavigation === false) {
          continue
        }
        targets.push({
          type: 'hotspot',
          id: hotspot.id,
          title: hotspot.name || hotspot.title || hotspot.id || 'Hotspot',
          data: hotspot,
        })
      }
    }

    if (navConfig.regions !== false) {
      const regions = Array.isArray(project?.regions) ? project.regions : []
      for (const region of regions) {
        if (region?.enabled === false) {
          continue
        }
        if (region?.interaction?.showInNavigation === false) {
          continue
        }
        targets.push({
          type: 'region',
          id: region.id,
          title: region.name || region.title || region.id || 'Region',
          data: region,
        })
      }
    }

    if (targets.length < 2) {
      return
    }

    const nav = document.getElementById('annotationNav')
    const titleEl = document.getElementById('annotationNavTitle')
    const prevBtn = document.getElementById('annotationPrev')
    const nextBtn = document.getElementById('annotationNext')
    const infoEl = document.getElementById('annotationInfo')
    if (!nav || !titleEl || !prevBtn || !nextBtn || !infoEl) {
      return
    }

    let typeEl = document.getElementById('annotationNavType')
    if (!typeEl) {
      typeEl = document.createElement('span')
      typeEl.id = 'annotationNavType'
      typeEl.className = 'sca-nav-target-type'
      typeEl.style.display = 'block'
      typeEl.style.fontSize = '10px'
      typeEl.style.letterSpacing = '0.08em'
      typeEl.style.opacity = '0.65'
      infoEl.insertBefore(typeEl, titleEl)
    }

    let currentIndex = 0

    const updateDisplay = () => {
      const target = targets[currentIndex]
      typeEl.textContent = target.type === 'region' ? 'REGION' : 'HOTSPOT'
      titleEl.textContent = target.title
    }

    const activateTarget = (target) => {
      if (target.type === 'hotspot') {
        window.SCA3D.activateHotspot?.(target.data)
        window.SCA3D.handleHotspotClick?.(target.data)
        return
      }

      window.SCA3D.activateRegion?.(target.data)
      window.SCA3D.state.selectedRegionId = target.id
      window.SCA3D.hotspotOverlay?.setSelected(null)

      if (target.data.interaction?.showCard === false) {
        window.SCA3D.regionOverlay?.hide()
        return
      }

      window.SCA3D.regionOverlay?.setActiveRegion(target.id, null)
      console.log(`[SCA REGION CARD] show ${target.id} (navigation)`)
    }

    const goTo = (index) => {
      currentIndex = ((index % targets.length) + targets.length) % targets.length
      updateDisplay()
      activateTarget(targets[currentIndex])
    }

    prevBtn.replaceWith(prevBtn.cloneNode(true))
    nextBtn.replaceWith(nextBtn.cloneNode(true))
    const freshPrev = document.getElementById('annotationPrev')
    const freshNext = document.getElementById('annotationNext')

    freshPrev.addEventListener('click', (event) => {
      event.stopPropagation()
      goTo(currentIndex - 1)
    })
    freshNext.addEventListener('click', (event) => {
      event.stopPropagation()
      goTo(currentIndex + 1)
    })

    const { events, state } = viewer.global
    const syncMode = () => {
      if (!state.loaded) {
        return
      }
      nav.classList.remove('desktop', 'touch', 'hidden')
      nav.classList.add(state.inputMode)
    }
    const syncFade = () => {
      if (!state.loaded) {
        return
      }
      nav.classList.toggle('faded-in', !state.controlsHidden)
      nav.classList.toggle('faded-out', state.controlsHidden)
    }

    events.on('loaded:changed', () => {
      syncMode()
      syncFade()
    })
    events.on('inputMode:changed', syncMode)
    events.on('controlsHidden:changed', syncFade)

    updateDisplay()
    syncMode()
    syncFade()

    console.log(`[SCA3D] navigation targets ready (${targets.length}: ${targets.filter((t) => t.type === 'hotspot').length} hotspot(s), ${targets.filter((t) => t.type === 'region').length} region(s))`)
  }

  /**
   * @param {{ position: number[], target: number[] }} pose
   */
  function computeCameraDistance(pose) {
    const [px, py, pz] = pose.position
    const [tx, ty, tz] = pose.target
    const dx = px - tx
    const dy = py - ty
    const dz = pz - tz
    return Math.sqrt(dx * dx + dy * dy + dz * dz)
  }

  /**
   * @param {{ position: number[], target: number[], fov: number }} pose
   * @param {number} [scale]
   */
  function computeFlyToStartPose(pose, scale = FLY_TO_START_SCALE) {
    const distance = computeCameraDistance(pose)
    if (distance <= 1e-6) {
      return {
        position: [...pose.position],
        target: [...pose.target],
        fov: pose.fov
      }
    }

    const [px, py, pz] = pose.position
    const [tx, ty, tz] = pose.target
    const factor = scale

    return {
      position: [
        tx + (px - tx) * factor,
        ty + (py - ty) * factor,
        tz + (pz - tz) * factor
      ],
      target: [...pose.target],
      fov: pose.fov
    }
  }

  /**
   * @param {object} viewer
   * @param {{ position: number[], target: number[], fov: number }} startPose
   * @param {{ position: number[], target: number[], fov: number }} endPose
   * @param {number} durationSeconds
   */
  async function runStartupFlyTo(viewer, startPose, endPose, durationSeconds) {
    if (typeof viewer.animateStartupTransition !== 'function') {
      console.warn('[SCA3D] animateStartupTransition unavailable on viewer')
      return
    }

    const diag = window.__SCA3D_CAMERA_DIAG
    diag.flyToStartCount = (diag.flyToStartCount || 0) + 1

    console.log('[SCA3D] startup flyTo start', JSON.stringify({
      startCount: diag.flyToStartCount,
      duration: durationSeconds,
      startPosition: startPose.position,
      endPosition: endPose.position
    }))

    await viewer.animateStartupTransition(startPose, endPose, durationSeconds)
  }

  /**
   * Shared diagnostic state read by patched CameraManager.update().
   */
  window.__SCA3D_CAMERA_DIAG = window.__SCA3D_CAMERA_DIAG || {
    flyToActive: false,
    flyToT: null,
    flyToStartCount: 0,
    startupAnimationType: null,
    startupAnimationDuration: null
  }

  /**
   * @param {object} viewer
   */
  function interruptCameraTransitions(viewer) {
    viewer.interruptScaCameraAnimations?.()
  }

  /**
   * @param {object} viewer
   */
  function setupAnimationInterrupt(viewer) {
    const canvas = document.getElementById('application-canvas')
    const interrupt = () => interruptCameraTransitions(viewer)

    canvas?.addEventListener('pointerdown', interrupt, true)
    canvas?.addEventListener('wheel', interrupt, { capture: true, passive: true })
    canvas?.addEventListener('touchstart', interrupt, { capture: true, passive: true })

    window.addEventListener('keydown', (event) => {
      const tag = event.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) {
        return
      }

      const navCodes = new Set([
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'KeyW',
        'KeyA',
        'KeyS',
        'KeyD',
        'Space',
      ])

      if (navCodes.has(event.code)) {
        interrupt()
      }
    }, true)
  }

  /**
   * @param {object} settingsJson
   */
  function applyScaNavigationSettings(settingsJson, viewerConfig) {
    const clone = JSON.parse(JSON.stringify(settingsJson))
    const navTargets = viewerConfig?.navigationTargets ?? { enabled: true, hotspots: true, regions: true }
    clone.navigation = {
      ...SCA_NAVIGATION_SETTINGS,
      ...(clone.navigation || {}),
      navigationTargetsEnabled: navTargets.enabled !== false,
    }
    return clone
  }

  /**
   * @param {object} viewer
   * @returns {number[] | null}
   */
  function readCameraPosition(viewer) {
    const cam = viewer?.cameraManager?.camera
    if (!cam?.position) {
      return null
    }
    return [cam.position.x, cam.position.y, cam.position.z]
  }

  /**
   * @param {object} viewer
   * @returns {{ position: number[], target: number[], fov: number } | null}
   */
  function readCurrentCameraPose(viewer) {
    const cam = viewer?.cameraManager?.camera
    if (!cam) {
      return null
    }

    const radX = cam.angles.x * Math.PI / 180
    const radY = cam.angles.y * Math.PI / 180
    const cosx = Math.cos(radX)
    const sinx = Math.sin(radX)
    const cosy = Math.cos(radY)
    const siny = Math.sin(radY)
    const fx = -siny * cosx
    const fy = sinx
    const fz = -cosy * cosx

    return {
      position: [cam.position.x, cam.position.y, cam.position.z],
      target: [
        cam.position.x + fx * cam.distance,
        cam.position.y + fy * cam.distance,
        cam.position.z + fz * cam.distance
      ],
      fov: cam.fov
    }
  }

  /**
   * @param {object} viewer
   * @param {number[]} focusTarget
   * @param {number} duration
   */
  function animateHotspotFocus(viewer, focusTarget, duration) {
    viewer.cancelLookAnimation?.()
    viewer.lookAtTargetAnimatedWithoutMovingCamera?.(focusTarget, duration)
  }

  /**
   * @param {object} viewer
   * @param {ReturnType<typeof normalizeViewerConfig>} viewerConfig
   */
  async function runHomeTransition(viewer, viewerConfig) {
    interruptCameraTransitions(viewer)

    const startPose = readCurrentCameraPose(viewer)
    const endPose = viewerConfig.camera.initial
    const duration = viewerConfig.interaction.homeTransition.duration

    if (!startPose) {
      return
    }

    if (typeof viewer.animateHomeTransition !== 'function') {
      console.warn('[SCA3D] animateHomeTransition unavailable on viewer')
      return
    }

    console.log('[SCA3D] home transition start')
    console.log('duration', duration)
    console.log('fromPosition', startPose.position)
    console.log('toPosition', endPose.position)

    await viewer.animateHomeTransition(startPose, endPose, duration)
  }

  /**
   * @param {object} viewer
   * @param {ReturnType<typeof normalizeViewerConfig>} viewerConfig
   */
  function setupHomeResetButton(viewer, viewerConfig) {
    if (document.getElementById('scaHomeView')) {
      return
    }

    const controlsGroup = document.getElementById('info')?.closest('.buttonGroup')
    if (!controlsGroup) {
      console.warn('[SCA3D] home button unavailable: viewer controls not found')
      return
    }

    const homeButton = document.createElement('button')
    homeButton.id = 'scaHomeView'
    homeButton.className = 'controlButton'
    homeButton.type = 'button'
    homeButton.title = 'Reset view'
    homeButton.setAttribute('aria-label', 'Reset view')
    homeButton.innerHTML = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">',
      '<g class="stroke"><path d="M5 10.5 12 4l7 6.5V19a1 1 0 0 1-1 1h-5v-6H11v6H6a1 1 0 0 1-1-1v-8.5z" fill="none" stroke-width="1.6" stroke-linejoin="round"/></g>',
      '<g class="fill"><path d="M12 5.8 7 10v8h3v-6h4v6h3v-8l-5-4.2z"/></g>',
      '</svg>',
    ].join('')

    const infoButton = document.getElementById('info')
    if (infoButton) {
      controlsGroup.insertBefore(homeButton, infoButton)
    } else {
      controlsGroup.appendChild(homeButton)
    }

    let homeInProgress = false

    const triggerHome = (event) => {
      event?.preventDefault?.()
      event?.stopPropagation?.()
      if (homeInProgress) {
        return
      }

      homeInProgress = true
      runHomeTransition(viewer, viewerConfig)
        .catch((error) => {
          console.warn('[SCA3D] home transition failed:', error)
        })
        .finally(() => {
          homeInProgress = false
        })
    }

    homeButton.addEventListener('click', triggerHome)

    window.addEventListener('keydown', (event) => {
      const tag = event.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) {
        return
      }
      if (event.key === 'f' || event.key === 'F') {
        triggerHome(event)
      }
    })

    if (window.SCA3D?.ui?.controls) {
      window.SCA3D.ui.controls.home = homeButton
    }
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
   * @param {object} viewer
   * @param {ReturnType<typeof normalizeViewerConfig>} viewerConfig
   * @param {object} hotspot
   */
  function activateScaHotspot(viewer, viewerConfig, hotspot) {
    if (!hotspot?.id) {
      return
    }

    interruptCameraTransitions(viewer)

    window.SCA3D.state.selectedHotspotId = hotspot.id
    window.SCA3D.state.selectedRegionId = null
    window.SCA3D.hotspotOverlay?.setSelected(hotspot.id)
    window.SCA3D.regionOverlay?.hide()

    if (hotspot.position) {
      animateHotspotFocus(
        viewer,
        hotspot.position,
        viewerConfig.interaction.focusTransition.duration
      )
    }
  }

  /**
   * @param {object} viewer
   * @param {object} region
   */
  function activateScaRegion(viewer, region) {
    if (!region?.id) {
      return
    }

    interruptCameraTransitions(viewer)

    window.SCA3D.state.selectedRegionId = region.id
    window.SCA3D.state.selectedHotspotId = null
    window.SCA3D.hotspotOverlay?.setSelected(null)
  }

  /**
   * @param {object} viewer
   * @param {Map<string, object>} hotspotById
   * @param {ReturnType<typeof normalizeViewerConfig>} viewerConfig
   */
  function setupScaFocusCamera(viewer, hotspotById, viewerConfig) {
    const events = viewer.global?.events
    if (!events) {
      return
    }

    const focusDuration = viewerConfig.interaction.focusTransition.duration

    const resolveHotspot = (annotation) => {
      const id = annotation?.extras?.id
      if (typeof id === 'string' && id.trim() && hotspotById.has(id.trim())) {
        return hotspotById.get(id.trim())
      }

      return null
    }

    let pendingDeselectTimer = null

    events.on('annotation.activate', (annotation) => {
      if (pendingDeselectTimer) {
        clearTimeout(pendingDeselectTimer)
        pendingDeselectTimer = null
      }

      const hotspot = resolveHotspot(annotation)
      if (!hotspot?.position) {
        return
      }

      activateScaHotspot(viewer, viewerConfig, hotspot)

      const positionBefore = readCameraPosition(viewer)
      console.log('[SCA3D] select animation')
      console.log('position before', positionBefore)
      console.log('position after', readCameraPosition(viewer))
      console.log('target', hotspot.position)
      console.log('duration', focusDuration)
    })

    events.on('annotation.deactivate', () => {
      if (pendingDeselectTimer) {
        clearTimeout(pendingDeselectTimer)
      }

      pendingDeselectTimer = setTimeout(() => {
        pendingDeselectTimer = null
        window.SCA3D.state.selectedHotspotId = null
        window.SCA3D.hotspotOverlay?.setSelected(null)
      }, 0)
    })
  }

  /**
   * @param {ReturnType<typeof normalizeViewerConfig>} viewerConfig
   */
  function applyAnimationUiPolicy(viewerConfig) {
    if (viewerConfig.camera.animation.type !== 'none') {
      return
    }

    for (const id of ['play', 'pause', 'timelineContainer']) {
      document.getElementById(id)?.classList.add('hidden')
    }

    const playButton = document.getElementById('play')
    const playGroup = playButton?.closest('.buttonGroup')
    if (playGroup?.querySelector('#play') && playGroup?.querySelector('#pause')) {
      playGroup.classList.add('hidden')
    }
  }

  /**
   * @param {HTMLElement} root
   */
  function groupHelpSections(root) {
    /** @type {Array<{ mode: string, nodes: Element[] }>} */
    const sections = []
    let current = null

    for (const child of root.children) {
      if (child instanceof HTMLElement && child.matches('h1[data-i18n^="help.section."]')) {
        const key = child.getAttribute('data-i18n') || ''
        current = {
          mode: key.replace('help.section.', ''),
          nodes: [child],
        }
        sections.push(current)
        continue
      }

      if (child instanceof HTMLElement && child.classList.contains('control-spacer') && !current) {
        continue
      }

      if (current) {
        current.nodes.push(child)
      }
    }

    return sections
  }

  /**
   * @param {object} viewer
   */
  function setupHelpPanelFiltering(viewer) {
    const events = viewer.global?.events
    const state = viewer.global?.state
    if (!events || !state) {
      return
    }

    const panelRoots = ['desktopInfoPanel', 'touchInfoPanel']
      .map((id) => document.getElementById(id))
      .filter(Boolean)

    const sections = panelRoots.flatMap((root) => groupHelpSections(root))
    if (sections.length === 0) {
      return
    }

    const hideDisabledHelpItems = (root) => {
      root.querySelectorAll('.control-item').forEach((item) => {
        const action = item.querySelector('[data-i18n]')?.getAttribute('data-i18n')
        if (action && DISABLED_HELP_ACTIONS.has(action)) {
          item.classList.add('hidden')
        }
      })
    }

    panelRoots.forEach(hideDisabledHelpItems)

    const updateVisibleHelp = () => {
      const activeMode = state.cameraMode === 'fly' ? 'fly' : (state.cameraMode === 'walk' ? 'walk' : 'orbit')

      for (const section of sections) {
        const visible = section.mode === activeMode
        for (const node of section.nodes) {
          node.classList.toggle('hidden', !visible)
        }
      }
    }

    updateVisibleHelp()
    events.on('cameraMode:changed', updateVisibleHelp)
  }

  /**
   * Expose common runtime controls so export UX can hide/show them later.
   * @param {object} viewer
   */
  function setupModularSettingsUi(viewer) {
    const controls = {
      performanceMode: document.getElementById('performanceModeRow'),
      frame: document.getElementById('frame'),
      reset: document.getElementById('reset'),
      home: document.getElementById('scaHomeView'),
      settings: document.getElementById('settings'),
      info: document.getElementById('info'),
      play: document.getElementById('play'),
      pause: document.getElementById('pause'),
      timeline: document.getElementById('timelineContainer'),
    }

    window.SCA3D.ui = {
      controls,
      setVisible(name, visible) {
        const element = controls[name]
        if (element) {
          element.classList.toggle('hidden', !visible)
        }
      },
    }

    void viewer
  }

  /**
   * @param {object} viewer
   * @param {ReturnType<typeof normalizeViewerConfig>} viewerConfig
   * @param {Map<string, object>} hotspotById
   */
  function applyRuntimeUx(viewer, viewerConfig, hotspotById) {
    setupScaFocusCamera(viewer, hotspotById, viewerConfig)
    setupAnimationInterrupt(viewer)
    setupHomeResetButton(viewer, viewerConfig)
    applyAnimationUiPolicy(viewerConfig)
    setupHelpPanelFiltering(viewer)
    setupModularSettingsUi(viewer)

    viewer.global?.events?.once('firstFrame', () => {
      applyAnimationUiPolicy(viewerConfig)
    })
  }

  /**
   * @param {object} viewer
   * @param {{ navigation: { defaultMode: string, allowedModes: string[] } }} viewerConfig
   */
  function applyNavigationRestrictions(viewer, viewerConfig) {
    const { state, events } = viewer.global || {}
    if (!state) {
      return
    }

    const allowedModes = viewerConfig.navigation.allowedModes
    const defaultMode = viewerConfig.navigation.defaultMode
    const allowOrbit = allowedModes.includes('orbit')
    const allowFly = allowedModes.includes('fly')

    const orbitButton = document.getElementById('orbitCamera')
    const flyButton = document.getElementById('flyCamera')
    const walkButton = document.getElementById('fpsCamera')

    if (walkButton) {
      walkButton.classList.add('hidden')
    }

    if (orbitButton) {
      orbitButton.classList.toggle('hidden', !allowOrbit)
    }
    if (flyButton) {
      flyButton.classList.toggle('hidden', !allowFly)
    }

    const modeGroup = orbitButton?.closest('.buttonGroup')
    if (modeGroup && allowedModes.length <= 1) {
      modeGroup.classList.add('hidden')
    }

    const enforceMode = () => {
      if (!allowedModes.includes(state.cameraMode)) {
        state.cameraMode = defaultMode
      }
    }

    enforceMode()
    if (state.cameraMode === 'anim' || state.cameraMode !== defaultMode) {
      state.cameraMode = defaultMode
    }
    state.animationPaused = true

    events?.on('cameraMode:changed', enforceMode)
  }

  /**
   * @param {object} viewer
   * @param {ReturnType<typeof normalizeViewerConfig>} viewerConfig
   */
  async function applyViewerConfig(viewer, viewerConfig) {
    applyNavigationRestrictions(viewer, viewerConfig)

    const { animation, initial } = viewerConfig.camera
    const diag = window.__SCA3D_CAMERA_DIAG
    diag.startupAnimationType = animation.type
    diag.startupAnimationDuration = animation.duration

    console.log('[SCA3D] viewer.camera.animation', JSON.stringify({
      type: animation.type,
      duration: animation.duration,
      turntable: animation.turntable,
    }))

    const waitForLoaded = () => new Promise((resolve) => {
      const { state, events } = viewer.global || {}
      if (state?.loaded) {
        resolve()
        return
      }

      events?.once('firstFrame', () => resolve())
    })

    if (animation.type === 'flyTo') {
      await waitForLoaded()

      const startPose = (window.SCA3D?.computeFlyToStartPose ?? computeFlyToStartPose)(initial)
      await runStartupFlyTo(viewer, startPose, initial, animation.duration)
      return
    }

    if (animation.type === 'turntable') {
      await waitForLoaded()

      const turntable = animation.turntable
      if (turntable && typeof viewer.animateTurntable === 'function') {
        viewer.animateTurntable(initial, turntable)
      } else {
        console.warn('[SCA3D] animateTurntable unavailable on viewer')
      }
    }
  }

  /**
   * @param {string} [url]
   */
  async function loadProject(url = DEFAULT_PROJECT_URL) {
    if (window.__SCA3D_EMBEDDED_PROJECT__) {
      const project = window.__SCA3D_EMBEDDED_PROJECT__
      if (!project || project.version !== 1 || !Array.isArray(project.hotspots)) {
        throw new Error('[SCA3D] invalid embedded project: expected { version: 1, hotspots: [] }')
      }

      if (!Array.isArray(project.regions)) {
        project.regions = []
      }

      const regionCount = project.regions.length
      console.log(`[SCA3D] project loaded: ${project.hotspots.length} hotspot(s), ${regionCount} region(s) from embedded preview data`)
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

    if (!Array.isArray(project.regions)) {
      project.regions = []
    }

    console.log(`[SCA3D] project loaded: ${project.hotspots.length} hotspot(s), ${project.regions.length} region(s) from ${url}`)
    return project
  }

  /**
   * Attach viewer.pickGaussian from the patched Viewer/Picker API if present.
   * @param {object} viewer
   * @returns {boolean}
   */
  function attachScaPickGaussian(viewer) {
    if (typeof viewer?.pickGaussian === 'function') {
      return true
    }
    if (typeof viewer?.picker?.pickGaussianId === 'function') {
      viewer.pickGaussian = async (clientX, clientY) => {
        const coords = clientToPickNormalized(viewer, clientX, clientY)
        if (!coords) {
          return null
        }
        const result = await viewer.picker.pickGaussianId(coords.nx, coords.ny)
        if (!result || result.gaussianIndex === null || result.gaussianIndex === undefined) {
          return null
        }
        return {
          gaussianIndex: result.gaussianIndex,
          position: result.position,
          scaSplatId: window.SCA3D?.state?.defaultScaSplatId ?? 'splat_01',
          screenX: coords.pixelX,
          screenY: coords.pixelY,
          clientX,
          clientY,
        }
      }
      return true
    }
    return false
  }

  /**
   * Wait until the viewer bundle exposes the Gaussian picker (after gsplat load).
   * @param {object} viewer
   * @param {number} [timeoutMs]
   */
  function waitForScaPicker(viewer, timeoutMs = 120000) {
    if (attachScaPickGaussian(viewer)) {
      return Promise.resolve()
    }

    const { events } = viewer.global
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs
      let settled = false

      const cleanup = () => {
        events.off('scaPickerReady', onSignal)
        events.off('frame:ready', onSignal)
        clearInterval(timer)
      }

      const tryAttach = () => {
        if (settled) {
          return true
        }
        if (attachScaPickGaussian(viewer)) {
          settled = true
          cleanup()
          resolve()
          return true
        }
        return false
      }

      const onSignal = () => {
        tryAttach()
      }

      events.on('scaPickerReady', onSignal)
      events.on('frame:ready', onSignal)

      if (tryAttach()) {
        return
      }

      const timer = setInterval(() => {
        if (tryAttach()) {
          return
        }
        if (Date.now() > deadline) {
          settled = true
          cleanup()
          reject(new Error('[SCA3D] timed out waiting for Gaussian picker'))
        }
      }, 100)
    })
  }

  /**
   * @param {{ canvas: HTMLCanvasElement, settingsJson: object, config: object, main: Function }} args
   */
  async function bootstrapViewer({ canvas, settingsJson, config, main }) {
    const project = await loadProject()
    const viewerConfig = normalizeViewerConfig(project, settingsJson)
    const hotspotById = buildHotspotById(project.hotspots)
    const settingsForViewer = applyScaNavigationSettings(settingsJson, viewerConfig)

    if (viewerConfig.background.type === 'panorama') {
      const filename = viewerConfig.background.image?.filename
      if (filename) {
        config.skyboxUrl = resolveEmbeddedAssetUrl(`assets/${filename}`)
      }
    }

    const viewer = await main(canvas, settingsForViewer, config)

    window.SCA3D = window.SCA3D || {}
    window.SCA3D.state = window.SCA3D.state || {}
    window.SCA3D.state.project = project
    window.SCA3D.state.viewerConfig = viewerConfig
    window.SCA3D.state.hotspotById = hotspotById
    window.SCA3D.state.viewer = viewer
    window.SCA3D.activateHotspot = (hotspot) => activateScaHotspot(viewer, viewerConfig, hotspot)
    window.SCA3D.activateRegion = (region) => activateScaRegion(viewer, region)

    applyRuntimeUx(viewer, viewerConfig, hotspotById)
    applyViewerBackground(viewerConfig.background, viewer)

    viewer.global?.events?.once('firstFrame', () => {
      applyViewerBackground(viewerConfig.background, viewer)
    })

    if (typeof initHotspotBridge === 'function') {
      initHotspotBridge(viewer, { project })
    } else {
      console.warn('[SCA3D] hotspot bridge not available')
    }

    if (typeof initScaHotspotOverlay === 'function') {
      initScaHotspotOverlay(viewer, project, viewerConfig)
    } else {
      console.warn('[SCA3D] hotspot overlay not available')
    }

    if (typeof initRegionBridge === 'function') {
      initRegionBridge(viewer, { project })
    } else {
      console.warn('[SCA3D] region bridge not available')
    }

    if (typeof initScaRegionOverlay === 'function') {
      initScaRegionOverlay(viewer, project)
    }

    const enabledRegions = Array.isArray(project.regions) ?
      project.regions.filter((region) => region?.enabled) :
      []

    if (enabledRegions.length > 0) {
      try {
        await waitForScaPicker(viewer)
      } catch (error) {
        console.error('[SCA3D] region picker unavailable:', error)
        throw error
      }

      if (typeof initScaRegionRuntime === 'function') {
        await initScaRegionRuntime(viewer, { project })
      }
    }

    initScaNavigationTargets(viewer, project, viewerConfig)

    applyViewerConfig(viewer, viewerConfig).catch((error) => {
      console.warn('[SCA3D] viewer config application failed:', error)
    })

    return viewer
  }

  window.SCA3D = window.SCA3D || {}
  window.SCA3D.loadProject = loadProject
  window.SCA3D.bootstrapViewer = bootstrapViewer
  window.SCA3D.normalizeViewerConfig = normalizeViewerConfig
  window.SCA3D.normalizeBackground = normalizeBackground
  window.SCA3D.applyViewerBackground = applyViewerBackground
  window.SCA3D.resetView = runHomeTransition
  window.SCA3D.interruptCameraTransitions = interruptCameraTransitions
})()
