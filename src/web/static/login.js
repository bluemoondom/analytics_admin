"use strict";

(function () {
  const LANG_LABELS = {
    cs: { name: "Čeština", flag: "/static/icons/flag-cs.svg" },
    en: { name: "English", flag: "/static/icons/flag-en.svg" },
    de: { name: "Deutsch", flag: "/static/icons/flag-de.svg" },
    fr: { name: "Français", flag: "/static/icons/flag-fr.svg" },
  };

  function $(sel) {
    return document.querySelector(sel);
  }

  function esc(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function bindLanguageSwitcher() {
    const container = $("#lang-switcher");
    const trigger = $("#lang-switcher-trigger");
    const options = $("#lang-switcher-options");
    if (!container || !trigger || !options) return;

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      container.classList.toggle("open");
    });

    document.addEventListener("click", (e) => {
      if (!container.contains(e.target)) {
        container.classList.remove("open");
      }
    });

    options.querySelectorAll(".custom-select-option").forEach((opt) => {
      opt.addEventListener("click", (e) => {
        e.stopPropagation();
        if (window.I18n) window.I18n.setLanguage(opt.dataset.lang);
        options.classList.remove("open");
      });
      opt.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (window.I18n) window.I18n.setLanguage(opt.dataset.lang);
          options.classList.remove("open");
        }
      });
    });

    if (window.I18n) {
      window.I18n.onChange(updateLanguageActiveState);
      updateLanguageActiveState(window.I18n.getLang());
    }
  }

  function updateLanguageActiveState(language) {
    const trigger = $("#lang-switcher-trigger");
    const options = $("#lang-switcher-options");
    if (!trigger || !options) return;
    const info = LANG_LABELS[language] || LANG_LABELS.en;
    trigger.innerHTML = `
      <img src="${esc(info.flag)}" alt="" class="flag-icon" />
      <span>${esc(info.name)}</span>
    `;
    options.querySelectorAll(".custom-select-option").forEach((opt) => {
      opt.classList.toggle("active", opt.dataset.lang === language);
    });
  }

  function init() {
    const form = document.getElementById("auth-form");
    const message = document.getElementById("auth-message");
    const title = document.getElementById("auth-title");
    const hint = document.getElementById("auth-hint");
    const emailLabel = form ? form.querySelector("label[for='auth-email']") : null;
    const submitButton = document.getElementById("auth-submit");
    const toggleButton = document.getElementById("auth-toggle");

    if (!form || !toggleButton) {
      console.error("Login form or toggle button not found");
      return;
    }

    bindLanguageSwitcher();

    let mode = "login"; // "login" | "register"

    function updateModeLabels() {
      if (!window.I18n || !window.I18n.isReady()) return;
      const isLogin = mode === "login";
      title.dataset.i18n = isLogin ? "login_title" : "register_title";
      hint.dataset.i18n = isLogin ? "login_hint" : "register_hint";
      if (emailLabel) {
        emailLabel.dataset.i18n = isLogin ? "login_email_label" : "register_email_label";
      }
      submitButton.dataset.i18n = isLogin ? "login_submit_button" : "register_submit_button";
      toggleButton.dataset.i18n = isLogin ? "switch_to_register" : "switch_to_login";
      window.I18n.applyTranslations();
    }

    function setMode(newMode) {
      mode = newMode;
      updateModeLabels();
      message.textContent = "";
      message.innerHTML = "";
    }

    toggleButton.addEventListener("click", () => {
      setMode(mode === "login" ? "register" : "login");
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = form.email.value.trim();
      message.textContent = "";
      message.innerHTML = "";

      const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const data = await response.json();
        if (response.ok) {
          const label = window.I18n && window.I18n.t ? window.I18n.t("magic_link_debug_label") : "Odkaz (prototyp):";
          message.innerHTML = `
            <div class="login-success">
              <p>${escapeHtml(data.message)}</p>
              <p class="magic-link-debug"><strong>${escapeHtml(label)}</strong> <br/>
                <a href="${escapeHtml(data.magic_link)}" id="magic-link">
                  <code>${escapeHtml(data.magic_link)}</code>
                </a>
              </p>
            </div>`;
        } else {
          const generic = window.I18n && window.I18n.t ? window.I18n.t("login_error_generic") : "Nepodařilo se odeslat odkaz.";
          message.textContent = data.detail || generic;
        }
      } catch (error) {
        const generic = window.I18n && window.I18n.t ? window.I18n.t("login_error_generic") : "Chyba při odesílání:";
        message.textContent = generic + " " + error.message;
      }
    });

    function escapeHtml(text) {
      return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    if (window.I18n && window.I18n.isReady && window.I18n.isReady()) {
      updateModeLabels();
    } else if (window.I18n && window.I18n.onChange) {
      window.I18n.onChange(updateModeLabels);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
