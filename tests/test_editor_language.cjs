// Run against a local server serving the repository root; no models are queued.
// Requires Playwright. FISHER_TEST_BASE and CHROME can override the defaults.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.FISHER_TEST_BASE || 'http://127.0.0.1:8765';
(async () => {
 const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
 const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base + '/');
 // A focused DOM fixture catches serialization and observer errors independently of WebGL.
 await page.evaluate(async () => {
  const {localizeEditor}=await import('/web/editor_i18n.mjs');
  document.body.innerHTML=`<button id="label">取消</button><select id="mode"><option>仅视角</option><option>仅姿态</option></select><textarea id="extra">取消，保留服装</textarea><p id="description">仅视角，人物 1</p><span data-i18n-skip id="name">取消</span><p id="status"></p><button title="撤销 Ctrl+Z" id="attr">↶ 撤销</button>`;
  window.translation=localizeEditor();window.translation.setLocale('en');
 });
 assert.equal(await page.locator('#label').textContent(),'Cancel');
 assert.equal(await page.locator('#mode').inputValue(),'仅视角');
 assert.equal(await page.locator('#mode option').first().textContent(),'Camera Only');
 assert.equal(await page.locator('#extra').inputValue(),'取消，保留服装');
 assert.equal(await page.locator('#description').textContent(),'仅视角，人物 1');
 assert.equal(await page.locator('#name').textContent(),'取消');
 await page.evaluate(()=>{document.querySelector('#status').textContent='正在编辑人物 2（使用人物 2 的照片）。'});
 await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Editing'));
 await page.evaluate(()=>translation.setLocale('zh-TW'));
 assert.equal(await page.locator('#label').textContent(),'取消');
 assert.equal(await page.locator('#status').textContent(),'正在编辑人物 2（使用人物 2 的照片）。');
 assert.equal(await page.locator('#attr').getAttribute('title'),'撤销 Ctrl+Z');
 await page.evaluate(()=>translation.setLocale('en'));
 await page.evaluate(()=>{document.querySelector('#status').textContent='已保存「我的姿势 $&」';});
 await page.waitForFunction(()=>document.querySelector('#status').textContent==='Saved “我的姿势 $&”');
 await page.evaluate(()=>translation.setLocale('zh'));
 assert.equal(await page.locator('#status').textContent(),'已保存「我的姿势 $&」');
 await page.evaluate(()=>translation.disconnect());
 console.log('DOM fixture: locale round trip, dynamic messages, original options, prompts, user names, attributes passed');
 // Exercise the real extension against a minimal ComfyUI settings/graph host.
 await page.goto(base + '/');
 await page.route('**/scripts/app.js', route => route.fulfill({contentType:'text/javascript',body:'export const app = window.testApp;'}));
 await page.route('**/scripts/api.js', route => route.fulfill({contentType:'text/javascript',body:'export const api = {fetchApi: (...args) => fetch(...args)};'}));
 await page.route('**/fisher_pose/env', route => route.fulfill({json:{qwen21:true,splat:true,freePoseBindingVersion:2,version:'0.36.0'}}));
 await page.evaluate(async () => {
  window.testLocale='en';
  const settings = new EventTarget();
  settings.getSettingValue = () => window.testLocale;
  window.testApp={ui:{settings},graph:{_nodes:[],links:{},getNodeById:()=>null,setDirtyCanvas:()=>{}},
   graphToPrompt:async()=>({output:{'1':{class_type:'FisherQwenFreePose',inputs:{reference_image:['2',0]}}}}),
   extensionManager:{toast:{add:message=>{throw new Error(message.detail)}}},
   registerExtension:extension=>{window.testExtension=extension}};
  await import('/web/fisher_pose.js');
  window.testExtension.setup();
  class Node {
   constructor(){this.id=1;this.type='FisherQwenFreePose';this.graph=window.testApp.graph;this.inputs=[];this.outputs=[{name:'姿势数据',links:[]}];
    this.widgets=[{name:'pose_json',value:'{}'},{name:'extra_prompt',value:'保留衣服'}];}
   addWidget(type,name,value,callback,options){const w={type,name,value,callback,options};this.widgets.push(w);return w;}
  }
  await window.testExtension.beforeRegisterNodeDef(Node,{name:'FisherQwenFreePose'});
  window.testNode=new Node();window.testNode.onNodeCreated();window.testApp.graph._nodes.push(window.testNode);
  window.testButton=window.testNode.widgets.find(w=>w.type==='button');
  window.testButton.callback();
 });
 await page.waitForSelector('dialog iframe');
 const embedded=page.frameLocator('dialog iframe');
 await embedded.locator('#loading[hidden]').waitFor({state:'attached',timeout:90000});
 assert.equal(await page.evaluate(()=>testButton.label),'Edit Pose & Camera');
 assert.equal(await embedded.locator('#generate-editor').textContent(),'Apply & Generate');
 const original=await page.evaluate(()=>testNode.widgets.map(w=>({name:w.name,value:w.value})));
 await page.evaluate(()=>{testLocale='zh';testApp.ui.settings.dispatchEvent(new CustomEvent('Comfy.Locale.change',{detail:{value:testLocale}}))});
 await embedded.locator('#generate-editor').filter({hasText:'应用并生成'}).waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>testButton.label),'编辑姿势与镜头');
 await page.evaluate(()=>{testLocale='en'}); // No event: store-only compatibility path.
 await embedded.locator('#generate-editor').filter({hasText:'Apply & Generate'}).waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>testButton.label),'Edit Pose & Camera');
 assert.deepEqual(await page.evaluate(()=>testNode.widgets.map(w=>({name:w.name,value:w.value}))),original);
 assert.equal(await page.evaluate(()=>testNode.outputs[0].name),'姿势数据');
 if(process.env.FISHER_SCREENSHOT_DIR)await page.screenshot({path:`${process.env.FISHER_SCREENSHOT_DIR}/fisher-embedded-en.png`});
 await embedded.locator('#cancel-editor').click();
 await page.waitForSelector('dialog',{state:'detached'});
 console.log('Extension host: Comfy.Locale events and store-only changes synchronized iframe and button labels; widget values and connection names preserved');

 for(const name of ['freepose','studio']) {
  await page.goto(`${base}/web/editor/${name}.html?lang=en`);
  await page.waitForFunction(()=>document.documentElement.lang==='en');
  await page.waitForFunction(()=>document.querySelector('#cancel-editor').textContent==='Cancel');
  if(name==='freepose')await page.waitForFunction(()=>window.freePose?.viewer?.skinnedMesh && document.querySelector('#loading').hidden,null,{timeout:90000});
  else await page.waitForTimeout(2000);
  if(name==='freepose') {
   assert.equal(await page.locator('#camera-switch-wrap .fp-toggle').textContent(),'Generate Camera View');
   assert.equal(await page.locator('#auto-fit').locator('..').textContent(),'Auto Fit Full Body');
   assert.match(await page.locator('#tz').locator('..').locator('.slider-label').last().textContent(),/^Depth \(Far ← → Near\)/);
   await page.evaluate(()=>{document.querySelector('#detection-status').textContent='识别完成：可应用 6 段肢体。未识别的部位保持人偶现有姿势。'});
   await page.waitForFunction(()=>document.querySelector('#detection-status').textContent.startsWith('Detection complete: 6'));
  }
  const before=await page.evaluate(()=>({state:JSON.stringify(window.freePose?.doc || window.poseStudio?.snapshot()),description:document.querySelector('#description').textContent, values:[...document.querySelectorAll('select')].map(s=>[s.id,s.value,[...s.options].map(o=>o.value)])}));
  const uncovered=await page.evaluate(()=>{
   const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);const out=[];
   while(walk.nextNode()){const n=walk.currentNode; if(!n.parentElement.closest('script,style,textarea,input,[data-i18n-skip],#description') && /[\u3400-\u9fff]/.test(n.data))out.push(n.data);}
   return out;
  });
  console.log(name,'untranslated UI:',JSON.stringify(uncovered));
  if(process.env.FISHER_SCREENSHOT_DIR) await page.screenshot({path:`${process.env.FISHER_SCREENSHOT_DIR}/fisher-${name}-en.png`,fullPage:true});
  await page.evaluate(()=>window.postMessage({type:'fisher-language',locale:'zh'},location.origin));
  await page.waitForFunction(()=>document.querySelector('#cancel-editor').textContent==='取消');
  if(name==='freepose') {
   assert.equal(await page.locator('#camera-switch-wrap .fp-toggle').textContent(),'换镜头生成');
   assert.equal(await page.locator('#detection-status').textContent(),'识别完成：可应用 6 段肢体。未识别的部位保持人偶现有姿势。');
  }
  await page.evaluate(()=>window.postMessage({type:'fisher-language',locale:'en'},location.origin));
  await page.waitForFunction(()=>document.querySelector('#cancel-editor').textContent==='Cancel');
  const after=await page.evaluate(()=>({state:JSON.stringify(window.freePose?.doc || window.poseStudio?.snapshot()),description:document.querySelector('#description').textContent, values:[...document.querySelectorAll('select')].map(s=>[s.id,s.value,[...s.options].map(o=>o.value)])}));
  assert.deepEqual(after,before);
  console.log(name,'actual editor locale round trip preserved dropdown values and generated prompt');
 }
 assert.deepEqual(errors, [], 'browser runtime errors');
 console.log('No browser runtime errors');
 await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
