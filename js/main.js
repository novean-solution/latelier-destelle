// L'atelier d'Estelle — interactions de la page d'accueil

const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// Preloader
const preloader = document.getElementById('preloader');
if (preloader) {
  window.addEventListener('load', () => preloader.classList.add('loaded'));
  // Filet de sécurité : ne jamais rester bloqué sur le préchargeur
  setTimeout(() => preloader.classList.add('loaded'), 4000);
}

// Barre de progression de scroll
const scrollProgress = document.getElementById('scrollProgress');
function updateScrollProgress() {
  if (!scrollProgress) return;
  const scrollTop = window.scrollY;
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
  scrollProgress.style.width = progress + '%';
}
if (scrollProgress) {
  window.addEventListener('scroll', updateScrollProgress);
  updateScrollProgress();
}

// Menu mobile
const burger = document.getElementById('burger');
const nav = document.getElementById('nav');
if (burger && nav) {
  burger.setAttribute('aria-expanded', 'false');
  burger.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    burger.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    nav.classList.remove('open');
    burger.classList.remove('open');
    burger.setAttribute('aria-expanded', 'false');
  }));
}

// Popup de prise de rendez-vous
const rdvModal = document.getElementById('rendezvous');
if (rdvModal) {
  const closeRdv = () => {
    rdvModal.classList.remove('open');
    document.body.classList.remove('rdv-modal-open');
  };
  document.querySelectorAll('.rdv-trigger').forEach(trigger => {
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      // Repart d'un formulaire vierge si une réservation vient d'être confirmée
      if (window.__bookingDone && typeof window.resetBooking === 'function') {
        window.resetBooking();
        window.__bookingDone = false;
      }
      rdvModal.classList.add('open');
      document.body.classList.add('rdv-modal-open');
      if (nav) nav.classList.remove('open');
    });
  });
  rdvModal.querySelectorAll('[data-rdv-close]').forEach(el => el.addEventListener('click', closeRdv));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && rdvModal.classList.contains('open')) closeRdv();
  });
}

// Slider galerie
const galleryTrack = document.getElementById('galleryTrack');
if (galleryTrack) {
  const slides = Array.from(galleryTrack.querySelectorAll('.gallery-slide'));
  const dotsContainer = document.getElementById('galleryDots');
  const prevBtn = document.querySelector('.gallery-slider__nav--prev');
  const nextBtn = document.querySelector('.gallery-slider__nav--next');

  if (dotsContainer) {
    slides.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.setAttribute('aria-label', `Aller à l'image ${i + 1}`);
      if (i === 0) dot.classList.add('active');
      dot.addEventListener('click', () => slides[i].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }));
      dotsContainer.appendChild(dot);
    });
  }
  const dots = dotsContainer ? Array.from(dotsContainer.children) : [];

  const scrollByOne = (dir) => {
    const slide = slides[0];
    if (!slide) return;
    const gap = parseFloat(getComputedStyle(galleryTrack).gap) || 0;
    galleryTrack.scrollBy({ left: dir * (slide.offsetWidth + gap), behavior: 'smooth' });
  };
  if (prevBtn) prevBtn.addEventListener('click', () => scrollByOne(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => scrollByOne(1));

  // Glisser-déposer à la souris (desktop)
  let isDown = false;
  let dragged = false;
  let startX = 0;
  let scrollStart = 0;
  galleryTrack.addEventListener('mousedown', (e) => {
    isDown = true;
    dragged = false;
    galleryTrack.classList.add('dragging');
    startX = e.pageX;
    scrollStart = galleryTrack.scrollLeft;
  });
  window.addEventListener('mouseup', () => {
    isDown = false;
    galleryTrack.classList.remove('dragging');
  });
  galleryTrack.addEventListener('mouseleave', () => {
    isDown = false;
    galleryTrack.classList.remove('dragging');
  });
  galleryTrack.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    const delta = e.pageX - startX;
    if (Math.abs(delta) > 5) dragged = true;
    galleryTrack.scrollLeft = scrollStart - delta;
  });
  galleryTrack.querySelectorAll('a, img').forEach(el => {
    el.addEventListener('click', (e) => { if (dragged) e.preventDefault(); });
    el.addEventListener('dragstart', (e) => e.preventDefault());
  });

  if (dots.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const index = slides.indexOf(entry.target);
          if (index < 0 || !dots[index]) return;
          dots.forEach(d => d.classList.remove('active'));
          dots[index].classList.add('active');
        }
      });
    }, { root: galleryTrack, threshold: 0.6 });
    slides.forEach(slide => observer.observe(slide));
  }
}

// Ombre du header au scroll
const header = document.getElementById('header');
if (header) {
  window.addEventListener('scroll', () => {
    header.style.boxShadow = window.scrollY > 10 ? '0 2px 12px rgba(0,0,0,0.06)' : 'none';
  });
}
