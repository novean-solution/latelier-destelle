const BOOKING_API = 'https://latelier-destelle-api.contactnovean.workers.dev';
const STATUS_LABELS = { pending: 'En attente', confirmed: 'Confirmé', cancelled: 'Annulé' };

const SERVICES = {
  thermolyse: [
    { name: 'Rendez-vous d\'informations', duration: 30 },
    { name: 'Séance de 15 minutes', duration: 30 },
    { name: 'Séance de 30 minutes', duration: 30 },
    { name: 'Séance de 45 minutes', duration: 60 },
    { name: 'Séance de 1h00', duration: 60 },
    { name: 'Séance de 1h30', duration: 90 },
    { name: 'Séance de 2h00', duration: 120 },
  ],
};

const PHONE_REGEX = /^(?:\+33\s?|0)[1-9](?:[\s.]?\d{2}){4}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let currentFilter = 'all';
let appointments = [];
let appointmentsById = {};
let clients = [];
let currentClientId = null;

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

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BOOKING_API}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      'Authorization': `Bearer ${getToken()}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    clearToken();
    showLogin();
    throw new Error('Session expirée');
  }
  return res.json();
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

/* ===== Onglets ===== */
function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (btn.dataset.tab === 'appointments') {
      switchView('viewAppointments');
      loadAppointments();
    } else {
      switchView('viewClients');
      loadClients();
    }
  });
});

/* ===== Rendez-vous ===== */
async function loadAppointments() {
  list.innerHTML = '<p class="empty-msg">Chargement...</p>';
  try {
    const data = await apiFetch('/api/admin/appointments');
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

  appointments.forEach(apt => { appointmentsById[apt.id] = apt; });
  list.innerHTML = filtered.map(apt => renderAppointmentCard(apt)).join('');
  attachAppointmentActions(list, loadAppointments);

  renderToday();
}

function renderToday() {
  const todayList = document.getElementById('todayAppointmentsList');
  const todayStr = getParisDateString();
  const todayAppointments = appointments
    .filter(a => a.date === todayStr)
    .sort((a, b) => a.time.localeCompare(b.time));

  if (todayAppointments.length === 0) {
    todayList.innerHTML = '<p class="empty-msg">Aucun rendez-vous aujourd\'hui.</p>';
    return;
  }

  todayList.innerHTML = todayAppointments.map(apt => renderAppointmentCard(apt)).join('');
  attachAppointmentActions(todayList, loadAppointments);
}

function renderAppointmentCard(apt) {
  return `
    <div class="apt-card status-${apt.status}" data-id="${apt.id}">
      <div class="apt-summary">
        <div class="apt-main">
          <div class="apt-date">${formatDate(apt.date)} à ${apt.time}</div>
          <div class="apt-service">${escapeHtml(apt.service)} (${apt.duration} min)</div>
          <div class="apt-client">${escapeHtml(apt.clientName)}</div>
        </div>
        <div class="apt-summary__right">
          <span class="status-badge ${apt.status}">${STATUS_LABELS[apt.status] || apt.status}</span>
          <svg class="apt-chevron" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </div>
      </div>
      <div class="apt-details">
        <div class="apt-client-detail">${escapeHtml(apt.clientPhone)}${apt.clientEmail ? ' · ' + escapeHtml(apt.clientEmail) : ''}</div>
        ${apt.notes ? `<div class="apt-notes">${escapeHtml(apt.notes)}</div>` : ''}
        <div class="apt-actions">
          <button data-action="edit">Modifier</button>
          ${apt.status !== 'confirmed' ? '<button data-action="confirm">Confirmer</button>' : ''}
          ${apt.status !== 'cancelled' ? '<button data-action="cancel">Annuler</button>' : ''}
          <button data-action="delete" class="danger">Supprimer</button>
        </div>
      </div>
    </div>
  `;
}

function attachAppointmentActions(container, onChange) {
  container.querySelectorAll('.apt-card').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('.apt-summary').addEventListener('click', () => {
      card.classList.toggle('expanded');
    });
    card.querySelectorAll('.apt-actions button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleAppointmentAction(id, btn.dataset.action, onChange);
      });
    });
  });
}

async function handleAppointmentAction(id, action, onChange) {
  try {
    if (action === 'edit') {
      const apt = appointmentsById[id];
      if (apt) await openAppointmentModal(apt);
      return;
    }
    if (action === 'confirm' || action === 'cancel') {
      const status = action === 'confirm' ? 'confirmed' : 'cancelled';
      const data = await apiFetch(`/api/admin/appointments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      if (!data.success) throw new Error(data.error);
    } else if (action === 'delete') {
      if (!confirm('Supprimer définitivement ce rendez-vous ?')) return;
      const data = await apiFetch(`/api/admin/appointments/${id}`, { method: 'DELETE' });
      if (!data.success) throw new Error(data.error);
    }
    onChange();
  } catch (e) {
    alert('Erreur : ' + e.message);
  }
}

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    render();
  });
});

/* ===== Modal nouveau rendez-vous ===== */
const appointmentModal = document.getElementById('appointmentModal');
const aptService = document.getElementById('aptService');
const appointmentModalError = document.getElementById('appointmentModalError');

function populateServiceOptions() {
  aptService.innerHTML = SERVICES.thermolyse
    .map(s => `<option value="${escapeHtml(s.name)}" data-duration="${s.duration}">${escapeHtml(s.name)} (${s.duration} min)</option>`)
    .join('');
}

/* ===== Calendrier de date / heure (modal rendez-vous) ===== */
let aptCalendarMonth, aptCalendarYear;
let aptSelectedDate = null;

function populateTimeSelects() {
  const hourSelect = document.getElementById('aptHour');
  const minuteSelect = document.getElementById('aptMinute');
  if (hourSelect.options.length) return;
  for (let h = 7; h <= 20; h++) {
    const opt = document.createElement('option');
    opt.value = String(h).padStart(2, '0');
    opt.textContent = String(h).padStart(2, '0') + 'h';
    hourSelect.appendChild(opt);
  }
  for (let m = 0; m < 60; m++) {
    const opt = document.createElement('option');
    opt.value = String(m).padStart(2, '0');
    opt.textContent = String(m).padStart(2, '0');
    minuteSelect.appendChild(opt);
  }
}

function setAptTime(time) {
  populateTimeSelects();
  const [h, m] = (time || '09:00').split(':');
  document.getElementById('aptHour').value = h;
  document.getElementById('aptMinute').value = m;
}

function getAptTime() {
  return `${document.getElementById('aptHour').value}:${document.getElementById('aptMinute').value}`;
}

function initAptCalendar(initialDate) {
  const d = new Date(initialDate + 'T00:00:00');
  aptCalendarMonth = d.getMonth();
  aptCalendarYear = d.getFullYear();
  aptSelectedDate = initialDate;
  renderAptCalendar();
}

function renderAptCalendar() {
  const title = document.getElementById('aptCalTitle');
  const daysContainer = document.getElementById('aptCalDays');
  const prevBtn = document.getElementById('aptCalPrev');

  const monthDate = new Date(aptCalendarYear, aptCalendarMonth, 1);
  title.textContent = monthDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  // L'admin peut naviguer librement (saisie de RDV passés possible, ex. enregistrement a posteriori)
  prevBtn.disabled = false;

  const firstDayIndex = (new Date(aptCalendarYear, aptCalendarMonth, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(aptCalendarYear, aptCalendarMonth + 1, 0).getDate();

  daysContainer.innerHTML = '';

  for (let i = 0; i < firstDayIndex; i++) {
    const empty = document.createElement('span');
    empty.className = 'booking-calendar__day empty';
    daysContainer.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${aptCalendarYear}-${String(aptCalendarMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'booking-calendar__day';
    btn.textContent = d;
    btn.addEventListener('click', () => {
      aptSelectedDate = dateStr;
      renderAptCalendar();
    });

    if (dateStr === aptSelectedDate) btn.classList.add('active');

    daysContainer.appendChild(btn);
  }
}

document.getElementById('aptCalPrev').addEventListener('click', () => {
  aptCalendarMonth--;
  if (aptCalendarMonth < 0) { aptCalendarMonth = 11; aptCalendarYear--; }
  renderAptCalendar();
});
document.getElementById('aptCalNext').addEventListener('click', () => {
  aptCalendarMonth++;
  if (aptCalendarMonth > 11) { aptCalendarMonth = 0; aptCalendarYear++; }
  renderAptCalendar();
});

let editAppointmentId = null;

async function openAppointmentModal(apt) {
  populateServiceOptions();
  editAppointmentId = apt ? apt.id : null;
  document.getElementById('appointmentModalTitle').textContent = apt ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous';

  if (apt) {
    const matchIndex = Array.from(aptService.options).findIndex(o => o.value === apt.service);
    aptService.selectedIndex = matchIndex >= 0 ? matchIndex : 0;
    initAptCalendar(apt.date);
    setAptTime(apt.time);
    document.getElementById('aptStatus').value = apt.status;
    document.getElementById('aptClientName').value = apt.clientName || '';
    document.getElementById('aptClientPhone').value = apt.clientPhone || '';
    document.getElementById('aptClientEmail').value = apt.clientEmail || '';
    document.getElementById('aptNotes').value = apt.notes || '';
  } else {
    initAptCalendar(getParisDateString());
    setAptTime('09:00');
    document.getElementById('aptStatus').value = 'confirmed';
    document.getElementById('aptClientName').value = '';
    document.getElementById('aptClientPhone').value = '';
    document.getElementById('aptClientEmail').value = '';
    document.getElementById('aptNotes').value = '';
  }

  appointmentModalError.style.display = 'none';
  hideClientSuggestions();
  appointmentModal.classList.add('active');

  if (clients.length === 0) {
    try {
      const data = await apiFetch('/api/admin/clients');
      if (data.success) clients = data.clients || [];
    } catch (e) { /* ignore */ }
  }
}

document.getElementById('newAppointmentBtn').addEventListener('click', () => openAppointmentModal(null));

/* Autocomplétion client dans le formulaire de rendez-vous */
const aptClientName = document.getElementById('aptClientName');
const clientSuggestions = document.getElementById('clientSuggestions');

function hideClientSuggestions() {
  clientSuggestions.classList.remove('active');
  clientSuggestions.innerHTML = '';
}

aptClientName.addEventListener('input', () => {
  const query = aptClientName.value.trim().toLowerCase();
  if (!query) return hideClientSuggestions();

  const matches = clients.filter(c => c.name && c.name.toLowerCase().includes(query)).slice(0, 6);
  if (matches.length === 0) return hideClientSuggestions();

  clientSuggestions.innerHTML = matches.map(c => `
    <div class="client-suggestion" data-id="${c.id}">
      <div class="client-suggestion__name">${escapeHtml(c.name)}</div>
      <div class="client-suggestion__phone">${escapeHtml(c.phone)}${c.email ? ' · ' + escapeHtml(c.email) : ''}</div>
    </div>
  `).join('');

  clientSuggestions.querySelectorAll('.client-suggestion').forEach(el => {
    el.addEventListener('click', () => {
      const client = clients.find(c => c.id === el.dataset.id);
      if (!client) return;
      aptClientName.value = client.name;
      document.getElementById('aptClientPhone').value = client.phone;
      document.getElementById('aptClientEmail').value = client.email || '';
      hideClientSuggestions();
    });
  });

  clientSuggestions.classList.add('active');
});

document.addEventListener('click', e => {
  if (!clientSuggestions.contains(e.target) && e.target !== aptClientName) {
    hideClientSuggestions();
  }
});

document.getElementById('appointmentModalCancel').addEventListener('click', () => {
  appointmentModal.classList.remove('active');
});

document.getElementById('appointmentModalSave').addEventListener('click', async () => {
  const category = 'thermolyse';
  const selectedOption = aptService.options[aptService.selectedIndex];
  const service = selectedOption.value;
  const duration = Number(selectedOption.dataset.duration);
  const date = aptSelectedDate;
  const time = getAptTime();
  const status = document.getElementById('aptStatus').value;
  const clientName = document.getElementById('aptClientName').value.trim();
  const clientPhone = document.getElementById('aptClientPhone').value.trim();
  const clientEmail = document.getElementById('aptClientEmail').value.trim();
  const notes = document.getElementById('aptNotes').value.trim();

  if (!date || !time || !clientName || !clientPhone) {
    return showModalError(appointmentModalError, 'Merci de remplir tous les champs obligatoires.');
  }
  if (!PHONE_REGEX.test(clientPhone)) {
    return showModalError(appointmentModalError, 'Numéro de téléphone invalide. Format attendu : 06 12 34 56 78');
  }
  if (clientEmail && !EMAIL_REGEX.test(clientEmail)) {
    return showModalError(appointmentModalError, 'Adresse email invalide.');
  }

  const saveBtn = document.getElementById('appointmentModalSave');
  saveBtn.disabled = true;
  try {
    const payload = {
      service, category, date, time: time.slice(0, 5), duration, status,
      clientName, clientPhone, clientEmail, notes,
    };
    const data = editAppointmentId
      ? await apiFetch(`/api/admin/appointments/${editAppointmentId}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : await apiFetch('/api/admin/appointments', { method: 'POST', body: JSON.stringify(payload) });
    if (!data.success) throw new Error(data.error || 'Erreur');
    appointmentModal.classList.remove('active');
    if (currentClientId && document.getElementById('viewClientDetail').classList.contains('active')) {
      openClientDetail(currentClientId);
    } else {
      loadAppointments();
    }
  } catch (e) {
    showModalError(appointmentModalError, e.message);
  } finally {
    saveBtn.disabled = false;
  }
});

function showModalError(el, message) {
  el.textContent = message;
  el.style.display = 'block';
}

function getParisDateString() {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

/* ===== Clients ===== */
async function loadClients() {
  const container = document.getElementById('clientsList');
  container.innerHTML = '<p class="empty-msg">Chargement...</p>';
  try {
    const data = await apiFetch('/api/admin/clients');
    if (!data.success) throw new Error(data.error || 'Erreur');
    clients = data.clients || [];
    renderClients();
  } catch (e) {
    container.innerHTML = `<p class="empty-msg">Erreur : ${e.message}</p>`;
  }
}

function renderClients() {
  const container = document.getElementById('clientsList');
  const query = document.getElementById('clientSearch').value.trim().toLowerCase();

  const filtered = !query
    ? clients
    : clients.filter(c => c.name.toLowerCase().includes(query) || c.phone.includes(query));

  if (filtered.length === 0) {
    container.innerHTML = '<p class="empty-msg">Aucun client.</p>';
    return;
  }

  container.innerHTML = filtered.map(c => `
    <div class="client-card" data-id="${c.id}">
      <div>
        <div class="client-card__name">${escapeHtml(c.name || '(sans nom)')}</div>
        <div class="client-card__meta">${escapeHtml(c.phone)}${c.email ? ' · ' + escapeHtml(c.email) : ''}${c.lastVisit ? ' · Dernier RDV : ' + formatDate(c.lastVisit) : ''}</div>
      </div>
      <span class="client-card__count">${c.appointmentCount} RDV</span>
    </div>
  `).join('');

  container.querySelectorAll('.client-card').forEach(card => {
    card.addEventListener('click', () => openClientDetail(card.dataset.id));
  });
}

document.getElementById('clientSearch').addEventListener('input', renderClients);

async function openClientDetail(id) {
  try {
    const data = await apiFetch(`/api/admin/clients/${id}`);
    if (!data.success) throw new Error(data.error || 'Erreur');

    currentClientId = id;
    document.getElementById('clientDetailName').textContent = data.client.name || '(sans nom)';
    document.getElementById('clientEditName').value = data.client.name || '';
    document.getElementById('clientEditPhone').value = data.client.phone || '';
    document.getElementById('clientEditEmail').value = data.client.email || '';
    document.getElementById('clientNotes').value = data.client.notes || '';
    document.getElementById('clientDetailError').style.display = 'none';

    const aptList = document.getElementById('clientAppointmentsList');
    if (data.appointments.length === 0) {
      aptList.innerHTML = '<p class="empty-msg">Aucun rendez-vous pour ce client.</p>';
    } else {
      data.appointments.forEach(apt => { appointmentsById[apt.id] = apt; });
      aptList.innerHTML = data.appointments.map(apt => renderAppointmentCard(apt)).join('');
      attachAppointmentActions(aptList, () => openClientDetail(id));
    }

    switchView('viewClientDetail');
  } catch (e) {
    alert('Erreur : ' + e.message);
  }
}

document.getElementById('backToClients').addEventListener('click', () => {
  switchView('viewClients');
  loadClients();
});

document.getElementById('saveNotesBtn').addEventListener('click', async () => {
  if (!currentClientId) return;
  const errorEl = document.getElementById('clientDetailError');
  errorEl.style.display = 'none';

  const name = document.getElementById('clientEditName').value.trim();
  const phone = document.getElementById('clientEditPhone').value.trim();
  const email = document.getElementById('clientEditEmail').value.trim();
  const notes = document.getElementById('clientNotes').value.trim();

  if (!name) {
    errorEl.textContent = 'Le nom est obligatoire.';
    errorEl.style.display = 'block';
    return;
  }
  // Le téléphone est facultatif (les clientes inscrites en ligne n'en ont pas toujours)
  if (phone && !PHONE_REGEX.test(phone)) {
    errorEl.textContent = 'Numéro invalide. Format attendu : 06 12 34 56 78';
    errorEl.style.display = 'block';
    return;
  }
  if (email && !EMAIL_REGEX.test(email)) {
    errorEl.textContent = 'Adresse email invalide.';
    errorEl.style.display = 'block';
    return;
  }

  const saveBtn = document.getElementById('saveNotesBtn');
  const prevLabel = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Enregistrement...';
  try {
    const data = await apiFetch(`/api/admin/clients/${currentClientId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, phone, email, notes }),
    });
    if (!data.success) throw new Error(data.error);
    document.getElementById('clientDetailName').textContent = name || '(sans nom)';
    saveBtn.textContent = 'Enregistré ✓';
    setTimeout(() => { saveBtn.textContent = prevLabel; }, 1800);
  } catch (e) {
    errorEl.textContent = 'Erreur : ' + e.message;
    errorEl.style.display = 'block';
    saveBtn.textContent = prevLabel;
  } finally {
    saveBtn.disabled = false;
  }
});

document.getElementById('deleteClientBtn').addEventListener('click', async () => {
  if (!currentClientId) return;
  if (!confirm('Supprimer définitivement ce client et son historique ?')) return;
  try {
    const data = await apiFetch(`/api/admin/clients/${currentClientId}`, { method: 'DELETE' });
    if (!data.success) throw new Error(data.error);
    switchView('viewClients');
    loadClients();
  } catch (e) {
    alert('Erreur : ' + e.message);
  }
});

/* ===== Modal nouveau client ===== */
const clientModal = document.getElementById('clientModal');
const clientModalError = document.getElementById('clientModalError');

document.getElementById('newClientBtn').addEventListener('click', () => {
  document.getElementById('newClientName').value = '';
  document.getElementById('newClientPhone').value = '';
  document.getElementById('newClientEmail').value = '';
  document.getElementById('newClientNotes').value = '';
  clientModalError.style.display = 'none';
  clientModal.classList.add('active');
});

document.getElementById('clientModalCancel').addEventListener('click', () => {
  clientModal.classList.remove('active');
});

document.getElementById('clientModalSave').addEventListener('click', async () => {
  const name = document.getElementById('newClientName').value.trim();
  const phone = document.getElementById('newClientPhone').value.trim();
  const email = document.getElementById('newClientEmail').value.trim();
  const notes = document.getElementById('newClientNotes').value.trim();

  if (!name || !phone) {
    return showModalError(clientModalError, 'Le nom et le téléphone sont obligatoires.');
  }
  if (!PHONE_REGEX.test(phone)) {
    return showModalError(clientModalError, 'Numéro de téléphone invalide. Format attendu : 06 12 34 56 78');
  }
  if (email && !EMAIL_REGEX.test(email)) {
    return showModalError(clientModalError, 'Adresse email invalide.');
  }

  const saveBtn = document.getElementById('clientModalSave');
  saveBtn.disabled = true;
  try {
    const data = await apiFetch('/api/admin/clients', {
      method: 'POST',
      body: JSON.stringify({ name, phone, email, notes }),
    });
    if (!data.success) throw new Error(data.error || 'Erreur');
    clientModal.classList.remove('active');
    loadClients();
  } catch (e) {
    showModalError(clientModalError, e.message);
  } finally {
    saveBtn.disabled = false;
  }
});

/* ===== Utils ===== */
function formatDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

loginBtn.addEventListener('click', login);
passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
logoutBtn.addEventListener('click', () => {
  apiFetch('/api/admin/logout', { method: 'POST' }).catch(() => {}); // révoque la session côté serveur
  clearToken();
  showLogin();
});

if (getToken()) {
  showApp();
} else {
  showLogin();
}
