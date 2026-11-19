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



store.workspaces=["General","Work"]; store.tabWorkspaces={1:"General",2:"General",3:"Work",4:"Work"};
tabs=[1,2,3,4].map((id,i)=>({id,windowId:1,index:i,active:id===2,url:id===3?"https://youtube.com/watch?v=abc":`https://s${id}.test`}));
wv["1vanilla-active-workspace"]="General"; hidden.add(3); hidden.add(4);
const dup=await browser.tabs.create({windowId:1,url:"about:blank",active:true});
store.tabWorkspaces[dup.id]="General";
await L.updated(dup.id,{url:"https://youtube.com/watch?v=abc#t=5"},{...dup,windowId:1,url:"https://youtube.com/watch?v=abc#t=5"});
await new Promise(r=>setTimeout(r,500));
assert(wv["1vanilla-active-workspace"]==="Work","switched to the workspace that owns the existing tab");
assert(tabs.find(t=>t.active).id===3,"existing tab 3 is active");
assert(!tabs.some(t=>t.id===dup.id),"duplicate tab closed");
assert(!hidden.has(3)&&hidden.has(1)&&hidden.has(2),"Work tabs visible, General tabs hidden");
assert(store.tabWorkspaces[3]==="Work","existing tab stays in its workspace");

// same-workspace duplicate still works, no workspace switch
const d2=await browser.tabs.create({windowId:1,url:"about:blank",active:true});
store.tabWorkspaces[d2.id]="Work";
await L.updated(d2.id,{url:"https://s4.test"},{...d2,windowId:1,url:"https://s4.test"});
await new Promise(r=>setTimeout(r,300));
assert(tabs.find(t=>t.active).id===4&&!tabs.some(t=>t.id===d2.id),"same-workspace duplicate focuses existing tab");
assert(wv["1vanilla-active-workspace"]==="Work","no needless workspace switch");

// allowed-duplicate rule is respected
store.duplicateRules=[{id:"x",type:"domain",value:"allowed.test"}];
tabs.push({id:900,windowId:1,index:9,active:false,url:"https://allowed.test/a"}); store.tabWorkspaces[900]="General";
const d3=await browser.tabs.create({windowId:1,url:"about:blank",active:true});
store.tabWorkspaces[d3.id]="Work";
await L.updated(d3.id,{url:"https://allowed.test/a"},{...d3,windowId:1,url:"https://allowed.test/a"});
await new Promise(r=>setTimeout(r,200));
assert(tabs.some(t=>t.id===d3.id),"duplicate rule still allows duplicates");
console.log("ALL OK");
