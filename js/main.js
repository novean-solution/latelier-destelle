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

// Slider galerie
const galleryTrack = document.getElementById('galleryTrack');
if (galleryTrack) {
  const slides = Array.from(galleryTrack.querySelectorAll('.gallery-slide'));
  const dotsContainer = document.getElementById('galleryDots');
  const prevBtn = document.querySelector('.gallery-slider__nav--prev');
  const nextBtn = document.querySelector('.gallery-slider__nav--next');

  slides.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.setAttribute('aria-label', `Aller à l'image ${i + 1}`);
    if (i === 0) dot.classList.add('active');
    dot.addEventListener('click', () => slides[i].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }));
    dotsContainer.appendChild(dot);
  });
  const dots = Array.from(dotsContainer.children);

  const scrollByOne = (dir) => {
    const slide = slides[0];
    const gap = parseFloat(getComputedStyle(galleryTrack).gap) || 0;
    galleryTrack.scrollBy({ left: dir * (slide.offsetWidth + gap), behavior: 'smooth' });
  };
  prevBtn.addEventListener('click', () => scrollByOne(-1));
  nextBtn.addEventListener('click', () => scrollByOne(1));

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const index = slides.indexOf(entry.target);
        dots.forEach(d => d.classList.remove('active'));
        dots[index].classList.add('active');
      }
    });
  }, { root: galleryTrack, threshold: 0.6 });
  slides.forEach(slide => observer.observe(slide));
}

// Header shadow on scroll
const header = document.getElementById('header');
window.addEventListener('scroll', () => {
  header.style.boxShadow = window.scrollY > 10 ? '0 2px 12px rgba(0,0,0,0.06)' : 'none';
});
