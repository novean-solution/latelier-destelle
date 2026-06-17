// PWA Administration — service worker + aide à l'installation
// Instructions SÉPARÉES et claires selon l'appareil (iPhone / Android / ordinateur).
(function () {
  // 1) Service worker (mises à jour à distance + hors-ligne)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  // Déjà installée (lancée en plein écran) ? On n'affiche aucune aide.
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) return;

  var ua = navigator.userAgent;
  var isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document);
  var isAndroid = /Android/.test(ua);
  var platform = isIOS ? 'ios' : (isAndroid ? 'android' : 'desktop');

  // Capture l'invite native Android/Chrome
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredPrompt = e; });

  var ROSE = '#b06f86';

  function el(tag, css, html) {
    var n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (html != null) n.innerHTML = html;
    return n;
  }

  // --- Bouton flottant déclencheur ---
  function injectFab() {
    if (document.getElementById('pwaInstallFab')) return;
    var fab = el('button', 'position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:9998;background:linear-gradient(135deg,#c98ba0,' + ROSE + ');color:#fff;border:none;border-radius:999px;padding:.7rem 1.3rem;font-family:Poppins,system-ui,sans-serif;font-weight:600;font-size:.92rem;box-shadow:0 8px 24px rgba(176,111,134,.4);cursor:pointer;', '📲 Installer l\'application');
    fab.type = 'button';
    fab.id = 'pwaInstallFab';
    fab.addEventListener('click', openModal);
    document.body.appendChild(fab);
  }

  // --- Contenu d'instructions par plateforme ---
  function contentIOS() {
    return '<div style="text-align:center;font-size:2rem;margin-bottom:.3rem">📱</div>' +
      '<h3 style="font-family:\'Cormorant Garamond\',serif;color:#3a2c2e;font-size:1.5rem;margin:0 0 .9rem;text-align:center">Installer sur iPhone / iPad</h3>' +
      '<ol style="margin:0;padding-left:1.2rem;line-height:1.7;color:#5a4d4f">' +
      '<li>En bas de l\'écran (dans <strong>Safari</strong>), touchez le bouton <strong>Partager</strong> <span style="display:inline-block;border:1px solid #c98ba0;border-radius:5px;padding:0 5px;color:' + ROSE + '">⬆️</span></li>' +
      '<li>Faites défiler la liste, puis touchez <strong>« Sur l\'écran d\'accueil »</strong></li>' +
      '<li>Touchez <strong>« Ajouter »</strong> en haut à droite</li>' +
      '</ol>' +
      '<p style="margin:1rem 0 0;padding:.6rem .8rem;background:#fbeede;border-radius:10px;color:#9a6a2a;font-size:.85rem">⚠️ À faire depuis <strong>Safari</strong> (l\'installation ne marche pas depuis Chrome sur iPhone).</p>';
  }

  function contentAndroid() {
    var html = '<div style="text-align:center;font-size:2rem;margin-bottom:.3rem">🤖</div>' +
      '<h3 style="font-family:\'Cormorant Garamond\',serif;color:#3a2c2e;font-size:1.5rem;margin:0 0 .9rem;text-align:center">Installer sur Android</h3>';
    if (deferredPrompt) {
      html += '<p style="text-align:center;color:#5a4d4f;margin:0 0 1rem">Appuyez sur le bouton ci-dessous, puis confirmez « Installer ».</p>' +
        '<button id="pwaDoInstall" style="display:block;width:100%;background:linear-gradient(135deg,#c98ba0,' + ROSE + ');color:#fff;border:none;border-radius:999px;padding:.85rem;font-family:inherit;font-weight:600;font-size:1rem;cursor:pointer">Installer maintenant</button>';
    } else {
      html += '<ol style="margin:0;padding-left:1.2rem;line-height:1.7;color:#5a4d4f">' +
        '<li>Touchez le menu <strong>⋮</strong> (en haut à droite de Chrome)</li>' +
        '<li>Touchez <strong>« Installer l\'application »</strong> (ou « Ajouter à l\'écran d\'accueil »)</li>' +
        '<li>Confirmez avec <strong>« Installer »</strong></li>' +
        '</ol>';
    }
    return html;
  }

  function contentDesktop() {
    return '<div style="text-align:center;font-size:2rem;margin-bottom:.3rem">💻</div>' +
      '<h3 style="font-family:\'Cormorant Garamond\',serif;color:#3a2c2e;font-size:1.5rem;margin:0 0 .9rem;text-align:center">Installer sur ordinateur</h3>' +
      '<ol style="margin:0;padding-left:1.2rem;line-height:1.7;color:#5a4d4f">' +
      '<li>Dans la barre d\'adresse, cliquez sur l\'icône <strong>d\'installation</strong> (⊕ ou un petit écran)</li>' +
      '<li>Ou : menu du navigateur → <strong>« Installer L\'Atelier d\'Estelle… »</strong></li>' +
      '<li>Confirmez avec <strong>« Installer »</strong></li>' +
      '</ol>';
  }

  function openModal() {
    if (document.getElementById('pwaModal')) return;
    var overlay = el('div', 'position:fixed;inset:0;z-index:10000;background:rgba(58,44,46,.55);display:flex;align-items:center;justify-content:center;padding:1rem;font-family:Poppins,system-ui,sans-serif');
    overlay.id = 'pwaModal';
    var body = platform === 'ios' ? contentIOS() : (platform === 'android' ? contentAndroid() : contentDesktop());
    var card = el('div', 'background:#fff;border-radius:20px;max-width:420px;width:100%;padding:1.6rem 1.5rem;box-shadow:0 20px 60px rgba(58,44,46,.3);position:relative',
      '<button id="pwaClose" aria-label="Fermer" style="position:absolute;top:.6rem;right:.8rem;background:none;border:none;font-size:1.6rem;line-height:1;color:#b06f86;cursor:pointer">×</button>' + body);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    function close() { overlay.remove(); }
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    card.querySelector('#pwaClose').addEventListener('click', close);

    var doInstall = card.querySelector('#pwaDoInstall');
    if (doInstall) doInstall.addEventListener('click', function () {
      close();
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(function () { deferredPrompt = null; });
    });
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', injectFab);
  } else {
    injectFab();
  }
})();
