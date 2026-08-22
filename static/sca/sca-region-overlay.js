/**

 * Region info card overlay — reuses Hotspot card CSS (no numbered marker).

 */

;(function () {

  const TOOLTIP_MARGIN = 8

  const TOOLTIP_ARROW_OFFSET = 25



  /**

   * @param {HTMLElement} overlay

   */

  function createRegionCardView(overlay) {

    const titleEl = document.createElement('div')

    titleEl.className = 'pc-annotation-title'



    const textEl = document.createElement('div')

    textEl.className = 'pc-annotation-text'



    const card = document.createElement('div')

    card.className = 'pc-annotation sca-hotspot-marker-card sca-region-card'

    card.append(titleEl, textEl)

    overlay.append(card)



    return {

      card,

      titleEl,

      textEl,

      regionId: null,

      screenX: 0,

      screenY: 0,

      showCard: true,

    }

  }



  /**

   * @param {ReturnType<typeof createRegionCardView>} view

   * @param {number} viewportWidth

   * @param {number} viewportHeight

   */

  function layoutRegionCard(view, viewportWidth, viewportHeight) {

    if (!view.showCard || !view.regionId) {

      view.card.classList.add('is-hidden')

      return

    }



    view.card.classList.remove('is-hidden')



    // Measure after visible so offsetWidth/Height are non-zero.

    const tooltipWidth = view.card.offsetWidth || 1

    const tooltipHeight = view.card.offsetHeight || 1



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

   * @param {object} viewer

   * @param {object} project

   */

  function initScaRegionOverlay(viewer, project) {

    const getRegions = () => {

      const regions = window.SCA3D?.state?.project?.regions ?? project?.regions

      return Array.isArray(regions) ? regions.filter((region) => region?.enabled) : []

    }



    let overlay = document.getElementById('sca-region-overlay')

    if (!overlay) {

      overlay = document.createElement('div')

      overlay.id = 'sca-region-overlay'

      overlay.className = 'sca-hotspot-markers-overlay'

      overlay.style.zIndex = '21'

      document.body.appendChild(overlay)

    }



    const view = createRegionCardView(overlay)



    /**

     * @param {string|null} regionId

     * @param {{ x: number, y: number }|null} screenPoint

     */

    const setActiveRegion = (regionId, screenPoint = null) => {

      if (!regionId) {

        view.regionId = null

        view.card.classList.add('is-hidden')

        return

      }



      const region = getRegions().find((entry) => entry.id === regionId)

      if (!region) {

        view.regionId = null

        view.card.classList.add('is-hidden')

        return

      }



      view.regionId = regionId

      view.titleEl.textContent = region.name ?? regionId

      view.textEl.textContent = region.text ?? ''

      view.showCard = region.interaction?.showCard !== false



      if (screenPoint) {

        view.screenX = screenPoint.x

        view.screenY = screenPoint.y

      }



      if (!view.showCard) {
        view.card.classList.add('is-hidden')
        return
      }

      view.card.classList.remove('is-hidden')

      const layout = () => {

        layoutRegionCard(view, window.innerWidth, window.innerHeight)

      }



      layout()

      requestAnimationFrame(layout)

    }



    const onResize = () => {

      if (view.regionId && view.showCard) {

        layoutRegionCard(view, window.innerWidth, window.innerHeight)

      }

    }



    window.addEventListener('resize', onResize)



    window.SCA3D = window.SCA3D || {}

    window.SCA3D.regionOverlay = {

      setActiveRegion,

      hide() {

        setActiveRegion(null)

      },

    }



    void viewer

    console.log(`[SCA3D] region overlay ready (${getRegions().length} region(s))`)

  }



  window.initScaRegionOverlay = initScaRegionOverlay

})()


