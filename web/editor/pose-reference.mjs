import * as THREE from './vendor/three.module.mjs';

// The editor expands its viewport FOV around the 37-degree shooting frame.
// Rendering that frame directly uses the same camera transform and a 37-degree FOV.
export function renderMannequinReference(state,scene,editorCamera,avatars,preview=false) {
    const camera=editorCamera.clone();camera.aspect=state.outputWidth/state.outputHeight;
    camera.fov=37;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    const scale=preview?Math.min(1,1024/Math.max(state.outputWidth,state.outputHeight)):1;
    renderer.setPixelRatio(1);renderer.setSize(Math.round(state.outputWidth*scale),Math.round(state.outputHeight*scale));
    renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    const background=scene.background,restore=[];
    try{
        scene.background=new THREE.Color(0xeff2f6);
        if(!preview)scene.traverse(o=>{if(o.userData.previewOnly){const visible=o.visible;o.visible=false;restore.push(()=>o.visible=visible);}});
        for(const avatar of avatars.values())restore.push(avatar.setReferenceMode());
        renderer.render(scene,camera);return renderer.domElement.toDataURL('image/png');
    } finally {
        restore.forEach(fn=>fn());scene.background=background;
        renderer.dispose();renderer.forceContextLoss();
    }
}
