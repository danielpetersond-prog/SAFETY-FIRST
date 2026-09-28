// ---------------------------------------------------------------------------
// 22 · Estilos (isolados em Shadow DOM — o CSS do app não interfere)
// ---------------------------------------------------------------------------
const CSS = `
:host{all:initial;display:block}
*,*::before,*::after{box-sizing:border-box}
.o3-root,.o3-ov{font-family:"Segoe UI",system-ui,-apple-system,Roboto,"Helvetica Neue",Arial,sans-serif;font-size:14.5px;line-height:1.5;color:#e6edf5;-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none}
input,textarea,select{font:inherit;color:inherit}
a{color:#5eead4}
.o3-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
:focus-visible{outline:2px solid #5eead4;outline-offset:2px}

/* ===== Painel da IA ===== */
.o3-panel{--o3-h:clamp(620px,82vh,1100px);position:relative;display:flex;flex-direction:column;height:var(--o3-h);min-height:460px;border-radius:22px;background:#0b1322;border:1px solid rgba(45,212,191,.16);box-shadow:0 18px 50px rgba(2,8,23,.35);overflow:hidden;isolation:isolate}
.o3-panel::before{content:"";position:absolute;inset:0;z-index:-1;background-image:linear-gradient(rgba(148,163,184,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.045) 1px,transparent 1px);background-size:34px 34px;mask-image:linear-gradient(180deg,#000,transparent 70%)}
.o3-panel.o3-expanded{--o3-h:94vh}
.o3-panel.o3-fullscreen{--o3-h:100vh;height:100vh;border-radius:0;border:0}
.o3-head{display:flex;align-items:center;gap:14px;padding:16px 22px 12px}
.o3-logo{width:52px;height:52px;flex:none;filter:drop-shadow(0 0 10px rgba(45,212,191,.35))}
.o3-brand{display:flex;align-items:center;gap:10px;min-width:0}
.o3-brand h1{margin:0;font-size:26px;font-weight:800;letter-spacing:.3px;color:#fff;white-space:nowrap}
.o3-brand h1 span{font-weight:300;color:#cbd5e1}
.o3-badge{font-size:12.5px;font-weight:800;letter-spacing:1px;color:#052e2b;background:linear-gradient(135deg,#5eead4,#2dd4bf);padding:3px 9px;border-radius:7px}
.o3-sub{font-size:12px;color:#8aa0b6;margin-top:-2px}
.o3-head-r{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.o3-pill{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:700;padding:7px 14px;border-radius:999px;background:rgba(20,184,166,.1);border:1px solid rgba(45,212,191,.35);color:#99f6e4;white-space:nowrap}
.o3-pill i{width:9px;height:9px;border-radius:50%;background:#34d399;box-shadow:0 0 8px #34d399}
.o3-pill.o3-online i{background:#fbbf24;box-shadow:0 0 8px #fbbf24}
.o3-btn{display:inline-flex;align-items:center;gap:7px;font-size:13.5px;font-weight:700;padding:8px 15px;border-radius:999px;background:#131d30;border:1px solid rgba(148,163,184,.22);color:#e2e8f0;transition:background .15s,border-color .15s,transform .1s;white-space:nowrap}
.o3-btn:hover{background:#1a2740;border-color:rgba(45,212,191,.45)}
.o3-btn:active{transform:translateY(1px)}
.o3-btn.o3-primary{background:linear-gradient(135deg,#2dd4bf,#14b8a6);color:#042f2c;border-color:transparent}
.o3-btn.o3-primary:hover{filter:brightness(1.06)}
.o3-btn.o3-sm{font-size:12.5px;padding:6px 11px}
.o3-btn.o3-danger:hover{border-color:#f87171;color:#fecaca}
.o3-ib{width:36px;height:36px;display:inline-grid;place-items:center;border-radius:11px;background:#131d30;border:1px solid rgba(148,163,184,.2);color:#cbd5e1;font-size:16px;transition:background .15s,border-color .15s}
.o3-ib:hover{background:#1a2740;border-color:rgba(45,212,191,.45);color:#fff}
.o3-ib.o3-on{border-color:#2dd4bf;color:#5eead4}
.o3-body{flex:1;display:flex;min-height:0;padding:0 18px 12px;gap:12px}
/* barra lateral de conversas */
.o3-side{width:262px;flex:none;display:flex;flex-direction:column;background:rgba(9,15,28,.72);border:1px solid rgba(148,163,184,.1);border-radius:18px;min-height:0;overflow:hidden;transition:width .2s,opacity .2s}
.o3-side.o3-hidden{width:0;opacity:0;border:0;margin-right:-12px}
.o3-side-top{padding:12px;display:flex;flex-direction:column;gap:9px;border-bottom:1px solid rgba(148,163,184,.08)}
.o3-search{width:100%;background:#0b1424;border:1px solid rgba(148,163,184,.18);border-radius:11px;padding:8px 11px;font-size:13px;outline:none}
.o3-search:focus{border-color:rgba(45,212,191,.55)}
.o3-chats{flex:1;overflow:auto;padding:6px 8px 10px;scrollbar-width:thin;scrollbar-color:#223149 transparent}
.o3-grp{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:#6b7f95;margin:12px 8px 4px;font-weight:700}
.o3-chat{display:flex;align-items:center;gap:8px;padding:8px 9px;border-radius:11px;color:#cbd5e1;font-size:13.2px;width:100%;text-align:left;position:relative}
.o3-chat:hover{background:#111b2d}
.o3-chat.o3-active{background:linear-gradient(90deg,rgba(45,212,191,.16),rgba(45,212,191,.04));color:#fff;box-shadow:inset 3px 0 0 #2dd4bf}
.o3-chat .o3-ct{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.o3-chat .o3-cm{opacity:0;font-size:15px;padding:0 4px;border-radius:6px;color:#94a3b8}
.o3-chat:hover .o3-cm,.o3-chat.o3-active .o3-cm{opacity:1}
.o3-chat .o3-cm:hover{background:#1e2a40;color:#fff}
.o3-chat .o3-pin{font-size:11px}
.o3-side-foot{display:flex;gap:6px;padding:10px;border-top:1px solid rgba(148,163,184,.08)}
.o3-side-foot .o3-btn{flex:1;justify-content:center;padding:7px 6px;font-size:12.5px}
/* área principal */
.o3-main{flex:1;min-width:0;display:flex;flex-direction:column;background:#0a111f;border:1px solid rgba(148,163,184,.1);border-radius:18px;overflow:hidden;position:relative}
.o3-chatbar{display:flex;align-items:center;gap:8px;padding:9px 12px 9px 14px;border-bottom:1px solid rgba(148,163,184,.08);min-height:48px}
.o3-ctitle{flex:1;min-width:0;font-weight:700;font-size:14px;color:#e2e8f0;background:none;border:1px solid transparent;border-radius:8px;padding:4px 8px;outline:none;text-overflow:ellipsis}
.o3-ctitle:hover{border-color:rgba(148,163,184,.2)}
.o3-ctitle:focus{border-color:rgba(45,212,191,.5);background:#0b1424}
.o3-ctx{display:flex;gap:6px;flex-wrap:wrap;padding:8px 14px 0}
.o3-ctx:empty{display:none}
.o3-ctxc{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:3px 6px 3px 9px;border-radius:999px;background:#0f2427;border:1px solid rgba(45,212,191,.28);color:#99f6e4;max-width:260px}
.o3-ctxc span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.o3-ctxc button{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:11px;color:#7dd3c0}
.o3-ctxc button:hover{background:rgba(45,212,191,.2);color:#fff}
.o3-msgs{flex:1;overflow:auto;padding:22px 22px 12px;display:flex;flex-direction:column;gap:18px;scroll-behavior:smooth;scrollbar-width:thin;scrollbar-color:#223149 transparent}
.o3-msg{display:flex;gap:12px;max-width:100%}
.o3-msg.o3-user{justify-content:flex-end}
.o3-av{width:44px;height:44px;flex:none;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle at 35% 30%,#99f6e4,#2dd4bf 55%,#0f766e);box-shadow:0 0 0 3px rgba(45,212,191,.18),0 0 18px rgba(45,212,191,.35)}
.o3-bub{position:relative;max-width:min(78%,880px);padding:13px 17px;border-radius:16px;font-size:15px;overflow-wrap:break-word;word-break:normal}
.o3-user>div{max-width:min(78%,880px);display:flex;flex-direction:column;align-items:flex-end;min-width:0}
.o3-user>div>.o3-bub{max-width:100%}
.o3-user .o3-bub{background:linear-gradient(135deg,#115e59,#0f4f4b);border:1px solid rgba(45,212,191,.38);color:#f0fdfa;white-space:pre-wrap}
.o3-ai .o3-bub{background:#131c2e;border:1px solid rgba(148,163,184,.12);padding-left:24px;min-width:120px}
.o3-ai .o3-bub::before{content:"";position:absolute;left:11px;top:14px;bottom:14px;width:3px;border-radius:3px;background:linear-gradient(#2dd4bf,#14b8a6)}
.o3-ai-col{display:flex;flex-direction:column;gap:8px;min-width:0;max-width:min(82%,900px)}
.o3-ai-col .o3-bub{max-width:100%}
.o3-md p{margin:0 0 8px}.o3-md p:last-child{margin:0}
.o3-md ul,.o3-md ol{margin:4px 0 8px;padding-left:20px}.o3-md li{margin:3px 0}
.o3-md blockquote{margin:8px 0;padding:8px 12px;border-left:3px solid #2dd4bf;background:rgba(45,212,191,.06);border-radius:0 10px 10px 0;color:#d6e2ee}
.o3-md code{background:#0b1424;border:1px solid rgba(148,163,184,.18);padding:1px 6px;border-radius:6px;font-size:.92em}
.o3-md pre{background:#0b1424;border:1px solid rgba(148,163,184,.18);padding:10px 12px;border-radius:10px;white-space:pre-wrap;font-size:13px;max-height:340px;overflow:auto}
.o3-md b,.o3-md strong{color:#fff}
.o3-md em{color:#b8c7d8}
.o3-meta{font-size:11.5px;color:#6b7f95;margin-top:4px;text-align:right}
.o3-acts{display:flex;gap:4px;opacity:0;transition:opacity .15s;margin-left:2px}
.o3-msg:hover .o3-acts,.o3-acts:focus-within{opacity:1}
.o3-acts button{font-size:13px;padding:4px 8px;border-radius:8px;color:#8aa0b6}
.o3-acts button:hover{background:#131d30;color:#fff}
.o3-acts button.o3-on{color:#5eead4}
.o3-chips{display:flex;flex-wrap:wrap;gap:8px}
.o3-chip{font-size:13.5px;font-weight:650;padding:7px 14px;border-radius:999px;background:#0f2427;border:1px solid rgba(45,212,191,.35);color:#ccfbf1;text-align:left;transition:background .15s,border-color .15s}
.o3-chip:hover{background:#133236;border-color:#2dd4bf}
.o3-card{display:flex;gap:12px;align-items:flex-start;background:#0e1728;border:1px solid rgba(148,163,184,.16);border-radius:14px;padding:12px 14px}
.o3-card .o3-ci{width:42px;height:42px;flex:none;border-radius:11px;display:grid;place-items:center;font-size:22px;background:#132238;border:1px solid rgba(148,163,184,.14);overflow:hidden}
.o3-card .o3-ci img{width:100%;height:100%;object-fit:cover}
.o3-card .o3-cb{flex:1;min-width:0}
.o3-card .o3-ct1{font-weight:750;color:#fff;font-size:14.5px}
.o3-card .o3-ct2{font-size:12.5px;color:#8aa0b6;margin-top:1px}
.o3-card .o3-cbtns{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.o3-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.o3-kpi{background:#0e1728;border:1px solid rgba(148,163,184,.14);border-radius:12px;padding:10px 12px}
.o3-kpi b{display:block;font-size:20px;color:#fff;font-weight:650}
.o3-kpi span{font-size:12px;color:#8aa0b6}
.o3-srcs{display:flex;flex-direction:column;gap:4px;font-size:12.5px}
.o3-srcs a{color:#7dd3fc;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.o3-srcs a:hover{text-decoration:underline}
.o3-typing{display:inline-flex;gap:5px;padding:4px 2px}
.o3-typing i{width:7px;height:7px;border-radius:50%;background:#5eead4;animation:o3b 1.1s infinite ease-in-out}
.o3-typing i:nth-child(2){animation-delay:.15s}.o3-typing i:nth-child(3){animation-delay:.3s}
@keyframes o3b{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-4px)}}
.o3-status{font-size:12px;color:#8aa0b6;padding:0 22px 6px;min-height:0}
/* compositor */
.o3-comp-wrap{padding:10px 14px 12px;border-top:1px solid rgba(148,163,184,.06)}
.o3-tray{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.o3-tray:empty{display:none}
.o3-att{display:flex;align-items:center;gap:8px;padding:6px 8px 6px 6px;border-radius:12px;background:#0f1a2d;border:1px solid rgba(148,163,184,.2);max-width:280px;font-size:12.5px;position:relative}
.o3-att .o3-ati{width:34px;height:34px;border-radius:8px;display:grid;place-items:center;background:#15233a;font-size:17px;flex:none;overflow:hidden}
.o3-att .o3-ati img{width:100%;height:100%;object-fit:cover}
.o3-att .o3-atn{min-width:0}
.o3-att .o3-atn b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e2e8f0;font-weight:650}
.o3-att .o3-atn span{color:#8aa0b6;font-size:11.5px}
.o3-att .o3-atx{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;color:#94a3b8;flex:none}
.o3-att .o3-atx:hover{background:#1e2a40;color:#fff}
.o3-att.o3-busy .o3-atn span::after{content:"";display:inline-block;width:10px;height:10px;margin-left:6px;border:2px solid #5eead4;border-right-color:transparent;border-radius:50%;animation:o3spin .8s linear infinite;vertical-align:-1px}
@keyframes o3spin{to{transform:rotate(360deg)}}
.o3-comp{display:flex;align-items:flex-end;gap:8px;background:#0b1322;border-radius:30px;padding:9px 9px 9px 22px;box-shadow:0 0 0 1.5px rgba(45,212,191,.55),0 0 22px rgba(45,212,191,.2);transition:box-shadow .2s}
.o3-comp:focus-within{box-shadow:0 0 0 2px rgba(45,212,191,.85),0 0 28px rgba(45,212,191,.3)}
.o3-ta{flex:1;resize:none;border:0;outline:none;background:transparent;font-size:15.5px;line-height:1.45;max-height:210px;min-height:24px;padding:12px 0;color:#f1f5f9}
.o3-ta::placeholder{color:#7c8ea3}
.o3-attach{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;border:1px solid rgba(148,163,184,.25);color:#cbd5e1;font-size:19px;flex:none}
.o3-attach:hover{border-color:#2dd4bf;color:#fff}
.o3-send{width:54px;height:54px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#5eead4,#14b8a6);color:#042f2c;flex:none;box-shadow:0 6px 18px rgba(20,184,166,.35)}
.o3-send:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
.o3-hint{font-size:11.5px;color:#5f7389;margin:6px 6px 0;display:flex;gap:12px;flex-wrap:wrap}
.o3-drop{position:absolute;inset:8px;border-radius:16px;border:2px dashed #2dd4bf;background:rgba(10,17,31,.9);display:none;place-items:center;text-align:center;z-index:20;font-size:16px;color:#ccfbf1;padding:20px}
.o3-drop.o3-show{display:grid}
.o3-slash{position:absolute;left:14px;right:14px;bottom:calc(100% - 6px);background:#101a2c;border:1px solid rgba(148,163,184,.22);border-radius:14px;padding:6px;box-shadow:0 14px 40px rgba(0,0,0,.45);max-height:300px;overflow:auto;z-index:15}
.o3-slash button{display:flex;gap:10px;width:100%;text-align:left;padding:8px 10px;border-radius:9px;font-size:13.5px}
.o3-slash button b{color:#5eead4;min-width:96px}
.o3-slash button.o3-sel,.o3-slash button:hover{background:#17243a}
.o3-resize{position:absolute;left:50%;bottom:3px;transform:translateX(-50%);width:64px;height:8px;border-radius:6px;cursor:ns-resize;background:rgba(148,163,184,.25)}
.o3-resize:hover{background:#2dd4bf}
.o3-panel.o3-fullscreen .o3-resize{display:none}
/* avatar SVG */
.o3-face{width:30px;height:30px}

/* ===== Camada de sobreposição (tela cheia, modais, estúdio, toasts, dock) ===== */
.o3-ov{position:fixed;inset:0;pointer-events:none;z-index:var(--o3-z,2147483000)}
.o3-ov>*{pointer-events:auto}
.o3-fs{position:fixed;inset:0;z-index:5;background:#060b16}
.o3-modal-bg{position:fixed;inset:0;background:rgba(2,6,16,.62);backdrop-filter:blur(3px);display:grid;place-items:center;z-index:30;padding:18px}
.o3-modal{width:min(980px,100%);max-height:min(92vh,1000px);display:flex;flex-direction:column;background:#0d1627;border:1px solid rgba(148,163,184,.2);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.5);overflow:hidden;color:#e6edf5}
.o3-modal.o3-sm{width:min(560px,100%)}
.o3-mh{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid rgba(148,163,184,.12)}
.o3-mh h2{margin:0;font-size:17px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.o3-mb{padding:16px 18px;overflow:auto;flex:1}
.o3-mf{display:flex;gap:8px;justify-content:flex-end;padding:12px 18px;border-top:1px solid rgba(148,163,184,.12);flex-wrap:wrap}
.o3-frame{width:100%;height:min(70vh,820px);border:0;border-radius:10px;background:#e9eef0}
.o3-field{display:flex;flex-direction:column;gap:5px;margin-bottom:12px;font-size:13px;color:#b8c7d8}
.o3-field input,.o3-field textarea,.o3-field select{background:#0b1424;border:1px solid rgba(148,163,184,.22);border-radius:10px;padding:9px 11px;outline:none;color:#f1f5f9;font-size:14px}
.o3-field input:focus,.o3-field textarea:focus,.o3-field select:focus{border-color:#2dd4bf}
.o3-field textarea{min-height:90px;resize:vertical;font-family:ui-monospace,Consolas,monospace;font-size:12.5px}
.o3-row{display:flex;gap:10px;flex-wrap:wrap}.o3-row>*{flex:1;min-width:160px}
.o3-list{display:flex;flex-direction:column;gap:6px}
.o3-li{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:11px;background:#0b1424;border:1px solid rgba(148,163,184,.12);font-size:13.5px}
.o3-li>span{flex:1;min-width:0}
.o3-mut{color:#8aa0b6;font-size:12.5px}
.o3-h3{font-size:13px;text-transform:uppercase;letter-spacing:.7px;color:#7dd3c0;margin:18px 0 8px}
.o3-sw-t{display:flex;align-items:center;gap:10px;font-size:13.5px;margin:8px 0}
.o3-sw-t input{width:40px;height:22px;accent-color:#2dd4bf}
.o3-ws-open .o3-toasts{bottom:96px}
.o3-toasts{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;z-index:40;align-items:center}
.o3-toast{background:#0f1a2d;border:1px solid rgba(45,212,191,.4);color:#e6edf5;padding:10px 16px;border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.4);font-size:13.5px;display:flex;gap:12px;align-items:center;animation:o3in .2s ease}
.o3-toast button{color:#5eead4;font-weight:700}
@keyframes o3in{from{opacity:0;transform:translateY(8px)}}
.o3-menu{position:fixed;min-width:190px;background:#101a2c;border:1px solid rgba(148,163,184,.25);border-radius:12px;padding:5px;box-shadow:0 18px 40px rgba(0,0,0,.5);z-index:45;color:#e6edf5}
.o3-menu button{display:flex;gap:9px;width:100%;text-align:left;padding:8px 10px;border-radius:8px;font-size:13.5px}
.o3-menu button:hover{background:#17243a}
.o3-menu hr{border:0;border-top:1px solid rgba(148,163,184,.14);margin:4px 2px}

/* ===== Estúdio de abas (segue o layout claro do OPS 360°) ===== */
.o3-ws{--w-bg:#eef2f7;--w-card:#fff;--w-line:#e3e8ef;--w-text:#0f172a;--w-text2:#5b6b7c;--w-mut:#8a97a6;--w-p:#0d9488;--w-p-soft:rgba(13,148,136,.1);position:fixed;left:0;right:0;bottom:0;top:var(--o3-ws-top,0px);z-index:10;background:var(--w-bg);color:var(--w-text);display:flex;flex-direction:column;font-family:"Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;font-size:14px;line-height:1.45;animation:o3in .18s ease}
.o3-ws.o3-dark{--w-bg:#0b1220;--w-card:#141b2b;--w-line:#233046;--w-text:#e6edf5;--w-text2:#a9b8c9;--w-mut:#7b8ca0;--w-p-soft:rgba(94,234,212,.12)}
.o3-ws.o3-embed{position:relative;top:auto;inset:auto;z-index:auto;animation:none;min-height:520px;border-radius:16px}
.o3-ws-head{display:flex;align-items:center;gap:14px;padding:14px 22px;background:var(--w-card);border-bottom:1px solid var(--w-line);flex-wrap:wrap}
.o3-ws-ic{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:22px;background:var(--w-p-soft);border:1px solid color-mix(in srgb,var(--w-p) 30%,transparent)}
.o3-ws-title{min-width:0}
.o3-ws-title h2{margin:0;font-size:19px;font-weight:750;display:flex;align-items:center;gap:8px}
.o3-ws-title p{margin:0;font-size:12.5px;color:var(--w-text2);max-width:640px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.o3-ws-acts{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}
.o3-wb{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:10px;border:1px solid var(--w-line);background:var(--w-card);color:var(--w-text);font-weight:650;font-size:13px}
.o3-wb:hover{border-color:var(--w-p);color:var(--w-p)}
.o3-wb.o3-on{background:var(--w-p);border-color:var(--w-p);color:#fff}
.o3-wb.o3-pri{background:var(--w-p);border-color:var(--w-p);color:#fff}
.o3-wb.o3-pri:hover{filter:brightness(1.08);color:#fff}
.o3-ws-tabs{display:flex;gap:6px;padding:10px 22px 0;overflow:auto;scrollbar-width:thin}
.o3-wt{padding:8px 16px;border-radius:999px;font-weight:650;font-size:13.5px;color:var(--w-text2);background:transparent;border:1px solid transparent;white-space:nowrap}
.o3-wt:hover{background:var(--w-card);border-color:var(--w-line)}
.o3-wt.o3-active{background:var(--w-p);color:#fff;box-shadow:0 4px 12px color-mix(in srgb,var(--w-p) 35%,transparent)}
.o3-subs{display:flex;gap:4px;padding:12px 22px 0;border-bottom:1px solid var(--w-line);background:var(--w-bg);overflow:auto;scrollbar-width:thin}
.o3-st{padding:9px 14px;font-weight:650;font-size:13.5px;color:var(--w-text2);border-bottom:2.5px solid transparent;white-space:nowrap;border-radius:8px 8px 0 0}
.o3-st:hover{color:var(--w-text);background:color-mix(in srgb,var(--w-card) 60%,transparent)}
.o3-st.o3-active{color:var(--w-p);border-bottom-color:var(--w-p);background:var(--w-card)}
.o3-st.o3-add{color:var(--w-mut)}
.o3-ws-body{flex:1;overflow:auto;padding:18px 22px 110px}
.o3-grid{display:grid;grid-template-columns:repeat(var(--cols,3),minmax(0,1fr));gap:16px;align-items:start}
.o3-wg{position:relative;background:var(--w-card);border:1px solid var(--w-line);border-radius:16px;padding:14px 16px 16px;box-shadow:0 1px 2px rgba(16,24,40,.05),0 4px 16px rgba(16,24,40,.05);min-width:0}
.o3-wg-h{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.o3-wg-h h3{margin:0;font-size:14px;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.o3-wg-h .o3-wg-tb{display:flex;gap:2px}
.o3-wg-tb button{font-size:12px;padding:4px 7px;border-radius:7px;color:var(--w-mut)}
.o3-wg-tb button:hover{background:var(--w-p-soft);color:var(--w-p)}
.o3-editing .o3-wg{outline:2px dashed color-mix(in srgb,var(--w-p) 45%,transparent);outline-offset:2px}
.o3-add-tile{display:grid;place-items:center;min-height:120px;border:2px dashed var(--w-line);border-radius:16px;color:var(--w-mut);font-weight:650;background:transparent}
.o3-add-tile:hover{border-color:var(--w-p);color:var(--w-p)}
.o3-kv{font-size:32px;font-weight:650;color:var(--w-text);line-height:1.1}
.o3-kv small{font-size:14px;font-weight:600;color:var(--w-text2);margin-left:4px}
.o3-kd{font-size:12.5px;margin-top:4px;color:var(--w-text2);display:flex;gap:10px;align-items:center}
.o3-kd.o3-up b{color:#006300}.o3-kd.o3-down b{color:#b42318}
.o3-ws.o3-dark .o3-kd.o3-up b{color:#0ca30c}.o3-ws.o3-dark .o3-kd.o3-down b{color:#f97066}
.o3-tone{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:650;padding:2px 8px;border-radius:999px}
.o3-tone-critical{background:#fdeeee;color:#b42318}.o3-tone-warning{background:#fff6dd;color:#8a5a00}.o3-tone-good{background:#eafaea;color:#0b6b0b}
.o3-ws.o3-dark .o3-tone-critical{background:rgba(208,59,59,.2);color:#fda29b}.o3-ws.o3-dark .o3-tone-warning{background:rgba(250,178,25,.18);color:#fcd34d}.o3-ws.o3-dark .o3-tone-good{background:rgba(12,163,12,.2);color:#86efac}
.o3-counter{display:flex;align-items:baseline;gap:8px}
.o3-counter b{font-size:44px;font-weight:650;line-height:1;color:var(--w-p)}
.o3-bar{height:10px;border-radius:999px;background:var(--w-p-soft);overflow:hidden;margin-top:8px}
.o3-bar i{display:block;height:100%;border-radius:999px;background:var(--w-p)}
.o3-tbl-wrap{overflow:auto;max-height:420px;border:1px solid var(--w-line);border-radius:10px}
.o3-tbl{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
.o3-tbl th{position:sticky;top:0;background:color-mix(in srgb,var(--w-card) 92%,var(--w-p));text-align:left;font-weight:700;color:var(--w-text2);padding:8px 10px;border-bottom:1px solid var(--w-line);white-space:nowrap;cursor:pointer}
.o3-tbl td{padding:7px 10px;border-bottom:1px solid var(--w-line);vertical-align:top}
.o3-tbl tr:last-child td{border-bottom:0}
.o3-tbl td.o3-num{text-align:right}
.o3-tbl .o3-rowx{opacity:0;color:var(--w-mut)}
.o3-tbl tr:hover .o3-rowx{opacity:1}
.o3-tbl-tools{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
.o3-tbl-tools input{flex:1;min-width:140px;padding:7px 10px;border-radius:9px;border:1px solid var(--w-line);background:var(--w-bg);color:var(--w-text);outline:none}
.o3-sample{display:flex;gap:10px;align-items:center;font-size:12.5px;background:#fff8e6;color:#7a5200;border:1px solid #f5d98b;border-radius:10px;padding:6px 10px;margin-bottom:8px}
.o3-ws.o3-dark .o3-sample{background:rgba(250,178,25,.12);color:#fcd34d;border-color:rgba(250,178,25,.3)}
.o3-sample button{font-weight:700;text-decoration:underline}
.o3-form{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.o3-form label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--w-text2);font-weight:600}
.o3-form input,.o3-form select{padding:8px 10px;border-radius:9px;border:1px solid var(--w-line);background:var(--w-bg);color:var(--w-text);outline:none;font-size:13.5px}
.o3-form input:focus,.o3-form select:focus{border-color:var(--w-p)}
.o3-note{font-size:13.5px;color:var(--w-text);white-space:normal}
.o3-note p{margin:0 0 6px}
.o3-cl label{display:flex;gap:9px;align-items:flex-start;padding:5px 0;font-size:13.5px;cursor:pointer}
.o3-cl input{accent-color:var(--w-p);margin-top:3px;width:16px;height:16px}
.o3-cl .o3-done{text-decoration:line-through;color:var(--w-mut)}
.o3-links a{display:flex;align-items:center;gap:8px;padding:7px 0;color:var(--w-p);text-decoration:none;font-weight:600;font-size:13.5px;border-bottom:1px solid var(--w-line)}
.o3-links a:last-child{border-bottom:0}
.o3-links a:hover{text-decoration:underline}
.o3-tl{display:flex;flex-direction:column;gap:10px;border-left:2px solid var(--w-line);padding-left:14px}
.o3-tl div{position:relative;font-size:13.5px}
.o3-tl div::before{content:"";position:absolute;left:-20px;top:6px;width:10px;height:10px;border-radius:50%;background:var(--w-p);box-shadow:0 0 0 3px var(--w-card)}
.o3-tl small{display:block;color:var(--w-mut);font-size:11.5px}
.o3-calc{display:flex;flex-direction:column;gap:8px}
.o3-calc .o3-res{font-size:26px;font-weight:650;color:var(--w-p)}
.o3-site p{margin:0 0 6px;font-size:13.5px}
.o3-site .o3-src{font-size:12px;color:var(--w-mut);margin-top:8px}
.o3-ws-ask{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);width:min(760px,calc(100% - 32px));display:flex;gap:8px;align-items:center;background:#0b1322;border-radius:999px;padding:7px 7px 7px 18px;box-shadow:0 0 0 1.5px rgba(45,212,191,.6),0 14px 40px rgba(2,8,23,.35)}
.o3-ws-ask input{flex:1;background:transparent;border:0;outline:none;color:#f1f5f9;font-size:14.5px;padding:8px 0}
.o3-ws-ask input::placeholder{color:#7c8ea3}
.o3-ws-ask button{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#5eead4,#14b8a6);color:#042f2c;display:grid;place-items:center}
.o3-ws-ask .o3-aurora{font-size:12px;font-weight:800;color:#5eead4;letter-spacing:.6px}
.o3-ws-reply{position:absolute;left:50%;bottom:78px;transform:translateX(-50%);width:min(760px,calc(100% - 32px));background:#0f1a2d;color:#e6edf5;border:1px solid rgba(45,212,191,.35);border-radius:14px;padding:10px 14px;font-size:13.5px;box-shadow:0 14px 40px rgba(2,8,23,.35);display:none}
.o3-ws-reply.o3-show{display:block;animation:o3in .2s}
.o3-empty{color:var(--w-mut,#8a97a6);font-size:13px;padding:24px 8px;text-align:center}
/* gráficos */
.o3-chart{position:relative;width:100%}
.o3-chart svg{display:block;overflow:visible}
.o3-chart .o3-mark{transition:opacity .12s}
.o3-chart svg:hover .o3-mark{opacity:.85}
.o3-chart .o3-mark:hover{opacity:1}
.o3-tip{position:absolute;display:none;pointer-events:none;background:#0b1322;color:#f1f5f9;border-radius:10px;padding:7px 10px;font-size:12px;box-shadow:0 8px 24px rgba(2,8,23,.3);z-index:5;white-space:nowrap}
.o3-tip-t{color:#9fb0c3;font-size:11.5px;margin-bottom:3px}
.o3-tip-r{display:flex;align-items:center;gap:7px}
.o3-tip-k{display:inline-block;width:14px;border-radius:2px}
.o3-tip-r b{font-size:13px}
.o3-tip-l{color:#9fb0c3}
.o3-legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:8px;font-size:12px;color:var(--w-text2,#52514e)}
.o3-legend-side{position:absolute;top:8px;right:0;flex-direction:column;margin:0}
.o3-lg{display:flex;align-items:center;gap:6px}
.o3-lg b{color:var(--w-text,#0b0b0b);font-weight:650;margin-left:4px}
.o3-lg-ic{font-size:11px}
.o3-sw{width:10px;height:10px;border-radius:3px;flex:none}
.o3-sw-line{height:3px;width:14px;border-radius:2px}
/* dock do Slack */
.o3-dock{position:fixed;right:0;top:var(--dock-y,70vh);z-index:20;display:flex;align-items:center;gap:8px;height:46px;padding:0 12px 0 11px;border-radius:14px 0 0 14px;background:#4a154b;color:#fff;font:700 13.5px/1 "Segoe UI",system-ui,sans-serif;box-shadow:0 8px 24px rgba(74,21,75,.35),inset 0 0 0 1px rgba(255,255,255,.08);transform:translateX(calc(100% - 46px));transition:transform .22s ease,top .25s ease,opacity .2s,box-shadow .2s;cursor:grab;touch-action:none;user-select:none}
.o3-dock.o3-left{right:auto;left:0;border-radius:0 14px 14px 0;flex-direction:row-reverse;padding:0 11px 0 12px;transform:translateX(calc(-100% + 46px))}
.o3-dock:hover,.o3-dock:focus-visible,.o3-dock.o3-peek{transform:translateX(0)}
.o3-dock.o3-tuck{transform:translateX(calc(100% - 7px));opacity:.9;box-shadow:0 0 14px rgba(224,30,90,.55)}
.o3-dock.o3-left.o3-tuck{transform:translateX(calc(-100% + 7px))}
.o3-dock.o3-tuck:hover{transform:translateX(0);opacity:1}
.o3-dock.o3-drag{cursor:grabbing;transition:none}
.o3-dock svg{width:24px;height:24px;flex:none}
.o3-dock .o3-dl{white-space:nowrap}
.o3-dock .o3-db{position:absolute;top:4px;left:6px;min-width:17px;height:17px;border-radius:9px;background:#e01e5a;font-size:10.5px;display:none;place-items:center;padding:0 4px;box-shadow:0 0 0 2px #4a154b}
.o3-dock.o3-left .o3-db{left:auto;right:6px}
.o3-dock .o3-db.o3-show{display:grid}
@media (max-width:900px){.o3-side{position:absolute;z-index:12;left:10px;top:78px;bottom:14px;box-shadow:0 20px 50px rgba(0,0,0,.5)}.o3-bub,.o3-ai-col{max-width:92%}.o3-brand h1{font-size:21px}.o3-grid{grid-template-columns:1fr!important}.o3-wg{grid-column:auto!important}}
@media (max-width:560px){.o3-head-r .o3-btn,.o3-head-r .o3-ib[aria-label=Expandir]{display:none}.o3-brand h1{font-size:19px}.o3-head{padding:12px 12px 8px}.o3-body{padding:0 8px 10px}.o3-msgs{padding:14px 12px}.o3-logo{width:40px;height:40px}.o3-pill{display:none}.o3-hint{display:none}.o3-send{width:46px;height:46px}.o3-attach{width:42px;height:42px}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
@media print{.o3-ws-ask,.o3-ws-acts{display:none}}
`;
let _sheet = null;
function adoptStyles(root) {
  try {
    if (!_sheet) {
      _sheet = new CSSStyleSheet();
      _sheet.replaceSync(CSS);
    }
    root.adoptedStyleSheets = [...(root.adoptedStyleSheets || []), _sheet];
  } catch (e) {
    root.appendChild(h('style', { text: CSS }));
  }
}
