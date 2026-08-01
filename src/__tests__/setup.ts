import '@testing-library/jest-dom';

// Polyfill DOMMatrix for pdfjs-dist in JSDOM environment
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    constructor(init?: string | number[]) {
      if (Array.isArray(init)) {
        this.a = init[0] ?? 1;
        this.b = init[1] ?? 0;
        this.c = init[2] ?? 0;
        this.d = init[3] ?? 1;
        this.e = init[4] ?? 0;
        this.f = init[5] ?? 0;
      }
    }
  } as any;
}

// Polyfill canvas getContext to prevent "Not implemented" warnings in tests
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: any[]) {
    if (type === '2d') {
      return {
        drawImage: () => {},
        fillRect: () => {},
        clearRect: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray() }),
        putImageData: () => {},
        createImageData: () => ({}),
        setTransform: () => {},
        scale: () => {},
        translate: () => {},
        rotate: () => {},
      } as any;
    }
    return null;
  };
}

// Mock ResizeObserver for jsdom.
//
// JSDOM does no layout, so components that size themselves from a measured box
// would otherwise be stuck at 0x0 and untestable. This mock keeps every live
// observer so a test can state what size an element has and see the component
// react — see `resizeElement` below.
type ResizeCallback = (entries: { contentRect: { width: number; height: number } }[]) => void;

const observers = new Set<{ callback: ResizeCallback; targets: Set<Element> }>();

class ResizeObserverMock {
  private record: { callback: ResizeCallback; targets: Set<Element> };

  constructor(callback: ResizeCallback) {
    this.record = { callback, targets: new Set() };
    observers.add(this.record);
  }

  observe(target: Element) {
    this.record.targets.add(target);
  }

  unobserve(target: Element) {
    this.record.targets.delete(target);
  }

  disconnect() {
    this.record.targets.clear();
    observers.delete(this.record);
  }
}

globalThis.ResizeObserver = ResizeObserverMock as any;

// Mock IntersectionObserver for jsdom.
//
// Cards defer their heavy work until they are near the viewport. JSDOM has no
// viewport, so by default this mock answers "yes, it is visible" the moment an
// element is observed — which is what a real browser does for the cards that
// are on screen, and what every test that asserts on a card's contents assumes.
//
// A test about deferral itself calls `deferVisibility(true)` first, then
// `revealElement` to say when something scrolled into view.
type IntersectionCallback = (entries: { target: Element; isIntersecting: boolean }[]) => void;

const intersectionObservers = new Set<{
  callback: IntersectionCallback;
  targets: Set<Element>;
}>();

let holdIntersections = false;

class IntersectionObserverMock {
  private record: { callback: IntersectionCallback; targets: Set<Element> };

  constructor(callback: IntersectionCallback) {
    this.record = { callback, targets: new Set() };
    intersectionObservers.add(this.record);
  }

  observe(target: Element) {
    this.record.targets.add(target);
    if (!holdIntersections) {
      this.record.callback([{ target, isIntersecting: true }]);
    }
  }

  unobserve(target: Element) {
    this.record.targets.delete(target);
  }

  disconnect() {
    this.record.targets.clear();
    intersectionObservers.delete(this.record);
  }

  takeRecords() {
    return [];
  }
}

globalThis.IntersectionObserver = IntersectionObserverMock as any;

/// Whether newly observed elements start off screen. Reset between tests by the
/// suite that turns it on.
export function deferVisibility(deferred: boolean): void {
  holdIntersections = deferred;
}

/// Announce that an element has scrolled into view.
export function revealElement(element: Element): void {
  for (const observer of intersectionObservers) {
    if (observer.targets.has(element)) {
      observer.callback([{ target: element, isIntersecting: true }]);
    }
  }
}

/// Give an element a size and notify anything observing it.
export function resizeElement(element: Element, width: number, height: number): void {
  Object.defineProperty(element, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(element, 'clientHeight', { value: height, configurable: true });

  for (const observer of observers) {
    if (observer.targets.has(element)) {
      observer.callback([{ contentRect: { width, height } }]);
    }
  }
}
