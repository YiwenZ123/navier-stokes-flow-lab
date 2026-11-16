// Shared DOM translator. The self-contained factory is also embedded in the sandboxed
// enhanced explicit animation; the archived original animation remains untouched.
export function createLegacyTranslator(dictionary, initialLanguage = 'en') {
  let language = initialLanguage === 'zh' ? 'zh' : 'en';
  const sources = new WeakMap();
  const attributes = new WeakMap();
  const patterns = dictionary.patterns.map(([pattern, replacement]) => [new RegExp(pattern), replacement]);
  const ignored = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);
  const watchedAttributes = ['aria-label', 'title', 'alt', 'placeholder'];
  let observer;
  function translateText(value) {
    if (language !== 'en' || typeof value !== 'string') return value;
    const trimmed = value.trim();
    let translated = dictionary.strings[trimmed];
    if (translated === undefined) {
      for (const [pattern, replacement] of patterns) {
        if (pattern.test(trimmed)) { translated = trimmed.replace(pattern, replacement); break; }
      }
    }
    if (translated === undefined) return value;
    const prefix = value.slice(0, value.length - value.trimStart().length);
    const suffix = value.slice(value.trimEnd().length);
    return prefix + translated + suffix;
  }
  function textNode(node) {
    if (!node.parentElement || ignored.has(node.parentElement.tagName) || node.parentElement.closest('[data-i18n-ignore]')) return;
    const current = node.nodeValue;
    const prior = sources.get(node);
    const original = prior && current === prior.rendered ? prior.original : current;
    const rendered = translateText(original);
    sources.set(node, { original, rendered });
    if (current !== rendered) node.nodeValue = rendered;
  }
  function element(node) {
    if (ignored.has(node.tagName) || node.closest('[data-i18n-ignore]')) return;
    if (node.hasAttribute('data-en') && node.hasAttribute('data-zh') && node.childElementCount === 0) {
      const value = node.getAttribute(language === 'zh' ? 'data-zh' : 'data-en');
      if (node.textContent !== value) node.textContent = value;
      // Explicit bilingual attributes are authoritative; no legacy source restoration.
      for (const child of node.childNodes) if (child.nodeType === 3) sources.delete(child);
    }
    const record = attributes.get(node) || {};
    for (const name of watchedAttributes) {
      const explicit = node.getAttribute(`data-${language}-${name}`);
      if (explicit !== null) {
        if (node.getAttribute(name) !== explicit) node.setAttribute(name, explicit);
        delete record[name];
      } else if (node.hasAttribute(name)) {
        const current = node.getAttribute(name);
        const prior = record[name];
        const original = prior && current === prior.rendered ? prior.original : current;
        const rendered = translateText(original);
        record[name] = { original, rendered };
        if (current !== rendered) node.setAttribute(name, rendered);
      }
    }
    attributes.set(node, record);
  }
  function visit(root) {
    if (root.nodeType === 3) { textNode(root); return; }
    if (root.nodeType === 1) {
      if (ignored.has(root.tagName) || root.closest('[data-i18n-ignore]')) return;
      element(root);
    }
    for (const child of root.childNodes) visit(child);
  }
  function watch() {
    observer?.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: watchedAttributes });
  }
  function translatePage(root = document) {
    // Flush queued renderer mutations before translating. Disconnecting avoids
    // observing our own text writes and prevents per-frame full-document scans.
    const pending = observer?.takeRecords() || [];
    observer?.disconnect();
    for (const record of pending) handle(record);
    visit(root);
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    watch();
  }
  function handle(record) {
    if (record.type === 'childList') for (const node of record.addedNodes) visit(node);
    else if (record.type === 'characterData') textNode(record.target);
    else if (record.type === 'attributes') element(record.target);
  }
  function setLanguage(value) {
    language = value === 'zh' ? 'zh' : 'en';
    translatePage();
  }
  observer = new MutationObserver(records => {
    observer.disconnect();
    for (const record of records) handle(record);
    watch();
  });
  translatePage();
  return { translateText, translatePage, setLanguage, getLanguage: () => language };
}
