/**

 * Region info card overlay — shared presentation model + Hotspot card CSS.

 */

;(function () {

  const annotationProjector = () => window.SCA3D?.annotationProjector



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

      anchor3D: null,

      showCard: true,

    }

  }



  /**

   * @param {ReturnType<typeof createRegionCardView>} view

   * @param {number} viewportWidth

   * @param {number} viewportHeight

   */

  function layoutRegionCardView(view, viewportWidth, viewportHeight) {

    if (!view.showCard || !view.regionId) {

      view.card.classList.add('is-hidden')

      return

    }



    view.card.classList.remove('is-hidden')



    const layoutFn = window.SCA3D?.layoutRegionCard

    const applyLayoutFn = window.SCA3D?.applyRegionCardLayout

    if (typeof layoutFn !== 'function' || typeof applyLayoutFn !== 'function') {

      view.card.classList.add('is-hidden')

      return

    }



    const layout = layoutFn({

      screenX: view.screenX,

      screenY: view.screenY,

      cardWidth: view.card.offsetWidth || 1,

      cardHeight: view.card.offsetHeight || 1,

      viewportWidth,

      viewportHeight,

    })



    applyLayoutFn(view.card, layout)

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



    let lastCardDiag = ''

    const projectAnchorToScreen = () => {

      if (!view.regionId || !view.showCard || !view.anchor3D) {

        return false

      }



      const projector = annotationProjector()

      if (!projector) {

        view.card.classList.add('is-hidden')

        return false

      }



      const projected = projector.projectAnchor3D(viewer, view.anchor3D)

      if (!projected.visible) {

        view.card.classList.add('is-hidden')

        return false

      }



      view.screenX = projected.screenX

      view.screenY = projected.screenY



      const cardKey = `${view.regionId}:${view.screenX},${view.screenY}`

      if (cardKey !== lastCardDiag) {

        lastCardDiag = cardKey

        console.log([

          '[SCA REGION CARD]',

          `regionId=${view.regionId}`,

          `screen={x:${view.screenX},y:${view.screenY}}`,

          'anchorValid=true',

        ].join('\n'))

      }



      view.card.classList.remove('is-hidden')

      return true

    }



    const relayout = () => {

      if (!view.regionId || !view.showCard) {

        view.card.classList.add('is-hidden')

        return

      }



      if (view.anchor3D && !projectAnchorToScreen()) {

        return

      }



      const canvas = document.getElementById('application-canvas')

      const viewportWidth = canvas?.clientWidth ?? window.innerWidth

      const viewportHeight = canvas?.clientHeight ?? window.innerHeight

      if (!Number.isFinite(view.screenX) || !Number.isFinite(view.screenY)) {

        view.card.classList.add('is-hidden')

        return

      }

      layoutRegionCardView(view, viewportWidth, viewportHeight)

    }



    /**
     * @param {ReturnType<typeof createRegionCardView>} view
     * @param {object|null} cardModel
     */
    const applyPresentation = (cardModel) => {

      if (!cardModel?.visible || !cardModel.regionId) {

        view.regionId = null

        view.anchor3D = null

        view.showCard = false

        view.card.classList.add('is-hidden')

        lastCardDiag = ''

        return

      }



      if (!cardModel.anchor3D) {

        console.warn(`[SCA REGION CARD] skipped ${cardModel.regionId}: no anchor3D`)

        view.regionId = null

        view.anchor3D = null

        view.showCard = false

        view.card.classList.add('is-hidden')

        lastCardDiag = ''

        return

      }



      view.regionId = cardModel.regionId

      view.titleEl.textContent = cardModel.name ?? cardModel.regionId

      view.textEl.textContent = cardModel.text ?? ''

      view.showCard = true

      view.anchor3D = cardModel.anchor3D



      view.card.classList.remove('is-hidden')

      relayout()

      requestAnimationFrame(relayout)

    }



    /**

     * @param {string|null} regionId

     * @param {{ anchor3D?: { x:number, y:number, z:number } }|null} anchor

     */

    const setActiveRegion = (regionId, anchor = null) => {

      if (!regionId) {

        applyPresentation(null)

        return

      }



      const region = getRegions().find((entry) => entry.id === regionId)

      if (!region) {

        applyPresentation(null)

        return

      }



      const buildEntry = window.SCA3D?.buildRegionPresentationEntry

      const buildCard = window.SCA3D?.buildRegionCardModel

      const entry = typeof buildEntry === 'function' ?

        buildEntry(region, null, regionId, anchor?.anchor3D ?? null) :

        null

      const cardModel = typeof buildCard === 'function' ? buildCard(entry) : null

      applyPresentation(cardModel)

    }



    const onResize = () => {

      relayout()

    }



    window.addEventListener('resize', onResize)



    const app = viewer?.global?.app

    if (app) {

      app.on('postrender', relayout)

    } else {

      viewer?.global?.events?.on('firstFrame', () => {

        viewer.global?.app?.on('postrender', relayout)

        relayout()

      })

    }



    window.SCA3D = window.SCA3D || {}

    window.SCA3D.regionOverlay = {

      applyPresentation,

      setActiveRegion,

      hide() {

        applyPresentation(null)

      },

    }



    void viewer

    console.log(`[SCA3D] region overlay ready (${getRegions().length} region(s))`)

  }



  window.initScaRegionOverlay = initScaRegionOverlay

})()

