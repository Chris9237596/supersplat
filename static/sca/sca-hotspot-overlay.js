/**
 * SCA editor-style HTML hotspot overlay for exported SuperSplat Viewer runtimes.
 */
;(function () {
  const TOOLTIP_MARGIN = 8
  const TOOLTIP_ARROW_OFFSET = 25

  /**
   * Hide native Viewer WebGL annotation meshes and DOM markers beneath the SCA overlay.
   * @param {object} viewer
   */
  function disableNativeAnnotationRendering(viewer) {
    const app = viewer?.global?.app
    const root = app?.root
    if (!root) {
      return
    }

    const visit = (entity) => {
      const script = entity?.script?.annotation
      if (script) {
        entity.enabled = false
        if (script.hotspotDom) {
          script.hotspotDom.style.display = 'none'
          script.hotspotDom.style.pointerEvents = 'none'
        }
      }

      const children = entity.children || []
      for (let i = 0; i < children.length; i++) {
        visit(children[i])
      }
    }

    visit(root)

    const nativeRoot = document.getElementById('annotations')
    if (nativeRoot) {
      nativeRoot.style.display = 'none'
    }

    document.querySelectorAll('.pc-annotation-hotspot:not(.sca-hotspot-marker-badge)').forEach((element) => {
      element.style.display = 'none'
      element.style.pointerEvents = 'none'
    })

    document.querySelectorAll('.pc-annotation:not(.sca-hotspot-marker-card)').forEach((element) => {
      element.style.display = 'none'
      element.style.pointerEvents = 'none'
    })
  }

  /**
   * @param {object} viewer
   */
  function findViewerCamera(viewer) {
    const app = viewer?.global?.app
    if (!app?.root?.findByName) {
      return null
    }
    return app.root.findByName('camera')?.camera ?? null
  }

  /**
   * @param {HTMLElement} overlay
   * @param {(hotspot: object) => void} onSelect
   */
  function createMarkerView(overlay, onSelect) {
    const anchor = document.createElement('div')
    anchor.className = 'sca-hotspot-marker-anchor'

    const badge = document.createElement('div')
    badge.className = 'pc-annotation-hotspot sca-hotspot-marker-badge'
    badge.setAttribute('role', 'button')

    const titleEl = document.createElement('div')
    titleEl.className = 'pc-annotation-title'

    const textEl = document.createElement('div')
    textEl.className = 'pc-annotation-text'

    const card = document.createElement('div')
    card.className = 'pc-annotation sca-hotspot-marker-card'
    card.append(titleEl, textEl)

    anchor.append(badge)
    overlay.append(anchor)
    overlay.append(card)

    badge.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })

    badge.addEventListener('pointerup', (event) => {
      event.stopPropagation()
      if (badge.dataset.hotspotId) {
        onSelect(badge.dataset.hotspotId)
      }
    })

    return {
      anchor,
      badge,
      card,
      titleEl,
      textEl,
      hotspotId: null,
      screenVisible: true,
      hotspotEnabled: true,
      selected: false,
      showCards: true,
      screenX: 0,
      screenY: 0,
    }
  }

  /**
   * @param {ReturnType<typeof createMarkerView>} view
   * @param {number} viewportWidth
   * @param {number} viewportHeight
   */
  function layoutCard(view, viewportWidth, viewportHeight) {
    if (!view.selected || !view.screenVisible || !view.hotspotEnabled || !view.showCards) {
      view.card.classList.add('is-hidden')
      return
    }

    view.card.classList.remove('is-hidden')

    const tooltipWidth = view.card.offsetWidth
    const tooltipHeight = view.card.offsetHeight

    let left = view.screenX + TOOLTIP_ARROW_OFFSET
    let top = view.screenY - tooltipHeight / 2
    let flipped = false

    if (left + tooltipWidth > viewportWidth - TOOLTIP_MARGIN) {
      left = view.screenX - TOOLTIP_ARROW_OFFSET - tooltipWidth
      flipped = true
    }

    left = Math.max(TOOLTIP_MARGIN, Math.min(left, viewportWidth - tooltipWidth - TOOLTIP_MARGIN))
    top = Math.max(TOOLTIP_MARGIN, Math.min(top, viewportHeight - tooltipHeight - TOOLTIP_MARGIN))

    const arrowY = Math.max(16, Math.min(view.screenY - top, tooltipHeight - 16))
    view.card.style.setProperty('--arrow-top', `${arrowY}px`)
    view.card.classList.toggle('arrow-right', !flipped)
    view.card.classList.toggle('arrow-left', flipped)
    view.card.style.transform = 'none'
    view.card.style.left = `${Math.round(left)}px`
    view.card.style.top = `${Math.round(top)}px`
  }

  /**
   * @param {ReturnType<typeof createMarkerView>} view
   */
  function applyVisibility(view) {
    const show = view.screenVisible && view.hotspotEnabled
    view.anchor.classList.toggle('is-hidden', !show)
    if (!show || !view.selected || !view.showCards) {
      view.card.classList.add('is-hidden')
    }
  }

  /**
   * @param {object} viewer
   * @param {object} project
   * @param {{ interaction?: { focusTransition?: { duration?: number } }, hotspots?: { showCards?: boolean } }} viewerConfig
   */
  function initScaHotspotOverlay(viewer, project, viewerConfig) {
    const hotspots = Array.isArray(project?.hotspots) ? project.hotspots : []
    const exportable = hotspots.filter((hotspot) => {
      if (!hotspot?.enabled) {
        return false
      }
      if (hotspot.visual?.visible === false) {
        return false
      }
      return (hotspot.visual?.type ?? 'annotation') === 'annotation'
    })

    const nativeRoot = document.getElementById('annotations')
    if (nativeRoot) {
      nativeRoot.style.display = 'none'
    }

    disableNativeAnnotationRendering(viewer)

    let overlay = document.getElementById('sca-hotspot-markers-overlay')
    if (!overlay) {
      overlay = document.createElement('div')
      overlay.id = 'sca-hotspot-markers-overlay'
      overlay.className = 'sca-hotspot-markers-overlay'
      document.body.appendChild(overlay)
    }

    const showCards = viewerConfig?.hotspots?.showCards !== false
    let selectedId = window.SCA3D?.state?.selectedHotspotId ?? null

    /** @type {Map<string, ReturnType<typeof createMarkerView>>} */
    const views = new Map()

    const syncMarkers = () => {
      const ids = new Set(exportable.map((hotspot) => hotspot.id))
      for (const [id, view] of views) {
        if (!ids.has(id)) {
          view.anchor.remove()
          view.card.remove()
          views.delete(id)
        }
      }

      exportable.forEach((hotspot, index) => {
        let view = views.get(hotspot.id)
        if (!view) {
          view = createMarkerView(overlay, (hotspotId) => {
            const entry = exportable.find((item) => item.id === hotspotId)
            if (!entry) {
              return
            }

            window.SCA3D.activateHotspot?.(entry)
            window.SCA3D.handleHotspotClick?.(entry)
          })
          views.set(hotspot.id, view)
        }

        view.hotspotId = hotspot.id
        view.hotspotEnabled = hotspot.enabled
        view.selected = hotspot.id === selectedId
        view.showCards = showCards
        view.badge.dataset.hotspotId = hotspot.id
        view.badge.textContent = String(index + 1)
        view.badge.setAttribute('aria-label', `Select hotspot ${index + 1}: ${hotspot.name || 'Untitled'}`)
        view.titleEl.textContent = hotspot.name || 'Untitled'
        view.textEl.textContent = hotspot.text || ''
        view.badge.classList.toggle('is-selected', view.selected)
        applyVisibility(view)
      })
    }

    const syncSelection = () => {
      exportable.forEach((hotspot, index) => {
        const view = views.get(hotspot.id)
        if (!view) {
          return
        }
        view.selected = hotspot.id === selectedId
        view.showCards = showCards
        view.badge.classList.toggle('is-selected', view.selected)
        applyVisibility(view)
        layoutCard(view, overlay.clientWidth, overlay.clientHeight)
      })
    }

    const updateScreenPositions = () => {
      const camera = findViewerCamera(viewer)
      if (!camera || views.size === 0) {
        return
      }

      const canvas = document.getElementById('application-canvas')
      const width = canvas?.clientWidth ?? overlay.clientWidth
      const height = canvas?.clientHeight ?? overlay.clientHeight
      if (width <= 0 || height <= 0) {
        return
      }

      const cameraEntity = camera.entity
      const cameraPos = cameraEntity.getPosition()
      const cameraFwd = cameraEntity.forward

      for (const hotspot of exportable) {
        const view = views.get(hotspot.id)
        if (!view || !hotspot.enabled) {
          continue
        }

        const [wx, wy, wz] = hotspot.position
        const dx = wx - cameraPos.x
        const dy = wy - cameraPos.y
        const dz = wz - cameraPos.z
        const dot = dx * cameraFwd.x + dy * cameraFwd.y + dz * cameraFwd.z

        if (dot <= 0) {
          view.screenVisible = false
          applyVisibility(view)
          continue
        }

        const world = cameraPos.clone()
        world.set(wx, wy, wz)
        const screenPos = camera.worldToScreen(world)
        view.screenX = Math.round(screenPos.x)
        view.screenY = Math.round(screenPos.y)
        view.screenVisible = true
        view.anchor.style.transform = `translate(${view.screenX}px, ${view.screenY}px)`
        applyVisibility(view)
        layoutCard(view, width, height)
      }
    }

    syncMarkers()
    syncSelection()

    const app = viewer?.global?.app
    if (app) {
      app.on('prerender', updateScreenPositions)
      disableNativeAnnotationRendering(viewer)
    } else {
      viewer?.global?.events?.on('firstFrame', () => {
        viewer.global?.app?.on('prerender', updateScreenPositions)
        disableNativeAnnotationRendering(viewer)
        updateScreenPositions()
      })
    }

    window.SCA3D = window.SCA3D || {}
    window.SCA3D.hotspotOverlay = {
      setSelected(id) {
        selectedId = id ?? null
        window.SCA3D.state.selectedHotspotId = id ?? null
        syncSelection()
      },
      refresh() {
        syncMarkers()
        syncSelection()
        updateScreenPositions()
      },
    }

    console.log(`[SCA3D] hotspot overlay ready (${exportable.length} marker(s))`)
  }

  window.initScaHotspotOverlay = initScaHotspotOverlay
})()
