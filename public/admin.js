const socket = io();

const loginBox = document.getElementById('loginBox');
const adminPanel = document.getElementById('adminPanel');
const passInput = document.getElementById('passInput');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const pendingList = document.getElementById('pendingList');
const approvedList = document.getElementById('approvedList');

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

loginBtn.addEventListener('click', () => {
  socket.emit('admin-login', passInput.value);
});
passInput.addEventListener('keydown', e => { if (e.key === 'Enter') loginBtn.click(); });

socket.on('admin-login-ok', () => {
  loginBox.classList.add('hidden');
  adminPanel.classList.remove('hidden');
  sessionStorage.setItem('och_admin_pass', passInput.value);
});
socket.on('admin-login-fail', () => {
  loginError.textContent = 'Неверный пароль';
});

const savedPass = sessionStorage.getItem('och_admin_pass');
if (savedPass) socket.emit('admin-login', savedPass);

socket.on('admin:status', (s) => {
  document.getElementById('maintStatus').textContent = s.maintenance ? 'ВКЛ' : 'выкл';
  document.getElementById('maintStatus').style.color = s.maintenance ? '#c41e3a' : '#3fb950';
  const btn = document.getElementById('toggleMaint');
  btn.textContent = s.maintenance ? 'Выключить' : 'Включить';
  btn.classList.toggle('off', s.maintenance);
  document.getElementById('regModeStatus').textContent =
    s.regMode === 'approve' ? 'по одобрению' : 'свободная';
});

document.getElementById('toggleMaint').addEventListener('click', () => {
  socket.emit('admin-toggle-maintenance');
});

socket.on('admin:pending', (list) => {
  if (!list.length) {
    pendingList.innerHTML = '<p class="empty-msg">Заявок нет</p>';
    return;
  }
  pendingList.innerHTML = '';
  list.forEach(p => {
    const row = document.createElement('div');
    row.className = 'req-row';
    row.innerHTML = `
      <span class="mini-avatar">${generateAvatarSVG(p.avatarSeed, 32)}</span>
      <span class="name">${escapeHtml(p.name)}</span>
      <button class="approve-btn">Впустить</button>
      <button class="deny-btn">Отказать</button>
    `;
    row.querySelector('.approve-btn').onclick = () => socket.emit('admin-approve', p.id);
    row.querySelector('.deny-btn').onclick = () => socket.emit('admin-deny', p.id);
    pendingList.appendChild(row);
  });
});

socket.on('admin:approved', (list) => {
  if (!list.length) {
    approvedList.innerHTML = '<p class="empty-msg">Пока никого</p>';
    return;
  }
  approvedList.innerHTML = '';
  list.forEach(u => {
    const row = document.createElement('div');
    row.className = 'user-row';
    row.innerHTML = `
      <span class="mini-avatar">${generateAvatarSVG(u.avatarSeed, 32)}</span>
      <span class="name" style="color:${u.color}">
        ${u.isOwner ? '<span class="owner-badge">OWNER</span> ' : ''}${escapeHtml(u.name)}
      </span>
      ${u.isOwner ? '' : `
        <button class="kick-btn">Выгнать</button>
        <button class="ban-btn">Бан</button>
      `}
    `;
    if (!u.isOwner) {
      row.querySelector('.kick-btn').onclick = () => {
        if (confirm(`Выгнать ${u.name}?`)) socket.emit('admin-kick', u.token);
      };
      row.querySelector('.ban-btn').onclick = () => {
        if (confirm(`Забанить ${u.name}? Аккаунт будет удалён.`)) socket.emit('admin-ban', u.token);
      };
    }
    approvedList.appendChild(row);
  });
});
