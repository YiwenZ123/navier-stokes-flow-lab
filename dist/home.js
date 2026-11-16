import { getLanguage, t } from './i18n.js?v=14';
import { mountHomeArt } from './home-art.js?v=e482752668db';

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
  const art = mountHomeArt(document);
  const motion = document.getElementById('motion-toggle');
  function renderMotion() {
    const paused = art.isPaused();
    motion.setAttribute('aria-pressed', String(paused));
    document.getElementById('motion-label').textContent = paused ? t('Play motion', '播放动效') : t('Pause motion', '暂停动效');
    motion.querySelector('.motion-icon').textContent = paused ? '▷' : 'Ⅱ';
    motion.setAttribute('aria-label', paused ? t('Play flow illustration', '播放流场示意动效') : t('Pause flow illustration', '暂停流场示意动效'));
  }
  motion.addEventListener('click', () => { art.setPaused(!art.isPaused()); renderMotion(); });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion.addEventListener('change', () => { art.setPaused(reducedMotion.matches); renderMotion(); });
  window.addEventListener('languagechange', renderMotion);
  renderMotion();
  document.documentElement.lang = getLanguage() === 'zh' ? 'zh-CN' : 'en';
}
