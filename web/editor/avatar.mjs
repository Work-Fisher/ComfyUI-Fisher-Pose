import * as THREE from './vendor/three.module.mjs';
import {BASE,CHAINS,JOINT_NAMES} from './state.mjs';
const V=(...values)=>new THREE.Vector3(...values);
const LENGTHS=CHAINS.map(([a,b,c])=>[V(...BASE[a]).distanceTo(V(...BASE[b])),V(...BASE[b]).distanceTo(V(...BASE[c]))]);
const CONNECTIONS=[['neck','ls'],['ls','le'],['le','lw'],['neck','rs'],['rs','re'],['re','rw'],['neck','hip'],['hip','lh'],['lh','lk'],['lk','la'],['hip','rh'],['rh','rk'],['rk','ra'],['neck','head']];
export function solveIK(person,chain,target,bendHint){
    const [a,b,c]=CHAINS[chain],root=V(...person.points[a]),[l1,l2]=(person.rigLengths||LENGTHS)[chain];
    const delta=target.clone().sub(root),distance=THREE.MathUtils.clamp(delta.length(),Math.abs(l1-l2)+.008,l1+l2-.001);
    const direction=delta.length()<.0001?V(0,-1,0):delta.normalize();
    const along=(l1*l1-l2*l2+distance*distance)/(2*distance);
    let bend=(bendHint||V(...person.points[b])).clone().sub(root);
    bend.addScaledVector(direction,-bend.dot(direction));
    if(bend.length()<.001){bend=V(0,0,1);bend.addScaledVector(direction,-bend.dot(direction));if(bend.length()<.001)bend=V(1,0,0).cross(direction);}
    bend.normalize();
    person.points[b]=root.clone().addScaledVector(direction,along).addScaledVector(bend,Math.sqrt(Math.max(0,l1*l1-along*along))).toArray();
    person.points[c]=root.clone().addScaledVector(direction,distance).toArray();
}
export function normalizeLimbs(person){CHAINS.forEach((chain,index)=>solveIK(person,index,V(...person.points[chain[2]])));}
export function boneLengths(person){return CHAINS.map(([a,b,c])=>[V(...person.points[a]).distanceTo(V(...person.points[b])),V(...person.points[b]).distanceTo(V(...person.points[c]))]);}

export function moveBodyJoint(person,name,target){
    const points=person.points;
    if(name==='hip'){
        const delta=target.clone().sub(V(...points.hip));
        const feet=[V(...points.la),V(...points.ra)];
        for(const key of Object.keys(points))points[key]=V(...points[key]).add(delta).toArray();
        solveIK(person,2,feet[0]);solveIK(person,3,feet[1]);return;
    }
    const pivotName=name==='neck'?'hip':name==='head'?'neck':['ls','rs'].includes(name)?'neck':'hip';
    const pivot=V(...points[pivotName]),from=V(...points[name]).sub(pivot),to=target.clone().sub(pivot);
    if(from.length()<1e-6||to.length()<1e-6)return;
    const rotation=new THREE.Quaternion().setFromUnitVectors(from.normalize(),to.normalize());
    const keys=name==='neck'?['neck','head','ls','le','lw','rs','re','rw']:
        name==='head'?['head']:name==='ls'||name==='rs'?['ls','le','lw','rs','re','rw','head']:
        name==='lh'?['lh','lk','la']:['rh','rk','ra'];
    for(const key of keys)points[key]=V(...points[key]).sub(pivot).applyQuaternion(rotation).add(pivot).toArray();
    if(['neck','ls','rs'].includes(name)){
        const forward=V(...points.ls).sub(V(...points.rs)).cross(V(...points.neck).sub(V(...points.hip)));
        if(Math.hypot(forward.x,forward.z)>1e-6)person.torsoFacingOffset=Math.atan2(forward.x,forward.z)*180/Math.PI;
    }
}

export function createAvatar(id,color){
    const group=new THREE.Group(),handles=[],pickables=[],surfaces=[],bones=[],spheres={},ownedMaterials=[];
    const material=(hex,roughness=.4)=>{const mat=new THREE.MeshStandardMaterial({color:hex,roughness,metalness:.08});ownedMaterials.push(mat);return mat;};
    const skin=material(0xd9e0e8,.65),joint=material(0xa4b3c8),left=material(0x557ee0),right=material(0xdf8891);
    function mesh(geometry,mat){const m=new THREE.Mesh(geometry,mat);m.castShadow=true;m.userData.personId=id;group.add(m);pickables.push(m);return m;}
    for(const [a,b]of CONNECTIONS){
        const leg=['lk','la','rk','ra'].includes(b),side=b.startsWith('l')?left:b.startsWith('r')?right:joint;
        const outer=mesh(new THREE.LatheGeometry([new THREE.Vector2(0,-.5),new THREE.Vector2(leg?.045:.032,-.48),new THREE.Vector2(leg?.067:.045,-.3),new THREE.Vector2(leg?.09:.062,.1),new THREE.Vector2(leg?.075:.055,.4),new THREE.Vector2(0,.5)],24),skin);
        const inner=mesh(new THREE.CylinderGeometry(.012,.012,1,10),side);
        bones.push({a,b,outer,inner});surfaces.push(outer);
    }
    for(const name of Object.keys(BASE)){
        if(name==='head')continue;
        const editable=name in JOINT_NAMES,ball=mesh(new THREE.SphereGeometry(editable?.054:.052,20,14),['le','lw','lk','la','re','rw','rk','ra'].includes(name)?(name.startsWith('l')?left:right):joint);
        ball.userData.joint=editable?name:null;spheres[name]=ball;if(editable)handles.push(ball);
    }
    const ellipsoid=(scale,mat=skin)=>{const m=mesh(new THREE.SphereGeometry(1,28,20),mat);m.scale.set(...scale);surfaces.push(m);return m;};
    const chest=mesh(new THREE.LatheGeometry([new THREE.Vector2(.12,-.5),new THREE.Vector2(.14,-.25),new THREE.Vector2(.22,.12),new THREE.Vector2(.25,.3),new THREE.Vector2(.18,.46),new THREE.Vector2(.07,.5)],32),skin);surfaces.push(chest);
    const pelvis=ellipsoid([.18,.135,.125]),head=ellipsoid([.105,.145,.105]);
    head.userData.joint='head';handles.push(head);
    const hands={lw:ellipsoid([.044,.075,.022]),rw:ellipsoid([.044,.075,.022])};
    for(const [name,hand] of Object.entries(hands)){hand.userData.joint=name;handles.push(hand);}

    // Paint the face onto the head surface: no protruding facial geometry.
    const faceCanvas=document.createElement('canvas');faceCanvas.width=1024;faceCanvas.height=512;
    const faceContext=faceCanvas.getContext('2d');faceContext.fillStyle='#d1dae7';faceContext.fillRect(0,0,1024,512);
    faceContext.fillStyle='#263750';
    for(const x of [216,296]){faceContext.beginPath();faceContext.ellipse(x,225,13,17,0,0,Math.PI*2);faceContext.fill();}
    faceContext.font='30px sans-serif';faceContext.textAlign='center';faceContext.fillText('前',256,310);faceContext.fillText('后',768,275);
    const faceTexture=new THREE.CanvasTexture(faceCanvas);faceTexture.colorSpace=THREE.SRGBColorSpace;
    const faceMaterial=material(0xffffff);faceMaterial.map=faceTexture;head.material=faceMaterial;
    const feet={la:ellipsoid([.067,.055,.13]),ra:ellipsoid([.067,.055,.13])};
    const ringMat=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.65,side:THREE.DoubleSide});ownedMaterials.push(ringMat);
    const ring=mesh(new THREE.RingGeometry(.4,.415,64),ringMat);ring.rotation.x=-Math.PI/2;ring.position.y=.007;
    const facingArrow=new THREE.ArrowHelper(V(0,0,1),V(0,.025,.15),.55,color,.14,.1);group.add(facingArrow);
    ownedMaterials.push(facingArrow.line.material,facingArrow.cone.material);
    const labelCanvas=document.createElement('canvas');labelCanvas.width=256;labelCanvas.height=64;
    const texture=new THREE.CanvasTexture(labelCanvas),labelMaterial=new THREE.SpriteMaterial({map:texture,depthTest:false,transparent:true});
    const label=new THREE.Sprite(labelMaterial);label.scale.set(.52,.13,1);label.position.y=2.1;group.add(label);
    let lastName='';
    function update(person,active,mode,selectedJoint){
        group.position.set(...person.position);group.rotation.y=THREE.MathUtils.degToRad(person.bodyAngle);
        for(const [name,sphere]of Object.entries(spheres)){sphere.position.set(...person.points[name]);sphere.scale.setScalar(active&&name===selectedJoint?1.28:1);}
        for(const bone of bones){
            const start=V(...person.points[bone.a]),end=V(...person.points[bone.b]),delta=end.clone().sub(start);
            for(const m of [bone.outer,bone.inner]){m.position.copy(start).lerp(end,.5);m.scale.y=delta.length();m.quaternion.setFromUnitVectors(V(0,1,0),delta.clone().normalize());}
            bone.inner.visible=mode==='skeleton';
        }
        chest.position.copy(V(...person.points.neck)).lerp(V(...person.points.hip),.43);
        const torso=V(...person.points.neck).sub(V(...person.points.hip));
        const side=V(...person.points.ls).sub(V(...person.points.rs)).normalize();
        const up=torso.clone().normalize(),forward=side.clone().cross(up).normalize();
        const right=up.clone().cross(forward).normalize();
        const basis=new THREE.Matrix4().makeBasis(right,up,forward);
        chest.quaternion.setFromRotationMatrix(basis);
        chest.scale.set(Math.max(.35,V(...person.points.ls).distanceTo(V(...person.points.rs))/.5),torso.length()*.92,.58);
        pelvis.scale.x=Math.max(.06,V(...person.points.lh).distanceTo(V(...person.points.rh))*.64);
        for(const name of ['lw','rw']){
            const elbow=name==='lw'?'le':'re',direction=V(...person.points[name]).sub(V(...person.points[elbow])).normalize();
            hands[name].position.copy(V(...person.points[name])).addScaledVector(direction,.045);
            hands[name].quaternion.setFromUnitVectors(V(0,-1,0),direction);
        }
        pelvis.position.set(...person.points.hip);head.position.set(...person.points.head);head.quaternion.setFromUnitVectors(up,V(...person.points.head).sub(V(...person.points.neck)).normalize()).multiply(chest.quaternion);
        for(const name of ['la','ra'])feet[name].position.copy(V(...person.points[name])).add(V(0,-.025,.062));
        surfaces.forEach(surface=>surface.visible=mode==='model');ringMat.opacity=active?.95:.25;
        if(lastName!==person.name){const ctx=labelCanvas.getContext('2d');ctx.clearRect(0,0,256,64);ctx.fillStyle='#ffffffdd';ctx.roundRect(3,3,250,58,16);ctx.fill();ctx.fillStyle=color;ctx.font='24px "Microsoft YaHei",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(person.name,128,32);texture.needsUpdate=true;lastName=person.name;}
        label.material.opacity=active?1:.65;group.updateMatrixWorld(true);
    }
    function dispose(){group.removeFromParent();group.traverse(object=>object.geometry?.dispose());ownedMaterials.forEach(mat=>mat.dispose());texture.dispose();faceTexture.dispose();labelMaterial.dispose();}
    return {group,handles,pickables,update,dispose,setReferenceMode(){const helpers=[ring,facingArrow,label],visibility=helpers.map(o=>o.visible),scales=Object.values(spheres).map(o=>o.scale.clone());helpers.forEach(o=>o.visible=false);Object.values(spheres).forEach(o=>o.scale.setScalar(1));return ()=>{helpers.forEach((o,i)=>o.visible=visibility[i]);Object.values(spheres).forEach((o,i)=>o.scale.copy(scales[i]));};}};
}
