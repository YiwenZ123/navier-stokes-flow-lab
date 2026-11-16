import { getLanguage, t } from './i18n.js?v=14';
import { mountHomeWave } from './home-wave.js?v=f22154b79cae';

// Existing bookmarks to the original explicit lesson keep their destination.
function preserveExplicitBookmarks() {
  if (!['#animation', '#flow', '#formulas'].includes(location.hash)) return false;
  location.replace('./explicit.html' + location.search + location.hash);
  return true;
}
window.addEventListener('hashchange', preserveExplicitBookmarks);
if (!preserveExplicitBookmarks()) {
  const menu = document.getElementById('menu-toggle');
  const navigation = document.getElementById('home-navigation');
  function closeMenu() {
    menu.setAttribute('aria-expanded', 'false'); navigation.classList.remove('is-open');
  }
  menu.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(open)); navigation.classList.toggle('is-open', open);
    if (open) navigation.querySelector('a').focus();
  });
  navigation.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') { closeMenu(); menu.focus(); } });
  document.addEventListener('click', event => { if (!event.target.closest('.home-header')) closeMenu(); });
  const media = matchMedia('(min-width: 581px)');
  media.addEventListener('change', event => { if (event.matches) closeMenu(); });
  const wave = mountHomeWave(document);
  const motion = document.getElementById('motion-toggle');
  function renderMotion() {
    const paused = wave.isPaused();
    motion.setAttribute('aria-pressed', String(paused));
    const labels = paused ? ['Play dam-break preview', '播放溃坝预览'] : ['Pause dam-break preview', '暂停溃坝预览'];
    motion.dataset.enAriaLabel = labels[0]; motion.dataset.zhAriaLabel = labels[1];
    motion.setAttribute('aria-label', t(...labels));
  }
  motion.addEventListener('click', () => { wave.setPaused(!wave.isPaused()); renderMotion(); });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  wave.setPaused(reducedMotion.matches);
  reducedMotion.addEventListener('change', () => { wave.setPaused(reducedMotion.matches); renderMotion(); });
  window.addEventListener('languagechange', renderMotion);
  renderMotion();
  document.documentElement.lang = getLanguage() === 'zh' ? 'zh-CN' : 'en';
}
