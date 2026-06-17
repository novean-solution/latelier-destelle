// PWA Administration — enregistrement + aide à l'installation (Android & iPhone)
(function () {
  // 1) Enregistrement du service worker (mises à jour à distance)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  // Déjà installée (lancée en plein écran) ? On n'affiche aucune invite.
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) return;
  if (localStorage.getItem('pwaInstallDismissed') === '1') return;

  function banner(html) {
    var b = document.createElement('div');
    b.id = 'pwaInstallBanner';
    b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;background:#fff;color:#3a2c2e;border:1px solid rgba(58,44,46,.12);border-radius:16px;box-shadow:0 12px 32px rgba(58,44,46,.18);padding:14px 16px;font-family:Poppins,system-ui,sans-serif;font-size:.9rem;display:flex;align-items:center;gap:12px;max-width:520px;margin:0 auto;';
    b.innerHTML = html;
    document.body.appendChild(b);
    var close = b.querySelector('[data-pwa-close]');
    if (close) close.addEventListener('click', function () {
      b.remove();
      localStorage.setItem('pwaInstallDismissed', '1');
    });
    return b;
  }

  var btnStyle = 'background:linear-gradient(135deg,#c98ba0,#b06f86);color:#fff;border:none;border-radius:999px;padding:.6rem 1.1rem;font-weight:600;font-family:inherit;cursor:pointer;white-space:nowrap;';
  var closeStyle = 'background:none;border:none;color:#b06f86;font-size:1.4rem;line-height:1;cursor:pointer;padding:0 .2rem;';

  // 2) Android / Chrome : invite d'installation native
  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    var b = banner('<span style="flex:1">📲 Installez l\'appli <strong>Atelier Admin</strong> sur votre écran d\'accueil.</span>' +
      '<button id="pwaInstallBtn" style="' + btnStyle + '">Installer</button>' +
      '<button data-pwa-close aria-label="Fermer" style="' + closeStyle + '">×</button>');
    b.querySelector('#pwaInstallBtn').addEventListener('click', function () {
      b.remove();
      deferred.prompt();
      deferred.userChoice.finally(function () { deferred = null; });
    });
  });

  // 3) iPhone / iPad (Safari) : pas d'invite auto → on explique le geste
  var ua = window.navigator.userAgent;
  var isIOS = /iPhone|iPad|iPod/.test(ua) && !window.MSStream;
  var isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  if (isIOS && isSafari) {
    window.addEventListener('load', function () {
      banner('<span style="flex:1">📲 Pour installer l\'appli : appuyez sur <strong>Partager</strong> ' +
        '<span aria-hidden="true">⬆️</span> puis <strong>« Sur l\'écran d\'accueil »</strong>.</span>' +
        '<button data-pwa-close aria-label="Fermer" style="' + closeStyle + '">×</button>');
    });
  }
})();
