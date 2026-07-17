// Per-model orientation state. Quote options remain as a legacy fallback for
// a preview opened before a result row has been created.

export function normalizeOrientation(value) {
    const source = value?.euler || value || {};
    const number = (key) => {
        const parsed = Number(source[key]);
        return Number.isFinite(parsed) ? parsed : 0;
    };
    return { x: number('x'), y: number('y'), z: number('z') };
}

export function hasNonZeroOrientation(value) {
    const orientation = normalizeOrientation(value);
    return orientation.x !== 0 || orientation.y !== 0 || orientation.z !== 0;
}

export function getResultOrientation(result, fallback = null) {
    if (result?.euler_angles_deg) return normalizeOrientation(result.euler_angles_deg);
    if (result?._orientation) return normalizeOrientation(result._orientation);
    return fallback ? normalizeOrientation(fallback) : null;
}

export function withResultOrientation(result, orientation) {
    const normalized = normalizeOrientation(orientation);
    return {
        ...result,
        _orientation: normalized,
        euler_angles_deg: normalized,
    };
}
