// Shared render configuration for the main preview and generated thumbnails.
import * as THREE from 'three';

export function configurePreviewRenderer(renderer) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    return renderer;
}

export function createPreviewMaterial(color) {
    const baseColor = new THREE.Color(color);
    const luminance = 0.2126 * baseColor.r + 0.7152 * baseColor.g + 0.0722 * baseColor.b;
    return new THREE.MeshStandardMaterial({
        color,
        metalness: 0.0,
        roughness: 0.6,
        // White needs a stronger lift because diffuse shading turns it gray.
        // Keep the lift subtle for darker colors so their hue stays unchanged.
        emissive: color,
        emissiveIntensity: luminance > 0.82 ? 0.28 : 0.08,
    });
}

export function addPreviewLighting(scene) {
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const light = new THREE.DirectionalLight(0xffffff, 0.35);
    light.position.set(2, 3, 1);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.camera.near = 1;
    light.shadow.camera.far = 1000;
    light.shadow.camera.left = -300;
    light.shadow.camera.right = 300;
    light.shadow.camera.top = 300;
    light.shadow.camera.bottom = -300;
    scene.add(light);
    return light;
}
