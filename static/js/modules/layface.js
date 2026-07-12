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
import { currentMeshCenterOffset, fitCameraToMesh, scene } from './viewer.js';

// Unified white highlight color for BambuSlicer-style oval overlays
const FACE_COLORS = 0xffffff;

let clusterOverlays = [];       // 高亮 Mesh 数组
let clusterClickCallback = null; // 点击回调
let clusterHighlightGroup = null;
let clusterMode = false;        // 当前是否处于 Cluster 模式

// ── 可放置平面（placeable plane）视觉 ──
let _placeablePlaneGroup = null;

// 偏移常量（单位：mm）
const PLANE_OUTER_OFFSET = 3;   // 外置偏移
const PLANE_PARALLEL_OFFSET = 2; // 平面平行方向偏移
const PLANE_TOTAL_OFFSET = PLANE_OUTER_OFFSET + PLANE_PARALLEL_OFFSET; // 5mm

/**
 * 在打印底板 Z=0 处创建高亮可放置平面
 * 平面大小基于点击选中的面簇顶点投影到 Z=0 的区域，加上偏移量
 *
 * @param {THREE.Object3D} mesh - 已放置的模型
 * @param {Array} faceVertices - 面簇顶点 [[x,y,z], ...]（模型局部坐标）
 *
 * 规则：
 *  - 模型主体只能位于平面 Z+ 一侧
 *  - 平面根据实际贴合面的投影最大区域，外置偏移 3mm + 平行偏移 2mm
 *  - Z+ 侧（模型侧）绿色标记，Z- 侧（空白侧）蓝色标记
 */
function _createPlaceablePlane(mesh, faceVertices) {
    _removePlaceablePlane();
    if (!mesh) return;
    if (!faceVertices || faceVertices.length < 3) {
        // 降级：用模型包围盒
        mesh.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(mesh);
        return _createPlaneFromBox(mesh, box);
    }

    // 面簇顶点来自后端 API（原始 STL 坐标），需先转换到 mesh 局部坐标
    // （减去中心化偏移 + 加上下沉偏移），再通过 worldMatrix 变换到世界坐标
    // 此逻辑必须与 renderClusters() 中的顶点变换保持一致
    mesh.updateMatrixWorld(true);
    const worldMatrix = mesh.matrixWorld;
    const tmp = new THREE.Vector3();

    // 计算 sinkZ（与 renderClusters 一致）
    const co = currentMeshCenterOffset || new THREE.Vector3(0, 0, 0);
    let sinkZ = 0;
    if (mesh.geometry) {
        mesh.geometry.computeBoundingBox();
        sinkZ = mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).z;
    }

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const v of faceVertices) {
        // Step 1: 原始坐标 → mesh 局部坐标（与 renderClusters 一致）
        tmp.set(v[0] - co.x, v[1] - co.y, v[2] - co.z + sinkZ);
        // Step 2: 局部坐标 → 世界坐标
        tmp.applyMatrix4(worldMatrix);
        // 投影到 Z=0（只取 XY）
        if (tmp.x < minX) minX = tmp.x;
        if (tmp.x > maxX) maxX = tmp.x;
        if (tmp.y < minY) minY = tmp.y;
        if (tmp.y > maxY) maxY = tmp.y;
    }

    // 若顶点投影后落在 Z<0，强制推回模型
    mesh.updateMatrixWorld(true);
    const meshBox = new THREE.Box3().setFromObject(mesh);
    if (meshBox.min.z < 0) {
        mesh.position.z -= meshBox.min.z;
        mesh.updateMatrixWorld(true);
    }

    _buildPlaceablePlaneVisual(mesh, minX, maxX, minY, maxY);
}

/**
 * 降级方案：基于模型世界包围盒构建可放置平面
 */
function _createPlaneFromBox(mesh, box) {
    const min = box.min;
    const max = box.max;
    if (min.z < 0) {
        mesh.position.z -= min.z;
        mesh.updateMatrixWorld(true);
        box.setFromObject(mesh);
    }
    _buildPlaceablePlaneVisual(mesh, min.x, max.x, min.y, max.y);
}

/**
 * 构建可放置平面视觉元素
 */
function _buildPlaceablePlaneVisual(mesh, minX, maxX, minY, maxY) {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const halfW = (maxX - minX) / 2;
    const halfH = (maxY - minY) / 2;
    const planeW = (halfW + PLANE_TOTAL_OFFSET) * 2;
    const planeH = (halfH + PLANE_TOTAL_OFFSET) * 2;

    _placeablePlaneGroup = new THREE.Group();

    // Z+ 侧（模型侧）—— 半透明绿色
    const geoTop = new THREE.PlaneGeometry(planeW, planeH);
    const matTop = new THREE.MeshBasicMaterial({
        color: 0x4ade80, transparent: true, opacity: 0.15,
        side: THREE.FrontSide, depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
    });
    const topMesh = new THREE.Mesh(geoTop, matTop);
    topMesh.position.set(cx, cy, 0);
    topMesh.rotation.x = -Math.PI / 2;
    _placeablePlaneGroup.add(topMesh);

    // Z- 侧（空白侧）—— 半透明蓝色
    const geoBottom = new THREE.PlaneGeometry(planeW, planeH);
    const matBottom = new THREE.MeshBasicMaterial({
        color: 0x60a5fa, transparent: true, opacity: 0.10,
        side: THREE.BackSide, depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
    });
    const bottomMesh = new THREE.Mesh(geoBottom, matBottom);
    bottomMesh.position.set(cx, cy, 0);
    bottomMesh.rotation.x = -Math.PI / 2;
    _placeablePlaneGroup.add(bottomMesh);

    // 绿色边框
    const edgesGeo = new THREE.EdgesGeometry(geoTop);
    const lineMat = new THREE.LineBasicMaterial({
        color: 0x4ade80, transparent: true, opacity: 0.35,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
    });
    const borderLine = new THREE.LineSegments(edgesGeo, lineMat);
    borderLine.position.set(cx, cy, 0);
    borderLine.rotation.x = -Math.PI / 2;
    _placeablePlaneGroup.add(borderLine);

    // Z+ 方向箭头（绿色朝上）
    const arrowPos = new THREE.Vector3(cx, cy - halfH - PLANE_TOTAL_OFFSET - 6, 0);
    _placeablePlaneGroup.add(new THREE.ArrowHelper(
        new THREE.Vector3(0, 0, 1), arrowPos, 8, 0x22c55e, 3, 2));
    // Z- 方向箭头（蓝色朝下）
    _placeablePlaneGroup.add(new THREE.ArrowHelper(
        new THREE.Vector3(0, 0, -1), arrowPos.clone().add(new THREE.Vector3(0, -6, 0)),
        5, 0x60a5fa, 2, 1.5));

    scene.add(_placeablePlaneGroup);
}

function _removePlaceablePlane() {
    if (_placeablePlaneGroup) {
        _placeablePlaneGroup.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        scene.remove(_placeablePlaneGroup);
        _placeablePlaneGroup = null;
    }
}

export function showPlacementPlane(mesh, faceVertices) { _createPlaceablePlane(mesh, faceVertices); }
export function hidePlacementPlane() { _removePlaceablePlane(); }
export function hasPlacementPlane() { return _placeablePlaneGroup !== null; }
window.__cleanupPlaceablePlane = hidePlacementPlane;

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
 * @returns {{mesh: THREE.Mesh, outline: THREE.LineLoop} | null}
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

    // Semi-axes = max projection magnitude along each principal axis (bounds all points)
    let semi1 = 0, semi2 = 0;
    for (const q of p2) {
        const dx = q[0] - mx, dy = q[1] - my;
        const proj1 = Math.abs(dx * e1x + dy * e1y);
        const proj2 = Math.abs(dx * e2x + dy * e2y);
        if (proj1 > semi1) semi1 = proj1;
        if (proj2 > semi2) semi2 = proj2;
    }
    semi1 *= 1.08; semi2 *= 1.08;   // small padding so the oval clearly surrounds the face
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

    const mat = new THREE.MeshStandardMaterial({
        color: FACE_COLORS,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
        metalness: 0.0,
        roughness: 0.6,
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
    const off = n.clone().multiplyScalar(0.3);
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
        color: FACE_COLORS, transparent: true, opacity: 0.9,
        depthTest: true, depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
    });
    const outline = new THREE.LineLoop(lineGeo, lineMat);
    mesh.userData.outline = outline;

    return { mesh: mesh, outline: outline };
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
        clusterOverlays.push(overlay.mesh);
    });

    clusterMode = true;
    clusterClickCallback = onClick || null;
}

/**
 * 清除所有面簇高亮
 */
export function clearClusters() {
    // 同时清理可放置平面
    _removePlaceablePlane();

    if (clusterHighlightGroup && clusterHighlightGroup.parent) {
        clusterHighlightGroup.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
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
        o.material.opacity = 0.85;
        o.material.emissiveIntensity = 1.2;
        if (o.userData && o.userData.outline) o.userData.outline.material.opacity = 1.0;
    } else {
        o.material.opacity = 0.35;
        o.material.emissiveIntensity = 0.2;
        if (o.userData && o.userData.outline) o.userData.outline.material.opacity = 0.6;
    }
}

/**
 * 检测射线是否击中面簇 Overlay
 * @param {THREE.Raycaster} raycaster
 * @returns {{ index: number, mesh: THREE.Mesh } | null}
 */
export function intersectClusters(raycaster) {
    if (!clusterMode || clusterOverlays.length === 0) return null;
    const intersects = raycaster.intersectObjects(clusterOverlays, false);
    if (intersects.length > 0) {
        const obj = intersects[0].object;
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
export function placeFaceOnBed(mesh, normal, upAxis = 'Z') {
    if (!mesh) return;

    const n = new THREE.Vector3(normal[0], normal[1], normal[2]).normalize();

    // -normal 应对齐到 Z+（Three.js Z-up 约定）
    const targetDir = n.clone().negate();
    const up = new THREE.Vector3(0, 0, 1);

    const targetQuat = new THREE.Quaternion().setFromUnitVectors(targetDir, up);
    mesh.quaternion.copy(targetQuat);

    // 贴合到底板 Z=0，确保模型全部位于可放置平面（Z=0）的 Z+ 一侧
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    mesh.position.z -= box.min.z;

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
