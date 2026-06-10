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

  const dateInput = document.getElementById('bookingDate');
  const today = new Date().toISOString().split('T')[0];
  dateInput.setAttribute('min', today);
  dateInput.addEventListener('change', () => {
    bookingState.date = dateInput.value;
    bookingState.time = null;
    loadSlots(dateInput.value);
    updateNextButton();
  });

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

  ['bookingName', 'bookingPhone'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateNextButton);
  });
});

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

async function loadSlots(date) {
  const container = document.getElementById('bookingSlots');
  container.innerHTML = '<p class="booking-hint">Chargement des créneaux...</p>';
  try {
    const res = await fetch(`${BOOKING_API}/api/availability?date=${date}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Erreur');

    if (data.slots.length === 0) {
      container.innerHTML = '<p class="booking-hint">Aucun créneau disponible ce jour-là (institut ouvert du lundi au vendredi).</p>';
      return;
    }

    container.innerHTML = '';
    data.slots.forEach(slot => {
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
  if (bookingState.step === 3) valid = !!(document.getElementById('bookingName').value.trim() && document.getElementById('bookingPhone').value.trim());
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
