const socket = io({ maxHttpBufferSize: 5e6 });

const screens = {
  maintenance: document.getElementById('maintenanceScreen'),
  auth: document.getElementById('authScreen'),
  wait: document.getElementById('waitScreen'),
  denied: document.getElementById('deniedScreen'),
  app: document.getElementById('app')
};

function showScreen(name) {
  Object.values(screens).forEach(el => el.classList.add('hidden'));
  if (screens[name]) screens[name].classList.remove('hidden');
  if (name === 'maintenance') {
    startMcMaintenance();
  } else {
    stopMcMaintenance();
  }
}

// ===== Minecraft maintenance: dots + music =====
let mcTimer = null;
const MC_PATH = [2, 5, 8, 7, 6, 3, 0, 1];
let mcStep = 0;

function startMcMaintenance() {
  const dots = document.querySelectorAll('#mcDots .mc-dot');
  const audio = document.getElementById('mcAudio');
  if (!dots.length) return;

  function tick() {
    dots.forEach(d => d.classList.remove('active', 'trail'));
    const a = MC_PATH[mcStep % MC_PATH.length];
    dots[a].classList.add('active');
    for (let i = 1; i <= 3; i++) {
      const t = MC_PATH[(mcStep - i + MC_PATH.length * 20) % MC_PATH.length];
      if (t !== a) dots[t].classList.add('trail');
    }
    mcStep++;
  }
  if (mcTimer) clearInterval(mcTimer);
  mcTimer = setInterval(tick, 220); // медленнее
  tick();

  if (audio) {
    audio.volume = 0.6;
    const tryPlay = () => {
      if (audio.paused) audio.play().catch(() => {});
    };
    tryPlay();
    // пользователь уже кликал (вход / любой тап) — разблокирует autoplay
    ['click', 'touchstart', 'keydown'].forEach(ev => {
      document.addEventListener(ev, tryPlay, { passive: true, once: false });
    });
    audio.addEventListener('pause', () => setTimeout(tryPlay, 50));
  }
}

function stopMcMaintenance() {
  if (mcTimer) { clearInterval(mcTimer); mcTimer = null; }
  const audio = document.getElementById('mcAudio');
  if (audio) { audio.pause(); audio.currentTime = 0; }
}

const authError = document.getElementById('authError');
const loginName = document.getElementById('loginName');
const loginPass = document.getElementById('loginPass');
const regName = document.getElementById('regName');
const regPass = document.getElementById('regPass');
const adminKeyInput = document.getElementById('adminKeyInput');
const avatarPreview = document.getElementById('avatarPreview');
const messagesEl = document.getElementById('messages');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const typingIndicator = document.getElementById('typingIndicator');
const usersList = document.getElementById('usersList');
const userCount = document.getElementById('userCount');
const replyBar = document.getElementById('replyBar');
const replyPreview = document.getElementById('replyPreview');
const guestBar = document.getElementById('guestBar');
const myNickEl = document.getElementById('myNick');
const imageInput = document.getElementById('imageInput');
const imagePreviewBar = document.getElementById('imagePreviewBar');
const imagePreviewThumb = document.getElementById('imagePreviewThumb');

let me = null;
let isGuest = false;
let replyToId = null;
let pendingImage = null; // base64
let currentView = 'chat';
let dmPartner = null;
const msgMap = new Map();
const dmConversations = new Set();

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const isLogin = tab.dataset.tab === 'login';
    document.getElementById('loginForm').classList.toggle('hidden', !isLogin);
    document.getElementById('registerForm').classList.toggle('hidden', isLogin);
    authError.textContent = '';
  });
});

regName.addEventListener('input', () => {
  avatarPreview.innerHTML = generateAvatarSVG(regName.value.trim() || '???', 64);
});
avatarPreview.innerHTML = generateAvatarSVG('???', 64);

// Auth
document.getElementById('loginBtn').addEventListener('click', () => {
  authError.textContent = '';
  socket.emit('register', {
    name: loginName.value.trim(),
    password: loginPass.value,
    adminKey: '',
    avatarSeed: loginName.value.trim()
  });
});
loginPass.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('loginBtn').click(); });

document.getElementById('regBtn').addEventListener('click', () => {
  authError.textContent = '';
  socket.emit('register', {
    name: regName.value.trim(),
    password: regPass.value,
    adminKey: adminKeyInput.value.trim(),
    avatarSeed: regName.value.trim()
  });
});
regPass.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('regBtn').click(); });

document.getElementById('guestLink').addEventListener('click', e => {
  e.preventDefault();
  enterAsGuest();
});
document.getElementById('goAuth')?.addEventListener('click', e => {
  e.preventDefault();
  localStorage.removeItem('och_token');
  location.reload();
});

function enterAsGuest() {
  isGuest = true;
  me = null;
  showScreen('app');
  guestBar.classList.remove('hidden');
  messageForm.classList.add('hidden');
  myNickEl.textContent = 'Гость';
  document.getElementById('profileBtn').classList.add('hidden');
}

const savedToken = localStorage.getItem('och_token');
if (savedToken) socket.emit('reconnect-with-token', savedToken);

// Socket
socket.on('status', s => { if (s.maintenance) showScreen('maintenance'); });
socket.on('maintenance', on => {
  if (on === true || on === undefined) showScreen('maintenance');
  else if (on === false) location.reload();
});
socket.on('join-error', msg => { authError.textContent = msg; });
socket.on('pending', () => showScreen('wait'));
socket.on('denied', () => showScreen('denied'));
socket.on('token-invalid', () => {
  localStorage.removeItem('och_token');
  showScreen('auth');
});
socket.on('kicked', reason => {
  localStorage.removeItem('och_token');
  alert(reason || 'Выгнали');
  location.reload();
});

socket.on('approved', data => {
  me = data;
  isGuest = false;
  localStorage.setItem('och_token', data.token);
  showScreen('app');
  guestBar.classList.add('hidden');
  messageForm.classList.remove('hidden');
  myNickEl.textContent = data.name;
  myNickEl.style.color = data.color;
  document.getElementById('profileBtn').classList.remove('hidden');
  messageInput.focus();
});

socket.on('history', msgs => {
  messagesEl.innerHTML = '';
  msgMap.clear();
  msgs.forEach(addMessage);
  scrollBottom(messagesEl);
});

socket.on('system', text => addSystemMessage(text));
socket.on('message', msg => {
  addMessage(msg);
  if (currentView === 'chat') scrollBottom(messagesEl);
});

socket.on('users', users => {
  usersList.innerHTML = '';
  userCount.textContent = users.length;
  users.forEach(u => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="mini-avatar">${avatarHtml(u, 22)}</span>
      <span class="name" style="color:${u.color}">
        ${u.isOwner ? '<span class="owner-badge">OWNER</span> ' : ''}${escapeHtml(u.name)}
      </span>`;
    li.addEventListener('click', () => openProfile(u.name));
    usersList.appendChild(li);
  });
});

socket.on('typing', ({ name, isTyping }) => {
  typingIndicator.textContent = isTyping ? `${name} печатает…` : '';
});

socket.on('avatar-ok', url => {
  if (me) me.avatarUrl = url;
});
socket.on('avatar-error', msg => alert(msg));

// Helpers
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function avatarHtml(u, size) {
  if (u.avatarUrl) {
    return `<img src="${u.avatarUrl}" width="${size}" height="${size}" alt="">`;
  }
  return generateAvatarSVG(u.avatarSeed || u.name || '?', size);
}

function renderGreentext(text) {
  return escapeHtml(text)
    .split('\n')
    .map(line => {
      line = line.replace(/&gt;&gt;(\d+)/g, '<a class="reply-ref" data-jump="$1">&gt;&gt;$1</a>');
      if (line.trim().startsWith('&gt;') && !line.trim().startsWith('&gt;&gt;')) {
        return `<span class="green">${line}</span>`;
      }
      return line;
    })
    .join('<br>');
}

function addMessage(msg) {
  const div = document.createElement('div');
  div.className = 'msg' + (me && msg.name === me.name ? ' own' : '');
  div.dataset.id = msg.id;
  const t = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let replyHtml = '';
  if (msg.replyTo) {
    replyHtml = `<div class="reply-ref" data-jump="${msg.replyTo}">&gt;&gt;${msg.replyTo}</div>`;
  }

  let imgHtml = '';
  if (msg.image) {
    imgHtml = `<img class="msg-image" src="${msg.image}" alt="фото" loading="lazy">`;
  }

  div.innerHTML = `
    <div class="msg-avatar">${avatarHtml(msg, 40)}</div>
    <div class="msg-body">
      <div class="meta">
        <span style="color:${msg.color}; font-weight:700; cursor:pointer;" class="author" data-name="${escapeHtml(msg.name)}">
          ${msg.isOwner ? '<span class="owner-badge">OWNER</span> ' : ''}${escapeHtml(msg.name)}
        </span>
        <span class="post-num" title="Ответить">No.${msg.id}</span>
        <span class="time">${t}</span>
      </div>
      ${replyHtml}
      <div class="text">${msg.text ? renderGreentext(msg.text) : ''}</div>
      ${imgHtml}
    </div>`;

  div.querySelector('.post-num').addEventListener('click', () => setReply(msg));
  div.querySelector('.author').addEventListener('click', () => openProfile(msg.name));
  div.querySelectorAll('[data-jump]').forEach(el => {
    el.addEventListener('click', () => jumpTo(el.dataset.jump));
  });
  const img = div.querySelector('.msg-image');
  if (img) img.addEventListener('click', () => openLightbox(msg.image));

  messagesEl.appendChild(div);
  msgMap.set(msg.id, div);
}

function addSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'system-msg';
  div.textContent = '• ' + text;
  messagesEl.appendChild(div);
}

function setReply(msg) {
  if (isGuest) return;
  replyToId = msg.id;
  replyPreview.textContent = `No.${msg.id} ${msg.name}`;
  replyBar.classList.remove('hidden');
  messageInput.focus();
  if (!messageInput.value.includes(`>>${msg.id}`)) {
    messageInput.value = `>>${msg.id} ` + messageInput.value;
  }
}

document.getElementById('cancelReply').addEventListener('click', () => {
  replyToId = null;
  replyBar.classList.add('hidden');
});

function jumpTo(id) {
  const el = msgMap.get(Number(id));
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('highlight');
  setTimeout(() => el.classList.remove('highlight'), 1500);
}

function scrollBottom(el) {
  el.scrollTop = el.scrollHeight;
}

function openLightbox(src) {
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `<img src="${src}" alt="">`;
  lb.addEventListener('click', () => lb.remove());
  document.body.appendChild(lb);
}

// Image attach
function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject();
    if (file.size > 4 * 1024 * 1024) {
      alert('Максимум 4 МБ');
      return reject();
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

imageInput.addEventListener('change', async () => {
  const file = imageInput.files[0];
  imageInput.value = '';
  try {
    pendingImage = await readImageFile(file);
    imagePreviewThumb.src = pendingImage;
    imagePreviewBar.classList.remove('hidden');
  } catch (e) {}
});

document.getElementById('cancelImage').addEventListener('click', () => {
  pendingImage = null;
  imagePreviewBar.classList.add('hidden');
});

// Send
messageForm.addEventListener('submit', e => {
  e.preventDefault();
  if (isGuest || !me) return;
  const text = messageInput.value.trim();
  if (!text && !pendingImage) return;
  socket.emit('message', {
    text,
    replyTo: replyToId,
    image: pendingImage
  });
  messageInput.value = '';
  replyToId = null;
  replyBar.classList.add('hidden');
  pendingImage = null;
  imagePreviewBar.classList.add('hidden');
  socket.emit('typing', false);
});

messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    messageForm.requestSubmit();
  }
});

let typingTimeout = null;
messageInput.addEventListener('input', () => {
  if (isGuest || !me) return;
  socket.emit('typing', true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => socket.emit('typing', false), 1400);
});

// Nav
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    document.getElementById('chatPanel').classList.toggle('hidden', currentView !== 'chat');
    document.getElementById('dmPanel').classList.toggle('hidden', currentView !== 'dms');
    document.getElementById('boardTitle').textContent =
      currentView === 'chat' ? '/chat/' : '/dm/';
  });
});

// Profile
const profilePanel = document.getElementById('profilePanel');
let profileTarget = null;

function openProfile(name) {
  profileTarget = name;
  socket.emit('get-profile', name);
  profilePanel.classList.remove('hidden');
}

document.getElementById('profileClose').addEventListener('click', () => {
  profilePanel.classList.add('hidden');
});

document.getElementById('profileBtn').addEventListener('click', () => {
  if (me) openProfile(me.name);
});

socket.on('profile', data => {
  if (!data) {
    alert('Не найден');
    profilePanel.classList.add('hidden');
    return;
  }
  document.getElementById('profileAvatar').innerHTML = avatarHtml(data, 72);
  document.getElementById('profileName').innerHTML =
    (data.isOwner ? '<span class="owner-badge">OWNER</span> ' : '') + escapeHtml(data.name);
  document.getElementById('profileName').style.color = data.color;

  const created = data.created ? new Date(data.created).toLocaleDateString('ru') : '—';
  document.getElementById('profileMeta').textContent =
    `${data.online ? '● в сети' : '○ оффлайн'} · с ${created}`;

  document.getElementById('profileBio').textContent = data.bio || 'Нет описания';

  const actions = document.getElementById('profileActions');
  actions.innerHTML = '';

  if (me && me.name === data.name) {
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Описание';
    editBtn.onclick = () => {
      const n = prompt('Описание (до 300):', data.bio || '');
      if (n !== null) socket.emit('update-bio', n.slice(0, 300));
    };
    actions.appendChild(editBtn);

    const avLabel = document.createElement('label');
    avLabel.className = 'primary';
    avLabel.style.cssText = 'padding:7px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;background:var(--accent);color:#fff;display:inline-block;';
    avLabel.textContent = 'Сменить аватар';
    const avInput = document.createElement('input');
    avInput.type = 'file';
    avInput.accept = 'image/*';
    avInput.hidden = true;
    avInput.onchange = async () => {
      try {
        const dataUrl = await readImageFile(avInput.files[0]);
        socket.emit('set-avatar', dataUrl);
        setTimeout(() => openProfile(me.name), 400);
      } catch (e) {}
    };
    avLabel.appendChild(avInput);
    actions.appendChild(avLabel);
  } else if (me) {
    const dmBtn = document.createElement('button');
    dmBtn.className = 'primary';
    dmBtn.textContent = 'Написать в ЛС';
    dmBtn.onclick = () => {
      profilePanel.classList.add('hidden');
      openDm(data.name);
    };
    actions.appendChild(dmBtn);
  }

  const wallForm = document.getElementById('wallForm');
  wallForm.classList.toggle('hidden', !me);

  const wallPosts = document.getElementById('wallPosts');
  wallPosts.innerHTML = '';
  (data.wall || []).slice().reverse().forEach(w => {
    const d = document.createElement('div');
    d.className = 'wall-post';
    const t = new Date(w.time).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    d.innerHTML = `<span class="from" style="color:${w.color}">${escapeHtml(w.from)}</span>
      <span class="wtime">${t}</span>
      <div class="wtext">${escapeHtml(w.text)}</div>`;
    wallPosts.appendChild(d);
  });
});

document.getElementById('wallBtn').addEventListener('click', () => {
  const text = document.getElementById('wallInput').value.trim();
  if (!text || !profileTarget) return;
  socket.emit('wall-post', { to: profileTarget, text });
  document.getElementById('wallInput').value = '';
});

socket.on('wall-posted', () => { if (profileTarget) socket.emit('get-profile', profileTarget); });
socket.on('wall-update', () => { if (profileTarget) socket.emit('get-profile', profileTarget); });

// DMs
function openDm(name) {
  if (!me || isGuest) return;
  dmPartner = name;
  dmConversations.add(name);
  renderDmList();
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-view="dms"]').classList.add('active');
  currentView = 'dms';
  document.getElementById('chatPanel').classList.add('hidden');
  document.getElementById('dmPanel').classList.remove('hidden');
  document.getElementById('boardTitle').textContent = `/dm/ ${name}`;
  document.getElementById('dmChat').classList.remove('hidden');
  document.getElementById('dmWithName').textContent = name;
  document.getElementById('dmMessages').innerHTML = '';
  socket.emit('dm-history', name);
}

function renderDmList() {
  const ul = document.getElementById('dmConversations');
  ul.innerHTML = '';
  dmConversations.forEach(name => {
    const li = document.createElement('li');
    li.textContent = name;
    if (name === dmPartner) li.classList.add('active');
    li.onclick = () => openDm(name);
    ul.appendChild(li);
  });
}

document.getElementById('dmBack').addEventListener('click', () => {
  document.getElementById('dmChat').classList.add('hidden');
  dmPartner = null;
});

let dmPendingImage = null;
document.getElementById('dmImageInput').addEventListener('change', async () => {
  const input = document.getElementById('dmImageInput');
  try {
    dmPendingImage = await readImageFile(input.files[0]);
  } catch (e) { dmPendingImage = null; }
  input.value = '';
});

document.getElementById('dmForm').addEventListener('submit', e => {
  e.preventDefault();
  if (!dmPartner || !me) return;
  const text = document.getElementById('dmInput').value.trim();
  if (!text && !dmPendingImage) return;
  socket.emit('dm-send', { to: dmPartner, text, image: dmPendingImage });
  document.getElementById('dmInput').value = '';
  dmPendingImage = null;
});

socket.on('dm-history', ({ with: name, messages }) => {
  const el = document.getElementById('dmMessages');
  el.innerHTML = '';
  messages.forEach(m => addDmMessage(m));
  scrollBottom(el);
});

socket.on('dm', ({ with: name, msg }) => {
  dmConversations.add(name === me?.name ? msg.from : name);
  renderDmList();
  if (dmPartner === name || dmPartner === msg.from) {
    addDmMessage(msg);
    scrollBottom(document.getElementById('dmMessages'));
  }
});

function addDmMessage(msg) {
  const div = document.createElement('div');
  div.className = 'msg' + (me && msg.from === me.name ? ' own' : '');
  const t = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  let img = msg.image ? `<img class="msg-image" src="${msg.image}" alt="">` : '';
  div.innerHTML = `
    <div class="msg-body">
      <div class="meta">
        <span style="color:${msg.color}; font-weight:700">${escapeHtml(msg.from)}</span>
        <span class="time">${t}</span>
      </div>
      <div class="text">${msg.text ? escapeHtml(msg.text) : ''}</div>
      ${img}
    </div>`;
  const im = div.querySelector('.msg-image');
  if (im) im.addEventListener('click', () => openLightbox(msg.image));
  document.getElementById('dmMessages').appendChild(div);
}

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('och_token');
  location.reload();
});
