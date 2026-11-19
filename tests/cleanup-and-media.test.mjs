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
  create:async o=>{if(!o.url)o={...o,url:'about:newtab'};const t={id:nextId++,windowId:o.windowId,index:tabs.length,active:!!o.active,url:o.url};if(o.active)tabs.forEach(x=>x.active=false);tabs.push(t);return t},
  update:async(id,o)=>{if(o.active){tabs.forEach(x=>x.active=x.id===id)}},
  get:async id=>{const t=tabs.find(x=>x.id===id);return t?{...t,hidden:hidden.has(id)}:null},show:async ids=>ids.forEach(i=>hidden.delete(i)),hide:async ids=>ids.forEach(i=>hidden.add(i)),
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

// setup: 2 workspaces
store.workspaces=["General","Work"]; store.tabWorkspaces={1:"General",2:"General",3:"General",4:"Work",5:"Work"};
tabs=[1,2,3,4,5].map((id,i)=>({id,windowId:1,index:i,active:id===1,url:`https://s${id}.test`}));
tv["1vanilla-created-at"]=now-500*min; tv["1vanilla-last-active"]=now-1000;
tv["2vanilla-created-at"]=now-500*min; tv["2vanilla-last-active"]=now-121*min;   // visited, stale
tv["3vanilla-created-at"]=now-31*min;                                             // unvisited, stale
tv["4vanilla-created-at"]=now-500*min; tv["4vanilla-last-active"]=now-10*min;
tv["5vanilla-created-at"]=now-31*min;
await L.alarm({name:"auto-close-stale-tabs"}); await new Promise(r=>setTimeout(r,20));
assert(removed.sort().join()==="2,3,5","alarm closes stale visited+unvisited tabs only (got "+removed+")");
removed.length=0;

// switching keeps workspaces separate, nothing moves
tabs=[1,4,5].map((id,i)=>({id,windowId:1,index:i,active:id===1,url:`https://s${id}.test`}));
store.tabWorkspaces={1:"General",4:"Work",5:"Work"};
await msg("switch-workspace",{workspace:"Work"});
assert(hidden.has(1)&&!hidden.has(4)&&!hidden.has(5),"switching hides other workspace, shows own");
assert(JSON.stringify(store.tabWorkspaces)===JSON.stringify({1:"General",4:"Work",5:"Work"}),"no tab changed workspace on switch");
assert(scripts.some(s=>s[0]===1&&s[1]==="pauseMediaInPage"),"media paused in hidden workspace tab");
assert(tv["1vanilla-paused-at"],"hidden tab clock paused");

// hidden tabs never expire; time paused
tv["1vanilla-last-active"]=now-300*min; tv["1vanilla-paused-at"]=now-299*min;
await L.alarm({name:"auto-close-stale-tabs"}); await new Promise(r=>setTimeout(r,20));
assert(!removed.includes(1),"hidden-workspace tab not closed while paused");

// switch back: media resumes, idle time compensated
await msg("switch-workspace",{workspace:"General"});
assert(scripts.some(s=>s[0]===1&&s[1]==="resumeMediaInPage"),"media resumed on return");
const la=tv["1vanilla-last-active"];
assert(now-la<20*min,"paused duration excluded from inactivity (idle now ≈ "+Math.round((Date.now()-la)/min)+"m)");

// empty workspace gets own new tab
store.workspaces.push("Empty");
await msg("switch-workspace",{workspace:"Empty"});
const nt=tabs.find(t=>t.url==="about:newtab");
assert(nt&&store.tabWorkspaces[nt.id]==="Empty","empty workspace opens New Tab owned by it");
assert(tabs.filter(t=>!t.url.startsWith("about:")).every(t=>hidden.has(t.id)),"all other tabs hidden in empty workspace");

// New Tab dedup
const dup=await browser.tabs.create({windowId:1,url:"about:newtab",active:false});
await L.created(dup); await new Promise(r=>setTimeout(r,20));
assert(tabs.filter(t=>t.url==="about:newtab").length===1,"duplicate New Tab collapsed");
console.log("ALL OK");
