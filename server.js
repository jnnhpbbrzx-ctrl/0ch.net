const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 20000,
  pingInterval: 25000
});

const JWT_SECRET = process.env.JWT_SECRET || 'pipiski-super-secret-key-change-me-in-prod';
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'users.json');

// --- Простая JSON-база (очень мало ресурсов) ---
function loadUsers() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveUsers(users) {
  fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
}

let users = loadUsers(); // { id: { id, username, password, avatar } }

// --- Multer ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `${req.user.id}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Только картинки'));
  }
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Нет токена' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Неверный токен' });
  }
}

// --- API ---
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || username.length < 3 || password.length < 4) {
    return res.status(400).json({ error: 'Логин от 3 символов, пароль от 4' });
  }
  const clean = username.trim().toLowerCase().replace(/[^a-z0-9_а-яё]/gi, '');
  if (clean.length < 3) return res.status(400).json({ error: 'Некорректный логин' });

  if (Object.values(users).some(u => u.username === clean)) {
    return res.status(400).json({ error: 'Такой логин уже занят' });
  }

  const id = uuidv4();
  const hash = bcrypt.hashSync(password, 8);
  users[id] = { id, username: clean, password: hash, avatar: null };
  saveUsers(users);

  const token = jwt.sign({ id, username: clean }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id, username: clean, avatar: null } });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = Object.values(users).find(u => u.username === username?.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({
    token,
    user: { id: user.id, username: user.username, avatar: user.avatar }
  });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const user = users[req.user.id];
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ id: user.id, username: user.username, avatar: user.avatar });
});

app.post('/api/avatar', authMiddleware, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Нет файла' });
  const avatarUrl = `/uploads/${req.file.filename}`;
  if (users[req.user.id]) {
    users[req.user.id].avatar = avatarUrl;
    saveUsers(users);
  }
  res.json({ avatar: avatarUrl });
});

// --- Онлайн ---
const onlineUsers = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Нет токена'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('Неверный токен'));
  }
});

io.on('connection', (socket) => {
  const user = users[socket.user.id];
  if (!user) {
    socket.disconnect();
    return;
  }

  onlineUsers.set(socket.id, {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    socketId: socket.id
  });

  broadcastOnline();

  socket.on('call-user', ({ to, offer }) => {
    const target = [...onlineUsers.values()].find(u => u.id === to);
    if (target) {
      io.to(target.socketId).emit('incoming-call', {
        from: { id: user.id, username: user.username, avatar: user.avatar },
        offer
      });
    }
  });

  socket.on('answer-call', ({ to, answer }) => {
    const target = [...onlineUsers.values()].find(u => u.id === to);
    if (target) {
      io.to(target.socketId).emit('call-answered', { answer });
    }
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    const target = [...onlineUsers.values()].find(u => u.id === to);
    if (target) {
      io.to(target.socketId).emit('ice-candidate', { candidate });
    }
  });

  socket.on('end-call', ({ to }) => {
    const target = [...onlineUsers.values()].find(u => u.id === to);
    if (target) {
      io.to(target.socketId).emit('call-ended');
    }
  });

  socket.on('reject-call', ({ to }) => {
    const target = [...onlineUsers.values()].find(u => u.id === to);
    if (target) {
      io.to(target.socketId).emit('call-rejected');
    }
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    broadcastOnline();
  });
});

function broadcastOnline() {
  const list = [...onlineUsers.values()].map(u => ({
    id: u.id,
    username: u.username,
    avatar: u.avatar
  }));
  const unique = Array.from(new Map(list.map(u => [u.id, u])).values());
  io.emit('online-users', unique);
}

server.listen(PORT, () => {
  console.log(`🍆 Пиписьки запущены на порту ${PORT}`);
});
