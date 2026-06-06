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

const FACE_COLORS = [
    0xff6b6b, 0x4ecdc4, 0x45b7d1, 0xf9ca24, 0xa55eea,
    0x26de81, 0xfd9644, 0xeb3b5a, 0x2bcbba, 0xfc5c65,
    0x45aaf2, 0xa9e34b, 0xff922b, 0x748ffc, 0x20c997,
];

let clusterOverlays = [];       // 高亮 Mesh 数组
let clusterClickCallback = null; // 点击回调
let clusterHighlightGroup = null;
let clusterMode = false;        // 当前是否处于 Cluster 模式

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

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geo.computeVertexNormals();

        const color = FACE_COLORS[ci % FACE_COLORS.length];
        const mat = new THREE.MeshStandardMaterial({
            color,
            transparent: true,
            opacity: 0.35,
            side: THREE.DoubleSide,
            depthTest: true,
            depthWrite: false,
            emissive: color,
            emissiveIntensity: 0.2,
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData = {
            clusterIndex: ci,
            isClusterOverlay: true,
            normal: cluster.normal,
        };
        mesh.renderOrder = 1;

        // 沿法向量微偏移避免 z-fighting
        const off = new THREE.Vector3(cluster.normal[0], cluster.normal[1], cluster.normal[2])
            .multiplyScalar(0.3);
        mesh.position.copy(off);

        clusterHighlightGroup.add(mesh);
        clusterOverlays.push(mesh);
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
    } else {
        o.material.opacity = 0.35;
        o.material.emissiveIntensity = 0.2;
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

    // 贴合到底板 Z=0
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    mesh.position.z -= box.min.z;

    // 重新适配相机视角
    try { fitCameraToMesh(mesh); } catch(e) { /* ignore */ }
}
