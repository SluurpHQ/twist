// What a ref on a Fragment gets (React's FragmentInstance): the fragment's top-level elements treated as one, for
// listeners, focus, observers, geometry and document position. Its elements are found when asked, so they are
// always the fragment's current ones; listeners and observers follow elements added later.

type Listener = { type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions };

const FOCUSABLE = "a[href],area[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),iframe,object,embed,[contenteditable],[tabindex],audio[controls],video[controls],summary";
const capture = (o: Listener["options"]) => (typeof o === "boolean" ? o : !!o?.capture);

export class FragmentInstance {
  #listeners: Listener[] = [];
  #observers = new Set<IntersectionObserver | ResizeObserver | MutationObserver | any>();
  #withListeners = new WeakSet<Element>();
  #observed = new WeakMap<Element, Set<any>>();

  /** `elements` gives the fragment's top-level elements now; `parent` the element it is drawn into. */
  constructor(private elements: () => Element[], private parent: () => Element | null) {}

  /** Called when the fragment's children changed: listeners and observers reach the new elements too. */
  sync() {
    for (const el of this.elements()) {
      if (!this.#withListeners.has(el)) {
        this.#withListeners.add(el);
        for (const l of this.#listeners) el.addEventListener(l.type, l.listener, l.options);
      }
      for (const o of this.#observers) {
        let seen = this.#observed.get(el);
        if (!seen) this.#observed.set(el, (seen = new Set()));
        if (!seen.has(o)) (seen.add(o), o.observe(el));
      }
    }
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
    if (typeof options === "object" && options?.signal?.aborted) return;
    const same = this.#listeners.some((l) => l.type === type && l.listener === listener && capture(l.options) === capture(options));
    if (same) return;
    const entry = { type, listener, options };
    this.#listeners.push(entry);
    for (const el of this.elements()) el.addEventListener(type, listener, options);
    if (typeof options === "object" && options?.signal) options.signal.addEventListener("abort", () => this.removeEventListener(type, listener, options), { once: true });
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) {
    const i = this.#listeners.findIndex((l) => l.type === type && l.listener === listener && capture(l.options) === capture(options));
    if (i < 0) return;
    this.#listeners.splice(i, 1);
    for (const el of this.elements()) el.removeEventListener(type, listener, options);
  }

  /** Dispatched from the fragment's place: its listeners hear it, then it bubbles from the parent. */
  dispatchEvent(event: Event): boolean {
    const parent = this.parent();
    if (!parent) return true;
    if (!this.#listeners.length && event.bubbles) return parent.dispatchEvent(event);
    const stand = (parent.ownerDocument ?? document).createTextNode("");
    for (const l of this.#listeners) stand.addEventListener(l.type, l.listener, l.options);
    parent.appendChild(stand);
    try {
      return stand.dispatchEvent(event);
    } finally {
      for (const l of this.#listeners) stand.removeEventListener(l.type, l.listener, l.options);
      stand.remove();
    }
  }

  /** Focus to the first focusable element in the fragment (depth first), as React's focus does. */
  focus(options?: FocusOptions) {
    for (const el of this.#focusables()) if (tryFocus(el, options)) return;
  }

  focusLast(options?: FocusOptions) {
    const all = this.#focusables();
    for (let i = all.length - 1; i >= 0; i--) if (tryFocus(all[i]!, options)) return;
  }

  blur() {
    const active = (this.parent()?.ownerDocument ?? document).activeElement as HTMLElement | null;
    if (!active) return;
    if (this.elements().some((el) => el === active || el.contains(active))) active.blur();
  }

  #focusables(): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const el of this.elements()) {
      if (el.matches(FOCUSABLE)) out.push(el as HTMLElement);
      out.push(...(el.querySelectorAll(FOCUSABLE) as NodeListOf<HTMLElement>));
    }
    return out;
  }

  observeUsing(observer: any) {
    this.#observers.add(observer);
    this.sync();
  }

  unobserveUsing(observer: any) {
    if (!this.#observers.delete(observer)) return;
    for (const el of this.elements()) {
      const seen = this.#observed.get(el);
      if (seen?.delete(observer)) observer.unobserve(el);
    }
  }

  getClientRects(): DOMRect[] {
    return this.elements().flatMap((el) => [...el.getClientRects()]);
  }

  getRootNode(options?: GetRootNodeOptions): Node {
    const parent = this.parent();
    return parent ? parent.getRootNode(options) : (this as any);
  }

  scrollIntoView(alignToTop?: boolean) {
    if (typeof alignToTop === "object") throw new Error("FragmentInstance.scrollIntoView() does not support scrollIntoViewOptions. Use the alignToTop boolean instead.");
    const els = this.elements();
    const top = alignToTop !== false;
    if (!els.length) {
      this.parent()?.scrollIntoView(top);
      return;
    }
    // The way it moves: the end first when aligning to the top, so the first element ends up in view.
    const order = top ? [...els].reverse() : els;
    for (const el of order) el.scrollIntoView(top);
  }

  /** Where `other` is relative to the fragment's elements, as one range (React's compareDocumentPosition). */
  compareDocumentPosition(other: Node): number {
    const parent = this.parent();
    if (!parent) return Node.DOCUMENT_POSITION_DISCONNECTED;
    const els = this.elements();
    if (!els.length) {
      const p = parent.compareDocumentPosition(other);
      return parent === other ? Node.DOCUMENT_POSITION_CONTAINS : p | Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC;
    }
    const first = els[0]!, last = els[els.length - 1]!;
    const toFirst = first.compareDocumentPosition(other);
    const toLast = last.compareDocumentPosition(other);
    if (toFirst & Node.DOCUMENT_POSITION_DISCONNECTED) return toFirst;
    const inside =
      first === other || last === other || toFirst & Node.DOCUMENT_POSITION_CONTAINED_BY || toLast & Node.DOCUMENT_POSITION_CONTAINED_BY ||
      (toFirst & Node.DOCUMENT_POSITION_FOLLOWING && toLast & Node.DOCUMENT_POSITION_PRECEDING);
    if (inside) return Node.DOCUMENT_POSITION_CONTAINED_BY;
    return toFirst & Node.DOCUMENT_POSITION_PRECEDING ? toFirst : toLast;
  }
}

function tryFocus(el: HTMLElement, options?: FocusOptions) {
  const doc = el.ownerDocument;
  el.focus(options);
  return doc.activeElement === el;
}
