const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ===== State =====
let token = localStorage.getItem('pipiski_token');
let me = null;
let socket = null;
let pc = null;                 // RTCPeerConnection
let localStream = null;
let screenStream = null;
let currentCallUserId = null;
let isCaller = false;
let micEnabled = true;
let camEnabled = false;
let screenSharing = false;

// ===== Auth UI =====
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const isLogin = tab.dataset.tab === 'login';
    $('#login-form').classList.toggle('hidden', !isLogin);
    $('#register-form').classList.toggle('hidden', isLogin);
  });
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('#login-username').value.trim();
  const password = $('#login-password').value;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка');
    onAuthSuccess(data);
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('#reg-username').value.trim();
  const password = $('#reg-password').value;
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка');
    onAuthSuccess(data);
  } catch (err) {
    $('#reg-error').textContent = err.message;
  }
});

function onAuthSuccess(data) {
  token = data.token;
  me = data.user;
  localStorage.setItem('pipiski_token', token);
  showApp();
}

function showApp() {
  $('#auth-screen').classList.add('hidden');
  $('#app-screen').classList.remove('hidden');
  updateMyProfile();
  connectSocket();
}

function updateMyProfile() {
  $('#my-username').textContent = me.username;
  const av = me.avatar || defaultAvatar(me.username);
  $('#my-avatar').src = av;
}

function defaultAvatar(name) {
  const colors = ['#5865f2', '#57f287', '#fee75c', '#eb459e', '#ed4245', '#f26522'];
  const color = colors[name.charCodeAt(0) % colors.length];
  return `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect fill="${encodeURIComponent(color)}" width="64" height="64"/><text x="32" y="42" text-anchor="middle" fill="white" font-size="28" font-family="sans-serif">${name[0].toUpperCase()}</text></svg>`;
}

// ===== Avatar upload =====
$('#avatar-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('avatar', file);
  try {
    const res = await fetch('/api/avatar', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    me.avatar = data.avatar;
    updateMyProfile();
  } catch (err) {
    alert('Не удалось загрузить аватар: ' + err.message);
  }
});

$('#logout-btn').addEventListener('click', () => {
  localStorage.removeItem('pipiski_token');
  location.reload();
});

// ===== Socket =====
function connectSocket() {
  socket = io({
    auth: { token },
    transports: ['websocket', 'polling']
  });

  socket.on('connect', () => console.log('Socket connected'));
  socket.on('connect_error', (err) => {
    console.error(err);
    if (err.message.includes('токен') || err.message.includes('token')) {
      localStorage.removeItem('pipiski_token');
      location.reload();
    }
  });

  socket.on('online-users', (users) => {
    renderUsers(users.filter(u => u.id !== me.id));
  });

  // --- Call signaling ---
  socket.on('incoming-call', async ({ from, offer }) => {
    currentCallUserId = from.id;
    isCaller = false;
    $('#incoming-avatar').src = from.avatar || defaultAvatar(from.username);
    $('#incoming-name').textContent = from.username;
    $('#incoming-modal').classList.remove('hidden');

    // сохраняем offer
    window._pendingOffer = offer;
    window._pendingFrom = from;
  });

  socket.on('call-answered', async ({ answer }) => {
    if (pc) {
      await pc.setRemoteDescription(answer);
      $('#call-status').textContent = 'В звонке';
    }
  });

  socket.on('ice-candidate', async ({ candidate }) => {
    if (pc && candidate) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (e) { console.warn(e); }
    }
  });

  socket.on('call-ended', () => {
    endCallUI();
  });

  socket.on('call-rejected', () => {
    alert('Звонок отклонён');
    endCallUI();
  });
}

function renderUsers(users) {
  const list = $('#users-list');
  list.innerHTML = '';
  if (users.length === 0) {
    list.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:13px">Никого нет онлайн</div>';
    return;
  }
  users.forEach(u => {
    const el = document.createElement('div');
    el.className = 'user-item';
    el.innerHTML = `
      <img class="avatar" src="${u.avatar || defaultAvatar(u.username)}" />
      <span class="name">${u.username}</span>
      <span class="call-icon">📞</span>
    `;
    el.addEventListener('click', () => startCall(u));
    list.appendChild(el);
  });
}

// ===== WebRTC =====
const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

async function createPeerConnection() {
  pc = new RTCPeerConnection({ iceServers });

  pc.onicecandidate = (e) => {
    if (e.candidate && currentCallUserId) {
      socket.emit('ice-candidate', { to: currentCallUserId, candidate: e.candidate });
    }
  };

  pc.ontrack = (e) => {
    const remote = $('#remote-video');
    if (remote.srcObject !== e.streams[0]) {
      remote.srcObject = e.streams[0];
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      $('#call-status').textContent = 'В звонке';
    } else if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
      endCallUI();
    }
  };
}

async function getLocalMedia(audio = true, video = false) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio, video });
    $('#local-video').srcObject = localStream;
    return localStream;
  } catch (err) {
    console.error(err);
    alert('Нужен доступ к микрофону');
    throw err;
  }
}

async function startCall(user) {
  if (pc) return; // уже в звонке
  currentCallUserId = user.id;
  isCaller = true;

  $('#empty-state').classList.add('hidden');
  $('#call-view').classList.remove('hidden');
  $('#call-avatar').src = user.avatar || defaultAvatar(user.username);
  $('#call-username').textContent = user.username;
  $('#call-status').textContent = 'Звоним...';

  await createPeerConnection();
  await getLocalMedia(true, false);

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit('call-user', { to: user.id, offer });
}

$('#accept-call').addEventListener('click', async () => {
  $('#incoming-modal').classList.add('hidden');
  const from = window._pendingFrom;
  const offer = window._pendingOffer;

  $('#empty-state').classList.add('hidden');
  $('#call-view').classList.remove('hidden');
  $('#call-avatar').src = from.avatar || defaultAvatar(from.username);
  $('#call-username').textContent = from.username;
  $('#call-status').textContent = 'Соединение...';

  await createPeerConnection();
  await getLocalMedia(true, false);

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit('answer-call', { to: from.id, answer });
});

$('#reject-call').addEventListener('click', () => {
  $('#incoming-modal').classList.add('hidden');
  if (window._pendingFrom) {
    socket.emit('reject-call', { to: window._pendingFrom.id });
  }
  currentCallUserId = null;
});

$('#hangup-btn').addEventListener('click', () => {
  if (currentCallUserId) {
    socket.emit('end-call', { to: currentCallUserId });
  }
  endCallUI();
});

function endCallUI() {
  if (pc) {
    pc.close();
    pc = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  $('#local-video').srcObject = null;
  $('#remote-video').srcObject = null;
  $('#call-view').classList.add('hidden');
  $('#empty-state').classList.remove('hidden');
  currentCallUserId = null;
  screenSharing = false;
  camEnabled = false;
  micEnabled = true;
  updateControlButtons();
}

// Controls
$('#toggle-mic').addEventListener('click', () => {
  if (!localStream) return;
  micEnabled = !micEnabled;
  localStream.getAudioTracks().forEach(t => t.enabled = micEnabled);
  updateControlButtons();
});

$('#toggle-cam').addEventListener('click', async () => {
  if (!pc) return;
  if (!camEnabled) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const videoTrack = stream.getVideoTracks()[0];
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) {
        sender.replaceTrack(videoTrack);
      } else {
        pc.addTrack(videoTrack, localStream);
      }
      // добавляем в localStream для отображения
      if (localStream) {
        localStream.getVideoTracks().forEach(t => t.stop());
        localStream.addTrack(videoTrack);
      }
      $('#local-video').srcObject = localStream;
      camEnabled = true;
    } catch (e) {
      alert('Нет доступа к камере');
    }
  } else {
    // выключаем камеру
    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
    if (sender && sender.track) {
      sender.track.stop();
      sender.replaceTrack(null);
    }
    if (localStream) {
      localStream.getVideoTracks().forEach(t => {
        t.stop();
        localStream.removeTrack(t);
      });
    }
    camEnabled = false;
  }
  updateControlButtons();
});

$('#toggle-screen').addEventListener('click', async () => {
  if (!pc) return;
  if (!screenSharing) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const screenTrack = screenStream.getVideoTracks()[0];
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(screenTrack);
      } else {
        pc.addTrack(screenTrack, screenStream);
      }
      $('#local-video').srcObject = screenStream;
      screenSharing = true;
      camEnabled = false;

      screenTrack.onended = () => {
        // пользователь нажал "Stop sharing"
        stopScreenShare();
      };
    } catch (e) {
      console.warn(e);
    }
  } else {
    stopScreenShare();
  }
  updateControlButtons();
});

async function stopScreenShare() {
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  // возвращаем камеру если была, или ничего
  const sender = pc?.getSenders().find(s => s.track?.kind === 'video' || !s.track);
  if (sender) {
    if (camEnabled && localStream?.getVideoTracks()[0]) {
      await sender.replaceTrack(localStream.getVideoTracks()[0]);
      $('#local-video').srcObject = localStream;
    } else {
      await sender.replaceTrack(null);
      $('#local-video').srcObject = localStream;
    }
  }
  screenSharing = false;
  updateControlButtons();
}

function updateControlButtons() {
  $('#toggle-mic').classList.toggle('muted', !micEnabled);
  $('#toggle-mic').textContent = micEnabled ? '🎤' : '🔇';
  $('#toggle-cam').classList.toggle('active', camEnabled);
  $('#toggle-screen').classList.toggle('active', screenSharing);
}

// ===== Init =====
(async function init() {
  if (!token) return;
  try {
    const res = await fetch('/api/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error();
    me = await res.json();
    showApp();
  } catch {
    localStorage.removeItem('pipiski_token');
  }
})();
