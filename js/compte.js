// Espace client - L'atelier d'Estelle
const BOOKING_API = 'https://latelier-destelle-api.contactnovean.workers.dev';
const PHONE_REGEX = /^0[1-9](\s?\d{2}){4}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUS_LABELS = { pending: 'En attente', confirmed: 'Confirmé', cancelled: 'Annulé' };

const SERVICES = [
  { name: 'Rendez-vous d\'informations', duration: 30, price: '20 €' },
  { name: 'Séance de 15 minutes', duration: 30, price: '40 €' },
  { name: 'Séance de 30 minutes', duration: 30, price: '70 €' },
  { name: 'Séance de 45 minutes', duration: 60, price: '100 €' },
  { name: 'Séance de 1h00', duration: 60, price: '130 €' },
  { name: 'Séance de 1h30', duration: 90, price: '180 €' },
  { name: 'Séance de 2h00', duration: 120, price: '230 €' },
];

let authToken = localStorage.getItem('atelierToken') || null;
let currentClient = null;

const bookingState = { step: 1, service: null, date: null, time: null };
let calendarMonth, calendarYear;

document.addEventListener('DOMContentLoaded', () => {
  if (authToken) {
    loadAccount();
  }

  document.getElementById('sendCodeBtn').addEventListener('click', sendCode);
  document.getElementById('verifyCodeBtn').addEventListener('click', verifyCode);
  document.getElementById('logoutBtn').addEventListener('click', logout);

  document.querySelectorAll('.account__tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  document.getElementById('saveProfileBtn').addEventListener('click', saveProfile);

  renderServices();
  initCalendar();

  document.getElementById('bookingPrevBtn').addEventListener('click', () => goToStep(bookingState.step - 1));
  document.getElementById('bookingNextBtn').addEventListener('click', () => {
    if (bookingState.step === 2) renderSummary();
    goToStep(bookingState.step + 1);
  });
  document.getElementById('bookingConfirmBtn').addEventListener('click', submitBooking);
});

function getParisDateString(date) {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date || new Date());
}

function getParisTimeString(date) {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(date || new Date());
}

function formatDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BOOKING_API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (res.status === 401) {
    logout();
    throw new Error('Session expirée, merci de vous reconnecter.');
  }
  return data;
}

/* ===== Authentification ===== */

async function sendCode() {
  const emailInput = document.getElementById('loginEmail');
  const errorEl = document.getElementById('emailError');
  errorEl.style.display = 'none';
  const email = emailInput.value.trim().toLowerCase();

  if (!EMAIL_REGEX.test(email)) {
    errorEl.textContent = 'Adresse email invalide.';
    errorEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('sendCodeBtn');
  btn.disabled = true;
  btn.textContent = 'Envoi en cours...';

  try {
    const data = await apiFetch('/api/auth/request-code', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    if (!data.success) throw new Error(data.error || 'Erreur');

    document.getElementById('codeEmailDisplay').textContent = email;
    document.getElementById('emailStep').style.display = 'none';
    document.getElementById('codeStep').style.display = 'block';
    document.getElementById('codeStep').dataset.email = email;
  } catch (e) {
    errorEl.textContent = 'Erreur : ' + e.message;
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Recevoir mon code de connexion';
  }
}

async function verifyCode() {
  const errorEl = document.getElementById('codeError');
  errorEl.style.display = 'none';
  const email = document.getElementById('codeStep').dataset.email;
  const code = document.getElementById('loginCode').value.trim();

  if (!/^\d{6}$/.test(code)) {
    errorEl.textContent = 'Merci de saisir le code à 6 chiffres reçu par email.';
    errorEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('verifyCodeBtn');
  btn.disabled = true;
  btn.textContent = 'Connexion...';

  try {
    const data = await apiFetch('/api/auth/verify-code', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    });
    if (!data.success) throw new Error(data.error || 'Erreur');

    authToken = data.token;
    localStorage.setItem('atelierToken', authToken);
    currentClient = data.client;
    showApp();
  } catch (e) {
    errorEl.textContent = 'Erreur : ' + e.message;
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Se connecter';
  }
}

async function loadAccount() {
  try {
    const data = await apiFetch('/api/me');
    if (!data.success) throw new Error(data.error || 'Erreur');
    currentClient = data.client;
    showApp();
  } catch (e) {
    logout();
  }
}

function logout() {
  if (authToken) {
    apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  }
  authToken = null;
  currentClient = null;
  localStorage.removeItem('atelierToken');
  document.getElementById('app').style.display = 'none';
  document.getElementById('loginBox').style.display = 'block';
  document.getElementById('logoutBtn').style.display = 'none';
}

function showApp() {
  document.getElementById('loginBox').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('logoutBtn').style.display = 'inline-block';

  document.getElementById('profileEmail').value = currentClient.email || '';
  document.getElementById('profileName').value = currentClient.name || '';
  document.getElementById('profilePhone').value = currentClient.phone || '';

  loadAppointments();
}

/* ===== Onglets ===== */

function switchTab(tab) {
  document.querySelectorAll('.account__tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.account__view').forEach(v => v.classList.remove('active'));
  const map = { appointments: 'viewAppointments', booking: 'viewBooking', profile: 'viewProfile' };
  document.getElementById(map[tab]).classList.add('active');

  if (tab === 'appointments') loadAppointments();
  if (tab === 'booking') resetBooking();
}

/* ===== Mon profil ===== */

async function saveProfile() {
  const errorEl = document.getElementById('profileError');
  const successEl = document.getElementById('profileSuccess');
  errorEl.style.display = 'none';
  successEl.style.display = 'none';

  const name = document.getElementById('profileName').value.trim();
  const phone = document.getElementById('profilePhone').value.trim();

  if (!name) {
    errorEl.textContent = 'Le nom est requis.';
    errorEl.style.display = 'block';
    return;
  }
  if (phone && !PHONE_REGEX.test(phone)) {
    errorEl.textContent = 'Numéro invalide. Format attendu : 06 12 34 56 78';
    errorEl.style.display = 'block';
    return;
  }

  try {
    const data = await apiFetch('/api/me', {
      method: 'PATCH',
      body: JSON.stringify({ name, phone }),
    });
    if (!data.success) throw new Error(data.error || 'Erreur');
    currentClient.name = name;
    currentClient.phone = phone;
    successEl.style.display = 'block';
  } catch (e) {
    errorEl.textContent = 'Erreur : ' + e.message;
    errorEl.style.display = 'block';
  }
}

/* ===== Mes rendez-vous ===== */

async function loadAppointments() {
  const container = document.getElementById('appointmentsList');
  container.innerHTML = '<p class="empty-msg">Chargement...</p>';
  try {
    const data = await apiFetch('/api/me/appointments');
    if (!data.success) throw new Error(data.error || 'Erreur');

    const now = `${getParisDateString()}T${getParisTimeString()}`;
    const upcoming = data.appointments.filter(a => `${a.date}T${a.time}` >= now && a.status !== 'cancelled');
    const past = data.appointments.filter(a => !(`${a.date}T${a.time}` >= now && a.status !== 'cancelled'));

    let html = '';
    html += '<h2 style="font-family: var(--font-heading); color: var(--color-dark); margin-bottom: 1rem;">À venir</h2>';
    html += upcoming.length
      ? upcoming.map(renderAppointmentCard).join('')
      : '<p class="empty-msg">Aucun rendez-vous à venir.</p>';

    if (past.length) {
      html += '<h2 style="font-family: var(--font-heading); color: var(--color-dark); margin: 2rem 0 1rem;">Historique</h2>';
      html += past.map(a => renderAppointmentCard(a, true)).join('');
    }

    container.innerHTML = html;
    attachAppointmentActions(container);
  } catch (e) {
    container.innerHTML = `<p class="empty-msg">Erreur : ${escapeHtml(e.message)}</p>`;
  }
}

function renderAppointmentCard(apt, readOnly) {
  return `
    <div class="apt-card status-${apt.status}" data-id="${apt.id}" data-date="${apt.date}" data-time="${apt.time}" data-duration="${apt.duration}">
      <div class="apt-main">
        <div class="apt-date">${formatDate(apt.date)} à ${apt.time}</div>
        <div class="apt-service">${escapeHtml(apt.service)} (${apt.duration} min)</div>
        ${apt.notes ? `<div class="apt-notes" style="margin-top:0.4rem; font-size:0.85rem; opacity:0.75; font-style:italic;">${escapeHtml(apt.notes)}</div>` : ''}
        <span class="status-badge ${apt.status}">${STATUS_LABELS[apt.status] || apt.status}</span>
      </div>
      ${readOnly ? '' : `
      <div class="apt-actions">
        <button data-action="reschedule">Reporter</button>
        <button data-action="cancel" class="danger">Annuler</button>
      </div>
      <div class="reschedule-box" id="reschedule-${apt.id}">
        <div class="booking-calendar" id="cal-${apt.id}">
          <div class="booking-calendar__header">
            <button type="button" class="booking-calendar__nav" data-nav="prev">‹</button>
            <span class="booking-calendar__title"></span>
            <button type="button" class="booking-calendar__nav" data-nav="next">›</button>
          </div>
          <div class="booking-calendar__weekdays">
            <span>Lun</span><span>Mar</span><span>Mer</span><span>Jeu</span><span>Ven</span><span>Sam</span><span>Dim</span>
          </div>
          <div class="booking-calendar__days"></div>
        </div>
        <div class="booking-slots">
          <p class="booking-hint">Sélectionnez une date pour voir les créneaux disponibles.</p>
        </div>
        <div class="account-error"></div>
        <div class="booking-actions" style="margin-top:1rem;">
          <button class="btn btn--ghost" data-action="cancel-reschedule">Annuler</button>
          <button class="btn btn--primary" data-action="confirm-reschedule" disabled>Valider le nouveau créneau</button>
        </div>
      </div>
      `}
    </div>
  `;
}

function attachAppointmentActions(container) {
  container.querySelectorAll('.apt-card').forEach(card => {
    const id = card.dataset.id;

    const cancelBtn = card.querySelector('[data-action="cancel"]');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', async () => {
        if (!confirm('Annuler ce rendez-vous ?')) return;
        try {
          const data = await apiFetch(`/api/me/appointments/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ action: 'cancel' }),
          });
          if (!data.success) throw new Error(data.error || 'Erreur');
          loadAppointments();
        } catch (e) {
          alert('Erreur : ' + e.message);
        }
      });
    }

    const rescheduleBtn = card.querySelector('[data-action="reschedule"]');
    if (rescheduleBtn) {
      rescheduleBtn.addEventListener('click', () => {
        const box = card.querySelector(`#reschedule-${id}`);
        const isActive = box.classList.toggle('active');
        if (isActive) initRescheduleCalendar(card, id);
      });
    }

    const cancelRescheduleBtn = card.querySelector('[data-action="cancel-reschedule"]');
    if (cancelRescheduleBtn) {
      cancelRescheduleBtn.addEventListener('click', () => {
        card.querySelector(`#reschedule-${id}`).classList.remove('active');
      });
    }
  });
}

function initRescheduleCalendar(card, id) {
  const now = new Date(getParisDateString() + 'T00:00:00');
  let month = now.getMonth();
  let year = now.getFullYear();
  let selectedDate = null;
  let selectedTime = null;

  const calEl = card.querySelector(`#cal-${id}`);
  const titleEl = calEl.querySelector('.booking-calendar__title');
  const daysEl = calEl.querySelector('.booking-calendar__days');
  const prevBtn = calEl.querySelector('[data-nav="prev"]');
  const nextBtn = calEl.querySelector('[data-nav="next"]');
  const slotsEl = card.querySelector(`#reschedule-${id} .booking-slots`);
  const errorEl = card.querySelector(`#reschedule-${id} .account-error`);
  const confirmBtn = card.querySelector('[data-action="confirm-reschedule"]');

  function render() {
    const monthDate = new Date(year, month, 1);
    titleEl.textContent = monthDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

    const todayStr = getParisDateString();
    const todayDate = new Date(todayStr + 'T00:00:00');
    prevBtn.disabled = (year === todayDate.getFullYear() && month === todayDate.getMonth());

    const firstDayIndex = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    daysEl.innerHTML = '';
    for (let i = 0; i < firstDayIndex; i++) {
      const empty = document.createElement('span');
      empty.className = 'booking-calendar__day empty';
      daysEl.appendChild(empty);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = date.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isPast = dateStr < todayStr;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'booking-calendar__day';
      btn.textContent = d;

      if (isWeekend || isPast) {
        btn.classList.add('disabled');
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
      } else {
        btn.addEventListener('click', () => {
          daysEl.querySelectorAll('.booking-calendar__day').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          selectedDate = dateStr;
          selectedTime = null;
          confirmBtn.disabled = true;
          loadRescheduleSlots(dateStr);
        });
      }

      if (dateStr === selectedDate) btn.classList.add('active');
      daysEl.appendChild(btn);
    }
  }

  async function loadRescheduleSlots(date) {
    slotsEl.innerHTML = '<p class="booking-hint">Chargement des créneaux...</p>';
    try {
      const res = await fetch(`${BOOKING_API}/api/availability?date=${date}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Erreur');

      let slots = data.slots;
      if (date === getParisDateString()) {
        const nowTime = getParisTimeString();
        slots = slots.filter(s => s > nowTime);
      }

      if (slots.length === 0) {
        slotsEl.innerHTML = '<p class="booking-hint">Aucun créneau disponible ce jour-là.</p>';
        return;
      }

      slotsEl.innerHTML = '';
      slots.forEach(slot => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'booking-slot';
        btn.textContent = slot;
        btn.addEventListener('click', () => {
          slotsEl.querySelectorAll('.booking-slot').forEach(s => s.classList.remove('active'));
          btn.classList.add('active');
          selectedTime = slot;
          confirmBtn.disabled = false;
        });
        slotsEl.appendChild(btn);
      });
    } catch (e) {
      slotsEl.innerHTML = '<p class="booking-hint">Impossible de charger les créneaux.</p>';
    }
  }

  prevBtn.addEventListener('click', () => {
    month--;
    if (month < 0) { month = 11; year--; }
    render();
  });
  nextBtn.addEventListener('click', () => {
    month++;
    if (month > 11) { month = 0; year++; }
    render();
  });

  confirmBtn.addEventListener('click', async () => {
    errorEl.style.display = 'none';
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Validation...';
    try {
      const data = await apiFetch(`/api/me/appointments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ date: selectedDate, time: selectedTime }),
      });
      if (!data.success) throw new Error(data.error || 'Erreur');
      loadAppointments();
    } catch (e) {
      errorEl.textContent = 'Erreur : ' + e.message;
      errorEl.style.display = 'block';
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Valider le nouveau créneau';
    }
  });

  render();
}

/* ===== Prendre rendez-vous ===== */

function resetBooking() {
  bookingState.step = 1;
  bookingState.service = null;
  bookingState.date = null;
  bookingState.time = null;
  document.querySelectorAll('.booking-service-card').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.booking-calendar__day').forEach(d => d.classList.remove('active'));
  document.getElementById('bookingSlots').innerHTML = '<p class="booking-hint">Sélectionnez une date pour voir les créneaux disponibles.</p>';
  document.getElementById('bookingNotes').value = '';
  document.getElementById('bookingSuccess').style.display = 'none';
  document.getElementById('bookingError').style.display = 'none';
  const confirmBtn = document.getElementById('bookingConfirmBtn');
  confirmBtn.disabled = false;
  confirmBtn.textContent = 'Confirmer le rendez-vous';
  goToStep(1);
}

function renderServices() {
  const container = document.getElementById('bookingServices');
  container.innerHTML = '';
  SERVICES.forEach(service => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'booking-service-card';
    card.innerHTML = `<span class="booking-service-name">${service.name}</span>
      <span class="booking-service-meta">${service.duration} min · ${service.price}</span>`;
    card.addEventListener('click', () => {
      document.querySelectorAll('.booking-service-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      bookingState.service = service;
      updateNextButton();
    });
    container.appendChild(card);
  });
}

function initCalendar() {
  const now = new Date(getParisDateString() + 'T00:00:00');
  calendarMonth = now.getMonth();
  calendarYear = now.getFullYear();

  document.getElementById('bookingCalPrev').addEventListener('click', () => {
    calendarMonth--;
    if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
    renderCalendar();
  });
  document.getElementById('bookingCalNext').addEventListener('click', () => {
    calendarMonth++;
    if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
    renderCalendar();
  });

  renderCalendar();
}

function renderCalendar() {
  const title = document.getElementById('bookingCalTitle');
  const daysContainer = document.getElementById('bookingCalDays');
  const prevBtn = document.getElementById('bookingCalPrev');

  const monthDate = new Date(calendarYear, calendarMonth, 1);
  title.textContent = monthDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  const todayStr = getParisDateString();
  const todayDate = new Date(todayStr + 'T00:00:00');
  prevBtn.disabled = (calendarYear === todayDate.getFullYear() && calendarMonth === todayDate.getMonth());

  const firstDayIndex = (new Date(calendarYear, calendarMonth, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();

  daysContainer.innerHTML = '';

  for (let i = 0; i < firstDayIndex; i++) {
    const empty = document.createElement('span');
    empty.className = 'booking-calendar__day empty';
    daysContainer.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(calendarYear, calendarMonth, d);
    const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isPast = dateStr < todayStr;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'booking-calendar__day';
    btn.textContent = d;

    if (isWeekend || isPast) {
      btn.classList.add('disabled');
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
    } else {
      btn.addEventListener('click', () => selectDate(dateStr, btn));
    }

    if (dateStr === bookingState.date) btn.classList.add('active');

    daysContainer.appendChild(btn);
  }
}

function selectDate(dateStr, btn) {
  document.querySelectorAll('#bookingCalDays .booking-calendar__day').forEach(d => d.classList.remove('active'));
  btn.classList.add('active');
  bookingState.date = dateStr;
  bookingState.time = null;
  loadSlots(dateStr);
  updateNextButton();
}

async function loadSlots(date) {
  const container = document.getElementById('bookingSlots');
  container.innerHTML = '<p class="booking-hint">Chargement des créneaux...</p>';
  try {
    const res = await fetch(`${BOOKING_API}/api/availability?date=${date}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Erreur');

    let slots = data.slots;
    if (date === getParisDateString()) {
      const nowTime = getParisTimeString();
      slots = slots.filter(slot => slot > nowTime);
    }

    if (slots.length === 0) {
      container.innerHTML = '<p class="booking-hint">Aucun créneau disponible ce jour-là (institut ouvert du lundi au vendredi, 7h-20h).</p>';
      return;
    }

    container.innerHTML = '';
    slots.forEach(slot => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'booking-slot';
      btn.textContent = slot;
      btn.addEventListener('click', () => {
        document.querySelectorAll('#bookingSlots .booking-slot').forEach(s => s.classList.remove('active'));
        btn.classList.add('active');
        bookingState.time = slot;
        updateNextButton();
      });
      container.appendChild(btn);
    });
  } catch (e) {
    container.innerHTML = '<p class="booking-hint">Impossible de charger les créneaux. Réessayez plus tard.</p>';
  }
}

function goToStep(step) {
  if (step < 1 || step > 3) return;
  bookingState.step = step;

  document.querySelectorAll('#viewBooking .booking-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`#viewBooking .booking-panel[data-step="${step}"]`).classList.add('active');

  document.querySelectorAll('#viewBooking .booking-step-dot').forEach(dot => {
    dot.classList.toggle('active', Number(dot.dataset.step) <= step);
  });

  document.getElementById('bookingPrevBtn').style.display = step > 1 ? 'inline-block' : 'none';
  document.getElementById('bookingNextBtn').style.display = step < 3 ? 'inline-block' : 'none';
  document.getElementById('bookingConfirmBtn').style.display = step === 3 ? 'inline-block' : 'none';

  updateNextButton();
}

function updateNextButton() {
  const nextBtn = document.getElementById('bookingNextBtn');
  let valid = true;
  if (bookingState.step === 1) valid = !!bookingState.service;
  if (bookingState.step === 2) valid = !!(bookingState.date && bookingState.time);
  nextBtn.disabled = !valid;
}

function renderSummary() {
  const container = document.getElementById('bookingSummary');
  container.innerHTML = `
    <div class="summary-row"><strong>Prestation :</strong> ${bookingState.service.name}</div>
    <div class="summary-row"><strong>Durée :</strong> ${bookingState.service.duration} min — ${bookingState.service.price}</div>
    <div class="summary-row"><strong>Date :</strong> ${formatDate(bookingState.date)}</div>
    <div class="summary-row"><strong>Heure :</strong> ${bookingState.time}</div>
    <div class="summary-row"><strong>Nom :</strong> ${escapeHtml(currentClient.name)}</div>
    <div class="summary-row"><strong>Téléphone :</strong> ${escapeHtml(currentClient.phone)}</div>
  `;
}

async function submitBooking() {
  const confirmBtn = document.getElementById('bookingConfirmBtn');
  const successEl = document.getElementById('bookingSuccess');
  const errorEl = document.getElementById('bookingError');
  errorEl.style.display = 'none';

  if (!currentClient.phone) {
    errorEl.textContent = '❌ Merci de renseigner votre numéro de téléphone dans l\'onglet "Mon profil" avant de réserver.';
    errorEl.style.display = 'block';
    return;
  }

  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Envoi en cours...';

  try {
    const data = await apiFetch('/api/me/appointments', {
      method: 'POST',
      body: JSON.stringify({
        service: bookingState.service.name,
        category: 'thermolyse',
        date: bookingState.date,
        time: bookingState.time,
        duration: bookingState.service.duration,
        notes: document.getElementById('bookingNotes').value.trim(),
      }),
    });
    if (!data.success) throw new Error(data.error || 'Erreur lors de l\'envoi');

    successEl.style.display = 'block';
    confirmBtn.style.display = 'none';
    document.getElementById('bookingPrevBtn').style.display = 'none';
  } catch (e) {
    errorEl.textContent = '❌ ' + e.message;
    errorEl.style.display = 'block';
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirmer le rendez-vous';
  }
}
