/**
 * Shared 3D anchor -> screen projection for Hotspot and Region runtime overlays.
 * Uses CameraComponent.worldToScreen (not the internal Camera object).
 */
;(function () {
  /**
   * @param {object} viewer
   * @returns {import('@playcanvas/engine').CameraComponent|null}
   */
  function findViewerCamera(viewer) {
    const app = viewer?.global?.app
    if (!app?.root?.findByName) {
      return null
    }
    return app.root.findByName('camera')?.camera ?? null
  }

  function getAnnotationCanvasSize() {
    const canvas = document.getElementById('application-canvas')
    return {
      width: canvas?.clientWidth ?? 0,
      height: canvas?.clientHeight ?? 0,
    }
  }

  /**
   * @param {object} viewer
   * @param {{ x: number, y: number, z: number }|null|undefined} anchor3D
   * @returns {{ visible: boolean, screenX: number, screenY: number }}
   */
  function projectAnchor3D(viewer, anchor3D) {
    const hidden = { visible: false, screenX: 0, screenY: 0 }

    if (
      !anchor3D ||
      !Number.isFinite(anchor3D.x) ||
      !Number.isFinite(anchor3D.y) ||
      !Number.isFinite(anchor3D.z)
    ) {
      return hidden
    }

    const camera = findViewerCamera(viewer)
    if (!camera?.worldToScreen || !camera.entity?.getPosition) {
      return hidden
    }

    const { width, height } = getAnnotationCanvasSize()
    if (width <= 0 || height <= 0) {
      return hidden
    }

    const cameraEntity = camera.entity
    const cameraPos = cameraEntity.getPosition()
    const cameraFwd = cameraEntity.forward

    const dx = anchor3D.x - cameraPos.x
    const dy = anchor3D.y - cameraPos.y
    const dz = anchor3D.z - cameraPos.z
    if (dx * cameraFwd.x + dy * cameraFwd.y + dz * cameraFwd.z <= 0) {
      return hidden
    }

    const world = cameraPos.clone()
    world.set(anchor3D.x, anchor3D.y, anchor3D.z)
    const screenPos = camera.worldToScreen(world)
    if (!screenPos) {
      return hidden
    }

    if (screenPos.z !== undefined && screenPos.z <= 0) {
      return hidden
    }

    const screenX = Math.round(screenPos.x)
    const screenY = Math.round(screenPos.y)
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) {
      return hidden
    }

    return { visible: true, screenX, screenY }
  }

  window.SCA3D = window.SCA3D || {}
  window.SCA3D.annotationProjector = {
    findViewerCamera,
    getAnnotationCanvasSize,
    projectAnchor3D,
  }
})()
