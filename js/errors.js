let hideTimer = null;

function getEls() {
  return {
    banner: document.getElementById('error-banner'),
    message: document.getElementById('error-banner-message'),
    closeBtn: document.getElementById('error-banner-close'),
  };
}

export function showError(msg, { sticky = false } = {}) {
  const { banner, message } = getEls();
  if (!banner || !message) return;
  message.textContent = msg;
  banner.hidden = false;
  if (hideTimer) clearTimeout(hideTimer);
  if (!sticky) hideTimer = setTimeout(() => { banner.hidden = true; }, 8000);
}

export function hideError() {
  const { banner } = getEls();
  if (banner) banner.hidden = true;
}

export function setupErrorBoundary() {
  const { closeBtn } = getEls();
  closeBtn?.addEventListener('click', hideError);

  window.addEventListener('error', (e) => {
    if (e.message) showError(`Error: ${e.message}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason?.message || (typeof e.reason === 'string' ? e.reason : 'promise rejection');
    showError(`Error: ${msg}`);
  });
}
