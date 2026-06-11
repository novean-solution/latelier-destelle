document.getElementById('year').textContent = new Date().getFullYear();

// Mobile nav toggle
const burger = document.getElementById('burger');
const nav = document.getElementById('nav');
burger.addEventListener('click', () => {
  nav.classList.toggle('open');
});
nav.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => nav.classList.remove('open'));
});

// Tabs
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tab-panel');
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    panels.forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector(`.tab-panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
  });
});

// Popup de prise de rendez-vous
const rdvModal = document.getElementById('rendezvous');
if (rdvModal) {
  document.querySelectorAll('.rdv-trigger').forEach(trigger => {
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      rdvModal.classList.add('open');
      document.body.classList.add('rdv-modal-open');
      nav.classList.remove('open');
    });
  });
  rdvModal.querySelectorAll('[data-rdv-close]').forEach(el => {
    el.addEventListener('click', () => {
      rdvModal.classList.remove('open');
      document.body.classList.remove('rdv-modal-open');
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && rdvModal.classList.contains('open')) {
      rdvModal.classList.remove('open');
      document.body.classList.remove('rdv-modal-open');
    }
  });
}

// Header shadow on scroll
const header = document.getElementById('header');
window.addEventListener('scroll', () => {
  header.style.boxShadow = window.scrollY > 10 ? '0 2px 12px rgba(0,0,0,0.06)' : 'none';
});
