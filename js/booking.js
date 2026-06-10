// Système de prise de rendez-vous - L'atelier d'Estelle
const BOOKING_API = 'https://latelier-destelle-api.contactnovean.workers.dev';

const SERVICES = {
  onglerie: [
    { name: 'Manucure - Rallongement', duration: 90, price: '65 €' },
    { name: 'Manucure - Remplissage gel/renfort', duration: 75, price: '55 €' },
    { name: 'Manucure - Semi permanent', duration: 60, price: '40 €' },
    { name: 'Pédicure - Semi permanent', duration: 60, price: '40 €' },
    { name: 'Formule semi permanent mains + pieds', duration: 90, price: '65 €' },
    { name: 'Formule gel/renfort + semi permanent pieds', duration: 105, price: '80 €' },
  ],
  thermolyse: [
    { name: 'Rendez-vous d\'informations', duration: 30, price: '20 €' },
    { name: 'Séance de 15 minutes', duration: 30, price: '40 €' },
    { name: 'Séance de 30 minutes', duration: 30, price: '70 €' },
    { name: 'Séance de 45 minutes', duration: 60, price: '100 €' },
    { name: 'Séance de 1h00', duration: 60, price: '130 €' },
    { name: 'Séance de 1h30', duration: 90, price: '180 €' },
    { name: 'Séance de 2h00', duration: 120, price: '230 €' },
  ],
};

const bookingState = {
  step: 1,
  category: 'onglerie',
  service: null,
  date: null,
  time: null,
};

document.addEventListener('DOMContentLoaded', () => {
  const section = document.getElementById('rendezvous');
  if (!section) return;

  renderServices('onglerie');

  document.querySelectorAll('.booking-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.booking-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      bookingState.category = tab.dataset.cat;
      bookingState.service = null;
      renderServices(tab.dataset.cat);
      updateNextButton();
    });
  });

  initCalendar();

  document.getElementById('bookingPrevBtn').addEventListener('click', () => goToStep(bookingState.step - 1));
  document.getElementById('bookingNextBtn').addEventListener('click', () => {
    if (bookingState.step === 3) {
      bookingState.name = document.getElementById('bookingName').value.trim();
      bookingState.phone = document.getElementById('bookingPhone').value.trim();
      bookingState.email = document.getElementById('bookingEmail').value.trim();
      bookingState.notes = document.getElementById('bookingNotes').value.trim();
      renderSummary();
    }
    goToStep(bookingState.step + 1);
  });
  document.getElementById('bookingConfirmBtn').addEventListener('click', submitBooking);

  document.getElementById('bookingName').addEventListener('input', updateNextButton);
  document.getElementById('bookingPhone').addEventListener('input', () => {
    validatePhone();
    updateNextButton();
  });
  document.getElementById('bookingEmail').addEventListener('input', () => {
    validateEmail();
    updateNextButton();
  });
});

const PHONE_REGEX = /^0[1-9](\s?\d{2}){4}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail() {
  const input = document.getElementById('bookingEmail');
  const error = document.getElementById('bookingEmailError');
  const value = input.value.trim();

  if (!value) {
    error.style.display = 'none';
    return true;
  }

  if (!EMAIL_REGEX.test(value)) {
    error.textContent = 'Adresse email invalide.';
    error.style.display = 'block';
    return false;
  }

  error.style.display = 'none';
  return true;
}

function validatePhone() {
  const input = document.getElementById('bookingPhone');
  const error = document.getElementById('bookingPhoneError');
  const value = input.value.trim();

  if (!value) {
    error.style.display = 'none';
    return false;
  }

  if (!PHONE_REGEX.test(value)) {
    error.textContent = 'Numéro invalide. Format attendu : 06 12 34 56 78';
    error.style.display = 'block';
    return false;
  }

  error.style.display = 'none';
  return true;
}

let calendarMonth, calendarYear;

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

  const firstDayIndex = (new Date(calendarYear, calendarMonth, 1).getDay() + 6) % 7; // lundi = 0
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
    const dayOfWeek = date.getDay(); // 0 = dimanche, 6 = samedi
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

    if (dateStr === bookingState.date) {
      btn.classList.add('active');
    }

    daysContainer.appendChild(btn);
  }
}

function selectDate(dateStr, btn) {
  document.querySelectorAll('.booking-calendar__day').forEach(d => d.classList.remove('active'));
  btn.classList.add('active');
  hideDateError();
  bookingState.date = dateStr;
  bookingState.time = null;
  loadSlots(dateStr);
  updateNextButton();
}

function renderServices(category) {
  const container = document.getElementById('bookingServices');
  container.innerHTML = '';
  SERVICES[category].forEach(service => {
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

function getParisDateString(date) {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date || new Date());
}

function getParisTimeString(date) {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(date || new Date());
}

function showDateError(message) {
  const el = document.getElementById('bookingDateError');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
}

function hideDateError() {
  const el = document.getElementById('bookingDateError');
  if (!el) return;
  el.style.display = 'none';
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
        document.querySelectorAll('.booking-slot').forEach(s => s.classList.remove('active'));
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
  if (step < 1 || step > 4) return;
  bookingState.step = step;

  document.querySelectorAll('.booking-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.booking-panel[data-step="${step}"]`).classList.add('active');

  document.querySelectorAll('.booking-step-dot').forEach(dot => {
    dot.classList.toggle('active', Number(dot.dataset.step) <= step);
  });

  document.getElementById('bookingPrevBtn').style.display = step > 1 ? 'inline-block' : 'none';
  document.getElementById('bookingNextBtn').style.display = step < 4 ? 'inline-block' : 'none';
  document.getElementById('bookingConfirmBtn').style.display = step === 4 ? 'inline-block' : 'none';

  updateNextButton();
}

function updateNextButton() {
  const nextBtn = document.getElementById('bookingNextBtn');
  let valid = true;
  if (bookingState.step === 1) valid = !!bookingState.service;
  if (bookingState.step === 2) valid = !!(bookingState.date && bookingState.time);
  if (bookingState.step === 3) {
    valid = !!(document.getElementById('bookingName').value.trim())
      && PHONE_REGEX.test(document.getElementById('bookingPhone').value.trim())
      && validateEmail();
  }
  nextBtn.disabled = !valid;
}

function renderSummary() {
  const container = document.getElementById('bookingSummary');
  container.innerHTML = `
    <div class="summary-row"><strong>Prestation :</strong> ${bookingState.service.name}</div>
    <div class="summary-row"><strong>Durée :</strong> ${bookingState.service.duration} min — ${bookingState.service.price}</div>
    <div class="summary-row"><strong>Date :</strong> ${formatDate(bookingState.date)}</div>
    <div class="summary-row"><strong>Heure :</strong> ${bookingState.time}</div>
    <div class="summary-row"><strong>Nom :</strong> ${bookingState.name}</div>
    <div class="summary-row"><strong>Téléphone :</strong> ${bookingState.phone}</div>
    ${bookingState.email ? `<div class="summary-row"><strong>Email :</strong> ${bookingState.email}</div>` : ''}
    ${bookingState.notes ? `<div class="summary-row"><strong>Message :</strong> ${bookingState.notes}</div>` : ''}
  `;
}

function formatDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

async function submitBooking() {
  const confirmBtn = document.getElementById('bookingConfirmBtn');
  const successEl = document.getElementById('bookingSuccess');
  const errorEl = document.getElementById('bookingError');
  errorEl.style.display = 'none';
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Envoi en cours...';

  try {
    const res = await fetch(`${BOOKING_API}/api/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: bookingState.service.name,
        category: bookingState.category,
        date: bookingState.date,
        time: bookingState.time,
        duration: bookingState.service.duration,
        clientName: bookingState.name,
        clientPhone: bookingState.phone,
        clientEmail: bookingState.email,
        notes: bookingState.notes,
      }),
    });
    const data = await res.json();
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
