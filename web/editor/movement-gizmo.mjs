// Reuse the core's TransformControls so capture automatically hides the editing handles.
// A separate anchor translates the entire mannequin without changing any bone rotations.
export function createMovementGizmo(viewer, { getTransform, onStart, onChange }) {
    const anchor = new viewer.THREE.Object3D();
    anchor.name = 'Fisher person movement';
    viewer.scene.add(anchor);
    const controls = viewer.transform;
    let start = null;

    function sync(enabled) {
        viewer.options.enablePoseInteraction = !enabled;
        if (!enabled) {
            if (controls.object === anchor) {
                controls.detach(); controls.setMode('rotate'); controls.setSpace('local'); controls.setSize(0.8);
            }
            return;
        }
        if (controls.dragging) return;
        if (controls.object !== anchor) {
            viewer.deselectBone(); viewer.deselectIKEffector(); viewer.deselectPoleTarget();
            controls.setMode('translate'); controls.setSpace('world'); controls.setSize(1);
            controls.attach(anchor);
        }
        const left = viewer.bones.thigh_l, right = viewer.bones.thigh_r;
        if (left && right) {
            left.getWorldPosition(anchor.position);
            anchor.position.add(right.getWorldPosition(new viewer.THREE.Vector3())).multiplyScalar(0.5);
        } else anchor.position.copy(viewer.skinnedMesh.position);
        anchor.updateMatrixWorld(true);
        viewer.requestRender();
    }

    const dragging = event => {
        if (controls.object !== anchor) return;
        if (event.value) {
            start = { position: anchor.position.clone(), transform: { ...getTransform() } };
            onStart();
        } else {
            start = null;
            sync(true);
        }
    };
    const change = () => {
        if (!start || controls.object !== anchor) return;
        const delta = anchor.position.clone().sub(start.position);
        const transform = { ...start.transform };
        for (const axis of ['x', 'y', 'z']) transform[axis] += delta[axis];
        onChange(transform);
    };
    const cancel = () => {
        if (controls.object === anchor && controls.dragging) controls.pointerUp({ button: 0 });
    };
    controls.addEventListener('dragging-changed', dragging);
    controls.addEventListener('objectChange', change);
    viewer.canvas.addEventListener('pointercancel', cancel);
    return {
        sync,
        dispose() {
            cancel();
            controls.removeEventListener('dragging-changed', dragging);
            controls.removeEventListener('objectChange', change);
            viewer.canvas.removeEventListener('pointercancel', cancel);
            if (controls.object === anchor) controls.detach();
            anchor.removeFromParent();
        },
    };
}
