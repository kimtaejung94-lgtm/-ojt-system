'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET  = process.env.JWT_SECRET || 'ojt-secret-change-this';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '24h';

// ── Paths ──────────────────────────────────────────────
const DATA_DIR   = path.join(__dirname, '..', 'data');
const DB_PATH    = path.join(DATA_DIR, 'database.json');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const FRONT_DIR  = path.join(__dirname, '..', 'frontend');

// ── Middleware ─────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));   // large for base64 images
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting — auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: '요청이 너무 많습니다. 15분 후 다시 시도해 주세요.' }
});

// ── DB Helpers ─────────────────────────────────────────
function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) return getEmptyDB();
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('DB read error:', e.message);
    return getEmptyDB();
  }
}
function writeDB(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  data.lastModified = new Date().toISOString();
  // Atomic write: write to temp then rename
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, DB_PATH);
}
function getEmptyDB() {
  return { tasks:[], history:[], glossary:[], logs:[], procContents:{}, chatLogs:[], lastModified: new Date().toISOString() };
}
function readUsers() {
  try {
    if (!fs.existsSync(USERS_PATH)) return [];
    return JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
  } catch (e) { return []; }
}
function writeUsers(users) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2), 'utf-8');
}
function addDBLog(db, type, target, user, before = '', after = '') {
  db.logs = db.logs || [];
  db.logs.push({
    id: 'log' + Date.now() + Math.random().toString(36).slice(2,6),
    time: new Date().toLocaleString('ko-KR'),
    type, target, user, before, after
  });
  if (db.logs.length > 500) db.logs = db.logs.slice(-500);
}

// ── JWT Middleware ─────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers['authorization'];
  const token  = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: '토큰이 만료되었거나 유효하지 않습니다.' });
  }
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '권한이 없습니다.' });
    }
    next();
  };
}
function canEditTeam(userRole, taskTeam) {
  if (userRole === 'admin') return true;
  if (userRole === 'staffing' && (taskTeam === 'staffing' || taskTeam === 'both')) return true;
  if (userRole === 'mgmt'     && (taskTeam === 'mgmt'     || taskTeam === 'both')) return true;
  return false;
}

// ════════════════════════════════════════════════════════
// AUTH ROUTES
// ════════════════════════════════════════════════════════

// POST /api/auth/login
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { id, password } = req.body;
  if (!id || !password) return res.status(400).json({ error: 'ID와 비밀번호를 입력하세요.' });
  const users = readUsers();
  const user  = users.find(u => u.id === id && u.active !== false);
  if (!user) return res.status(401).json({ error: 'ID 또는 비밀번호가 올바르지 않습니다.' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'ID 또는 비밀번호가 올바르지 않습니다.' });
  const token = jwt.sign({ id: user.id, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/logout  (client-side token deletion, server just confirms)
app.post('/api/auth/logout', requireAuth, (req, res) => {
  res.json({ message: '로그아웃 되었습니다.' });
});

// POST /api/auth/change-password
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: '현재 비밀번호와 새 비밀번호를 입력하세요.' });
  if (newPassword.length < 6) return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' });
  const users = readUsers();
  const idx   = users.findIndex(u => u.id === req.user.id);
  if (idx < 0) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
  const ok = await bcrypt.compare(currentPassword, users[idx].passwordHash);
  if (!ok) return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
  users[idx].passwordHash = await bcrypt.hash(newPassword, 10);
  writeUsers(users);
  res.json({ message: '비밀번호가 변경되었습니다.' });
});

// POST /api/auth/reset-password  (admin only)
app.post('/api/auth/reset-password', requireAuth, requireRole('admin'), async (req, res) => {
  const { userId, newPassword } = req.body;
  if (!userId || !newPassword) return res.status(400).json({ error: '사용자 ID와 새 비밀번호를 입력하세요.' });
  if (newPassword.length < 6) return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' });
  const users = readUsers();
  const idx   = users.findIndex(u => u.id === userId);
  if (idx < 0) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
  users[idx].passwordHash = await bcrypt.hash(newPassword, 10);
  writeUsers(users);
  res.json({ message: `${userId}의 비밀번호가 초기화되었습니다.` });
});

// GET /api/auth/users  (admin only)
app.get('/api/auth/users', requireAuth, requireRole('admin'), (req, res) => {
  const users = readUsers().map(u => ({ id: u.id, name: u.name, role: u.role, active: u.active, createdAt: u.createdAt }));
  res.json(users);
});

// ════════════════════════════════════════════════════════
// DATA ROUTES
// ════════════════════════════════════════════════════════

// GET /api/data  — full DB (auth required, all roles)
app.get('/api/data', requireAuth, (req, res) => {
  const db = readDB();
  // Strip sensitive fields from logs for non-admin
  if (req.user.role !== 'admin') {
    db.logs = [];       // non-admin cannot see all logs
    db.chatLogs = [];
  }
  res.json(db);
});

// POST /api/data  — full DB save (admin only)
app.post('/api/data', requireAuth, requireRole('admin'), (req, res) => {
  const newDB = req.body;
  if (!newDB || typeof newDB !== 'object') return res.status(400).json({ error: '잘못된 데이터 형식입니다.' });
  writeDB(newDB);
  res.json({ message: '저장되었습니다.', lastModified: newDB.lastModified });
});

// ── Tasks ──────────────────────────────────────────────

// GET /api/tasks
app.get('/api/tasks', requireAuth, (req, res) => {
  res.json(readDB().tasks || []);
});

// POST /api/tasks  — create task
app.post('/api/tasks', requireAuth, (req, res) => {
  const task = req.body;
  if (!task.name || !task.team) return res.status(400).json({ error: '업무명과 담당팀은 필수입니다.' });
  if (!canEditTeam(req.user.role, task.team)) return res.status(403).json({ error: '해당 팀 업무를 추가할 권한이 없습니다.' });
  const db = readDB();
  task.id = 't' + Date.now();
  task.procedures = task.procedures || [];
  task.last_modified = new Date().toLocaleDateString('ko-KR');
  task.last_editor   = req.user.name;
  db.tasks.push(task);
  addDBLog(db, '추가', task.name, req.user.name);
  writeDB(db);
  res.status(201).json(task);
});

// PUT /api/tasks/:id  — update task
app.put('/api/tasks/:id', requireAuth, (req, res) => {
  const db  = readDB();
  const idx = db.tasks.findIndex(t => t.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '업무를 찾을 수 없습니다.' });
  const existing = db.tasks[idx];
  if (!canEditTeam(req.user.role, existing.team)) return res.status(403).json({ error: '권한이 없습니다.' });
  const updated = { ...existing, ...req.body, id: existing.id, procedures: existing.procedures };
  updated.last_modified = new Date().toLocaleDateString('ko-KR');
  updated.last_editor   = req.user.name;
  db.tasks[idx] = updated;
  addDBLog(db, '수정', existing.name, req.user.name);
  writeDB(db);
  res.json(updated);
});

// DELETE /api/tasks/:id
app.delete('/api/tasks/:id', requireAuth, (req, res) => {
  const db  = readDB();
  const idx = db.tasks.findIndex(t => t.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '업무를 찾을 수 없습니다.' });
  const task = db.tasks[idx];
  if (!canEditTeam(req.user.role, task.team)) return res.status(403).json({ error: '권한이 없습니다.' });
  if (req.user.role !== 'admin' && task.team === 'both') return res.status(403).json({ error: '공동 업무 삭제는 관리자만 가능합니다.' });
  db.tasks.splice(idx, 1);
  addDBLog(db, '삭제', task.name, req.user.name);
  writeDB(db);
  res.json({ message: '삭제되었습니다.' });
});

// ── Procedures ─────────────────────────────────────────

// POST /api/tasks/:taskId/procedures  — add procedure to task
app.post('/api/tasks/:taskId/procedures', requireAuth, (req, res) => {
  const db   = readDB();
  const task = db.tasks.find(t => t.id === req.params.taskId);
  if (!task) return res.status(404).json({ error: '업무를 찾을 수 없습니다.' });
  if (!canEditTeam(req.user.role, task.team)) return res.status(403).json({ error: '권한이 없습니다.' });
  const proc = { id: 'p_' + req.params.taskId + '_' + Date.now(), title: req.body.title || '새 처리절차' };
  task.procedures = task.procedures || [];
  task.procedures.push(proc);
  addDBLog(db, '추가', `처리절차: ${proc.title}`, req.user.name);
  writeDB(db);
  res.status(201).json(proc);
});

// PUT /api/tasks/:taskId/procedures/:procedureId  — save proc content
app.put('/api/tasks/:taskId/procedures/:procedureId', requireAuth, (req, res) => {
  const db   = readDB();
  const task = db.tasks.find(t => t.id === req.params.taskId);
  if (!task) return res.status(404).json({ error: '업무를 찾을 수 없습니다.' });
  if (!canEditTeam(req.user.role, task.team)) return res.status(403).json({ error: '권한이 없습니다.' });
  const key = req.params.taskId + '::' + req.params.procedureId;
  db.procContents = db.procContents || {};
  const old = db.procContents[key] || {};
  db.procContents[key] = {
    ...old,
    text:   req.body.text   !== undefined ? req.body.text   : old.text,
    images: req.body.images !== undefined ? req.body.images : old.images || [],
    lastModified: new Date().toLocaleString('ko-KR'),
    lastEditor:   req.user.name
  };
  addDBLog(db, '수정', `매뉴얼: ${req.params.procedureId}`, req.user.name, '', (req.body.text||'').substring(0,60));
  writeDB(db);
  res.json(db.procContents[key]);
});

// ── History ────────────────────────────────────────────

// GET /api/history
app.get('/api/history', requireAuth, (req, res) => {
  const db = readDB();
  let list  = db.history || [];
  if (req.query.taskId) list = list.filter(h => h.taskId === req.query.taskId);
  res.json(list);
});

// POST /api/history
app.post('/api/history', requireAuth, (req, res) => {
  const db   = readDB();
  const hist = { id: 'h' + Date.now(), ...req.body, registeredBy: req.user.name, registeredAt: new Date().toISOString() };
  db.history = db.history || [];
  db.history.push(hist);
  addDBLog(db, '추가', `히스토리: ${hist.type||'기타'}`, req.user.name);
  writeDB(db);
  res.status(201).json(hist);
});

// PUT /api/history/:id
app.put('/api/history/:id', requireAuth, (req, res) => {
  const db  = readDB();
  const idx = (db.history||[]).findIndex(h => h.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '히스토리를 찾을 수 없습니다.' });
  db.history[idx] = { ...db.history[idx], ...req.body, id: req.params.id, updatedBy: req.user.name, updatedAt: new Date().toISOString() };
  writeDB(db);
  res.json(db.history[idx]);
});

// DELETE /api/history/:id
app.delete('/api/history/:id', requireAuth, (req, res) => {
  const db  = readDB();
  const idx = (db.history||[]).findIndex(h => h.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '히스토리를 찾을 수 없습니다.' });
  db.history.splice(idx, 1);
  writeDB(db);
  res.json({ message: '삭제되었습니다.' });
});

// ── Glossary ───────────────────────────────────────────

// GET /api/glossary
app.get('/api/glossary', requireAuth, (req, res) => {
  res.json(readDB().glossary || []);
});

// POST /api/glossary
app.post('/api/glossary', requireAuth, requireRole('admin'), (req, res) => {
  const db   = readDB();
  const term = { id: 'g' + Date.now(), ...req.body };
  db.glossary = db.glossary || [];
  db.glossary.push(term);
  writeDB(db);
  res.status(201).json(term);
});

// PUT /api/glossary/:id
app.put('/api/glossary/:id', requireAuth, requireRole('admin'), (req, res) => {
  const db  = readDB();
  const idx = (db.glossary||[]).findIndex(g => g.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '용어를 찾을 수 없습니다.' });
  db.glossary[idx] = { ...db.glossary[idx], ...req.body, id: req.params.id };
  writeDB(db);
  res.json(db.glossary[idx]);
});

// DELETE /api/glossary/:id
app.delete('/api/glossary/:id', requireAuth, requireRole('admin'), (req, res) => {
  const db  = readDB();
  const idx = (db.glossary||[]).findIndex(g => g.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '용어를 찾을 수 없습니다.' });
  db.glossary.splice(idx, 1);
  writeDB(db);
  res.json({ message: '삭제되었습니다.' });
});

// ── Logs ───────────────────────────────────────────────

// GET /api/logs  (admin only)
app.get('/api/logs', requireAuth, requireRole('admin'), (req, res) => {
  const db = readDB();
  res.json((db.logs||[]).slice(-500).reverse());
});

// ── Chat Logs ──────────────────────────────────────────

// POST /api/chat-logs
app.post('/api/chat-logs', requireAuth, (req, res) => {
  const db = readDB();
  db.chatLogs = db.chatLogs || [];
  const entry = {
    id: 'cl' + Date.now(),
    time: new Date().toLocaleString('ko-KR'),
    userId: req.user.id,
    userName: req.user.name,
    ...req.body
  };
  db.chatLogs.push(entry);
  if (db.chatLogs.length > 500) db.chatLogs = db.chatLogs.slice(-500);
  writeDB(db);
  res.status(201).json(entry);
});

// GET /api/chat-logs  (admin only)
app.get('/api/chat-logs', requireAuth, requireRole('admin'), (req, res) => {
  res.json((readDB().chatLogs||[]).slice(-300).reverse());
});

// ── Backup ─────────────────────────────────────────────

// GET /api/backup  (admin — returns full JSON download)
app.get('/api/backup', requireAuth, requireRole('admin'), (req, res) => {
  const db  = readDB();
  const ts  = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
  res.setHeader('Content-Disposition', `attachment; filename="ojt-backup-${ts}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.json(db);
});

// POST /api/restore  (admin — restore from uploaded JSON)
app.post('/api/restore', requireAuth, requireRole('admin'), (req, res) => {
  const data = req.body;
  if (!data.tasks || !Array.isArray(data.tasks)) return res.status(400).json({ error: '유효한 백업 파일이 아닙니다.' });
  writeDB(data);
  res.json({ message: '복원되었습니다.', taskCount: data.tasks.length });
});

// ════════════════════════════════════════════════════════
// STATIC FILES — Frontend
// ════════════════════════════════════════════════════════
app.use(express.static(FRONT_DIR));

// SPA fallback
app.get('*', (req, res) => {
  const indexPath = path.join(FRONT_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Frontend not found. Run: cp -r frontend/ dist/ or ensure frontend/index.html exists.');
  }
});

// ── Error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: '서버 오류가 발생했습니다.', details: err.message });
});

// ── Start ──────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  OJT 업무 매뉴얼 시스템 v3.0         ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║  로컬:    http://localhost:${PORT}       ║`);
  console.log(`║  네트워크: http://[IP주소]:${PORT}       ║`);
  console.log('╠══════════════════════════════════════╣');
  console.log('║  계정: admin / admin1234              ║');
  console.log('║        staffing / staffing1234        ║');
  console.log('║        mgmt / mgmt1234                ║');
  console.log('╚══════════════════════════════════════╝\n');
  if (!fs.existsSync(DB_PATH)) {
    console.log('⚠️  데이터베이스가 없습니다. 먼저 실행하세요: node backend/setup.js\n');
  }
});

module.exports = app;
