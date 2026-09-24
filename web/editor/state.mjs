export const clone = value => JSON.parse(JSON.stringify(value));
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const BASE = {head:[0,1.79,0],neck:[0,1.55,0],ls:[.25,1.48,0],le:[.39,1.17,.03],lw:[.43,.87,.1],rs:[-.25,1.48,0],re:[-.39,1.17,.03],rw:[-.43,.87,.1],hip:[0,.95,0],lh:[.14,.94,0],lk:[.18,.51,.025],la:[.19,.08,.02],rh:[-.14,.94,0],rk:[-.18,.51,.025],ra:[-.19,.08,.02]};
export const PRESETS = [
    {id:'stand',name:'自然站立',points:BASE},
    {id:'wave',name:'抬手招呼',points:{...BASE,re:[-.48,1.62,0],rw:[-.44,1.94,.04],lw:[.41,1.04,.21]}},
    {id:'stride',name:'迈步向前',points:{...BASE,le:[.35,1.23,-.18],lw:[.32,.99,-.27],re:[-.32,1.21,.23],rw:[-.27,1.04,.5],lk:[.16,.56,.31],la:[.16,.18,.52],rk:[-.15,.5,-.17],ra:[-.15,.08,-.35]}},
    {id:'hero',name:'叉腰站姿',points:{...BASE,le:[.48,1.22,.02],lw:[.19,1.03,.1],re:[-.48,1.22,.02],rw:[-.19,1.03,.1],lk:[.24,.53,.02],la:[.33,.1,.04],rk:[-.22,.53,.02],ra:[-.3,.1,.04]}},
];
export const ORDER = ['head','neck','rs','re','rw','ls','le','lw','rh','rk','ra','lh','lk','la'];
export const LIMBS = [[1,2],[1,5],[2,3],[3,4],[5,6],[6,7],[1,8],[8,9],[9,10],[1,11],[11,12],[12,13],[1,0]];
export const COLORS = ['#ff0000','#ff5500','#ffaa00','#ffff00','#aaff00','#55ff00','#00ff00','#00ff55','#00ffaa','#00ffff','#00aaff','#0055ff','#0000ff','#5500ff'];
export const JOINT_NAMES = {head:'头部',neck:'胸部 / 弯腰',hip:'骨盆',ls:'左肩',rs:'右肩',lh:'左髋',rh:'右髋',lw:'左手腕',rw:'右手腕',la:'左脚踝',ra:'右脚踝',le:'左手肘',re:'右手肘',lk:'左膝盖',rk:'右膝盖'};
export const CHAINS = [['ls','le','lw'],['rs','re','rw'],['lh','lk','la'],['rh','rk','ra']];
export const DISTANCE = zoom => 6.8 - .5 * zoom;
export const ZOOM = distance => clamp((6.8 - distance) / .5, 0, 10);
export const newPerson = (number, position=[0,0,0]) => ({id:'p'+number,name:'人物 '+String(number).padStart(2,'0'),points:clone(BASE),bodyAngle:0,position,preset:'stand',identity:''});

export function migrate(raw={}) {
    const state = {azimuth:330,elevation:9,distance:4.3,cameraTarget:[0,1,0],mode:'model',outputWidth:768,outputHeight:1024,promptStyle:'中文编辑指令',...clone(raw)};
    if (!raw.people) state.people = [{...newPerson(1),points:clone(raw.points||BASE),bodyAngle:raw.bodyAngle||0,preset:raw.preset||'stand'}];
    if (!Array.isArray(state.people) || state.people.length>3) throw Error('场景支持 0–3 个人物');
    const ids=new Set();
    for (const person of state.people) {
        if (ids.has(person.id)) throw Error('场景人物编号重复');
        ids.add(person.id);
        for (const key of Object.keys(BASE)) if (!Array.isArray(person.points?.[key]) || person.points[key].length!==3 || !person.points[key].every(Number.isFinite)) throw Error('人物关节数据无效');
        person.position ??= [0,0,0];person.bodyAngle ??= 0;person.identity ??= '';
    }
    state.elevation=clamp(state.elevation,-30,60);
    state.zoom=raw.zoom??ZOOM(state.distance);
    state.selectedId=state.people.some(p=>p.id===raw.selectedId)?raw.selectedId:state.people[0]?.id??null;
    delete state.points;delete state.bodyAngle;delete state.preset;
    return state;
}

// The camera bins match ComfyUI-qwenmultiangle. Azimuth is scene-relative, not actor-relative.
export function cameraTerms(state) {
    const index=Math.floor((((state.azimuth%360)+360)%360+22.5)/45)%8;
    const elevation=clamp(state.elevation,-30,60);
    const vertical=elevation< -15?0:elevation<15?1:elevation<45?2:3;
    const distance=state.zoom<2?0:state.zoom<6?1:2;
    return {
        en:[['front view','front-right quarter view','right side view','back-right quarter view','back view','back-left quarter view','left side view','front-left quarter view'][index],['low-angle shot','eye-level shot','elevated shot','high-angle shot'][vertical],['wide shot','medium shot','close-up'][distance]].join(' '),
        zh:[['正面视角','右前方视角','右侧视角','右后方视角','背面视角','左后方视角','左侧视角','左前方视角'][index],['仰拍','平视','高角度','俯拍'][vertical],['远景','中景','特写'][distance]].join('，'),
    };
}

export function personFacing(state,person){
    const rad=Math.PI/180,a=state.azimuth*rad,e=state.elevation*rad,b=person.bodyAngle*rad;
    const [x,,z]=person.points.hip,[ox,,oz]=person.position,[tx,,tz]=state.cameraTarget;
    const dx=tx+state.distance*Math.sin(a)*Math.cos(e)-(ox+x*Math.cos(b)+z*Math.sin(b));
    const dz=tz+state.distance*Math.cos(a)*Math.cos(e)-(oz-x*Math.sin(b)+z*Math.cos(b));
    if(Math.hypot(dx,dz)<1e-6)return '镜头位于人物正上方或正下方，正背面不作判定';
    const angle=((Math.atan2(dx,dz)/rad-person.bodyAngle-(person.torsoFacingOffset||0))%360+360)%360;
    return ['正面朝向镜头','左前侧朝向镜头','左侧朝向镜头','左后侧朝向镜头','背面朝向镜头','右后侧朝向镜头','右侧朝向镜头','右前侧朝向镜头'][Math.floor((angle+22.5)/45)%8];
}

export function projectPoint(state, person, name, width, height) {
    let [x,y,z]=person.points[name];
    if(name==='head'){z+=.11;y-=.005;}
    const rad=Math.PI/180,a=state.azimuth*rad,e=state.elevation*rad,b=person.bodyAngle*rad;
    const [ox,oy,oz]=person.position,[tx,ty,tz]=state.cameraTarget;
    const p=[x*Math.cos(b)+z*Math.sin(b)+ox-tx,y+oy-ty,-x*Math.sin(b)+z*Math.cos(b)+oz-tz];
    const dot=v=>p.reduce((sum,value,index)=>sum+value*v[index],0);
    const depth=state.distance-dot([Math.sin(a)*Math.cos(e),Math.sin(e),Math.cos(a)*Math.cos(e)]);
    if(depth<=.05)return null;
    const t=Math.tan(37*rad/2);
    return [width/2+dot([Math.cos(a),0,-Math.sin(a)])/(2*depth*t)*height,height/2-dot([-Math.sin(a)*Math.sin(e),Math.cos(e),-Math.cos(a)*Math.sin(e)])/(2*depth*t)*height];
}

export function personConstraints(state,person,number,includePose=true){
    const facts=[`人物${number}：${personFacing(state,person)}。`];if(!includePose)return facts;
    const projected=Object.fromEntries(ORDER.map(name=>[name,projectPoint(state,person,name,1000,1000)]));
    for(const [root,middle,end,label] of [['ls','le','lw','左臂'],['rs','re','rw','右臂'],['lh','lk','la','左腿'],['rh','rk','ra','右腿']]){
        const u=person.points[root].map((v,i)=>v-person.points[middle][i]),v=person.points[end].map((v,i)=>v-person.points[middle][i]);
        const length=Math.hypot(...u)*Math.hypot(...v);if(length<1e-8){facts.push(`人物${number}${label}骨段长度为零，请调整关节。`);continue;}
        const angle=Math.acos(clamp(u.reduce((sum,x,i)=>sum+x*v[i],0)/length,-1,1))*180/Math.PI;
        const bend=angle>=160?'基本伸直':angle>=120?'轻度弯曲':angle>=60?'明显弯曲':'深度折叠';
        const [joint,tip]=label.endsWith('臂')?['肘','手腕']:['膝','脚踝'];let relation='';
        const start=projected[middle],finish=projected[end];
        if(start&&finish){
            const visible=Object.values(projected).filter(Boolean),ys=visible.map(p=>p[1]),tolerance=Math.max(5,(Math.max(...ys)-Math.min(...ys))*.06);
            const dx=finish[0]-start[0],dy=finish[1]-start[1];
            const horizontal=dx>tolerance?'向画面右侧':dx< -tolerance?'向画面左侧':'横向位置接近';
            const vertical=dy>tolerance?'向画面下方':dy< -tolerance?'向画面上方':'在画面中近似等高';
            relation=`，${tip}相对${joint}部${horizontal}、${vertical}`;
        }
        facts.push(`人物${number}自身${label}：${joint}部${bend}（内夹角约${Math.round(angle)}度）${relation}。`);
    }
    return facts;
}

export function personDescription(state,person,number,includePose=true){
    const facts=personConstraints(state,person,number,includePose);let text=facts[0];if(!includePose)return text;
    const projected=Object.fromEntries(ORDER.map(name=>[name,projectPoint(state,person,name,1000,1000)]));
    const ys=Object.values(projected).filter(Boolean).map(p=>p[1]),tolerance=ys.length?Math.max(5,(Math.max(...ys)-Math.min(...ys))*.06):5;
    const chains=[['ls','le','lw','左上臂'],['rs','re','rw','右上臂'],['lh','lk','la','左大腿'],['rh','rk','ra','右大腿']];
    chains.forEach(([root,middle,end,segment],i)=>{
        const a=projected[root],b=projected[middle],c=projected[end];
        if(a&&b){const dx=b[0]-a[0],dy=b[1]-a[1],x=dx>tolerance?'右':dx< -tolerance?'左':'',y=dy>tolerance?'下':dy< -tolerance?'上':'';text+=segment+(x||y?'向画面'+x+y+'方延伸':'在画面中的两端位置接近')+'，';}
        text+=(facts[i+1].split('：')[1]||facts[i+1]).replace(/（内夹角约\d+度）/g,'');
        if(i>=2&&b&&c&&projected.lh&&projected.rh){
            const center=(projected.lh[0]+projected.rh[0])/2,knee=b[0]-center,ankle=c[0]-center,side=i===2?'左':'右';
            if(knee*ankle<0&&Math.min(Math.abs(knee),Math.abs(ankle))>tolerance)text+=side+'小腿跨过身体在画面中的中线。';
            else if(Math.abs(knee)-Math.abs(ankle)>tolerance)text+=side+'小腿向身体在画面中的中线收回。';
            else if(Math.abs(ankle)-Math.abs(knee)>tolerance)text+=side+'小腿向身体在画面中的外侧展开。';
        }
    });return text;
}

export function buildPrompt(state, mode, extra='') {
    if(!state.people.length){
        const azimuth=((Math.round(state.azimuth)%360)+360)%360,elevation=Math.max(-30,Math.min(60,Math.round(state.elevation))),zoom=Math.max(0,Math.min(10,Math.round(state.zoom*10)/10));
        const direction=['正面','右前侧','右侧','右后侧','背面','左后侧','左侧','左前侧'][Math.floor((azimuth+22.5)/45)%8];
        const height=elevation< -15?'低机位仰视':elevation<15?'平视':elevation<45?'抬高机位俯视':'高机位俯拍',distance=zoom<2?'远景':zoom<6?'中景':'近景';
        return `根据参考图片重新呈现同一个主体，目标视角为主体的${direction}，${height}，${distance}构图。\n精确相机参数：水平环绕 ${azimuth}°（0°正面、90°主体右侧、180°背面、270°主体左侧），俯仰 ${elevation}°（正值抬高机位向下看、负值降低机位向上看），取景靠近程度 ${zoom.toFixed(1)}/10（0为远景、5为中景、10为特写）。按连续数值调整，不要量化为固定预设。\n只改变相机观察方向、高度和取景距离；保持主体身份、面部特征、服饰、道具、材质和画面风格一致。依据原图合理补全新视角可见的结构。不要用平面旋转、镜像或拉伸原图代替视角变化，不添加多视图拼版、文字或重复主体。以本段目标视角为准，其他内容要求保持不变。`+(extra.trim()?'补充要求：'+extra.trim():'');
    }
    if(state.qwenBinding){
        const {count,assignments,peEnabled}=state.qwenBinding;
        if(!count)return '请先在节点上连接人物参考图。编辑器内上传仅用于骨架适配。';
        const sources=state.people.map((p,i)=>assignments[i]==='自动'?(count===1?1:i+1):Number(assignments[i].slice(-1)));
        if(sources.some(n=>n>count)||new Set(sources).size!==count)return '人物与参考图尚未完整对应，请检查节点上的 person_1/2/3_reference 选项。';
        const labels=state.people.map((p,i)=>`人物${i+1} ← <image${sources[i]}> ${p.identity||'人物外观'}\n`+personDescription(state,p,i+1,mode!=='仅视角'));
        const order=state.people.map((p,i)=>({i,x:projectPoint(state,p,'neck',1000,1000)?.[0]??Infinity})).sort((a,b)=>a.x-b.x).map(p=>`人物${p.i+1}`).join('、');
        return (peEnabled?'PE已连接：运行时先看图扩写，再编码。\n':'未连接PE：运行时使用基础编辑指令。\n')+'接入对应关系（实际编辑指令在运行后的“实际提示词”输出查看）：\n'+labels.join('\n')+(mode==='仅视角'?'\n仅视角，不附骨架图。':`\n<image${count+1}>：内部生成的拍摄框人偶图，从左到右对应 ${order}。替换原姿势，保留外观。`)+(mode==='仅姿态'?'':`\n机位：${cameraTerms(state).zh}。`)+(extra.trim()?'\n补充要求：'+extra.trim():'');
    }
    const terms=cameraTerms(state),people=state.people,english=state.promptStyle==='Multiangle LoRA (<sks>)';
    let text;
    if(english){
        const camera='<sks> '+terms.en;
        if(mode==='仅视角')text=camera;
        else text=(mode==='视角＋姿态'?camera+'\n':'')+`Use image 1 for the appearance and identity of ${people.length} subject(s). Use image 2 as the shooting-frame mannequin pose reference (pose only, not material or background) for all subjects. Keep their identities and clothing distinct. Do not render skeleton lines or joint markers.`;
    }else{
        const camera=`将拍摄机位调整为${terms.zh}。视角方向以场景正面为基准。`;
        if(mode==='仅视角')text='以图1为人物与场景参考，保持人物身份、面部特征、发型、服装及原有身体动作一致。'+camera+'背景随新机位呈现合理的透视与遮挡关系，保持原有场景内容和视觉风格。';
        else text=`以图1为人物外观参考，画面中共${people.length}个人物，分别保留各自身份、面部特征、发型和服装，不要互换人物特征。图2为所有人物的拍摄框人偶姿态参考，只参考动作和朝向，不复制人偶材质或背景，最终画幅仍按输出设置，按照图2调整各自的肢体位置、动作和画面占比。`+(mode==='视角＋姿态'?camera:'')+'最终图像不出现骨架线条或关节点。';
    }
    if(mode!=='仅视角'&&people.length>1){
        const sorted=people.map((person,index)=>({person,index,x:projectPoint(state,person,'neck',1000,1000)?.[0]??Infinity})).sort((a,b)=>a.x-b.x);
        const labels=sorted.map(({person,index})=>person.identity.trim()||`图1中从左到右第${index+1}个人物`);
        text+=(english?'\nMannequins from left to right correspond to: ':'\n图2人偶从左到右依次对应：')+labels.join('；')+'。';
    }
    if(!english)text+='场景机位不等于人物朝向，以逐人描述为准。'+people.map((p,i)=>personDescription(state,p,i+1,mode!=='仅视角')).join('');
    return text+(extra.trim()?'\n'+(english?'Additional instructions: ':'补充要求：')+extra.trim():'');
}
