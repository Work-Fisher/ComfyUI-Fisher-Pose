// Photo comparison stays on an editing-only layer; the capture camera never sees it.
export function createReferenceOverlay(viewer) {
    const T = viewer.THREE, layer = 2;
    const plane = new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false, side: T.DoubleSide }));
    plane.name = 'Fisher comparison photo'; plane.layers.set(layer); plane.visible = false;
    viewer.camera.layers.enable(layer); viewer.scene.add(plane);
    let revision = 0, disposed = false;
    function sync() {
        if (!plane.visible || !viewer.captureFrame) return;
        const frame = viewer.captureFrame, camera = viewer.captureCamera;
        camera.updateMatrixWorld(true);
        const direction = frame.position.clone().sub(camera.position), distance = direction.length() || 1;
        direction.divideScalar(distance);
        let far = distance;
        for (const mesh of [viewer.skinnedMesh, ...Array.from(viewer.passiveCharacters.values(), item => item.mesh)]) {
            for (const bone of mesh?.skeleton?.bones || []) far = Math.max(far, bone.getWorldPosition(new T.Vector3()).sub(camera.position).dot(direction));
        }
        far += 2;
        plane.position.copy(camera.position).addScaledVector(direction, far);
        plane.quaternion.copy(frame.quaternion);
        plane.scale.copy(frame.scale).multiplyScalar(far / distance);
        const image = plane.material.map?.image;
        if (image) {
            const photoAspect = image.width / image.height, frameAspect = frame.scale.x / frame.scale.y;
            if (photoAspect > frameAspect) plane.scale.y *= frameAspect / photoAspect;
            else plane.scale.x *= photoAspect / frameAspect;
        }
        plane.updateMatrixWorld(true);
    }
    async function setSource(url) {
        const token = ++revision;
        if (!url) { plane.visible = false; plane.material.map?.dispose(); plane.material.map = null; viewer.requestRender(); return; }
        const texture = await new T.TextureLoader().loadAsync(url);
        if (disposed || token !== revision) { texture.dispose(); return; }
        texture.colorSpace = T.SRGBColorSpace;
        plane.material.map?.dispose(); plane.material.map = texture; plane.material.needsUpdate = true; plane.visible = true;
        sync(); viewer.requestRender();
    }
    return { sync, setSource, setOpacity(value) { plane.material.opacity = Math.max(0.05, Math.min(0.9, value)); viewer.requestRender(); },
        dispose() { disposed = true; revision++; plane.material.map?.dispose(); plane.geometry.dispose(); plane.material.dispose(); plane.removeFromParent(); } };
}
