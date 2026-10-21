// Roleplay app – 10 vrstev paměti, IndexedDB (neomezeně), lokální AI přes WebLLM
const LAYERS=['1 Aktuální scéna','2 Krátkodobá paměť','3 Shrnutí kapitol','4 Postavy','5 Vztahy','6 Svět / lokace','7 Události / timeline','8 Předměty / stav','9 Tajemství / zápletky','10 Kánon / lore'];
const $=id=>document.getElementById(id);
let db,cur=null,layer=0,engine=null,engineModel=null,busy=false;
const cfg=Object.assign({model:'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',budget:6000,auto:true},JSON.parse(localStorage.rpcfg||'{}'));
// ---------- DB ----------
function open(){return new Promise((r,j)=>{const q=indexedDB.open('roleplay10',1);q.onupgradeneeded=()=>{const d=q.result;d.createObjectStore('stories',{keyPath:'id'});
 d.createObjectStore('msgs',{keyPath:'id',autoIncrement:true}).createIndex('s','storyId');d.createObjectStore('mem',{keyPath:'id',autoIncrement:true}).createIndex('s','storyId');};q.onsuccess=()=>r(q.result);q.onerror=j;});}
const tx=(st,m='readonly')=>db.transaction(st,m).objectStore(st);
const P=q=>new Promise((r,j)=>{q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});
const all=st=>P(tx(st).getAll());const bySt=(st,id)=>P(tx(st).index('s').getAll(id));
const put=(st,o)=>P(tx(st,'readwrite').put(o));const del=(st,k)=>P(tx(st,'readwrite').delete(k));
// ---------- WebGPU / model ----------
const hasGPU=!!navigator.gpu;
async function loadEngine(){
 if(!hasGPU)throw new Error('nogpu');
 if(engine&&engineModel===cfg.model)return engine;
 const webllm=await import('https://esm.run/@mlc-ai/web-llm');
 $('progress').style.display='block';
 const cb=p=>{$('bar').style.width=Math.round((p.progress||0)*100)+'%';$('ptext').textContent=p.text;};
 if(engine){await engine.reload(cfg.model);}else engine=await webllm.CreateMLCEngine(cfg.model,{initProgressCallback:cb});
 engineModel=cfg.model;$('progress').style.display='none';setMode();return engine;}
function setMode(){$('mode').textContent=!hasGPU?'⚠ Tvůj prohlížeč nepodporuje WebGPU – běží ruční režim (AI nedostupná). Zkus Chrome/Edge.':engine?'🟢 Lokální AI: '+engineModel:'⚪ Lokální AI nenačtena (načte se při prvním použití)';}
async function llm(messages,max=600){const e=await loadEngine();const r=await e.chat.completions.create({messages,temperature:.8,max_tokens:max});return r.choices[0].message.content.trim();}
// ---------- relevance ----------
const toks=s=>(s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').match(/[a-z0-9]{3,}/g)||[]);
function score(text,qset){let s=0;for(const t of toks(text))if(qset.has(t))s++;return s;}
async function buildContext(query){
 const mem=await bySt('mem',cur.id),q=new Set(toks(query)),budget=cfg.budget;let out='',used=0;
 // vrstva 1 a 4 vždy, ostatní dle relevance + čerstvosti
 for(let L=0;L<10;L++){let es=mem.filter(m=>m.layer===L);
  es=es.map(m=>({m,s:score(m.text,q)*3+(L<2?m.id/1e9:0)+((L===0||L===3||L===9)?2:0)})).sort((a,b)=>b.s-a.s||b.m.id-a.m.id);
  const cap=budget*(L===0?.15:L===1?.15:.09);let part='',pu=0;
  for(const {m} of es){if(pu+m.text.length>cap)continue;part+='- '+m.text+'\n';pu+=m.text.length;}
  if(part){out+=`## ${LAYERS[L]}\n${part}`;used+=pu;}}
 return out;}
// ---------- render ----------
async function renderStories(){const ss=(await all('stories')).sort((a,b)=>b.updated-a.updated);$('stories').innerHTML='';
 for(const s of ss){const li=document.createElement('li');li.className=cur&&cur.id===s.id?'act':'';li.innerHTML=`<span>${esc(s.name)}</span><span><span class="x" data-r>✎</span> <span class="x" data-d>🗑</span></span>`;
  li.onclick=e=>{if(e.target.dataset.r!==undefined)return rename(s);if(e.target.dataset.d!==undefined)return remove(s);select(s.id)};$('stories').append(li);}}
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
async function select(id){cur=(await all('stories')).find(s=>s.id===id);localStorage.rplast=id;$('storyTitle').textContent=cur?cur.name:'Vyber nebo vytvoř příběh';renderStories();renderChat();renderMem();renderChars();}
async function renderChat(){$('chat').innerHTML='';if(!cur)return;for(const m of await bySt('msgs',cur.id)){const d=document.createElement('div');d.className='msg '+(m.role==='user'?'user':'');
 d.innerHTML=`<span class="del" title="Smazat">✕</span><b>${esc(m.speaker)}</b>${esc(m.text)}`;d.querySelector('.del').onclick=async()=>{await del('msgs',m.id);renderChat()};$('chat').append(d);}
 $('chat').scrollTop=1e9;}
function renderChars(){const c=cur?.chars||[];$('chars').textContent=c.join(', ')||'—';$('speaker').innerHTML=['Já (hráč)',...c,'Vypravěč'].map(x=>`<option>${esc(x)}</option>`).join('');}
async function renderMem(){$('tabs').innerHTML='';const mem=cur?await bySt('mem',cur.id):[];
 LAYERS.forEach((n,i)=>{const b=document.createElement('button');b.textContent=n+' ('+mem.filter(m=>m.layer===i).length+')';b.className=i===layer?'act':'';b.onclick=()=>{layer=i;$('memSearch').value='';renderMem()};$('tabs').append(b);});
 const q=$('memSearch').value.trim().toLowerCase();let es=q?mem.filter(m=>m.text.toLowerCase().includes(q)):mem.filter(m=>m.layer===layer);
 $('layerView').innerHTML='';for(const m of es.sort((a,b)=>b.id-a.id)){const d=document.createElement('div');d.className='entry';
  let t=esc(m.text);if(q)t=t.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),x=>`<mark>${x}</mark>`);
  d.innerHTML=`<span class="ops"><span data-e>✎</span><span data-d>🗑</span></span><small>${LAYERS[m.layer]} · ${new Date(m.ts).toLocaleString('cs')}</small>${t}`;
  d.querySelector('[data-e]').onclick=async()=>{const n=prompt('Upravit záznam:',m.text);if(n!=null){m.text=n;await put('mem',m);renderMem()}};
  d.querySelector('[data-d]').onclick=async()=>{if(confirm('Smazat záznam?')){await del('mem',m.id);renderMem()}};$('layerView').append(d);}}
// ---------- actions ----------
async function newStory(){const name=prompt('Název příběhu:','Nový příběh');if(!name)return;const s={id:crypto.randomUUID(),name,chars:[],created:Date.now(),updated:Date.now()};await put('stories',s);
 const premise=prompt('Úvodní premisa / svět (volitelné):');if(premise)await addMem(9,premise,s.id);select(s.id);}
async function rename(s){const n=prompt('Nový název:',s.name);if(n){s.name=n;await put('stories',s);select(s.id)}}
async function remove(s){if(!confirm('Smazat příběh „'+s.name+'“ včetně paměti?'))return;for(const m of await bySt('msgs',s.id))await del('msgs',m.id);for(const m of await bySt('mem',s.id))await del('mem',m.id);await del('stories',s.id);if(cur?.id===s.id)cur=null;select(null);}
const addMem=(L,text,sid=cur.id)=>put('mem',{storyId:sid,layer:L,text,ts:Date.now()});
async function addMsg(role,speaker,text){await put('msgs',{storyId:cur.id,role,speaker,text,ts:Date.now()});cur.updated=Date.now();await put('stories',cur);
 await addMem(1,speaker+': '+text);}
async function send(e){e?.preventDefault();if(!cur)return alert('Nejdřív vytvoř příběh.');const t=$('input').value.trim();if(!t)return;$('input').value='';
 const sp=$('speaker').value;await addMsg('user',sp,t);renderChat();await afterTurn(sp+': '+t);renderMem();if(hasGPU)generate();}
async function generate(){if(!cur||busy)return;if(!hasGPU)return alert('WebGPU není v tomto prohlížeči dostupné, AI nelze spustit. Pokračuj v ručním režimu – piš za všechny postavy sám a paměť spravuj v pravém panelu. (Pro AI použij aktuální Chrome nebo Edge.)');
 busy=true;$('genBtn').textContent='⏳ Píšu…';try{const msgs=await bySt('msgs',cur.id);const recent=msgs.slice(-12);const q=recent.map(m=>m.text).join(' ');
 const ctx=await buildContext(q);
 const sys=`Jsi vypravěč a hráč všech postav kromě hráče v interaktivním roleplay příběhu „${cur.name}“. Piš česky, živě, v přítomném čase, 1–3 odstavce. Nikdy nehraj za hráče. Drž se paměti:\n${ctx}`;
 const out=await llm([{role:'system',content:sys},...recent.map(m=>({role:m.role==='user'?'user':'assistant',content:m.speaker+': '+m.text}))]);
 const text=out.replace(/^Vypravěč:\s*/,'');await addMsg('ai','Vypravěč',text);renderChat();await afterTurn('Vypravěč: '+text);renderMem();}
 catch(err){alert(err.message==='nogpu'?'WebGPU není dostupné.':'Chyba AI: '+err.message);$('progress').style.display='none';}finally{busy=false;$('genBtn').textContent='✨ AI pokračuj';}}
// po každém tahu: AI rozdělí fakta do vrstev + automatické shrnování
async function afterTurn(text){
 if(hasGPU&&engine&&cfg.auto){try{const r=await llm([{role:'system',content:'Extrahuj z textu nová trvalá fakta pro paměť příběhu. Odpověz POUZE JSON objektem s klíči "scena","postavy","vztahy","svet","udalosti","predmety","tajemstvi","lore" – hodnoty jsou pole krátkých českých vět (nebo prázdná pole).'},{role:'user',content:text}],400);
  const j=JSON.parse(r.slice(r.indexOf('{'),r.lastIndexOf('}')+1));const map={scena:0,postavy:3,vztahy:4,svet:5,udalosti:6,predmety:7,tajemstvi:8,lore:9};
  if(j.scena?.length){for(const m of (await bySt('mem',cur.id)).filter(m=>m.layer===0))await del('mem',m.id);}
  for(const k in map)for(const f of (j[k]||[]))if(typeof f==='string'&&f.trim())await addMem(map[k],f.trim());}catch(e){console.warn('paměť',e)}}
 await autoRoll();}
async function summarize(texts,what){if(hasGPU&&engine){try{return await llm([{role:'system',content:'Shrň následující česky do jednoho hutného odstavce ('+what+'), zachovej jména, fakta a důležité detaily.'},{role:'user',content:texts.join('\n')}],350)}catch(e){}}
 return '['+what+'] '+texts.map(t=>t.slice(0,160)).join(' | ');}
async function autoRoll(force){const mem=await bySt('mem',cur.id);
 const L2=mem.filter(m=>m.layer===1);if(L2.length>(force?4:30)){const old=L2.slice(0,L2.length-10);await addMem(2,await summarize(old.map(m=>m.text),'shrnutí kapitoly'));for(const m of old)await del('mem',m.id);}
 const L3=mem.filter(m=>m.layer===2);if(L3.length>(force?3:15)){const old=L3.slice(0,L3.length-5);await addMem(9,await summarize(old.map(m=>m.text),'kánon příběhu'));for(const m of old){m.layer=6;await put('mem',m);}}}
// ---------- export/import ----------
async function exportJSON(){const ss=cur?[cur]:await all('stories');const data={app:'roleplay10',version:1,stories:[]};
 for(const s of ss)data.stories.push({...s,msgs:await bySt('msgs',s.id),mem:await bySt('mem',s.id)});
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,1)],{type:'application/json'}));a.download=(cur?cur.name:'pribehy')+'.json';a.click();}
async function importJSON(f){const d=JSON.parse(await f.text());for(const s of d.stories){const id=crypto.randomUUID();const {msgs,mem,...st}=s;await put('stories',{...st,id});
 for(const m of msgs){delete m.id;await put('msgs',{...m,storyId:id})}for(const m of mem){delete m.id;await put('mem',{...m,storyId:id})}select(id);}}
// ---------- init ----------
window.addEventListener('DOMContentLoaded',()=>{});
(async()=>{db=await open();setMode();
 $('newStory').onclick=newStory;$('sendForm').onsubmit=send;$('genBtn').onclick=generate;$('input').onkeydown=e=>{if(e.ctrlKey&&e.key==='Enter')send()};
 $('memSearch').oninput=renderMem;$('memAdd').onclick=async()=>{if(!cur)return;const t=$('memNew').value.trim();if(t){await addMem(layer,t);$('memNew').value='';renderMem()}};
 $('rollBtn').onclick=async()=>{if(cur){await autoRoll(true);renderMem()}};
 $('addChar').onclick=async()=>{if(!cur)return;const n=prompt('Jméno postavy:');if(!n)return;const d=prompt('Popis postavy (volitelné):');cur.chars.push(n);await put('stories',cur);await addMem(3,n+(d?': '+d:''));renderChars();renderMem();};
 $('exportBtn').onclick=exportJSON;$('importFile').onchange=e=>e.target.files[0]&&importJSON(e.target.files[0]);
 $('settingsBtn').onclick=()=>{$('sModel').value=cfg.model;$('sBudget').value=cfg.budget;$('sAuto').checked=cfg.auto;$('settings').showModal()};
 $('sSave').onclick=()=>{cfg.model=$('sModel').value;cfg.budget=+$('sBudget').value||6000;cfg.auto=$('sAuto').checked;localStorage.rpcfg=JSON.stringify(cfg);};
 $('loadBtn').onclick=async()=>{$('sSave').click();$('settings').close();try{await loadEngine()}catch(e){alert(e.message==='nogpu'?'WebGPU není dostupné – zůstává ruční režim.':'Chyba načtení: '+e.message)}};
 await select(localStorage.rplast||null);window.__ready=true;})();
