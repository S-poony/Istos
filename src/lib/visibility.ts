import { VISIBILITY_MARGIN } from "./constants";

/// Loading only what the user can actually see.
///
/// A card used to start its work the moment it was created: fetch the text,
/// parse the PDF, decode the image, attach a `<video>`. That is fine for a
/// folder of twelve photos and ruinous for a directory of five thousand files,
/// most of which are several screens away and many of which the user will never
/// scroll to.
///
/// One observer serves the whole app. Creating an observer per card would trade
/// one per-entity cost for another.

/// Whether the environment can tell us what is on screen. JSDOM cannot, and a
/// test that renders a card still expects to see its contents — so when we
/// cannot observe, everything counts as visible. Guessing "hidden" would hide
/// content from a real browser that lacked the API too, which is the worse
/// failure of the two.
export const canObserveVisibility =
  typeof IntersectionObserver !== "undefined";

let observer: IntersectionObserver | null = null;
const pending = new Map<Element, () => void>();

function ensureObserver(): IntersectionObserver | null {
  if (!canObserveVisibility) return null;
  if (observer) return observer;

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const notify = pending.get(entry.target);
        if (!notify) continue;
        /// Unobserve before notifying: this fires once per element and never
        /// again, so a card that has loaded stays loaded even after it scrolls
        /// away or its view is hidden. Unloading on exit would mean navigating
        /// back re-fetched everything, which is the cost this whole mechanism
        /// exists to avoid.
        pending.delete(entry.target);
        observer?.unobserve(entry.target);
        notify();
      }
    },
    { rootMargin: VISIBILITY_MARGIN }
  );
  return observer;
}

/// Svelte action: calls `onVisible` the first time the node comes near the
/// viewport, and never again.
export function revealOnce(node: HTMLElement, onVisible: () => void) {
  const active = ensureObserver();
  if (!active) {
    onVisible();
    return {};
  }

  pending.set(node, onVisible);
  active.observe(node);

  return {
    destroy() {
      pending.delete(node);
      active.unobserve(node);
    },
  };
}

/// Test seam: drops the shared observer so state does not leak between cases.
export function __resetVisibility(): void {
  observer?.disconnect();
  observer = null;
  pending.clear();
}
