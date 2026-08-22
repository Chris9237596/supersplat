/**

 * Runtime Region picking, hover/active tint, and interaction.

 *

 * Region masks are in runtime SOG gaussian index space (remapped at export).

 * Overlap policy: first enabled Region in project.regions array order wins.

 */

;(function () {

  const HOVER_THROTTLE_MS = 250



  function isRegionClickable(region) {

    const fn = window.SCA3D?.isClickableRegion

    if (typeof fn === 'function') {

      return fn(region)

    }

    return region?.enabled !== false && region?.interaction?.clickable !== false

  }



  function computeRegionAnchor3D(bitset, viewer) {

    const centers = window.SCA3D?.state?.runtimeCenters

    const gaussianCount = window.SCA3D?.state?.runtimeGaussianCount ?? 0

    const compute = window.SCA3D?.computeRegionAnchorFromBitset

    const createAccessor = window.SCA3D?.createCentersAccessorFromFloat32

    if (!centers || !gaussianCount || typeof compute !== 'function' || typeof createAccessor !== 'function') {

      return null

    }

    const accessor = createAccessor(centers, gaussianCount)

    const transformWorld = createRuntimeWorldTransform(viewer)

    return compute(bitset, accessor, transformWorld ?? undefined)

  }



  function createRuntimeWorldTransform(viewer) {

    const comp = viewer?.global?.app?.root?.findComponents?.('gsplat')?.[0]

    const entity = comp?.entity

    if (!entity?.getWorldTransform) {

      return null

    }

    const mat = entity.getWorldTransform().data

    if (!mat || mat.length < 16) {

      return null

    }

    return (x, y, z) => {

      const wx = mat[0] * x + mat[4] * y + mat[8] * z + mat[12]

      const wy = mat[1] * x + mat[5] * y + mat[9] * z + mat[13]

      const wz = mat[2] * x + mat[6] * y + mat[10] * z + mat[14]

      return [wx, wy, wz]

    }

  }



  function countBitsetMembers(bitset) {

    if (!bitset) {

      return 0

    }

    let count = 0

    for (let i = 0; i < bitset.length; i++) {

      if (bitset[i]) {

        count++

      }

    }

    return count

  }



  function describeMaskRepresentation(bitset) {

    if (!bitset) {

      return 'null'

    }

    const typeName = bitset.constructor?.name ?? 'unknown'

    if (bitset instanceof Uint8Array) {

      return `Uint8Array dense length=${bitset.length}`

    }

    if (bitset instanceof Uint32Array) {

      return `Uint32Array compressed length=${bitset.length} words`

    }

    return `${typeName} length=${bitset.length}`

  }



  function scanBitsetIndexRange(bitset) {

    let minIndex = -1

    let maxIndex = -1

    /** @type {number[]} */
    const samples = []

    if (!bitset) {

      return { minIndex, maxIndex, samples }

    }

    for (let i = 0; i < bitset.length; i++) {

      if (bitset[i]) {

        if (minIndex < 0) {

          minIndex = i

        }

        maxIndex = i

        if (samples.length < 5) {

          samples.push(i)

        }

      }

    }

    return { minIndex, maxIndex, samples }

  }



  function rgbaToHex(tint) {

    if (!tint) {

      return 'none'

    }

    const channel = (value) => Math.round(Math.max(0, Math.min(1, value)) * 255)

      .toString(16)

      .padStart(2, '0')

    return `#${channel(tint.r)}${channel(tint.g)}${channel(tint.b)}`

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



  function cacheRuntimeCenters(viewer) {

    const comp = viewer?.global?.app?.root?.findComponents?.('gsplat')?.[0]

    const resource = comp?.resource ?? comp?.instance?.resource

    return resource?.centers ?? null

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

          const members = countBitsetMembers(bitset)

          const { minIndex, maxIndex, samples } = scanBitsetIndexRange(bitset)

          const result = viewer.setScaRegionHighlight?.(

            bitset,

            [color.r, color.g, color.b, color.a],

            active

          ) ?? { nonZeroMask: 0, enabled: false, uploaded: false, bufferSize: 0, gaussianCount: 0 }

          return {

            members,

            minIndex,

            maxIndex,

            samples,

            maskRepresentation: describeMaskRepresentation(bitset),

            sourceBytes: bitset?.byteLength ?? 0,

            ...result,

          }

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

    let lastPointerOffsetX = 0

    let lastPointerOffsetY = 0

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
            activeRegionId = null
            hoverRegionId = null
            updateHoverCursor(null)
            logRegionTransition('cleared')
            syncRegionPresentation('deselect')
            return
          }

          const entry = ctx.lookup.entries.find((item) => item.regionId === regionId)
          if (!entry || !isRegionClickable(entry.region)) {
            return
          }

          activeRegionId = regionId
          window.SCA3D.hotspotOverlay?.setSelected?.(null)
          logRegionTransition('clicked', regionId)
          window.SCA3D.activateRegion?.(entry.region)
          window.SCA3D.handleRegionClick?.(entry.region)
          syncRegionPresentation('click')
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



    const applyResolvedRegionVisual = (regionEntry, visualState) => {

      if (!ctx.highlight) {

        return null

      }

      if (!regionEntry) {

        ctx.highlight.clear()

        return null

      }

      const resolve = window.SCA3D?.resolveRegionVisual

      const visual = typeof resolve === 'function' ?

        resolve(regionEntry.region, visualState) :

        null

      if (!visual) {

        ctx.highlight.clear()

        return null

      }

      ctx.highlight.setMaskFromBitset(regionEntry.bitset, visual.tint, true)

      return visual

    }



    let lastVisualDiag = ''

    let lastHighlightDiag = ''

    let lastAnchorDiag = ''

    const syncRegionPresentation = (source) => {

      const buildState = window.SCA3D?.buildRegionPresentationState

      const getActive = window.SCA3D?.getActivePresentationEntry

      const getHover = window.SCA3D?.getHoverPresentationEntry

      const buildCard = window.SCA3D?.buildRegionCardModel

      if (typeof buildState !== 'function' || typeof getActive !== 'function' || typeof getHover !== 'function') {

        return

      }



      const regions = ctx.lookup.entries.map((entry) => entry.region)

      const anchorByRegionId = new Map()

      for (const entry of ctx.lookup.entries) {

        anchorByRegionId.set(entry.regionId, computeRegionAnchor3D(entry.bitset, viewer))

      }



      const presentationState = buildState(regions, hoverRegionId, activeRegionId, anchorByRegionId)

      window.SCA3D.state = window.SCA3D.state || {}

      window.SCA3D.state.regionPresentation = presentationState

      window.SCA3D.state.hoverRegionId = hoverRegionId

      window.SCA3D.state.selectedRegionId = activeRegionId



      const activeEntry = getActive(presentationState)

      const hoverEntry = getHover(presentationState)



      if (ctx.highlight) {

        const visualEntry = activeEntry?.tint ? activeEntry : hoverEntry

        const visualState = activeEntry?.tint ? 'selected' : (hoverEntry?.tint ? 'hover' : 'normal')

        const visualKey = `${visualEntry?.regionId ?? 'none'}:${visualState}:${visualEntry?.tint?.a ?? ''}`

        let highlightStats = null

        if (activeEntry?.tint) {

          const entry = ctx.lookup.entries.find((item) => item.regionId === activeEntry.regionId)

          if (entry) {

            highlightStats = ctx.highlight.setMaskFromBitset(entry.bitset, activeEntry.tint, true)

          }

        } else if (hoverEntry?.tint) {

          const entry = ctx.lookup.entries.find((item) => item.regionId === hoverEntry.regionId)

          if (entry) {

            highlightStats = ctx.highlight.setMaskFromBitset(entry.bitset, hoverEntry.tint, true)

          }

        } else {

          ctx.highlight.clear()

        }

        const highlightKey = `${visualEntry?.regionId ?? 'none'}:${visualState}:${highlightStats?.nonZeroMask ?? 0}`

        if (highlightKey !== lastHighlightDiag && visualEntry?.regionId && visualEntry?.tint && highlightStats) {

          lastHighlightDiag = highlightKey

          console.log([

            '[SCA REGION HIGHLIGHT]',

            `regionId=${visualEntry.regionId}`,

            `members=${highlightStats.members}`,

            `gaussianCount=${highlightStats.gaussianCount ?? ctx.lookup.gaussianCount}`,

            `maskRepresentation=${highlightStats.maskRepresentation}`,

            `sourceBytes=${highlightStats.sourceBytes}`,

            `nonZeroMask=${highlightStats.nonZeroMask}`,

            `bufferSize=${highlightStats.bufferSize ?? 0}`,

            `minIndex=${highlightStats.minIndex}`,

            `maxIndex=${highlightStats.maxIndex}`,

            `enabled=${highlightStats.enabled}`,

            `tint=${rgbaToHex(visualEntry.tint)}`,

            `opacity=${visualEntry.tint.a}`,

            `sampleIndices=${highlightStats.samples.join(',')}`,

          ].join('\n'))

        } else if (visualState === 'normal' && lastHighlightDiag !== 'normal') {

          lastHighlightDiag = 'normal'

        }

        if (visualKey !== lastVisualDiag && visualEntry?.regionId && visualEntry?.tint) {

          lastVisualDiag = visualKey

          console.log([

            '[SCA REGION VISUAL]',

            `regionId=${visualEntry.regionId}`,

            `state=${visualState}`,

            `tint=${rgbaToHex(visualEntry.tint)}`,

            `opacity=${visualEntry.tint.a}`,

          ].join('\n'))

        } else if (visualState === 'normal' && lastVisualDiag !== 'normal') {

          lastVisualDiag = 'normal'

        }

      }



      if (activeEntry?.regionId) {

        const entry = ctx.lookup.entries.find((item) => item.regionId === activeEntry.regionId)

        const anchor3D = activeEntry.anchor3D

        const anchorKey = `${activeEntry.regionId}:${anchor3D ?

          `${anchor3D.x.toFixed(3)},${anchor3D.y.toFixed(3)},${anchor3D.z.toFixed(3)}` :

          'null'}`

        if (anchorKey !== lastAnchorDiag) {

          lastAnchorDiag = anchorKey

          console.log([

            '[SCA REGION ANCHOR]',

            `regionId=${activeEntry.regionId}`,

            `members=${entry ? countBitsetMembers(entry.bitset) : 0}`,

            anchor3D ?

              `anchor3D={x:${anchor3D.x.toFixed(3)},y:${anchor3D.y.toFixed(3)},z:${anchor3D.z.toFixed(3)}}` :

              'anchor3D=null',

          ].join('\n'))

        }

      } else if (lastAnchorDiag !== 'none') {

        lastAnchorDiag = 'none'

      }



      const cardModel = typeof buildCard === 'function' ? buildCard(activeEntry) : null

      window.SCA3D.regionOverlay?.applyPresentation?.(cardModel)



      if (activeEntry?.regionId) {

        const suffix = source ? ` (${source})` : ''

        console.log(`[SCA REGION CARD] show ${activeEntry.regionId}${suffix}`)

      } else if (source === 'deselect' && activeRegionId === null) {

        console.log('[SCA REGION CARD] hide')

      }

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

      if (regionEntry && isRegionClickable(regionEntry.region)) {

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



      syncRegionPresentation()

    }



    canvas.addEventListener('pointerdown', (event) => {

      if (isUiTarget(event.target)) {

        return

      }



      pointerDown = true

      dragStarted = false

      downX = event.clientX

      downY = event.clientY

      lastPointerOffsetX = event.offsetX

      lastPointerOffsetY = event.offsetY

    })



    const markNativeClickSuppressed = (pointerId, offsetX, offsetY, regionId) => {

      window.SCA3D.state = window.SCA3D.state || {}

      window.SCA3D.state.pointerConsumptions = window.SCA3D.state.pointerConsumptions || {}

      window.SCA3D.state.pointerConsumptions[pointerId] = {

        offsetX,

        offsetY,

        regionId,

        at: performance.now(),

        suppress: true,

      }

      window.SCA3D.state.nativeClickSuppression = {

        offsetX,

        offsetY,

        regionId,

        pointerId,

        at: performance.now(),

      }

    }



    const trySuppressNativeClickSync = (event) => {

      if (isUiTarget(event.target) || event.button !== 0 || dragStarted) {

        return

      }



      const picker = window.SCA3D?.runtimePicker

      if (!picker || typeof picker.pickSyncDetailed !== 'function') {

        console.log('[SCA CLICK FLOW]', 'capture-pointerup', 'suppressionSet=false', 'reason=picker-unavailable')

        return

      }



      const width = canvas.clientWidth

      const height = canvas.clientHeight

      if (width <= 0 || height <= 0) {

        return

      }



      const offsetX = lastPointerOffsetX

      const offsetY = lastPointerOffsetY

      const pick = picker.pickSyncDetailed(offsetX / width, offsetY / height)

      const gaussianIndex = pick?.gaussianIndex ?? null

      if (gaussianIndex === null) {

        console.log('[SCA CLICK FLOW]', 'capture-pointerup', 'suppressionSet=false', 'reason=no-gaussian-hit')

        return

      }



      let regionId = null

      if (regionCore) {

        const hit = regionCore.resolveClickableRegionHit(

          gaussianIndex,

          pick?.scaSplatId ?? defaultScaSplatId

        )

        if (hit) {

          const entry = ctx.lookup.entries.find((item) => item.regionId === hit.regionId)

          if (entry && isRegionClickable(entry.region)) {

            regionId = hit.regionId

          }

        }

      } else {

        const regionEntry = window.SCA3D.regionMask.resolveRegionAtGaussian(ctx.lookup, gaussianIndex)

        if (regionEntry && isRegionClickable(regionEntry.region)) {

          regionId = regionEntry.regionId

        }

      }



      if (!regionId) {

        console.log('[SCA CLICK FLOW]', 'capture-pointerup', 'suppressionSet=false', 'reason=no-region-hit')

        return

      }



      markNativeClickSuppressed(event.pointerId, offsetX, offsetY, regionId)

      console.log([

        '[SCA CLICK FLOW]',

        'capture-pointerup',

        `regionId=${regionId}`,

        'suppressionSet=true',

        `offset={x:${offsetX},y:${offsetY}}`,

      ].join('\n'))

    }



    canvas.addEventListener('pointerup', trySuppressNativeClickSync, true)



    canvas.addEventListener('pointermove', (event) => {

      if (!pointerDown) {

        if (isUiTarget(event.target)) {

          if (hoverRegionId !== null) {

            hoverRegionId = null

            window.SCA3D.state.hoverRegionId = null

            syncRegionPresentation()

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

      window.SCA3D.state.hoverRegionId = null

      cursor.set('navigation')

      syncRegionPresentation()

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
        if (regionEntry?.regionId && isRegionClickable(regionEntry.region)) {
          window.SCA3D.state = window.SCA3D.state || {}
          window.SCA3D.state.regionClickConsumed = true
          regionCore.activateRegion(regionEntry.regionId, 'click')
        }
        return
      }

      if (!regionEntry) {
        activeRegionId = null
        hoverRegionId = null
        updateHoverCursor(null)
        syncRegionPresentation('deselect')
        return
      }

      if (!isRegionClickable(regionEntry.region)) {
        return
      }

      activeRegionId = regionEntry.regionId
      hoverRegionId = regionEntry.regionId
      window.SCA3D.activateRegion?.(regionEntry.region)
      window.SCA3D.handleRegionClick?.(regionEntry.region)
      syncRegionPresentation('click')

    })



    if (activeRegionId) {

      syncRegionPresentation()

    }



    window.SCA3D.selectRegion = (regionId, source = 'navigation') => {

      if (regionCore) {

        regionCore.activateRegion(regionId, source)

        return

      }

      if (!regionId) {

        activeRegionId = null

        hoverRegionId = null

        syncRegionPresentation('deselect')

        return

      }

      const entry = ctx.lookup.entries.find((item) => item.regionId === regionId)

      if (!entry || !isRegionClickable(entry.region)) {

        return

      }

      activeRegionId = regionId

      window.SCA3D.hotspotOverlay?.setSelected?.(null)

      window.SCA3D.activateRegion?.(entry.region)

      window.SCA3D.handleRegionClick?.(entry.region)

      syncRegionPresentation(source)

    }



    window.SCA3D.shouldSuppressViewerClickFocus = (offsetX, offsetY) => {

      const consumptions = window.SCA3D?.state?.pointerConsumptions

      if (!consumptions) {

        return false

      }

      const now = performance.now()

      for (const entry of Object.values(consumptions)) {

        if (!entry?.suppress || now - entry.at > 750) {

          continue

        }

        if (offsetX === undefined || offsetY === undefined) {

          return true

        }

        const dx = offsetX - entry.offsetX

        const dy = offsetY - entry.offsetY

        if ((dx * dx + dy * dy) <= 256) {

          return true

        }

      }

      return false

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

    window.SCA3D.state.runtimeCenters = cacheRuntimeCenters(viewer)

    window.SCA3D.state.runtimeGaussianCount = gaussianCount



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


