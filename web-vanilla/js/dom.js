// Único ponto de criação de elementos. Texto vindo da API entra sempre como nó de texto
// ou atributo, nunca como HTML: é isso que impede a injeção de marcação (XSS).

/**
 * @param {string} tag
 * @param {Record<string, unknown>} [props] atributos; `on*` com função vira listener
 * @param {...(Node|string|number|false|null|undefined|Array)} children
 */
export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === false || value === null || value === undefined) {
      continue;
    }
    if (name.startsWith('on') && typeof value === 'function') {
      element.addEventListener(name.slice(2), value);
    } else {
      element.setAttribute(name, value === true ? '' : String(value));
    }
  }
  const nodes = children
    .flat(Infinity)
    .filter((child) => child !== false && child !== null && child !== undefined)
    .map((child) => (typeof child === 'number' ? String(child) : child));
  element.append(...nodes);
  return element;
}
