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

// Bed (print platform) references — for dynamic bed size updates
let _bedGrid = null;
let _bedPlane = null;
let _bedAxes = [];
let _pendingBedSize = null;  // {width, depth} queued before initViewer finishes
let _bedLabel = null;            // DOM overlay (top-right) showing bed W×D×H
let _bedDims = { w: 256, d: 256, h: 256 };

// Recolor fast-path cache: skip re-parsing STL/GLB when only the color changes
let _lastRenderedFileKey = null;
let _lastRenderedColorKey = null;
let _lastRenderedOrientation = null;

// Mobile touch state
let _isMobile = false;
let _touchStartTime = 0;
let _touchMoved = false;
let _gestureHintShown = false;
let _lastPinchDist = 0;
let _renderRequested = true;  // dirty flag for on-demand rendering

/** Remove existing bed elements from scene and dispose their GPU resources. */
function _removeBed() {
    if (_bedGrid) {
        scene.remove(_bedGrid);
        if (_bedGrid.geometry) _bedGrid.geometry.dispose();
        if (_bedGrid.material) {
            if (Array.isArray(_bedGrid.material)) _bedGrid.material.forEach(function(m) { m.dispose(); });
            else _bedGrid.material.dispose();
        }
        _bedGrid = null;
    }
    if (_bedPlane) {
        scene.remove(_bedPlane);
        if (_bedPlane.geometry) _bedPlane.geometry.dispose();
        if (_bedPlane.material) _bedPlane.material.dispose();
        _bedPlane = null;
    }
    for (var i = 0; i < _bedAxes.length; i++) {
        scene.remove(_bedAxes[i]);
        if (_bedAxes[i].dispose) _bedAxes[i].dispose();
    }
    _bedAxes = [];
}

/**
 * Create the print bed (grid + plane + origin axes) with the given dimensions.
 * Left-bottom corner sits at world origin (0, 0, 0).
 * @param {number} width - bed width in mm (X axis)
 * @param {number} depth - bed depth in mm (Y axis)
 */
function _createBed(width, depth) {
    _removeBed();
    var w = Number(width) || 256;
    var d = Number(depth) || 256;
    var maxDim = Math.max(w, d);
    var divisions = Math.max(2, Math.round(maxDim / 8));  // ~8mm per cell

    // Grid: GridHelper is square (maxDim x maxDim), scaled to actual w x d
    _bedGrid = new THREE.GridHelper(maxDim, divisions, 0x334155, 0x1e293b);
    _bedGrid.rotation.x = Math.PI / 2;
    _bedGrid.scale.set(w / maxDim, d / maxDim, 1);
    _bedGrid.position.set(w / 2, d / 2, 0);
    scene.add(_bedGrid);

    // Semi-transparent bed plane
    var bedGeo = new THREE.PlaneGeometry(w, d);
    var bedMat = new THREE.MeshStandardMaterial({
        color: 0xeef2ff,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
    });
    _bedPlane = new THREE.Mesh(bedGeo, bedMat);
    _bedPlane.position.set(w / 2, d / 2, 0);
    scene.add(_bedPlane);

    // Origin axes (fixed length — do not scale with bed)
    var axLen = 40;
    _bedAxes = [
        new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), axLen, 0xff4444),
        new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), axLen, 0x44ff44),
        new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), axLen, 0x4488ff),
    ];
    for (var k = 0; k < _bedAxes.length; k++) scene.add(_bedAxes[k]);

    // Bed center used by renderSTL / placeFaceOnBed for model centering
    window._BED_CENTER = w / 2;
}

/**
 * Update the 3D viewer bed to match a printer's build volume.
 * Safe to call before initViewer — the size is queued and applied during init.
 * @param {number} width - bed width in mm
 * @param {number} depth - bed depth in mm
 */
export function updateBedSize(width, depth) {
    // Update the text overlay immediately (even before init) so the UI reflects the selection
    setBedLabel(width, depth, null);
    if (!initialised || !scene) {
        _pendingBedSize = { width: width, depth: depth };
        return;
    }
    _createBed(width, depth);
    requestRender();
}

function _formatBedLabel(w, d, h) {
    return Math.round(w) + ' × ' + Math.round(d) + ' × ' + Math.round(h) + ' mm';
}

/**
 * Update the bed-dimensions overlay (top-right of the 3D preview canvas).
 * @param {number} w - bed width in mm
 * @param {number} d - bed depth in mm
 * @param {number|null} h - bed height in mm; pass null to keep the previous value
 */
export function setBedLabel(w, d, h) {
    _bedDims.w = Number(w) || _bedDims.w;
    _bedDims.d = Number(d) || _bedDims.d;
    if (h != null) _bedDims.h = Number(h) || _bedDims.h;
    if (_bedLabel) _bedLabel.textContent = _formatBedLabel(_bedDims.w, _bedDims.d, _bedDims.h);
}

/**
 * Resolve a colorKey (hex string, bare name, or object) to a Three.js hex number.
 * Handles the fallback object returned by getRenderColorHex for bare names.
 * @param {*} colorKey - hex string like "#ff0000", bare name like "Blue", or null
 * @returns {number} hex color number usable by THREE.MeshStandardMaterial
 */
function _colorNumFromKey(colorKey) {
    var r = getRenderColorHex(colorKey);
    if (typeof r === 'number') return r;
    if (r && typeof r === 'object' && r.fallback) {
        var c = new THREE.Color();
        c.setHSL(r.hue / 360, 0.58, 0.56);
        return c.getHex();
    }
    return 0x3b82f6;  // default blue
}

function _orientationEqual(a, b) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return ((a.x || 0) === (b.x || 0) && (a.y || 0) === (b.y || 0) && (a.z || 0) === (b.z || 0));
}

/**
 * Recolor the currently-loaded mesh without re-parsing the source file.
 * Fast path used when only the color changed (same file + orientation).
 * @param {*} colorKey - hex string / bare name / null
 * @returns {boolean} true if a mesh was recolored, false if no mesh is loaded
 */
export function recolorCurrentMesh(colorKey) {
    if (!currentMesh) return false;
    const colorNum = _colorNumFromKey(colorKey);
    currentMesh.traverse(function(c) {
        if (c.isMesh && c.material && c.material.color) {
            c.material.color.setHex(colorNum);
            c.material.needsUpdate = true;
        }
    });
    _lastRenderedColorKey = colorKey;
    requestRender();
    return true;
}

export function initViewer(previewContainerEl, previewPlaceholderEl) {
    previewContainer = previewContainerEl;
    previewPlaceholder = previewPlaceholderEl;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    camera = new THREE.PerspectiveCamera(45, previewContainer.clientWidth / previewContainer.clientHeight, 0.1, 10000);
    camera.position.set(0, 0, 120);

    // Adaptive pixel ratio: cap at 2 on mobile to reduce GPU load
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    _isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    renderer = new THREE.WebGLRenderer({ antialias: !_isMobile, powerPreference: 'high-performance' });
    renderer.setPixelRatio(dpr);
    renderer.setSize(previewContainer.clientWidth, previewContainer.clientHeight);
    previewContainer.appendChild(renderer.domElement);

    // Bed-size overlay (top-right of the preview canvas)
    if (getComputedStyle(previewContainer).position === 'static') {
        previewContainer.style.position = 'relative';
    }
    _bedLabel = document.createElement('div');
    _bedLabel.className = 'bed-size-label';
    _bedLabel.style.cssText = 'position:absolute;top:8px;right:10px;z-index:20;background:rgba(255,255,255,0.8);color:#334155;font-size:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;padding:3px 7px;border-radius:6px;border:1px solid #cbd5e1;pointer-events:none;line-height:1.35;letter-spacing:0.02em;';
    _bedLabel.textContent = _formatBedLabel(_bedDims.w, _bedDims.d, _bedDims.h);
    previewContainer.appendChild(_bedLabel);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    // Mobile touch optimization
    if (_isMobile) {
        controls.rotateSpeed = 0.5;          // slower rotation for precision
        controls.panSpeed = 0.6;
        controls.zoomSpeed = 1.2;
        controls.minDistance = 20;            // prevent zooming too close
        controls.maxDistance = 2000;          // prevent zooming too far
        controls.touches = {
            ONE: THREE.TOUCH.ROTATE,
            TWO: THREE.TOUCH.DOLLY_PAN,
        };
        // Reduce damping on mobile for snappier feel
        controls.dampingFactor = 0.12;

        // Track touch movement to distinguish tap vs drag
        renderer.domElement.addEventListener('touchstart', (e) => {
            _touchStartTime = Date.now();
            _touchMoved = false;
            if (e.touches.length === 2) {
                // Track initial pinch distance
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                _lastPinchDist = Math.sqrt(dx * dx + dy * dy);
            }
            requestRender();
        }, { passive: true });

        renderer.domElement.addEventListener('touchmove', (e) => {
            _touchMoved = true;
            requestRender();
        }, { passive: true });

        // Show gesture hint on first load
        if (!_gestureHintShown) {
            _gestureHintShown = true;
            showGestureHint();
        }
    }

    // Mark render needed when controls change
    controls.addEventListener('change', requestRender);

    raycaster = new THREE.Raycaster();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(80, 80, 120);
    scene.add(dirLight);

    // 打印底板（网格 + 平面 + 坐标轴）。默认 256×256；如有 pending size 则使用之。
    var _initBedW = _pendingBedSize ? _pendingBedSize.width : 256;
    var _initBedD = _pendingBedSize ? _pendingBedSize.depth : 256;
    _createBed(_initBedW, _initBedD);
    setBedLabel(_initBedW, _initBedD, null);
    _pendingBedSize = null;

    function handleInteraction(event) {
        if (!currentMesh) return;
        const rect = renderer.domElement.getBoundingClientRect();
        let clientX, clientY;
        if (event.touches && event.touches.length > 0) {
            clientX = event.touches[0].clientX;
            clientY = event.touches[0].clientY;
        } else if (event.changedTouches && event.changedTouches.length > 0) {
            clientX = event.changedTouches[0].clientX;
            clientY = event.changedTouches[0].clientY;
        } else {
            clientX = event.clientX;
            clientY = event.clientY;
        }
        mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        // Lay on Face cluster hit detection
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
    }
    renderer.domElement.addEventListener('click', handleInteraction);
    renderer.domElement.addEventListener('touchend', (e) => {
        // Only trigger face click on quick taps (< 300ms, no drag)
        const elapsed = Date.now() - _touchStartTime;
        if (elapsed < 300 && !_touchMoved) {
            handleInteraction(e);
        }
    }, { passive: true });

    stlLoader = new STLLoader();
    initialised = true;

    // On-demand rendering loop (saves battery on mobile)
    function animate() {
        requestAnimationFrame(animate);
        const controlsUpdated = controls.update();
        if (_renderRequested || controlsUpdated) {
            renderer.render(scene, camera);
            _renderRequested = false;
        }
    }
    animate();
}

/** Request a render on next frame */
export function requestRender() {
    _renderRequested = true;
}

/** Show a one-time gesture hint overlay on mobile */
function showGestureHint() {
    const hint = document.createElement('div');
    hint.className = 'viewer-gesture-hint';
    hint.innerHTML = `
        <div style="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
            background:rgba(0,0,0,0.75);color:#fff;padding:12px 20px;border-radius:12px;
            font-size:13px;z-index:9999;pointer-events:none;display:flex;gap:20px;
            align-items:center;backdrop-filter:blur(4px);transition:opacity 0.5s">
            <span>👆 拖动旋转</span>
            <span>🤏 双指缩放</span>
            <span>✌️ 双指平移</span>
        </div>`;
    document.body.appendChild(hint);
    setTimeout(() => {
        hint.style.opacity = '0';
        setTimeout(() => hint.remove(), 600);
    }, 3500);
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


async function renderViaGLB(file, orientation = null, colorKey = null) {
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
        var _glbColorNum = _colorNumFromKey(colorKey || 'Blue');
        model.traverse(function(c) {
            if (c.isMesh) {
                c.castShadow = true;
                c.receiveShadow = true;
                c.material = new THREE.MeshStandardMaterial({ color: _glbColorNum, metalness: 0.15, roughness: 0.65 });
            }
        });
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
        if (orientation) {
            currentMesh.rotation.x = THREE.MathUtils.degToRad(orientation.x || 0);
            currentMesh.rotation.y = THREE.MathUtils.degToRad(orientation.y || 0);
            currentMesh.rotation.z = THREE.MathUtils.degToRad(orientation.z || 0);
            currentMesh.updateMatrixWorld(true);
            box = new THREE.Box3().setFromObject(currentMesh);
            currentMesh.position.z -= box.min.z;
            // 旋转后重新 X/Y 居中到热床中心（旋转会使包围盒中心偏移，否则模型偏离底板中心）
            currentMesh.updateMatrixWorld(true);
            box.setFromObject(currentMesh);
            const _glbReCenter = box.getCenter(new THREE.Vector3());
            currentMesh.position.x += (bc - _glbReCenter.x);
            currentMesh.position.y += (bc - _glbReCenter.y);
        }
        fitCameraToMesh(currentMesh);
        previewPlaceholder.classList.add('hidden');
        _lastRenderedFileKey = (file.name || '') + ':' + (file.size || 0);
        _lastRenderedColorKey = colorKey;
        _lastRenderedOrientation = orientation ? { x: orientation.x || 0, y: orientation.y || 0, z: orientation.z || 0 } : null;
        return true;
    } catch (e) {
        console.warn('GLB render failed:', e);
        return false;
    }
}

export function renderSTL(file, colorKey = 'Blue', orientation = null) {
    if (!file || !(file instanceof Blob) || file.size === 0) {
        previewPlaceholder.textContent = '文件无效或为空，请重新上传';
        previewPlaceholder.classList.remove('hidden');
        return;
    }
    // Fast path: same file + orientation already loaded → just recolor, skip re-parse
    var _fileKey = (file.name || '') + ':' + (file.size || 0);
    if (currentMesh && _fileKey === _lastRenderedFileKey
        && _orientationEqual(orientation, _lastRenderedOrientation)) {
        recolorCurrentMesh(colorKey);
        previewPlaceholder.classList.add('hidden');
        return;
    }
    const ext = file.name && file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
    if (ext !== 'stl') {
        // 为 3MF/OBJ/STP 通过后端转为 GLB 预览
        clearCurrentMesh();
        renderViaGLB(file, orientation, colorKey).then(ok => {
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
                color: _colorNumFromKey(colorKey), metalness: 0.15, roughness: 0.65,
            });
            currentMesh = new THREE.Mesh(geometry, material);
            currentMesh.rotation.set(0, 0, 0);
            // 模型在打印平面居中
            const bc = window._BED_CENTER || 128;
            currentMesh.position.set(bc, bc, 0);
            _initialMeshPos = currentMesh.position.clone();
            if (orientation) {
                currentMesh.rotation.x = THREE.MathUtils.degToRad(orientation.x || 0);
                currentMesh.rotation.y = THREE.MathUtils.degToRad(orientation.y || 0);
                currentMesh.rotation.z = THREE.MathUtils.degToRad(orientation.z || 0);
                currentMesh.updateMatrixWorld(true);
                var box = new THREE.Box3().setFromObject(currentMesh);
                currentMesh.position.z -= box.min.z;
                // 旋转后重新 X/Y 居中到热床中心（旋转会使包围盒中心偏移，否则模型偏离底板中心）
                currentMesh.updateMatrixWorld(true);
                box.setFromObject(currentMesh);
                var _reCenter = box.getCenter(new THREE.Vector3());
                currentMesh.position.x += (bc - _reCenter.x);
                currentMesh.position.y += (bc - _reCenter.y);
            }
            scene.add(currentMesh);
            fitCameraToMesh(currentMesh);
            previewPlaceholder.classList.add('hidden');
            _lastRenderedFileKey = _fileKey;
            _lastRenderedColorKey = colorKey;
            _lastRenderedOrientation = orientation ? { x: orientation.x || 0, y: orientation.y || 0, z: orientation.z || 0 } : null;
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
    requestRender();
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
    requestRender();
}

export function updateViewerSize() {
    if (!renderer || !previewContainer) return;
    camera.aspect = previewContainer.clientWidth / previewContainer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(previewContainer.clientWidth, previewContainer.clientHeight);
    requestRender();
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
    requestRender();
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
    requestRender();
}
