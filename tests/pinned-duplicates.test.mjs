import vm from "node:vm"; import fs from "node:fs";
const dir=new URL("../",import.meta.url).pathname;
const files=JSON.parse(fs.readFileSync(dir+"manifest.json")).background.scripts;
const L={}, store={}, tv={}, wv={}, removed=[], hidden=new Set(), scripts=[];
let tabs=[], nextId=100;
const ev=n=>({addListener:f=>L[n]=f});
const browser={
 storage:{local:{get:async d=>({...JSON.parse(JSON.stringify(d)),...JSON.parse(JSON.stringify(store))}),set:async v=>Object.assign(store,JSON.parse(JSON.stringify(v)))}},
 sessions:{getTabValue:async(i,k)=>tv[i+k],setTabValue:async(i,k,v)=>{tv[i+k]=v},removeTabValue:async(i,k)=>{delete tv[i+k]},getWindowValue:async(i,k)=>wv[i+k],setWindowValue:async(i,k,v)=>{wv[i+k]=v}},
 tabs:{query:async q=>tabs.filter(t=>(!q.windowId||t.windowId===q.windowId)&&(q.active===undefined||t.active===q.active)).map(t=>({...t,hidden:hidden.has(t.id)})),
  remove:async ids=>{ids=[].concat(ids);removed.push(...ids);tabs=tabs.filter(t=>!ids.includes(t.id))},
  create:async o=>{const t={id:nextId++,windowId:o.windowId,index:tabs.length,active:!!o.active,url:o.url};if(o.active)tabs.forEach(x=>x.active=false);tabs.push(t);setTimeout(()=>L.created({...t}),0);return t},
  update:async(id,o)=>{if(o.active){tabs.forEach(x=>x.active=x.id===id)}},
  show:async ids=>ids.forEach(i=>hidden.delete(i)),hide:async ids=>ids.forEach(i=>{if(tabs.find(t=>t.id===i)?.active)return;hidden.add(i)}),get:async id=>{const t=tabs.find(x=>x.id===id);return t?{...t,hidden:hidden.has(id)}:null},
  onCreated:ev("created"),onRemoved:ev("removed"),onActivated:ev("activated"),onUpdated:ev("updated")},
 scripting:{executeScript:async o=>{scripts.push([o.target.tabId,o.func.name])}},
 windows:{onCreated:ev("wcreated"),getAll:async()=>[{id:1,type:"normal"}],get:async id=>({id,type:"normal"}),getLastFocused:async()=>({id:1}),onRemoved:ev("x")},
 action:{setIcon:async()=>{},setBadgeText:async()=>{},setTitle:async()=>{}},
 contextMenus:{removeAll:async()=>{},create:()=>{},update:async()=>{},refresh:()=>{},onClicked:ev("cm"),onShown:ev("cs")},
 alarms:{onAlarm:ev("alarm"),create:async()=>{}},
 runtime:{getURL:p=>p,onInstalled:ev("i"),onStartup:ev("s"),onMessage:ev("msg")},
 commands:{onCommand:ev("cmd")}};
const ctx={browser,OffscreenCanvas:class{getContext(){return new Proxy({}, {get:()=>()=>({}),set:()=>true})}},URL,Date,Set,Map,Object,Array,Promise,JSON,crypto:{randomUUID:()=>"id"+Math.random()},console,setTimeout,String,Number,Math};
vm.createContext(ctx);
for(const f of files) vm.runInContext(fs.readFileSync(dir+f,"utf8"),ctx,{filename:f});
const assert=(c,m)=>{if(!c)throw new Error("FAIL: "+m);console.log("ok -",m)};
const msg=(type,x={})=>L.msg({type,windowId:1,...x});
const min=60000, now=Date.now();




store.workspaces=["General","Work"]; store.tabWorkspaces={1:"General",2:"General"};
store.pinnedTabs=[{id:"p",url:"https://mail.test/"}];
wv["1vanilla-active-workspace"]="General";
tabs=[{id:1,windowId:1,index:0,active:true,pinned:false,url:"https://s1.test/"},{id:2,windowId:1,index:1,active:false,pinned:true,url:"https://mail.test/"}];

// 1. a normal tab opening a pinned tab's URL is sent to the pinned tab
const dupe=await browser.tabs.create({windowId:1,url:"about:blank",active:true});
store.tabWorkspaces[dupe.id]="General";
await L.updated(dupe.id,{url:"https://mail.test/"},{...dupe,windowId:1,url:"https://mail.test/"});
await new Promise(r=>setTimeout(r,300));
assert(!tabs.some(t=>t.id===dupe.id),"new tab with a pinned tab's URL is closed");
assert(tabs.find(t=>t.id===2).active&&tabs.find(t=>t.id===2).pinned,"the pinned tab is activated instead");

// 2. a pinned tab is never closed as a duplicate of another tab
const other=await browser.tabs.create({windowId:1,url:"about:blank",active:false});
store.tabWorkspaces[other.id]="General";
await L.updated(other.id,{url:"https://elsewhere.test/"},{...other,windowId:1,pinned:true,url:"https://elsewhere.test/"});
const twin=await browser.tabs.create({windowId:1,url:"about:blank",active:false});
store.tabWorkspaces[twin.id]="General";
await L.updated(twin.id,{url:"https://elsewhere.test/"},{...twin,windowId:1,pinned:true,url:"https://elsewhere.test/"});
await new Promise(r=>setTimeout(r,300));
assert(tabs.some(t=>t.id===other.id)&&tabs.some(t=>t.id===twin.id),"pinned tabs are never removed as duplicates");

// 3. other duplicates still collapse
tabs.push({id:900,windowId:1,index:9,active:false,pinned:false,url:"https://plain.test/"});store.tabWorkspaces[900]="General";
const plain=await browser.tabs.create({windowId:1,url:"about:blank",active:true});
store.tabWorkspaces[plain.id]="General";
await L.updated(plain.id,{url:"https://plain.test/"},{...plain,windowId:1,url:"https://plain.test/"});
await new Promise(r=>setTimeout(r,300));
assert(!tabs.some(t=>t.id===plain.id),"ordinary duplicates are still closed");

// 4. concurrent ensure calls create each missing pinned tab once
store.pinnedTabs=[{id:"p",url:"https://mail.test/"},{id:"q",url:"https://new.test/"}];
const before=tabs.filter(t=>t.url==="https://new.test/").length;
await Promise.all([ctx.ensurePinnedTabs(1,{force:true}),ctx.ensurePinnedTabs(1,{force:true}),ctx.ensurePinnedTabs(1,{force:true}),ctx.ensurePinnedTabs(1)]);
await new Promise(r=>setTimeout(r,300));
assert(before===0&&tabs.filter(t=>t.url==="https://new.test/").length===1,"simultaneous ensure calls create exactly one tab");

// 5. repeated closes never leave more than one copy
for(let i=0;i<3;i++){
  const t=tabs.find(x=>x.url==="https://new.test/");
  await browser.tabs.remove(t.id); await L.removed(t.id,{windowId:1,isWindowClosing:false});
  await new Promise(r=>setTimeout(r,900));
}
assert(tabs.filter(t=>t.url==="https://new.test/").length===1,"closing repeatedly never produces extra copies");
console.log("ALL OK");
