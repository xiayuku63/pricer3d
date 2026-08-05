import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCandidatePatchData } from '../static/js/modules/layface-geometry.js';

function triangles(...vertices) {
    return { face_vertices: vertices };
}

test('candidate patch geometry deduplicates triangles and keeps only outer boundary edges', () => {
    const patch = buildCandidatePatchData([
        triangles(
            [0, 0, 0], [2, 0, 0], [2, 2, 0],
            [0, 0, 0], [2, 2, 0], [0, 2, 0],
        ),
    ]);

    assert.equal(patch.positions.length / 3, 4);
    assert.equal(patch.indices.length / 3, 2);
    assert.deepEqual(patch.triangleClusterIds, [0, 0]);
    assert.equal(patch.boundaryPositions.length / 6, 4);
    assert.deepEqual(patch.clusterVertexRanges[0], { start: 0, count: 4 });
    assert.deepEqual(patch.clusterBoundaryRanges[0], { start: 0, count: 8 });
});

test('candidate patch geometry preserves hole contours instead of filling them', () => {
    const outer = [[0, 0, 0], [4, 0, 0], [4, 4, 0], [0, 4, 0]];
    const inner = [[1, 1, 0], [3, 1, 0], [3, 3, 0], [1, 3, 0]];
    const faceVertices = [];
    for (let side = 0; side < 4; side++) {
        const next = (side + 1) % 4;
        faceVertices.push(
            outer[side], outer[next], inner[next],
            outer[side], inner[next], inner[side],
        );
    }

    const patch = buildCandidatePatchData([{ face_vertices: faceVertices }]);

    assert.equal(patch.indices.length / 3, 8);
    assert.equal(patch.boundaryPositions.length / 6, 8, 'outer and inner loops must both remain visible');
});

test('disconnected coplanar patches remain separate but share one placement cluster id', () => {
    const patch = buildCandidatePatchData([
        triangles(
            [0, 0, 0], [1, 0, 0], [0, 1, 0],
            [3, 0, 0], [4, 0, 0], [3, 1, 0],
        ),
    ], vertex => [vertex[0] + 10, vertex[1], vertex[2]]);

    assert.equal(patch.indices.length / 3, 2);
    assert.deepEqual(patch.triangleClusterIds, [0, 0]);
    assert.equal(patch.boundaryPositions.length / 6, 6);
    assert.equal(patch.positions[0], 10);
});
