(() => {
  let serviceWorkerReady = null;
  if ("serviceWorker" in navigator && window.isSecureContext) {
    const serviceWorkerUrl = new URL("./sw.js", document.baseURI);
    const serviceWorkerScope = new URL("./", serviceWorkerUrl).pathname;
    serviceWorkerReady = fetch(serviceWorkerUrl.href, { cache: "no-store" })
      .then((response) => {
        const contentType = response.headers.get("content-type") || "";
        if (!response.ok || !/javascript|ecmascript/i.test(contentType)) {
          throw new Error(
            `La ruta ${serviceWorkerUrl.pathname} respondió ${response.status} ` +
            `con Content-Type "${contentType || "desconocido"}". ` +
            "Publica sw.js junto a index.html y evita que esa ruta reescriba a index.html."
          );
        }
        return navigator.serviceWorker.register(serviceWorkerUrl.href, {
          scope: serviceWorkerScope,
          updateViaCache: "none"
        });
      })
      .then(() => navigator.serviceWorker.ready)
      .catch((error) => {
        console.warn(`No se pudo activar el soporte PWA desde ${serviceWorkerUrl.href}:`, error);
        return null;
      });
  }

  const isStandalone = ["standalone", "minimal-ui", "fullscreen"]
    .some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches)
    || window.navigator.standalone === true;

  let installPrompt = null;
  let installCard = null;
  let installStatus = null;
  let notificationCard = null;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function hideInstallCard() {
    installCard?.remove();
    installCard = null;
  }

  function showInstallInstructions() {
    if (!installStatus) return;
    if (!window.isSecureContext) {
      installStatus.textContent = "Para instalar CONECTA, abre la página desde una dirección HTTPS segura.";
    } else if (isIOS) {
      installStatus.textContent = "En iPhone o iPad, abre CONECTA en Safari, toca Compartir y elige “Añadir a pantalla de inicio”.";
    } else if (/android/i.test(navigator.userAgent)) {
      installStatus.textContent = "Si no aparece el diálogo, abre el menú de Chrome y selecciona “Instalar aplicación” o “Añadir a pantalla principal”.";
    } else {
      installStatus.textContent = "Si no aparece el diálogo, abre el menú de tu navegador compatible (por ejemplo Chrome o Edge) y selecciona “Instalar CONECTA”.";
    }
  }

  function ensurePwaStyles() {
    if (document.getElementById("conectaPwaStyles")) return;
    const style = document.createElement("style");
    style.id = "conectaPwaStyles";
    style.textContent = `
      #conectaInstallCard,#conectaNotificationCard { position:fixed; z-index:30000; right:16px; bottom:calc(16px + env(safe-area-inset-bottom)); display:flex; align-items:center; gap:14px; width:min(440px,calc(100vw - 32px)); padding:16px; border:1px solid rgba(33,118,255,.2); border-radius:18px; background:#fff; color:#17233c; box-shadow:0 16px 48px rgba(15,35,70,.25); font:14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      #conectaInstallCard .conecta-copy,#conectaNotificationCard .conecta-copy { flex:1; min-width:0; }
      #conectaInstallCard strong,#conectaNotificationCard strong { display:block; margin-bottom:3px; font-size:15px; }
      #conectaInstallCard p,#conectaNotificationCard p { margin:0; color:#5e6d84; }
      #conectaInstallCard .conecta-actions,#conectaNotificationCard .conecta-actions { display:flex; flex-shrink:0; gap:7px; align-items:center; }
      #conectaInstallCard button,#conectaNotificationCard button { min-height:38px; padding:8px 12px; border:0; border-radius:10px; font:700 13px system-ui,sans-serif; cursor:pointer; }
      #conectaInstallBtn,#conectaNotificationBtn { background:#2176ff; color:#fff; }
      #conectaInstallDismiss,#conectaNotificationDismiss { background:#edf2f8; color:#34445f; }
      [data-theme="dark"] #conectaInstallCard,[data-theme="dark"] #conectaNotificationCard { background:#182a48; color:#f2f6ff; border-color:#40577e; }
      [data-theme="dark"] #conectaInstallCard p,[data-theme="dark"] #conectaNotificationCard p { color:#b9c9e4; }
      [data-theme="dark"] #conectaInstallDismiss,[data-theme="dark"] #conectaNotificationDismiss { background:#29466f; color:#f2f6ff; }
      @media(max-width:520px) { #conectaInstallCard,#conectaNotificationCard { right:12px; bottom:calc(12px + env(safe-area-inset-bottom)); width:calc(100vw - 24px); gap:9px; padding:13px; } #conectaInstallCard .conecta-actions,#conectaNotificationCard .conecta-actions { flex-direction:column; align-items:stretch; } }
    `;
    document.head.appendChild(style);
  }

  function createInstallCard() {
    if (installCard || isStandalone) return;
    ensurePwaStyles();
    try {
      if (sessionStorage.getItem("conecta-install-dismissed") === "1") return;
    } catch {}

    installCard = document.createElement("aside");
    installCard.id = "conectaInstallCard";
    installCard.setAttribute("aria-label", "Instalar CONECTA");
    const copy = document.createElement("div");
    copy.className = "conecta-copy";
    const title = document.createElement("strong");
    title.textContent = "Instala CONECTA";
    installStatus = document.createElement("p");
    installStatus.textContent = "Instala CONECTA en tu celular o computadora para acceder más fácilmente.";
    installStatus.setAttribute("role", "status");
    installStatus.setAttribute("aria-live", "polite");
    copy.append(title, installStatus);

    const actions = document.createElement("div");
    actions.className = "conecta-actions";
    const installButton = document.createElement("button");
    installButton.id = "conectaInstallBtn";
    installButton.type = "button";
    installButton.textContent = "Instalar";
    installButton.addEventListener("click", async () => {
      if (!installPrompt) {
        showInstallInstructions();
        return;
      }
      const promptEvent = installPrompt;
      installPrompt = null;
      installButton.disabled = true;
      try {
        await promptEvent.prompt();
        const result = await promptEvent.userChoice;
        if (result?.outcome === "accepted") hideInstallCard();
        else showInstallInstructions();
      } catch (error) {
        console.warn("No se pudo abrir el diálogo de instalación:", error);
        showInstallInstructions();
      } finally {
        if (installCard?.isConnected) installButton.disabled = false;
      }
    });

    const dismissButton = document.createElement("button");
    dismissButton.id = "conectaInstallDismiss";
    dismissButton.type = "button";
    dismissButton.textContent = "Ahora no";
    dismissButton.addEventListener("click", () => {
      try { sessionStorage.setItem("conecta-install-dismissed", "1"); } catch {}
      hideInstallCard();
    });
    actions.append(installButton, dismissButton);
    installCard.append(copy, actions);
    document.body.appendChild(installCard);
  }

  function hideNotificationCard() {
    notificationCard?.remove();
    notificationCard = null;
  }

  function createNotificationCard() {
    if (notificationCard || !window.isSecureContext || !("Notification" in window)) return;
    ensurePwaStyles();
    if (Notification.permission !== "default") return;
    try {
      if (sessionStorage.getItem("conecta-notifications-dismissed") === "1") return;
    } catch {}

    notificationCard = document.createElement("aside");
    notificationCard.id = "conectaNotificationCard";
    notificationCard.setAttribute("aria-label", "Permitir notificaciones de CONECTA");
    const copy = document.createElement("div");
    copy.className = "conecta-copy";
    const title = document.createElement("strong");
    title.textContent = "Activa las notificaciones";
    const status = document.createElement("p");
    status.textContent = "Pulsa “Permitir” para solicitar autorización en este dispositivo.";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    copy.append(title, status);

    const actions = document.createElement("div");
    actions.className = "conecta-actions";
    const enableButton = document.createElement("button");
    enableButton.id = "conectaNotificationBtn";
    enableButton.type = "button";
    enableButton.textContent = "Permitir";
    enableButton.addEventListener("click", async () => {
      if (!("Notification" in window) || !window.isSecureContext) {
        status.textContent = "Este navegador no admite permisos de notificación en esta página.";
        return;
      }
      // Solicitar directamente desde el clic: los navegadores exigen una acción del usuario.
      let permissionRequest;
      try {
        permissionRequest = Notification.requestPermission();
      } catch (error) {
        console.warn("No se pudo solicitar permiso de notificaciones:", error);
        status.textContent = "No se pudo solicitar el permiso. Revisa los ajustes del navegador.";
        return;
      }
      enableButton.disabled = true;
      try {
        const permission = await permissionRequest;
        if (permission === "granted") {
          status.textContent = "Permiso concedido. Activando notificaciones push…";
          enableButton.remove();
          try {
            const result = await window.enablePushNotifications?.();
            status.textContent = result?.ok
              ? "Este dispositivo quedó registrado para recibir notificaciones push."
              : (result?.message || "Permiso concedido, pero no se pudo registrar este dispositivo para recibir notificaciones push.");
          } catch (error) {
            console.warn("No se pudo activar FCM:", error);
            status.textContent = "Permiso concedido, pero no se pudo registrar este dispositivo para recibir notificaciones push.";
          }
        } else if (permission === "denied") {
          status.textContent = "El permiso fue bloqueado. Puedes habilitar las notificaciones desde los ajustes del navegador.";
          enableButton.remove();
        } else {
          status.textContent = "No se concedió el permiso. Puedes volver a intentarlo desde los ajustes del navegador.";
          enableButton.disabled = false;
        }
      } catch (error) {
        console.warn("Falló la solicitud de permiso de notificaciones:", error);
        status.textContent = "No se pudo solicitar el permiso. Revisa los ajustes del navegador.";
        enableButton.disabled = false;
      }
      await serviceWorkerReady;
    });

    const dismissButton = document.createElement("button");
    dismissButton.id = "conectaNotificationDismiss";
    dismissButton.type = "button";
    dismissButton.textContent = "Ahora no";
    dismissButton.addEventListener("click", () => {
      try { sessionStorage.setItem("conecta-notifications-dismissed", "1"); } catch {}
      hideNotificationCard();
    });
    actions.append(enableButton, dismissButton);
    notificationCard.append(copy, actions);
    document.body.appendChild(notificationCard);
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    createInstallCard();
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    hideInstallCard();
    createNotificationCard();
  });

  if (isStandalone) {
    createNotificationCard();
  } else {
    // En iOS no existe beforeinstallprompt; se ofrece una guía para Safari.
    window.setTimeout(createInstallCard, 1800);
  }
})();
