/** Move existing controls without replacing their nodes or touching solver state.
 * Self-contained so the sandboxed explicit demo can embed this same function.
 */
export function mountParameterSidebar(root, { controls = [], content = [], key = 'demo' } = {}) {
  if (root.parameterSidebar) return root.parameterSidebar;
  const doc = root.ownerDocument, win = doc.defaultView;
  const settings = controls.filter(Boolean), results = content.filter(Boolean);
  const workspace = doc.createElement('div'); workspace.className = 'parameter-workspace';
  const toolbar = doc.createElement('div'); toolbar.className = 'parameter-toolbar';
  const toggle = doc.createElement('button'); toggle.type = 'button'; toggle.className = 'parameter-toggle';
  const icon = doc.createElement('span'); icon.className = 'parameter-toggle-icon'; icon.setAttribute('aria-hidden', 'true');
  const toggleText = doc.createElement('span'); toggle.append(icon, toggleText); toolbar.append(toggle);
  const sidebar = doc.createElement('aside'); sidebar.className = 'parameter-sidebar'; sidebar.id = 'parameters-' + key;
  const heading = doc.createElement('h3'); heading.className = 'parameter-sidebar-title'; heading.id = sidebar.id + '-title';
  sidebar.setAttribute('aria-labelledby', heading.id); toggle.setAttribute('aria-controls', sidebar.id);
  const body = doc.createElement('div'); body.className = 'parameter-sidebar-body'; sidebar.append(heading, body);
  const stage = doc.createElement('div'); stage.className = 'parameter-stage';
  const backdrop = doc.createElement('button'); backdrop.type = 'button'; backdrop.className = 'parameter-backdrop'; backdrop.tabIndex = -1;
  workspace.append(toolbar, backdrop, sidebar, stage);
  const anchor = results.find(node => node.parentElement === root);
  if (anchor) root.insertBefore(workspace, anchor); else root.append(workspace);
  settings.forEach(node => body.append(node)); results.forEach(node => stage.append(node));
  root.classList.add('parameter-host'); doc.body.classList.add('has-parameter-sidebar');
  const compact = win.matchMedia('(max-width: 860px)');
  const storageKey = () => 'cfd-parameter-sidebar-v1:' + key + (compact.matches ? ':compact' : ':wide');
  function readPreference() {
    try { const value = win.localStorage.getItem(storageKey()); if (value === 'open' || value === 'closed') return value === 'open'; } catch { /* Opaque sandbox or blocked storage. */ }
    return !compact.matches;
  }
  let expanded = readPreference();
  function words(en, zh) { return doc.documentElement.lang.toLowerCase().startsWith('zh') ? zh : en; }
  function refreshLanguage() {
    heading.textContent = words('Parameters', '参数设置');
    toggleText.textContent = expanded ? words('Hide parameters', '收起参数') : words('Show parameters', '展开参数');
    toggle.setAttribute('aria-label', toggleText.textContent);
    backdrop.setAttribute('aria-label', words('Close parameters', '关闭参数面板'));
  }
  function render() {
    workspace.dataset.expanded = String(expanded);
    workspace.dataset.compact = String(compact.matches);
    sidebar.hidden = !expanded;
    backdrop.hidden = !expanded || !compact.matches;
    stage.inert = expanded && compact.matches;
    toggle.setAttribute('aria-expanded', String(expanded));
    icon.textContent = expanded ? '‹' : '☰';
    refreshLanguage();
  }
  function setExpanded(value, persist = true) {
    const next = !!value;
    if (next && compact.matches && stage.contains(doc.activeElement)) toggle.focus({ preventScroll: true });
    if (!next && sidebar.contains(doc.activeElement)) toggle.focus({ preventScroll: true });
    expanded = next;
    if (persist) try { win.localStorage.setItem(storageKey(), expanded ? 'open' : 'closed'); } catch {}
    render();
  }
  toggle.addEventListener('click', () => setExpanded(!expanded));
  backdrop.addEventListener('click', () => { setExpanded(false); toggle.focus({ preventScroll: true }); });
  workspace.addEventListener('keydown', event => {
    if (event.key === 'Escape' && expanded) { event.preventDefault(); setExpanded(false); toggle.focus({ preventScroll: true }); }
  });
  compact.addEventListener('change', () => setExpanded(readPreference(), false));
  win.addEventListener('languagechange', refreshLanguage);
  const languageObserver = new win.MutationObserver(refreshLanguage);
  languageObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ['lang'] });
  render();
  return root.parameterSidebar = { workspace, sidebar, body, stage, toggle, setExpanded, isExpanded: () => expanded, refreshLanguage };
}
