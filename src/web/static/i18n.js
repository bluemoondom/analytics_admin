(function () {
  const defaultLang = 'en';
  const supported = ['cs', 'en', 'de', 'fr'];
  function safeLocalStorageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeLocalStorageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      // Ignore Tracking Prevention / private mode errors.
    }
  }

  let lang = safeLocalStorageGet('analytics_lang') || defaultLang;
  if (!supported.includes(lang)) lang = defaultLang;
  let dictionary = {};
  let ready = false;
  let applyPending = false;
  const listeners = [];
  const pendingElements = [];

  function loadDictionary(language) {
    return fetch(`/static/locales/${language}.json`, { cache: 'no-store' })
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load locale ${language}`);
        return res.json();
      })
      .then(data => {
        dictionary = data;
        lang = language;
        ready = true;
        listeners.forEach(fn => fn(lang));
        return data;
      })
      .catch(err => {
        console.error('i18n load error', err);
        dictionary = {};
        ready = false;
      });
  }

  function setLanguage(language) {
    if (!supported.includes(language)) return;
    safeLocalStorageSet('analytics_lang', language);
    return loadDictionary(language).then(() => {
      document.documentElement.lang = language;
      applyTranslations();
    });
  }

  function t(key, params = {}) {
    let text = dictionary[key];
    if (text === undefined) return `{${key}}`;
    Object.keys(params).forEach(p => {
      text = text.replace(new RegExp(`\\{${p}\\}`, 'g'), params[p]);
    });
    return text;
  }

  function translateElement(el) {
    if (!ready) {
      pendingElements.push(el);
      return;
    }
    const key = el.dataset.i18n;
    if (key !== undefined) {
      const attr = el.dataset.i18nAttr;
      const value = t(key);
      if (attr) {
        el.setAttribute(attr, value);
      } else {
        el.textContent = value;
      }
    }
    const placeholderKey = el.dataset.i18nPlaceholder;
    if (placeholderKey !== undefined) {
      el.placeholder = t(placeholderKey);
    }
  }

  function applyTranslations() {
    if (!ready) {
      applyPending = true;
      return;
    }
    while (pendingElements.length) {
      const el = pendingElements.shift();
      translateElement(el);
    }
    document.querySelectorAll('[data-i18n], [data-i18n-placeholder]').forEach(translateElement);
  }

  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          if (node.matches && (node.matches('[data-i18n]') || node.matches('[data-i18n-placeholder]'))) {
            translateElement(node);
          }
          if (node.querySelectorAll) {
            node.querySelectorAll('[data-i18n], [data-i18n-placeholder]').forEach(translateElement);
          }
        });
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function getLang() { return lang; }
  function isReady() { return ready; }
  function onChange(fn) {
    listeners.push(fn);
    return () => {
      const idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }

  window.I18n = {
    t,
    setLanguage,
    getLang,
    isReady,
    onChange,
    applyTranslations,
  };

  loadDictionary(lang).then(() => {
    applyTranslations();
  });
})();
