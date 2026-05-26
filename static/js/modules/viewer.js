// ── Three.js 3D Viewer ──
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { getRenderColorHex } from './state.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export let scene, camera, renderer, controls, stlLoader, currentMesh, currentMeshCenterOffset = null;
let _initialMeshPos = null;
let previewContainer, previewPlaceholder;
let initialised = false;

let faceClickCallback = null;
let raycaster = null;
let mouse = new THREE.Vector2();
let highlightGroup = null;
let highlightMode = false;

export function initViewer(previewContainerEl, previewPlaceholderEl) {
    previewContainer = previewContainerEl;
    previewPlaceholder = previewPlaceholderEl;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    camera = new THREE.PerspectiveCamera(45, previewContainer.clientWidth / previewContainer.clientHeight, 0.1, 10000);
    camera.position.set(0, 0, 120);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(previewContainer.clientWidth, previewContainer.clientHeight);
    previewContainer.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    raycaster = new THREE.Raycaster();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(80, 80, 120);
    scene.add(dirLight);

    const BED_SIZE = 256;
    const BED_HALF = BED_SIZE / 2; // 128

    // 打印底板网格：左下角 (0,0,0)，尺寸 256×256
    const gridHelper = new THREE.GridHelper(BED_SIZE, 32, 0x334155, 0x1e293b);
    gridHelper.rotation.x = Math.PI / 2;
    gridHelper.position.set(BED_HALF, BED_HALF, 0);
    scene.add(gridHelper);

    // 底板半透明平面
    const bedGeo = new THREE.PlaneGeometry(BED_SIZE, BED_SIZE);
    const bedMat = new THREE.MeshStandardMaterial({
        color: 0xeef2ff,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
    });
    const bedPlane = new THREE.Mesh(bedGeo, bedMat);
    bedPlane.position.set(BED_HALF, BED_HALF, 0);
    scene.add(bedPlane);

    // 坐标轴（原点 = 网格左下角，带箭头）
    const axLen = 40;
    scene.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), axLen, 0xff4444));
    scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), axLen, 0x44ff44));
    scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), axLen, 0x4488ff));

    // 打印平面中心位置常量（供所有加载函数使用）
    window._BED_CENTER = BED_HALF;

    renderer.domElement.addEventListener('click', (event) => {
        if (!currentMesh) return;
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        // Lay on Face cluster 命中检测（通过全局回调）— 需在 faceClickCallback 检查之前
        if (typeof window.__onLayFaceClick === 'function') {
            if (window.__onLayFaceClick(raycaster)) return;
        }
        if (!faceClickCallback) return;
        if (highlightMode && highlightGroup && highlightGroup.children.length > 0) {
            const intersects = raycaster.intersectObjects(highlightGroup.children, false);
            if (intersects.length > 0) {
                const hit = intersects[0];
                const localNormal = hit.object.userData.normal;
                if (localNormal) {
                    const n = new THREE.Vector3(localNormal[0], localNormal[1], localNormal[2]);
                    const normalMatrix = new THREE.Matrix3().getNormalMatrix(currentMesh.matrixWorld);
                    const worldNormal = n.applyMatrix3(normalMatrix).normalize();
                    faceClickCallback(worldNormal);
                }
                return;
            }
            return;
        }
        const intersects = raycaster.intersectObject(currentMesh, false);
        if (intersects.length > 0) {
            const hit = intersects[0];
            const normalLocal = hit.face.normal.clone();
            const normalMatrix = new THREE.Matrix3().getNormalMatrix(currentMesh.matrixWorld);
            const normalWorld = normalLocal.applyMatrix3(normalMatrix).normalize();
            faceClickCallback(normalWorld);
        }
    });

    stlLoader = new STLLoader();
    initialised = true;

    function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }
    animate();
}

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

export function clearCurrentMesh() {
    if (!currentMesh) return;
    scene.remove(currentMesh);
    if (currentMesh.type === 'Group') {
        currentMesh.traverse(c => {
            if (c.isMesh) {
                if (c.geometry) c.geometry.dispose();
                if (c.material) c.material.dispose();
            }
        });
    } else {
        if (currentMesh.geometry) currentMesh.geometry.dispose();
        if (currentMesh.material) currentMesh.material.dispose();
    }
    currentMesh = null;
}


async function renderViaGLB(file) {
    const formData = new FormData();
    formData.append('file', file);
    try {
        const resp = await fetch('/api/preview/glb', { method: 'POST', body: formData });
        if (!resp.ok) throw new Error('GLB conversion failed');
        const glbBlob = await resp.blob();
        const url = URL.createObjectURL(glbBlob);
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(url);
        URL.revokeObjectURL(url);

        const model = gltf.scene;
        model.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
        // 自适应缩放 + 居中
        model.updateMatrixWorld(true);
        let box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        let scale = 1;
        if (maxDim > 0) {
            scale = 100 / maxDim;
            const center = box.getCenter(new THREE.Vector3());
            model.scale.setScalar(scale);
            model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
        }
        // 居中到网格 (BED_HALF, BED_HALF, 0) + 下沉到 Z=0
        model.updateMatrixWorld(true);
        box = new THREE.Box3().setFromObject(model);
        const boxCenter = box.getCenter(new THREE.Vector3());
        const bc = window._BED_CENTER || 128;
        const sink = new THREE.Vector3(bc - boxCenter.x, bc - boxCenter.y, -box.min.z);
        model.position.add(sink);

        currentMeshCenterOffset = new THREE.Vector3(0, 0, 0);
        _initialMeshPos = model.position.clone();

        clearCurrentMesh();
        currentMesh = model;
        scene.add(currentMesh);
        fitCameraToMesh(currentMesh);
        previewPlaceholder.classList.add('hidden');
        return true;
    } catch (e) {
        console.warn('GLB render failed:', e);
        return false;
    }
}

export function renderSTL(file, colorKey = 'Blue') {
    if (!file || !(file instanceof Blob) || file.size === 0) {
        previewPlaceholder.textContent = '文件无效或为空，请重新上传';
        previewPlaceholder.classList.remove('hidden');
        return;
    }
    const ext = file.name && file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
    if (ext !== 'stl') {
        // 为 3MF/OBJ/STP 通过后端转为 GLB 预览
        clearCurrentMesh();
        renderViaGLB(file).then(ok => {
            if (!ok) {
                previewPlaceholder.innerHTML = '<div style="text-align:center;padding-top:20%"><div style="font-size:4rem;margin-bottom:1rem">📦</div><p style="color:#64748b">' + ext.toUpperCase() + ' 预览失败</p><p style="color:#94a3b8;font-size:0.8rem">上传后将自动切片报价</p></div>';
                previewPlaceholder.classList.remove('hidden');
            }
        });
        return;
    }
    const reader = new FileReader();
    reader.onloadstart = () => {
        previewPlaceholder.textContent = '读取中...';
    };
    reader.onerror = () => {
        previewPlaceholder.textContent = '文件读取失败，请重新上传';
        previewPlaceholder.classList.remove('hidden');
    };
    reader.onload = (event) => {
        try {
            const geometry = stlLoader.parse(event.target.result);
            geometry.computeVertexNormals();
            geometry.computeBoundingBox();
            const centerOffset = new THREE.Vector3();
            geometry.boundingBox.getCenter(centerOffset);
            currentMeshCenterOffset = centerOffset;
            geometry.center();
            // Move model above print bed: lowest point at Z=0
            geometry.computeBoundingBox();
            geometry.translate(0, 0, -geometry.boundingBox.min.z);
            clearCurrentMesh();
            const material = new THREE.MeshStandardMaterial({
                color: getRenderColorHex(colorKey), metalness: 0.15, roughness: 0.65,
            });
            currentMesh = new THREE.Mesh(geometry, material);
            currentMesh.rotation.set(0, 0, 0);
            // 模型在打印平面居中
            const bc = window._BED_CENTER || 128;
            currentMesh.position.set(bc, bc, 0);
            _initialMeshPos = currentMesh.position.clone();
            scene.add(currentMesh);
            fitCameraToMesh(currentMesh);
            previewPlaceholder.classList.add('hidden');
        } catch (e) {
            previewPlaceholder.textContent = '预览失败，请确认 STL 文件有效';
            previewPlaceholder.classList.remove('hidden');
        }
    };
    reader.readAsArrayBuffer(file);
}

export function buildPlaceholderThumbnail(ext) {
    const label = (ext || 'file').toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#f8fafc"/>
        </linearGradient></defs>
        <rect width="200" height="120" rx="8" fill="url(#g)"/>
        <rect x="12" y="12" width="176" height="96" rx="6" fill="none" stroke="#cbd5e1"/>
        <text x="100" y="62" text-anchor="middle" fill="#334155" font-size="18" font-family="Arial,sans-serif" font-weight="700">${label}</text>
        <text x="100" y="84" text-anchor="middle" fill="#64748b" font-size="11" font-family="Arial,sans-serif">Static Preview</text>
    </svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function applyOrientationRotation(data) {
    if (!currentMesh) return;
    var euler = data.euler || data;
    currentMesh.rotation.x = THREE.MathUtils.degToRad(euler.x || 0);
    currentMesh.rotation.y = THREE.MathUtils.degToRad(euler.y || 0);
    currentMesh.rotation.z = THREE.MathUtils.degToRad(euler.z || 0);
    // Compute world-space bounding box and lift bottom to Z=0
    currentMesh.updateMatrixWorld();
    var box = new THREE.Box3().setFromObject(currentMesh);
    currentMesh.position.z -= box.min.z;
}

export function resetOrientation() {
    if (!currentMesh) return;
    currentMesh.rotation.set(0, 0, 0);
    if (_initialMeshPos) {
        currentMesh.position.copy(_initialMeshPos);
    }
    // 下沉到 Z=0
    currentMesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(currentMesh);
    currentMesh.position.z -= box.min.z;
}

export function updateViewerSize() {
    if (!renderer || !previewContainer) return;
    camera.aspect = previewContainer.clientWidth / previewContainer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(previewContainer.clientWidth, previewContainer.clientHeight);
}

export function setupFaceClickHandler(callback) {
    faceClickCallback = callback || null;
}

const FACES_COLORS = [0x22c55e, 0x3b82f6, 0xa855f7, 0xeab308, 0xf97316, 0xec4899];

export function highlightFaces(faces) {
    resetHighlight();
    if (!currentMesh || !faces || faces.length === 0) return;
    if (!currentMeshCenterOffset) return;
    highlightGroup = new THREE.Group();
    currentMesh.add(highlightGroup);
    highlightMode = true;
    for (let i = 0; i < faces.length; i++) {
        const face = faces[i];
        const verts = face.vertices;
        const color = FACES_COLORS[i % FACES_COLORS.length];
        const n = verts ? verts.length : 0;
        if (n < 3) continue;
        const v0 = new THREE.Vector3(verts[0][0] - currentMeshCenterOffset.x, verts[0][1] - currentMeshCenterOffset.y, verts[0][2] - currentMeshCenterOffset.z);
        for (let j = 1; j < n - 1; j++) {
            const v1 = new THREE.Vector3(verts[j][0] - currentMeshCenterOffset.x, verts[j][1] - currentMeshCenterOffset.y, verts[j][2] - currentMeshCenterOffset.z);
            const v2 = new THREE.Vector3(verts[j+1][0] - currentMeshCenterOffset.x, verts[j+1][1] - currentMeshCenterOffset.y, verts[j+1][2] - currentMeshCenterOffset.z);
            const triGeom = new THREE.BufferGeometry();
            const arr = new Float32Array([v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z]);
            triGeom.setAttribute('position', new THREE.BufferAttribute(arr, 3));
            const mat = new THREE.MeshBasicMaterial({
                color: color,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.75,
                depthTest: true,
                depthWrite: false,
            });
            const triMesh = new THREE.Mesh(triGeom, mat);
            triMesh.userData.normal = face.normal;
            highlightGroup.add(triMesh);
        }
    }
}

export function resetHighlight() {
    if (highlightGroup) {
        highlightGroup.traverse(function(child) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        if (currentMesh) currentMesh.remove(highlightGroup);
        highlightGroup = null;
    }
    highlightMode = false;
}
