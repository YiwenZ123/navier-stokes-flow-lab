import { createLegacyTranslator } from './i18n-runtime.js?v=14';
import { legacyTranslations } from './translations.js?v=14';

const storageKey = 'cfd-language';
let language = 'en';
try { if (localStorage.getItem(storageKey) === 'zh') language = 'zh'; } catch { /* Sandboxed/private storage: keep an in-memory choice. */ }
const queryLanguage = new URL(location.href).searchParams.get('lang');
if (queryLanguage === 'en' || queryLanguage === 'zh') language = queryLanguage;
const runtime = createLegacyTranslator(legacyTranslations, language);
export const getLanguage = () => language;
export const t = (english, chinese) => language === 'zh' ? chinese : english;
export const translateText = value => runtime.translateText(value);
export const translatePage = root => runtime.translatePage(root);

function rememberInNavigation() {
  // URL state keeps language across navigation even when storage is unavailable.
  for (const link of document.querySelectorAll('a[href]')) {
    if (link.getAttribute('href').startsWith('#')) continue;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !(/\.html$/.test(url.pathname) || url.pathname.endsWith('/'))) continue;
    url.searchParams.set('lang', language);
    link.href = url.pathname + url.search + url.hash;
  }
}
function sendToFrames() {
  for (const frame of document.querySelectorAll('iframe.explicit-presets-frame')) {
    frame.contentWindow?.postMessage({ type: 'cfd-language', language }, '*');
  }
}
export function setLanguage(value, persist = true) {
  language = value === 'zh' ? 'zh' : 'en';
  if (persist) try { localStorage.setItem(storageKey, language); } catch { /* Still applies for this page. */ }
  runtime.setLanguage(language);
  try { const url = new URL(location.href); url.searchParams.set('lang', language); history.replaceState(null, '', url.pathname + url.search + url.hash); } catch {}
  rememberInNavigation();
  const select = document.querySelector('[data-language-select]');
  if (select) select.value = language;
  sendToFrames();
  window.dispatchEvent(new CustomEvent('languagechange', { detail: { language } }));
}
export function mountLanguageSelector() {
  const header = document.querySelector('.site-header');
  if (!header || header.querySelector('[data-language-select]')) return;
  const label = document.createElement('label');
  label.className = 'language-picker';
  const text = document.createElement('span');
  text.dataset.en = 'Language'; text.dataset.zh = '语言'; text.textContent = t('Language', '语言');
  const select = document.createElement('select');
  select.dataset.languageSelect = '';
  select.setAttribute('aria-label', t('Language', '语言'));
  select.setAttribute('data-en-aria-label', 'Language'); select.setAttribute('data-zh-aria-label', '语言');
  for (const [value, name] of [['en', 'English'], ['zh', '中文']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = name; select.append(option);
  }
  select.value = language;
  select.addEventListener('change', () => setLanguage(select.value));
  label.append(text, select); header.insertBefore(label, header.querySelector('.method-nav'));
}
function initialize() {
  mountLanguageSelector();
  runtime.translatePage();
  rememberInNavigation();
  for (const frame of document.querySelectorAll('iframe.explicit-presets-frame')) frame.addEventListener('load', sendToFrames);
  sendToFrames();
}
window.addEventListener('message', event => {
  const frame = [...document.querySelectorAll('iframe.explicit-presets-frame')].find(item => item.contentWindow === event.source);
  if (frame && event.data?.type === 'cfd-language-ready') sendToFrames();
});
window.addEventListener('storage', event => {
  if (event.key === storageKey && (event.newValue === 'en' || event.newValue === 'zh')) setLanguage(event.newValue, false);
});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
else initialize();
