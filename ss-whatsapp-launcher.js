/* SS Branded Outlet — shared WhatsApp inbox launcher.
   Include once in each app page (or in the common page template).
   No keys/tokens are read or embedded in the frontend. */
(() => {
  'use strict';
  if (window.__ssWhatsappLauncherInstalled) return;
  window.__ssWhatsappLauncherInstalled = true;

  const INBOX_URL = 'https://zcypn1azem.c39.airoapp.ai/api/whatsapp/inbox';
  const ROOT_ID = 'ss-whatsapp-launcher';
  const CSS_ID = 'ss-whatsapp-launcher-style';

  function install() {
    if (document.getElementById(ROOT_ID)) return;
    const style = document.createElement('style');
    style.id = CSS_ID;
    style.textContent = `
      #${ROOT_ID} { position:fixed; right:20px; bottom:20px; z-index:2147483000; font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif; }
      #${ROOT_ID} a { width:58px; height:58px; border-radius:50%; background:#107c53; color:#fff; box-shadow:0 5px 18px rgba(0,0,0,.24); display:flex; align-items:center; justify-content:center; text-decoration:none; transition:transform .15s,background .15s; }
      #${ROOT_ID} a:hover { transform:translateY(-2px); background:#0d6644; }
      #${ROOT_ID} a:focus-visible { outline:3px solid #203cfa; outline-offset:3px; }
      #${ROOT_ID} svg { width:28px; height:28px; stroke:currentColor; stroke-width:2; fill:none; stroke-linecap:round; stroke-linejoin:round; }
      @media(max-width:600px) { #${ROOT_ID} { right:14px; bottom:14px; } #${ROOT_ID} a { width:52px; height:52px; } }
      @media print { #${ROOT_ID} { display:none!important; } }
    `;
    document.head.appendChild(style);
    const root = document.createElement('div');
    root.id = ROOT_ID;
    const link = document.createElement('a');
    link.href = INBOX_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', 'Open SS Branded Outlet WhatsApp staff inbox in a new tab');
    link.title = 'WhatsApp Customer Service';
    link.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.5a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.6-4.4A8.5 8.5 0 1 1 20.5 11.5Z"/><path d="M8.4 8.4c.4 3 3 5.7 6.2 6.6l1.5-1.5-2.1-1.2-1 1c-1.1-.5-2.2-1.6-2.7-2.7l1-1-1.2-2.1-1.7.9Z"/></svg>`;
    root.appendChild(link);
    document.body.appendChild(root);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once:true});
  else install();
})();
