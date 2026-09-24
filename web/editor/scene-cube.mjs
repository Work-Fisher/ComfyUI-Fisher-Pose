import * as THREE from './vendor/three.module.mjs';

export function createSceneCube(scene){
    const labels=['右','左','上','下','正面 · 上传场景图','背面'];
    const textures=labels.map(label=>{const c=document.createElement('canvas');c.width=512;c.height=512;const ctx=c.getContext('2d');ctx.fillStyle='#e7edf5';ctx.fillRect(0,0,512,512);ctx.strokeStyle='#9eacc0';ctx.lineWidth=5;ctx.strokeRect(2,2,508,508);ctx.fillStyle='#526680';ctx.font='32px sans-serif';ctx.textAlign='center';ctx.fillText(label,256,270);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;});
    const materials=textures.map(map=>new THREE.MeshBasicMaterial({map}));
    const cube=new THREE.Mesh(new THREE.BoxGeometry(1.6,1.6,1.6),materials);cube.visible=false;cube.userData.previewOnly=true;scene.add(cube);
    let imageTexture=null,revision=0;
    async function setImage(source){
        const token=++revision;
        if(!source){materials[4].map=textures[4];materials[4].needsUpdate=true;imageTexture?.dispose();imageTexture=null;return;}
        const image=typeof source==='string'?new Image():source;
        if(typeof source==='string'){image.src=source;await image.decode();}
        if(token!==revision)return;
        const c=document.createElement('canvas');c.width=768;c.height=768;const ctx=c.getContext('2d');ctx.fillStyle='#eef2f7';ctx.fillRect(0,0,768,768);
        const scale=Math.min(752/image.naturalWidth,752/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;
        ctx.drawImage(image,(768-w)/2,(768-h)/2,w,h);
        imageTexture?.dispose();imageTexture=new THREE.CanvasTexture(c);imageTexture.colorSpace=THREE.SRGBColorSpace;
        materials[4].map=imageTexture;materials[4].needsUpdate=true;
    }
    return {cube,setImage};
}
