// Tap-to-toggle tooltips for touch / hover-less devices.
// Desktop hover behavior stays in CSS (:hover::after).
// On touch, hover doesn't fire reliably, so we toggle a .tooltip-open class on tap.

let openTooltip = null;
let setupComplete = false;

export function setupTooltips() {
  if (setupComplete) return;
  setupComplete = true;

  // Only wire tap-toggle on devices where hover is unreliable.
  // matchMedia('(hover: hover)') === true on a precision pointer (mouse/trackpad).
  if (matchMedia('(hover: hover)').matches) return;

  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-tooltip]');

    // Close any open tooltip if we're tapping elsewhere (or on a different trigger)
    if (openTooltip && openTooltip !== trigger) {
      openTooltip.classList.remove('tooltip-open');
      openTooltip = null;
    }

    if (trigger) {
      if (trigger === openTooltip) {
        // Tapping the same trigger again closes it
        trigger.classList.remove('tooltip-open');
        openTooltip = null;
      } else {
        trigger.classList.add('tooltip-open');
        openTooltip = trigger;
        e.stopPropagation();
      }
    }
  });

  // Closing on scroll feels right on touch (hovering tooltips while scrolling is annoying)
  document.addEventListener('scroll', () => {
    if (openTooltip) {
      openTooltip.classList.remove('tooltip-open');
      openTooltip = null;
    }
  }, { passive: true, capture: true });
}
