import {createSceneCube} from './scene-cube.mjs';
import {renderMannequinReference} from './pose-reference.mjs?v=20260922-preview2';
import {readSkeletonImage,fitSkeleton,fitSelectedSkeleton} from './pose-import.mjs';
import {setupReference} from './reference.mjs';
import * as THREE from './vendor/three.module.mjs';
import {BASE,PRESETS,ORDER,LIMBS,COLORS,JOINT_NAMES,CHAINS,clone,clamp,newPerson,migrate,DISTANCE,ZOOM,cameraTerms,buildPrompt,projectPoint,personFacing} from './state.mjs';
import {createAvatar,normalizeLimbs,solveIK,boneLengths,moveBodyJoint} from './avatar.mjs';

const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)];
const V=(...values)=>new THREE.Vector3(...values);
const embedded=new URLSearchParams(location.search).has('embedded');
const storageKey='fisher-pose-multi-v2';
let state=migrate(),shots=[],history=[],future=[],selectedJoint=null,toastTimer;
let outputMode='视角＋姿态',extraPrompt='';
const avatars=new Map(),actorColors=['#5279d8','#cf7f91','#449e90'];
const person=()=>state.people.find(item=>item.id===state.selectedId)||state.people[0]||newPerson(0);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(37,1,.05,200),container=$('#viewport');
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0xeff2f6,0);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;
container.append(renderer.domElement);renderer.domElement.setAttribute('aria-label','多人三维姿态编辑视窗');renderer.domElement.tabIndex=0;
scene.add(new THREE.HemisphereLight(0xf5f8ff,0xa6afc0,2.5));
const key=new THREE.DirectionalLight(0xffffff,3.5);key.position.set(3,6,4);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-5,right:5,top:5,bottom:-5});key.shadow.bias=-.0003;scene.add(key);
const fill=new THREE.DirectionalLight(0xb7ceff,1.8);fill.position.set(-3,3,-2);scene.add(fill);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.ShadowMaterial({color:0x677a97,opacity:.13}));floor.rotation.x=-Math.PI/2;floor.position.y=-.015;floor.receiveShadow=true;scene.add(floor);
const grid=new THREE.GridHelper(30,100,0xc5cedd,0xdce2eb);grid.material.transparent=true;grid.material.opacity=.58;scene.add(grid);
const sceneCube=createSceneCube(scene);
let frameWidth=300,frameHeight=400;

function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),2300);}
function persist(){
    $('#save-status').textContent=embedded?'有修改 · 点击应用到节点':'已本地保存';
    if(!embedded)try{localStorage.setItem(storageKey,JSON.stringify({state,shots,outputMode,extraPrompt}));}catch{$('#save-status').textContent='本地存储已满';}
}
function checkpoint(){history.push(clone(state));if(history.length>60)history.shift();future=[];}
function undo(){if(!history.length)return;future.push(clone(state));state=migrate(history.pop());selectedJoint=null;refresh();toast('已撤销');}
function redo(){if(!future.length)return;history.push(clone(state));state=migrate(future.pop());selectedJoint=null;refresh();toast('已重做');}
function mutate(action){checkpoint();action();refresh();}
function updateAvatars(){
    sceneCube.cube.visible=state.people.length===0;
    sceneCube.cube.position.set(...state.cameraTarget);
    $('#reference-image').hidden=!state.people.length||!$('#reference-image').getAttribute('src');
    $('#opacity-control').hidden=!state.people.length||!$('#reference-image').getAttribute('src');
    for(const [id,avatar]of avatars)if(!state.people.some(p=>p.id===id)){avatar.dispose();avatars.delete(id);}
    state.people.forEach((p,index)=>{
        if(!avatars.has(p.id)){const avatar=createAvatar(p.id,actorColors[index]);avatars.set(p.id,avatar);scene.add(avatar.group);}
        avatars.get(p.id).update(p,p.id===state.selectedId,state.mode,selectedJoint);
    });
}
function updateCamera(){
    const a=THREE.MathUtils.degToRad(state.azimuth),e=THREE.MathUtils.degToRad(state.elevation);
    camera.position.set(state.distance*Math.sin(a)*Math.cos(e),state.distance*Math.sin(e),state.distance*Math.cos(a)*Math.cos(e)).add(V(...state.cameraTarget));
    camera.lookAt(V(...state.cameraTarget));camera.updateMatrixWorld();
}
function resize(){
    const w=container.clientWidth,h=container.clientHeight;if(!w||!h)return;
    renderer.setSize(w,h);camera.aspect=w/h;
    const ratio=state.outputWidth/state.outputHeight;
    frameHeight=Math.min(h-104,(w-100)/ratio);frameWidth=frameHeight*ratio;
    $('#output-frame').style.width=frameWidth+'px';$('#output-frame').style.height=frameHeight+'px';
    Object.assign($('#reference-image').style,{inset:'auto',left:'50%',top:'50%',transform:'translate(-50%,-50%)',width:frameWidth+'px',height:frameHeight+'px'});
    camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(37)/2)*h/frameHeight));camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(container);
function setField(id,value){const el=$('#'+id);if(document.activeElement!==el)el.value=value;}
function updatePrompt(){
    $('#description').textContent=buildPrompt(state,outputMode,extraPrompt);
    $('#mode-help').textContent={'仅视角':'只连接提示词口；请断开 image_2 的骨架连线。','仅姿态':'所有人物合成一张拍摄框人偶图，连接 image_2。','视角＋姿态':'提示词接 prompt，人偶姿态参考图接 image_2。'}[outputMode];
    $('#style-help').textContent=state.promptStyle==='中文编辑指令'?'采用相同视角分档，适用于当前 Qwen2.1 工作流。':'输出原版 <sks> 镜头格式，需在下游自行配置配套多视角 LoRA；本插件不会自动安装或加载。';
    $('#camera-summary').textContent=cameraTerms(state).zh;
}
function renderPeople(){
    $('#person-count').textContent=state.people.length+' / 3';$('#people-list').replaceChildren();
    state.people.forEach((p,index)=>{
        const button=document.createElement('button');button.className='person-row'+(p.id===state.selectedId?' selected':'');button.dataset.person=p.id;
        const dot=document.createElement('span');dot.className='person-dot';dot.style.background=actorColors[index];
        const labels=document.createElement('span'),name=document.createElement('b'),detail=document.createElement('small');name.textContent=p.name;detail.textContent=p.identity||'独立动作与站位';labels.append(name,detail);button.append(dot,labels);
        button.onclick=()=>selectPerson(p.id);$('#people-list').append(button);
    });
    $('#add-person').disabled=state.people.length>=3;$('#duplicate-person').disabled=!state.people.length||state.people.length>=3;$('#delete-person').disabled=!state.people.length;
}
function syncUI(){
    const actor=person();
    if(!state.people.length)outputMode='仅视角';
    for(const el of $$('#pose-panel input,#pose-panel button,#pose-panel textarea,[data-pose]'))el.disabled=!state.people.length;
    $('#output-mode').disabled=!state.people.length;
    $('#center-view').disabled=!state.people.length;
    $('#selection-hint').textContent=state.people.length?'拖身体移动，拖关节摆姿；向外拖可拉长，Alt拖动调整长度':'场景视角示意 · 图片所在面为正面，实际结果由模型生成';
    for(const k of ['azimuth','elevation','zoom']){setField(k,state[k]);$('#'+k+'-value').textContent=k==='zoom'?state[k].toFixed(1):Math.round(state[k])+'°';}
    setField('azimuth-preset',(Math.floor((state.azimuth+22.5)/45)%8)*45);
    setField('elevation-preset',state.elevation< -15?-30:state.elevation<15?0:state.elevation<45?30:60);
    setField('zoom-preset',state.zoom<2?0:state.zoom<6?4:8);
    setField('bodyAngle',actor.bodyAngle);$('#bodyAngle-value').textContent=Math.round(actor.bodyAngle)+'°';
    $('#actor-facing').textContent=personFacing(state,actor);
    for(const [key,index]of [['positionX',0],['positionZ',2]]){setField(key,actor.position[index]);$('#'+key+'-value').textContent=actor.position[index].toFixed(2);}
    setField('actor-name',actor.name);setField('actor-identity',actor.identity);$('#actor-heading').textContent=actor.name;
    $('#selected-joint').textContent=JOINT_NAMES[selectedJoint]||'未选择关节';
    for(const k of ['width','height'])setField('output-'+k,state['output'+k[0].toUpperCase()+k.slice(1)]);
    if(state.qwenBinding)state.promptStyle='中文编辑指令';
    $('#prompt-style').disabled=!!state.qwenBinding;
    setField('prompt-style',state.promptStyle);setField('output-mode',outputMode);setField('extra-prompt',extraPrompt);
    $('#ratio-label').textContent=state.outputWidth+' × '+state.outputHeight;
    $$('[data-ratio]').forEach(el=>{const [a,b]=el.dataset.ratio.split(':').map(Number);el.classList.toggle('active',Math.abs(state.outputWidth/state.outputHeight-a/b)<.001);});
    $$('[data-mode]').forEach(el=>el.classList.toggle('active',el.dataset.mode===state.mode));
    $$('[data-pose]').forEach(el=>el.classList.toggle('active',el.dataset.pose===actor.preset));
    $('#undo').disabled=!history.length;$('#redo').disabled=!future.length;
    renderPeople();updatePrompt();
    $('#fit-reference').textContent=$('#fit-scope').value==='selected'?'骨架适配 → '+actor.name:'按整张骨架重建场景';
}
function refresh(save=true){updateAvatars();updateCamera();resize();syncUI();if(save)persist();}
function selectPerson(id){state.selectedId=id;selectedJoint=null;refresh(false);$('#selection-hint').textContent='当前选中 '+person().name+' · '+'拖身体移动，拖关节摆姿';}
function fitAll(){
    if(!state.people.length)return;
    updateAvatars();const box=new THREE.Box3();for(const avatar of avatars.values())box.union(new THREE.Box3().setFromObject(avatar.group));
    const target=box.getCenter(V());state.cameraTarget=target.toArray();
    const a=THREE.MathUtils.degToRad(state.azimuth),e=THREE.MathUtils.degToRad(state.elevation);
    const radial=V(Math.sin(a)*Math.cos(e),Math.sin(e),Math.cos(a)*Math.cos(e));
    const right=V(Math.cos(a),0,-Math.sin(a)),up=V(-Math.sin(a)*Math.sin(e),Math.cos(e),-Math.cos(a)*Math.sin(e));
    const tan=Math.tan(THREE.MathUtils.degToRad(37)/2),aspect=state.outputWidth/state.outputHeight;
    let distance=2;
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const delta=V(x,y,z).sub(target);distance=Math.max(distance,delta.dot(radial)+1.12*Math.max(Math.abs(delta.dot(right))/(tan*aspect),Math.abs(delta.dot(up))/tan));}
    state.distance=Math.min(distance,30);state.zoom=ZOOM(state.distance);
}
function addPerson(duplicate=false){
    if(state.people.length>=3){toast('最多支持 3 个人物');return;}
    mutate(()=>{
        const number=Math.max(0,...state.people.map(p=>Number(p.id.replace(/\D/g,''))||0))+1;
        const current=person();let next=newPerson(number);if(!state.people.length)outputMode='视角＋姿态';
        if(duplicate&&state.people.length)next={...clone(current),id:next.id,name:next.name,identity:''};
        const positions=[.95,-.95,1.9,-1.9,0];const x=positions.find(x=>state.people.every(p=>Math.abs(p.position[0]-x)>.5))??1.9;
        next.position=[x,0,0];normalizeLimbs(next);state.people.push(next);state.selectedId=next.id;selectedJoint=null;fitAll();
    });toast('已添加 '+person().name);
}
$('#add-person').onclick=()=>addPerson();$('#duplicate-person').onclick=()=>addPerson(true);
$('#delete-person').onclick=()=>{if(!state.people.length)return;mutate(()=>{state.people=state.people.filter(p=>p.id!==state.selectedId);state.selectedId=state.people[0]?.id??null;selectedJoint=null;});toast('已删除人物，可撤销恢复');};
const svgPose=points=>{const p=k=>[38-points[k][0]*31,67-points[k][1]*30];return `<svg viewBox="0 0 76 70" fill="none">${LIMBS.map(([a,b])=>`<path d="M${p(ORDER[a]).join(' ')} L${p(ORDER[b]).join(' ')}" stroke="#8fa2c1" stroke-width="3" stroke-linecap="round"/>`).join('')}<circle cx="${p('head')[0]}" cy="${p('head')[1]}" r="4" fill="#8fa2c1"/></svg>`;};
$('#pose-presets').innerHTML=PRESETS.map(p=>`<button class="pose-card" data-pose="${p.id}">${svgPose(p.points)}<span>${p.name}</span></button>`).join('');
$$('[data-pose]').forEach(el=>el.onclick=()=>mutate(()=>{const actor=person();delete actor.rigLengths;delete actor.torsoFacingOffset;actor.points=clone(PRESETS.find(p=>p.id===el.dataset.pose).points);actor.preset=el.dataset.pose;normalizeLimbs(actor);}));
function wireSlider(id,change){let editing=false;const input=$('#'+id);input.oninput=()=>{if(!editing){checkpoint();editing=true;}change(Number(input.value));refresh(false);};input.onchange=()=>{editing=false;persist();};}
wireSlider('azimuth',value=>state.azimuth=value);wireSlider('elevation',value=>state.elevation=value);
wireSlider('zoom',value=>{state.zoom=value;state.distance=DISTANCE(value);});
wireSlider('bodyAngle',value=>person().bodyAngle=value);wireSlider('positionX',value=>person().position[0]=value);wireSlider('positionZ',value=>person().position[2]=value);
$('#flip-facing').onclick=()=>mutate(()=>person().bodyAngle=(person().bodyAngle+180)%360);
for(const key of ['azimuth','elevation','zoom'])$('#'+key+'-preset').onchange=e=>mutate(()=>{state[key]=Number(e.target.value);if(key==='zoom')state.distance=DISTANCE(state.zoom);});
for(const [id,field]of [['actor-name','name'],['actor-identity','identity']])$('#'+id).onchange=e=>mutate(()=>person()[field]=e.target.value.trim()||(field==='name'?'人物':''));
$('#prompt-style').onchange=e=>mutate(()=>state.promptStyle=e.target.value);
$('#output-mode').onchange=e=>{outputMode=e.target.value;updatePrompt();persist();};
$('#extra-prompt').oninput=e=>{extraPrompt=e.target.value;updatePrompt();persist();};
$$('[data-view]').forEach(el=>el.onclick=()=>mutate(()=>{[state.azimuth,state.elevation]=el.dataset.view.split(',').map(Number);}));
$$('[data-mode]').forEach(el=>el.onclick=()=>mutate(()=>state.mode=el.dataset.mode));
$$('[data-tab]').forEach(el=>el.onclick=()=>{$$('[data-tab]').forEach(button=>button.classList.toggle('active',button===el));for(const tab of ['camera','pose','output'])$('#'+tab+'-panel').hidden=el.dataset.tab!==tab;});
$$('[data-ratio]').forEach(el=>el.onclick=()=>mutate(()=>{[state.outputWidth,state.outputHeight]=({'1:1':[1024,1024],'3:4':[768,1024],'16:9':[1536,864]})[el.dataset.ratio];}));
for(const [id,key]of [['output-width','outputWidth'],['output-height','outputHeight']])$('#'+id).onchange=e=>{const value=Number(e.target.value);if(Number.isInteger(value)&&value>=64&&value<=4096)mutate(()=>state[key]=value);};
$('#reset-camera').onclick=()=>mutate(()=>{state.azimuth=330;state.elevation=9;fitAll();});
$('#center-view').onclick=()=>mutate(fitAll);renderer.domElement.ondblclick=()=>mutate(fitAll);
$('#reset-pose').onclick=()=>mutate(()=>{delete person().rigLengths;delete person().torsoFacingOffset;person().points=clone(BASE);person().preset='stand';normalizeLimbs(person());});
$('#mirror').onclick=()=>mutate(()=>{const actor=person(),next=clone(actor.points);for(const k of Object.keys(next)){const other=k.startsWith('l')?'r'+k.slice(1):k.startsWith('r')?'l'+k.slice(1):k;next[k]=[-actor.points[other][0],actor.points[other][1],actor.points[other][2]];}actor.points=next;actor.torsoFacingOffset=-(actor.torsoFacingOffset||0);if(actor.rigLengths)actor.rigLengths=boneLengths(actor);actor.preset='custom';});
$('#toggle-grid').onclick=()=>{const el=$('.thirds');el.hidden=!el.hidden;$('#toggle-grid').setAttribute('aria-pressed',String(!el.hidden));};
$('#undo').onclick=undo;$('#redo').onclick=redo;
window.addEventListener('keydown',e=>{if(e.target.matches('input,textarea,select'))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}});

const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let drag=null,wheelTimer;
function rayFromEvent(e){const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);}
function hitTest(){
    const pickables=[...avatars.values()].flatMap(avatar=>avatar.pickables).filter(mesh=>mesh.visible);
    const first=raycaster.intersectObjects(pickables)[0];
    if(!first)return null;
    const handle=raycaster.intersectObjects([...avatars.values()].flatMap(avatar=>avatar.handles).filter(mesh=>mesh.visible))[0];
    return handle&&handle.distance<=first.distance+.12?handle:first;
}
renderer.domElement.onpointerdown=e=>{
    if(e.button!==0)return;e.preventDefault();rayFromEvent(e);const hit=hitTest();checkpoint();
    if(hit)state.selectedId=hit.object.userData.personId;
    selectedJoint=hit?.object.userData.joint||null;
    const move=!!hit&&(!selectedJoint||e.shiftKey);if(move)selectedJoint=null;
    drag={x:e.clientX,y:e.clientY,a:state.azimuth,e:state.elevation,joint:selectedJoint,move,selected:!!hit,personId:state.selectedId};
    const actor=person(),avatar=avatars.get(actor.id);
    if(selectedJoint){
        const pos=avatar.group.localToWorld(V(...actor.points[selectedJoint]));drag.plane=new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(V()),pos);
        const point=V();raycaster.ray.intersectPlane(drag.plane,point);drag.offset=pos.sub(point);
    }else if(move){
        drag.position=V(...actor.position);
        const azimuth=THREE.MathUtils.degToRad(state.azimuth);
        drag.right=V(Math.cos(azimuth),0,-Math.sin(azimuth));
        drag.forward=V(Math.sin(azimuth),0,Math.cos(azimuth));
        drag.scale=2*state.distance*Math.tan(THREE.MathUtils.degToRad(37)/2)/frameHeight;
    }
    renderer.domElement.setPointerCapture(e.pointerId);renderer.domElement.style.cursor='grabbing';refresh(false);
    $('#selection-hint').textContent=actor.name+(selectedJoint?' · '+JOINT_NAMES[selectedJoint]:move?' · 移动站位':' · 已选中');
};
renderer.domElement.onpointermove=e=>{
    rayFromEvent(e);
    if(!drag){renderer.domElement.style.cursor=hitTest()?'grab':'default';return;}
    const actor=state.people.find(p=>p.id===drag.personId),avatar=actor?avatars.get(actor.id):null,hit=V();
    if(drag.joint&&raycaster.ray.intersectPlane(drag.plane,hit)){
        avatar.group.worldToLocal(hit.add(drag.offset));if(['la','ra'].includes(drag.joint))hit.y=Math.max(.075,hit.y);
        const chain=CHAINS.findIndex(parts=>parts.includes(drag.joint));
        if(chain>=0&&!['ls','rs','lh','rh'].includes(drag.joint)){
            const [root,middle,end]=CHAINS[chain];
            const lengths=boneLengths(actor);const reach=V(...actor.points[root]).distanceTo(hit);
            if(e.altKey){actor.points[drag.joint]=hit.toArray();actor.rigLengths=boneLengths(actor);}
            else if(drag.joint===end&&reach>lengths[chain][0]+lengths[chain][1]-.001){
                const scale=(reach+.002)/(lengths[chain][0]+lengths[chain][1]);
                lengths[chain]=lengths[chain].map(length=>length*scale);actor.rigLengths=lengths;
            }
        }
        if(['head','neck','hip','ls','rs','lh','rh'].includes(drag.joint))moveBodyJoint(actor,drag.joint,hit);else if(CHAINS[chain][2]===drag.joint)solveIK(actor,chain,hit);else solveIK(actor,chain,V(...actor.points[CHAINS[chain][2]]),hit);
        actor.preset='custom';
    }else if(drag.move){
        hit.copy(drag.position).addScaledVector(drag.right,(e.clientX-drag.x)*drag.scale).addScaledVector(drag.forward,(e.clientY-drag.y)*drag.scale);
        actor.position=[clamp(hit.x,-3,3),drag.position.y,clamp(hit.z,-3,3)];
    }else if(!drag.selected){state.azimuth=(drag.a-(e.clientX-drag.x)*.42+720)%360;state.elevation=clamp(drag.e+(e.clientY-drag.y)*.25,-30,60);}
    refresh(false);
};
function endDrag(e){if(!drag)return;drag=null;if(renderer.domElement.hasPointerCapture(e.pointerId))renderer.domElement.releasePointerCapture(e.pointerId);renderer.domElement.style.cursor='default';persist();}
renderer.domElement.onpointerup=endDrag;renderer.domElement.onpointercancel=endDrag;renderer.domElement.onlostpointercapture=endDrag;
renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();if(!wheelTimer)checkpoint();state.distance=clamp(state.distance+e.deltaY*.003,1.8,30);state.zoom=ZOOM(state.distance);refresh(false);clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{wheelTimer=null;persist();},250);},{passive:false});

function screenshot(){
    renderer.render(scene,camera);const source=renderer.domElement,scale=source.width/container.clientWidth,out=document.createElement('canvas');out.width=200;out.height=Math.round(200*frameHeight/frameWidth);
    const ctx=out.getContext('2d');ctx.fillStyle='#eff2f6';ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(source,(source.width-frameWidth*scale)/2,(source.height-frameHeight*scale)/2,frameWidth*scale,frameHeight*scale,0,0,out.width,out.height);return out.toDataURL('image/jpeg',.65);
}
function renderShots(){
    $('#shot-count').textContent=shots.length;$('#shot-strip').replaceChildren();
    if(!shots.length){const empty=document.createElement('div');empty.className='empty-shots';empty.textContent='收藏当前镜头，一起保存所有人物的动作与站位。';$('#shot-strip').append(empty);}
    shots.forEach((shot,index)=>{
        const wrap=document.createElement('div');wrap.className='shot-wrap';
        const button=document.createElement('button');button.className='shot';const image=document.createElement('img');image.src=shot.image;image.alt=shot.name;
        const text=document.createElement('span'),name=document.createElement('b'),sub=document.createElement('small');name.textContent=shot.name;sub.textContent=(shot.state.people?.length||1)+' 人 · '+Math.round(shot.state.azimuth)+'°';text.append(name,sub);button.append(image,text);
        button.onclick=()=>{checkpoint();state=migrate(shot.state);selectedJoint=null;refresh();toast('已恢复所有人物与机位');};
        const remove=document.createElement('button');remove.className='delete';remove.textContent='×';remove.setAttribute('aria-label','删除'+shot.name);remove.onclick=()=>{shots.splice(index,1);renderShots();persist();};
        wrap.append(button,remove);$('#shot-strip').append(wrap);
    });
}
$('#save-shot').onclick=()=>{if(shots.length>=12){toast('最多收藏 12 个镜头');return;}shots.push({name:'镜头 '+String(shots.length+1).padStart(2,'0'),state:clone(state),image:screenshot()});renderShots();persist();toast('已保存全部人物与机位');};
function poseCanvas(){
    const out=document.createElement('canvas');out.width=state.outputWidth;out.height=state.outputHeight;const ctx=out.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,out.width,out.height);
    const a=state.azimuth*Math.PI/180,e=state.elevation*Math.PI/180,radial=V(Math.sin(a)*Math.cos(e),Math.sin(e),Math.cos(a)*Math.cos(e));
    const sorted=[...state.people].sort((p,q)=>V(...p.position).dot(radial)-V(...q.position).dot(radial));
    for(const actor of sorted){const points=ORDER.map(name=>projectPoint(state,actor,name,out.width,out.height));
        ctx.lineCap='round';ctx.lineWidth=Math.max(2,Math.round(Math.min(out.width,out.height)/150));
        LIMBS.forEach(([a,b],index)=>{if(!points[a]||!points[b])return;ctx.strokeStyle=COLORS[index];ctx.beginPath();ctx.moveTo(...points[a]);ctx.lineTo(...points[b]);ctx.stroke();});
        points.forEach((point,index)=>{if(!point)return;ctx.fillStyle=COLORS[index];ctx.beginPath();ctx.arc(...point,Math.max(3,Math.round(Math.min(out.width,out.height)/125)),0,Math.PI*2);ctx.fill();});
    }return out;
}
$('#export-pose').onclick=()=>{const link=document.createElement('a');link.href=renderMannequinReference(state,scene,camera,avatars);link.download='fisher-mannequin-frame.png';link.click();toast('已导出拍摄框内的人偶画面');};
$('#copy-description').onclick=async()=>{try{await navigator.clipboard.writeText(buildPrompt(state,outputMode,extraPrompt));toast('已复制提示词');}catch{toast('请手动选中提示词复制');}};
let referenceForFit=null,detectedReference=null;
const fitHelp=()=>$('#fit-scope').value==='selected'?'只修改选中的人物，保留其他人物、站位和机位。':'替换全部人物，并按参考图重设画幅与机位；可撤销。';
setupReference(toast,image=>{
    referenceForFit=image;detectedReference=null;
    void sceneCube.setImage(image).catch(()=>toast('场景预览图读取失败'));
    if(image){const c=document.createElement('canvas'),scale=Math.min(1,768/Math.max(image.naturalWidth,image.naturalHeight));c.width=Math.round(image.naturalWidth*scale);c.height=Math.round(image.naturalHeight*scale);c.getContext('2d').drawImage(image,0,0,c.width,c.height);state.scenePreview=c.toDataURL('image/jpeg',.85);}
    else delete state.scenePreview;
    $('#reference-image').hidden=!state.people.length||!image;
    persist();
    for(const id of ['fit-reference','fit-reference-status','fit-reference-options'])$('#'+id).hidden=!image;
    $('#fit-source-label').hidden=true;$('#fit-source').replaceChildren();
    $('#fit-reference-status').textContent=fitHelp();syncUI();
});
$('#fit-scope').onchange=()=>{
    $('#fit-source-label').hidden=$('#fit-scope').value!=='selected'||!detectedReference||detectedReference.length<2;
    $('#fit-reference-status').textContent=fitHelp();syncUI();
};
$('#fit-reference').onclick=async()=>{
    if(!referenceForFit)return;
    const image=referenceForFit,button=$('#fit-reference'),status=$('#fit-reference-status');
    const scope=$('#fit-scope').value,targetId=state.selectedId;
    button.disabled=true;status.textContent='正在识别骨架…';
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    try {
        const firstDetection=!detectedReference,detected=detectedReference||readSkeletonImage(image);
        if(image!==referenceForFit)return;
        detectedReference=detected;
        if(firstDetection){
            $('#fit-source').replaceChildren(...detected.map((_,index)=>{const option=document.createElement('option');option.value=index;option.textContent='从左到右第 '+(index+1)+' 人';return option;}));
        }
        $('#fit-source-label').hidden=scope!=='selected'||detected.length<2;
        if(scope==='selected'&&detected.length>1&&firstDetection){
            status.textContent=`识别到 ${detected.length} 人，请选择图中的人物，再点击适配。当前场景未改动。`;return;
        }
        if(scope!==$('#fit-scope').value||targetId!==state.selectedId){status.textContent='选择已改变，请重新点击适配。';return;}
        const fitted=scope==='selected'
            ?fitSelectedSkeleton(state,detected[Number($('#fit-source').value)||0],image.naturalWidth,image.naturalHeight,targetId)
            :fitSkeleton(state,detected,image.naturalWidth,image.naturalHeight);
        if(detected.warnings?.length)for(const actor of fitted.people)if(scope==='scene'||actor.id===targetId)actor.importNotes={warnings:detected.warnings,inferredJoints:detected.inferredJoints||[]};
        checkpoint();state=fitted;selectedJoint=null;refresh();
        status.textContent=scope==='selected'?`已适配 ${person().name}，其他人物与机位保持原样；可撤销。`:`已重建 ${detected.length} 人与构图；可撤销。`;
        if(detected.warnings?.length){
            const names={...JOINT_NAMES,head:'头部',neck:'颈部',rs:'右肩',ls:'左肩',rh:'右髋',lh:'左髋'};
            const details=(detected.inferredJoints||[]).map(key=>names[key]||key).join('、');
            status.textContent+=' 近似补全'+(details?'（'+details+'）':'')+'，请检查后微调。';
        }
        $('#selection-hint').textContent=person().name+' · 拖身体移动，拖关节摆姿';
        toast('骨架已适配到人偶');
    } catch(error){status.textContent=error.message;toast('暂未应用，原姿势已保留');}
    finally {button.disabled=false;}
};

function load(payload){
    const saved=JSON.parse(payload.scene_json||'{}');state=migrate(saved.state||saved);shots=(saved.shots||[]).map(shot=>({...shot,state:migrate(shot.state)}));
    state.qwenBinding=payload.qwenBinding||null;
    void sceneCube.setImage(payload.referencePreview||state.scenePreview||null).catch(()=>toast('上游图片尚未就绪，可在左侧上传预览图'));
    state.outputWidth=Number(payload.width);state.outputHeight=Number(payload.height);outputMode=payload.output_mode;extraPrompt=payload.extra_prompt||'';history=[];future=[];selectedJoint=null;refresh(false);renderShots();$('#save-status').textContent='已载入节点设置';
}
function serialize(){return JSON.stringify({version:3,state,shots,poseReference:renderMannequinReference(state,scene,camera,avatars),cameraPreview:renderMannequinReference(state,scene,camera,avatars,true)});}
window.addEventListener('message',event=>{
    if(event.source!==parent||event.origin!==location.origin||event.data?.type!=='fisher-load')return;
    try{load(event.data.payload);}catch(error){$('#save-status').textContent='场景读取失败：'+error.message;$('#apply-editor').disabled=true;}
});
$('#cancel-editor').onclick=()=>parent.postMessage({type:'fisher-close'},location.origin);
$('#apply-editor').onclick=()=>{
    if(!$('#output-width').checkValidity()||!$('#output-height').checkValidity()){toast('宽高应为 64–4096 的整数');return;}
    parent.postMessage({type:'fisher-apply',payload:{scene_json:serialize(),output_mode:outputMode,width:state.outputWidth,height:state.outputHeight,extra_prompt:extraPrompt}},location.origin);
};
if(!embedded){try{const saved=JSON.parse(localStorage.getItem(storageKey)||'null');if(saved){state=migrate(saved.state);shots=saved.shots||[];outputMode=saved.outputMode||outputMode;extraPrompt=saved.extraPrompt||'';}}catch{}$('#apply-editor').hidden=true;$('#cancel-editor').hidden=true;}
void sceneCube.setImage(state.scenePreview||null).catch(()=>{});
refresh(false);renderShots();
function render(){renderer.render(scene,camera);requestAnimationFrame(render);}render();
window.poseStudio={snapshot:()=>clone(state),serialize,load,boneLengths:()=>state.people.map(p=>({id:p.id,lengths:boneLengths(p)})),prompt:()=>buildPrompt(state,outputMode,extraPrompt),
    joints:()=>Object.fromEntries(state.people.map(p=>{const avatar=avatars.get(p.id),r=renderer.domElement.getBoundingClientRect();return [p.id,Object.fromEntries(Object.keys(JOINT_NAMES).map(name=>{const q=avatar.group.localToWorld(V(...p.points[name])).project(camera);return [name,{x:r.left+(q.x+1)*r.width/2,y:r.top+(1-q.y)*r.height/2}];}))];})),
    projected:()=>Object.fromEntries(state.people.map(p=>[p.id,Object.fromEntries(ORDER.map(name=>{const local=V(...p.points[name]);if(name==='head')local.add(V(0,-.005,.11));const v=avatars.get(p.id).group.localToWorld(local).project(camera);const x=(v.x+1)*container.clientWidth/2,y=(1-v.y)*container.clientHeight/2;return [name,[(x-(container.clientWidth-frameWidth)/2)/frameWidth*state.outputWidth,(y-(container.clientHeight-frameHeight)/2)/frameHeight*state.outputHeight]];}))])),
};
if(embedded)parent.postMessage({type:'fisher-ready'},location.origin);
