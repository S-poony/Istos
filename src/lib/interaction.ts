/// Shared rules for "did the user mean to activate this card, or the control
/// inside it?".
///
/// Every card in the desktop is clickable: clicking one focuses that entity.
/// Cards also *contain* controls — a PDF's page buttons, an audio scrubber, a
/// link inside rendered markdown. Without a guard, one click both pages the PDF
/// and navigates into the card, which is never what the user asked for.

/// Elements that own their own activation. A click that lands on one of these
/// belongs to it, not to the card around it. `[data-interactive]` is the escape
/// hatch for a subtree that is interactive without being a form control (a
/// scrollable region, a canvas the user drags).
const INTERACTIVE_SELECTOR =
  'button, a[href], input, select, textarea, label, audio, video, summary, [role="button"], [role="link"], [role="textbox"], [contenteditable="true"], [data-interactive]';

/// Whether the event originated from a control inside the handler's element.
///
/// The walk stops at `currentTarget`, so a card never mistakes an ancestor for
/// one of its own controls — matching against the whole document with
/// `closest()` would do exactly that once cards are nested inside each other.
export function isInteractiveTarget(event: Event): boolean {
  const boundary = event.currentTarget;
  let node = event.target as Element | null;

  while (node && node !== boundary) {
    if (typeof node.matches === "function" && node.matches(INTERACTIVE_SELECTOR)) {
      return true;
    }
    node = node.parentElement;
  }

  return false;
}

/// Whether a keydown should activate a card. Enter and Space only, and only
/// when the key was not meant for a control inside the card — Space in a text
/// input types a space, it does not navigate.
export function isActivationKey(event: KeyboardEvent): boolean {
  if (event.key !== "Enter" && event.key !== " ") return false;
  return !isInteractiveTarget(event);
}
