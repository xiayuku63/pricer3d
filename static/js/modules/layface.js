/**
 * Lay on Face 交互模块 — 3D 模型智能摆放
 *
 * 依赖：import * as THREE from 'three'
 *
 * 功能：
 *   - 从 API 获取共面面簇（含 face_vertices）
 *   - 在模型上渲染高亮面片
 *   - 点击面片自动旋转模型将该面贴合到打印底板
 *   - 悬停闪烁预览
 */

import * as THREE from 'three';
import { currentMeshCenterOffset, fitCameraToMesh } from './viewer.js';

// Candidate overlays stay attached to the model's real face geometry.
const FACE_FILL_COLOR = 0x22d3ee;
const FACE_HOVER_COLOR = 0x67e8f9;
const FACE_OUTLINE_COLOR = 0xdffeff;
const FACE_OUTLINE_HOVER_COLOR = 0xffffff;
const FACE_OVAL_SHRINK = 0.68;
const FACE_OVAL_MAX_RADIUS = 22;
const FACE_OVAL_MIN_RADIUS = 4;

let clusterOverlays = [];       // 高亮 Mesh 数组
let clusterClickCallback = null; // 点击回调
let clusterHighlightGroup = null;
let clusterMode = false;        // 当前是否处于 Cluster 模式

/**
 * Build a BambuSlicer-style ellipse overlay for one face cluster.
 * Projects the cluster's face vertices onto the face plane, runs PCA to find
 * the principal axes, then emits a filled ellipse (triangle fan) plus a crisp
 * LineLoop outline that bounds all projected points. The ellipse sits in the
 * face's plane and is nudged along the face normal to avoid z-fighting.
 *
 * @param {number[]} flatVerts - flat [x,y,z, x,y,z, ...] already offset to model space
 * @param {number[]} normalArr - [nx, ny, nz] face normal
 * @param {number} clusterIndex - index used for click hit-detection
 * @returns {{mesh: THREE.Mesh, outline: THREE.LineLoop, label: THREE.Sprite} | null}
 */
function _buildEllipseOverlay(flatVerts, normalArr, clusterIndex) {
    // Gather 3D points
    const pts = [];
    for (let i = 0; i + 2 < flatVerts.length; i += 3) {
        pts.push(new THREE.Vector3(flatVerts[i], flatVerts[i + 1], flatVerts[i + 2]));
    }
    if (pts.length < 3) return null;

    // Centroid
    const centroid = new THREE.Vector3();
    for (const p of pts) centroid.add(p);
    centroid.multiplyScalar(1 / pts.length);

    // Face normal + in-plane orthonormal basis (u, v)
    const n = new THREE.Vector3(normalArr[0], normalArr[1], normalArr[2]).normalize();
    let u = (Math.abs(n.x) < 0.9) ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    u.sub(n.clone().multiplyScalar(n.dot(u))).normalize();   // project u into the plane
    const v = new THREE.Vector3().crossVectors(n, u).normalize();

    // 2D coordinates relative to centroid
    const p2 = pts.map(function(p) {
        const d = p.clone().sub(centroid);
        return [d.dot(u), d.dot(v)];
    });

    // PCA on the 2D points (covariance eigen-decomposition)
    let mx = 0, my = 0;
    for (const q of p2) { mx += q[0]; my += q[1]; }
    mx /= p2.length; my /= p2.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const q of p2) {
        const dx = q[0] - mx, dy = q[1] - my;
        sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    sxx /= p2.length; syy /= p2.length; sxy /= p2.length;
    const trace = sxx + syy;
    const disc = Math.sqrt(Math.max(0, (sxx - syy) * (sxx - syy) + 4 * sxy * sxy));
    const l1 = (trace + disc) / 2;
    // Principal-axis angle (eigenvector of largest eigenvalue)
    let theta;
    if (Math.abs(sxy) < 1e-9) {
        theta = (sxx >= syy) ? 0 : Math.PI / 2;
    } else {
        theta = Math.atan2(l1 - sxx, sxy);
    }
    const e1x = Math.cos(theta), e1y = Math.sin(theta);   // major axis (2D)
    const e2x = -e1y,       e2y = e1x;                     // minor axis (2D)

    // Semi-axes from the face footprint, then shrink inward so the oval
    // reads as an in-face placement marker instead of covering the whole face.
    let semi1 = 0, semi2 = 0;
    for (const q of p2) {
        const dx = q[0] - mx, dy = q[1] - my;
        const proj1 = Math.abs(dx * e1x + dy * e1y);
        const proj2 = Math.abs(dx * e2x + dy * e2y);
        if (proj1 > semi1) semi1 = proj1;
        if (proj2 > semi2) semi2 = proj2;
    }
    semi1 = Math.min(semi1 * FACE_OVAL_SHRINK, FACE_OVAL_MAX_RADIUS);
    semi2 = Math.min(semi2 * FACE_OVAL_SHRINK, FACE_OVAL_MAX_RADIUS);
    semi1 = Math.max(semi1, FACE_OVAL_MIN_RADIUS);
    semi2 = Math.max(semi2, FACE_OVAL_MIN_RADIUS);
    if (semi1 < 1e-4 || semi2 < 1e-4) return null;

    // Map 2D principal axes back to 3D
    const e1_3d = u.clone().multiplyScalar(e1x).add(v.clone().multiplyScalar(e1y));
    const e2_3d = u.clone().multiplyScalar(e2x).add(v.clone().multiplyScalar(e2y));

    // Build the ellipse as a triangle fan centered at centroid
    const SEG = 48;
    const positions = [centroid.x, centroid.y, centroid.z];
    for (let i = 0; i <= SEG; i++) {
        const a = (i / SEG) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        positions.push(
            centroid.x + e1_3d.x * semi1 * ca + e2_3d.x * semi2 * sa,
            centroid.y + e1_3d.y * semi1 * ca + e2_3d.y * semi2 * sa,
            centroid.z + e1_3d.z * semi1 * ca + e2_3d.z * semi2 * sa
        );
    }
    const indices = [];
    for (let i = 1; i <= SEG; i++) indices.push(0, i, i + 1);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({
        color: FACE_FILL_COLOR,
        transparent: true,
        opacity: 0.48,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData = {
        clusterIndex: clusterIndex,
        isClusterOverlay: true,
        normal: normalArr,
    };
    mesh.renderOrder = 1;

    // Offset along the face normal to avoid z-fighting
    const off = n.clone().multiplyScalar(0.8);
    mesh.position.copy(off);

    // Crisp outline (LineLoop) — improves visibility of the white fill on light models
    const outlinePts = [];
    for (let i = 0; i < SEG; i++) {
        const a = (i / SEG) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        outlinePts.push(
            centroid.x + off.x + e1_3d.x * semi1 * ca + e2_3d.x * semi2 * sa,
            centroid.y + off.y + e1_3d.y * semi1 * ca + e2_3d.y * semi2 * sa,
            centroid.z + off.z + e1_3d.z * semi1 * ca + e2_3d.z * semi2 * sa
        );
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(outlinePts, 3));
    const lineMat = new THREE.LineBasicMaterial({
        color: FACE_OUTLINE_COLOR, transparent: true, opacity: 0.95,
        depthTest: true, depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
    });
    const outline = new THREE.LineLoop(lineGeo, lineMat);
    mesh.userData.outline = outline;

    const label = _createClusterLabel(clusterIndex, centroid, n, Math.max(semi1, semi2));
    mesh.userData.label = label;

    return { mesh: mesh, outline: outline, label: label };
}

function _createClusterLabel(clusterIndex, centroid, normal, radius) {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    const labelText = String.fromCharCode(65 + (clusterIndex % 26));

    context.fillStyle = '#12313a';
    context.beginPath();
    context.arc(48, 48, 32, 0, Math.PI * 2);
    context.fill();
    context.lineWidth = 5;
    context.strokeStyle = '#dffeff';
    context.stroke();
    context.fillStyle = '#ffffff';
    context.font = 'bold 48px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(labelText, 48, 51);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
        map: texture,
        depthTest: true,
        depthWrite: false,
    });
    const label = new THREE.Sprite(material);
    const size = Math.max(5, Math.min(radius * 0.55, 14));
    label.position.copy(centroid).add(normal.clone().multiplyScalar(1.2));
    label.scale.set(size, size, 1);
    label.renderOrder = 2;
    label.userData.clusterLabel = true;
    return label;
}

/**
 * 在模型上渲染共面面簇高亮
 * @param {THREE.Object3D} parent - 模型容器（通常是 scene 或 mesh）
 * @param {Array} clusters - [{normal, face_vertices, ...}] 面簇数据
 * @param {Function} onClick - 点击回调 (clusterIndex) => void
 * @param {Function} onHover - 悬停回调 (clusterIndex, active) => void
 */
export function renderClusters(parent, clusters, onClick, onHover) {
    clearClusters();

    if (!parent || !clusters || clusters.length === 0) return;

    clusterHighlightGroup = new THREE.Group();
    parent.add(clusterHighlightGroup);

    // 获取模型变换偏移：后端顶点是原始坐标，Three.js 模型已 center() + sink Z=0
    const co = currentMeshCenterOffset || new THREE.Vector3(0,0,0);

    // 用 geometry 自身的局部包围盒计算 sinkZ，避免旋转后世界空间包围盒偏移
    // 模型经过 center() + translate(0,0,-minZ) 后，局部 Z min=0，
    // 局部 centerZ = model_height / 2，这就是面片坐标需要的 Z 偏移
    let sinkZ = 0;
    if (parent.geometry) {
        parent.geometry.computeBoundingBox();
        sinkZ = parent.geometry.boundingBox.getCenter(new THREE.Vector3()).z;
    }

    clusters.forEach((cluster, ci) => {
        const fv = cluster.face_vertices;
        if (!fv || fv.length < 3) return;

        // 顶点 = 原始坐标 - centerOffset + (0,0,sinkZ)
        const verts = [];
        for (const v of fv) {
            verts.push(v[0] - co.x, v[1] - co.y, v[2] - co.z + sinkZ);
        }
        if (verts.length < 9) return;

        // BambuSlicer 风格：面簇顶点投影到面平面 → PCA 主轴 → 椭圆 overlay
        const overlay = _buildEllipseOverlay(verts, cluster.normal, ci);
        if (!overlay) return;
        clusterHighlightGroup.add(overlay.mesh);
        if (overlay.outline) clusterHighlightGroup.add(overlay.outline);
        if (overlay.label) clusterHighlightGroup.add(overlay.label);
        clusterOverlays.push(overlay.mesh);
        setClusterHover(clusterOverlays.length - 1, false);
    });

    clusterMode = true;
    clusterClickCallback = onClick || null;
}

/**
 * 清除所有面簇高亮
 */
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
    clusterOverlays = [];
    clusterMode = false;
    clusterClickCallback = null;
}

/**
 * 设置/取消面簇上的悬停效果
 */
export function setClusterHover(index, active) {
    if (index < 0 || index >= clusterOverlays.length) return;
    const o = clusterOverlays[index];
    if (!o || !o.material) return;
    if (active) {
        o.material.color.setHex(FACE_HOVER_COLOR);
        o.material.opacity = 0.82;
        if (o.userData && o.userData.outline) {
            o.userData.outline.material.color.setHex(FACE_OUTLINE_HOVER_COLOR);
            o.userData.outline.material.opacity = 1.0;
        }
        if (o.userData && o.userData.label && o.userData.label.material) {
            o.userData.label.material.color.setHex(0x67e8f9);
        }
    } else {
        o.material.color.setHex(FACE_FILL_COLOR);
        o.material.opacity = 0.48;
        if (o.userData && o.userData.outline) {
            o.userData.outline.material.color.setHex(FACE_OUTLINE_COLOR);
            o.userData.outline.material.opacity = 0.95;
        }
        if (o.userData && o.userData.label && o.userData.label.material) {
            o.userData.label.material.color.setHex(0xffffff);
        }
    }
    o.material.needsUpdate = true;
    if (o.userData && o.userData.outline && o.userData.outline.material) {
        o.userData.outline.material.needsUpdate = true;
    }
}

/**
 * 检测射线是否击中面簇 Overlay
 * @param {THREE.Raycaster} raycaster
 * @returns {{ index: number, mesh: THREE.Mesh } | null}
 */
export function intersectClusters(raycaster, occluder = null) {
    if (!clusterMode || clusterOverlays.length === 0) return null;
    const intersects = raycaster.intersectObjects(clusterOverlays, false);
    if (intersects.length > 0) {
        const hit = intersects[0];
        // A ray can still intersect an overlay on the back of an opaque model.
        // Ignore it when the model is closer than the overlay so hover/click
        // behavior matches what the user can actually see.
        if (occluder) {
            const modelHit = raycaster.intersectObject(occluder, false)[0];
            if (modelHit && modelHit.distance < hit.distance - 0.01) return null;
        }
        const obj = hit.object;
        if (obj.userData && obj.userData.isClusterOverlay) {
            return { index: obj.userData.clusterIndex, mesh: obj };
        }
    }
    return null;
}

/**
 * 获取当前是否处于 Cluster 模式
 */
export function isClusterMode() {
    return clusterMode;
}

/**
 * 将模型的面旋转到打印底板上
 * @param {THREE.Mesh} mesh - 当前模型
 * @param {Array} normal - [nx, ny, nz] 面的法向量
 * @param {string} upAxis - 'Z' (Three.js Z-up) 或 'Y' (Three.js Y-up)
 */
function _getFaceWorldMinZ(mesh, faceVertices) {
    if (!mesh || !Array.isArray(faceVertices) || faceVertices.length < 3) return null;

    const co = currentMeshCenterOffset || new THREE.Vector3(0, 0, 0);
    let sinkZ = 0;
    if (mesh.geometry) {
        mesh.geometry.computeBoundingBox();
        sinkZ = mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).z;
    }

    let minZ = Infinity;
    const point = new THREE.Vector3();
    for (const vertex of faceVertices) {
        if (!Array.isArray(vertex) || vertex.length < 3) continue;
        point.set(vertex[0] - co.x, vertex[1] - co.y, vertex[2] - co.z + sinkZ);
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
        const modelBox = new THREE.Box3().setFromObject(mesh);
        const faceMinZ = _getFaceWorldMinZ(mesh, faceVertices);
        const gap = faceMinZ === null ? 0 : Math.max(0, faceMinZ - modelBox.min.z);
        if (gap < bestGap) {
            bestGap = gap;
            bestQuat = candidateQuat;
        }
    }
    mesh.quaternion.copy(bestQuat || new THREE.Quaternion());

    // Pin the chosen face itself to Z=0. Falling back to the overall bounding
    // box keeps placement safe when face vertices are unavailable.
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    const faceMinZ = _getFaceWorldMinZ(mesh, faceVertices);
    mesh.position.z -= faceMinZ === null ? box.min.z : faceMinZ;

    // A malformed/non-planar face must never leave any model geometry below bed.
    mesh.updateMatrixWorld(true);
    const settledBox = new THREE.Box3().setFromObject(mesh);
    if (settledBox.min.z < -0.001) mesh.position.z -= settledBox.min.z;

    // X/Y 居中到热床中心（与 orientation-ui.js centerModel() 逻辑一致）
    mesh.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(mesh);
    const center = box2.getCenter(new THREE.Vector3());
    const bc = window._BED_CENTER || 128;
    mesh.position.x += (bc - center.x);
    mesh.position.y += (bc - center.y);
    mesh.updateMatrixWorld(true);

    // 重新适配相机视角
    try { fitCameraToMesh(mesh); } catch(e) { /* ignore */ }
}
