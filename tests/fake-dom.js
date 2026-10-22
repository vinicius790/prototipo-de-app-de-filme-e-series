// DOM mínimo para testar a renderização no Node, sem dependências.
// Cobre só o que js/dom.js usa: createElement, setAttribute, addEventListener, append, replaceChildren.

export class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = new Map();
    this.listeners = new Map();
    this.children = [];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = nodes;
  }

  get textContent() {
    return this.children.map((child) => (typeof child === 'string' ? child : child.textContent)).join('');
  }

  /** Todos os elementos descendentes (e o próprio) com a tag pedida. */
  findAll(tagName) {
    const found = this.tagName === tagName ? [this] : [];
    for (const child of this.children) {
      if (typeof child !== 'string') {
        found.push(...child.findAll(tagName));
      }
    }
    return found;
  }

  click() {
    this.listeners.get('click')?.({ preventDefault() {} });
  }
}

export function installFakeDocument() {
  globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
}
