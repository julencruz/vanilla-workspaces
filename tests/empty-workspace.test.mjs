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
  create:async o=>{if(!o.url)o={...o,url:'about:newtab'};const t={id:nextId++,windowId:o.windowId,index:tabs.length,active:!!o.active,url:o.url};if(o.active)tabs.forEach(x=>x.active=false);tabs.push(t);setTimeout(()=>L.created({...t}),0);return t},
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


store.workspaces=["General","Work","Empty"]; store.tabWorkspaces={1:"General",2:"General",3:"General"};
tabs=[1,2,3].map((id,i)=>({id,windowId:1,index:i,active:id===2,url:`https://yt${id}.test`}));
wv["1vanilla-active-workspace"]="General";
await msg("switch-workspace",{workspace:"Empty"});
await new Promise(r=>setTimeout(r,500));
const nt=tabs.filter(t=>t.url==="about:newtab");
assert(nt.length===1,"exactly one New Tab opened in empty workspace");
assert(store.tabWorkspaces[nt[0].id]==="Empty","New Tab belongs to Empty workspace");
assert(nt[0].active,"New Tab is the active tab");
for(const id of [1,2,3]) assert(hidden.has(id),"tab "+id+" hidden (incl. previously active one)");
assert(!hidden.has(nt[0].id),"New Tab visible");
assert(wv["1vanilla-active-workspace"]==="Empty","window workspace is Empty");
// round trip
await msg("switch-workspace",{workspace:"General"});
await new Promise(r=>setTimeout(r,500));
assert(!hidden.has(2)&&hidden.has(nt[0].id),"back in General: its tabs shown, New Tab of Empty hidden");
assert(tabs.find(t=>t.active).id===2,"returns to last tab (2)");
console.log("ALL OK");
