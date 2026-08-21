/**
 * Shared SCA camera animation math (mirrors src/sca/viewer/camera-animation.ts).
 */
;(function () {
  const easeOut = (x) => (1 - (2 ** (-10 * x))) / (1 - (2 ** -10))

  /**
   * @param {number[]} offset
   * @param {number} radians
   */
  function rotateOffsetY(offset, radians) {
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    return [
      offset[0] * cos + offset[2] * sin,
      offset[1],
      -offset[0] * sin + offset[2] * cos,
    ]
  }

  /**
   * @param {number[]} from
   * @param {number[]} to
   * @param {number} t
   */
  function lerpVec3(from, to, t) {
    return [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
    ]
  }

  /**
   * @param {{ position: number[], target: number[], fov: number }} from
   * @param {{ position: number[], target: number[], fov: number }} to
   * @param {number} t
   */
  function lerpPose(from, to, t) {
    return {
      position: lerpVec3(from.position, to.position, t),
      target: lerpVec3(from.target, to.target, t),
      fov: from.fov + (to.fov - from.fov) * t,
    }
  }

  /**
   * @param {{ position: number[], target: number[], fov: number }} basePose
   * @param {number} elapsedSeconds
   * @param {{ duration: number, direction: string, degrees: number, loop: boolean }} config
   */
  function computeTurntablePose(basePose, elapsedSeconds, config) {
    const [tx, ty, tz] = basePose.target
    const [px, py, pz] = basePose.position
    const offset = [px - tx, py - ty, pz - tz]

    const direction = config.direction === 'counterclockwise' ? -1 : 1
    const totalRadians = config.degrees * (Math.PI / 180) * direction
    const duration = Math.max(config.duration, 1e-6)

    let progress = elapsedSeconds / duration
    if (config.loop) {
      progress = progress % 1
    } else {
      progress = Math.min(1, Math.max(0, progress))
    }

    const rotated = rotateOffsetY(offset, totalRadians * progress)

    return {
      position: [tx + rotated[0], ty + rotated[1], tz + rotated[2]],
      target: [...basePose.target],
      fov: basePose.fov,
    }
  }

  /**
   * @param {{ position: number[], target: number[] }} pose
   * @param {number} [scale]
   */
  function computeFlyToStartPose(pose, scale = 2.5) {
    const [px, py, pz] = pose.position
    const [tx, ty, tz] = pose.target
    const dx = px - tx
    const dy = py - ty
    const dz = pz - tz
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)

    if (distance <= 1e-6) {
      return {
        position: [...pose.position],
        target: [...pose.target],
        fov: pose.fov,
      }
    }

    return {
      position: [
        tx + (px - tx) * scale,
        ty + (py - ty) * scale,
        tz + (pz - tz) * scale,
      ],
      target: [...pose.target],
      fov: pose.fov,
    }
  }

  /**
   * @param {{ position: number[], target: number[], fov: number }} fromPose
   * @param {{ position: number[], target: number[], fov: number }} toPose
   * @param {number} elapsedSeconds
   * @param {number} durationSeconds
   */
  function computeFlyToPose(fromPose, toPose, elapsedSeconds, durationSeconds) {
    const duration = Math.max(durationSeconds, 1e-6)
    const t = Math.min(1, Math.max(0, elapsedSeconds / duration))
    return lerpPose(fromPose, toPose, easeOut(t))
  }

  window.SCA3D = window.SCA3D || {}
  window.SCA3D.easeOut = easeOut
  window.SCA3D.computeTurntablePose = computeTurntablePose
  window.SCA3D.computeFlyToStartPose = computeFlyToStartPose
  window.SCA3D.computeFlyToPose = computeFlyToPose
})()
