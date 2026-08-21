/**
 * SCA3D runtime bootstrap for exported viewer packages.
 * Annotations are embedded in settings.json; project.json is loaded for click rules.
 */
;(function () {
  const DEFAULT_PROJECT_URL = './project.json'
  const DEFAULT_ANIMATION_DURATION = 1.5
  const DEFAULT_FOCUS_TRANSITION_DURATION = 0.8
  const DEFAULT_HOME_TRANSITION_DURATION = 1.0
  const FLY_TO_START_SCALE = 2.5
  const DISABLED_HELP_ACTIONS = new Set([
    'help.action.set-focus',
    'help.action.fly-to-point',
    'help.action.focus-point',
  ])

  const SCA_NAVIGATION_SETTINGS = {
    disableAnnotationCameraNavigation: true,
    navigationTargetsEnabled: false,
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
   * @returns {'none' | 'flyTo'}
   */
  function normalizeAnimationType(raw) {
    return raw === 'flyTo' ? 'flyTo' : 'none'
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

    return {
      camera: {
        initial: { position, target, fov },
        animation: {
          type: normalizeAnimationType(rawAnimation.type),
          duration
        }
      },
      navigation: {
        defaultMode,
        allowedModes
      },
      interaction: normalizeInteraction(rawInteraction)
    }
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
   * @param {{ position: number[], target: number[], fov: number }} pose
   */
  function poseToCameraSnapshot(pose) {
    const [px, py, pz] = pose.position
    const [tx, ty, tz] = pose.target
    const dx = tx - px
    const dy = ty - py
    const dz = tz - pz
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)

    if (distance <= 1e-6) {
      return {
        position: [px, py, pz],
        angles: [0, 0, 0],
        distance: 0,
        fov: pose.fov
      }
    }

    const dirX = dx / distance
    const dirY = dy / distance
    const dirZ = dz / distance
    const elev = Math.atan2(-dirY, Math.sqrt(dirX * dirX + dirZ * dirZ)) * (180 / Math.PI)
    const azim = Math.atan2(-dirX, -dirZ) * (180 / Math.PI)

    return {
      position: [px, py, pz],
      angles: [-elev, azim, 0],
      distance,
      fov: pose.fov
    }
  }

  /**
   * @param {object} cam
   * @param {{ position: number[], angles: number[], distance: number, fov: number }} snapshot
   */
  function applyCameraSnapshot(cam, snapshot) {
    cam.position.set(snapshot.position[0], snapshot.position[1], snapshot.position[2])
    cam.angles.set(snapshot.angles[0], snapshot.angles[1], snapshot.angles[2])
    cam.distance = snapshot.distance
    cam.fov = snapshot.fov
  }

  /**
   * @param {number} t
   */
  function easeOut(t) {
    return 1 - Math.pow(1 - t, 3)
  }

  /**
   * @param {object} from
   * @param {object} to
   * @param {number} t
   */
  function lerpSnapshot(from, to, t) {
    const lerp = (a, b) => a + (b - a) * t
    return {
      position: from.position.map((value, index) => lerp(value, to.position[index])),
      angles: from.angles.map((value, index) => lerp(value, to.angles[index])),
      distance: lerp(from.distance, to.distance),
      fov: lerp(from.fov, to.fov)
    }
  }

  /**
   * @type {{ cancel: () => void } | null}
   */
  let activeCameraTransition = null

  /**
   * @param {object} viewer
   */
  function cancelCameraTransition(viewer) {
    if (activeCameraTransition) {
      activeCameraTransition.cancel()
      activeCameraTransition = null
    }
  }

  /**
   * @param {object} viewer
   */
  function interruptCameraTransitions(viewer) {
    viewer.interruptScaCameraAnimations?.()
    cancelCameraTransition(viewer)
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
   * @param {object} viewer
   * @param {{ position: number[], target: number[], fov: number }} startPose
   * @param {{ position: number[], target: number[], fov: number }} endPose
   * @param {number} durationSeconds
   */
  function runFlyToAnimation(viewer, startPose, endPose, durationSeconds) {
    const cm = viewer.cameraManager
    if (!cm?.camera || typeof cm.snap !== 'function') {
      console.warn('[SCA3D] flyTo animation unavailable: camera manager missing')
      return Promise.resolve()
    }

    cancelCameraTransition(viewer)

    const from = poseToCameraSnapshot(startPose)
    const to = poseToCameraSnapshot(endPose)

    applyCameraSnapshot(cm.camera, from)
    cm.snap()

    const app = viewer.global?.app
    if (!app) {
      applyCameraSnapshot(cm.camera, to)
      cm.snap()
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      let elapsed = 0
      let cancelled = false

      const finish = () => {
        activeCameraTransition = null
        resolve()
      }

      const cancel = () => {
        if (cancelled) {
          return
        }
        cancelled = true
        cm.snap()
        finish()
      }

      activeCameraTransition = { cancel }

      const step = (dt) => {
        if (cancelled) {
          return
        }

        elapsed += dt
        const t = Math.min(1, elapsed / Math.max(durationSeconds, 0.001))
        applyCameraSnapshot(cm.camera, lerpSnapshot(from, to, easeOut(t)))
        app.renderNextFrame = true

        if (t < 1) {
          app.once('update', step)
        } else {
          cm.snap()
          finish()
        }
      }

      app.once('update', step)
    })
  }

  /**
   * @param {object} settingsJson
   */
  function applyScaNavigationSettings(settingsJson) {
    const clone = JSON.parse(JSON.stringify(settingsJson))
    clone.navigation = {
      ...(clone.navigation || {}),
      ...SCA_NAVIGATION_SETTINGS,
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
   * @param {object} viewer
   * @param {Map<unknown, object>} registry
   * @param {ReturnType<typeof normalizeViewerConfig>} viewerConfig
   */
  function setupScaFocusCamera(viewer, registry, viewerConfig) {
    const events = viewer.global?.events
    if (!events) {
      return
    }

    const focusDuration = viewerConfig.interaction.focusTransition.duration

    const resolveHotspot = (annotation) => {
      if (registry.has(annotation)) {
        return registry.get(annotation)
      }

      const id = annotation?.extras?.id
      if (typeof id !== 'string') {
        return null
      }

      return window.SCA3D?.state?.project?.hotspots?.find((hotspot) => hotspot.id === id) ?? null
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

      const positionBefore = readCameraPosition(viewer)
      animateHotspotFocus(viewer, hotspot.position, focusDuration)

      window.SCA3D.state.selectedHotspotId = hotspot.id

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
   * @param {Map<unknown, object>} registry
   */
  function applyRuntimeUx(viewer, viewerConfig, registry) {
    setupScaFocusCamera(viewer, registry, viewerConfig)
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
    if (state.cameraMode !== defaultMode) {
      state.cameraMode = defaultMode
    }

    events?.on('cameraMode:changed', enforceMode)
  }

  /**
   * @param {object} viewer
   * @param {ReturnType<typeof normalizeViewerConfig>} viewerConfig
   */
  async function applyViewerConfig(viewer, viewerConfig) {
    applyNavigationRestrictions(viewer, viewerConfig)

    const { animation, initial } = viewerConfig.camera
    if (animation.type !== 'flyTo') {
      return
    }

    const waitForLoaded = () => new Promise((resolve) => {
      const { state, events } = viewer.global || {}
      if (state?.loaded) {
        resolve()
        return
      }

      events?.once('firstFrame', () => resolve())
    })

    await waitForLoaded()

    const startPose = computeFlyToStartPose(initial)
    await runFlyToAnimation(viewer, startPose, initial, animation.duration)
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
    const viewerConfig = normalizeViewerConfig(project, settingsJson)
    const annotations = Array.isArray(settingsJson?.annotations) ? settingsJson.annotations : []
    const registry = buildRegistry(annotations, project.hotspots)
    const settingsForViewer = applyScaNavigationSettings(settingsJson)
    const viewer = await main(canvas, settingsForViewer, config)

    window.SCA3D = window.SCA3D || {}
    window.SCA3D.state = window.SCA3D.state || {}
    window.SCA3D.state.project = project
    window.SCA3D.state.viewerConfig = viewerConfig
    window.SCA3D.state.registry = registry
    window.SCA3D.state.viewer = viewer

    applyRuntimeUx(viewer, viewerConfig, registry)

    if (typeof initHotspotBridge === 'function') {
      initHotspotBridge(viewer, { project, registry })
    } else {
      console.warn('[SCA3D] hotspot bridge not available')
    }

    applyViewerConfig(viewer, viewerConfig).catch((error) => {
      console.warn('[SCA3D] viewer config application failed:', error)
    })

    return viewer
  }

  window.SCA3D = window.SCA3D || {}
  window.SCA3D.loadProject = loadProject
  window.SCA3D.bootstrapViewer = bootstrapViewer
  window.SCA3D.normalizeViewerConfig = normalizeViewerConfig
  window.SCA3D.resetView = runHomeTransition
  window.SCA3D.cancelCameraTransition = cancelCameraTransition
  window.SCA3D.interruptCameraTransitions = interruptCameraTransitions
})()
