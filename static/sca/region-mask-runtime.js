/**
 * Runtime region mask decode and O(1) membership lookup.
 * Masks are in final runtime SOG gaussian index space after export remapping.
 */
;(function () {
  const REGION_MASK_MAGIC = 'SCARM'
  const REGION_MASK_VERSION = 1
  const HEADER_BYTES = 16

  function decodeRegionMask(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < HEADER_BYTES) {
      throw new Error('[SCA3D] region mask file too small')
    }

    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4])
    if (magic !== REGION_MASK_MAGIC) {
      throw new Error(`[SCA3D] invalid region mask magic: ${magic}`)
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const version = view.getUint8(5)
    if (version !== REGION_MASK_VERSION) {
      throw new Error(`[SCA3D] unsupported region mask version: ${version}`)
    }

    const format = view.getUint8(6)
    if (format !== 0) {
      throw new Error(`[SCA3D] unsupported region mask format: ${format}`)
    }

    const gaussianCount = view.getUint32(8, true)
    const payloadBytes = view.getUint32(12, true)

    if (HEADER_BYTES + payloadBytes !== bytes.byteLength) {
      throw new Error('[SCA3D] region mask payload size mismatch')
    }

    const payload = new Uint32Array(
      bytes.buffer,
      bytes.byteOffset + HEADER_BYTES,
      payloadBytes / 4
    )

    return { gaussianCount, payload }
  }

  const SINGLE_BIT = 0x80000000
  const INDEX_MASK = 0x7fffffff

  function buildMembershipBitset(payload, gaussianCount) {
    const bitset = new Uint8Array(gaussianCount)
    let memberCount = 0
    let r = 0
    while (r < payload.length) {
      if (payload[r] & SINGLE_BIT) {
        const index = payload[r] & INDEX_MASK
        if (index >= 0 && index < gaussianCount) {
          bitset[index] = 1
          memberCount++
        }
        r += 1
      } else {
        const start = payload[r]
        const count = payload[r + 1]
        for (let i = start, end = start + count; i < end; i++) {
          if (i >= 0 && i < gaussianCount) {
            bitset[i] = 1
            memberCount++
          }
        }
        r += 2
      }
    }
    return { bitset, memberCount }
  }

  function bitsetContains(bitset, gaussianIndex) {
    return gaussianIndex >= 0 &&
      gaussianIndex < bitset.length &&
      bitset[gaussianIndex] === 1
  }

  /**
   * Build unified runtime lookup (single merged SOG index space).
   */
  function buildRegionLookup(regions, maskBytesByRegionId) {
    /** @type {{ gaussianCount: number, entries: Array<{ regionId: string, region: object, bitset: Uint8Array, memberCount: number }> }} */
    const lookup = {
      gaussianCount: 0,
      entries: [],
    }

    if (!Array.isArray(regions)) {
      return lookup
    }

    for (const region of regions) {
      if (!region?.enabled || region.source?.type !== 'gaussian-mask') {
        continue
      }

      const maskBytes = maskBytesByRegionId.get(region.id)
      if (!maskBytes) {
        console.warn(`[SCA REGION] mask missing for ${region.id}`)
        continue
      }

      const { gaussianCount, payload } = decodeRegionMask(maskBytes)
      const { bitset, memberCount } = buildMembershipBitset(payload, gaussianCount)

      if (lookup.gaussianCount === 0) {
        lookup.gaussianCount = gaussianCount
      } else if (lookup.gaussianCount !== gaussianCount) {
        console.warn(
          `[SCA REGION] gaussianCount mismatch for ${region.id}: expected ${lookup.gaussianCount}, got ${gaussianCount}`
        )
      }

      lookup.entries.push({ regionId: region.id, region, bitset, memberCount })
      console.log(`[SCA REGION] mask loaded ${region.id} (${memberCount} members, gaussianCount=${gaussianCount})`)
    }

    console.log(`[SCA REGION] project regions loaded: ${lookup.entries.length}`)
    return lookup
  }

  function resolveRegionAtGaussian(lookup, gaussianIndex) {
    if (!lookup || gaussianIndex < 0 || gaussianIndex >= lookup.gaussianCount) {
      return null
    }

    for (const entry of lookup.entries) {
      if (bitsetContains(entry.bitset, gaussianIndex)) {
        return entry
      }
    }

    return null
  }

  window.SCA3D = window.SCA3D || {}
  window.SCA3D.regionMask = {
    decodeRegionMask,
    buildMembershipBitset,
    bitsetContains,
    buildRegionLookup,
    resolveRegionAtGaussian,
  }
})()
