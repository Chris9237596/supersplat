import { ScaProject } from '../types/project';

const ANIMATION_ID_PREFIX = 'animation_';

const collectAnimationIds = (project: ScaProject): Set<string> => {
    const ids = new Set<string>();
    for (const clip of project.animations ?? []) {
        if (clip?.id) {
            ids.add(clip.id);
        }
    }
    return ids;
};

const nextPrefixedId = (prefix: string, existing: Set<string>): string => {
    const numbers = [...existing]
        .map((id) => {
            const match = new RegExp(`^${prefix}(\\d+)$`).exec(id);
            return match ? parseInt(match[1], 10) : null;
        })
        .filter((value): value is number => value !== null);

    let next = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
    let candidate = `${prefix}${String(next).padStart(2, '0')}`;

    while (existing.has(candidate)) {
        next += 1;
        candidate = `${prefix}${String(next).padStart(2, '0')}`;
    }

    return candidate;
};

const generateAnimationId = (project: ScaProject): string => {
    return nextPrefixedId(ANIMATION_ID_PREFIX, collectAnimationIds(project));
};

const generateTrackId = (clip: { tracks: { id: string }[] }): string => {
    return nextPrefixedId('track_', new Set(clip.tracks.map((track) => track.id)));
};

const generateKeyframeId = (track: { keyframes: { id: string }[] }): string => {
    return nextPrefixedId('keyframe_', new Set(track.keyframes.map((keyframe) => keyframe.id)));
};

export {
    ANIMATION_ID_PREFIX,
    generateAnimationId,
    generateKeyframeId,
    generateTrackId
};
