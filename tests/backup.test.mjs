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




store.workspaces=["General","Work"];
store.workspaceStyles={General:{icon:"G",color:"#112233"},Work:{icon:"W",color:"#445566"}};
store.workspaceFavorites={Work:[{title:"Docs",url:"https://docs.test/"}]};
store.trafficRules=[{id:"a",type:"domain",value:"glovoapp.com",workspace:"Work"}];
store.duplicateRules=[{id:"b",type:"domain",value:"docs.google.com"}];
store.pinnedTabs=[{id:"c",url:"https://calendar.google.com/",matchMode:"site"}];
store.tabWorkspaces={1:"General",2:"Work"};
tabs=[1,2].map((id,i)=>({id,windowId:1,index:i,active:id===1,url:`https://s${id}.test`}));
wv["1vanilla-active-workspace"]="General";

const backup=await msg("export-config");
assert(backup.app==="vanilla-workspaces-config"&&backup.config.workspaces.length===2,"export has format marker and workspaces");
assert(!("tabWorkspaces" in backup.config)&&!("workspaceActiveTab" in backup.config),"export excludes volatile per-tab data");

// wipe everything, then import
for(const k of Object.keys(store)) delete store[k];
const r=await msg("import-config",{data:JSON.parse(JSON.stringify(backup))});
assert(r.ok,"import accepted ("+r.summary+")");
assert(store.workspaces.join()==="General,Work","workspaces restored");
assert(store.workspaceStyles.Work.color==="#445566"&&store.workspaceStyles.General.icon==="G","styles restored");
assert(store.workspaceFavorites.Work[0].url==="https://docs.test/","favorites restored");
assert(store.trafficRules.length===1&&store.trafficRules[0].workspace==="Work","routes restored");
assert(store.duplicateRules.length===1,"duplicate rules restored");
assert(store.pinnedTabs.length===1&&store.pinnedTabs[0].matchMode==="site"&&tabs.some(t=>t.url==="https://calendar.google.com/"&&t.pinned),"pinned tab and match mode restored");

// bad inputs
const before=JSON.stringify(store);
for(const [name,bad] of [["wrong app",{app:"x",config:{}}],["no workspaces",{app:"vanilla-workspaces-config",config:{workspaces:[]}}],["not an object",null],["string",  "hello"]]){
  const res=await msg("import-config",{data:bad});
  assert(res.ok===false,"rejects: "+name);
}
assert(JSON.stringify(store)===before,"rejected imports leave config untouched");

// hostile content is sanitised
const evil={app:"vanilla-workspaces-config",config:{
 workspaces:["A","A","  ","B"],
 workspaceStyles:{A:{icon:"<script>",color:"red"}},
 workspaceFavorites:{A:[{url:"javascript:alert(1)",title:"x"},{url:"https://ok.test",title:"ok"}]},
 trafficRules:[{type:"domain",value:"x.com",workspace:"Ghost"},{type:"weird",value:"y.com",workspace:"A"},{type:"domain",value:"z.com",workspace:"A"}],
 pinnedTabs:[{url:"javascript:alert(1)"},{url:"file:///etc/passwd"},{url:"https://fine.test"}]}};
const res=await msg("import-config",{data:evil});
assert(res.ok,"mixed content imported");
assert(store.workspaces.join()==="A,B","duplicate and blank workspace names dropped");
assert(store.workspaceStyles.A.color==="#0060df","invalid colour replaced by default");
assert(store.workspaceFavorites.A.length===1&&store.workspaceFavorites.A[0].url==="https://ok.test","non-http favorites dropped");
assert(store.trafficRules.length===1&&store.trafficRules[0].value==="z.com","routes to unknown workspaces or bad types dropped");
assert(store.pinnedTabs.length===1&&store.pinnedTabs[0].url==="https://fine.test/","non-web pinned tabs dropped");
console.log("ALL OK");
