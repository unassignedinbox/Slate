/* ============================================================================
   APP — outliner, inspector, rail, command line, construct, control centre.
   Layout & behaviour ported from OutlinerPanel.cpp / InspectorPanel.cpp /
   ViewportPanel.cpp / NativeConstructPanel.h / ControlCentreHost.cpp.
   ========================================================================== */

'use strict';
const $ = id => document.getElementById(id);
const APP = {};

/* ───────────────────────────── helpers ─────────────────────────────── */
function toast(title, body){
  if (!S.notifications) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<span>${title}</span>` + (body?`<small>${body}</small>`:'');
  $('toasts').appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(()=>t.remove(),320); }, 2600);
}
const NARROW_TINT = { Lights:'#FFB454', Sky:'#5AA9FF', Bodies:'#DFE6F5', Geometry:'#E2E8F0', Camera:'#34C759' };
const CAT_LABEL = { Light:'Light', Camera:'Camera', Geometry:'Geometry', Env:'Environment', Folder:'Folder' };

/* ─────────────────────────── OUTLINER ──────────────────────────────── */
function filterActive(){ return Object.values(S.filters).some(v=>v); }
function rowPasses(n){
  if (filterActive() && !(S.filters[n.narrow])) return false;
  if (S.searchText && !n.label.toLowerCase().includes(S.searchText)) return false;
  return true;
}
function subtreePasses(n){
  if (rowPasses(n)) return true;
  return (n.children||[]).some(subtreePasses);
}

function renderTree(){
  const tree = $('tree');
  tree.innerHTML = '';
  const forceOpen = !!S.searchText || filterActive();
  const emit = (nodes, depth) => {
    for (const n of nodes){
      if (!subtreePasses(n)) continue;
      const row = document.createElement('div');
      row.className = 'trow' + (n===S.selected?' sel':'') + (!n.visible?' hidden-row':'');
      row.style.paddingLeft = (8 + 16*depth) + 'px';
      if (S.compact) row.style.height = '30px';
      const isFolder = !!n.children;
      const open = n.open || forceOpen;
      let st = n.status==='warn' ? 'warn' : n.status==='quiet' ? 'quiet' : (!n.visible ? 'err' : 'ok');
      let stIco = st==='ok' ? 'check' : st==='warn' ? 'warn' : st==='err' ? 'warn' : 'dot';
      row.innerHTML =
        `<span class="chev ${isFolder?(open?'open':''):'leaf'}">${icon('chevron',11)}</span>` +
        `<span class="ico" ${n.artTint?`style="color:${n.artTint}"`:''}>${icon(n.icon,17)}</span>` +
        `<span class="tlabel">${n.label}</span>` +
        (n.badge?`<span class="tbadge">${n.badge}</span>`:'') +
        `<span class="tvalue">${n.value||''}</span>` +
        `<span class="teye" title="Visibility">${icon(n.visible?'eye':'eyeOff',13)}</span>` +
        `<span class="tstat ${st}">${icon(stIco, st==='ok'?12:11)}</span>`;
      row.querySelector('.chev').onclick = e => {
        if (!isFolder) return;
        e.stopPropagation(); n.open = !n.open; renderTree();
      };
      row.querySelector('.teye').onclick = e => {
        e.stopPropagation(); n.visible = !n.visible;
        refreshAll(); restartAccumulation(); markDirty();
      };
      row.onclick = () => APP.select(n);
      row.ondblclick = () => frameNode(n);
      tree.appendChild(row);
      if (isFolder && open) emit(n.children, depth+1);
    }
  };
  emit(SCENE, 0);
  renderChips();
  renderCensus();
}

function renderChips(){
  const box = $('chips');
  box.innerHTML = '';
  for (const key of Object.keys(S.filters)){
    if (!S.filters[key]) continue;
    const c = document.createElement('span');
    c.className = 'chip';
    c.innerHTML = `<span class="filter-dot" style="background:${NARROW_TINT[key]}"></span>${key}<span class="chip-x">✕</span>`;
    c.querySelector('.chip-x').onclick = () => { S.filters[key]=false; refreshAll(); };
    box.appendChild(c);
  }
}

function renderFilterPop(){
  const pop = $('filter-pop');
  pop.innerHTML = '';
  for (const key of ['Lights','Sky','Bodies','Geometry','Camera']){
    const r = document.createElement('div');
    r.className = 'filter-row' + (S.filters[key]?' on':'');
    r.innerHTML = `<span class="filter-dot" style="background:${NARROW_TINT[key]}"></span>${key}` +
                  `<span class="fcheck">${icon('check',12)}</span>`;
    r.onclick = () => { S.filters[key] = !S.filters[key]; renderFilterPop(); refreshAll(); };
    pop.appendChild(r);
  }
}

function renderCensus(){
  let vis=0, hid=0, warn=0, shown=0;
  const perNarrow = {};
  eachNode(n => {
    if (effectiveVisible(n)) vis++; else hid++;
    if (n.status==='warn') warn++;
    perNarrow[n.narrow] = (perNarrow[n.narrow]||0)+1;
    if (subtreePasses(n) && rowPasses(n)) shown++;
  });
  const total = vis+hid;
  $('census-visible').textContent = vis;
  $('census-hidden').textContent = hid;
  $('outliner-sub').innerHTML = `Showcase &bull; ${total} nodes`;
  $('cf-shown').textContent = `${shown}/${total}`;
  $('cf-hidden').textContent = `${hid} hidden`;
  $('cf-hidden').style.color = hid>0 ? 'var(--orange)' : '';
  const v = $('cf-verdict');
  v.className = 'verdict ' + (warn? 'issues':'clean');
  v.innerHTML = icon(warn?'warn':'check',12) + (warn? `${warn} issue${warn>1?'s':''}` : 'clean');
  const bar = $('census-bar');
  bar.innerHTML = '';
  const tints = { Lights:'#FFB454', Sky:'#4da3ff', Bodies:'#b48cff', Geometry:'#e5d33a', Camera:'#34c759' };
  for (const k of Object.keys(perNarrow)){
    const seg = document.createElement('i');
    seg.style.width = (perNarrow[k]/total*100)+'%';
    seg.style.background = tints[k]||'#888';
    bar.appendChild(seg);
  }
}

function renderOutlinerFoot(){
  const camStr = `${CAM.target[0].toFixed(0)}, ${CAM.target[1].toFixed(1)}, ${CAM.target[2].toFixed(0)}`;
  const band = S.fps >= 50 ? 'good' : S.fps >= 24 ? '' : 'poor';
  $('outliner-foot').innerHTML = `
    <span class="foot-item w1"><span class="fl">Realtime</span><span class="fv ${band}">${S.fps}<span class="fu">fps</span></span></span>
    <span class="foot-item w1"><span class="fl">Quality</span><span class="fv">${S.quality}</span></span>
    <span class="foot-item w1"><span class="fl">Sun</span><span class="fv">${S.sunElevation.toFixed(1)}°</span></span>
    <span class="foot-item w1"><span class="fl">Moons</span><span class="fv">1/4</span></span>
    <span class="foot-item cam"><span class="fl">Cam</span><span class="fv">${camStr}</span></span>`;
}

/* ─────────────────────────── INSPECTOR ─────────────────────────────── */
function card(title, rowsHtml, open=true){
  return `<div class="card ${open?'':'closed'}"><div class="card-head">` +
         `<span class="caret">${icon('chevron',10)}</span><span class="ctitle">${title}</span></div>` +
         `<div class="card-rows">${rowsHtml}</div></div>`;
}
function sliderRow(label, id, val, min, max, step, unit, withSwitch, on){
  return `<div class="prop"><span class="plabel">${label}</span>
    <span class="spill">
      <span class="sval" id="${id}-val">${val}</span><span class="sunit">${unit||''}</span>
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}">
    </span>${withSwitch?`<span class="switch ${on?'on':''}" id="${id}-sw"></span>`:''}</div>`;
}
function kvRow(k,v){ return `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`; }
function switchRow(label,id,on){
  return `<div class="prop"><span class="plabel">${label}</span><span class="switch ${on?'on':''}" id="${id}"></span></div>`;
}
function swatchRow(label,id,hex){
  return `<div class="prop"><span class="plabel">${label}</span>
    <span class="swatch" id="${id}" style="background:${hex}"></span><span class="swatch-hex" id="${id}-hex">${hex.toUpperCase()}</span></div>`;
}
function vec3Row(label,id,v){
  return `<div class="prop"><span class="plabel">${label}</span><span class="axisvec">
    <span class="ax x"><i>X</i><input id="${id}-x" value="${v[0].toFixed(2)}"></span>
    <span class="ax y"><i>Y</i><input id="${id}-y" value="${v[1].toFixed(2)}"></span>
    <span class="ax z"><i>Z</i><input id="${id}-z" value="${v[2].toFixed(2)}"></span></span></div>`;
}
function textRow(label,value){
  return `<div class="prop"><span class="plabel">${label}</span><span class="pright">${value}</span></div>`;
}

function sheetCards(n){
  const cards = [];
  switch (n.label){
    case 'Sun':
      /* EditorProof_Inspector reference: the LIGHT sheet exactly */
      cards.push(card('Light',
        sliderRow('Intensity','pr-int',32.0,0,120,0.5,'lx',true,true) +
        swatchRow('Colour','pr-col','#ffffff')));
      cards.push(card('Aim', textRow('Direction','-Z (nadir)') +
        sliderRow('Elevation','pr-elev',S.sunElevation.toFixed(1),-10,90,0.1,'°') +
        sliderRow('Azimuth','pr-azim',S.sunAzimuth,0,360,1,'°')));
      break;
    case 'Moon':
      cards.push(card('Light', sliderRow('Intensity','pr-int',0.32,0,4,0.01,'lx',true,true) +
        swatchRow('Colour','pr-col','#dfe8ff')));
      cards.push(card('Phase', textRow('Phase','Waxing crescent · 1/4') + textRow('Angular diameter','0.52°')));
      break;
    case 'Atmosphere':
      cards.push(card('Medium', sliderRow('Air mass','pr-am',10.2,1,38,0.1,'AM') +
        sliderRow('Turbidity','pr-turb',2.4,1,10,0.1,'')));
      break;
    case 'Sky':
      cards.push(card('Sky', sliderRow('Zenith luminance','pr-lum',5.00,0,20,0.05,'kcd') +
        switchRow('Aerial perspective','pr-aerial',true)));
      break;
    case 'Stars':
      cards.push(card('Stars', sliderRow('Magnitude limit','pr-mag',1.3,-1,6.5,0.1,'mag') +
        switchRow('Twinkle','pr-twinkle',true)));
      cards.push(card('Standing', textRow('Warning','Washed out in daylight')));
      break;
    case 'Wind':
      cards.push(card('Wind', sliderRow('Speed','pr-speed',4.2,0,40,0.1,'m/s') +
        sliderRow('Direction','pr-dir',225,0,360,1,'°') + textRow('Gusting','SW · light')));
      break;
    case 'Height Fog':
      cards.push(card('Fog', sliderRow('Height','pr-h',391,0,2000,1,'m') +
        sliderRow('Density','pr-d',0.021,0,0.2,0.001,'')));
      break;
    case 'Atmospheric Fog':
      cards.push(card('Fog', sliderRow('Visibility','pr-vis',56,1,200,1,'km') +
        sliderRow('Density','pr-d',0.004,0,0.05,0.001,'')));
      break;
    case 'Clouds':
      cards.push(card('Clouds', sliderRow('Coverage','pr-cov',42,0,100,1,'%') +
        sliderRow('Density','pr-cd',0.6,0,1,0.01,'') + switchRow('Cast shadows','pr-cs',true)));
      break;
    case 'Precipitation':
      cards.push(card('Precipitation', sliderRow('Rate','pr-rate',0,0,120,1,'mm/h') +
        textRow('Inherits','Clouds parent gate')));
      break;
    case 'Rainbow':
      cards.push(card('Rainbow', sliderRow('Strength','pr-str',0.0,0,1,0.01,'×')));
      break;
    case 'Lens Flare':
      cards.push(card('Flare', sliderRow('Intensity','pr-fi',0.4,0,2,0.01,'×') +
        switchRow('Link to Sun','pr-link',true)));
      break;
    case 'Main Camera': case 'Camera': case 'Cine Camera':
      cards.push(card('Lens',
        textRow('Study', n.label==='Main Camera' ? 'LIVE PROJECTION' : 'INACTIVE STUDY') +
        sliderRow('Focal length','pr-focal', n.label==='Cine Camera'?35:24, 12, 200, 1, 'mm') +
        textRow('Field of view', n.value || '55°') +
        sliderRow('Aperture','pr-ap',2.8,1,22,0.1,'f/') +
        sliderRow('Subject','pr-subj',4.5,0.3,100,0.1,'m')));
      cards.push(card('Notes', `<div class="prop" style="color:var(--faint);font-size:10.5px">
        Aperture and focus are optical-study settings only. Lens changes on Main Camera drive the real
        perspective projection.</div>`, false));
      break;
    case 'Post Pro':
      cards.push(card('Post Process', sliderRow('Exposure comp','pr-ev',0.4,-5,5,0.1,'EV') +
        switchRow('Bloom','pr-bloom',true) + switchRow('Vignette','pr-vig',false)));
      break;
    default:
      if (n.icon==='tyre'){
        cards.push(card('Tyre',
          sliderRow('Width','pr-tw',n.value.startsWith('305')?305:245,135,355,5,'mm') +
          sliderRow('Aspect','pr-ta',n.value.startsWith('305')?30:35,20,85,5,'%') +
          sliderRow('Rim','pr-tr',21,13,24,1,'in') +
          sliderRow('Tread depth','pr-td',7.6,0,10,0.1,'mm') +
          sliderRow('Pressure','pr-tp',2.4,0.8,4,0.05,'bar')));
        cards.push(card('Carcass', textRow('Construction','Radial') + textRow('Load index','98 Y'), false));
      } else if (n.icon==='rim'){
        cards.push(card('Rim', sliderRow('Diameter','pr-rd',21,13,24,1,'in') +
          sliderRow('Spokes','pr-rs',5,3,12,1,'') + swatchRow('Finish','pr-rf','#8a8f98')));
      } else if (n.icon==='vehicle' && !n.children){
        cards.push(card('Chassis', sliderRow('Mass','pr-mass',1840,600,3500,10,'kg') +
          sliderRow('Wheelbase','pr-wb',2.96,1.8,4,0.01,'m')));
      } else if (n.icon==='suspension'){
        cards.push(card('Suspension', sliderRow('Spring rate','pr-sr',62,10,200,1,'N/mm') +
          sliderRow('Damping','pr-dp',0.32,0,1,0.01,'') + sliderRow('Travel','pr-tv',110,40,300,1,'mm')));
      } else if (n.icon==='cloth'){
        cards.push(card('Cloth', textRow('Resolution','64 × 64') +
          sliderRow('Stiffness','pr-st',0.72,0,1,0.01,'') +
          sliderRow('Damping','pr-dm',0.18,0,1,0.01,'') +
          switchRow('Wind response','pr-wr',true)));
      } else if (n.shape && n.shape.kind !== 'ground'){
        cards.push(card('Transform',
          vec3Row('Position','pr-pos', n.shape.pos) +
          sliderRow('Yaw','pr-yaw',((n.shape.yaw||0)*180/Math.PI).toFixed(0),-180,180,1,'°') +
          sliderRow('Size','pr-size',n.shape.size.toFixed(2),0.05,8,0.05,'m')));
        cards.push(card('Surface',
          swatchRow('Base colour','pr-base', hslToHex(n.shape.color)) +
          sliderRow('Roughness','pr-rough',0.62,0,1,0.01,'') +
          sliderRow('Metallic','pr-metal',0.0,0,1,0.01,'')));
      } else if (n.shape && n.shape.kind === 'ground'){
        cards.push(card('Surface', swatchRow('Base colour','pr-base','#ddd2b8') +
          sliderRow('Roughness','pr-rough',0.9,0,1,0.01,'')));
      } else if (n.children){
        cards.push(card('Collection', textRow('Children', n.children.length) +
          textRow('Visible', n.children.filter(c=>c.visible).length)));
      }
  }
  /* INSTANCE — InspectorPanel.cpp RecordSpecifics, exactly the proof */
  cards.push(`<div class="card"><div class="card-rows" style="padding-top:12px">
    <div style="font-size:10px;letter-spacing:.16em;color:var(--dim);text-transform:uppercase;margin-bottom:2px">Instance</div>
    <div class="inst-pills">
      <span class="ipill ${n.visible?'on':''}" data-pill="visible">VISIBLE</span>
      <span class="ipill ${n.locked?'on':''}" data-pill="locked">LOCKED</span>
      <span class="ipill ${n.dynamic?'on':''}" data-pill="dynamic">DYNAMIC</span>
      <span class="ipill ${n.physics?'on':''}" data-pill="physics">PHYSICS</span>
    </div>
    ${kvRow('Type', CAT_LABEL[n.cat]||n.cat)}
    ${kvRow('ID', '#'+String(n.id).padStart(3,'0'))}
  </div></div>`);
  cards.push(card('Notes', `<div class="notes"><textarea id="pr-notes" spellcheck="false">${n.notes||''}</textarea></div>`));
  return cards.join('');
}

function hslToHex(hsl){
  const m = (hsl||'').match(/hsl\((-?[\d.]+),([\d.]+)%,([\d.]+)%\)/);
  if (!m) return '#cccccc';
  let [h,s,l] = [+m[1]/360, +m[2]/100, +m[3]/100];
  const q = l < .5 ? l*(1+s) : l+s-l*s, p = 2*l-q;
  const f = t => { t=(t%1+1)%1;
    if (t<1/6) return p+(q-p)*6*t; if (t<1/2) return q;
    if (t<2/3) return p+(q-p)*(2/3-t)*6; return p; };
  const tohex = x => Math.round(x*255).toString(16).padStart(2,'0');
  return '#'+tohex(f(h+1/3))+tohex(f(h))+tohex(f(h-1/3));
}

function renderInspector(){
  const n = S.selected;
  const body = $('insp-body');
  if (!n){
    $('insp-art').innerHTML = '';
    $('insp-name').value = '';
    $('insp-cat').textContent = '—';
    body.innerHTML = `<div class="insp-empty">${icon('target',26)}<span>Nothing selected</span>
      <small>Pick an instance in the outliner.</small></div>`;
    $('insp-foot').innerHTML = `<span>&mdash;</span><span class="right">FPS <b class="good">${S.fps}</b> &middot; TRIS <b id="insp-tris">0</b></span>`;
    return;
  }
  $('insp-art').innerHTML = icon(n.icon, 20);
  $('insp-art').style.color = n.artTint || '#cfcfcf';
  $('insp-name').value = n.label;
  $('insp-cat').textContent = (CAT_LABEL[n.cat]||n.cat).toUpperCase();
  $('insp-lock').innerHTML = icon(n.locked?'lock':'unlock',13);
  $('insp-lock').classList.toggle('active', n.locked);
  $('insp-eye').innerHTML = icon(n.visible?'eye':'eyeOff',13);
  body.innerHTML = sheetCards(n);

  /* wiring */
  body.querySelectorAll('.card-head').forEach(h => h.onclick = () => h.parentElement.classList.toggle('closed'));
  body.querySelectorAll('.ipill').forEach(p => p.onclick = () => {
    const k = p.dataset.pill;
    n[k==='visible'?'visible':k] = !n[k==='visible'?'visible':k];
    refreshAll(); restartAccumulation(); markDirty();
  });
  body.querySelectorAll('.switch').forEach(sw => sw.onclick = () => sw.classList.toggle('on'));
  body.querySelectorAll('input[type=range]').forEach(r => {
    r.oninput = () => {
      const vEl = $(r.id+'-val');
      if (vEl) vEl.textContent = (+r.value) % 1 ? (+r.value).toFixed(2) : r.value;
      applyProp(n, r.id, +r.value);
    };
  });
  const notes = $('pr-notes');
  if (notes) notes.oninput = () => { n.notes = notes.value; };
  ['x','y','z'].forEach((ax,i) => {
    const el = $('pr-pos-'+ax);
    if (el) el.onchange = () => {
      const v = parseFloat(el.value);
      if (isFinite(v) && n.shape){ n.shape.pos[i] = i===2?Math.max(0,v):v; restartAccumulation(); markDirty(); }
    };
  });
  const foot = n.locked
    ? `${CAT_LABEL[n.cat]||n.cat} &middot; ${n.dynamic?'dynamic':'static'} &middot; locked`
    : `${CAT_LABEL[n.cat]||n.cat} &middot; ${n.dynamic?'dynamic':'static'}`;
  $('insp-foot').innerHTML = `<span>${foot}</span>
    <span class="right">FPS <b class="good">${S.fps}</b> &middot; TRIS <b id="insp-tris">${triCount()}</b></span>`;
}

function applyProp(n, id, v){
  if (!n) return;
  if (id==='pr-yaw' && n.shape){ n.shape.yaw = v*Math.PI/180; }
  else if (id==='pr-size' && n.shape){ n.shape.size = v; }
  else if (id==='pr-elev'){ S.sunElevation = v; n.value = v.toFixed(1)+'°'; renderTree(); renderOutlinerFoot(); }
  else if (id==='pr-azim'){ S.sunAzimuth = v; }
  else if (id==='pr-cov'){ n.value = v+'%'; renderTree(); }
  else if (id==='pr-speed'){ n.value = v.toFixed(1)+' m/s SW'; renderTree(); }
  else if (id==='pr-h'){ n.value = v+' m'; renderTree(); }
  else if (id==='pr-vis'){ n.value = v+' km'; renderTree(); }
  else return;
  restartAccumulation(); markDirty();
}

APP.inspectorSoftRefresh = () => {
  const n = S.selected;
  if (!n || !n.shape) return;
  ['x','y','z'].forEach((ax,i)=>{ const el = $('pr-pos-'+ax); if (el) el.value = n.shape.pos[i].toFixed(2); });
  const yawEl = $('pr-yaw'); if (yawEl){ yawEl.value = (n.shape.yaw||0)*180/Math.PI;
    const v = $('pr-yaw-val'); if (v) v.textContent = ((n.shape.yaw||0)*180/Math.PI).toFixed(0); }
  const szEl = $('pr-size'); if (szEl){ szEl.value = n.shape.size;
    const v = $('pr-size-val'); if (v) v.textContent = n.shape.size.toFixed(2); }
};

/* ─────────────────────────── selection ─────────────────────────────── */
APP.select = (n, opts={}) => {
  S.selected = n;
  if (n){
    /* reveal in the tree */
    let p = parentOf(n);
    while (p){ p.open = true; p = parentOf(p); }
  }
  renderTree(); renderInspector();
  markDirty();
};

/* ─────────────────────────── rail ──────────────────────────────────── */
function closeMenus(){
  document.querySelectorAll('.menu.show').forEach(m => m.classList.remove('show'));
  $('filter-pop').classList.remove('show');
  $('filter-btn').classList.remove('open');
}

function buildAddMenu(){
  const m = $('add-menu');
  m.innerHTML = '';
  for (const grp of ADD_MENU){
    const h = document.createElement('div'); h.className='mhead'; h.textContent = grp.head;
    m.appendChild(h);
    for (const [ic,label] of grp.items){
      const r = document.createElement('div'); r.className='mi';
      r.innerHTML = icon(ic,14) + `<span>${label}</span>`;
      r.onclick = () => { closeMenus(); spawnEntity(ic,label); };
      m.appendChild(r);
    }
    m.appendChild(Object.assign(document.createElement('div'),{className:'msep'}));
  }
  m.lastChild.remove();
}

const SPAWN_KIND = { box:'box', sphere:'sphere', cone:'cone', cylinder:'cylinder', torus:'cylinder',
  plane:'box', tyre:'cylinder', vehicle:'box', cloth:'cloth', rim:'cylinder', suspension:'cylinder' };
let spawnCount = 0;
function spawnEntity(ic, label, at){
  const world = SCENE.find(n=>n.label==='World');
  const kind = SPAWN_KIND[ic] || 'box';
  spawnCount++;
  const name = label.replace(/ \(.*\)| \/ .*/,'');
  const B = camBasis();
  const pos = at || [CAM.target[0]+B.F[0]*2, CAM.target[1]+B.F[1]*2, 0];
  const n = N(name + ' ' + String(spawnCount).padStart(2,'0'), {
    icon: ic, value: (KIND_TRIS[kind]||12)+' tris', dynamic:true,
    narrow: ic==='camera'||ic==='cine'?'Camera':'Geometry',
    cat: ic==='camera'||ic==='cine'?'Camera':'Geometry',
    shape: ['camera','cine','postpro','pointLight','spotLight','areaLight','atmosphere','sky','cloud',
            'localFog','wind','rainbow','lensflare','moon'].includes(ic) ? null :
      { kind, pos, size: ic==='tyre'?0.9:1.4, tall: ic==='cloth'?1:undefined,
        lay: ic==='tyre', yaw: 0, color: entryColour((Math.random()*18)|0), tris: KIND_TRIS[kind]||12 },
  });
  world.children.push(n);
  world.open = true;
  APP.select(n);
  frameNode(n);
  toast(`${n.label} constructed`, 'Appended to World · placement is a stable append-only ID');
  refreshAll();
}

function setMode(mode){
  if (S.mode === mode && mode !== 'edit') mode = 'edit';   /* toggling off returns to edit */
  S.mode = mode; S.paused = false;
  document.querySelectorAll('.modeseg').forEach(seg => {
    const m = seg.dataset.mode;
    seg.className = 'modeseg' + (m===mode ? ' sel ' + (m==='simulate'?'sim':m==='play'?'play':'') : '');
    seg.textContent = m[0].toUpperCase()+m.slice(1);
  });
  $('transport').classList.toggle('show', mode!=='edit');
  updateStatusPill();
  restartAccumulation(); markDirty();
}
function updateStatusPill(){
  const dot = $('live-dot'), lab = $('status-label');
  if (S.paused){ dot.className='live-dot held'; lab.textContent='Held'; }
  else if (S.mode!=='edit'){ dot.className='live-dot'; lab.textContent='Running'; }
  else if (S.realtime){ dot.className='live-dot'; lab.textContent='Live'; }
  else { dot.className='live-dot static'; lab.textContent='Static'; }
  document.querySelectorAll('.modeseg').forEach(seg=>{
    if (S.paused && seg.classList.contains('sel') && seg.dataset.mode!=='edit'){
      seg.classList.add('paused'); seg.textContent='Paused';
    }
  });
}

APP.hairlineTick = () => {
  const frac = Math.min(1, S.samples/S.sampleTarget);
  $('hairline-fill').style.width = (frac*100)+'%';
  $('hairline').classList.toggle('refining', S.samples >= S.sampleTarget);
  $('status-samples').textContent = S.samples >= 1000
    ? `${(S.samples/1000)|0} ${String(S.samples%1000).padStart(3,'0')}` : S.samples;
};

function triCount(){
  let t = 0;
  for (const n of visibleShapes) t += n.shape.tris||0;
  return t;
}
APP.statusTick = () => {
  const yaw = ((CAM.yaw*180/Math.PI)%360+360)%360 - 360;
  const pitch = CAM.pitch*180/Math.PI;
  let inst = 0, vis = 0;
  eachNode(n => { if (n.shape && n.shape.kind!=='ground'){ inst++; if (effectiveVisible(n)) vis++; } });
  $('vstatus').innerHTML =
    `FPS <b class="good">${S.fps}</b> &middot; ${S.ms.toFixed(1)} ms` +
    `<span class="vsep"></span>TRIS <b>${triCount()}</b>` +
    `<span class="vsep"></span>INSTANCES <b>${inst}</b> &middot; ${vis} visible` +
    `<span class="vsep"></span>CAMERA <b>${yaw.toFixed(0)}° ${pitch>=0?'+':''}${pitch.toFixed(0)}° ${CAM.dist.toFixed(1)}m</b>`;
  $('fps-overlay').textContent = `FPS ${S.fps} • ${S.ms.toFixed(1)} ms`;
  renderOutlinerFoot();
  const it = $('insp-tris'); if (it) it.textContent = triCount();
};

APP.gizmoReadout = (txt) => {
  const el = $('gizmo-readout');
  if (txt){ el.textContent = txt; el.classList.add('show'); }
  else el.classList.remove('show');
};

/* ─────────────────────── command line / palette ────────────────────── */
function paletteRows(text){
  const t = text.trim().toLowerCase();
  const rows = [];
  if (!t){
    for (const ex of EXAMPLES) rows.push({ kind:'example', usage:ex, help:'' });
    return { head:'Try saying', rows };
  }
  const first = t.split(/\s+/)[0];
  for (const v of VERBS){
    const keys = v.keys.split('|');
    const hit = keys.some(k => k.startsWith(t) || (t.length>2 && k.includes(first)));
    if (hit) rows.push({ kind:'verb', usage:v.usage, help:v.help });
  }
  /* entity rows */
  eachNode(n => {
    if (rows.length > 14) return;
    if (n.label.toLowerCase().includes(t) && n.shape && n.shape.kind!=='ground'){
      rows.push({ kind:'entity', node:n, usage:n.label, help:'geometry · find and frame' });
    } else if (n.label.toLowerCase().includes(t) && !n.children && !n.shape){
      rows.push({ kind:'entity', node:n, usage:n.label, help:(CAT_LABEL[n.cat]||n.cat).toLowerCase()+' · find and frame' });
    }
  });
  return { head:'What this will do', rows };
}

let palHot = 0;
function renderPalette(){
  const pal = $('palette');
  const { head, rows } = paletteRows($('cmd').value);
  if (!rows.length){ pal.classList.remove('show'); return; }
  pal.innerHTML = `<div class="phead">${head}</div>` + rows.map((r,i) =>
    `<div class="prow ${i===palHot?'hot':''}" data-i="${i}">` +
    (r.kind==='entity'
      ? `<span class="pdot" style="background:${r.node.shape ? r.node.shape.color : NARROW_TINT[r.node.narrow]||'#888'}"></span>`
      : `<span class="pico">${icon('flag',13)}</span>`) +
    `<span class="pusage">${r.usage}</span><span class="phelp">${r.help}</span></div>`).join('');
  pal.classList.add('show');
  pal.querySelectorAll('.prow').forEach(el => el.onclick = () => {
    const r = rows[+el.dataset.i];
    if (r.kind==='entity'){ APP.select(r.node); frameNode(r.node); hidePalette(); $('cmd').value=''; }
    else if (r.kind==='example'){ $('cmd').value = r.usage; runCommand(r.usage); }
    else { $('cmd').value = r.usage.replace(/<.*$/,''); $('cmd').focus(); renderPalette(); }
  });
  pal._rows = rows;
}
function hidePalette(){ $('palette').classList.remove('show'); palHot = 0; }

function runCommand(raw){
  const t = raw.trim(); if (!t) return;
  const lower = t.toLowerCase();
  const W2 = lower.split(/\s+/);
  const done = msg => { toast(msg); $('cmd').value=''; hidePalette(); restartAccumulation(); markDirty(); refreshAll(); };

  let m;
  if ((m = lower.match(/^(?:find|locate|select|where is|go to|show me|pick)\s+(.+)/))){
    const n = findByName(m[1]);
    if (n){ APP.select(n); frameNode(n); return done(`Found ${n.label}`); }
    return toast(`No entity called "${m[1]}"`);
  }
  if ((m = lower.match(/^(?:rotate|turn|spin)\s+(.+?)\s+(-?[\d.]+)\s*(degrees|deg|radians|rad)?(?:\s+on\s+([xyz]))?$/))){
    const n = findByName(m[1]); if (!n || !n.shape) return toast('Nothing to rotate');
    let a = parseFloat(m[2]); if (!m[3] || m[3].startsWith('deg')) a = a*Math.PI/180;
    n.shape.yaw = (n.shape.yaw||0) + a;
    APP.select(n); return done(`${n.label} rotated`);
  }
  if ((m = lower.match(/^(?:move|translate|shift|nudge|push)\s+(.+?)\s+(-?[\d.]+)\s*m?\s+on\s+([xyz])$/))){
    const n = findByName(m[1]); if (!n || !n.shape) return toast('Nothing to move');
    n.shape.pos['xyz'.indexOf(m[3])] += parseFloat(m[2]);
    if (n.shape.pos[2] < 0) n.shape.pos[2] = 0;
    APP.select(n); return done(`${n.label} moved ${m[2]} m on ${m[3]}`);
  }
  if ((m = lower.match(/^move\s+(.+?)\s+to\s+x\s*(-?[\d.]+)\s+y\s*(-?[\d.]+)\s+z\s*(-?[\d.]+)/))){
    const n = findByName(m[1]); if (!n || !n.shape) return toast('Nothing to move');
    n.shape.pos = [parseFloat(m[2]),parseFloat(m[3]),Math.max(0,parseFloat(m[4]))];
    APP.select(n); return done(`${n.label} placed`);
  }
  if ((m = lower.match(/^(?:scale|resize|grow|shrink)\s+(.+?)\s+([\d.]+)\s*[x×]?(?:\s+on\s+([xyz]))?$/))){
    const n = findByName(m[1]); if (!n || !n.shape) return toast('Nothing to scale');
    n.shape.size *= parseFloat(m[2]);
    APP.select(n); return done(`${n.label} scaled ${m[2]}×`);
  }
  if ((m = lower.match(/^(?:add|create|spawn|new|insert|drop)\s+(\w+)(?:\s+at\s+x\s*(-?[\d.]+)\s+y\s*(-?[\d.]+)\s+z\s*(-?[\d.]+))?/))){
    const kind = { cube:'box', box:'box', sphere:'sphere', cone:'cone', cylinder:'cylinder',
                   pyramid:'pyramid', torus:'torus', tyre:'tyre', vehicle:'vehicle', cloth:'cloth' }[m[1]];
    if (!kind) return toast(`Cannot construct "${m[1]}"`);
    spawnEntity(kind, m[1][0].toUpperCase()+m[1].slice(1),
      m[2]!==undefined ? [parseFloat(m[2]),parseFloat(m[3]),Math.max(0,parseFloat(m[4]))] : undefined);
    $('cmd').value=''; hidePalette(); return;
  }
  if ((m = lower.match(/^(enable|disable|turn on|turn off|add|remove)\s+physics(?:\s+on\s+(.+))?/))){
    const on = m[1]==='enable'||m[1]==='turn on'||m[1]==='add';
    const n = m[2] && m[2]!=='selected objects' ? findByName(m[2]) : S.selected;
    if (!n) return toast('Nothing selected');
    n.physics = on; renderInspector();
    return done(`Physics ${on?'enabled':'disabled'} on ${n.label}`);
  }
  if ((m = lower.match(/^(?:hide|unhide|show)\s+(.+)/))){
    const n = findByName(m[1]); if (!n) return toast(`No entity called "${m[1]}"`);
    n.visible = W2[0]!=='hide';
    return done(`${n.label} ${n.visible?'shown':'hidden'}`);
  }
  if ((m = lower.match(/^(?:frame|focus|look at|zoom to)\s*(.*)/))){
    const n = m[1]==='everything'||!m[1] ? null : findByName(m[1]);
    frameNode(n || S.selected);
    return done('Framed');
  }
  if (lower.startsWith('isolate')){
    S.isolated = S.selected;
    return done(S.selected?`Isolated ${S.selected.label}`:'Nothing selected');
  }
  if (/^(exit isolation|unisolate|leave isolation|clear isolation|show everything)/.test(lower)){
    S.isolated = null; return done('Isolation cleared');
  }
  if ((m = lower.match(/^(?:delete from ram|remove from ram|delete from memory|purge|wipe|free|destroy|nuke)\s+(.+)/))){
    const n = findByName(m[1]); if (!n) return toast(`No entity called "${m[1]}"`);
    const p = parentOf(n);
    const list = p ? p.children : SCENE;
    list.splice(list.indexOf(n),1);
    if (S.selected===n) APP.select(null);
    return done(`${n.label} deleted — GPU + RAM buffers disposed`);
  }
  if ((m = lower.match(/^(?:set time|time|set the time|make it)(?:\s+to)?\s+(.+)/))){
    const presets = { 'golden hour':8, sunrise:2, noon:62, dusk:-1, midnight:-30, morning:25, afternoon:40 };
    const el = presets[m[1]] !== undefined ? presets[m[1]] : parseFloat(m[1]);
    if (!isFinite(el)) return toast('A clock time, or sunrise / noon / dusk / midnight');
    S.sunElevation = el;
    const sunN = findByName('sun'); if (sunN) sunN.value = el.toFixed(1)+'°';
    return done(`Time set — sun at ${el.toFixed(1)}°`);
  }
  if (/^(play|run)\b/.test(lower)){ setMode('play'); return done('Playing through Main Camera'); }
  if (/^close (all )?popups|^clear popups/.test(lower)){ closeMenus(); hidePalette(); $('cmd').value=''; return; }
  if (/^(help|commands|what can i say|\?)/.test(lower)){
    $('cmd').value=''; palHot=0; renderPalette(); return;
  }
  toast(`Didn't understand "${t}"`, 'Say "help" for what the line listens for');
}

/* ─────────────────────────── construct ─────────────────────────────── */
let constructGroupSel = 0, constructKey = null;
function openConstruct(){
  $('construct-veil').classList.add('show');
  $('construct-search').value=''; constructGroupSel = 0;
  showConstructCatalogue();
  renderConstruct();
  setTimeout(()=>$('construct-search').focus(), 30);
}
function closeConstruct(){ $('construct-veil').classList.remove('show'); }
function showConstructCatalogue(){
  $('construct-props').classList.remove('show');
  $('construct-tiles').style.display='grid';
  $('construct-cats').style.display='flex';
  $('construct-search-wrap').style.display='flex';
}
function renderConstruct(){
  const cats = $('construct-cats');
  cats.innerHTML = '';
  CONSTRUCT_GROUPS.forEach((g,i) => {
    const el = document.createElement('div');
    el.className = 'construct-cat' + (i===constructGroupSel?' sel':'');
    el.textContent = g;
    el.onclick = () => { constructGroupSel = i; renderConstruct(); };
    cats.appendChild(el);
  });
  const tiles = $('construct-tiles');
  tiles.innerHTML = '';
  const q = $('construct-search').value.trim().toLowerCase();
  let written = 0;
  eachNode(n => {
    if (n.children || n.cat==='Folder') return;
    if (constructGroupSel && constructGroup(n) !== constructGroupSel) return;
    if (q && !n.label.toLowerCase().includes(q)) return;
    const t = document.createElement('div');
    t.className = 'ctile';
    t.innerHTML = `<span class="cico">${icon(n.icon,40)}</span><span class="clabel">${n.label}</span>`;
    t.onclick = () => { constructKey = n; showConstructProps(n); };
    tiles.appendChild(t);
    written++;
  });
  if (!written){
    tiles.innerHTML = `<div class="construct-note">No matching engine entities.<br><br>
      Existing scene records only. Select an entity to activate it or edit its native properties.</div>`;
  } else {
    const note = document.createElement('div');
    note.className = 'construct-note';
    note.textContent = 'Existing scene records only. Select an entity to activate it or edit its native properties.';
    tiles.appendChild(note);
  }
}
function showConstructProps(n){
  $('construct-tiles').style.display='none';
  $('construct-cats').style.display='none';
  $('construct-search-wrap').style.display='none';
  const p = $('construct-props');
  p.classList.add('show');
  $('cp-title').textContent = n.label;
  $('cp-enable').classList.toggle('show', !effectiveVisible(n));
  $('cp-enable').onclick = () => {
    n.visible = true;
    let par = parentOf(n); while (par){ par.visible = true; par = parentOf(par); }
    $('cp-enable').classList.remove('show');
    refreshAll(); restartAccumulation(); markDirty();
  };
  $('cp-body').innerHTML = sheetCards(n);
  $('cp-body').querySelectorAll('.card-head').forEach(h => h.onclick = () => h.parentElement.classList.toggle('closed'));
  $('cp-body').querySelectorAll('.switch').forEach(sw => sw.onclick = () => sw.classList.toggle('on'));
  APP.select(n);
}

/* ─────────────────────── control centre (shade) ────────────────────── */
function renderShade(){
  const g = $('quick-grid');
  g.innerHTML = '';
  for (const t of QUICK_TILES){
    const el = document.createElement('div');
    el.className = 'qtile' + (t.on()?' on':'');
    el.innerHTML = `<span class="qdisc">${icon(t.icon,22)}</span><span class="qlabel">${t.label()}</span>`;
    el.onclick = () => { toggleQuickTile(t.key); renderShade(); };
    g.appendChild(el);
  }
}
function toggleQuickTile(key){
  switch (key){
    case 'gi': S.gi = !S.gi; break;
    case 'refl': S.reflections = S.reflections==='Raytraced' ? 'Screen' : S.reflections==='Screen' ? 'Off' : 'Raytraced'; break;
    case 'aa': S.antiAliasing = !S.antiAliasing; break;
    case 'fps': S.fpsOverlay = !S.fpsOverlay; $('fps-overlay').classList.toggle('show', S.fpsOverlay); break;
    case 'notif': S.notifications = !S.notifications; break;
    case 'quality': S.quality = { Standard:'High', High:'Cinematic', Cinematic:'Performance', Performance:'Standard' }[S.quality]; break;
    case 'patches': S.patches = !S.patches; break;
    case 'rt': S.raytracing = !S.raytracing; break;
  }
  toast('Render settings applied', `${S.quality} · GI ${S.gi?S.giBounces+' bounces':'off'} · Refl ${S.reflections} · RT ${S.raytracing?'on':'off'}`);
  restartAccumulation(); markDirty(); renderOutlinerFoot();
}

/* ─────────────────────────── boot ──────────────────────────────────── */
function refreshAll(){ renderTree(); renderInspector(); renderOutlinerFoot(); }

function seedStaticIcons(){
  $('tab-add').innerHTML = icon('plus',13);
  $('compact-btn').innerHTML = icon('compact',14);
  $('census-vis-ico').innerHTML = icon('check',13);
  $('census-hid-ico').innerHTML = icon('warn',12);
  $('search-ico').innerHTML = icon('search',14);
  $('filter-ico').innerHTML = icon('sliders',13);
  $('dock-left').innerHTML = icon('dockL',15);
  $('dock-right').innerHTML = icon('dockR',15);
  $('add-ico').innerHTML = icon('plus',12);
  $('markers-ico').innerHTML = icon('target',14);
  $('settings-ico').innerHTML = icon('gear',14);
  $('t-pause').innerHTML = icon('pause',12);
  $('t-step').innerHTML = icon('step',12);
  $('t-stop').innerHTML = icon('stop',12);
  $('cmd-flag').innerHTML = icon('flag',13);
  $('cmd-run').innerHTML = icon('play',12);
  $('shade-wifi').innerHTML = icon('wifi',16);
  $('shade-gear').innerHTML = icon('gear',16);
  $('shade-cam').innerHTML = icon('videoCam',17);
  $('insp-lock').innerHTML = icon('unlock',13);
  $('insp-eye').innerHTML = icon('eye',13);
}

function wire(){
  /* outliner */
  $('search').addEventListener('input', e => { S.searchText = e.target.value.trim().toLowerCase(); renderTree(); });
  $('filter-btn').onclick = e => {
    if (e.target.closest('.filter-pop')) return;
    const open = !$('filter-pop').classList.contains('show');
    closeMenus();
    $('filter-pop').classList.toggle('show', open);
    $('filter-btn').classList.toggle('open', open);
    $('filter-caret').textContent = open ? '▴' : '▾';
  };
  $('compact-btn').onclick = () => { S.compact = !S.compact; renderTree(); };

  /* rail */
  $('dock-left').onclick = () => {
    const on = $('dock-left').classList.toggle('on');
    $('outliner-col').classList.toggle('hidden', !on);
    document.querySelector('.tabzone.left').style.visibility = on?'':'hidden';
    $('app').style.gridTemplateColumns = `${on?'316px':'0'} 1fr ${$('dock-right').classList.contains('on')?'320px':'0'}`;
  };
  $('dock-right').onclick = () => {
    const on = $('dock-right').classList.toggle('on');
    $('inspector-col').classList.toggle('hidden', !on);
    document.querySelector('.tabzone.right').style.visibility = on?'':'hidden';
    $('app').style.gridTemplateColumns = `${$('dock-left').classList.contains('on')?'316px':'0'} 1fr ${on?'320px':'0'}`;
  };
  $('add-btn').onclick = e => {
    e.stopPropagation();
    const m = $('add-menu');
    const was = m.classList.contains('show');
    closeMenus();
    if (!was){
      const r = $('add-btn').getBoundingClientRect(), pr = $('rail').getBoundingClientRect();
      m.style.left = (r.left-pr.left)+'px'; m.style.top = '40px';
      m.classList.add('show');
    }
  };
  document.querySelectorAll('.modeseg').forEach(seg => seg.onclick = () => setMode(seg.dataset.mode));
  $('t-pause').onclick = () => { S.paused = !S.paused; updateStatusPill(); };
  $('t-step').onclick = () => { if (S.paused){ S.time += 0.02; S.sunElevation = 5.2+Math.sin(S.time)*1.5; restartAccumulation(); markDirty(); } };
  $('t-stop').onclick = () => setMode('edit');
  $('proj-btn').onclick = e => {
    e.stopPropagation();
    const m = $('proj-menu');
    const was = m.classList.contains('show');
    closeMenus();
    if (!was){
      m.innerHTML = '';
      [['Perspective',()=>{CAM.ortho=false;}],
       ['Orthographic',()=>{CAM.ortho=true;}],
       ['Front',()=>{CAM.yaw=Math.PI;CAM.pitch=0;}],
       ['Right',()=>{CAM.yaw=-Math.PI/2;CAM.pitch=0;}],
       ['Top',()=>{CAM.pitch=-1.45;}]].forEach(([l,fn])=>{
        const r = document.createElement('div'); r.className='mi'; r.textContent = l;
        r.onclick = () => { fn(); $('proj-label').textContent = CAM.ortho?'Ortho':'Persp';
          closeMenus(); restartAccumulation(); markDirty(); };
        m.appendChild(r);
      });
      const r = $('proj-btn').getBoundingClientRect(), pr = $('rail').getBoundingClientRect();
      m.style.left = (r.left-pr.left)+'px'; m.style.top='40px';
      m.classList.add('show');
    }
  };
  $('markers-btn').onclick = () => toast('Markers', 'Viewport billboards toggled');
  $('settings-btn').onclick = () => { $('shade').classList.add('show'); renderShade(); };

  /* inspector head */
  $('insp-lock').onclick = () => { if (S.selected){ S.selected.locked = !S.selected.locked; renderInspector(); } };
  $('insp-eye').onclick = () => { if (S.selected){ S.selected.visible = !S.selected.visible; refreshAll(); restartAccumulation(); markDirty(); } };
  $('insp-name').onchange = () => { if (S.selected){ S.selected.label = $('insp-name').value || S.selected.label; renderTree(); } };

  /* command line */
  const cmd = $('cmd');
  cmd.addEventListener('focus', () => { palHot = 0; renderPalette(); });
  cmd.addEventListener('input', () => { palHot = 0; renderPalette(); });
  cmd.addEventListener('keydown', e => {
    const rows = $('palette')._rows || [];
    if (e.key==='ArrowDown'){ palHot = Math.min(rows.length-1, palHot+1); renderPalette(); e.preventDefault(); }
    else if (e.key==='ArrowUp'){ palHot = Math.max(0, palHot-1); renderPalette(); e.preventDefault(); }
    else if (e.key==='Enter'){
      if (rows.length && $('palette').classList.contains('show')){
        const r = rows[palHot];
        if (r.kind==='entity'){ APP.select(r.node); frameNode(r.node); cmd.value=''; hidePalette(); return; }
        if (r.kind==='example' && !cmd.value.trim()){ runCommand(r.usage); return; }
      }
      runCommand(cmd.value);
    }
    else if (e.key==='Escape'){ hidePalette(); cmd.blur(); }
    else if (e.key==='Tab'){
      e.preventDefault();
      if (rows.length){ const r = rows[palHot]; cmd.value = r.usage.replace(/<.*$/,''); renderPalette(); }
    }
    e.stopPropagation();
  });
  cmd.addEventListener('blur', () => setTimeout(hidePalette, 160));
  $('cmd-run').onclick = () => runCommand(cmd.value);

  /* construct */
  $('construct-close').onclick = closeConstruct;
  $('construct-veil').addEventListener('click', e => { if (e.target.id==='construct-veil') closeConstruct(); });
  $('cp-back').onclick = showConstructCatalogue;
  $('construct-search').addEventListener('input', renderConstruct);

  /* shade */
  $('shade').addEventListener('click', e => { if (e.target.id==='shade') $('shade').classList.remove('show'); });
  $('shade-grab').onclick = () => $('shade').classList.remove('show');
  $('res-slider').addEventListener('input', e => {
    S.resolution = +e.target.value;
    $('res-pct').textContent = S.resolution+'%';
    const cvp = document.getElementById('view');
    const ev = new Event('resize'); window.dispatchEvent(ev);
    restartAccumulation(); markDirty();
  });
  window.addEventListener('resize', () => { try{ resize(); }catch(_){} });

  document.addEventListener('click', e => {
    if (!e.target.closest('.menu') && !e.target.closest('#add-btn') &&
        !e.target.closest('#proj-btn') && !e.target.closest('#filter-btn')) closeMenus();
  });

  /* keyboard */
  document.addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (e.key==='Tab' && !typing){
      e.preventDefault();
      $('construct-veil').classList.contains('show') ? closeConstruct() : openConstruct();
      return;
    }
    if (e.key==='Escape'){
      if ($('shade').classList.contains('show')) return $('shade').classList.remove('show');
      if ($('construct-veil').classList.contains('show')) return closeConstruct();
      closeMenus(); hidePalette();
      if (S.mode!=='edit') setMode('edit');
      return;
    }
    if (typing) return;
    if (e.key==='`'){ const s = $('shade'); s.classList.toggle('show'); if (s.classList.contains('show')) renderShade(); }
    else if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); $('cmd').focus(); }
    else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase()==='f'){ e.preventDefault(); $('search').focus(); }
    else if (e.shiftKey && e.key.toLowerCase()==='a'){ $('add-btn').click(); }
    else if (e.key.toLowerCase()==='w'){ S.gizmoMode='translate'; $('mode-hint').textContent='W move · E rotate · R scale'; markDirty(); }
    else if (e.key.toLowerCase()==='e'){ S.gizmoMode='rotate'; markDirty(); }
    else if (e.key.toLowerCase()==='r'){ S.gizmoMode='scale'; markDirty(); }
    else if (e.key.toLowerCase()==='f'){ frameNode(S.selected); }
    else if (e.key===' '){ if (S.mode!=='edit'){ e.preventDefault(); S.paused=!S.paused; updateStatusPill(); } }
    else if (e.altKey && e.key.toLowerCase()==='s'){ setMode('simulate'); }
    else if (e.altKey && e.key.toLowerCase()==='p'){ setMode('play'); }
  });
}

/* go */
seedStaticIcons();
buildAddMenu();
renderFilterPop();
initViewport();
wire();
APP.select(findByName('Sun'));
refreshAll();
updateStatusPill();
APP.statusTick();
toast('Project-Zero opened', 'Showcase · ' + nodeCount() + ' nodes · Tab for Construct · ` for Control Center');
