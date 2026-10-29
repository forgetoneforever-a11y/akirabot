// public/profile.js
(() => {
  "use strict";

  const DEFAULT_AVATAR = "/avatar-default.svg";
  const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
  const ALLOWED_AVATAR_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
  ];

  const state = {
    profile: null,
    avatarData: null,
    avatarObjectUrl: null,
    saving: false,
  };

  const SELECTORS = {
    form: "#profile-form",
    nameInput: "#profile-name-input",
    avatarInput: "#profile-avatar-input",
    saveButton: "#profile-save-button",
    resetAvatarButton: "#profile-reset-avatar",
    avatar: "#profile-avatar",
  };

  const $ = (selector, root = document) => root.querySelector(selector);

  function getTelegram() {
    return window.Telegram?.WebApp || null;
  }

  function getTelegramUser() {
    return getTelegram()?.initDataUnsafe?.user || null;
  }

  function getPlayerId() {
    const user = getTelegramUser();
    return user?.id != null ? String(user.id) : "";
  }

  function getHeaders(extra = {}) {
    const headers = {
      Accept: "application/json",
      ...extra,
    };

    const initData = getTelegram()?.initData;

    if (initData) {
      headers["X-Telegram-Init-Data"] = initData;
    }

    return headers;
  }

  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: getHeaders(options.headers || {}),
      credentials: "same-origin",
    });

    const contentType = response.headers.get("content-type") || "";
    let data = null;

    if (contentType.includes("application/json")) {
      data = await response.json().catch(() => null);
    } else {
      const text = await response.text().catch(() => "");
      data = text ? { message: text } : null;
    }

    if (!response.ok) {
      const error = new Error(
        data?.error ||
        data?.message ||
        `Ошибка сервера: ${response.status}`
      );

      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  function notify(message, type = "info") {
    if (typeof window.showToast === "function") {
      window.showToast(message, type);
      return;
    }

    if (typeof window.showNotification === "function") {
      window.showNotification(message, type);
      return;
    }

    let toast = $("#profile-toast");

    if (!toast) {
      toast = document.createElement("div");
      toast.id = "profile-toast";
      toast.setAttribute("role", "status");

      Object.assign(toast.style, {
        position: "fixed",
        left: "50%",
        bottom: "24px",
        transform: "translateX(-50%)",
        zIndex: "99999",
        maxWidth: "calc(100vw - 32px)",
        padding: "12px 18px",
        border: "1px solid rgba(255,255,255,.15)",
        borderRadius: "14px",
        background: "#171717",
        color: "#fff",
        font: "500 14px/1.4 system-ui,sans-serif",
        boxShadow: "0 10px 35px rgba(0,0,0,.3)",
        opacity: "0",
        pointerEvents: "none",
        transition: "opacity .2s ease",
      });

      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.dataset.type = type;
    toast.style.opacity = "1";

    clearTimeout(toast._hideTimer);

    toast._hideTimer = setTimeout(() => {
      toast.style.opacity = "0";
    }, 3000);
  }

  function getDisplayName(profile = {}) {
    const telegramUser = getTelegramUser();

    return (
      profile.name ||
      profile.username ||
      profile.first_name ||
      profile.firstName ||
      telegramUser?.first_name ||
      "Игрок AKIRA"
    );
  }

  function getAvatarUrl(profile = {}) {
    return (
      profile.avatarUrl ||
      profile.avatar_url ||
      profile.avatar ||
      profile.photo_url ||
      profile.photoUrl ||
      DEFAULT_AVATAR
    );
  }

  function setImage(image, src) {
    if (!image) return;

    image.onerror = () => {
      image.onerror = null;
      image.src = DEFAULT_AVATAR;
    };

    image.src = src || DEFAULT_AVATAR;
  }

  function updateAvatarPreview(src) {
    setImage($(SELECTORS.avatar), src);

    document.querySelectorAll(
      "[data-profile-avatar], .profile-avatar-preview"
    ).forEach((image) => {
      setImage(image, src);
    });
  }

  function updateNamePreview(value) {
    const name = String(value || "").trim() || "Игрок AKIRA";

    document.querySelectorAll(
      "[data-profile-name], .profile-name-preview"
    ).forEach((element) => {
      element.textContent = name;
    });
  }

  function updateSaveButton() {
    const button = $(SELECTORS.saveButton);
    if (!button) return;

    button.disabled = state.saving;
    button.textContent = state.saving ? "Сохранение..." : "Сохранить";
    button.setAttribute("aria-busy", String(state.saving));
  }

  function setSaving(value) {
    state.saving = value;
    updateSaveButton();
  }

  function showFieldError(input, message) {
    if (!input) return;

    input.setAttribute("aria-invalid", "true");

    let error = document.querySelector(
      `[data-profile-error="${input.id}"]`
    );

    if (!error) {
      error = document.createElement("div");
      error.dataset.profileError = input.id;
      error.className = "profile-field-error";

      Object.assign(error.style, {
        marginTop: "6px",
        color: "#ff5d67",
        fontSize: "12px",
        lineHeight: "1.4",
      });

      input.insertAdjacentElement("afterend", error);
    }

    error.textContent = message;
  }

  function clearFieldError(input) {
    if (!input) return;

    input.removeAttribute("aria-invalid");

    document.querySelectorAll(
      `[data-profile-error="${input.id}"]`
    ).forEach((element) => element.remove());
  }

  function validateName(value) {
    const name = String(value || "").trim();

    if (!name) {
      return { valid: false, message: "Введи имя." };
    }

    if (Array.from(name).length < 2) {
      return {
        valid: false,
        message: "Имя должно содержать минимум 2 символа.",
      };
    }

    if (Array.from(name).length > 32) {
      return {
        valid: false,
        message: "Имя не должно быть длиннее 32 символов.",
      };
    }

    if (/[\u0000-\u001F\u007F]/.test(name)) {
      return {
        valid: false,
        message: "Имя содержит недопустимые символы.",
      };
    }

    return { valid: true, value: name };
  }

  function validateAvatar(file) {
    if (!file) return { valid: true };

    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      return {
        valid: false,
        message: "Выбери изображение JPG, PNG, WEBP или GIF.",
      };
    }

    if (file.size > MAX_AVATAR_SIZE) {
      return {
        valid: false,
        message: "Размер аватарки не должен превышать 5 МБ.",
      };
    }

    return { valid: true };
  }

  function revokeAvatarObjectUrl() {
    if (!state.avatarObjectUrl) return;

    URL.revokeObjectURL(state.avatarObjectUrl);
    state.avatarObjectUrl = null;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(
        new Error("Не удалось прочитать изображение.")
      );

      reader.readAsDataURL(file);
    });
  }

  function unwrapProfile(data) {
    if (!data || typeof data !== "object") return null;
    if (data.profile && typeof data.profile === "object") return data.profile;
    if (data.user && typeof data.user === "object") return data.user;
    return data;
  }

  function renderProfile(profile = {}) {
    state.profile = profile;

    const name = getDisplayName(profile);
    const avatar = getAvatarUrl(profile);
    const nameInput = $(SELECTORS.nameInput);

    if (nameInput && document.activeElement !== nameInput) {
      nameInput.value = name;
    }

    updateNamePreview(name);
    updateAvatarPreview(avatar);

    const idElement = $("[data-profile-id]");

    if (idElement) {
      idElement.textContent =
        profile.telegramId ||
        profile.telegram_id ||
        profile.id ||
        getPlayerId() ||
        "—";
    }

    const balanceElement = $("[data-profile-balance]");
    const balance =
      profile.cookies ??
      profile.balance ??
      profile.coins ??
      profile.points;

    if (balanceElement && balance != null) {
      balanceElement.textContent = Number(balance).toLocaleString("ru-RU");
    }

    const levelElement = $("[data-profile-level]");
    const level = profile.level ?? profile.rank;

    if (levelElement && level != null) {
      levelElement.textContent = String(level);
    }

    document.dispatchEvent(
      new CustomEvent("akira:profile-loaded", {
        detail: { profile },
      })
    );
  }

  async function loadProfile() {
    const playerId = getPlayerId();
    const paths = ["/api/profile"];

    /*
     * Основной запрос — /api/profile.
     * Запрос с ID используется только как запасной вариант, если
     * сервер явно не поддерживает основной маршрут.
     */
    if (playerId) {
      paths.push(`/api/profile/${encodeURIComponent(playerId)}`);
    }

    let lastError = null;

    for (const path of paths) {
      try {
        const data = await request(path);
        const profile = unwrapProfile(data);

        if (profile && typeof profile === "object") {
          renderProfile(profile);
          return profile;
        }
      } catch (error) {
        lastError = error;

        if (error.status !== 404 && error.status !== 405) {
          break;
        }
      }
    }

    if (lastError) {
      console.warn("[AKIRA] Не удалось загрузить профиль:", lastError);
    }

    const fallback = state.profile || {
      name: getTelegramUser()?.first_name || "Игрок AKIRA",
      avatar: DEFAULT_AVATAR,
    };

    renderProfile(fallback);
    return fallback;
  }

  async function sendProfileUpdate(payload) {
    try {
      return await request("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (error.status !== 404 && error.status !== 405) {
        throw error;
      }

      return request("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
  }

  async function saveProfile(event) {
    event?.preventDefault();

    if (state.saving) return;

    const nameInput = $(SELECTORS.nameInput);
    const avatarInput = $(SELECTORS.avatarInput);
    const nameValidation = validateName(nameInput?.value);

    if (!nameValidation.valid) {
      showFieldError(nameInput, nameValidation.message);
      nameInput?.focus();
      notify(nameValidation.message, "error");
      return;
    }

    clearFieldError(nameInput);

    const avatarFile = avatarInput?.files?.[0] || null;
    const avatarValidation = validateAvatar(avatarFile);

    if (!avatarValidation.valid) {
      showFieldError(avatarInput, avatarValidation.message);
      avatarInput?.focus();
      notify(avatarValidation.message, "error");
      return;
    }

    clearFieldError(avatarInput);
    setSaving(true);

    try {
      const payload = { name: nameValidation.value };

      if (avatarFile) {
        payload.avatar = await readFileAsDataUrl(avatarFile);
      }

      const data = await sendProfileUpdate(payload);
      const updated = unwrapProfile(data) || {};

      state.profile = {
        ...(state.profile || {}),
        ...updated,
        name: updated.name || payload.name,
      };

      if (avatarFile) {
        state.avatarData = payload.avatar;
      }

      renderProfile(state.profile);

      if (avatarInput) avatarInput.value = "";

      revokeAvatarObjectUrl();

      notify("Профиль сохранён!", "success");

      document.dispatchEvent(
        new CustomEvent("akira:profile-updated", {
          detail: { profile: state.profile },
        })
      );
    } catch (error) {
      console.error("[AKIRA] Ошибка сохранения профиля:", error);

      if (error.status === 401 || error.status === 403) {
        notify(
          "Не удалось подтвердить Telegram-пользователя. Открой приложение через бота.",
          "error"
        );
      } else {
        notify(
          error.message || "Не удалось сохранить профиль.",
          "error"
        );
      }
    } finally {
      setSaving(false);
    }
  }

  function handleAvatarChange(event) {
    const input = event.currentTarget;
    const file = input.files?.[0] || null;

    clearFieldError(input);

    if (!file) {
      state.avatarData = null;
      revokeAvatarObjectUrl();
      updateAvatarPreview(getAvatarUrl(state.profile));
      return;
    }

    const validation = validateAvatar(file);

    if (!validation.valid) {
      showFieldError(input, validation.message);
      input.value = "";
      notify(validation.message, "error");
      return;
    }

    revokeAvatarObjectUrl();
    state.avatarObjectUrl = URL.createObjectURL(file);
    state.avatarData = null;

    updateAvatarPreview(state.avatarObjectUrl);
  }

  async function resetAvatar(event) {
    event?.preventDefault();

    if (state.saving) return;

    const input = $(SELECTORS.avatarInput);

    if (input) input.value = "";

    clearFieldError(input);
    state.avatarData = null;
    revokeAvatarObjectUrl();

    setSaving(true);

    try {
      const data = await sendProfileUpdate({
        avatar: null,
        resetAvatar: true,
      });

      const updated = unwrapProfile(data) || {};

      state.profile = {
        ...(state.profile || {}),
        ...updated,
        avatar: null,
        avatarUrl: null,
        avatar_url: null,
      };

      updateAvatarPreview(DEFAULT_AVATAR);
      notify("Стандартная аватарка установлена.", "success");

      document.dispatchEvent(
        new CustomEvent("akira:profile-updated", {
          detail: { profile: state.profile },
        })
      );
    } catch (error) {
      console.error("[AKIRA] Ошибка сброса аватарки:", error);

      /*
       * Не выдаём локальный сброс за успешное сохранение на сервере.
       */
      updateAvatarPreview(DEFAULT_AVATAR);

      if (error.status === 401 || error.status === 403) {
        notify(
          "Не удалось подтвердить пользователя. Аватарка изменена только в интерфейсе.",
          "error"
        );
      } else {
        notify(
          "Сервер не подтвердил сброс аватарки. Проверь поддержку этой функции в server.js.",
          "error"
        );
      }
    } finally {
      setSaving(false);
    }
  }

  function bindEvents() {
    const form = $(SELECTORS.form);
    const nameInput = $(SELECTORS.nameInput);
    const avatarInput = $(SELECTORS.avatarInput);
    const resetButton = $(SELECTORS.resetAvatarButton);

    form?.addEventListener("submit", saveProfile);

    nameInput?.addEventListener("input", () => {
      clearFieldError(nameInput);
      updateNamePreview(nameInput.value);
    });

    avatarInput?.addEventListener("change", handleAvatarChange);
    resetButton?.addEventListener("click", resetAvatar);

    document.querySelectorAll("[data-profile-save]").forEach((button) => {
      if (button === $(SELECTORS.saveButton)) return;

      button.addEventListener("click", (event) => {
        event.preventDefault();
        saveProfile(event);
      });
    });

    document.querySelectorAll("[data-profile-reset-avatar]").forEach((button) => {
      if (button === resetButton) return;

      button.addEventListener("click", resetAvatar);
    });

    document.querySelectorAll("[data-profile-name-input]").forEach((input) => {
      if (input === nameInput) return;

      input.addEventListener("input", () => {
        updateNamePreview(input.value);
      });
    });
  }

  function initTelegram() {
    const telegram = getTelegram();
    if (!telegram) return;

    try {
      telegram.ready();
      telegram.expand();
    } catch (error) {
      console.warn("[AKIRA] Не удалось инициализировать Telegram WebApp:", error);
    }
  }

  async function init() {
    initTelegram();
    bindEvents();

    updateAvatarPreview(DEFAULT_AVATAR);
    updateNamePreview(getTelegramUser()?.first_name || "Игрок AKIRA");

    await loadProfile();
  }

  window.AKIRAProfile = {
    load: loadProfile,
    save: saveProfile,
    resetAvatar,
    render: renderProfile,
    get profile() {
      return state.profile;
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
