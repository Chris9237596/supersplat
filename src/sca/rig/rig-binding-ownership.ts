import { collectRigSubtreeNodeIds } from './rig-hierarchy';
import { ScaRig } from '../types/rig';

type RigBindingRef = {
    regionId: string;
    nodeId: string;
    memberCount: number;
};

type RigBindingOwner = {
    regionId: string;
    nodeId: string;
};

type RigBindingClaim = RigBindingRef & {
    gaussianIndices: Iterable<number>;
};

type ResolvedRigBindingOwners = {
    ownerByGaussian: Map<number, RigBindingOwner>;
    /** Regions that lost Gaussians to a binding on another rig node. */
    skippedRegions: Set<string>;
    /** Region pairs that conflicted across unrelated rig nodes (same depth, no ancestry). */
    unrelatedConflictRegions: Set<string>;
};

const getRigNodeDepth = (rig: ScaRig, nodeId: string): number => {
    let depth = 0;
    let current = rig.nodes.find((node) => node.id === nodeId) ?? null;

    while (current?.parentId) {
        depth++;
        current = rig.nodes.find((node) => node.id === current!.parentId) ?? null;
    }

    return depth;
};

const isStrictRigAncestor = (rig: ScaRig, ancestorId: string, descendantId: string): boolean => {
    if (ancestorId === descendantId) {
        return false;
    }

    return collectRigSubtreeNodeIds(rig, ancestorId).includes(descendantId);
};

const compareRigBindingOwnership = (
    rig: ScaRig,
    left: RigBindingRef,
    right: RigBindingRef
): { winner: 'left' | 'right'; unrelated: boolean } => {
    if (left.nodeId === right.nodeId) {
        return {
            winner: left.regionId.localeCompare(right.regionId) <= 0 ? 'left' : 'right',
            unrelated: false
        };
    }

    if (isStrictRigAncestor(rig, left.nodeId, right.nodeId)) {
        return { winner: 'right', unrelated: false };
    }

    if (isStrictRigAncestor(rig, right.nodeId, left.nodeId)) {
        return { winner: 'left', unrelated: false };
    }

    const leftDepth = getRigNodeDepth(rig, left.nodeId);
    const rightDepth = getRigNodeDepth(rig, right.nodeId);
    if (leftDepth !== rightDepth) {
        return {
            winner: leftDepth > rightDepth ? 'left' : 'right',
            unrelated: true
        };
    }

    if (left.memberCount !== right.memberCount) {
        return {
            winner: left.memberCount < right.memberCount ? 'left' : 'right',
            unrelated: true
        };
    }

    const nodeOrder = left.nodeId.localeCompare(right.nodeId);
    if (nodeOrder !== 0) {
        return {
            winner: nodeOrder < 0 ? 'left' : 'right',
            unrelated: true
        };
    }

    return {
        winner: left.regionId.localeCompare(right.regionId) <= 0 ? 'left' : 'right',
        unrelated: true
    };
};

const resolveRigBindingOwners = (
    rig: ScaRig,
    claims: RigBindingClaim[]
): ResolvedRigBindingOwners => {
    const ownerByGaussian = new Map<number, RigBindingOwner>();
    const skippedRegions = new Set<string>();
    const unrelatedConflictRegions = new Set<string>();
    const claimByRegionId = new Map<string, RigBindingRef>(
        claims.map((claim) => [claim.regionId, claim])
    );

    for (const claim of claims) {
        for (const gaussianIndex of claim.gaussianIndices) {
            const existing = ownerByGaussian.get(gaussianIndex);
            if (!existing) {
                ownerByGaussian.set(gaussianIndex, {
                    regionId: claim.regionId,
                    nodeId: claim.nodeId
                });
                continue;
            }

            const existingClaim = claimByRegionId.get(existing.regionId)!;
            const comparison = compareRigBindingOwnership(rig, existingClaim, claim);

            if (comparison.unrelated) {
                unrelatedConflictRegions.add(existing.regionId);
                unrelatedConflictRegions.add(claim.regionId);
            }

            if (comparison.winner === 'right') {
                ownerByGaussian.set(gaussianIndex, {
                    regionId: claim.regionId,
                    nodeId: claim.nodeId
                });
            }
        }
    }

    for (const claim of claims) {
        for (const gaussianIndex of claim.gaussianIndices) {
            const owner = ownerByGaussian.get(gaussianIndex);
            if (owner && owner.nodeId !== claim.nodeId) {
                skippedRegions.add(claim.regionId);
            }
        }
    }

    return {
        ownerByGaussian,
        skippedRegions,
        unrelatedConflictRegions
    };
};

export {
    RigBindingClaim,
    RigBindingOwner,
    RigBindingRef,
    ResolvedRigBindingOwners,
    compareRigBindingOwnership,
    getRigNodeDepth,
    isStrictRigAncestor,
    resolveRigBindingOwners
};
