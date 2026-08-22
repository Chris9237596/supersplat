/**

 * Runtime Region picking, hover/active tint, and interaction.

 *

 * Region masks are in runtime SOG gaussian index space (remapped at export).

 * Overlap policy: first enabled Region in project.regions array order wins.

 */

;(function () {

  const HOVER_THROTTLE_MS = 250



  function parseHexColor(hex) {

    const normalized = typeof hex === 'string' ? hex.trim().toLowerCase() : ''

    if (!/^#[0-9a-f]{6}$/.test(normalized)) {

      return { r: 1, g: 0.4, b: 0, a: 0.5 }

    }



    return {

      r: parseInt(normalized.slice(1, 3), 16) / 255,

      g: parseInt(normalized.slice(3, 5), 16) / 255,

      b: parseInt(normalized.slice(5, 7), 16) / 255,

      a: 0.5,

    }

  }



  function isClickableRegion(region) {

    return region?.enabled !== false && region?.interaction?.clickable !== false

  }



  function logRegionTransition(kind, regionId) {

    const key = `${kind}:${regionId ?? 'none'}`

    const state = window.SCA3D?.state?._regionDiag ?? {}

    if (state[key]) {

      return

    }

    state[key] = true

    window.SCA3D.state._regionDiag = state

    if (regionId) {

      console.log(`[SCA REGION] ${kind} ${regionId}`)

    } else {

      console.log(`[SCA REGION] ${kind}`)

    }

  }



  function ensureCursorManager(canvas) {

    window.SCA3D = window.SCA3D || {}

    if (window.SCA3D.cursor?.set) {

      return window.SCA3D.cursor

    }



    let mode = 'navigation'

    let detail = null



    const apply = () => {

      if (!canvas) {

        return

      }

      if (mode === 'pointer') {

        canvas.style.cursor = 'pointer'

      } else {

        canvas.style.removeProperty('cursor')

      }

    }



    const set = (nextMode, nextDetail = null) => {

      const nextKey = `${nextMode}:${nextDetail ?? ''}`

      const prevKey = `${mode}:${detail ?? ''}`

      if (nextKey === prevKey) {

        return

      }

      mode = nextMode

      detail = nextDetail

      if (nextMode === 'pointer' && nextDetail) {

        console.log(`[SCA CURSOR] ${nextDetail}`)

      } else if (nextMode === 'navigation') {

        console.log('[SCA CURSOR] navigation')

      }

      apply()

    }



    window.SCA3D.cursor = { set, apply }

    return window.SCA3D.cursor

  }



  async function loadMaskBytes(url) {
    const embedded = window.__SCA3D_EMBEDDED_ASSETS__
    const normalized = url.replace(/^\.\//, '')

    if (embedded) {
      const dataUrl = embedded[url] ?? embedded[normalized]
      if (dataUrl) {
        const response = await fetch(dataUrl)
        return new Uint8Array(await response.arrayBuffer())
      }
    }

    const response = await fetch(url.startsWith('./') ? url : `./${normalized}`)

    if (!response.ok) {

      throw new Error(`[SCA3D] failed to load region mask: ${url} (${response.status})`)

    }



    return new Uint8Array(await response.arrayBuffer())

  }



  function initRegionHighlight(viewer, gaussianCount) {

    const diag = {
      stage: 'start',
      gaussianCount,
      renderer: viewer?.global?.app?.graphicsDevice?.isWebGPU ? 'webgpu' : 'webgl',
    }

    try {

      if (typeof viewer.initScaRegionHighlight !== 'function') {

        console.warn('[SCA REGION] highlight unavailable: viewer hook missing', diag)

        return null

      }

      const app = viewer?.global?.app

      const components = app?.root?.findComponents?.('gsplat') ?? []

      diag.stage = 'resolve gsplat material'

      diag.gsplatComponents = components.length

      diag.unified = components[0]?.unified ?? null

      diag.sceneGsplatMaterial = !!app?.scene?.gsplat?.material

      diag.stage = 'call viewer.initScaRegionHighlight'

      const ok = viewer.initScaRegionHighlight(gaussianCount)

      if (!ok) {

        console.error('[SCA REGION] highlight init failed', diag)

        return null

      }



      console.log(`[SCA REGION] highlight ready (${gaussianCount} gaussians, renderer=${diag.renderer})`)



      return {

        setMaskFromBitset(bitset, color, active) {

          viewer.setScaRegionHighlight?.(

            bitset,

            [color.r, color.g, color.b, color.a],

            active

          )

        },

        clear() {

          viewer.clearScaRegionHighlight?.()

        },

      }

    } catch (error) {

      console.error('[SCA REGION] highlight init failed', error, diag)

      return null

    }

  }



  function setupRegionInteraction(viewer, ctx) {

    const canvas = document.getElementById('application-canvas')

    if (!canvas) {

      console.warn('[SCA REGION] interaction unavailable: canvas not found')

      return

    }

    if (canvas.dataset.scaRegionBound === '1') {
      return
    }
    canvas.dataset.scaRegionBound = '1'



    const cursor = ensureCursorManager(canvas)

    let hoverRegionId = null

    let activeRegionId = window.SCA3D?.state?.selectedRegionId ?? null

    let lastHoverPickAt = 0

    let pointerDown = false

    let dragStarted = false

    let downX = 0

    let downY = 0

    let hoverPickToken = 0

    let lastPickDiag = { key: '' }

    let lastClickCoords = null

    const defaultScaSplatId = window.SCA3D?.state?.defaultScaSplatId ?? 'splat_01'

    const createRuntimeRegionInteraction = window.SCA3D?.createRuntimeRegionInteraction

    const regionCore = typeof createRuntimeRegionInteraction === 'function' ?
      createRuntimeRegionInteraction(ctx.lookup, defaultScaSplatId, {
        getRegion: (regionId) =>
          ctx.lookup.entries.find((entry) => entry.regionId === regionId)?.region ?? null,
        getSelectedRegionId: () => activeRegionId,
        onHoverChange: () => {},
        onSelectionChange: (regionId) => {
          if (!regionId) {
            if (activeRegionId) {
              console.log(`[SCA REGION CARD] hide ${activeRegionId}`)
            }
            applyActiveVisual(null)
            hoverRegionId = null
            updateHoverCursor(null)
            applyHoverVisual(null)
            return
          }

          const entry = ctx.lookup.entries.find((item) => item.regionId === regionId)
          if (!entry || !isClickableRegion(entry.region)) {
            return
          }

          applyActiveVisual(entry, lastClickCoords)
          window.SCA3D.activateRegion?.(entry.region)
          window.SCA3D.handleRegionClick?.(entry.region)
        },
      }) :
      null



    const logRuntimePick = (backend, gaussianIndex, regionId) => {
      const key = `${backend}:${gaussianIndex ?? 'null'}:${regionId ?? 'null'}`
      if (lastPickDiag.key === key) {
        return
      }
      lastPickDiag = { key }
      console.log([
        '[SCA RUNTIME PICK]',
        `backend=${backend}`,
        gaussianIndex !== null && gaussianIndex !== undefined ?
          `gaussianIndex=${gaussianIndex}` :
          'gaussianIndex=null',
        regionId ? `regionId=${regionId}` : 'regionId=null',
      ].join('\n'))
    }

    const isHotspotTarget = (target) => {

      if (!(target instanceof Element)) {

        return false

      }



      return !!target.closest(

        '.sca-hotspot-marker-badge, .sca-hotspot-marker-card, #scaHomeView, #info, #settings, .controlButton, .buttonGroup, #annotations'

      )

    }



    const isUiTarget = (target) => {

      if (!(target instanceof Element)) {

        return false

      }



      if (isHotspotTarget(target)) {

        return true

      }



      return !!target.closest('#ui, #overlayUI, .pcui, button, a, input, textarea, select, label')

    }



    const clientToNormalized = (clientX, clientY) => {

      const rect = canvas.getBoundingClientRect()

      return {

        x: (clientX - rect.left) / rect.width,

        y: (clientY - rect.top) / rect.height,

        screenX: clientX,

        screenY: clientY,

      }

    }



    const applyHoverVisual = (regionEntry) => {

      if (!ctx.highlight) {

        return

      }



      if (!regionEntry) {

        if (activeRegionId) {

          const active = ctx.lookup.entries.find((entry) => entry.regionId === activeRegionId)

          if (active) {

            const visual = active.region.visual ?? {}

            const color = parseHexColor(visual.activeTint)

            color.a = visual.activeOpacity ?? 0.55

            ctx.highlight.setMaskFromBitset(active.bitset, color, true)

            return

          }

        }



        ctx.highlight.clear()

        return

      }



      const visual = regionEntry.region.visual ?? {}

      const color = parseHexColor(visual.hoverTint)

      color.a = visual.hoverOpacity ?? 0.35

      ctx.highlight.setMaskFromBitset(regionEntry.bitset, color, true)

    }



    const applyActiveVisual = (regionEntry, screenPoint) => {

      if (!regionEntry) {

        ctx.highlight?.clear()

        window.SCA3D.regionOverlay?.hide()

        window.SCA3D.state.selectedRegionId = null

        activeRegionId = null

        logRegionTransition('cleared')

        return

      }



      const visual = regionEntry.region.visual ?? {}

      const color = parseHexColor(visual.activeTint)

      color.a = visual.activeOpacity ?? 0.55

      ctx.highlight?.setMaskFromBitset(regionEntry.bitset, color, true)



      window.SCA3D.state.selectedRegionId = regionEntry.regionId

      activeRegionId = regionEntry.regionId

      window.SCA3D.regionOverlay?.setActiveRegion(regionEntry.regionId, screenPoint ?? null)

      logRegionTransition('clicked', regionEntry.regionId)

      console.log(`[SCA REGION CARD] show ${regionEntry.regionId}`)

    }



    const pickRegionAt = async (clientX, clientY) => {
      if (typeof viewer.pickGaussian !== 'function') {
        return null
      }

      const pick = await viewer.pickGaussian(clientX, clientY)
      const gaussianIndex = pick?.gaussianIndex ?? null
      const backend = window.SCA3D?.runtimePicker?.backendId ?? 'webgpu'
      const coords = clientToNormalized(clientX, clientY)

      let regionEntry = null
      if (regionCore && gaussianIndex !== null) {
        const hit = regionCore.resolveClickableRegionHit(
          gaussianIndex,
          pick?.scaSplatId ?? defaultScaSplatId
        )
        if (hit) {
          regionEntry = ctx.lookup.entries.find((entry) => entry.regionId === hit.regionId) ?? null
        }
      } else if (gaussianIndex !== null) {
        regionEntry = window.SCA3D.regionMask.resolveRegionAtGaussian(ctx.lookup, gaussianIndex)
      }

      logRuntimePick(backend, gaussianIndex, regionEntry?.regionId ?? null)
      return { regionEntry, pick, coords }
    }



    const updateHoverCursor = (regionEntry) => {

      if (regionEntry && isClickableRegion(regionEntry.region)) {

        cursor.set('pointer', `region ${regionEntry.regionId}`)

      } else if (!isHotspotTarget(document.elementFromPoint(downX, downY))) {

        cursor.set('navigation')

      }

    }



    const updateHover = async (clientX, clientY) => {

      const now = Date.now()

      if (now - lastHoverPickAt < HOVER_THROTTLE_MS) {

        return

      }

      lastHoverPickAt = now



      const token = ++hoverPickToken

      const result = await pickRegionAt(clientX, clientY)

      if (token !== hoverPickToken) {

        return

      }



      // hover pick logged in pickRegionAt



      const regionEntry = result?.regionEntry ?? null

      const nextId = regionEntry?.regionId ?? null



      updateHoverCursor(regionEntry)



      if (nextId === hoverRegionId) {

        return

      }



      hoverRegionId = nextId

      window.SCA3D.state = window.SCA3D.state || {}
      window.SCA3D.state.hoverRegionId = nextId



      if (nextId) {

        logRegionTransition('hovered', nextId)

      } else if (!activeRegionId) {

        logRegionTransition('hover cleared')

      }



      if (activeRegionId && nextId === activeRegionId) {

        return

      }



      if (activeRegionId) {

        return

      }



      applyHoverVisual(regionEntry)

    }



    canvas.addEventListener('pointerdown', (event) => {

      if (isUiTarget(event.target)) {

        return

      }



      pointerDown = true

      dragStarted = false

      downX = event.clientX

      downY = event.clientY

    })



    canvas.addEventListener('pointermove', (event) => {

      if (!pointerDown) {

        if (isUiTarget(event.target)) {

          if (hoverRegionId !== null) {

            hoverRegionId = null

            if (!activeRegionId) {

              applyHoverVisual(null)

            }

          }

          cursor.set('navigation')

          return

        }



        void updateHover(event.clientX, event.clientY)

        return

      }



      const dx = event.clientX - downX

      const dy = event.clientY - downY

      if ((dx * dx + dy * dy) > 36) {

        dragStarted = true

        cursor.set('navigation')

      }

    })



    canvas.addEventListener('pointerleave', () => {

      hoverPickToken++

      hoverRegionId = null

      cursor.set('navigation')

      if (!activeRegionId) {

        applyHoverVisual(null)

      }

    })



    canvas.addEventListener('pointerup', async (event) => {

      if (isUiTarget(event.target)) {

        pointerDown = false

        return

      }



      const wasDrag = dragStarted

      pointerDown = false

      dragStarted = false



      if (wasDrag || event.button !== 0) {

        return

      }



      window.SCA3D.interruptCameraTransitions?.(viewer)



      const { regionEntry, coords } = await pickRegionAt(event.clientX, event.clientY)

      lastClickCoords = {
        x: coords.screenX,
        y: coords.screenY,
      }

      if (regionCore) {
        regionCore.activateRegion(regionEntry?.regionId ?? null, 'click')
        return
      }

      if (!regionEntry) {
        if (activeRegionId) {
          console.log(`[SCA REGION CARD] hide ${activeRegionId}`)
        }
        applyActiveVisual(null)
        hoverRegionId = null
        updateHoverCursor(null)
        applyHoverVisual(null)
        return
      }

      if (!isClickableRegion(regionEntry.region)) {
        return
      }

      hoverRegionId = regionEntry.regionId
      applyActiveVisual(regionEntry, lastClickCoords)
      window.SCA3D.activateRegion?.(regionEntry.region)
      window.SCA3D.handleRegionClick?.(regionEntry.region)

    })



    if (activeRegionId) {

      const active = ctx.lookup.entries.find((entry) => entry.regionId === activeRegionId)

      if (active) {

        applyActiveVisual(active, null)

      }

    }

  }



  async function initScaRegionRuntime(viewer, runtime = {}) {

    const project = runtime.project ?? window.SCA3D?.state?.project

    const regions = Array.isArray(project?.regions) ?

      project.regions.filter((region) => region?.enabled) :

      []



    if (regions.length === 0) {
      console.log('[SCA REGION] runtime skipped: no enabled regions')
      return
    }

    if (typeof viewer.pickGaussian !== 'function') {
      console.warn('[SCA REGION] picker unavailable')
      return
    }

    const renderer = viewer?.global?.app?.graphicsDevice?.isWebGPU ? 'webgpu' : 'webgl'
    console.log(`[SCA REGION] picker ready (${renderer})`)



    const maskBytesByRegionId = new Map()



    await Promise.all(regions.map(async (region) => {

      const maskPath = region.source?.maskAsset?.startsWith('sca/') ?

        region.source.maskAsset.replace(/^sca\//, '') :

        (region.source?.maskAsset ?? `regions/${region.id}.mask`)



      try {

        const bytes = await loadMaskBytes(`./${maskPath}`)

        maskBytesByRegionId.set(region.id, bytes)

      } catch (error) {

        console.warn(`[SCA REGION] failed to load mask for ${region.id}:`, error)

      }

    }))



    const lookup = window.SCA3D.regionMask.buildRegionLookup(regions, maskBytesByRegionId)



    let gaussianCount = lookup.gaussianCount

    if (gaussianCount <= 0) {

      const gsplatComponents = viewer?.global?.app?.root?.findComponents?.('gsplat') ?? []

      gaussianCount = gsplatComponents[0]?.instance?.splatData?.numSplats ?? 0

      lookup.gaussianCount = gaussianCount

    }



    const initHighlightFn = viewer.initScaRegionHighlight
    const highlight = gaussianCount > 0 && initHighlightFn ?
      initRegionHighlight(viewer, gaussianCount) :
      null



    window.SCA3D.state.regionLookup = lookup



    if (lookup.entries[0]?.memberCount > 0) {

      const sampleEntry = lookup.entries[0]

      let sampleIndex = -1

      for (let i = 0; i < sampleEntry.bitset.length; i++) {

        if (sampleEntry.bitset[i]) {

          sampleIndex = i

          break

        }

      }

      window.SCA3D.state.regionPickSample = {

        regionId: sampleEntry.regionId,

        runtimeIndex: sampleIndex,

      }

    }



    setupRegionInteraction(viewer, { lookup, highlight })

    window.SCA3D.state.regionRuntimeReady = true

    console.log(`[SCA REGION] runtime ready (${regions.length} enabled region(s))`)

  }



  window.initScaRegionRuntime = initScaRegionRuntime

})()


