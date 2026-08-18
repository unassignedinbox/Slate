<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Scene Outliner</title>

<!-- General Sans (Fontshare) -->
<link rel="preconnect" href="https://api.fontshare.com" crossorigin>
<link href="https://api.fontshare.com/v2/css?f[]=general-sans@300,400,500,600,700&display=swap" rel="stylesheet">

<style>
  :root{
    /* OLED dark + white accent — shared token set with UV Outliner */
    --bg:#000000;
    --panel:#0a0a0a;
    --panel-2:#0e0e0e;
    --panel-3:#141414;
    --header:#060606;
    --row-hover:#161616;
    --row-selected:#1d1d1f;
    --row-selected-bd:#3a3a3a;
    --text:#ededed;
    --text-dim:#8a8a8a;
    --text-faint:#565656;
    --border:#1c1c1c;
    --border-soft:#141414;
    --accent:#ffffff;
    --drop-line:#ffffff;
    --green:#22c55e;
    --red:#ef4444;
    --amber:#eab308;
    --dot-active:#ffffff;      /* active selection = white */
    --dot-secondary:#3b82f6;   /* other selections = blue */
    --ease:cubic-bezier(.22,.61,.36,1);
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{
    background:#000;
    color:var(--text);
    font-family:'General Sans','Segoe UI',Roboto,system-ui,Arial,sans-serif;
    font-size:13px;
    display:flex;align-items:flex-start;justify-content:center;
    gap:26px;padding:30px;user-select:none;
  }
  
  /* 
    Note: The lucide-script replaces <i data-lucide="..."> with actual inline <svg> elements. 
    There are NO font-icons used in this layout.
  */
  .lico{width:15px;height:15px;stroke-width:2;display:inline-flex}
  svg.lucide{display:block}

  /* ---------- Panel shell ---------- */
  .outliner{
    width:352px;height:720px;
    background:var(--panel);
    border:1px solid var(--border);
    border-radius:18px;
    display:flex;flex-direction:column;overflow:hidden;
    box-shadow:0 24px 70px rgba(0,0,0,.75), inset 0 1px 0 rgba(255,255,255,.03);
    animation:panelIn .4s var(--ease);
  }
  @keyframes panelIn{from{opacity:0;transform:translateY(10px) scale(.99)}to{opacity:1;transform:none}}

  /* ---------- Title band ---------- */
  .titlebar{
    display:flex;align-items:center;gap:10px;
    padding:0 12px 0 15px;height:46px;flex-shrink:0;
    background:var(--header);
    border-bottom:1px solid var(--border);
  }
  .titlebar .glyph{
    width:26px;height:26px;border-radius:6px;flex-shrink:0;
    display:flex;align-items:center;justify-content:center;
    background:#141416;
    border:1px solid #2c2c30;color:var(--text);
  }
  .titlebar .glyph .lico{width:15px;height:15px}
  .titlebar .heading{display:flex;flex-direction:column;line-height:1.15}
  .titlebar .heading b{font-weight:600;font-size:14px;letter-spacing:.2px}
  .titlebar .heading small{font-size:10px;color:var(--text-faint);letter-spacing:.3px}
  .titlebar .spacer{flex:1}
  .icon-btn{
    width:28px;height:28px;border-radius:8px;border:none;
    background:transparent;color:var(--text-dim);cursor:pointer;
    display:flex;align-items:center;justify-content:center;
    transition:background .15s var(--ease),color .15s var(--ease),transform .12s var(--ease);
  }
  .icon-btn:hover{background:#1f1f1f;color:var(--text)}
  .icon-btn:active{transform:scale(.88)}
  .icon-btn.active{background:var(--accent);color:#000}
  .icon-btn .lico{width:16px;height:16px}

  /* ---------- Toolbar ---------- */
  .toolbar{
    display:flex;align-items:center;gap:5px;
    padding:8px 10px;flex-shrink:0;
    background:var(--panel-2);border-bottom:1px solid var(--border-soft);
  }
  .toolbar .grp{display:flex;gap:2px;align-items:center}
  .toolbar .sep{width:1px;height:18px;background:var(--border);margin:0 4px}
  .toolbar .spacer{flex:1}
  .seg{display:flex;background:#000;border-radius:9px;padding:2px;border:1px solid var(--border)}
  .seg .icon-btn{width:30px;height:24px;border-radius:7px}

  /* ---------- Panel Menu ---------- */
  .menu-wrap{position:relative;display:flex}
  .pop-menu{
    position:absolute;top:calc(100% + 6px);right:0;z-index:100;
    background:var(--panel-3);border:1px solid #2a2a2c;border-radius:10px;
    padding:5px;box-shadow:0 12px 30px rgba(0,0,0,.8);
    opacity:0;transform:scale(.96) translateY(-4px);pointer-events:none;
    transform-origin:top right;transition:all .15s var(--ease);
    min-width:145px;
  }
  .pop-menu.open{opacity:1;transform:none;pointer-events:auto}
  .pm-item{
    display:flex;align-items:center;gap:8px;padding:7px 9px;
    border-radius:6px;cursor:pointer;font-size:12px;color:var(--text);
    transition:background .12s,color .12s;
  }
  .pm-item:hover{background:var(--accent);color:#000}
  .pm-item:hover .lico{color:#000}
  .pm-item .lico{width:14px;height:14px;opacity:.8}
  .pm-sep{height:1px;background:var(--border);margin:4px}
  .pm-head{font-size:10px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.5px;padding:6px 9px 2px;font-weight:600;}
  .pm-item.danger:hover{background:var(--red);color:#fff}
  .pm-item.danger:hover .lico{color:#fff}

  /* Tree Grid Animation */
  .children-wrap{display:grid;grid-template-rows:0fr;transition:grid-template-rows .25s var(--ease);}
  .children-wrap.expanded{grid-template-rows:1fr;}
  .children-inner{overflow:hidden;}

  /* ---------- Search ---------- */
  .search-bar{padding:10px 10px 6px;flex-shrink:0}
  .search-box{
    display:flex;align-items:center;gap:8px;
    background:#000;border:1px solid var(--border);border-radius:11px;
    padding:8px 11px;transition:border-color .15s var(--ease),box-shadow .15s var(--ease);
  }
  .search-box:focus-within{border-color:#3a3a3a;box-shadow:0 0 0 3px rgba(255,255,255,.06)}
  .search-box .lico{width:15px;height:15px;color:var(--text-faint);flex-shrink:0}
  .search-box input{flex:1;background:transparent;border:none;outline:none;color:var(--text);font-size:12.5px;font-family:inherit}
  .search-box input::placeholder{color:var(--text-faint)}
  .search-clear{cursor:pointer;color:var(--text-faint);display:none;align-items:center}
  .search-clear:hover{color:var(--text)}
  .search-clear .lico{width:14px;height:14px}

  /* ---------- FILTERS ---------- */
  .filters{padding:6px 10px 10px;flex-shrink:0;border-bottom:1px solid var(--border)}
  .filters-head{
    display:flex;align-items:center;gap:8px;margin:2px 2px 8px;
    font-size:10px;letter-spacing:.8px;text-transform:uppercase;
    color:var(--text-faint);font-weight:600;
  }
  .filters-head .lico{width:12px;height:12px}
  .fcount{
    background:var(--accent);color:#000;border-radius:999px;
    font-size:9.5px;padding:1px 6px;font-weight:700;letter-spacing:0;
    opacity:0;transform:scale(.6);transition:.2s var(--ease);
  }
  .fcount.show{opacity:1;transform:scale(1)}
  .filters-head .spacer{flex:1}
  .clear-all{cursor:pointer;font-size:10px;letter-spacing:.2px;color:var(--text-faint);
    text-transform:none;font-weight:500;transition:color .15s;display:none}
  .clear-all:hover{color:var(--red)}
  .clear-all.show{display:inline}

  .chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:9px;min-height:2px}
  .chip{
    display:inline-flex;align-items:center;gap:7px;
    background:#161618;border:1px solid #2a2a2c;
    border-radius:999px;padding:4px 5px 4px 11px;
    font-size:11.5px;color:var(--text);animation:chipIn .22s var(--ease);
    transition:border-color .15s var(--ease),transform .12s var(--ease);
  }
  .chip:hover{border-color:#3a3a3c}
  .chip.removing{animation:chipOut .18s var(--ease) forwards}
  @keyframes chipIn{from{opacity:0;transform:scale(.7) translateY(3px)}to{opacity:1;transform:none}}
  @keyframes chipOut{to{opacity:0;transform:scale(.6);margin-right:-6px}}
  .chip .cswatch{width:9px;height:9px;border-radius:50%;flex-shrink:0}
  .chip .cico{display:inline-flex;color:var(--text-dim)}
  .chip .cico .lico{width:13px;height:13px}
  .chip .cx{
    width:18px;height:18px;border-radius:50%;border:none;cursor:pointer;
    background:#000;color:var(--text-dim);
    display:flex;align-items:center;justify-content:center;flex-shrink:0;
    transition:background .15s var(--ease),color .15s var(--ease),transform .15s var(--ease);
  }
  .chip .cx .lico{width:11px;height:11px}
  .chip .cx:hover{background:var(--red);color:#fff;transform:rotate(90deg)}

  /* full-width "Select properties…" trigger */
  .add-wrap{position:relative}
  .add-btn{
    width:100%;display:flex;align-items:center;justify-content:space-between;
    background:#0f0f11;border:1px solid var(--border);border-radius:999px;
    padding:9px 13px;cursor:pointer;color:var(--text-dim);
    font-size:12.5px;font-family:inherit;
    transition:background .15s var(--ease),border-color .15s var(--ease);
  }
  .add-btn:hover{background:#161618;border-color:#303032;color:var(--text)}
  .add-btn .chev{transition:transform .2s var(--ease)}
  .add-btn.open .chev{transform:rotate(180deg)}
  .add-btn .lead{display:flex;align-items:center;gap:8px}
  .add-btn .lead .lico{width:14px;height:14px}

  .add-menu{
    position:absolute;left:0;right:0;top:calc(100% + 8px);z-index:60;
    background:var(--panel-3);border:1px solid #2a2a2c;border-radius:13px;
    padding:6px;box-shadow:0 18px 40px rgba(0,0,0,.8);
    transform-origin:top center;
    opacity:0;transform:scale(.97) translateY(-6px);pointer-events:none;
    transition:opacity .16s var(--ease),transform .16s var(--ease);
    max-height:300px;overflow-y:auto;
  }
  .add-menu.open{opacity:1;transform:none;pointer-events:auto}
  .afm-head{font-size:9.5px;color:var(--text-faint);text-transform:uppercase;
    letter-spacing:.6px;padding:8px 8px 5px;font-weight:600}
  .afm-item{
    display:flex;align-items:center;gap:10px;padding:8px 9px;border-radius:9px;
    cursor:pointer;font-size:12.5px;transition:background .12s var(--ease);
  }
  .afm-item:hover{background:var(--row-hover)}
  .afm-item .lico{width:14px;height:14px;color:var(--text-dim)}
  .afm-item .swatch{width:11px;height:11px;border-radius:50%}
  .afm-item .tick{margin-left:auto;color:var(--accent);display:none}
  .afm-item.on .tick{display:inline-flex}
  .afm-item .tick .lico{width:14px;height:14px;color:var(--accent)}
  .afm-sep{height:1px;background:var(--border);margin:5px 4px}

  /* ---------- Tree ---------- */
  .tree{flex:1;overflow-y:auto;overflow-x:hidden;padding:6px 0}
  .tree::-webkit-scrollbar{width:9px}
  .tree::-webkit-scrollbar-thumb{background:#242424;border-radius:5px;border:2px solid var(--panel)}
  .tree::-webkit-scrollbar-track{background:transparent}

  .node{position:relative}
  .row{
    display:flex;align-items:center;height:29px;padding-right:8px;cursor:pointer;
    border-radius:0px;margin:0px;position:relative;
    transition:background .13s var(--ease),box-shadow .13s var(--ease);
    animation:rowIn .2s var(--ease);
  }
  @keyframes rowIn{from{opacity:0;transform:translateX(-4px)}to{opacity:1;transform:none}}
  .row:hover{background:var(--row-hover)}
  .row.selected{background:var(--row-selected);box-shadow:inset 0 0 0 1px var(--row-selected-bd)}
  .row.group{font-weight:500}

  .twisty{
    width:16px;height:16px;display:flex;align-items:center;justify-content:center;
    flex-shrink:0;color:var(--text-dim);transition:transform .16s var(--ease)}
  .twisty .lico{width:13px;height:13px}
  .node.collapsed>.row .twisty{transform:rotate(-90deg)}
  .twisty.empty{visibility:hidden}

  .seldot{
    position:absolute;left:0;top:0;bottom:0;width:3px;
    background:transparent;
    transition:background .12s var(--ease),box-shadow .12s var(--ease)}
  .seldot.active{background:var(--dot-active);box-shadow:1px 0 3px rgba(255,255,255,.15)}
  .seldot.secondary{background:var(--dot-secondary);box-shadow:1px 0 3px rgba(59,130,246,.25)}

  .type-ico{width:15px;height:15px;flex-shrink:0;margin-right:8px;color:var(--text-dim);
    display:flex;transition:filter .12s var(--ease);cursor:pointer}
  .type-ico .lico{width:15px;height:15px}
  .type-ico:hover{filter:brightness(1.35)}

  .label{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12.5px}
  .label-input{flex:1;background:#000;border:1px solid var(--accent);border-radius:6px;
    color:#fff;font-size:12.5px;padding:2px 6px;outline:none;font-family:inherit;
    box-shadow:0 0 0 3px rgba(255,255,255,.12)}
  .count{color:var(--text-faint);font-size:10px;margin-left:7px;
    background:#000;border-radius:50%;min-width:18px;height:18px;
    display:inline-flex;align-items:center;justify-content:center;padding:0 4px;}

  .row-actions{display:flex;align-items:center;gap:1px;opacity:0;transform:translateX(4px);
    transition:opacity .14s var(--ease),transform .14s var(--ease)}
  .row:hover .row-actions,.row.selected .row-actions{opacity:1;transform:none}
  .act{width:22px;height:22px;border-radius:6px;border:none;background:transparent;
    color:var(--text-faint);cursor:pointer;display:flex;align-items:center;justify-content:center;
    transition:color .13s var(--ease),background .13s var(--ease),transform .1s var(--ease)}
  .act:hover{color:var(--text);background:#000}
  .act:active{transform:scale(.85)}
  .act .lico{width:14px;height:14px}
  .act.off{color:#454545}
  .act.locked{color:var(--amber)}
  .act.settings:hover{color:var(--accent)}

  .row.drag-source{opacity:.4}
  .drop-line{position:absolute;left:28px;right:10px;height:2px;background:var(--drop-line);
    border-radius:2px;pointer-events:none;z-index:20;display:none}
  .drop-line::before{content:'';position:absolute;left:-4px;top:-2px;width:6px;height:6px;
    border-radius:50%;background:var(--drop-line)}
  .row.drop-inside{box-shadow:inset 0 0 0 1.5px var(--drop-line);background:rgba(255,255,255,.06)}

  .empty-state{padding:40px 20px;text-align:center;color:var(--text-faint);font-size:12.5px;
    display:flex;flex-direction:column;align-items:center;gap:10px}
  .empty-state .lico{width:26px;height:26px;color:#2c2c2c}

  /* ---------- Status ---------- */
  .statusbar{
    display:flex;align-items:center;gap:9px;padding:9px 13px;flex-shrink:0;
    border-top:1px solid var(--border);background:var(--panel-2);
    font-size:11px;color:var(--text-dim)}
  .statusbar .live{display:flex;align-items:center;gap:6px;color:var(--green)}
  .statusbar .pulse{width:7px;height:7px;border-radius:50%;background:var(--green);
    box-shadow:0 0 7px var(--green);animation:pulse 1.9s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.78)}}
  .statusbar .spacer{flex:1}
  .statusbar .selinfo{color:var(--text-faint)}

  /* ---------- context / settings popover ---------- */
  .ctx{position:fixed;z-index:200;background:var(--panel-3);border:1px solid #2a2a2c;
    border-radius:12px;padding:6px;min-width:198px;box-shadow:0 16px 40px rgba(0,0,0,.85);
    opacity:0;transform:scale(.95) translateY(-4px);pointer-events:none;
    transition:opacity .15s var(--ease),transform .15s var(--ease)}
  .ctx.open{opacity:1;transform:none;pointer-events:auto}
  .ctx.origin-tr{transform-origin:top right}.ctx.origin-tl{transform-origin:top left}
  .ctx.origin-br{transform-origin:bottom right}.ctx.origin-bl{transform-origin:bottom left}
  .ctx-title{font-size:9.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--text-faint);
    padding:6px 10px 7px;font-weight:600;display:flex;align-items:center;gap:8px}
  .ctx-title .lico{width:13px;height:13px}
  .ctx-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;
    cursor:pointer;font-size:12.5px;color:var(--text);transition:background .12s var(--ease),color .12s var(--ease)}
  .ctx-item:hover{background:var(--accent);color:#000}
  .ctx-item:hover .lico{color:#000}
  .ctx-item .lico{width:14px;height:14px;opacity:.85}
  .ctx-item .key{margin-left:auto;color:var(--text-faint);font-size:11px}
  .ctx-item:hover .key{color:rgba(0,0,0,.55)}
  .ctx-sep{height:1px;background:var(--border);margin:5px 3px}
  .ctx-item.danger:hover{background:var(--red);color:#fff}
  .ctx-item.danger:hover .lico{color:#fff}
  .ctx-item.danger:hover .key{color:rgba(255,255,255,.7)}

  .caption{position:fixed;bottom:20px;left:0;right:0;text-align:center;color:#3a3a3a;font-size:11px;letter-spacing:.3px}
</style>
</head>
<body>

<div class="outliner" id="outliner">
  <div class="titlebar">
    <span class="glyph"><i data-lucide="box" class="lico"></i></span>
    <span class="heading"><b>Scene</b><small>3D Viewport</small></span>
    <span class="spacer"></span>
    <button class="icon-btn" id="addLayerBtn" title="New layer"><i data-lucide="layers" class="lico"></i></button>
    <button class="icon-btn" id="addFolderBtn" title="New folder"><i data-lucide="folder-plus" class="lico"></i></button>
    <div class="menu-wrap" id="panelMenuWrap">
      <button class="icon-btn" id="panelMenuBtn" title="Panel options"><i data-lucide="more-horizontal" class="lico"></i></button>
      <div class="pop-menu" id="panelMenu">
        <div class="pm-item" id="pmImport"><i data-lucide="folder-input" class="lico"></i> Import JSON</div>
        <div class="pm-item" id="pmExport"><i data-lucide="folder-output" class="lico"></i> Export JSON</div>
        <div class="pm-sep"></div>
        <div class="pm-item danger" id="pmClear"><i data-lucide="trash-2" class="lico"></i> Clear Scene</div>
      </div>
    </div>
  </div>

  <div class="toolbar">
    <div class="grp menu-wrap">
      <button class="icon-btn" id="addItemBtn" title="Add preset object"><i data-lucide="plus" class="lico"></i></button>
      <div class="pop-menu origin-tl" id="addObjMenu" style="transform-origin: top left; left: 0; right: auto;">
        <div class="pm-head">3D Objects</div>
        <div class="pm-item" data-preset="mesh"><i data-lucide="box" class="lico"></i> Mesh (Cube)</div>
        <div class="pm-item" data-preset="sphere"><i data-lucide="circle" class="lico"></i> Mesh (Sphere)</div>
        <div class="pm-sep"></div>
        <div class="pm-head">Lighting & Cameras</div>
        <div class="pm-item" data-preset="light"><i data-lucide="lightbulb" class="lico"></i> Point Light</div>
        <div class="pm-item" data-preset="camera"><i data-lucide="video" class="lico"></i> Camera</div>
        <div class="pm-sep"></div>
        <div class="pm-item" data-preset="empty"><i data-lucide="locate" class="lico"></i> Empty Node</div>
      </div>
    </div>
    <div class="sep"></div>
    <div class="grp">
      <button class="icon-btn" id="expandAllBtn" title="Expand all"><i data-lucide="chevrons-down" class="lico"></i></button>
      <button class="icon-btn" id="collapseAllBtn" title="Collapse all"><i data-lucide="chevrons-up" class="lico"></i></button>
    </div>
    <div class="spacer"></div>
    <button class="icon-btn" id="isolateBtn" title="Isolate selection"><i data-lucide="scan-eye" class="lico"></i></button>
    <button class="icon-btn" id="compactBtn" title="Compact rows"><i data-lucide="align-justify" class="lico"></i></button>
  </div>

  <div class="search-bar">
    <div class="search-box">
      <i data-lucide="search" class="lico"></i>
      <input type="text" id="search" placeholder="Filter scene by name…">
      <span class="search-clear" id="searchClear"><i data-lucide="x" class="lico"></i></span>
    </div>
  </div>

  <div class="filters">
    <div class="filters-head">
      <i data-lucide="sliders-horizontal" class="lico"></i>
      <span>Filters</span>
      <span class="fcount" id="fcount">0</span>
      <span class="spacer"></span>
      <span class="clear-all" id="clearAll">Clear all</span>
    </div>
    <div class="chips" id="chips"></div>
    <div class="add-wrap">
      <button class="add-btn" id="addFilterBtn">
        <span class="lead"><i data-lucide="plus" class="lico"></i> Add filter…</span>
        <i data-lucide="chevron-down" class="lico chev"></i>
      </button>
      <div class="add-menu" id="addMenu"></div>
    </div>
  </div>

  <div class="tree" id="tree"></div>
  <div class="drop-line" id="dropLine"></div>

  <div class="statusbar">
    <span class="live"><span class="pulse"></span> Live</span>
    <span class="spacer"></span>
    <span class="selinfo" id="selInfo"></span>
    <span id="objCount">0 objects</span>
  </div>
</div>

<div class="ctx" id="ctxMenu"></div>
<div class="caption">Scene Outliner · click to select · shift/ctrl multi-select · drag to reparent · double-click to rename</div>

<script src="https://unpkg.com/lucide@latest"></script>
<script>
/* ============================ DATA MODEL ============================ */
let uid=0; const newId=()=>'n'+(++uid);
function makeNode(name,type,opts={}){
  return {id:newId(),name,type,
    color:opts.color||null, visible:opts.visible!==false, locked:!!opts.locked,
    expanded:opts.expanded!==false,
    children:opts.children||(isContainer(type)?[]:null)};
}
const isContainer=t=>t==='folder'||t==='layer';

let TREE=[
  makeNode('Characters','layer',{color:'#3b82f6',children:[
    makeNode('Hero','folder',{color:'#eab308',children:[
      makeNode('Hero_Body','mesh',{color:'#9ca3af'}),
      makeNode('Hero_Armor','mesh',{color:'#a855f7'}),
      makeNode('Hero_Rig','empty',{color:'#22c55e'}),
    ]}),
    makeNode('NPC_Merchant','mesh',{color:'#9ca3af'}),
  ]}),
  makeNode('Environment','layer',{color:'#22c55e',children:[
    makeNode('Terrain','mesh',{color:'#9ca3af'}),
    makeNode('Rocks','folder',{color:'#eab308',expanded:false,children:[
      makeNode('Rock_01','mesh',{color:'#9ca3af'}),
      makeNode('Rock_02','mesh',{color:'#9ca3af',visible:false}),
    ]}),
    makeNode('SkyDome','mesh',{color:'#7dd3fc'}),
  ]}),
  makeNode('Lighting','layer',{color:'#eab308',children:[
    makeNode('Sun','light',{color:'#eab308'}),
    makeNode('Fill_Light','light',{color:'#7dd3fc',locked:true}),
    makeNode('Main_Camera','camera',{color:'#3b82f6'}),
    makeNode('Detail_Curve','curve',{color:'#ec4899'}),
  ]}),
];

let selectedIds=new Set(), selectionOrder=[], lastSelected=null;
let compact=false, isolate=false, searchTerm='';

/* ============================ FILTER STATE ============================ */
const ALL_TYPES=['layer','folder','mesh','light','camera','curve','empty'];
const TYPE_ICON={folder:'folder',layer:'layers',mesh:'box',light:'lightbulb',camera:'video',curve:'spline',empty:'locate'};
const TYPE_LABEL={folder:'Folders',layer:'Layers',mesh:'Meshes',light:'Lights',camera:'Cameras',curve:'Curves',empty:'Empties'};
const COLOR_DEFS=[
  {value:'#ef4444',name:'Red'},{value:'#22c55e',name:'Green'},{value:'#3b82f6',name:'Blue'},
  {value:'#7dd3fc',name:'Sky'},{value:'#eab308',name:'Amber'},{value:'#a855f7',name:'Purple'},
  {value:'#ec4899',name:'Pink'},{value:'#9ca3af',name:'Grey'},
];
let activeFilters=[];   // {kind:'type'|'color'|'flag', value}

function refreshIcons(){ if(window.lucide) lucide.createIcons(); }
const typeIconName=n=>n.type==='folder'?(n.expanded?'folder-open':'folder'):(TYPE_ICON[n.type]||'box');

/* ============================ SELECTION HELPERS ============================ */
function setSingleSelection(id){selectedIds=new Set([id]);selectionOrder=[id];lastSelected=id;}
function clearSelection(){selectedIds.clear();selectionOrder=[];lastSelected=null;}
function syncSelectionOrder(){
  selectionOrder=selectionOrder.filter(id=>selectedIds.has(id));
  selectedIds.forEach(id=>{if(!selectionOrder.includes(id))selectionOrder.push(id);});
}
function activeId(){return selectionOrder.length?selectionOrder[0]:null;}

/* ============================ TREE HELPERS ============================ */
function walk(nodes,cb,parent=null){for(const n of nodes){cb(n,parent,nodes);if(n.children)walk(n.children,cb,n);}}
function findNode(id,nodes=TREE){for(const n of nodes){if(n.id===id)return n;if(n.children){const r=findNode(id,n.children);if(r)return r;}}return null;}
function findParentList(id,nodes=TREE){for(const n of nodes){if(n.id===id)return nodes;if(n.children){const r=findParentList(id,n.children);if(r)return r;}}return null;}
function removeNode(id){const list=findParentList(id);if(!list)return null;const i=list.findIndex(n=>n.id===id);return list.splice(i,1)[0];}
function isDescendant(anc,child){const a=findNode(anc);if(!a||!a.children)return false;let f=false;walk(a.children,n=>{if(n.id===child)f=true;});return f;}

/* ============================ FILTER LOGIC ============================ */
function activeTypes(){const t=activeFilters.filter(f=>f.kind==='type').map(f=>f.value);return t.length?new Set(t):null;}
function activeColors(){const c=activeFilters.filter(f=>f.kind==='color').map(f=>f.value);return c.length?new Set(c):null;}
function flagOn(v){return activeFilters.some(f=>f.kind==='flag'&&f.value===v);}
function matchesFilters(n){
  const types=activeTypes(); if(types&&!types.has(n.type))return false;
  if(flagOn('visible')&&!n.visible)return false;
  if(flagOn('locked')&&!n.locked)return false;
  const colors=activeColors(); if(colors){if(!n.color||!colors.has(n.color))return false;}
  return true;
}
function nodeVisibleInTree(n){
  const selfOk=matchesFilters(n)&&(!searchTerm||n.name.toLowerCase().includes(searchTerm));
  if(selfOk)return true;
  if(n.children)return n.children.some(nodeVisibleInTree);
  return false;
}

/* ============================ FILTERS UI ============================ */
const chipsEl=document.getElementById('chips'),addMenu=document.getElementById('addMenu');
const addFilterBtn=document.getElementById('addFilterBtn'),fcountEl=document.getElementById('fcount'),clearAllEl=document.getElementById('clearAll');
function filterExists(k,v){return activeFilters.some(f=>f.kind===k&&f.value===v);}
function addFilter(k,v){if(filterExists(k,v))return;activeFilters.push({kind:k,value:v});renderFilters();render();}
function removeFilter(k,v,chipEl){
  const go=()=>{activeFilters=activeFilters.filter(f=>!(f.kind===k&&f.value===v));renderFilters();render();};
  if(chipEl){chipEl.classList.add('removing');chipEl.addEventListener('animationend',go,{once:true});}else go();
}
function chipMeta(f){
  if(f.kind==='type')return{label:TYPE_LABEL[f.value],icon:TYPE_ICON[f.value],swatch:null};
  if(f.kind==='color'){const d=COLOR_DEFS.find(c=>c.value===f.value);return{label:d?d.name:'Color',icon:null,swatch:f.value};}
  if(f.value==='visible')return{label:'Visible only',icon:'eye',swatch:null};
  if(f.value==='locked')return{label:'Locked only',icon:'lock',swatch:null};
  return{label:f.value,icon:'tag',swatch:null};
}
function renderFilters(){
  chipsEl.innerHTML='';
  activeFilters.forEach(f=>{
    const m=chipMeta(f);const chip=document.createElement('div');chip.className='chip';
    let inner='';
    if(m.swatch)inner+=`<span class="cswatch" style="background:${m.swatch}"></span>`;
    if(m.icon)inner+=`<span class="cico"><i data-lucide="${m.icon}" class="lico"></i></span>`;
    inner+=`<span>${m.label}</span><button class="cx" title="Remove"><i data-lucide="x" class="lico"></i></button>`;
    chip.innerHTML=inner;
    chip.querySelector('.cx').onclick=e=>{e.stopPropagation();removeFilter(f.kind,f.value,chip);};
    chipsEl.appendChild(chip);
  });
  const n=activeFilters.length;
  fcountEl.textContent=n;fcountEl.classList.toggle('show',n>0);clearAllEl.classList.toggle('show',n>0);
  buildAddMenu();refreshIcons();
}
function buildAddMenu(){
  let h='<div class="afm-head">Object type</div>';
  ALL_TYPES.forEach(t=>{const on=filterExists('type',t);
    h+=`<div class="afm-item${on?' on':''}" data-kind="type" data-value="${t}"><i data-lucide="${TYPE_ICON[t]}" class="lico"></i><span>${TYPE_LABEL[t]}</span><span class="tick"><i data-lucide="check" class="lico"></i></span></div>`;});
  h+='<div class="afm-sep"></div><div class="afm-head">Color tag</div>';
  COLOR_DEFS.forEach(c=>{const on=filterExists('color',c.value);
    h+=`<div class="afm-item${on?' on':''}" data-kind="color" data-value="${c.value}"><span class="swatch" style="background:${c.value}"></span><span>${c.name}</span><span class="tick"><i data-lucide="check" class="lico"></i></span></div>`;});
  h+='<div class="afm-sep"></div><div class="afm-head">Status</div>';
  [['visible','Visible only','eye'],['locked','Locked only','lock']].forEach(([v,l,ic])=>{const on=filterExists('flag',v);
    h+=`<div class="afm-item${on?' on':''}" data-kind="flag" data-value="${v}"><i data-lucide="${ic}" class="lico"></i><span>${l}</span><span class="tick"><i data-lucide="check" class="lico"></i></span></div>`;});
  addMenu.innerHTML=h;
  addMenu.querySelectorAll('.afm-item').forEach(it=>{it.onclick=e=>{e.stopPropagation();
    const k=it.dataset.kind,v=it.dataset.value;filterExists(k,v)?removeFilter(k,v):addFilter(k,v);};});
}
addFilterBtn.onclick=e=>{e.stopPropagation();const open=addMenu.classList.toggle('open');addFilterBtn.classList.toggle('open',open);};
clearAllEl.onclick=e=>{e.stopPropagation();activeFilters=[];renderFilters();render();};

/* ============================ RENDER ============================ */
const tree=document.getElementById('tree');
function render(){syncSelectionOrder();renderTree();updateStatus();refreshIcons();}
function selDotClass(id){if(!selectedIds.has(id))return'';if(selectedIds.size===1)return'active';return id===activeId()?'active':'secondary';}
function renderTree(){
  tree.classList.toggle('compact',compact);
  tree.innerHTML='';
  const visible=TREE.filter(nodeVisibleInTree);
  if(visible.length===0){
    tree.innerHTML='<div class="empty-state"><i data-lucide="search-x" class="lico"></i>No objects match your filters.</div>';
    refreshIcons();return;
  }
  visible.forEach(n=>tree.appendChild(renderNode(n,0)));
}
function renderNode(n,depth){
  const wrap=document.createElement('div');
  wrap.className='node'+(n.expanded?'':' collapsed');wrap.dataset.id=n.id;
  const row=document.createElement('div');
  row.className='row'+(isContainer(n.type)?' group':'');
  if(selectedIds.has(n.id))row.classList.add('selected');
  row.dataset.id=n.id;row.draggable=true;row.style.paddingLeft=(depth*17+6)+'px';
  const hasKids=n.children&&n.children.length>0;
  const matchSelf=matchesFilters(n)&&(!searchTerm||n.name.toLowerCase().includes(searchTerm));

  const ti=document.createElement('span');ti.className='type-ico';
  ti.style.color=n.color||'var(--text-dim)';
  ti.innerHTML=`<i data-lucide="${typeIconName(n)}" class="lico"></i>`;
  ti.title='Cycle color tag';
  ti.onclick=e=>{e.stopPropagation();cycleColor(n);};

  const tw=document.createElement('span');
  tw.className='twisty'+(hasKids?'':' empty');
  tw.innerHTML='<i data-lucide="chevron-down" class="lico"></i>';
  tw.onclick=e=>{
    e.stopPropagation();
    if(!hasKids) return;
    n.expanded=!n.expanded;
    wrap.classList.toggle('collapsed', !n.expanded);
    const cw = wrap.children[1];
    if(cw && cw.classList.contains('children-wrap')) cw.classList.toggle('expanded', n.expanded);
    if(n.type==='folder'){
      ti.innerHTML=`<i data-lucide="${n.expanded?'folder-open':'folder'}" class="lico"></i>`;
      refreshIcons();
    }
  };
  row.appendChild(tw);

  const dot=document.createElement('span');dot.className='seldot '+selDotClass(n.id);row.appendChild(dot);
  row.appendChild(ti);

  const lbl=document.createElement('span');lbl.className='label';lbl.textContent=n.name;
  if(searchTerm&&!matchSelf)lbl.style.opacity='.45';row.appendChild(lbl);
  if(hasKids){const c=document.createElement('span');c.className='count';c.textContent=n.children.length;row.appendChild(c);}

  const acts=document.createElement('span');acts.className='row-actions';
  const visBtn=document.createElement('button');visBtn.className='act'+(n.visible?'':' off');
  visBtn.innerHTML=`<i data-lucide="${n.visible?'eye':'eye-off'}" class="lico"></i>`;visBtn.title='Visibility (H)';
  visBtn.onclick=e=>{e.stopPropagation();n.visible=!n.visible;render();};
  const lockBtn=document.createElement('button');lockBtn.className='act'+(n.locked?' locked':'');
  lockBtn.innerHTML=`<i data-lucide="${n.locked?'lock':'unlock'}" class="lico"></i>`;lockBtn.title='Lock (L)';
  lockBtn.onclick=e=>{e.stopPropagation();n.locked=!n.locked;render();};
  const setBtn=document.createElement('button');setBtn.className='act settings';
  setBtn.innerHTML='<i data-lucide="settings-2" class="lico"></i>';setBtn.title='Settings';
  setBtn.onclick=e=>{e.stopPropagation();if(!selectedIds.has(n.id)){setSingleSelection(n.id);render();}openSettingsFromEl(setBtn,n);};
  acts.append(visBtn,lockBtn,setBtn);row.appendChild(acts);

  row.onclick=e=>handleSelect(e,n);
  row.ondblclick=e=>{e.stopPropagation();startRename(n,lbl);};
  row.oncontextmenu=e=>{e.preventDefault();if(!selectedIds.has(n.id)){setSingleSelection(n.id);render();}openSettingsAtPoint(e.clientX,e.clientY,n);};
  attachDnD(row,n);
  wrap.appendChild(row);

  if(hasKids){
    const cw=document.createElement('div');
    cw.className='children-wrap'+(n.expanded?' expanded':'');
    const ci=document.createElement('div');
    ci.className='children-inner';
    n.children.filter(nodeVisibleInTree).forEach(c=>ci.appendChild(renderNode(c,depth+1)));
    cw.appendChild(ci);
    wrap.appendChild(cw);
  }
  return wrap;
}

/* ============================ SELECTION ============================ */
function flatVisibleList(){const out=[];const rec=nodes=>nodes.filter(nodeVisibleInTree).forEach(n=>{out.push(n);if(n.children&&n.expanded)rec(n.children);});rec(TREE);return out;}
function handleSelect(e,n){
  e.stopPropagation();
  if(e.shiftKey&&lastSelected){
    const list=flatVisibleList().map(x=>x.id);
    const a=list.indexOf(lastSelected),b=list.indexOf(n.id);
    if(a>-1&&b>-1){const[s,en]=[Math.min(a,b),Math.max(a,b)];const range=list.slice(s,en+1);
      selectedIds=new Set(range);
      selectionOrder=range.includes(activeId())?[activeId(),...range.filter(id=>id!==activeId())]:range.slice();}
  }else if(e.ctrlKey||e.metaKey){
    if(selectedIds.has(n.id)){selectedIds.delete(n.id);selectionOrder=selectionOrder.filter(id=>id!==n.id);}
    else{selectedIds.add(n.id);selectionOrder.unshift(n.id);}
    lastSelected=n.id;
  }else setSingleSelection(n.id);
  render();
}

/* ============================ RENAME ============================ */
function startRename(n,labelEl){
  if(!labelEl)return;
  const inp=document.createElement('input');inp.className='label-input';inp.value=n.name;
  labelEl.replaceWith(inp);inp.focus();inp.select();
  const commit=()=>{const v=inp.value.trim();if(v)n.name=v;render();};
  inp.onblur=commit;
  inp.onkeydown=e=>{if(e.key==='Enter')commit();if(e.key==='Escape')render();e.stopPropagation();};
}

/* ============================ COLOR ============================ */
const COLORS=['#9ca3af','#7dd3fc','#ffffff','#eab308','#22c55e','#3b82f6','#ec4899','#a855f7','#ef4444',null];
function cycleColor(n){const i=COLORS.indexOf(n.color);n.color=COLORS[(i+1)%COLORS.length];render();}

/* ============================ DRAG & DROP ============================ */
const dropLine=document.getElementById('dropLine');let dragId=null;
function attachDnD(el,n){
  el.addEventListener('dragstart',e=>{dragId=n.id;if(!selectedIds.has(n.id))setSingleSelection(n.id);
    el.classList.add('drag-source');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',n.id);});
  el.addEventListener('dragend',()=>{el.classList.remove('drag-source');dropLine.style.display='none';
    document.querySelectorAll('.drop-inside').forEach(x=>x.classList.remove('drop-inside'));dragId=null;render();});
  el.addEventListener('dragover',e=>{
    e.preventDefault();if(dragId===n.id)return;
    const r=el.getBoundingClientRect();const y=e.clientY-r.top;const h=r.height;
    document.querySelectorAll('.drop-inside').forEach(x=>x.classList.remove('drop-inside'));
    let mode;
    if(isContainer(n.type)&&y>h*0.28&&y<h*0.72){mode='inside';el.classList.add('drop-inside');dropLine.style.display='none';}
    else{mode=y<h/2?'before':'after';const lr=el.getBoundingClientRect();
      dropLine.style.display='block';
      dropLine.style.top=(mode==='before'?lr.top:lr.bottom)-tree.getBoundingClientRect().top+tree.scrollTop+'px';
      dropLine.style.left=(parseInt(el.style.paddingLeft||0)+22)+'px';}
    el.dataset.dropmode=mode;});
  el.addEventListener('dragleave',()=>el.classList.remove('drop-inside'));
  el.addEventListener('drop',e=>{e.preventDefault();const mode=el.dataset.dropmode||'after';
    el.classList.remove('drop-inside');dropLine.style.display='none';performDrop(n.id,mode);});
}
function performDrop(targetId,mode){
  const movingIds=[...selectedIds];if(movingIds.length===0&&dragId)movingIds.push(dragId);
  const ordered=[];walk(TREE,n=>{if(movingIds.includes(n.id))ordered.push(n.id);});
  const nodes=ordered.filter(id=>id!==targetId&&!isDescendant(id,targetId)).map(id=>removeNode(id)).filter(Boolean);
  if(nodes.length===0){render();return;}
  if(mode==='inside'){const tgt=findNode(targetId);if(tgt){if(!tgt.children)tgt.children=[];tgt.expanded=true;tgt.children.push(...nodes);}}
  else{const list=findParentList(targetId)||TREE;let idx=list.findIndex(x=>x.id===targetId);if(idx<0)idx=list.length-1;if(mode==='after')idx++;list.splice(idx,0,...nodes);}
  render();
}
tree.addEventListener('dragover',e=>{if(e.target===tree){e.preventDefault();dropLine.style.display='none';}});
tree.addEventListener('drop',e=>{if(e.target===tree){e.preventDefault();const ids=[...selectedIds];const nodes=ids.map(id=>removeNode(id)).filter(Boolean);TREE.push(...nodes);render();}});

/* ============================ SETTINGS POPOVER ============================ */
const ctx=document.getElementById('ctxMenu');
function openSettingsFromEl(el,n){const r=el.getBoundingClientRect();openSettings(n,{l:r.left,r:r.right,t:r.top,b:r.bottom,gap:6});}
function openSettingsAtPoint(x,y,n){openSettings(n,{l:x,r:x,t:y,b:y,gap:2});}
function openSettings(n,a){
  ctx.innerHTML=buildSettingsHTML(n);refreshIcons();
  const pad=8,vw=window.innerWidth,vh=window.innerHeight,w=ctx.offsetWidth||198,h=ctx.offsetHeight||300,gap=a.gap??6;
  
  let left=a.r+gap, ox='l';
  if(left+w+pad>vw){left=a.l-gap-w; ox='r';}
  if(left<pad) left=pad;

  let top=a.t, oy='t';
  if(top+h+pad>vh){top=a.b-h; oy='b';}
  if(top<pad) top=pad;

  ctx.className=`ctx open origin-${oy}${ox}`;
  ctx.style.left=left+'px';
  ctx.style.top=top+'px';
  ctx.querySelectorAll('.ctx-item').forEach(it=>{it.onclick=()=>{doAction(it.dataset.act);closeCtx();};});
}
function closeCtx(){ctx.classList.remove('open');}
function buildSettingsHTML(n){
  const typeName=n.type.charAt(0).toUpperCase()+n.type.slice(1);
  const multi=selectedIds.size>1;
  let h=`<div class="ctx-title"><i data-lucide="${multi?'boxes':(TYPE_ICON[n.type]||'box')}" class="lico"></i>${multi?selectedIds.size+' selected':typeName}</div>`;
  if(!multi)h+=`<div class="ctx-item" data-act="rename"><i data-lucide="pencil-line" class="lico"></i>Rename<span class="key">F2</span></div>`;
  h+=`<div class="ctx-item" data-act="duplicate"><i data-lucide="copy" class="lico"></i>Duplicate<span class="key">Ctrl+D</span></div>`;
  if(isContainer(n.type)){
    h+=`<div class="ctx-item" data-act="expand"><i data-lucide="chevrons-down" class="lico"></i>Expand contents</div>`;
    h+=`<div class="ctx-item" data-act="collapse"><i data-lucide="chevrons-up" class="lico"></i>Collapse contents</div>`;
  }else h+=`<div class="ctx-item" data-act="group"><i data-lucide="folder-plus" class="lico"></i>Group into folder<span class="key">Ctrl+G</span></div>`;
  if(n.type==='camera')h+=`<div class="ctx-item" data-act="focus"><i data-lucide="focus" class="lico"></i>Set as active view</div>`;
  h+=`<div class="ctx-item" data-act="cycleColor"><i data-lucide="palette" class="lico"></i>Cycle color tag</div>`;
  h+=`<div class="ctx-sep"></div>`;
  h+=`<div class="ctx-item" data-act="toggleVis"><i data-lucide="${n.visible?'eye-off':'eye'}" class="lico"></i>${n.visible?'Hide':'Show'}<span class="key">H</span></div>`;
  h+=`<div class="ctx-item" data-act="toggleLock"><i data-lucide="${n.locked?'unlock':'lock'}" class="lico"></i>${n.locked?'Unlock':'Lock'}<span class="key">L</span></div>`;
  h+=`<div class="ctx-sep"></div>`;
  h+=`<div class="ctx-item danger" data-act="delete"><i data-lucide="trash-2" class="lico"></i>Delete<span class="key">Del</span></div>`;
  return h;
}
function doAction(act){
  const ids=[...selectedIds];
  switch(act){
    case 'rename':{const n=findNode(ids[0]);render();requestAnimationFrame(()=>{const row=document.querySelector(`.row[data-id="${ids[0]}"] .label`);if(row&&n)startRename(n,row);});break;}
    case 'duplicate':duplicateSelected();break;
    case 'group':groupSelected();break;
    case 'expand':ids.forEach(id=>{const n=findNode(id);if(n&&n.children)walk([n],x=>{if(x.children)x.expanded=true;});});render();break;
    case 'collapse':ids.forEach(id=>{const n=findNode(id);if(n&&n.children)walk(n.children,x=>{if(x.children)x.expanded=false;});});render();break;
    case 'cycleColor':ids.forEach(id=>{const n=findNode(id);if(n)cycleColor(n);});break;
    case 'toggleVis':ids.forEach(id=>{const n=findNode(id);if(n)n.visible=!n.visible;});render();break;
    case 'toggleLock':ids.forEach(id=>{const n=findNode(id);if(n)n.locked=!n.locked;});render();break;
    case 'focus':render();break;
    case 'delete':deleteSelected();break;
  }
}
function cloneNode(n){const c=JSON.parse(JSON.stringify(n));const reId=x=>{x.id=newId();if(x.children)x.children.forEach(reId);};reId(c);return c;}
function duplicateSelected(){[...selectedIds].forEach(id=>{const n=findNode(id),list=findParentList(id);if(!n||!list)return;const copy=cloneNode(n);copy.name=n.name+'_copy';const idx=list.findIndex(x=>x.id===id);list.splice(idx+1,0,copy);});render();}
function deleteSelected(){[...selectedIds].forEach(id=>removeNode(id));clearSelection();render();}
function groupSelected(){const ids=[...selectedIds];if(!ids.length)return;const ordered=[];walk(TREE,n=>{if(ids.includes(n.id))ordered.push(n.id);});const nodes=ordered.map(id=>removeNode(id)).filter(Boolean);const folder=makeNode('New Folder','folder',{color:'#eab308',children:nodes,expanded:true});TREE.push(folder);setSingleSelection(folder.id);render();}

/* ============================ TOOLBAR & IMPORT/EXPORT ============================ */
function addAt(node){let list=TREE;if(selectedIds.size){const sel=findNode([...selectedIds][0]);if(sel&&isContainer(sel.type)){sel.expanded=true;list=sel.children;}else list=findParentList([...selectedIds][0])||TREE;}list.push(node);setSingleSelection(node.id);render();}
document.getElementById('addFolderBtn').onclick=()=>addAt(makeNode('New Folder','folder',{color:'#eab308'}));
document.getElementById('addLayerBtn').onclick=()=>{TREE.push(makeNode('New Layer','layer',{color:'#3b82f6'}));render();};

const addObjMenu = document.getElementById('addObjMenu');
document.getElementById('addItemBtn').onclick = (e) => {
  e.stopPropagation();
  addObjMenu.classList.toggle('open');
};

addObjMenu.querySelectorAll('.pm-item').forEach(btn => {
  btn.onclick = (e) => {
    const preset = btn.dataset.preset;
    let name = 'Object';
    let type = preset;
    let color = '#9ca3af';
    
    if (preset === 'mesh') { name = 'Cube'; type = 'mesh'; }
    if (preset === 'sphere') { name = 'Sphere'; type = 'mesh'; color = '#3b82f6'; }
    if (preset === 'light') { name = 'Point Light'; type = 'light'; color = '#eab308'; }
    if (preset === 'camera') { name = 'Camera'; type = 'camera'; color = '#10b981'; }
    if (preset === 'empty') { name = 'Empty'; type = 'group'; color = '#8b5cf6'; }

    addAt(makeNode(name, type, { color }));
    addObjMenu.classList.remove('open');
  };
});

document.getElementById('expandAllBtn').onclick=()=>{walk(TREE,n=>{if(n.children)n.expanded=true;});render();};
document.getElementById('collapseAllBtn').onclick=()=>{walk(TREE,n=>{if(n.children)n.expanded=false;});render();};
document.getElementById('compactBtn').onclick=function(){compact=!compact;this.classList.toggle('active',compact);render();};
document.getElementById('isolateBtn').onclick=function(){isolate=!isolate;this.classList.toggle('active',isolate);
  if(isolate&&selectedIds.size){const keep=new Set();[...selectedIds].forEach(id=>{keep.add(id);const n=findNode(id);if(n&&n.children)walk(n.children,c=>keep.add(c.id));});walk(TREE,n=>{n.visible=keep.has(n.id);});}
  else walk(TREE,n=>{n.visible=true;});render();};

document.getElementById('pmExport').onclick = () => {
  const data = JSON.stringify(TREE, null, 2);
  const blob = new Blob([data], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'scene-outliner.json';
  a.click();
  URL.revokeObjectURL(url);
};

document.getElementById('pmImport').onclick = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (Array.isArray(parsed)) {
          TREE = parsed;
          clearSelection();
          render();
        } else {
          alert('Invalid format. Expected an array of nodes.');
        }
      } catch (err) {
        alert('Invalid JSON file.');
      }
    };
    reader.readAsText(file);
  };
  input.click();
};

document.getElementById('pmClear').onclick = () => {
  if (confirm('Are you sure you want to clear the entire scene?')) {
    TREE = [];
    clearSelection();
    render();
  }
};

const pmMenu = document.getElementById('panelMenu');
document.getElementById('panelMenuBtn').onclick = (e) => {
  e.stopPropagation();
  pmMenu.classList.toggle('open');
};

/* ============================ SEARCH ============================ */
const searchInput=document.getElementById('search'),searchClear=document.getElementById('searchClear');
searchInput.oninput=()=>{searchTerm=searchInput.value.trim().toLowerCase();searchClear.style.display=searchTerm?'flex':'none';if(searchTerm)walk(TREE,n=>{if(n.children)n.expanded=true;});render();};
searchClear.onclick=()=>{searchInput.value='';searchTerm='';searchClear.style.display='none';render();};

/* ============================ GLOBAL EVENTS & MICRO ANIMATIONS ============================ */
document.addEventListener('click',()=>{closeCtx();addMenu.classList.remove('open');addFilterBtn.classList.remove('open');pmMenu.classList.remove('open');addObjMenu.classList.remove('open');});
document.getElementById('outliner').addEventListener('click',e=>{if(e.target===tree){clearSelection();render();}});
addEventListener('resize',()=>closeCtx());
document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT')return;
  const ids=[...selectedIds];
  if(e.key==='Delete'||e.key==='Backspace'){if(ids.length){deleteSelected();e.preventDefault();}}
  else if(e.key==='F2'&&ids.length)doAction('rename');
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){if(ids.length){duplicateSelected();e.preventDefault();}}
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='g'){if(ids.length){groupSelected();e.preventDefault();}}
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){selectedIds=new Set(flatVisibleList().map(n=>n.id));syncSelectionOrder();render();e.preventDefault();}
  else if(e.key.toLowerCase()==='h'&&ids.length)doAction('toggleVis');
  else if(e.key.toLowerCase()==='l'&&ids.length)doAction('toggleLock');
  else if(e.key==='Escape'){clearSelection();closeCtx();render();}
  else if(e.key==='ArrowDown'||e.key==='ArrowUp'){const list=flatVisibleList();if(!list.length)return;let i=list.findIndex(n=>n.id===lastSelected);i=e.key==='ArrowDown'?Math.min(list.length-1,i+1):Math.max(0,i-1);setSingleSelection(list[i].id);render();e.preventDefault();}
});

// Scroll Up/Down Micro Animation (Parallax Stretch)
let scrollTimeout;
let lastScrollY = tree.scrollTop;
tree.addEventListener('scroll', () => {
  const dy = tree.scrollTop - lastScrollY;
  lastScrollY = tree.scrollTop;
  
  const skew = Math.max(-1.5, Math.min(1.5, dy * 0.05));
  const rows = tree.querySelectorAll('.row');
  
  rows.forEach(row => {
    row.style.transition = 'none';
    row.style.transform = `translateY(${dy * 0.05}px) skewY(${skew}deg)`;
  });
  
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    rows.forEach(row => {
      row.style.transition = 'transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)';
      row.style.transform = 'none';
    });
  }, 50);
});

/* ============================ STATUS ============================ */
function updateStatus(){
  let count=0;walk(TREE,n=>{if(!isContainer(n.type))count++;});
  document.getElementById('objCount').textContent=count+' object'+(count!==1?'s':'');
  const s=selectedIds.size;document.getElementById('selInfo').textContent=s?s+' selected · ':'';
}

/* boot */
renderFilters();render();
</script>
</body>
</html>
