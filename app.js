'use strict';

// ═══════════════════════════════════════════════════════
// STATE — all declared before any use
// ═══════════════════════════════════════════════════════
let TOKEN    = null;   // JWT
let CU       = null;   // { id, name, role }
let DB       = { tasks:[], history:[], glossary:[], logs:[], procContents:{}, chatLogs:[] };
let curPage  = 'overview';
let tf       = { s:true, m:true };
let confirmCb = null;
let chatOpen  = false;
let chatMsgId = 0;
let botTyping = false;
let isOnline  = true;
let saveTimer = null;

const LS_TOKEN = 'ojt_token_v3';
const LS_DB    = 'ojt_offline_db_v3';

// ── Stage info ─────────────────────────────────────────
const STAGE_INFO = {
  s1:{label:'단계 01',title:'영업 · 수주',color:'fc-s',badge:'스태핑 주도',icon:'🤝'},
  s2:{label:'단계 02',title:'채 용',color:'fc-s',badge:'스태핑 주도',icon:'👥'},
  s3:{label:'단계 03',title:'입 사',color:'fc-b',badge:'공동',icon:'📝'},
  s4:{label:'단계 04',title:'근태 · 급여',color:'fc-b',badge:'공동',icon:'💰'},
  s5:{label:'단계 05',title:'정산 · 신고',color:'fc-m',badge:'경영지원 주도',icon:'📊'},
  s6:{label:'단계 06',title:'연간 법정',color:'fc-b',badge:'공동',icon:'📅'},
  s7:{label:'단계 07',title:'퇴 직',color:'fc-b',badge:'공동',icon:'👋'}
};
const CHAT_SUGGESTIONS = [
  '고객사 컨택은 어떻게 진행하나요?','파견 미사용 업체 리스트 작성 방법 알려줘',
  '근태 청구는 어떻게 하나요?','급여대장 검증 시 주의사항은?',
  '신원보증보험 가입 절차 알려줘','파견대행료 작성 방법 알려줘',
  '과거 급여 오류 이슈가 있었나요?','4대보험 신고는 언제까지 해야 하나요?'
];

// ═══════════════════════════════════════════════════════
// API CLIENT
// ═══════════════════════════════════════════════════════
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type':'application/json' }
  };
  if (TOKEN) opts.headers['Authorization'] = 'Bearer ' + TOKEN;
  if (body)  opts.body = JSON.stringify(body);
  try {
    const res = await fetch('/api' + path, opts);
    if (res.status === 401) { handleLogout(); return null; }
    const data = await res.json();
    if (!res.ok) { toast(data.error || '서버 오류', 'error'); return null; }
    setOnline(true);
    return data;
  } catch(e) {
    setOnline(false);
    return null;
  }
}

function setOnline(online) {
  isOnline = online;
  const el = document.getElementById('net-status');
  if (!online) {
    el.textContent = '서버 연결 없음 — 오프라인 모드로 동작 중';
    el.className = 'offline';
    setSaveIndicator('error', '오프라인');
  } else {
    el.className = '';
  }
}

// ═══════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════
async function doLogin() {
  const id  = document.getElementById('login-id').value.trim();
  const pw  = document.getElementById('login-pw').value;
  const err = document.getElementById('login-error');
  const btn = document.getElementById('login-submit-btn');
  if (!id || !pw) { err.textContent = 'ID와 비밀번호를 입력하세요.'; return; }
  btn.disabled = true; btn.textContent = '로그인 중...';
  err.textContent = '';
  const data = await api('POST', '/auth/login', { id, password: pw });
  btn.disabled = false; btn.textContent = '로그인';
  if (!data) { err.textContent = '서버에 연결할 수 없습니다.'; return; }
  TOKEN = data.token;
  CU    = data.user;
  localStorage.setItem(LS_TOKEN, TOKEN);
  await onLoginSuccess();
}

async function onLoginSuccess() {
  // Load DB from server
  const db = await api('GET', '/data');
  if (db) {
    DB = db;
    localStorage.setItem(LS_DB, JSON.stringify(DB));
  } else {
    // Offline fallback
    const saved = localStorage.getItem(LS_DB);
    if (saved) { try { DB = JSON.parse(saved); } catch(e) {} }
  }
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.add('active');
  // Setup UI
  const icons = {admin:'👑',staffing:'🏢',mgmt:'💼'};
  const pill  = document.getElementById('user-pill');
  pill.className = 'user-pill ' + CU.role;
  document.getElementById('user-icon').textContent = icons[CU.role]||'👤';
  document.getElementById('user-name').textContent  = CU.name || CU.id;
  const adminOnly = ['sb-logs','sb-chatlog','sb-perm'];
  adminOnly.forEach(id => { const el=document.getElementById(id); if(el) el.style.display=(CU.role==='admin'?'':'none'); });
  setSaveIndicator('saved', '서버 연결됨');
  showPage('overview');
  updHistBadge();
}

function handleLogout() {
  api('POST', '/auth/logout').catch(()=>{});
  TOKEN = null; CU = null;
  localStorage.removeItem(LS_TOKEN);
  document.getElementById('app').classList.remove('active');
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-id').value = '';
  document.getElementById('login-pw').value = '';
  document.getElementById('login-error').textContent = '';
}

function openUserMenu() {
  const items = [
    `<strong>${CU.name}</strong> (${{admin:'관리자',staffing:'스태핑서비스팀',mgmt:'경영지원팀'}[CU.role]||CU.role})`,
    `<span class="pw-change-link" onclick="openChangePw()">🔑 비밀번호 변경</span>`,
    `<span class="pw-change-link" onclick="handleLogout()" style="color:var(--w)">🚪 로그아웃</span>`
  ];
  showConfirm('사용자 메뉴', items.join('\n'), null, '닫기');
}

async function changePassword() {
  const cur  = document.getElementById('cpw-cur').value;
  const nw   = document.getElementById('cpw-new').value;
  const conf = document.getElementById('cpw-confirm').value;
  const err  = document.getElementById('cpw-error');
  if (!cur || !nw) { err.textContent = '모든 항목을 입력하세요.'; return; }
  if (nw !== conf)  { err.textContent = '새 비밀번호가 일치하지 않습니다.'; return; }
  if (nw.length < 6){ err.textContent = '비밀번호는 6자 이상이어야 합니다.'; return; }
  const r = await api('POST', '/auth/change-password', { currentPassword: cur, newPassword: nw });
  if (r) { closeM('modal-cpw'); toast('비밀번호가 변경되었습니다', 'success'); }
}
function openChangePw() {
  closeAll();
  ['cpw-cur','cpw-new','cpw-confirm'].forEach(id=>{ document.getElementById(id).value=''; });
  document.getElementById('cpw-error').textContent='';
  openM('modal-cpw');
}

async function openResetPw() {
  const users = await api('GET', '/auth/users');
  if (!users) return;
  const sel = document.getElementById('rpw-uid');
  sel.innerHTML = users.map(u=>`<option value="${u.id}">${u.name} (${u.id})</option>`).join('');
  document.getElementById('rpw-new').value='';
  openM('modal-rpw');
}
async function resetPassword() {
  const uid = document.getElementById('rpw-uid').value;
  const pw  = document.getElementById('rpw-new').value;
  if (!pw || pw.length<6) { toast('비밀번호는 6자 이상이어야 합니다','error'); return; }
  const r = await api('POST', '/auth/reset-password', { userId: uid, newPassword: pw });
  if (r) { closeM('modal-rpw'); toast(r.message, 'success'); }
}
function closeAll() {
  document.querySelectorAll('.modal-overlay.active').forEach(m=>m.classList.remove('active'));
  document.getElementById('confirm-overlay').classList.remove('active');
}

// ─ Permissions ─
function canEdit(team) {
  if (!CU) return false;
  if (CU.role==='admin') return true;
  if (CU.role==='staffing' && (team==='staffing'||team==='both')) return true;
  if (CU.role==='mgmt'     && (team==='mgmt'    ||team==='both')) return true;
  return false;
}
function canDel(team) {
  if (!CU) return false;
  if (CU.role==='admin') return true;
  if (CU.role==='staffing' && team==='staffing') return true;
  if (CU.role==='mgmt'     && team==='mgmt')     return true;
  return false;
}

// ─ Save indicator ─
function setSaveIndicator(state, text) {
  const ind = document.getElementById('save-indicator');
  const dot = ind.querySelector('.save-dot');
  const sp  = document.getElementById('save-text');
  ind.className = 'save-indicator ' + state;
  dot.className = 'save-dot' + (state==='saving'?' pulse':'');
  sp.textContent = text;
}

// ═══════════════════════════════════════════════════════
// NAV
// ═══════════════════════════════════════════════════════
function showPage(id) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.sb-item').forEach(s=>s.classList.remove('active'));
  const pg = document.getElementById('page-'+id);
  if (pg) pg.classList.add('active');
  const sb = document.querySelector('[data-page="'+id+'"]');
  if (sb) sb.classList.add('active');
  curPage = id;
  const map = { overview:renderOverview, manual:renderManualPage, history:renderHistPage,
    glossary:renderGlossPage, logs:renderLogsPage, chatlog:renderChatlogPage, permissions:renderPermsPage };
  if (map[id]) map[id]();
  if (window.innerWidth<=768) document.getElementById('sidebar').classList.add('hidden');
}
function toggleSB() { document.getElementById('sidebar').classList.toggle('hidden'); }
function showLogin() { handleLogout(); }

// ═══════════════════════════════════════════════════════
// OVERVIEW
// ═══════════════════════════════════════════════════════
function renderOverview() {
  const urg = DB.history.filter(h=>h.priority==='urgent').length;
  let fp = 0;
  DB.tasks.forEach(t=>(t.procedures||[]).forEach(p=>{ const pc=getProcContent(t.id,p.id); if(pc.text||(pc.images&&pc.images.length)) fp++; }));
  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card"><div class="stat-num">${DB.tasks.length}</div><div class="stat-label">전체 업무 수</div></div>
    <div class="stat-card"><div class="stat-num">${fp}</div><div class="stat-label">작성된 처리절차</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--w)">${urg}</div><div class="stat-label">긴급 이슈</div></div>
    <div class="stat-card"><div class="stat-num">${DB.history.length}</div><div class="stat-label">누적 이슈</div></div>`;
  const stages=['s1','s2','s3','s4','s5','s6','s7'];
  document.getElementById('flow-diagram').innerHTML = stages.map((sid,i)=>{
    const si=STAGE_INFO[sid]; const isL=i===stages.length-1;
    return `<div class="flow-row">
      <div class="flow-num-col"><div class="flow-num">${i+1}</div>${isL?'':'<div class="flow-line"></div>'}</div>
      <div class="flow-card ${si.color}" onclick="showPage('manual');setTimeout(()=>{const e=document.getElementById('stage-${sid}');if(e)e.scrollIntoView({behavior:'smooth',block:'start'});},150)">
        <div><div class="fc-text">${si.icon} ${si.title}</div></div>
        <div class="fc-badge">${si.badge}</div>
      </div></div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════
// MANUAL PAGE — 2-level accordion
// ═══════════════════════════════════════════════════════
function renderManualPage() {
  fillTaskSelect(document.getElementById('hfm-task'));
  const stages=['s1','s2','s3','s4','s5','s6','s7'];
  const tasks = DB.tasks.filter(t=>{ if(!tf.s&&t.team==='staffing')return false; if(!tf.m&&t.team==='mgmt')return false; return true; });
  document.getElementById('manual-content').innerHTML = stages.map(sid=>{
    const si=STAGE_INFO[sid];
    const st=tasks.filter(t=>t.stage===sid);
    if(!st.length) return '';
    return `<div id="stage-${sid}" style="margin-bottom:28px">
      <div class="stage-sec-head">
        <div class="stage-lbl">${si.label}</div>
        <div class="stage-main-title">${si.icon} ${si.title}</div>
      </div>
      ${st.map((t,i)=>renderTaskCard(t,i,st.length)).join('')}
    </div>`;
  }).join('');
}
function toggleTF(t){ tf[t]=!tf[t]; document.getElementById('tf-'+t).classList.toggle('off',!tf[t]); renderManualPage(); }

function renderTaskCard(t,idx,total) {
  const tc=t.team==='staffing'?'tag-s':t.team==='mgmt'?'tag-m':'tag-b';
  const tl=t.team==='staffing'?'스태핑':t.team==='mgmt'?'경영지원':'공동';
  const hc=DB.history.filter(h=>h.taskId===t.id).length;
  const procs=t.procedures||[];
  const fc=procs.filter(p=>{ const pc=getProcContent(t.id,p.id); return pc.text||(pc.images&&pc.images.length); }).length;
  const eb=canEdit(t.team)?`<button class="btn btn-outline btn-xs" onclick="openEditTask('${t.id}');event.stopPropagation()">⚙️</button>`:'';
  const db=canDel(t.team)?`<button class="btn btn-danger btn-xs" onclick="delTask('${t.id}');event.stopPropagation()">🗑️</button>`:'';
  return `<div class="task-card" id="tc-${t.id}">
    <div class="task-card-header" onclick="toggleTC('${t.id}')">
      <div class="tc-num">${idx+1}</div>
      <div class="tc-info">
        <div class="tc-name">${esc(t.name)} ${hc?`<span style="font-size:10px;background:var(--wl);color:var(--w);padding:1px 5px;border-radius:5px;font-weight:700;margin-left:4px">${hc}건</span>`:''}</div>
        <div class="tc-meta"><span class="tag ${tc}">${tl}</span><span class="time-badge">${esc(t.time||'')}</span><span style="font-size:11px;color:var(--muted)">${procs.length}개 절차 · ${fc}개 작성됨</span></div>
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0" onclick="event.stopPropagation()">${eb}<button class="btn btn-outline btn-xs" onclick="openAddHistModal('${t.id}');event.stopPropagation()">📝</button>${db}</div>
      <span class="tc-chev">⌄</span>
    </div>
    <div class="task-card-body">
      ${t.caution?`<div style="font-size:11px;padding:8px 16px;background:var(--wl);color:var(--w);border-bottom:1px solid var(--border)">⚠️ ${esc(t.caution)}</div>`:''}
      ${t.tip?`<div style="font-size:11px;padding:8px 16px;background:#EBF4FF;color:#1E3A5F;border-bottom:1px solid var(--border)">💡 ${esc(t.tip)}</div>`:''}
      <div class="proc-list" id="pl-${t.id}">
        ${procs.map((p,pi)=>renderProcItem(t,p,pi)).join('')}
        ${canEdit(t.team)?`<button class="btn btn-outline btn-xs" onclick="addProcedure('${t.id}')" style="margin-top:6px">＋ 처리절차 추가</button>`:''}
      </div>
    </div>
  </div>`;
}
function toggleTC(tid){ const el=document.getElementById('tc-'+tid); if(el)el.classList.toggle('tc-open'); }

function renderProcItem(t,p,pi) {
  const pc=getProcContent(t.id,p.id);
  const has=pc.text||(pc.images&&pc.images.length);
  return `<div class="proc-item" id="pi-${p.id}">
    <div class="proc-header" onclick="togglePI('${p.id}')">
      <div class="proc-num">${pi+1}</div>
      <div class="proc-title-text">${esc(p.title)}</div>
      <span class="proc-status ${has?'ps-filled':'ps-empty'}">${has?'작성됨':'비어있음'}</span>
      <span class="proc-chev">⌄</span>
    </div>
    <div class="proc-detail" id="pd-${p.id}">${renderProcDetail(t,p)}</div>
  </div>`;
}
function togglePI(pid){ const el=document.getElementById('pi-'+pid); if(el)el.classList.toggle('pi-open'); }

function getProcContent(taskId,procId){ const k=taskId+'::'+procId; return (DB.procContents&&DB.procContents[k])||{text:'',images:[]}; }

function renderProcDetail(t,p) {
  const pc=getProcContent(t.id,p.id);
  const key=t.id+'::'+p.id;
  const canE=canEdit(t.team);
  let html='';
  if(canE){
    html+=`<div class="pd-toolbar">
      <button class="pd-tool-btn" id="pdt-edit-${key}" onclick="startProcEdit('${t.id}','${p.id}')">✏️ 편집 시작</button>
      <div class="pd-tool-sep"></div>
      <button class="pd-tool-btn" onclick="addImgToProcForm('${t.id}','${p.id}')">🖼️ 이미지 추가</button>
      <button class="pd-tool-btn" onclick="insertIssueBlock('${t.id}','${p.id}')">🚨 이슈 블록 추가</button>
    </div>`;
  }
  html+=`<div class="pd-content">
    <div id="pv-${key}" class="pd-view-area">${pc.text?mdToHtml(pc.text):''}</div>`;
  if(canE){
    html+=`<div id="pe-${key}" style="display:none">
      <textarea class="pd-edit-area" id="pta-${key}" rows="10"
        placeholder="처리절차에 대한 상세 내용을 자유롭게 작성하세요.\n\n예:\n1. 먼저 사람인 기업검색 또는 기존 CRM을 확인한다.\n2. 파견 사용 가능성이 높은 업종을 중심으로 기업을 선별한다.\n\n주의사항:\n- CRM 미확인 시 중복 컨택이 발생할 수 있음\n\n이슈 사례:\n- 동일 업체에 중복 메일 발송 발생\n- 해결: 컨택 전 CRM 조회 필수 절차 추가"
      >${esc(pc.text||'')}</textarea>
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="btn btn-primary btn-sm" onclick="saveProcContent('${t.id}','${p.id}')">💾 서버에 저장</button>
        <button class="btn btn-outline btn-sm" onclick="cancelProcEdit('${t.id}','${p.id}')">취소</button>
      </div>
    </div>`;
  }
  const imgs=pc.images||[];
  if(imgs.length){
    html+=`<div class="proc-imgs">`;
    imgs.forEach((img,ii)=>{
      html+=`<div class="pi-card">
        <div class="pi-thumb" onclick="openLB('${img.src}','${esc(img.title||'')}')">
          ${img.src?`<img src="${img.src}" alt="">`:'🖼️'}
        </div>
        <div class="pi-info"><div class="pi-title">${esc(img.title||'')}</div><div class="pi-meta">${esc(img.desc||'')}</div>
          ${canE?`<button class="btn btn-danger btn-xs" style="margin-top:4px" onclick="deleteProcImg('${t.id}','${p.id}',${ii})">🗑️</button>`:''}
        </div></div>`;
    });
    html+=`</div>`;
  }
  if(pc.lastModified){ html+=`<div style="font-size:10px;color:var(--muted);margin-top:8px">마지막 저장: ${pc.lastModified}${pc.lastEditor?' by '+pc.lastEditor:''}</div>`; }
  html+='</div>';
  return html;
}

function mdToHtml(t){ if(!t)return''; return esc(t).replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>'); }

function startProcEdit(taskId,procId){
  const key=taskId+'::'+procId;
  const pc=getProcContent(taskId,procId);
  document.getElementById('pv-'+key).style.display='none';
  const pe=document.getElementById('pe-'+key); if(pe)pe.style.display='';
  const ta=document.getElementById('pta-'+key); if(ta){ta.value=pc.text||''; ta.focus();}
  const btn=document.getElementById('pdt-edit-'+key);
  if(btn){btn.textContent='✅ 편집 중';btn.style.background='var(--m)';btn.style.color='#fff';}
}
function cancelProcEdit(taskId,procId){
  const key=taskId+'::'+procId;
  const pc=getProcContent(taskId,procId);
  const ta=document.getElementById('pta-'+key); if(ta)ta.value=pc.text||'';
  document.getElementById('pv-'+key).style.display='';
  const pe=document.getElementById('pe-'+key); if(pe)pe.style.display='none';
  const btn=document.getElementById('pdt-edit-'+key);
  if(btn){btn.textContent='✏️ 편집 시작';btn.style.background='';btn.style.color='';}
}
async function saveProcContent(taskId,procId){
  const key=taskId+'::'+procId;
  const text=document.getElementById('pta-'+key)?.value||'';
  const pc=getProcContent(taskId,procId);
  const imgs=pc.images||[];
  setSaveIndicator('saving','저장 중...');
  const result=await api('PUT',`/tasks/${taskId}/procedures/${procId}`,{text,images:imgs});
  if(result){
    DB.procContents=DB.procContents||{};
    DB.procContents[key]=result;
    localStorage.setItem(LS_DB,JSON.stringify(DB));
    setSaveIndicator('saved','저장 완료');
    document.getElementById('pv-'+key).innerHTML=text?mdToHtml(text):'';
    document.getElementById('pv-'+key).style.display='';
    const pe=document.getElementById('pe-'+key); if(pe)pe.style.display='none';
    const btn=document.getElementById('pdt-edit-'+key);
    if(btn){btn.textContent='✏️ 편집 시작';btn.style.background='';btn.style.color='';}
    const pi=document.getElementById('pi-'+procId);
    if(pi){const chip=pi.querySelector('.proc-status');if(chip){chip.textContent=(text||imgs.length)?'작성됨':'비어있음';chip.className='proc-status '+((text||imgs.length)?'ps-filled':'ps-empty');}}
    toast('저장되었습니다','success');
  } else {
    setSaveIndicator('error','저장 실패 (오프라인 임시 저장)');
    DB.procContents=DB.procContents||{};
    DB.procContents[key]={...pc,text,images:imgs};
    localStorage.setItem(LS_DB,JSON.stringify(DB));
    toast('서버 저장 실패. 로컬에 임시 저장되었습니다.','warn');
  }
}
function insertIssueBlock(taskId,procId){
  const key=taskId+'::'+procId;
  let ta=document.getElementById('pta-'+key);
  if(!ta){startProcEdit(taskId,procId);setTimeout(()=>insertIssueBlock(taskId,procId),150);return;}
  const block=`\n\n[이슈/히스토리]\n- 발생일:\n- 발생 내용:\n- 원인:\n- 해결 방법:\n- 재발 방지:\n`;
  ta.value+=block; ta.focus(); ta.scrollTop=ta.scrollHeight;
}

async function addProcedure(taskId){
  const title=prompt('처리절차 제목을 입력하세요:');
  if(!title)return;
  const task=DB.tasks.find(t=>t.id===taskId); if(!task)return;
  const proc=await api('POST',`/tasks/${taskId}/procedures`,{title:title.trim()});
  if(proc){
    task.procedures=task.procedures||[];
    task.procedures.push(proc);
    localStorage.setItem(LS_DB,JSON.stringify(DB));
    renderManualPage();
    toast('처리절차가 추가되었습니다','success');
  }
}

function addImgToProcForm(taskId,procId){
  document.getElementById('pif-task-id').value=taskId;
  document.getElementById('pif-proc-id').value=procId;
  document.getElementById('pif-title').value='';
  document.getElementById('pif-desc').value='';
  document.getElementById('pif-data').value='';
  document.getElementById('pif-preview').style.display='none';
  openM('modal-proc-img');
}
function previewProcImg(){
  const file=document.getElementById('pif-file').files[0]; if(!file)return;
  const r=new FileReader();
  r.onload=e=>{document.getElementById('pif-data').value=e.target.result;document.getElementById('pif-prev-img').src=e.target.result;document.getElementById('pif-preview').style.display='';};
  r.readAsDataURL(file);
}
async function saveProcImg(){
  const title=document.getElementById('pif-title').value.trim();
  const data=document.getElementById('pif-data').value;
  if(!title){toast('이미지 제목을 입력하세요','error');return;}
  if(!data){toast('이미지를 선택하세요','error');return;}
  const taskId=document.getElementById('pif-task-id').value;
  const procId=document.getElementById('pif-proc-id').value;
  const key=taskId+'::'+procId;
  const pc=getProcContent(taskId,procId);
  const imgs=[...(pc.images||[]),{title,src:data,desc:document.getElementById('pif-desc').value,date:new Date().toLocaleDateString('ko-KR')}];
  const result=await api('PUT',`/tasks/${taskId}/procedures/${procId}`,{text:pc.text||'',images:imgs});
  if(result){
    DB.procContents=DB.procContents||{}; DB.procContents[key]=result;
    localStorage.setItem(LS_DB,JSON.stringify(DB));
    closeM('modal-proc-img'); renderManualPage(); toast('이미지가 추가되었습니다','success');
  }
}
async function deleteProcImg(taskId,procId,idx){
  const key=taskId+'::'+procId;
  const pc=getProcContent(taskId,procId);
  const imgs=(pc.images||[]).filter((_,i)=>i!==idx);
  const result=await api('PUT',`/tasks/${taskId}/procedures/${procId}`,{text:pc.text||'',images:imgs});
  if(result){DB.procContents=DB.procContents||{};DB.procContents[key]=result;localStorage.setItem(LS_DB,JSON.stringify(DB));renderManualPage();toast('삭제되었습니다');}
}

// Task CRUD
function openAddTask(){
  document.getElementById('tf-title').textContent='업무 추가'; document.getElementById('tf-id').value='';
  ['tf-name','tf-time','tf-summary','tf-caution','tf-tip','tf-deadline','tf-inner','tf-owner'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  document.getElementById('tf-team').value=(CU.role==='mgmt')?'mgmt':'staffing';
  document.getElementById('tf-stage').value='s1'; document.getElementById('tf-cycle').value='수시';
  openM('modal-tf');
}
function openEditTask(id){
  const t=DB.tasks.find(x=>x.id===id); if(!t)return;
  if(!canEdit(t.team)){toast('수정 권한이 없습니다','error');return;}
  document.getElementById('tf-title').textContent='업무 수정'; document.getElementById('tf-id').value=id;
  ['name','time','summary','caution','tip','deadline','inner_deadline','owner','team','stage','cycle'].forEach(f=>{
    const el=document.getElementById('tf-'+f.replace('_deadline','').replace('inner','inner')); if(el)el.value=t[f]||'';
  });
  document.getElementById('tf-name').value=t.name||''; document.getElementById('tf-team').value=t.team||'staffing';
  document.getElementById('tf-stage').value=t.stage||'s1'; document.getElementById('tf-time').value=t.time||'';
  document.getElementById('tf-cycle').value=t.cycle||'수시'; document.getElementById('tf-owner').value=t.owner||'';
  document.getElementById('tf-summary').value=t.summary||''; document.getElementById('tf-caution').value=t.caution||'';
  document.getElementById('tf-tip').value=t.tip||''; document.getElementById('tf-deadline').value=t.deadline||'';
  document.getElementById('tf-inner').value=t.inner_deadline||''; openM('modal-tf');
}
async function saveTaskForm(){
  const name=document.getElementById('tf-name').value.trim();
  if(!name){toast('업무명을 입력하세요','error');return;}
  const id=document.getElementById('tf-id').value;
  const d={name,team:document.getElementById('tf-team').value,stage:document.getElementById('tf-stage').value,
    time:document.getElementById('tf-time').value,cycle:document.getElementById('tf-cycle').value,
    owner:document.getElementById('tf-owner').value,summary:document.getElementById('tf-summary').value,
    caution:document.getElementById('tf-caution').value,tip:document.getElementById('tf-tip').value,
    deadline:document.getElementById('tf-deadline').value,inner_deadline:document.getElementById('tf-inner').value};
  if(id){
    const r=await api('PUT',`/tasks/${id}`,d);
    if(r){const idx=DB.tasks.findIndex(t=>t.id===id);if(idx>=0)DB.tasks[idx]={...DB.tasks[idx],...r};localStorage.setItem(LS_DB,JSON.stringify(DB));toast('수정되었습니다','success');}
  } else {
    const r=await api('POST','/tasks',d);
    if(r){DB.tasks.push(r);localStorage.setItem(LS_DB,JSON.stringify(DB));toast('업무가 추가되었습니다','success');}
  }
  if(!isOnline) toast('오프라인 상태입니다. 온라인 시 동기화됩니다.','warn');
  closeM('modal-tf'); renderManualPage();
}
async function delTask(id){
  const t=DB.tasks.find(x=>x.id===id); if(!t)return;
  if(!canDel(t.team)){toast('삭제 권한이 없습니다','error');return;}
  showConfirm('업무 삭제',`"${t.name}" 업무를 삭제하시겠습니까?`,async()=>{
    const r=await api('DELETE',`/tasks/${id}`);
    if(r){DB.tasks=DB.tasks.filter(x=>x.id!==id);localStorage.setItem(LS_DB,JSON.stringify(DB));renderManualPage();toast('삭제되었습니다');}
  });
}

// ═══════════════════════════════════════════════════════
// HISTORY
// ═══════════════════════════════════════════════════════
function renderHistPage(){
  updHistBadge();
  const team=document.getElementById('hf-team').value,type=document.getElementById('hf-type').value,
    prio=document.getElementById('hf-prio').value,kw=document.getElementById('hf-kw').value.toLowerCase();
  let list=[...DB.history].reverse();
  if(team)list=list.filter(h=>h.team===team); if(type)list=list.filter(h=>h.type===type);
  if(prio)list=list.filter(h=>h.priority===prio); if(kw)list=list.filter(h=>(h.content||h.cause||'').toLowerCase().includes(kw));
  const el=document.getElementById('hist-list');
  if(!list.length){el.innerHTML='<div style="text-align:center;padding:40px;color:var(--muted)">등록된 이슈가 없습니다.</div>';return;}
  const pBg={urgent:['var(--wl)','#E24B4A'],high:['#FEF3C7','#F59E0B'],normal:['#EFF6FF','#60A5FA'],low:['#F0FDF4','#4ADE80']};
  const pLbl={urgent:'긴급',high:'높음',normal:'보통',low:'낮음'};
  el.innerHTML=list.map(h=>{
    const [bg,bc]=pBg[h.priority||'normal'];const task=DB.tasks.find(t=>t.id===h.taskId);
    return `<div style="border:1px solid var(--border);border-left:3px solid ${bc};border-radius:0 9px 9px 0;padding:12px 14px;margin-bottom:8px;background:${bg};cursor:pointer" onclick="this.querySelector('.h-exp').style.display=this.querySelector('.h-exp').style.display==='none'||!this.querySelector('.h-exp').style.display?'block':'none'">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
        <span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:5px;background:#fff">${esc(h.type||'기타')}</span>
        <span style="font-size:10px;font-weight:700;color:var(--muted)">${pLbl[h.priority||'normal']}</span>
        <span style="font-size:10px;color:var(--muted)">${h.date||''}</span>
        ${task?`<span style="font-size:10px;color:var(--muted)">· ${esc(task.name)}</span>`:''}
        <div style="margin-left:auto;display:flex;gap:4px">
          <button class="btn btn-outline btn-xs" onclick="editHist('${h.id}');event.stopPropagation()">✏️</button>
          <button class="btn btn-danger btn-xs" onclick="delHist('${h.id}');event.stopPropagation()">🗑️</button>
        </div>
      </div>
      <div style="font-size:13px;font-weight:600;line-height:1.5">${esc((h.content||'').substring(0,80))}${(h.content||'').length>80?'…':''}</div>
      <div class="h-exp" style="display:none;margin-top:8px">
        ${h.cause?`<div style="font-size:12px;margin-bottom:4px"><strong style="color:var(--muted);font-size:11px">원인</strong><br>${esc(h.cause)}</div>`:''}
        ${h.action?`<div style="font-size:12px;margin-bottom:4px"><strong style="color:var(--muted);font-size:11px">조치</strong><br>${esc(h.action)}</div>`:''}
        ${h.result?`<div style="font-size:12px;margin-bottom:4px"><strong style="color:var(--muted);font-size:11px">결과</strong><br>${esc(h.result)}</div>`:''}
        ${h.prevent?`<div style="font-size:12px;padding:6px 10px;background:#EBF4FF;border-left:3px solid #3B82F6;border-radius:0 6px 6px 0;margin-top:4px">🛡️ 재발 방지: ${esc(h.prevent)}</div>`:''}
      </div>
    </div>`;
  }).join('');
}
function openAddHistModal(taskId){
  fillTaskSelect(document.getElementById('hfm-task'));
  document.getElementById('hfm-date').value=new Date().toISOString().split('T')[0];
  document.getElementById('hfm-id').value=''; document.getElementById('hfm-task').value=taskId||'';
  ['hfm-related','hfm-content','hfm-cause','hfm-action','hfm-result','hfm-prevent','hfm-author'].forEach(id=>{document.getElementById(id).value='';});
  document.getElementById('hfm-prio').value='normal'; document.getElementById('hfm-type').value='급여오류';
  document.getElementById('hfm-team').value=(CU.role==='mgmt')?'mgmt':'staffing';
  document.getElementById('hfm-author').value=CU.name||CU.id;
  openM('modal-hfm');
}
function editHist(id){
  const h=DB.history.find(x=>x.id===id); if(!h)return;
  fillTaskSelect(document.getElementById('hfm-task'));
  document.getElementById('hfm-id').value=id; document.getElementById('hfm-date').value=h.date||'';
  document.getElementById('hfm-prio').value=h.priority||'normal'; document.getElementById('hfm-task').value=h.taskId||'';
  document.getElementById('hfm-type').value=h.type||'기타'; document.getElementById('hfm-related').value=h.related||'';
  document.getElementById('hfm-content').value=h.content||''; document.getElementById('hfm-cause').value=h.cause||'';
  document.getElementById('hfm-action').value=h.action||''; document.getElementById('hfm-result').value=h.result||'';
  document.getElementById('hfm-prevent').value=h.prevent||''; document.getElementById('hfm-author').value=h.author||'';
  document.getElementById('hfm-team').value=h.team||'staffing'; openM('modal-hfm');
}
async function saveHistForm(){
  const content=document.getElementById('hfm-content').value.trim();
  if(!content){toast('발생 내용을 입력하세요','error');return;}
  const id=document.getElementById('hfm-id').value;
  const d={date:document.getElementById('hfm-date').value,priority:document.getElementById('hfm-prio').value,
    taskId:document.getElementById('hfm-task').value,type:document.getElementById('hfm-type').value,
    related:document.getElementById('hfm-related').value,content,cause:document.getElementById('hfm-cause').value,
    action:document.getElementById('hfm-action').value,result:document.getElementById('hfm-result').value,
    prevent:document.getElementById('hfm-prevent').value,author:document.getElementById('hfm-author').value,
    team:document.getElementById('hfm-team').value};
  if(id){
    const r=await api('PUT',`/history/${id}`,d);
    if(r){const idx=DB.history.findIndex(h=>h.id===id);if(idx>=0)DB.history[idx]=r;toast('수정되었습니다','success');}
  } else {
    const r=await api('POST','/history',d);
    if(r){DB.history.push(r);toast('등록되었습니다','success');}
  }
  localStorage.setItem(LS_DB,JSON.stringify(DB));
  closeM('modal-hfm'); updHistBadge(); if(curPage==='history')renderHistPage();
}
async function delHist(id){
  showConfirm('히스토리 삭제','이 히스토리를 삭제하시겠습니까?',async()=>{
    const r=await api('DELETE',`/history/${id}`);
    if(r){DB.history=DB.history.filter(h=>h.id!==id);localStorage.setItem(LS_DB,JSON.stringify(DB));updHistBadge();renderHistPage();toast('삭제되었습니다');}
  });
}
function updHistBadge(){ const el=document.getElementById('hist-badge'); if(el)el.textContent=DB.history.length; }

// ═══════════════════════════════════════════════════════
// GLOSSARY
// ═══════════════════════════════════════════════════════
function renderGlossPage(){
  const kw=document.getElementById('gloss-kw').value.toLowerCase();
  let terms=DB.glossary; if(kw)terms=terms.filter(g=>(g.term||'').toLowerCase().includes(kw)||(g.def||'').toLowerCase().includes(kw));
  document.getElementById('gloss-grid').innerHTML=terms.map(g=>`<div class="gloss-item">
    <div class="gloss-term">${esc(g.term)}</div><div class="gloss-def">${esc(g.def)}</div>
    ${CU&&CU.role==='admin'?`<div style="margin-top:8px;display:flex;gap:4px"><button class="btn btn-outline btn-xs" onclick="editGloss('${g.id}')">✏️</button><button class="btn btn-danger btn-xs" onclick="delGloss('${g.id}')">🗑️</button></div>`:''}
  </div>`).join('');
  document.getElementById('btn-add-gloss').style.display=(CU&&CU.role==='admin')?'':'none';
}
function openAddGloss(){ document.getElementById('gf-title').textContent='용어 추가'; document.getElementById('gf-id').value=''; document.getElementById('gf-term').value=''; document.getElementById('gf-def').value=''; openM('modal-gf'); }
function editGloss(id){ const g=DB.glossary.find(x=>x.id===id);if(!g)return; document.getElementById('gf-title').textContent='용어 수정'; document.getElementById('gf-id').value=id; document.getElementById('gf-term').value=g.term; document.getElementById('gf-def').value=g.def; openM('modal-gf'); }
async function saveGlossForm(){
  const term=document.getElementById('gf-term').value.trim(),def=document.getElementById('gf-def').value.trim();
  if(!term||!def){toast('용어와 설명을 입력하세요','error');return;}
  const id=document.getElementById('gf-id').value;
  if(id){const r=await api('PUT',`/glossary/${id}`,{term,def});if(r){const idx=DB.glossary.findIndex(g=>g.id===id);if(idx>=0)DB.glossary[idx]=r;toast('수정되었습니다','success');}}
  else{const r=await api('POST','/glossary',{term,def});if(r){DB.glossary.push(r);toast('추가되었습니다','success');}}
  localStorage.setItem(LS_DB,JSON.stringify(DB)); closeM('modal-gf'); renderGlossPage();
}
async function delGloss(id){ const g=DB.glossary.find(x=>x.id===id);if(!g)return; showConfirm('용어 삭제',`"${g.term}" 용어를 삭제하시겠습니까?`,async()=>{const r=await api('DELETE',`/glossary/${id}`);if(r){DB.glossary=DB.glossary.filter(x=>x.id!==id);localStorage.setItem(LS_DB,JSON.stringify(DB));renderGlossPage();toast('삭제되었습니다');}}); }

// ═══════════════════════════════════════════════════════
// LOGS / CHATLOG / PERMS
// ═══════════════════════════════════════════════════════
async function renderLogsPage(){
  const type=document.getElementById('log-type').value,kw=document.getElementById('log-kw').value.toLowerCase();
  const logs=await api('GET','/logs'); if(!logs)return;
  DB.logs=logs;
  let list=[...logs]; if(type)list=list.filter(l=>l.type===type); if(kw)list=list.filter(l=>(l.target||l.after||'').toLowerCase().includes(kw));
  const el=document.getElementById('logs-list');
  if(!list.length){el.innerHTML='<div style="text-align:center;padding:24px;color:var(--muted)">수정 이력이 없습니다.</div>';return;}
  el.innerHTML=list.map(l=>`<div class="log-row">
    <div class="log-time">${l.time||''}</div>
    <div class="log-badge log-${l.type==='추가'?'add':l.type==='수정'?'edit':'delete'}">${l.type}</div>
    <div class="log-text"><strong>${esc(l.target||'')}</strong>${l.user?' · '+l.user:''} ${l.after?`<span style="color:var(--muted)">→ ${esc(l.after.substring(0,60))}</span>`:''}</div>
  </div>`).join('');
}
async function renderChatlogPage(){
  const kw=(document.getElementById('chatlog-kw')?.value||'').toLowerCase();
  const logs=await api('GET','/chat-logs'); if(!logs)return;
  const el=document.getElementById('chatlog-list');
  const list=logs.filter(l=>!kw||(l.query||'').toLowerCase().includes(kw));
  if(!list.length){el.innerHTML='<div style="text-align:center;padding:24px;color:var(--muted)">챗봇 질문 이력이 없습니다.</div>';return;}
  el.innerHTML=list.map(l=>`<div class="chatlog-row">
    <div style="flex:1"><div class="chatlog-q">${esc(l.query||'')}</div><div style="font-size:10px;color:var(--muted);margin-top:2px">${l.userName||''} ${l.taskNames?.length?'· 관련: '+l.taskNames.join(', '):''}</div></div>
    <div class="chatlog-hits">${l.resultCount||0}건</div>
    <div class="chatlog-meta">${l.time||''}</div>
  </div>`).join('');
}
async function renderPermsPage(){
  const el=document.getElementById('perm-info');
  const rn={admin:'관리자',staffing:'스태핑서비스팀',mgmt:'경영지원팀'};
  el.innerHTML=`<div><strong>현재 권한:</strong> ${rn[CU.role]||CU.role}</div><div><strong>이름:</strong> ${CU.name||CU.id}</div><div><strong>AI 챗봇 검색:</strong> 전체 데이터 조회 가능</div>`;
  if(CU.role==='admin'){
    document.getElementById('admin-users-section').style.display='';
    const users=await api('GET','/auth/users'); if(!users)return;
    const rn2={admin:'관리자',staffing:'스태핑서비스팀',mgmt:'경영지원팀'};
    document.getElementById('users-tbody').innerHTML=users.map(u=>`<tr>
      <td>${esc(u.id)}</td><td>${esc(u.name||'')}</td><td>${rn2[u.role]||u.role}</td>
      <td><span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:5px;background:${u.active!==false?'var(--ml)':'var(--wl)'};color:${u.active!==false?'var(--m)':'var(--w)'}">${u.active!==false?'활성':'비활성'}</span></td>
      <td><button class="btn btn-outline btn-xs" onclick="openResetPw()">비번 초기화</button></td>
    </tr>`).join('');
  }
}

// ═══════════════════════════════════════════════════════
// CHATBOT
// ═══════════════════════════════════════════════════════
function toggleChat(){
  chatOpen=!chatOpen;
  const win=document.getElementById('chat-window');
  if(chatOpen){
    win.classList.add('cw-open');
    if(!document.getElementById('chat-msgs').children.length)showWelcome();
    setTimeout(()=>{const inp=document.getElementById('chat-inp');if(inp)inp.focus();},150);
  }else win.classList.remove('cw-open');
}
function clearChat(){ document.getElementById('chat-msgs').innerHTML=''; chatMsgId=0; showWelcome(); }
function showWelcome(){
  let tp=0; DB.tasks.forEach(t=>{tp+=(t.procedures||[]).length;});
  const fp=Object.keys(DB.procContents||{}).filter(k=>(DB.procContents[k].text||'').length>0).length;
  botMsg(`안녕하세요! **AI 업무도우미**입니다. 🤖\n\n업무 매뉴얼, 처리 절차, 이슈 이력에 대해 자유롭게 질문해 주세요.\n\n현재 **${DB.tasks.length}개** 업무 · **${tp}개** 처리절차 · **${fp}개** 작성됨 · **${DB.history.length}개** 이슈를 검색할 수 있습니다.`);
  const el=document.getElementById('sug-pills');
  if(el)el.innerHTML=CHAT_SUGGESTIONS.slice(0,6).map(q=>`<button class="sug-pill" onclick="askQ(${JSON.stringify(q)})">${q}</button>`).join('');
}
function askQ(q){ const inp=document.getElementById('chat-inp'); if(inp){inp.value=q;resizeChatInp(inp);} sendChat(); }
function onChatKey(e){ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();} }
function resizeChatInp(el){ el.style.height='auto';el.style.height=Math.min(el.scrollHeight,100)+'px'; }
async function sendChat(){
  if(botTyping)return;
  const inp=document.getElementById('chat-inp'),query=(inp.value||'').trim();
  if(!query)return;
  inp.value='';inp.style.height='auto';
  const sug=document.getElementById('chat-sug');if(sug)sug.style.display='none';
  userMsg(query);
  const loadId=loadingMsg(); botTyping=true; document.getElementById('chat-send').disabled=true;
  setTimeout(async()=>{
    removeMsg(loadId); botTyping=false; document.getElementById('chat-send').disabled=false;
    const results=searchManualData(query);
    const ans=generateAnswer(results,query);
    botMsg(ans.html,true);
    // Save chat log to server
    api('POST','/chat-logs',{query,resultCount:results.totalHits,taskNames:results.topTaskNames});
  },500);
}

function tokenize(q){ return q.toLowerCase().replace(/[?？!！.,，。]/g,' ').split(/\s+/).filter(t=>t.length>=1); }
function scoreText(text,tokens,weight){ if(!text)return 0; const l=text.toLowerCase(); let s=0; tokens.forEach(t=>{if(l.includes(t))s+=weight;}); return s; }

function searchManualData(query){
  const tokens=tokenize(query); if(!tokens.length)return{items:[],glossHits:[],unlinkedHist:[],totalHits:0,topTaskNames:[]};
  const items=[];
  DB.tasks.forEach(task=>{
    let score=0; const mf=[];
    const ns=scoreText(task.name,tokens,10); if(ns){score+=ns;mf.push('업무명');}
    const ss=scoreText(task.summary,tokens,5); if(ss){score+=ss;mf.push('요약');}
    const cs=scoreText(task.caution,tokens,5); if(cs){score+=cs;mf.push('주의사항');}
    const si=STAGE_INFO[task.stage]; if(si){const sts=scoreText(si.title,tokens,3);if(sts){score+=sts;mf.push('단계');}}
    const mProcs=[];
    (task.procedures||[]).forEach(p=>{
      let ps=scoreText(p.title,tokens,8);
      const pc=getProcContent(task.id,p.id);
      ps+=scoreText(pc.text,tokens,5);
      (pc.images||[]).forEach(img=>{ps+=scoreText((img.title||'')+(img.desc||''),tokens,2);});
      if(ps>0){score+=ps;mProcs.push({proc:p,pc,score:ps});if(!mf.includes('처리절차'))mf.push('처리절차');}
    });
    const mHist=[]; DB.history.filter(h=>h.taskId===task.id).forEach(h=>{
      const hs=scoreText([h.content,h.cause,h.action,h.result,h.type].join(' '),tokens,6);
      if(hs>0){score+=hs;mHist.push(h);if(!mf.includes('이슈'))mf.push('이슈');}
    });
    if(score>0)items.push({task,score,matchFields:mf,matchedProcs:mProcs,matchedHist:mHist});
  });
  const glossHits=DB.glossary.filter(g=>scoreText((g.term||'')+(g.def||''),tokens,7)>0);
  const unlinkedHist=DB.history.filter(h=>!h.taskId||!DB.tasks.find(t=>t.id===h.taskId)).filter(h=>scoreText([h.content,h.cause,h.action,h.result].join(' '),tokens,5)>0);
  items.sort((a,b)=>b.score-a.score);
  const top=items.slice(0,4);
  return{items:top,glossHits:glossHits.slice(0,3),unlinkedHist:unlinkedHist.slice(0,2),totalHits:items.length+glossHits.length,topTaskNames:top.slice(0,3).map(i=>i.task.name)};
}

function generateAnswer(results,query){
  const{items,glossHits,unlinkedHist}=results;
  if(!items.length&&!glossHits.length&&!unlinkedHist.length) return{html:buildNoResult(query)};
  const primary=items[0]; let html='';
  if(items.length){
    html+=`<div class="bot-sec"><div class="bot-sec-title">📌 관련 업무</div>`;
    items.slice(0,3).forEach((r,i)=>{
      const sif=STAGE_INFO[r.task.stage];const tc=r.task.team==='staffing'?'tag-s':r.task.team==='mgmt'?'tag-m':'tag-b';const tl=r.task.team==='staffing'?'스태핑':r.task.team==='mgmt'?'경영지원':'공동';
      html+=`<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
        <span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:5px;background:${i===0?'var(--text)':'var(--bg)'};color:${i===0?'#fff':'var(--muted)'}">${i===0?'최적':'관련'}</span>
        <span style="font-size:11px;color:var(--muted)">${sif?sif.title:''}</span>›
        <strong style="font-size:12px">${esc(r.task.name)}</strong>
        <span class="tag ${tc}" style="font-size:9px;padding:1px 5px">${tl}</span>
      </div>`;
    });
    html+=`</div>`;
  }
  if(primary&&primary.matchedProcs.length){
    html+=`<div class="bot-sec"><div class="bot-sec-title">▶ 처리 요약</div>`;
    primary.matchedProcs.slice(0,2).forEach(mp=>{
      html+=`<div style="margin-bottom:6px;padding:7px 10px;background:var(--bg);border-radius:7px;border:1px solid var(--border)">
        <div style="font-size:11px;font-weight:700;margin-bottom:3px">📎 ${esc(mp.proc.title)}</div>`;
      if(mp.pc.text)html+=`<div style="font-size:12px;line-height:1.75;white-space:pre-wrap">${esc(mp.pc.text.substring(0,200))}${mp.pc.text.length>200?'…':''}</div>`;
      else html+=`<div style="font-size:12px;color:var(--muted);font-style:italic">아직 상세 내용이 작성되지 않았습니다.</div>`;
      html+=`</div>`;
    });
    html+=`</div>`;
  }else if(primary&&primary.task.summary){
    html+=`<div class="bot-sec"><div class="bot-sec-title">▶ 업무 개요</div><div style="font-size:12px;line-height:1.75;padding:7px 10px;background:var(--bg);border-radius:7px;margin-bottom:6px">${esc(primary.task.summary)}</div>`;
    const procs=(primary.task.procedures||[]).slice(0,4);
    if(procs.length){html+=`<ol style="padding-left:16px;margin:0">`;procs.forEach(p=>html+=`<li style="font-size:12px;line-height:1.8">${esc(p.title)}</li>`);html+=`</ol>`;}
    html+=`</div>`;
  }
  const cautionItems=items.filter(r=>r.task.caution||r.task.deadline);
  if(cautionItems.length){
    html+=`<div class="bot-sec"><div class="bot-sec-title">⚠️ 주의사항</div>`;
    cautionItems.slice(0,2).forEach(r=>{
      if(r.task.caution)html+=`<div style="font-size:12px;padding:6px 10px;background:var(--wl);border-left:3px solid #E24B4A;border-radius:0 6px 6px 0;margin-bottom:4px;line-height:1.7">${esc(r.task.caution)}</div>`;
      if(r.task.deadline)html+=`<div style="font-size:12px;padding:4px 0">📅 법정기한: <strong>${esc(r.task.deadline)}</strong></div>`;
    });
    html+=`</div>`;
  }
  const allHist=[...(primary?primary.matchedHist:[]),...unlinkedHist];
  html+=`<div class="bot-sec"><div class="bot-sec-title">🚨 관련 이슈</div>`;
  if(allHist.length){
    const pBc={urgent:'#E24B4A',high:'#F59E0B',normal:'#60A5FA',low:'#4ADE80'};
    const pBg={urgent:'var(--wl)',high:'#FEF3C7',normal:'#EFF6FF',low:'#F0FDF4'};
    allHist.slice(0,3).forEach(h=>{
      const pr=h.priority||'normal';
      html+=`<div style="border-left:3px solid ${pBc[pr]};background:${pBg[pr]};padding:7px 10px;border-radius:0 7px 7px 0;margin-bottom:5px">
        <div style="font-size:11px;font-weight:700;margin-bottom:2px">${esc(h.type||'기타')} · ${h.date||''}</div>
        <div style="font-size:12px;line-height:1.6">${esc((h.content||'').substring(0,80))}${(h.content||'').length>80?'…':''}</div>
        ${h.result?`<div style="font-size:11px;color:var(--muted);margin-top:2px">결과: ${esc(h.result.substring(0,50))}</div>`:''}
      </div>`;
    });
  }else html+=`<div style="font-size:12px;color:var(--muted);font-style:italic">등록된 관련 이슈가 없습니다.</div>`;
  html+=`</div>`;
  if(glossHits.length){
    html+=`<div class="bot-sec"><div class="bot-sec-title">📖 관련 용어</div>`;
    glossHits.forEach(g=>html+=`<div style="padding:5px 9px;background:var(--bg);border-radius:7px;border:1px solid var(--border);margin-bottom:4px"><strong style="font-size:12px">${esc(g.term)}</strong><div style="font-size:11px;color:var(--muted);margin-top:1px;line-height:1.6">${esc(g.def)}</div></div>`);
    html+=`</div>`;
  }
  if(primary){
    const tgt=primary.matchedProcs.length?primary.matchedProcs[0].proc.id:null;
    html+=`<div class="bot-sec"><div class="bot-sec-title">🔗 바로가기</div><button class="goto-btn" onclick="gotoManual('${primary.task.id}','${tgt||''}')">📋 매뉴얼에서 열기</button></div>`;
  }
  const simQ=genSimilarQ(query,primary?.task);
  if(simQ.length){html+=`<div class="sq-wrap"><div class="sq-label">이런 질문도 확인해보세요</div>${simQ.map(q=>`<button class="sq-btn" onclick="askQ(${JSON.stringify(q)})">${q}</button>`).join('')}</div>`;}
  return{html};
}
function buildNoResult(query){
  const sim=CHAT_SUGGESTIONS.filter(q=>tokenize(query).some(t=>q.toLowerCase().includes(t))).slice(0,3);
  let html=`<div style="text-align:center;padding:16px 8px;color:var(--muted)"><div style="font-size:28px;margin-bottom:8px">🔍</div><div><strong>"${esc(query)}"</strong>에 대한 내용을 찾지 못했습니다.</div><div style="margin-top:6px;font-size:11px">매뉴얼을 먼저 작성하거나 다른 키워드로 시도해 주세요.</div></div>`;
  if(sim.length)html+=`<div class="sq-wrap"><div class="sq-label">이런 질문을 찾고 계신가요?</div>${sim.map(q=>`<button class="sq-btn" onclick="askQ(${JSON.stringify(q)})">${q}</button>`).join('')}</div>`;
  return html;
}
function genSimilarQ(query,task){
  const qs=[];if(task){qs.push(`${task.name}의 주의사항은 무엇인가요?`);if(DB.history.some(h=>h.taskId===task.id))qs.push(`${task.name} 관련 이슈가 있었나요?`);if(task.deadline)qs.push(`${task.name}의 처리 기한은?`);}
  CHAT_SUGGESTIONS.forEach(q=>{if(qs.length<3&&!query.includes(q.substring(0,5)))qs.push(q);});return qs.slice(0,3);
}
function gotoManual(taskId,procId){
  if(window.innerWidth<=480)toggleChat();
  showPage('manual');
  setTimeout(()=>{
    const task=DB.tasks.find(t=>t.id===taskId);if(!task)return;
    const se=document.getElementById('stage-'+task.stage);if(se)se.scrollIntoView({behavior:'smooth',block:'start'});
    setTimeout(()=>{
      const tc=document.getElementById('tc-'+taskId);if(tc&&!tc.classList.contains('tc-open'))tc.classList.add('tc-open');
      if(procId){setTimeout(()=>{const pi=document.getElementById('pi-'+procId);if(pi&&!pi.classList.contains('pi-open'))pi.classList.add('pi-open');setTimeout(()=>{const tgt=document.getElementById('pi-'+procId)||document.getElementById('tc-'+taskId);if(tgt){tgt.scrollIntoView({behavior:'smooth',block:'center'});tgt.style.outline='2px solid var(--s)';tgt.style.outlineOffset='2px';setTimeout(()=>{tgt.style.transition='outline .5s';tgt.style.outline='none';},2000);}},200);},200);}
      else{setTimeout(()=>{const tgt=document.getElementById('tc-'+taskId);if(tgt){tgt.scrollIntoView({behavior:'smooth',block:'center'});tgt.style.outline='2px solid var(--s)';tgt.style.outlineOffset='2px';setTimeout(()=>{tgt.style.transition='outline .5s';tgt.style.outline='none';},2000);}},200);}
    },400);
  },150);
}
function userMsg(text){const id='m'+(++chatMsgId);const t=new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});document.getElementById('chat-msgs').insertAdjacentHTML('beforeend',`<div class="msg-row user-row" id="${id}"><div><div class="msg-bbl user-bbl">${esc(text)}</div><div class="msg-time">${t}</div></div><div class="msg-av user-av">👤</div></div>`);scrollDown();return id;}
function botMsg(html,isRaw=false){const id='m'+(++chatMsgId);const t=new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});const rendered=isRaw?html:esc(html).replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');document.getElementById('chat-msgs').insertAdjacentHTML('beforeend',`<div class="msg-row" id="${id}"><div class="msg-av bot-av">🤖</div><div style="flex:1;min-width:0"><div class="msg-bbl bot-bbl">${rendered}</div><div class="msg-time">${t}</div></div></div>`);scrollDown();return id;}
function loadingMsg(){const id='m'+(++chatMsgId);document.getElementById('chat-msgs').insertAdjacentHTML('beforeend',`<div class="msg-row" id="${id}"><div class="msg-av bot-av">🤖</div><div class="msg-bbl bot-bbl"><div class="loading-dots"><span></span><span></span><span></span></div></div></div>`);scrollDown();return id;}
function removeMsg(id){const el=document.getElementById(id);if(el)el.remove();}
function scrollDown(){const m=document.getElementById('chat-msgs');if(m)m.scrollTop=m.scrollHeight;}

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════
function fillTaskSelect(el){if(!el)return;el.innerHTML='<option value="">선택 (선택사항)</option>'+DB.tasks.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('');}
function esc(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function openM(id){document.getElementById(id).classList.add('active');}
function closeM(id){document.getElementById(id).classList.remove('active');}
function openLB(src,cap){if(!src)return;document.getElementById('lb-img').src=src;document.getElementById('lb-cap').textContent=cap||'';document.getElementById('lightbox').classList.add('active');}
function closeLB(){document.getElementById('lightbox').classList.remove('active');}
function toast(msg,type=''){const wrap=document.getElementById('toast-wrap');const t=document.createElement('div');t.className='toast'+(type?' '+type:'');const icons={success:'✅',error:'❌',warn:'⚠️','':'ℹ️'};t.innerHTML=`<span>${icons[type]||'ℹ️'}</span><span>${esc(msg)}</span>`;wrap.appendChild(t);setTimeout(()=>{t.style.opacity='0';t.style.transform='translateX(100%)';t.style.transition='all .3s';setTimeout(()=>t.remove(),300);},3500);}
let confirmCbFn=null;
function showConfirm(title,msg,cb,okText='확인'){document.getElementById('cf-title').textContent=title;document.getElementById('cf-msg').textContent=msg;document.getElementById('cf-msg').innerHTML=msg;confirmCbFn=cb;document.getElementById('confirm-overlay').classList.add('active');}
function cfOk(){document.getElementById('confirm-overlay').classList.remove('active');if(confirmCbFn){confirmCbFn();confirmCbFn=null;}}
function cfCancel(){document.getElementById('confirm-overlay').classList.remove('active');confirmCbFn=null;}
document.querySelectorAll('.modal-overlay').forEach(o=>{o.addEventListener('click',e=>{if(e.target===o)o.classList.remove('active');});});
document.getElementById('main').addEventListener('scroll',()=>{const m=document.getElementById('main');const pct=(m.scrollTop/(m.scrollHeight-m.clientHeight))*100;const fill=document.getElementById('prog-fill');if(fill)fill.style.width=Math.min(pct,100)+'%';},{passive:true});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.querySelectorAll('.modal-overlay.active').forEach(m=>m.classList.remove('active'));document.getElementById('lightbox').classList.remove('active');document.getElementById('confirm-overlay').classList.remove('active');}});
window.addEventListener('online',()=>{setOnline(true);setSaveIndicator('saved','서버 연결됨');toast('서버에 다시 연결되었습니다','success');});
window.addEventListener('offline',()=>{setOnline(false);});

// ═══════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  // Try auto-login from saved token
  const saved = localStorage.getItem(LS_TOKEN);
  if (saved) {
    TOKEN = saved;
    const me = await api('GET', '/auth/me');
    if (me && me.user) {
      CU = me.user;
      await onLoginSuccess();
      return;
    } else {
      TOKEN = null;
      localStorage.removeItem(LS_TOKEN);
    }
  }
  // Show login
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-id').focus();
});
