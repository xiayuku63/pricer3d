// ── Three.js 3D Viewer — Scene Module ──
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { currentMesh, faceClickCallback, highlightGroup, highlightMode } from './mesh.js';

// ── Shared state (created by initViewer, read by other modules) ──
export let scene, camera, renderer, controls, stlLoader;
export let previewContainer, previewPlaceholder;
export let initialised = false;

let raycaster = null;
let mouse = new THREE.Vector2();

// Bed (print platform) references — for dynamic bed size updates
let _bedGrid = null;
let _bedPlane = null;
let _bedAxes = [];
let _pendingBedSize = null;  // {width, depth} queued before initViewer finishes
let _bedLabel = null;            // DOM overlay (top-right) showing bed W×D×H
let _bedDims = { w: 256, d: 256, h: 256 };

// Mobile touch state
let _isMobile = false;
let _touchStartTime = 0;
let _touchMoved = false;
let _gestureHintShown = false;
let _lastPinchDist = 0;
let _renderRequested = true;  // dirty flag for on-demand rendering

// ── Bed helpers ──

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
        color: 0xcbd5e1,
        transparent: true,
        opacity: 0.3,
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

function _formatBedLabel(w, d, h) {
    return Math.round(w) + ' × ' + Math.round(d) + ' × ' + Math.round(h) + ' mm';
}

// ── Exported: bed label ──

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
    // ── Re-center the already-loaded model to the new bed centre ──
    // After _createBed updates window._BED_CENTER, the model's bounding-box
    // centre may differ from the new bc, so we shift it to match.
    if (currentMesh) {
        currentMesh.updateMatrixWorld(true);
        const bc = window._BED_CENTER || 128;
        const box = new THREE.Box3().setFromObject(currentMesh);
        const center = box.getCenter(new THREE.Vector3());
        currentMesh.position.x += (bc - center.x);
        currentMesh.position.y += (bc - center.y);
    }
    requestRender();
}

// ── Exported: init ──

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

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.35);
    dirLight.position.set(2, 3, 1);
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

export function updateViewerSize() {
    if (!renderer || !previewContainer) return;
    camera.aspect = previewContainer.clientWidth / previewContainer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(previewContainer.clientWidth, previewContainer.clientHeight);
    requestRender();
}
