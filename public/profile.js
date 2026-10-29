/* public/profile.js */
(() => {
  "use strict";

  const API_BASE = "";
  const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
  const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const DEFAULT_AVATAR = "/images/akira-avatar.png";

  const state = {
    profile: null,
    avatarData: null,
    avatarObjectUrl: null,
    saving: false,
  };

  const selectors = {
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

  function getInitData() {
    return getTelegram()?.initData || "";
  }

  function getPlayerId() {
    const tg = getTelegram();
    return tg?.initDataUnsafe?.user?.id
      ? String(tg.initDataUnsafe.user.id)
      : "";
  }

  function getHeaders(extra = {}) {
    const headers = {
      Accept: "application/json",
      ...extra,
    };

    const initData = getInitData();

    if (initData) {
      headers["X-Telegram-Init-Data"] = initData;
    }

    return headers;
  }

  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
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
      const message =
        data?.error ||
        data?.message ||
        `Ошибка запроса (${response.status})`;

      const error = new Error(message);
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
      toast.style.cssText = [
        "position:fixed",
        "left:50%",
        "bottom:24px",
        "transform:translateX(-50%)",
        "z-index:99999",
        "max-width:calc(100vw - 32px)",
        "padding:12px 18px",
        "border:1px solid rgba(255,255,255,.16)",
        "border-radius:14px",
        "background:#171717",
        "color:#fff",
        "font:500 14px/1.4 system-ui,sans-serif",
        "box-shadow:0 10px 35px rgba(0,0,0,.3)",
        "opacity:0",
        "pointer-events:none",
        "transition:opacity .2s ease",
      ].join(";");

      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.opacity = "1";
    toast.dataset.type = type;

    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
      toast.style.opacity = "0";
    }, 3000);
  }

  function getDisplayName(profile) {
    return (
      profile?.name ||
      profile?.username ||
      profile?.first_name ||
      profile?.firstName ||
      getTelegram()?.initDataUnsafe?.user?.first_name ||
      "Игрок AKIRA"
    );
  }

  function getAvatarUrl(profile) {
    return (
      profile?.avatarUrl ||
      profile?.avatar_url ||
      profile?.avatar ||
      profile?.photo_url ||
      profile?.photoUrl ||
      DEFAULT_AVATAR
    );
  }

  function setAvatarImage(image, source) {
    if (!image) return;

    image.onerror = () => {
      image.onerror = null;

      if (image.src !== new URL(DEFAULT_AVATAR, window.location.origin).href) {
        image.src = DEFAULT_AVATAR;
      }
    };

    image.src = source || DEFAULT_AVATAR;
  }

  function updateAvatarPreview(source) {
    const avatar = $(selectors.avatar);
    setAvatarImage(avatar, source || DEFAULT_AVATAR);

    document.querySelectorAll("[data-profile-avatar]").forEach((image) => {
      setAvatarImage(image, source || DEFAULT_AVATAR);
    });

    document.querySelectorAll(".profile-avatar-preview").forEach((image) => {
      setAvatarImage(image, source || DEFAULT_AVATAR);
    });
  }

  function updateNamePreview(name) {
    const cleanName = String(name || "").trim() || "Игрок AKIRA";

    document.querySelectorAll("[data-profile-name]").forEach((element) => {
      element.textContent = cleanName;
    });

    document.querySelectorAll(".profile-name-preview").forEach((element) => {
      element.textContent = cleanName;
    });
  }

  function updateSaveButton() {
    const button = $(selectors.saveButton);
    if (!button) return;

    button.disabled = state.saving;
    button.textContent = state.saving ? "Сохранение..." : "Сохранить";
    button.setAttribute("aria-busy", String(state.saving));
  }

  function setSaving(saving) {
    state.saving = saving;
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
      error.style.cssText =
        "margin-top:6px;color:#ff5d67;font-size:12px;line-height:1.4;";
      input.insertAdjacentElement("afterend", error);
    }

    error.textContent = message;
  }

  function clearFieldError(input) {
    if (!input) return;

    input.removeAttribute("aria-invalid");

    document
      .querySelectorAll(`[data-profile-error="${input.id}"]`)
      .forEach((element) => element.remove());
  }

  function clearAllErrors() {
    [$(selectors.nameInput), $(selectors.avatarInput)].forEach(clearFieldError);
  }

  function validateName(value) {
    const name = String(value || "").trim();

    if (!name) {
      return { valid: false, message: "Введите имя." };
    }

    if (name.length < 2) {
      return { valid: false, message: "Имя должно содержать минимум 2 символа." };
    }

    if (name.length > 32) {
      return { valid: false, message: "Имя не должно быть длиннее 32 символов." };
    }

    if (/[\u0000-\u001F\u007F]/.test(name)) {
      return { valid: false, message: "Имя содержит недопустимые символы." };
    }

    return { valid: true, value: name };
  }

  function validateAvatar(file) {
    if (!file) return { valid: true };

    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      return {
        valid: false,
        message: "Выбери изображение в формате JPG, PNG, WEBP или GIF.",
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
      reader.onerror = () => reject(new Error("Не удалось прочитать изображение."));

      reader.readAsDataURL(file);
    });
  }

  function getProfilePayload(data) {
    if (!data || typeof data !== "object") return null;

    if (data.profile && typeof data.profile === "object") {
      return data.profile;
    }

    if (data.user && typeof data.user === "object") {
      return data.user;
    }

    return data;
  }

  async function loadProfile() {
    const playerId = getPlayerId();

    /*
     * initData должен передаваться серверу для проверки пользователя.
     * Если страница открыта вне Telegram, профиль можно загрузить,
     * если сервер разрешает такой запрос.
     */
    const paths = [
      "/api/profile",
      playerId ? `/api/profile/${encodeURIComponent(playerId)}` : null,
    ].filter(Boolean);

    let lastError = null;

    for (const path of paths) {
      try {
        const data = await request(path, { method: "GET" });
        const profile = getProfilePayload(data);

        if (profile && typeof profile === "object") {
          state.profile = profile;
          renderProfile(profile);
          return profile;
        }
      } catch (error) {
        lastError = error;

        if (error.status === 401 || error.status === 403) {
          break;
        }

        if (error.status !== 404 && error.status !== 405) {
          break;
        }
      }
    }

    if (state.profile) {
      renderProfile(state.profile);
    }

    if (lastError) {
      console.warn("[AKIRA profile] Не удалось загрузить профиль:", lastError);
    }

    return state.profile;
  }

  function renderProfile(profile = {}) {
    state.profile = profile;

    const nameInput = $(selectors.nameInput);
    const name = getDisplayName(profile);
    const avatarUrl = getAvatarUrl(profile);

    if (nameInput && document.activeElement !== nameInput) {
      nameInput.value = name;
    }

    updateNamePreview(name);
    updateAvatarPreview(avatarUrl);

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
    if (balanceElement) {
      const balance =
        profile.cookies ??
        profile.balance ??
        profile.coins ??
        profile.points;

      if (balance !== undefined && balance !== null) {
        balanceElement.textContent = Number(balance).toLocaleString("ru-RU");
      }
    }

    const levelElement = $("[data-profile-level]");
    if (levelElement) {
      const level = profile.level ?? profile.rank;
      if (level !== undefined && level !== null) {
        levelElement.textContent = String(level);
      }
    }

    document.dispatchEvent(
      new CustomEvent("akira:profile-loaded", {
        detail: { profile },
      })
    );
  }

  async function saveProfile(event) {
    event?.preventDefault();

    if (state.saving) return;

    const nameInput = $(selectors.nameInput);
    const avatarInput = $(selectors.avatarInput);
    const saveButton = $(selectors.saveButton);

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
    if (saveButton) saveButton.disabled = true;

    try {
      let avatar = state.avatarData;

      if (avatarFile) {
        avatar = await readFileAsDataUrl(avatarFile);
      }

      const payload = {
        name: nameValidation.value,
      };

      if (avatar) {
        payload.avatar = avatar;
      } else if (state.profile) {
        const currentAvatar =
          state.profile.avatarUrl ||
          state.profile.avatar_url ||
          state.profile.avatar;

        if (currentAvatar) {
          payload.avatar = currentAvatar;
        }
      }

      /*
       * Сохраняем профиль через сервер, чтобы имя и аватарка
       * не исчезали после перезагрузки страницы.
       */
      let data;

      try {
        data = await request("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        /*
         * Некоторые версии backend могут использовать PUT вместо PATCH.
         * Повторяем только для неподдерживаемого метода/маршрута.
         */
        if (error.status !== 404 && error.status !== 405) {
          throw error;
        }

        data = await request("/api/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      const returnedProfile = getProfilePayload(data);
      state.profile = {
        ...(state.profile || {}),
        ...(returnedProfile || {}),
        name: returnedProfile?.name || payload.name,
      };

      if (avatarFile && avatar) {
        state.avatarData = avatar;
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
      console.error("[AKIRA profile] Ошибка сохранения:", error);

      if (error.status === 401 || error.status === 403) {
        notify(
          "Не удалось подтвердить Telegram-пользователя. Открой бота через Telegram.",
          "error"
        );
      } else {
        notify(
          error.message || "Не удалось сохранить профиль. Попробуй ещё раз.",
          "error"
        );
      }
    } finally {
      setSaving(false);
    }
  }

  function handleAvatarChange(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];

    clearFieldError(input);

    if (!file) {
      state.avatarData = null;
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
    updateAvatarPreview(state.avatarObjectUrl);
    state.avatarData = null;
  }

  async function resetAvatar(event) {
    event?.preventDefault();

    if (state.saving) return;

    const input = $(selectors.avatarInput);
    if (input) input.value = "";

    state.avatarData = null;
    revokeAvatarObjectUrl();
    clearFieldError(input);

    /*
     * Отправляем пустой avatar серверу, если backend поддерживает
     * сброс аватарки. Если нет — показываем стандартную локально.
     */
    setSaving(true);

    try {
      let data = null;

      try {
        data = await request("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            avatar: null,
            resetAvatar: true,
          }),
        });
      } catch (error) {
        if (error.status !== 404 && error.status !== 405) {
          throw error;
        }

        data = await request("/api/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            avatar: null,
            resetAvatar: true,
          }),
        });
      }

      const returnedProfile = getProfilePayload(data);

      state.profile = {
        ...(state.profile || {}),
        ...(returnedProfile || {}),
        avatar: null,
        avatarUrl: null,
        avatar_url: null,
      };

      updateAvatarPreview(DEFAULT_AVATAR);
      notify("Установлена стандартная аватарка.", "success");

      document.dispatchEvent(
        new CustomEvent("akira:profile-updated", {
          detail: { profile: state.profile },
        })
      );
    } catch (error) {
      /*
       * Даже если сервер не умеет сбрасывать аватарку, пользователь
       * увидит стандартную картинку в текущем интерфейсе.
       */
      state.profile = {
        ...(state.profile || {}),
        avatar: null,
        avatarUrl: null,
        avatar_url: null,
      };

      updateAvatarPreview(DEFAULT_AVATAR);

      if (error.status === 401 || error.status === 403) {
        notify(
          "Аватарка сброшена только в интерфейсе. Открой бота через Telegram для сохранения.",
          "error"
        );
      } else {
        notify(
          "Стандартная аватарка установлена в интерфейсе. Сервер не подтвердил сохранение.",
          "error"
        );
      }

      console.warn("[AKIRA profile] Не удалось сбросить аватар:", error);
    } finally {
      setSaving(false);
    }
  }

  function bindEvents() {
    const form = $(selectors.form);
    const nameInput = $(selectors.nameInput);
    const avatarInput = $(selectors.avatarInput);
    const resetButton = $(selectors.resetAvatarButton);

    form?.addEventListener("submit", saveProfile);

    nameInput?.addEventListener("input", () => {
      clearFieldError(nameInput);
      updateNamePreview(nameInput.value);
    });

    avatarInput?.addEventListener("change", handleAvatarChange);
    resetButton?.addEventListener("click", resetAvatar);

    /*
     * Поддержка альтернативных кнопок/полей, если в HTML используются
     * data-атрибуты вместо стандартных ID.
     */
    document.querySelectorAll("[data-profile-save]").forEach((button) => {
      if (button === $(selectors.saveButton)) return;

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
    const tg = getTelegram();
    if (!tg) return;

    try {
      tg.ready();
      tg.expand();
    } catch (error) {
      console.warn("[AKIRA profile] Telegram WebApp init:", error);
    }
  }

  async function init() {
    initTelegram();
    bindEvents();

    const nameInput = $(selectors.nameInput);
    if (nameInput && !nameInput.value.trim()) {
      nameInput.value = getDisplayName({});
    }

    updateAvatarPreview(DEFAULT_AVATAR);
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
