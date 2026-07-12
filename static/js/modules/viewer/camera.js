// ── Three.js 3D Viewer — Camera Module ──
import * as THREE from 'three';
import { camera, controls, scene } from './scene.js';

export function fitCameraToMesh(meshObject) {
    const box = new THREE.Box3().setFromObject(meshObject);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    cameraZ *= 1.6;
    camera.position.set(center.x, center.y, center.z + cameraZ);
    camera.near = Math.max(maxDim / 100, 0.1);
    camera.far = Math.max(maxDim * 20, 1000);
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
}

/**
 * 将相机平滑移动到指定视角方向
 * @param {string} view - 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right'
 * @param {THREE.Object3D} meshObject - 模型对象（用于计算中心）
 */
export function lookAtView(view, meshObject) {
    if (!meshObject || !camera || !controls) return;
    meshObject.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(meshObject);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const dist = maxDim * 1.8;

    // 打印床 XY 平面，Z 为高度。相机方向 = 从该方向看向模型中心
    const dirs = {
        front:  new THREE.Vector3( 0,  1,  0),
        back:   new THREE.Vector3( 0, -1,  0),
        top:    new THREE.Vector3( 0,  0,  1),
        bottom: new THREE.Vector3( 0,  0, -1),
        right:  new THREE.Vector3( 1,  0,  0),
        left:   new THREE.Vector3(-1,  0,  0),
    };
    const dir = dirs[view];
    if (!dir) return;

    const target = center.clone();
    const targetCam = center.clone().add(dir.clone().multiplyScalar(dist));
    // 对于 top/bottom 视角，相机 up 需要水平（+Y），否则会万向节锁
    const targetUp = new THREE.Vector3(0, 0, 1);
    if (view === 'top' || view === 'bottom') {
        targetUp.set(0, 1, 0);
    }

    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const startUp = camera.up.clone();
    const duration = 350; // ms
    const start = performance.now();

    function animate(now) {
        const t = Math.min((now - start) / duration, 1.0);
        // easeInOutCubic
        const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        camera.position.lerpVectors(startPos, targetCam, ease);
        controls.target.lerpVectors(startTarget, target, ease);
        camera.up.lerpVectors(startUp, targetUp, ease);
        controls.update();
        if (t < 1.0) {
            requestAnimationFrame(animate);
        }
    }
    requestAnimationFrame(animate);
}
