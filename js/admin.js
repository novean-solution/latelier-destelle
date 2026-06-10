const BOOKING_API = 'https://latelier-destelle-api.contactnovean.workers.dev';
let currentFilter = 'all';
let appointments = [];

const loginScreen = document.getElementById('loginScreen');
const app = document.getElementById('app');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const logoutBtn = document.getElementById('logoutBtn');
const list = document.getElementById('appointmentsList');

function getToken() {
  return sessionStorage.getItem('adminToken');
}

function setToken(token) {
  sessionStorage.setItem('adminToken', token);
}

function clearToken() {
  sessionStorage.removeItem('adminToken');
}

async function login() {
  loginError.style.display = 'none';
  const password = passwordInput.value.trim();
  if (!password) return;
  try {
    const res = await fetch(`${BOOKING_API}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Mot de passe incorrect');
    setToken(data.token);
    showApp();
  } catch (e) {
    loginError.textContent = e.message;
    loginError.style.display = 'block';
  }
}

function showApp() {
  loginScreen.style.display = 'none';
  app.style.display = 'block';
  loadAppointments();
}

function showLogin() {
  loginScreen.style.display = 'flex';
  app.style.display = 'none';
}

async function loadAppointments() {
  list.innerHTML = '<p class="empty-msg">Chargement...</p>';
  try {
    const res = await fetch(`${BOOKING_API}/api/admin/appointments`, {
      headers: { 'Authorization': `Bearer ${getToken()}` },
    });
    if (res.status === 401) {
      clearToken();
      showLogin();
      return;
    }
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Erreur');
    appointments = data.appointments || [];
    render();
  } catch (e) {
    list.innerHTML = `<p class="empty-msg">Erreur : ${e.message}</p>`;
  }
}

function render() {
  const filtered = currentFilter === 'all'
    ? appointments
    : appointments.filter(a => a.status === currentFilter);

  if (filtered.length === 0) {
    list.innerHTML = '<p class="empty-msg">Aucun rendez-vous.</p>';
    return;
  }

  list.innerHTML = filtered.map(apt => `
    <div class="apt-card status-${apt.status}" data-id="${apt.id}">
      <div class="apt-main">
        <div class="apt-date">${formatDate(apt.date)} à ${apt.time}</div>
        <div class="apt-service">${escapeHtml(apt.service)} (${apt.duration} min)</div>
        <div class="apt-client">${escapeHtml(apt.clientName)} · ${escapeHtml(apt.clientPhone)}${apt.clientEmail ? ' · ' + escapeHtml(apt.clientEmail) : ''}</div>
        ${apt.notes ? `<div class="apt-notes">${escapeHtml(apt.notes)}</div>` : ''}
        <div style="margin-top:0.5rem;"><span class="status-badge ${apt.status}">${apt.status}</span></div>
      </div>
      <div class="apt-actions">
        ${apt.status !== 'confirmed' ? '<button data-action="confirm">Confirmer</button>' : ''}
        ${apt.status !== 'cancelled' ? '<button data-action="cancel">Annuler</button>' : ''}
        <button data-action="delete" class="danger">Supprimer</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.apt-card').forEach(card => {
    const id = card.dataset.id;
    card.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => handleAction(id, btn.dataset.action));
    });
  });
}

async function handleAction(id, action) {
  try {
    if (action === 'confirm' || action === 'cancel') {
      const status = action === 'confirm' ? 'confirmed' : 'cancelled';
      const res = await fetch(`${BOOKING_API}/api/admin/appointments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
    } else if (action === 'delete') {
      if (!confirm('Supprimer définitivement ce rendez-vous ?')) return;
      const res = await fetch(`${BOOKING_API}/api/admin/appointments/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
    }
    loadAppointments();
  } catch (e) {
    alert('Erreur : ' + e.message);
  }
}

function formatDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

loginBtn.addEventListener('click', login);
passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
logoutBtn.addEventListener('click', () => { clearToken(); showLogin(); });

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    render();
  });
});

if (getToken()) {
  showApp();
} else {
  showLogin();
}
