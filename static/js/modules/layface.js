/**
 * Lay on Face interaction for manual 3D model placement.
 *
 * Candidate source triangles are rendered as exact surface patches with a
 * shared fill mesh and shared boundary lines. This preserves holes, concavity,
 * and disconnected patches without oversized markers or text labels.
 */

import * as THREE from 'three';
import { currentMeshCenterOffset, fitCameraToMesh } from './viewer.js';
import { buildCandidatePatchData } from './layface-geometry.js';

// Use a saturated cyan patch instead of Bambu Studio's pale neutral tint.
// Pricer3D commonly previews white/light-gray materials, where a white patch
// disappears. Cyan stays distinguishable on white, gray, and dark models, while
// the dark teal contour preserves the exact candidate boundary.
const FACE_FILL_COLOR = 0x06b6d4;
const FACE_HOVER_COLOR = 0x67e8f9;
const FACE_OUTLINE_COLOR = 0x155e75;
const FACE_OUTLINE_HOVER_COLOR = 0xffffff;
const FACE_FILL_OPACITY = 0.38;
const FACE_SURFACE_BIAS = 0.08;

let clusterOverlays = [];
let clusterHighlightGroup = null;
let clusterFillMesh = null;
let clusterOutlineSegments = null;
let clusterTriangleIds = [];
let clusterVertexRanges = [];
let clusterBoundaryRanges = [];
let cachedOccluderRoot = null;
let cachedOccluderMeshes = [];
let clusterMode = false;

function _makeColorAttribute(vertexCount, colorHex) {
    const color = new THREE.Color(colorHex);
    const values = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
        values[i * 3] = color.r;
        values[i * 3 + 1] = color.g;
        values[i * 3 + 2] = color.b;
    }
    return new THREE.Float32BufferAttribute(values, 3);
}

function _setColorRange(attribute, range, colorHex) {
    if (!attribute || !range || range.count <= 0) return;
    const color = new THREE.Color(colorHex);
    const end = range.start + range.count;
    for (let i = range.start; i < end; i++) {
        attribute.setXYZ(i, color.r, color.g, color.b);
    }
    attribute.needsUpdate = true;
}

/**
 * Render all selectable areas as one indexed mesh plus one boundary LineSegments
 * object. Unlike the old minimum-size ellipses, these patches never extend
 * beyond the source triangles, so tiny curved facets stay tiny and holes remain
 * holes. A faceIndex -> clusterId table keeps picking O(1).
 */
export function renderClusters(parent, clusters) {
    clearClusters();
    if (!parent || !Array.isArray(clusters) || clusters.length === 0) return;

    const co = currentMeshCenterOffset || new THREE.Vector3(0, 0, 0);
    let sinkZ = 0;
    const modelLocalCenter = new THREE.Vector3();
    if (parent.geometry) {
        parent.geometry.computeBoundingBox();
        parent.geometry.boundingBox.getCenter(modelLocalCenter);
        sinkZ = modelLocalCenter.z;
    } else {
        parent.updateWorldMatrix(true, true);
        const worldCenter = new THREE.Box3().setFromObject(parent, true).getCenter(new THREE.Vector3());
        modelLocalCenter.copy(parent.worldToLocal(worldCenter));
    }

    const patch = buildCandidatePatchData(clusters, (vertex, cluster) => {
        const normal = new THREE.Vector3(
            Number(cluster?.normal?.[0]) || 0,
            Number(cluster?.normal?.[1]) || 0,
            Number(cluster?.normal?.[2]) || 0,
        );
        const surfacePoint = new THREE.Vector3(
            vertex[0] - co.x,
            vertex[1] - co.y,
            vertex[2] - co.z + sinkZ,
        );
        if (normal.lengthSq() > 1e-12) {
            normal.normalize();
            if (Array.isArray(cluster?.centroid) && cluster.centroid.length >= 3) {
                const clusterCenter = new THREE.Vector3(
                    cluster.centroid[0] - co.x,
                    cluster.centroid[1] - co.y,
                    cluster.centroid[2] - co.z + sinkZ,
                );
                if (normal.dot(clusterCenter.sub(modelLocalCenter)) < 0) normal.negate();
            }
            surfacePoint.addScaledVector(normal, FACE_SURFACE_BIAS);
        }
        return [surfacePoint.x, surfacePoint.y, surfacePoint.z];
    });
    if (patch.indices.length === 0) return;

    clusterHighlightGroup = new THREE.Group();
    clusterHighlightGroup.name = 'lay-on-face-candidates';
    clusterHighlightGroup.userData.isClusterOverlay = true;
    parent.add(clusterHighlightGroup);

    const fillGeometry = new THREE.BufferGeometry();
    fillGeometry.setAttribute('position', new THREE.Float32BufferAttribute(patch.positions, 3));
    fillGeometry.setAttribute('color', _makeColorAttribute(patch.positions.length / 3, FACE_FILL_COLOR));
    fillGeometry.setIndex(patch.indices);
    fillGeometry.computeBoundingSphere();

    const fillMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: FACE_FILL_OPACITY,
        vertexColors: true,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        toneMapped: false,
    });
    clusterFillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
    clusterFillMesh.name = 'lay-on-face-fill';
    clusterFillMesh.renderOrder = 20;
    clusterFillMesh.userData = {
        isClusterOverlay: true,
        triangleClusterIds: patch.triangleClusterIds,
    };
    clusterHighlightGroup.add(clusterFillMesh);

    if (patch.boundaryPositions.length > 0) {
        const outlineGeometry = new THREE.BufferGeometry();
        outlineGeometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(patch.boundaryPositions, 3),
        );
        outlineGeometry.setAttribute(
            'color',
            _makeColorAttribute(patch.boundaryPositions.length / 3, FACE_OUTLINE_COLOR),
        );
        outlineGeometry.computeBoundingSphere();
        const outlineMaterial = new THREE.LineBasicMaterial({
            transparent: true,
            opacity: 1.0,
            vertexColors: true,
            depthTest: true,
            depthWrite: false,
            toneMapped: false,
        });
        clusterOutlineSegments = new THREE.LineSegments(outlineGeometry, outlineMaterial);
        clusterOutlineSegments.name = 'lay-on-face-outline';
        clusterOutlineSegments.renderOrder = 21;
        clusterOutlineSegments.userData.isClusterOverlay = true;
        clusterHighlightGroup.add(clusterOutlineSegments);
    }

    clusterTriangleIds = patch.triangleClusterIds;
    clusterVertexRanges = patch.clusterVertexRanges;
    clusterBoundaryRanges = patch.clusterBoundaryRanges;
    clusterOverlays = [clusterFillMesh];
    clusterMode = true;
}

/** Clear all candidate geometry and GPU resources. */
export function clearClusters() {
    if (clusterHighlightGroup && clusterHighlightGroup.parent) {
        clusterHighlightGroup.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (child.material.map) child.material.map.dispose();
                child.material.dispose();
            }
        });
        clusterHighlightGroup.parent.remove(clusterHighlightGroup);
    }
    clusterHighlightGroup = null;
    clusterFillMesh = null;
    clusterOutlineSegments = null;
    clusterTriangleIds = [];
    clusterVertexRanges = [];
    clusterBoundaryRanges = [];
    clusterOverlays = [];
    clusterMode = false;
    cachedOccluderRoot = null;
    cachedOccluderMeshes = [];
}

/** Set or clear the hover emphasis for one candidate cluster. */
export function setClusterHover(index, active) {
    if (!Number.isInteger(index) || index < 0 || index >= clusterVertexRanges.length) return;
    if (clusterFillMesh) {
        _setColorRange(
            clusterFillMesh.geometry.getAttribute('color'),
            clusterVertexRanges[index],
            active ? FACE_HOVER_COLOR : FACE_FILL_COLOR,
        );
    }
    if (clusterOutlineSegments) {
        _setColorRange(
            clusterOutlineSegments.geometry.getAttribute('color'),
            clusterBoundaryRanges[index],
            active ? FACE_OUTLINE_HOVER_COLOR : FACE_OUTLINE_COLOR,
        );
    }
}

function _collectOccluderMeshes(occluder) {
    if (!occluder) return [];
    if (occluder === cachedOccluderRoot) return cachedOccluderMeshes;

    const meshes = [];
    occluder.traverse(object => {
        if (!object.isMesh) return;
        if (object.userData && object.userData.isClusterOverlay) return;
        meshes.push(object);
    });
    cachedOccluderRoot = occluder;
    cachedOccluderMeshes = meshes;
    return cachedOccluderMeshes;
}

/**
 * Pick the merged candidate mesh and translate Three.js faceIndex back to the
 * placement cluster id. Model-first occlusion rejects invisible back-side hits.
 */
export function intersectClusters(raycaster, occluder = null) {
    if (!clusterMode || clusterOverlays.length === 0) return null;
    const hit = raycaster.intersectObjects(clusterOverlays, false)[0];
    if (!hit) return null;

    if (occluder) {
        const occluderMeshes = _collectOccluderMeshes(occluder);
        const modelHit = raycaster.intersectObjects(occluderMeshes, false)[0];
        if (modelHit && modelHit.distance < hit.distance - 0.01) return null;
    }

    const clusterIndex = clusterTriangleIds[hit.faceIndex];
    if (!Number.isInteger(clusterIndex)) return null;
    return { index: clusterIndex, mesh: hit.object };
}

export function isClusterMode() {
    return clusterMode;
}

/** Return the selected source patch's lowest world-space Z for normal-sign selection. */
function _getFaceWorldMinZ(mesh, faceVertices) {
    if (!mesh || !Array.isArray(faceVertices) || faceVertices.length < 3) return null;

    const co = currentMeshCenterOffset || new THREE.Vector3(0, 0, 0);
    const localBedOffset = new THREE.Vector3(0, 0, 0);
    if (mesh.geometry) {
        mesh.geometry.computeBoundingBox();
        mesh.geometry.boundingBox.getCenter(localBedOffset);
    }
    // Backend clusters use normalized STL source coordinates. The viewer first
    // subtracts currentMeshCenterOffset with geometry.center(), then translates
    // the local geometry upward so its initial bottom is Z=0. Reapply both
    // transforms before matrixWorld so face-side selection uses the real plane.
    let minZ = Infinity;
    const point = new THREE.Vector3();
    for (const vertex of faceVertices) {
        if (!Array.isArray(vertex) || vertex.length < 3) continue;
        point.set(
            vertex[0] - co.x + localBedOffset.x,
            vertex[1] - co.y + localBedOffset.y,
            vertex[2] - co.z + localBedOffset.z,
        );
        point.applyMatrix4(mesh.matrixWorld);
        if (Number.isFinite(point.z)) minZ = Math.min(minZ, point.z);
    }
    return Number.isFinite(minZ) ? minZ : null;
}

export function placeFaceOnBed(mesh, normal, upAxis = 'Z', faceVertices = null) {
    if (!mesh) return;

    const n = new THREE.Vector3(normal[0], normal[1], normal[2]).normalize();
    const up = new THREE.Vector3(0, 0, 1);

    // STL files may contain inverted face winding. Test both normal directions
    // and retain the one that places the selected face closest to the model's
    // actual bottom, rather than trusting the normal sign blindly.
    const directions = [n.clone().negate(), n.clone()];
    let bestQuat = null;
    let bestGap = Infinity;
    for (const direction of directions) {
        const candidateQuat = new THREE.Quaternion().setFromUnitVectors(direction, up);
        mesh.quaternion.copy(candidateQuat);
        mesh.updateMatrixWorld(true);
        const modelBox = new THREE.Box3().setFromObject(mesh, true);
        const faceMinZ = _getFaceWorldMinZ(mesh, faceVertices);
        const gap = faceMinZ === null ? 0 : Math.max(0, faceMinZ - modelBox.min.z);
        if (gap < bestGap) {
            bestGap = gap;
            bestQuat = candidateQuat;
        }
    }
    mesh.quaternion.copy(bestQuat || new THREE.Quaternion());

    // Use face vertices only to choose the normal direction. The rendered object's
    // world bounds are the source of truth for final bed contact, so malformed
    // or stale face coordinates can never leave the visible model floating.
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh, true);
    mesh.position.z -= box.min.z;

    // X/Y 居中到热床中心（与 orientation-ui.js centerModel() 逻辑一致）
    mesh.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(mesh, true);
    const center = box2.getCenter(new THREE.Vector3());
    const bc = window._BED_CENTER || 128;
    mesh.position.x += (bc - center.x);
    mesh.position.y += (bc - center.y);
    mesh.updateMatrixWorld(true);

    // 重新适配相机视角
    try { fitCameraToMesh(mesh); } catch(e) { /* ignore */ }
}
