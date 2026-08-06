/**
 * Build compact render data for manual-placement candidate patches.
 *
 * New manual-placement responses provide a shared vertex pool plus triangle
 * indices. Legacy duplicated face_vertices responses are still accepted. Both
 * paths preserve concave regions, holes, and disconnected patches while
 * extracting only true boundary edges for the contour.
 */

const DEFAULT_QUANTIZATION = 1e-5;

function vertexKey(vertex, quantization) {
    return vertex.map(value => Math.round(value / quantization)).join(',');
}

function isFiniteVertex(vertex) {
    return Array.isArray(vertex)
        && vertex.length >= 3
        && Number.isFinite(vertex[0])
        && Number.isFinite(vertex[1])
        && Number.isFinite(vertex[2]);
}

function trianglesForCluster(cluster) {
    if (Array.isArray(cluster?.face_vertices) && cluster.face_vertices.length >= 3) {
        return cluster.face_vertices;
    }

    // Compatibility fallback for older cached responses that only contain the
    // convex outline. The backend outline is convex, so a triangle fan is safe.
    const outline = Array.isArray(cluster?.vertices) ? cluster.vertices : [];
    if (outline.length < 3) return [];
    const triangles = [];
    for (let i = 1; i + 1 < outline.length; i++) {
        triangles.push(outline[0], outline[i], outline[i + 1]);
    }
    return triangles;
}

export function buildCandidatePatchData(
    clusters,
    transformVertex = vertex => vertex,
    quantization = DEFAULT_QUANTIZATION,
) {
    const positions = [];
    const indices = [];
    const triangleClusterIds = [];
    const boundaryPositions = [];
    const clusterVertexRanges = Array.from({ length: clusters?.length || 0 }, () => null);
    const clusterBoundaryRanges = Array.from({ length: clusters?.length || 0 }, () => null);

    (clusters || []).forEach((cluster, clusterIndex) => {
        const compactVertices = Array.isArray(cluster?.patch_vertices) ? cluster.patch_vertices : null;
        const compactIndices = Array.isArray(cluster?.patch_indices) ? cluster.patch_indices : null;
        const hasCompactGeometry = compactVertices?.length >= 3 && compactIndices?.length >= 3;
        const rawVertices = hasCompactGeometry ? compactVertices : trianglesForCluster(cluster);
        if (rawVertices.length < 3) return;

        const vertexMap = new Map();
        const clusterTriangles = [];
        const edgeCounts = new Map();
        const clusterVertexStart = positions.length / 3;

        const getVertexIndex = rawVertex => {
            if (!isFiniteVertex(rawVertex)) return -1;
            const transformed = transformVertex(rawVertex, cluster, clusterIndex);
            if (!isFiniteVertex(transformed)) return -1;
            const normalized = [
                Number(transformed[0]),
                Number(transformed[1]),
                Number(transformed[2]),
            ];
            const key = vertexKey(normalized, quantization);
            const existing = vertexMap.get(key);
            if (existing !== undefined) return existing;

            const globalIndex = positions.length / 3;
            positions.push(normalized[0], normalized[1], normalized[2]);
            vertexMap.set(key, globalIndex);
            return globalIndex;
        };

        const addTriangle = triangle => {
            if (triangle.some(index => index < 0) || new Set(triangle).size !== 3) return;
            clusterTriangles.push(triangle);
            for (const [a, b] of [
                [triangle[0], triangle[1]],
                [triangle[1], triangle[2]],
                [triangle[2], triangle[0]],
            ]) {
                const edgeKey = a < b ? `${a}:${b}` : `${b}:${a}`;
                const edge = edgeCounts.get(edgeKey);
                if (edge) edge.count += 1;
                else edgeCounts.set(edgeKey, { a, b, count: 1 });
            }
        };

        if (hasCompactGeometry) {
            const globalVertexIndices = compactVertices.map(getVertexIndex);
            const flatIndices = Array.isArray(compactIndices[0])
                ? compactIndices.flat()
                : compactIndices;
            for (let offset = 0; offset + 2 < flatIndices.length; offset += 3) {
                const localTriangle = [
                    Number(flatIndices[offset]),
                    Number(flatIndices[offset + 1]),
                    Number(flatIndices[offset + 2]),
                ];
                if (localTriangle.some(index => !Number.isInteger(index) || index < 0 || index >= globalVertexIndices.length)) continue;
                addTriangle(localTriangle.map(index => globalVertexIndices[index]));
            }
        } else {
            for (let offset = 0; offset + 2 < rawVertices.length; offset += 3) {
                addTriangle([
                    getVertexIndex(rawVertices[offset]),
                    getVertexIndex(rawVertices[offset + 1]),
                    getVertexIndex(rawVertices[offset + 2]),
                ]);
            }
        }

        if (clusterTriangles.length === 0) return;

        clusterVertexRanges[clusterIndex] = {
            start: clusterVertexStart,
            count: positions.length / 3 - clusterVertexStart,
        };

        for (const triangle of clusterTriangles) {
            indices.push(triangle[0], triangle[1], triangle[2]);
            triangleClusterIds.push(clusterIndex);
        }

        const boundaryStart = boundaryPositions.length / 3;
        for (const edge of edgeCounts.values()) {
            if (edge.count !== 1) continue;
            const a = edge.a * 3;
            const b = edge.b * 3;
            boundaryPositions.push(
                positions[a], positions[a + 1], positions[a + 2],
                positions[b], positions[b + 1], positions[b + 2],
            );
        }
        clusterBoundaryRanges[clusterIndex] = {
            start: boundaryStart,
            count: boundaryPositions.length / 3 - boundaryStart,
        };
    });

    return {
        positions,
        indices,
        triangleClusterIds,
        boundaryPositions,
        clusterVertexRanges,
        clusterBoundaryRanges,
    };
}
