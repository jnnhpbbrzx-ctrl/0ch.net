const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    });
  }
} catch (e) {}

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
const PORT = process.env.PORT || 3000;
const REG_MODE = process.env.REG_MODE || 'open';
const DATA_FILE = path.join(__dirname, 'data', 'state.json');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 5e6 // 5 MB for images
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '6mb' }));

// ---------- Storage ----------
function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      users: parsed.users || {},
      messages: parsed.messages || [],
      walls: parsed.walls || {},
      dms: parsed.dms || {},
      banned: parsed.banned || [],
      maintenance: !!parsed.maintenance,
      nextMsgId: parsed.nextMsgId || 1
    };
  } catch (e) {
    return { users: {}, messages: [], walls: {}, dms: {}, banned: [], maintenance: false, nextMsgId: 1 };
  }
}

function saveState() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('save error', e);
  }
}

const state = loadState();
const pending = new Map();
const adminSockets = new Set();
const nameToToken = new Map(
  Object.entries(state.users).map(([tok, u]) => [u.name.toLowerCase(), tok])
);
const online = new Map();

function hashPass(pass) {
  return crypto.createHash('sha256').update(String(pass) + '0ch-salt-v2').digest('hex');
}

function nameTaken(name) {
  const lower = name.toLowerCase();
  if (nameToToken.has(lower)) return true;
  if (state.banned.includes(lower)) return true;
  for (const p of pending.values()) if (p.name.toLowerCase() === lower) return true;
  return false;
}

function nameToColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 55%, 55%)`;
}

function publicUser(u) {
  return {
    name: u.name,
    color: u.color,
    isOwner: !!u.isOwner,
    avatarSeed: u.avatarSeed,
    avatarUrl: u.avatarUrl || null,
    bio: u.bio || '',
    created: u.created
  };
}

function pairKey(a, b) {
  return [a.toLowerCase(), b.toLowerCase()].sort().join('|');
}

// Save base64 image, return public URL path
function saveImage(dataUrl, prefix) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/i);
  if (!m) return null;
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 4 * 1024 * 1024) return null; // max 4MB
  const name = `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return '/uploads/' + name;
}

function broadcastUserList() {
  const list = [];
  for (const [token] of online) {
    if (state.users[token]) list.push(publicUser(state.users[token]));
  }
  list.sort((a, b) => (b.isOwner ? 1 : 0) - (a.isOwner ? 1 : 0) || a.name.localeCompare(b.name));
  io.to('chat').emit('users', list);
  io.to('guest').emit('users', list);
}

function broadcastPendingToAdmins() {
  const list = Array.from(pending.entries()).map(([id, p]) => ({
    id, name: p.name, avatarSeed: p.avatarSeed
  }));
  for (const id of adminSockets) {
    io.sockets.sockets.get(id)?.emit('admin:pending', list);
  }
}

function broadcastApprovedToAdmins() {
  const list = Object.entries(state.users).map(([token, u]) => ({ token, ...publicUser(u) }));
  for (const id of adminSockets) {
    io.sockets.sockets.get(id)?.emit('admin:approved', list);
  }
}

app.get('/api/status', (req, res) => {
  res.json({
    maintenance: state.maintenance,
    online: online.size,
    totalMessages: state.messages.length,
    regMode: REG_MODE
  });
});

app.get('/api/messages', (req, res) => {
  if (state.maintenance) return res.status(503).json({ error: 'maintenance' });
  res.json(state.messages.slice(-(parseInt(req.query.limit) || 80)));
});

io.on('connection', (socket) => {
  socket.data.token = null;
  socket.data.name = null;
  socket.join('guest');
  socket.emit('status', {
    maintenance: state.maintenance,
    regMode: REG_MODE,
    online: online.size
  });

  if (state.maintenance) {
    socket.emit('maintenance', true);
    return;
  }

  socket.emit('history', state.messages.slice(-100));
  broadcastUserList();

  socket.on('reconnect-with-token', (token) => {
    const u = state.users[token];
    if (!u) return socket.emit('token-invalid');
    if (state.banned.includes(u.name.toLowerCase())) {
      return socket.emit('kicked', 'Ты в бане');
    }
    socket.data.token = token;
    socket.data.name = u.name;
    socket.leave('guest');
    socket.join('chat');
    online.set(token, socket.id);
    socket.emit('approved', { token, ...publicUser(u) });
    socket.emit('history', state.messages.slice(-100));
    io.to('chat').emit('system', `${u.name} снова в сети`);
    broadcastUserList();
  });

  socket.on('register', ({ name, password, adminKey, avatarSeed }) => {
    name = String(name || '').trim().slice(0, 20);
    password = String(password || '').slice(0, 64);
    avatarSeed = String(avatarSeed || name).slice(0, 40);

    if (!name || name.length < 2) return socket.emit('join-error', 'Имя слишком короткое');
    if (!/^[a-zA-Zа-яА-ЯёЁ0-9_\-]+$/.test(name)) {
      return socket.emit('join-error', 'Только буквы, цифры, _ и -');
    }
    if (password.length < 3) return socket.emit('join-error', 'Пароль минимум 3 символа');

    if (adminKey && adminKey === ADMIN_PASSWORD) {
      let token = nameToToken.get(name.toLowerCase());
      if (!token) {
        token = crypto.randomBytes(16).toString('hex');
        nameToToken.set(name.toLowerCase(), token);
      }
      const prev = state.users[token] || {};
      const user = {
        name,
        passHash: hashPass(password),
        color: 'gold',
        isOwner: true,
        avatarSeed,
        avatarUrl: prev.avatarUrl || null,
        bio: prev.bio || '',
        created: prev.created || Date.now()
      };
      state.users[token] = user;
      saveState();
      loginUser(socket, token, user);
      return;
    }

    const existingToken = nameToToken.get(name.toLowerCase());
    if (existingToken) {
      const u = state.users[existingToken];
      if (u.passHash !== hashPass(password)) {
        return socket.emit('join-error', 'Неверный пароль');
      }
      if (state.banned.includes(name.toLowerCase())) {
        return socket.emit('join-error', 'Этот ник забанен');
      }
      loginUser(socket, existingToken, u);
      return;
    }

    if (nameTaken(name)) return socket.emit('join-error', 'Это имя уже занято');

    const passHash = hashPass(password);

    if (REG_MODE === 'approve') {
      const pendingId = crypto.randomBytes(8).toString('hex');
      pending.set(pendingId, { name, passHash, socketId: socket.id, avatarSeed });
      socket.data.pendingId = pendingId;
      socket.emit('pending', { id: pendingId, name });
      broadcastPendingToAdmins();
      return;
    }

    const token = crypto.randomBytes(16).toString('hex');
    const user = {
      name,
      passHash,
      color: nameToColor(name),
      isOwner: false,
      avatarSeed,
      avatarUrl: null,
      bio: '',
      created: Date.now()
    };
    state.users[token] = user;
    nameToToken.set(name.toLowerCase(), token);
    saveState();
    loginUser(socket, token, user);
    io.to('chat').emit('system', `${name} зарегистрировался(ась)`);
  });

  function loginUser(socket, token, user) {
    socket.data.token = token;
    socket.data.name = user.name;
    socket.leave('guest');
    socket.join('chat');
    online.set(token, socket.id);
    socket.emit('approved', { token, ...publicUser(user) });
    socket.emit('history', state.messages.slice(-100));
    broadcastUserList();
    broadcastApprovedToAdmins();
  }

  // Admin
  socket.on('admin-login', (password) => {
    if (password === ADMIN_PASSWORD) {
      adminSockets.add(socket.id);
      socket.emit('admin-login-ok');
      broadcastPendingToAdmins();
      broadcastApprovedToAdmins();
      socket.emit('admin:status', {
        maintenance: state.maintenance,
        regMode: REG_MODE,
        banned: state.banned
      });
    } else {
      socket.emit('admin-login-fail');
    }
  });

  socket.on('admin-approve', (pendingId) => {
    if (!adminSockets.has(socket.id)) return;
    const p = pending.get(pendingId);
    if (!p) return;
    pending.delete(pendingId);
    const token = crypto.randomBytes(16).toString('hex');
    const user = {
      name: p.name,
      passHash: p.passHash,
      color: nameToColor(p.name),
      isOwner: false,
      avatarSeed: p.avatarSeed,
      avatarUrl: null,
      bio: '',
      created: Date.now()
    };
    state.users[token] = user;
    nameToToken.set(p.name.toLowerCase(), token);
    saveState();
    const target = io.sockets.sockets.get(p.socketId);
    if (target) loginUser(target, token, user);
    io.to('chat').emit('system', `${p.name} принят(а)`);
    broadcastPendingToAdmins();
    broadcastApprovedToAdmins();
  });

  socket.on('admin-deny', (pendingId) => {
    if (!adminSockets.has(socket.id)) return;
    const p = pending.get(pendingId);
    if (!p) return;
    pending.delete(pendingId);
    io.sockets.sockets.get(p.socketId)?.emit('denied');
    broadcastPendingToAdmins();
  });

  socket.on('admin-kick', (token) => {
    if (!adminSockets.has(socket.id)) return;
    const u = state.users[token];
    if (!u || u.isOwner) return;
    const sockId = online.get(token);
    if (sockId) {
      const s = io.sockets.sockets.get(sockId);
      if (s) {
        s.emit('kicked', 'Тебя выгнал владелец');
        s.leave('chat');
        s.join('guest');
        s.data.token = null;
      }
      online.delete(token);
    }
    io.to('chat').emit('system', `${u.name} выгнан(а)`);
    broadcastUserList();
  });

  socket.on('admin-ban', (token) => {
    if (!adminSockets.has(socket.id)) return;
    const u = state.users[token];
    if (!u || u.isOwner) return;
    state.banned.push(u.name.toLowerCase());
    delete state.users[token];
    nameToToken.delete(u.name.toLowerCase());
    saveState();
    const sockId = online.get(token);
    if (sockId) {
      io.sockets.sockets.get(sockId)?.emit('kicked', 'Тебя забанили');
      online.delete(token);
    }
    io.to('chat').emit('system', `${u.name} забанен(а)`);
    broadcastUserList();
    broadcastApprovedToAdmins();
  });

  socket.on('admin-toggle-maintenance', () => {
    if (!adminSockets.has(socket.id)) return;
    state.maintenance = !state.maintenance;
    saveState();
    io.emit('maintenance', state.maintenance);
    socket.emit('admin:status', { maintenance: state.maintenance, regMode: REG_MODE, banned: state.banned });
  });

  // Chat message (text + optional image)
  socket.on('message', ({ text, replyTo, image }) => {
    const token = socket.data.token;
    const u = token && state.users[token];
    if (!u) return;
    if (state.maintenance) return;

    const clean = String(text || '').slice(0, 2000).trim();
    let imageUrl = null;
    if (image) imageUrl = saveImage(image, 'img');

    if (!clean && !imageUrl) return;

    const msg = {
      id: state.nextMsgId++,
      name: u.name,
      color: u.color,
      isOwner: !!u.isOwner,
      avatarSeed: u.avatarSeed,
      avatarUrl: u.avatarUrl || null,
      text: clean,
      image: imageUrl,
      time: Date.now(),
      replyTo: replyTo || null
    };
    state.messages.push(msg);
    if (state.messages.length > 800) state.messages.shift();
    saveState();
    io.to('chat').emit('message', msg);
    io.to('guest').emit('message', msg);
  });

  socket.on('typing', (isTyping) => {
    const u = socket.data.token && state.users[socket.data.token];
    if (!u) return;
    socket.to('chat').emit('typing', { name: u.name, isTyping: !!isTyping });
  });

  // Avatar upload
  socket.on('set-avatar', (dataUrl) => {
    const token = socket.data.token;
    const u = token && state.users[token];
    if (!u) return;
    const url = saveImage(dataUrl, 'av');
    if (!url) return socket.emit('avatar-error', 'Не удалось сохранить (только png/jpg/gif/webp до 4 МБ)');
    u.avatarUrl = url;
    saveState();
    socket.emit('approved', { token, ...publicUser(u) });
    broadcastUserList();
    // update recent messages avatars in memory is hard; clients use avatarUrl from user list
    socket.emit('avatar-ok', url);
  });

  // Profile
  socket.on('get-profile', (name) => {
    const token = nameToToken.get(String(name).toLowerCase());
    if (!token || !state.users[token]) return socket.emit('profile', null);
    const u = state.users[token];
    const wall = (state.walls[u.name] || []).slice(-30);
    socket.emit('profile', { ...publicUser(u), wall, online: online.has(token) });
  });

  socket.on('update-bio', (bio) => {
    const token = socket.data.token;
    const u = token && state.users[token];
    if (!u) return;
    u.bio = String(bio || '').slice(0, 300);
    saveState();
    socket.emit('profile', { ...publicUser(u), wall: state.walls[u.name] || [], online: true });
  });

  socket.on('wall-post', ({ to, text }) => {
    const token = socket.data.token;
    const fromUser = token && state.users[token];
    if (!fromUser || !to || !text) return;
    const targetToken = nameToToken.get(String(to).toLowerCase());
    if (!targetToken) return;
    const clean = String(text).slice(0, 500).trim();
    if (!clean) return;
    const targetName = state.users[targetToken].name;
    if (!state.walls[targetName]) state.walls[targetName] = [];
    const entry = {
      from: fromUser.name,
      color: fromUser.color,
      text: clean,
      time: Date.now()
    };
    state.walls[targetName].push(entry);
    if (state.walls[targetName].length > 50) state.walls[targetName].shift();
    saveState();
    const targetSockId = online.get(targetToken);
    if (targetSockId) {
      io.sockets.sockets.get(targetSockId)?.emit('wall-update', { name: targetName, entry });
    }
    socket.emit('wall-posted', { to: targetName, entry });
  });

  // DMs
  socket.on('dm-send', ({ to, text, image }) => {
    const token = socket.data.token;
    const fromUser = token && state.users[token];
    if (!fromUser || !to) return;
    const targetToken = nameToToken.get(String(to).toLowerCase());
    if (!targetToken || targetToken === token) return;
    const clean = String(text || '').slice(0, 1500).trim();
    let imageUrl = null;
    if (image) imageUrl = saveImage(image, 'dm');
    if (!clean && !imageUrl) return;
    const key = pairKey(fromUser.name, state.users[targetToken].name);
    if (!state.dms[key]) state.dms[key] = [];
    const msg = {
      from: fromUser.name,
      color: fromUser.color,
      text: clean,
      image: imageUrl,
      time: Date.now()
    };
    state.dms[key].push(msg);
    if (state.dms[key].length > 200) state.dms[key].shift();
    saveState();
    socket.emit('dm', { with: state.users[targetToken].name, msg });
    const targetSockId = online.get(targetToken);
    if (targetSockId) {
      io.sockets.sockets.get(targetSockId)?.emit('dm', { with: fromUser.name, msg });
    }
  });

  socket.on('dm-history', (withName) => {
    const token = socket.data.token;
    const me = token && state.users[token];
    if (!me || !withName) return;
    const key = pairKey(me.name, withName);
    socket.emit('dm-history', { with: withName, messages: state.dms[key] || [] });
  });

  socket.on('disconnect', () => {
    adminSockets.delete(socket.id);
    if (socket.data.pendingId) {
      pending.delete(socket.data.pendingId);
      broadcastPendingToAdmins();
    }
    if (socket.data.token) {
      online.delete(socket.data.token);
      broadcastUserList();
    }
  });
});

server.listen(PORT, () => {
  console.log(`0ch.net v2.1 на порту ${PORT}`);
  console.log('Админ-пароль задан через ADMIN_PASSWORD (или change-me по умолчанию)');
});
