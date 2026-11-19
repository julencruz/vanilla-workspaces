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
  create:async o=>{if(o.url&&o.url.startsWith('about:')&&o.url!=='about:blank')throw new Error('Illegal URL: '+o.url);if(!o.url)o={...o,url:'about:newtab'};const t={id:nextId++,windowId:o.windowId,index:tabs.length,active:!!o.active,url:o.url,pinned:!!o.pinned};if(o.active)tabs.forEach(x=>x.active=false);tabs.push(t);setTimeout(()=>L.created({...t}),0);return t},
  update:async(id,o)=>{if(o.active){tabs.forEach(x=>x.active=x.id===id)}if(o.pinned!==undefined){tabs.find(x=>x.id===id).pinned=o.pinned}},
  show:async ids=>[].concat(ids).forEach(i=>hidden.delete(i)),hide:async ids=>[].concat(ids).forEach(i=>{if(tabs.find(t=>t.id===i)?.active)return;hidden.add(i)}),get:async id=>{const t=tabs.find(x=>x.id===id);return t?{...t,hidden:hidden.has(id)}:null},
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



// --- empty workspace with real Firefox restriction on about: URLs
store.workspaces=["General","Empty"]; store.tabWorkspaces={1:"General",2:"General"};
tabs=[1,2].map((id,i)=>({id,windowId:1,index:i,active:id===1,url:`https://s${id}.test`}));
wv["1vanilla-active-workspace"]="General";
await msg("switch-workspace",{workspace:"Empty"});
await new Promise(r=>setTimeout(r,500));
assert(wv["1vanilla-active-workspace"]==="Empty","switched to Empty");
assert(hidden.has(1)&&hidden.has(2),"General tabs hidden when entering empty workspace");
const nt=tabs.filter(t=>store.tabWorkspaces[t.id]==="Empty");
assert(nt.length===1&&nt[0].active&&!hidden.has(nt[0].id),"one visible active New Tab owned by Empty");

// --- even if the New Tab cannot be created, tabs are still hidden
const realCreate=browser.tabs.create;
browser.tabs.create=async()=>{throw new Error("boom")};
store.workspaces.push("Broken");
await msg("switch-workspace",{workspace:"Broken"});
assert(hidden.has(1)&&hidden.has(2),"tabs still hidden if New Tab creation fails");
browser.tabs.create=realCreate;

// --- pinned tabs
store.pinnedTabs=[];
tabs=[{id:1,windowId:1,index:0,active:true,pinned:false,url:"https://s1.test"},{id:2,windowId:1,index:1,active:false,pinned:false,url:"https://calendar.google.com/"}];
store.tabWorkspaces={1:"General",2:"General"}; wv["1vanilla-active-workspace"]="General"; hidden.clear();
let r=await msg("add-pinned-tab",{url:"calendar.google.com"});
assert(r?.ok&&store.pinnedTabs.length===1,"pinned entry saved");
assert(tabs.find(t=>t.id===2).pinned===true,"existing open tab gets pinned instead of duplicated");
assert(tabs.filter(t=>t.url.includes("calendar.google")).length===1,"no duplicate created");
r=await msg("add-pinned-tab",{url:"https://mail.example.com/inbox"});
assert(tabs.some(t=>t.url==="https://mail.example.com/inbox"&&t.pinned),"missing pinned tab is created pinned");
assert(!(await msg("add-pinned-tab",{url:"javascript:alert(1)"})),"non-web addresses rejected");
// closing a pinned tab brings it back
const mail=tabs.find(t=>t.url.includes("mail.example"));
await browser.tabs.remove(mail.id); await L.removed(mail.id,{windowId:1,isWindowClosing:false});
await new Promise(r=>setTimeout(r,900));
assert(tabs.some(t=>t.url==="https://mail.example.com/inbox"&&t.pinned),"closed pinned tab is recreated");
// unpinned by user -> re-pinned by the alarm
tabs.find(t=>t.id===2).pinned=false;
await new Promise(r=>setTimeout(r,4200));
await L.alarm({name:"auto-close-stale-tabs"}); await new Promise(r=>setTimeout(r,100));
assert(tabs.find(t=>t.id===2).pinned===true,"tab unpinned by user is pinned again");
// remove from list stops enforcement
await msg("remove-pinned-tab",{id:store.pinnedTabs[0].id});
assert(store.pinnedTabs.length===1&&!store.pinnedTabs.some(e=>e.url.includes("calendar")),"entry removed from the list");
// pinned tabs never hidden/duplicated when switching workspace
store.workspaces=["General","Work"];
await msg("switch-workspace",{workspace:"Work"});
assert(tabs.filter(t=>t.pinned).every(t=>!hidden.has(t.id)),"pinned tabs stay visible in every workspace");
console.log("ALL OK");
