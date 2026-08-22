const SPLAT_ID_PREFIX = 'splat_';

const generateSplatId = (existing: Set<string>): string => {
    const numbers = [...existing]
        .map((id) => {
            const match = /^splat_(\d+)$/.exec(id);
            return match ? parseInt(match[1], 10) : null;
        })
        .filter((value): value is number => value !== null);

    let next = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
    let candidate = `${SPLAT_ID_PREFIX}${String(next).padStart(2, '0')}`;

    while (existing.has(candidate)) {
        next += 1;
        candidate = `${SPLAT_ID_PREFIX}${String(next).padStart(2, '0')}`;
    }

    return candidate;
};

export { generateSplatId, SPLAT_ID_PREFIX };
