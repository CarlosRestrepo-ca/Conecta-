/// script.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
    where,
  orderBy,
  limit,
  onSnapshot,
    updateDoc,
  addDoc,
  increment,
  serverTimestamp,
  deleteDoc,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-storage.js";

import {
  getMessaging,
  getToken,
  onMessage,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyBFadmAn_msK29B3Hj-NyXs3dNiMPEH5eE",
  authDomain: "conecta-f0162.firebaseapp.com",
  projectId: "conecta-f0162",
  storageBucket: "conecta-f0162.firebasestorage.app",
  messagingSenderId: "483948542084",
  appId: "1:483948542084:web:ac512a6e91c87a5ea0ead1",
  measurementId: "G-99SX22B1DC",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth();
const db = getFirestore();
const storage = getStorage();

// Firebase Messaging no está disponible en todos los navegadores, especialmente en iOS.
// Si no es compatible, la aplicación continúa funcionando sin notificaciones push.
let messaging = null;
try {
  messaging = getMessaging(app);
} catch (error) {
  console.warn("Las notificaciones push no están disponibles en este navegador.");
}

let currentUser = null;

function showAuthScreen() {
  const authSection = document.getElementById("authSection");
  const appElement = document.getElementById("app");
  if (appElement) appElement.style.display = "flex";
  if (!authSection) return;

  authSection.hidden = false;
  authSection.classList.remove("hidden");
  Object.assign(authSection.style, {
    display: "block",
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100dvh",
    maxWidth: "none",
    margin: "0",
    overflowY: "auto",
    background: "white",
    zIndex: "11000",
  });
}

function hideAuthScreen() {
  const authSection = document.getElementById("authSection");
  if (!authSection) return;
  authSection.classList.add("hidden");
  authSection.hidden = true;
  ["display", "position", "inset", "width", "height", "max-width", "margin", "overflow-y", "background", "z-index"]
    .forEach((property) => authSection.style.removeProperty(property));
}

let lastAuthenticatedUser = auth.currentUser;
onAuthStateChanged(auth, (user) => {
  const justSignedOut = Boolean(lastAuthenticatedUser && !user);
  lastAuthenticatedUser = user;
  if (justSignedOut) {
    setTimeout(() => {
      if (!auth.currentUser) showAuthScreen();
    }, 0);
  }
});
let unsubscribePosts = null;
let postsListenerGeneration = 0;
let unsubscribeMessages = null;
let darkMode = false;
let chatWithUser = null; // current chat opened (uid)
let chatOpenGeneration = 0;
let chatImageData = null; // store current chat image data to send
let chatReadReceiptsDisabled = false;

function getChatId(friendId = chatWithUser) {
  return currentUser && friendId ? [currentUser.uid, friendId].sort().join("_") : "";
}

async function getChatSettings(friendId = chatWithUser) {
  const chatId = getChatId(friendId);
  if (!chatId) return {};
  const settingsSnap = await getDoc(doc(db, "chatSettings", chatId));
  return settingsSnap.exists() ? settingsSnap.data() : {};
}

function renderChatOptions() {
  const container = document.getElementById("chatOptionsContainer");
  if (!container) return;
  container.innerHTML = "";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chat-options-button";
  button.textContent = "°°°";
  button.title = "Opciones del chat";
  button.setAttribute("aria-label", "Opciones del chat");
  const menu = document.createElement("div");
  menu.className = "chat-options-menu hidden";
  const deleteAll = document.createElement("button");
  deleteAll.type = "button";
  deleteAll.textContent = "Eliminar todo el chat";
  const receipts = document.createElement("button");
  receipts.type = "button";
  receipts.textContent = chatReadReceiptsDisabled
    ? "Activar confirmaciones de lectura"
    : "Desactivar confirmaciones de lectura";
  deleteAll.onclick = async () => {
    if (!currentUser || !chatWithUser || !confirm("¿Eliminar todos los mensajes de este chat?")) return;
    try {
      const messagesSnap = await getDocs(collection(db, "chats", getChatId(), "messages"));
      await Promise.all(messagesSnap.docs.map((message) => deleteDoc(message.ref)));
      menu.classList.add("hidden");
      elements.chatMessages.innerHTML = "";
      refreshConversationPreviews();
    } catch (error) {
      alert("No se pudo eliminar el chat: " + error.message);
    }
  };
  receipts.onclick = async () => {
    try {
      chatReadReceiptsDisabled = !chatReadReceiptsDisabled;
      await setDoc(doc(db, "chatSettings", getChatId()), {
        readReceiptsDisabledFor: chatReadReceiptsDisabled ? currentUser.uid : null,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      receipts.textContent = chatReadReceiptsDisabled
        ? "Activar confirmaciones de lectura"
        : "Desactivar confirmaciones de lectura";
      menu.classList.add("hidden");
    } catch (error) {
      chatReadReceiptsDisabled = !chatReadReceiptsDisabled;
      alert("No se pudo actualizar esta opción: " + error.message);
    }
  };
  menu.append(deleteAll, receipts);
  button.onclick = (event) => {
    event.stopPropagation();
    menu.classList.toggle("hidden");
  };
  container.append(button, menu);
  document.addEventListener("click", () => menu.classList.add("hidden"), { once: true });
}

// Añade una vista previa del último mensaje en cada conversación.
async function refreshConversationPreviews() {
  if (!currentUser || !elements.usersInMessages) return;

  try {
    const ownSnap = await getDoc(doc(db, "users", currentUser.uid));
    const ownData = ownSnap.exists() ? ownSnap.data() : {};
    const friendIds = [...new Set(ownData.friends || [])].filter((uid) => uid !== currentUser.uid);
    const people = await Promise.all(friendIds.map(async (uid) => {
      const snap = await getDoc(doc(db, "users", uid));
      return { uid, data: snap.exists() ? snap.data() : {} };
    }));

    const buttons = [...elements.usersInMessages.querySelectorAll("button")];
    for (const button of buttons) {
      if (button.querySelector(".conversation-preview")) continue;
      const buttonText = normalizeSearchText(button.textContent);
      const person = people.find(({ uid, data }) =>
        button.dataset.uid === uid
        || buttonText.includes(normalizeSearchText(data.profile?.name || data.username))
      );
      if (!person) continue;

      const chatId = [currentUser.uid, person.uid].sort().join("_");
      const messagesSnap = await getDocs(query(
        collection(db, "chats", chatId, "messages"),
        orderBy("timestamp", "desc")
      ));
      const lastMessage = messagesSnap.docs[0]?.data();
      const preview = document.createElement("span");
      preview.className = "conversation-preview";
      preview.textContent = lastMessage
        ? `${lastMessage.sender === currentUser.uid ? "Tú: " : ""}${lastMessage.message || (lastMessage.image ? "📷 Imagen" : "Mensaje")}`
        : "Sin mensajes aún";
      button.appendChild(preview);
    }
  } catch (error) {
    console.warn("No se pudieron cargar las vistas previas de mensajes:", error);
  }
}

const reactionEmojis = ["❤️", "😢", "🤣", "😡", "🙏🏻", "🤗", "😈"];

const verifiedIconUrl =
  "https://uploads.onecompiler.io/448k9pkeq/448kbzjkm/verificar%20(1).png";
const verifiedNames = new Set(["Carlos Restrepo", "La oya activo"]);
const verifiedIconHTML = `<img class="verified-icon" src="${verifiedIconUrl}" alt="Verificado" aria-label="Usuario verificado" />`;

function isVerifiedName(name) {
  return verifiedNames.has(String(name || "").trim());
}

function renderDisplayName(container, name) {
  const safeName = String(name || "Desconocido").trim() || "Desconocido";
  container.textContent = safeName;
  if (isVerifiedName(safeName)) {
    const icon = document.createElement("img");
    icon.className = "verified-icon";
    icon.src = verifiedIconUrl;
    icon.alt = "Verificado";
    icon.title = "Usuario verificado";
    icon.setAttribute("aria-label", "Usuario verificado");
    container.appendChild(icon);
  }
}

const elements = {
  btnHome: document.getElementById("btnHome"),
  btnNotifications: document.getElementById("btnNotifications"),
  btnUsers: document.getElementById("btnUsers"),
  btnProfile: document.getElementById("btnProfile"),
  btnMessages: document.getElementById("btnMessages"),
  btnThemeToggle: document.getElementById("btnThemeToggle"),
  btnSettings: document.getElementById("btnSettings"),
    settingsMenu: document.getElementById("settingsMenu"),
  btnOpenSettings: document.getElementById("btnOpenSettings"),
  btnInviteFriend: document.getElementById("btnInviteFriend"),
  btnInviteFriendFromSettings: document.getElementById("btnInviteFriendFromSettings"),
  settingsModal: document.getElementById("settingsModal"),
  settingsDetailModal: document.getElementById("settingsDetailModal"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  closeSettingsDetailBtn: document.getElementById("closeSettingsDetailBtn"),
  btnLanguageSettings: document.getElementById("btnLanguageSettings"),
  btnPrivacyPolicies: document.getElementById("btnPrivacyPolicies"),
  btnActiveStatus: document.getElementById("btnActiveStatus"),
  btnAccountPrivacy: document.getElementById("btnAccountPrivacy"),
    btnTermsSettings: document.getElementById("btnTermsSettings"),
  btnAcademicPortals: document.getElementById("btnAcademicPortals"),
  activeStatusSummary: document.getElementById("activeStatusSummary"),
  settingsDetailTitle: document.getElementById("settingsDetailTitle"),
  settingsDetailContent: document.getElementById("settingsDetailContent"),
  btnManual: document.getElementById("btnManual"),
  btnLogout: document.getElementById("btnLogout"),
  notificationBadge: document.getElementById("notificationBadge"),
  globalPersonSearch: document.getElementById("globalPersonSearch"),
  globalPostDateSearch: document.getElementById("globalPostDateSearch"),
  globalSearchResults: document.getElementById("globalSearchResults"),

  postSection: document.getElementById("postSection"),
  postForm: document.getElementById("postForm"),
  postInput: document.getElementById("postInput"),
  postsContainer: document.getElementById("postsContainer"),
  suggestionsList: document.getElementById("suggestionsList"),

  usersSection: document.getElementById("usersSection"),
  usersList: document.getElementById("users"),
  searchUser: document.getElementById("searchUser"),
  closeUsersBtn: document.getElementById("closeUsersBtn"),

  notificationsSection: document.getElementById("notificationsSection"),
  notificationsList: document.getElementById("notificationsList"),
  closeNotificationsBtn: document.getElementById("closeNotificationsBtn"),
  markAllReadBtn: document.getElementById("markAllReadBtn"),

  profileSection: document.getElementById("profileSection"),
  profileForm: document.getElementById("profileForm"),
  profileName: document.getElementById("profileName"),
  profilePic: document.getElementById("profilePic"),
  profilePreview: document.getElementById("profilePreview"),
  birthDate: document.getElementById("birthDate"),
  civilStatus: document.getElementById("civilStatus"),
  birthPlace: document.getElementById("birthPlace"),
  closeProfileBtn: document.getElementById("closeProfileBtn"),

  messagesSection: document.getElementById("messagesSection"),
  usersInMessages: document.getElementById("usersInMessages"),
  chatWindow: document.getElementById("chatWindow"),
  closeChatBtn: document.getElementById("closeChatBtn"),
  chatWithName: document.getElementById("chatWithName"),
  chatMessages: document.getElementById("chatMessages"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  chatImageInput: document.getElementById("chatImageInput"),
  chatImagePreview: document.getElementById("chatImagePreview"),
  chatImageClearBtn: document.getElementById("chatImageClearBtn"),

  userInfoSection: document.getElementById("userInfoSection"),
  userInfoPic: document.getElementById("userInfoPic"),
  userInfoName: document.getElementById("userInfoName"),
  userInfoUsername: document.getElementById("userInfoUsername"),
  userInfoBirthDate: document.getElementById("userInfoBirthDate"),
    userInfoCivilStatus: document.getElementById("userInfoCivilStatus"),
  userInfoEmail: document.getElementById("userInfoEmail"),
  userInfoBirthPlace: document.getElementById("userInfoBirthPlace"),
  userInfoCareer: document.getElementById("userInfoCareer"),
  userInfoSemester: document.getElementById("userInfoSemester"),
  profileUserPosts: document.getElementById("profileUserPosts"),
  closeUserInfoBtn: document.getElementById("closeUserInfoBtn"),

  homeSection: document.getElementById("homeSection"),
    authSection: document.getElementById("authSection"),
  app: document.getElementById("app"),
  profileCareer: document.getElementById("profileCareer"),
  profileSemester: document.getElementById("profileSemester"),

  manualModal: document.getElementById("manualModal"),
  closeManualBtn: document.getElementById("closeManualBtn"),

  closeHomeBtn: document.getElementById("closeHomeBtn"),

  reactionsViewModal: document.getElementById("reactionsViewModal"),
  closeReactionsViewBtn: document.getElementById("closeReactionsViewBtn"),
  reactionsViewList: document.getElementById("reactionsViewList"),
};

// Añadido al inicio, define cloudinary info:
// Cloudinary usa el entorno de producto como cloud name. La API key no se expone
// en el navegador porque las subidas directas usan un upload preset sin firma.
const CLOUDINARY_CLOUD_NAME = "dv3g5otcv";
const CLOUDINARY_UPLOAD_PRESET = "a3trfid7";  

async function uploadToCloudinary(file) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || 'Error subiendo imagen a Cloudinary.');
  }
  return data.secure_url; // URL de la imagen subida
}






// Theme toggle moved inside settings menu
function setTheme(dark) {
  darkMode = dark;
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  elements.btnThemeToggle.textContent = dark ? "☀️" : "🌙";
  localStorage.setItem("darkMode", dark ? "1" : "0");
}
elements.btnThemeToggle.onclick = () => setTheme(!darkMode);
const savedTheme = localStorage.getItem("darkMode");
if (savedTheme === "1") setTheme(true);
else setTheme(false);

// Section navigation
let activeTab = "home";
let previousTab = "home";

function activateTab(tab) {
  if (tab !== activeTab) previousTab = activeTab;
  activeTab = tab;
  window.activateTab = activateTab;


  elements.btnHome.classList.remove("active");
  elements.btnUsers.classList.remove("active");
  elements.btnProfile.classList.remove("active");
  elements.btnNotifications.classList.remove("active");
  elements.btnMessages.classList.remove("active");

  elements.homeSection.classList.add("hidden");
  elements.usersSection.classList.add("hidden");
  elements.profileSection.classList.add("hidden");
  elements.notificationsSection.classList.add("hidden");
  elements.messagesSection.classList.add("hidden");
  elements.userInfoSection.classList.add("hidden");
    elements.reactionsViewModal.classList.add("hidden"); // close reactions view when switching tabs

  // Keep a chat opened just before switching to Messages; clean it only when leaving that tab.
  if (tab !== "messages") {
    if (previousTab === "messages") {
      if (unsubscribeMessages) {
        unsubscribeMessages();
        unsubscribeMessages = null;
      }
      clearChatMessages();
    }
    chatWithUser = null;
  }

  switch (tab) {
        case "home":
      elements.btnHome.classList.add("active");
      elements.homeSection.classList.remove("hidden");
      if (currentUser) startPostsListener();
      else stopPostsListener();
      if (currentUser) {

        elements.postSection.classList.remove("hidden");
                renderFriendSuggestions();
        loadFriendBirthdays();
      } else {
        elements.postSection.classList.add("hidden");
      }
      break;
    case "users":
      elements.btnUsers.classList.add("active");
      elements.usersSection.classList.remove("hidden");
      stopPostsListener();
      elements.postSection.classList.add("hidden");
      renderUsers(elements.searchUser.value.trim()); // ensures real-time refresh
      break;
    case "profile":
      elements.btnProfile.classList.add("active");
      elements.profileSection.classList.remove("hidden");
      stopPostsListener();
      elements.postSection.classList.add("hidden");
      loadProfile();
      break;
    case "notifications":
      elements.btnNotifications.classList.add("active");
      elements.notificationsSection.classList.remove("hidden");
      stopPostsListener();
      elements.postSection.classList.add("hidden");
      loadNotifications();
      break;
    case "messages":
      elements.btnMessages.classList.add("active");
      elements.messagesSection.classList.remove("hidden");
      stopPostsListener();
      elements.postSection.classList.add("hidden");
                        renderConversations();
      break;
  }
}

// Nav button events
elements.btnHome.onclick = () => activateTab("home");
elements.btnUsers.onclick = () => activateTab("users");
elements.btnProfile.onclick = () => activateTab("profile");
elements.btnNotifications.onclick = () => activateTab("notifications");
elements.btnMessages.onclick = () => activateTab("messages");

elements.closeUsersBtn.onclick = () => activateTab(previousTab || "home");
elements.closeNotificationsBtn.onclick = () => activateTab(previousTab || "home");
elements.closeProfileBtn.onclick = () => activateTab(previousTab || "home");
elements.closeHomeBtn.onclick = () => activateTab(previousTab || "home");

// Settings menu toggle
elements.btnSettings.onclick = (e) => {
  e.stopPropagation();
  elements.settingsMenu.classList.toggle("hidden");
};
document.body.addEventListener("click", () => {
  if (!elements.settingsMenu.classList.contains("hidden")) {
    elements.settingsMenu.classList.add("hidden");
  }
});

// Manual modal open/close
elements.btnManual.onclick = () => {
  elements.settingsMenu.classList.add("hidden");
  elements.manualModal.classList.remove("hidden");
};
elements.closeManualBtn.onclick = () => {
  elements.manualModal.classList.add("hidden");
};

// Centro de configuración: preferencias locales y datos de privacidad en Firestore.
const settingsState = { userData: null };
function closeSettingsDetail() { elements.settingsDetailModal?.classList.add("hidden"); }
function openSettingsDetail(title, content) {
  elements.settingsDetailTitle.textContent = title;
  elements.settingsDetailContent.innerHTML = content;
  elements.settingsModal.classList.add("hidden");
  elements.settingsDetailModal.classList.remove("hidden");
}
async function getSettingsUserData() {
  if (!currentUser) return {};
  const snap = await getDoc(doc(db, "users", currentUser.uid));
  settingsState.userData = snap.exists() ? snap.data() : {};
  return settingsState.userData;
}
function privacySelect(label, key, value) {
  const safeValue = ["public", "friends", "private"].includes(value) ? value : "public";
  return `<label>${label}<select data-privacy-key="${key}"><option value="public" ${safeValue === "public" ? "selected" : ""}>Público</option><option value="friends" ${safeValue === "friends" ? "selected" : ""}>Amigos</option><option value="private" ${safeValue === "private" ? "selected" : ""}>Solo yo</option></select></label>`;
}
async function showAccountPrivacy() {
  const data = await getSettingsUserData();
  const privacy = data.privacy || {};
  openSettingsDetail("Privacidad de la cuenta", `<p>Elige quién puede consultar cada dato de tu perfil.</p>${privacySelect("¿Quién puede ver tu fecha de nacimiento?", "birthDate", privacy.birthDate || "public")}${privacySelect("¿Quién puede ver tu estado civil?", "civilStatus", privacy.civilStatus || "public")}${privacySelect("¿Quién puede ver tu correo electrónico?", "email", privacy.email || "private")}<button class="settings-action" id="savePrivacySettings">Guardar privacidad</button>`);
  document.getElementById("savePrivacySettings").onclick = async () => {
    const privacyData = Object.fromEntries([...elements.settingsDetailContent.querySelectorAll("[data-privacy-key]")].map((select) => [select.dataset.privacyKey, select.value]));
    try { await updateDoc(doc(db, "users", currentUser.uid), { privacy: privacyData }); alert("Privacidad actualizada."); closeSettingsDetail(); } catch (error) { alert("No se pudo guardar la privacidad: " + error.message); }
  };
}
const translations = {
  "Inicio": "Home", "Notificaciones": "Notifications", "Usuarios": "Users", "Perfil": "Profile", "Mensajes": "Messages", "Ajustes": "Settings", "Asistencia": "Assistance", "Cerrar sesión": "Log out",
  "Manual de uso": "User guide", "Manual de Uso": "User Guide", "Configuración": "Settings", "Preferencias de tu cuenta": "Your account preferences", "Invitar amigo": "Invite a friend", "¿Qué tienes en mente?": "What's on your mind?", "Público": "Public", "Amigos": "Friends", "Solo yo": "Only me", "Publicar": "Post", "Subir": "Upload",
  "Descubre personas": "Discover people", "Sugerencias de amistad": "Friend suggestions", "Conecta con personas de tu comunidad.": "Connect with people in your community.", "Cargando sugerencias…": "Loading suggestions…", "No hay nuevas sugerencias por ahora.": "There are no new suggestions right now.", "No se pudieron cargar las sugerencias.": "Suggestions could not be loaded.", "Añadir": "Add", "Enviando…": "Sending…", "Enviada": "Sent", "Agregar": "Add", "Próximo cumpleaños": "Upcoming birthday", "Ver celebración": "View celebration", "Tu círculo cercano": "Your close circle", "Buscando entre tus amigos…": "Searching among your friends…", "Aún no hay fechas registradas entre tus amigos.": "No dates are registered among your friends yet.",
  "Buscar persona por nombre": "Search people by name", "Buscar publicaciones por fecha": "Search posts by date", "Buscar usuario exacto": "Search for an exact username", "Marcar todo como leído": "Mark all as read", "Escribe un mensaje...": "Write a message...", "Enviar": "Send", "Eliminar imagen": "Remove image", "Personas Online": "Online people", "No hay usuarios en línea.": "No users are online.", "Volver a Conversaciones": "Back to conversations", "Sin mensajes aún": "No messages yet", "No tienes amigos agregados para chatear.": "You have no friends to chat with.", "Cargando comentarios...": "Loading comments...", "Sin comentarios.": "No comments.", "No se pudieron cargar los comentarios.": "Comments could not be loaded.", "Escribe un comentario...": "Write a comment...", "Escribe tu respuesta...": "Write your reply...", "Responder": "Reply", "Eliminar": "Delete", "Eliminar publicación": "Delete post", "Compartir publicación": "Share post", "Opciones de publicación": "Post options", "Ver personas que reaccionaron": "View people who reacted", "Mantén presionado para opciones de reacción": "Press and hold for reaction options",
  "Perfil de Usuario": "User Profile", "Nombre de usuario": "Username", "Nombre completo:": "Full name:", "Foto de perfil:": "Profile photo:", "Fecha de nacimiento:": "Date of birth:", "Estado civil:": "Marital status:", "Estado civil": "Marital status", "Correo electrónico": "Email", "Selecciona": "Select", "Soltero/a": "Single", "Casado/a": "Married", "Otro": "Other", "Carrera:": "Career:", "Carrera": "Career", "Semestre:": "Semester:", "Semestre": "Semester", "Lugar de nacimiento:": "Place of birth:", "Lugar de nacimiento": "Place of birth", "Guardar perfil": "Save profile", "Publicaciones": "Posts", "Vista previa foto perfil": "Profile photo preview", "Imagen de la publicación": "Post image", "Imagen enviada": "Sent image",
  "Reacciones": "Reactions", "Iniciar sesión": "Log in", "Correo electrónico:": "Email:", "Contraseña:": "Password:", "Confirmar contraseña:": "Confirm password:", "Regístrate": "Sign up", "Registrarse": "Register", "Cerrar": "Close", "¿Olvidaste tu contraseña?": "Forgot your password?", "Registrar usuario": "Register user", "Aceptar": "Accept", "Términos y condiciones de CONECTA": "CONECTA Terms and Conditions", "Acepto los Términos y condiciones": "I accept the Terms and Conditions",
  "Configuración de idioma": "Language settings", "Selecciona el idioma principal de la aplicación.": "Select the app's primary language.", "Español o English": "Spanish or English", "Español": "Spanish", "Idioma": "Language", "Guardar idioma": "Save language", "Portales académicos": "Academic portals", "Acceso a plataformas universitarias": "Access university platforms", "Selecciona el portal al que deseas ingresar:": "Select the portal you want to access:", "Acceso a SIMA": "Access SIMA", "Acceso a SMA": "Access SMA", "Acceso a SIMA INGLÉS": "Access SIMA ENGLISH", "Biblioteca Virtual - UDC": "Virtual Library - UDC", "Políticas de privacidad": "Privacy policies", "Consulta cómo protegemos tus datos": "Learn how we protect your data", "Estado activo": "Active status", "Visible para tus amigos": "Visible to your friends", "Oculto para los demás": "Hidden from others", "Privacidad de la cuenta": "Account privacy", "Controla quién ve tu información": "Control who can see your information", "Términos y condiciones": "Terms and Conditions", "Consulta las condiciones de uso de CONECTA": "View CONECTA's terms of use", "Copia o comparte el enlace de CONECTA": "Copy or share the CONECTA link", "Copiar": "Copy", "Compartir enlace": "Share link", "Solicitar asistencia vía WhatsApp": "Request assistance via WhatsApp", "Modo claro/oscuro": "Light/dark mode", "Alternar tema visual": "Toggle visual theme",
  "Abrir chat": "Open chat", "Conversaciones": "Conversations", "Opciones del chat": "Chat options", "Eliminar todo el chat": "Delete entire chat", "Activar confirmaciones de lectura": "Enable read receipts", "Desactivar confirmaciones de lectura": "Disable read receipts", "Ventana de chat": "Chat window", "Enviar imagen": "Send image", "Eliminar imagen": "Remove image", "Nota de voz": "Voice note", "Reproducir nota de voz": "Play voice note", "Pausar nota de voz": "Pause voice note", "Enviado:": "Sent:", "Leído:": "Read:", "Abrir carta de cumpleaños": "Open birthday letter",
  "Foto de perfil usuario": "User profile photo", "Perfil usuario completo": "Full user profile", "Cerrar perfil": "Close profile", "Cerrar usuarios": "Close users", "Cerrar notificaciones": "Close notifications", "Cerrar inicio": "Close home", "Cerrar configuración": "Close settings", "Cerrar ventana": "Close window", "Cerrar carta": "Close letter", "Cerrar registro": "Close registration", "Reacciones de la publicación": "Post reactions",
  "No se encontraron personas.": "No people found.", "No se pudo realizar la búsqueda.": "The search could not be completed.", "Error cargando usuarios.": "Error loading users.", "Inicia sesión para ver usuarios.": "Log in to see users.", "No hay nuevas notificaciones.": "No new notifications.", "Inicia sesión para ver notificaciones.": "Log in to see notifications.", "Error cargando conversaciones.": "Error loading conversations.", "Nueva Red social Web.": "New social web network.", "Una celebración especial": "A special celebration", "¡Feliz cumpleaños!": "Happy birthday!", "Diseño de la carta": "Card design", "Para mujer · Aurora floral": "For women · Floral aurora", "Para hombre · Cielo nocturno": "For men · Night sky", "Mensaje de felicitación": "Birthday message", "Escribe un mensaje especial…": "Write a special message…", "Enviar felicitación": "Send birthday wishes", "Esta carta es una celebración compartida y solo puede leerse.": "This card is a shared celebration and can only be read.",
    "No se pudieron cargar las publicaciones.": "Posts could not be loaded.", "Esta persona todavía no ha realizado publicaciones.": "This person has not published anything yet.", "No se pudieron cargar las vistas previas de mensajes:": "Conversation previews could not be loaded:", "No se pudieron cargar los comentarios.": "Comments could not be loaded.", "No se pudieron cargar las sugerencias.": "Suggestions could not be loaded.", "No se pudo enviar la solicitud: ": "The request could not be sent: ", "No se pudo actualizar esta opción: ": "This option could not be updated: ", "No se pudo eliminar el chat: ": "The chat could not be deleted: ", "No se pudo guardar la privacidad: ": "Privacy could not be saved: ", "No se pudo guardar el estado: ": "Status could not be saved: ", "No se pudo copiar el enlace.": "The link could not be copied.", "Enlace copiado.": "Link copied.", "No se pudo enviar la felicitación: ": "Birthday wishes could not be sent: ", "La felicitación fue enviada al chat.": "Birthday wishes were sent to the chat.", "Error al publicar: ": "Error posting: ", "Error al publicar texto: ": "Error posting text: ", "Error al subir archivo: ": "Error uploading file: ", "Archivo publicado correctamente.": "File posted successfully.", "Publicación no encontrada o eliminada.": "Post not found or deleted.", "Debes iniciar sesión.": "You must log in.", "Debes iniciar sesión para publicar.": "You must log in to post.", "Debes iniciar sesión para comentar.": "You must log in to comment.", "Inicia sesión para reaccionar.": "Log in to react.", "Inicia sesión para comentar.": "Log in to comment.", "¿Cerrar sesión?": "Log out?", "¿Eliminar esta publicación?": "Delete this post?", "¿Eliminar este comentario?": "Delete this comment?", "¿Eliminar este mensaje?": "Delete this message?", "¿Eliminar todos los mensajes de este chat?": "Delete all messages in this chat?", "Error eliminando comentario.": "Error deleting comment.", "Error eliminando publicación: ": "Error deleting post: ", "No se pudo eliminar el mensaje.": "The message could not be deleted.", "No se pudo realizar la búsqueda.": "The search could not be completed.", "Cargando…": "Loading…"
};

function translateText(value) {
  const text = String(value ?? "");
  const trimmed = text.trim();
  if (!trimmed) return value;

  // Traduce también frases dinámicas frecuentes sin modificar el contenido escrito por usuarios.
  const dynamicTranslations = [
    [/^Tú:\s*/, "You: "],
    [/^Para (.+)$/, "To $1"],
    [/^De (.+)$/, "From $1"],
    [/^Próximo:\s*/, "Next: "],
    [/^Próximos 3 días:\s*/, "Next 3 days: "],
    [/^Hoy celebra (.+)$/, "$1's birthday is today"],
    [/^(.+) celebra hoy$/, "$1's birthday is today"],
    [/^en (\d+) día$/, "in $1 day"],
    [/^en (\d+) días$/, "in $1 days"],
    [/^Respondiendo a (.+)$/, "Replying to $1"],
    [/^↳ Respuesta a (.+)$/, "↳ Reply to $1"],
    [/^(.+) reaccionó con (.+) a tu publicación\.$/, "$1 reacted with $2 to your post."],
    [/^(.+) comentó en tu publicación: (.+)$/, "$1 commented on your post: $2"],
    [/^(.+) ha respondido a tu comentario: (.+)$/, "$1 replied to your comment: $2"],
    [/^(.+) te envió una solicitud de amistad\.$/, "$1 sent you a friend request."],
    [/^No se pudo (.+):\s*(.*)$/, "Could not $1: $2"],
    [/^Error (.+):\s*(.*)$/, "Error $1: $2"],
    [/^Debes iniciar sesión(.+)$/, "You must log in$1"],
    [/^¿Eliminar (.+)\?$/, "Delete $1?"],
    [/^(.+):\s*$/, "$1: "],
    [/^@(.+)$/, "@$1"],
  ];
  for (const [pattern, replacement] of dynamicTranslations) {
    if (pattern.test(trimmed)) return text.replace(trimmed, trimmed.replace(pattern, replacement));
  }
  const exactTranslation = translations[trimmed];
  if (exactTranslation) return text.replace(trimmed, exactTranslation);

  // Traduce fragmentos de textos largos pertenecientes a la interfaz, como el manual y los términos.
  const phraseTranslations = [
    ["Al acceder y utilizar la plataforma", "By accessing and using the platform"],
    ["el usuario acepta", "the user accepts"],
    ["los presentes términos y condiciones", "these terms and conditions"],
    ["que rigen el uso de esta red social", "that govern the use of this social network"],
    ["CONECTA está diseñada como", "CONECTA is designed as"],
    ["destinado a facilitar la comunicación en tiempo real", "intended to facilitate real-time communication"],
    ["permitiendo a los usuarios establecer vínculos", "allowing users to build connections"],
    ["mediante la creación de redes de amigos", "by creating friend networks"],
    ["el intercambio de mensajes instantáneos", "exchanging instant messages"],
    ["y la publicación de contenido multimedia e interacciones sociales", "and sharing multimedia content and social interactions"],
    ["En cumplimiento con las normativas vigentes de protección de datos personales", "In compliance with current personal data protection regulations"],
    ["la plataforma se compromete a tratar", "the platform commits to handling"],
    ["bajo los más estrictos principios de seguridad, confidencialidad y transparencia", "under the strictest principles of security, confidentiality, and transparency"],
    ["El usuario reconoce que es el único responsable", "The user acknowledges that they are solely responsible"],
    ["La plataforma se reserva el derecho de moderar el contenido", "The platform reserves the right to moderate content"],
    ["para asegurar un ambiente seguro", "to ensure a safe environment"],
    ["Bienvenido a", "Welcome to"],
    ["Aquí puedes:", "Here you can:"],
    ["Publicar mensajes, fotos e imágenes en el inicio.", "Post messages, photos, and images on the home page."],
    ["Ver, reaccionar y comentar publicaciones.", "View, react to, and comment on posts."],
    ["Buscar y agregar amigos.", "Search for and add friends."],
    ["Chatear con amigos en tiempo real (textos - audios).", "Chat with friends in real time (text and audio)."],
    ["Ver notificaciones de distintas actividades en tiempo real.", "View notifications about different activities in real time."],
    ["Gestionar tu perfil, foto e información.", "Manage your profile, photo, and information."],
    ["Alternar entre modo oscuro y claro.", "Switch between dark and light mode."],
    ["Nueva Red social Web.", "New social web network."],
  ];
  return phraseTranslations.reduce((result, [spanish, english]) => result.replaceAll(spanish, english), text);
}

// También traduce mensajes del navegador generados por acciones de la interfaz.
const nativeAlert = window.alert.bind(window);
const nativeConfirm = window.confirm.bind(window);
const nativePrompt = window.prompt.bind(window);
window.alert = (message) => nativeAlert((localStorage.getItem("appLanguage") || "es") === "en" ? translateText(message) : message);
window.confirm = (message) => nativeConfirm((localStorage.getItem("appLanguage") || "es") === "en" ? translateText(message) : message);
window.prompt = (message, defaultValue) => nativePrompt((localStorage.getItem("appLanguage") || "es") === "en" ? translateText(message) : message, defaultValue);

// Se conservan los textos originales para poder volver a Español sin recargar.
const languageOriginalText = new WeakMap();
const languageOriginalAttributes = new WeakMap();
let isApplyingLanguage = false;

function shouldTranslateNode(node) {
  const parent = node.parentElement;
  return Boolean(parent)
    && !parent.closest("script, style, textarea, [data-no-translate], .post-text, .message, .comment-text")
    && !parent.closest("input");
}

function translateElementText(element, language) {
  if (!element || element.closest("script, style, textarea, [data-no-translate]")) return;
  const english = language === "en";
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (shouldTranslateNode(node) && node.nodeValue.trim()) nodes.push(node);
  }
  nodes.forEach((textNode) => {
    if (!languageOriginalText.has(textNode)) languageOriginalText.set(textNode, textNode.nodeValue);
    const original = languageOriginalText.get(textNode);
    textNode.nodeValue = english ? translateText(original) : original;
  });
}

function applyLanguage(language = localStorage.getItem("appLanguage") || "es") {
  const normalizedLanguage = language === "en" ? "en" : "es";
  // Evita que el propio proceso de traducción dispare al observador en bucle.
  languageObserver?.disconnect();
  document.documentElement.lang = normalizedLanguage;
  document.documentElement.dataset.language = normalizedLanguage;
  isApplyingLanguage = true;

  translateElementText(document.body, normalizedLanguage);
  const localizedLongText = {
    termsDesc: {
      es: "Al acceder y utilizar la plataforma CONECTA, el usuario acepta de manera integral los presentes términos y condiciones que rigen el uso de esta red social. CONECTA está diseñada como un ecosistema digital destinado a facilitar la comunicación en tiempo real, permitiendo a los usuarios establecer vínculos mediante la creación de redes de amigos, el intercambio de mensajes instantáneos y la publicación de contenido multimedia e interacciones sociales. En cumplimiento con las normativas vigentes de protección de datos personales, la plataforma se compromete a tratar la información del perfil, las listas de contactos y el contenido generado por el usuario bajo los más estrictos principios de seguridad, confidencialidad y transparencia. El usuario reconoce que es el único responsable de la veracidad de la información proporcionada y del comportamiento ético dentro de la comunidad, garantizando que sus publicaciones respeten los derechos de terceros y las normas de convivencia digital. CONECTA implementa medidas técnicas de vanguardia para asegurar la privacidad de los datos; no obstante, el usuario es responsable de la gestión de sus credenciales de acceso. La plataforma se reserva el derecho de moderar el contenido para asegurar un ambiente seguro y de actualizar estos términos para adaptarlos a la evolución tecnológica o cambios legislativos, manteniendo siempre la integridad y la protección de la identidad de sus miembros como pilares fundamentales del servicio.",
      en: "By accessing and using the CONECTA platform, the user fully accepts these terms and conditions governing the use of this social network. CONECTA is designed as a digital ecosystem intended to facilitate real-time communication, allowing users to build connections through friend networks, instant messaging, multimedia content sharing, and social interactions. In compliance with current personal data protection regulations, the platform is committed to handling profile information, contact lists, and user-generated content according to the strictest principles of security, confidentiality, and transparency. The user acknowledges that they are solely responsible for the accuracy of the information provided and for ethical behavior within the community, ensuring that their posts respect third-party rights and digital coexistence rules. CONECTA implements advanced technical measures to protect data privacy; however, the user is responsible for managing their access credentials. The platform reserves the right to moderate content to ensure a safe environment and to update these terms to reflect technological developments or legislative changes, while always maintaining the integrity and protection of its members’ identities as fundamental principles of the service."
    }
  };
  Object.entries(localizedLongText).forEach(([id, values]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = values[normalizedLanguage];
  });

  document.querySelectorAll("input, textarea, select, button, [title], [aria-label]").forEach((element) => {
    ["placeholder", "title", "aria-label"].forEach((attribute) => {
      if (!element.hasAttribute(attribute)) return;
      if (!languageOriginalAttributes.has(element)) languageOriginalAttributes.set(element, {});
      const originals = languageOriginalAttributes.get(element);
      if (!(attribute in originals)) originals[attribute] = element.getAttribute(attribute);
      element.setAttribute(attribute, normalizedLanguage === "en"
        ? translateText(originals[attribute])
        : originals[attribute]);
    });
    if (element.tagName === "OPTION") translateElementText(element, normalizedLanguage);
  });

  localStorage.setItem("appLanguage", normalizedLanguage);
  isApplyingLanguage = false;
  languageObserver?.observe(document.body, { childList: true, subtree: true });
}

// Traduce solo los nodos recién insertados para no recorrer todo el documento
// cada vez que llega un mensaje, comentario o actualización de Firestore.
function translateAddedNode(node) {
  if ((localStorage.getItem("appLanguage") || "es") !== "en") return;
  if (node.nodeType === Node.TEXT_NODE) {
    if (shouldTranslateNode(node) && node.nodeValue.trim()) {
      if (!languageOriginalText.has(node)) languageOriginalText.set(node, node.nodeValue);
      node.nodeValue = translateText(languageOriginalText.get(node));
    }
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  translateElementText(node, "en");
  const elementsToTranslate = [node, ...node.querySelectorAll("input, textarea, select, button, [title], [aria-label]")];
  elementsToTranslate.forEach((element) => {
    ["placeholder", "title", "aria-label"].forEach((attribute) => {
      if (!element.hasAttribute(attribute)) return;
      if (!languageOriginalAttributes.has(element)) languageOriginalAttributes.set(element, {});
      const originals = languageOriginalAttributes.get(element);
      if (!(attribute in originals)) originals[attribute] = element.getAttribute(attribute);
      element.setAttribute(attribute, translateText(originals[attribute]));
    });
    if (element.tagName === "OPTION") translateElementText(element, "en");
  });
}

const languageObserver = new MutationObserver((records) => {
  if (isApplyingLanguage || (localStorage.getItem("appLanguage") || "es") !== "en") return;
  records.forEach((record) => record.addedNodes.forEach(translateAddedNode));
});
languageObserver.observe(document.body, { childList: true, subtree: true });


function showLanguageSettings() {
  const current = localStorage.getItem("appLanguage") || "es";
  openSettingsDetail("Configuración de idioma", `<p>Selecciona el idioma principal de la aplicación.</p><label>Idioma<select id="appLanguageSelect"><option value="es" ${current === "es" ? "selected" : ""}>Español</option><option value="en" ${current === "en" ? "selected" : ""}>English</option></select></label><button class="settings-action" id="saveLanguageSettings">Guardar idioma</button>`);
  document.getElementById("saveLanguageSettings").onclick = () => {
    const language = document.getElementById("appLanguageSelect").value;
    localStorage.setItem("appLanguage", language);
    applyLanguage(language);
    alert(language === "en" ? "Language saved." : "Idioma guardado.");
    closeSettingsDetail();
  };
}

applyLanguage();
async function showActiveStatusSettings() {
  const data = await getSettingsUserData();
  const enabled = data.activeStatus !== false;
  openSettingsDetail("Estado activo", `<p>Cuando lo desactives, otras personas no podrán ver si estás en línea o tu última actividad.</p><label><input id="activeStatusToggle" type="checkbox" ${enabled ? "checked" : ""} style="width:auto;display:inline-block;margin-right:8px;"> Mostrar mi estado activo</label><button class="settings-action" id="saveActiveStatus">Guardar estado</button>`);
  document.getElementById("saveActiveStatus").onclick = async () => { const activeStatus = document.getElementById("activeStatusToggle").checked; try { await updateDoc(doc(db, "users", currentUser.uid), { activeStatus, online: activeStatus ? Boolean(data.online) : false }); elements.activeStatusSummary.textContent = activeStatus ? "Visible para tus amigos" : "Oculto para los demás"; closeSettingsDetail(); } catch (error) { alert("No se pudo guardar el estado: " + error.message); } };
}
async function showInviteSettings() {
  const inviteUrl = new URL(window.location.href); inviteUrl.hash = "registro";
  openSettingsDetail("Invitar amigo", `<p>Comparte este enlace para invitar a otras personas a registrarse en CONECTA.</p><div class="settings-copy-row"><input id="inviteUrl" readonly value="${inviteUrl.toString()}"><button class="settings-action" id="copyInviteUrl" type="button">Copiar</button></div><button class="settings-action" id="shareInviteUrl" type="button">Compartir enlace</button>`);
  document.getElementById("copyInviteUrl").onclick = async () => { try { await navigator.clipboard.writeText(inviteUrl.toString()); alert("Enlace copiado."); } catch { alert("No se pudo copiar el enlace."); } };
  document.getElementById("shareInviteUrl").onclick = async () => { if (navigator.share) { try { await navigator.share({ title: "Únete a CONECTA", text: "Te invito a registrarte en CONECTA", url: inviteUrl.toString() }); } catch {} } else document.getElementById("copyInviteUrl").click(); };
}
function showAcademicPortals() {
  const portalLinkStyle = "display:block;margin:12px 0;padding:16px;border-radius:14px;color:#fff;text-decoration:none;font-weight:700;text-align:center;box-shadow:0 8px 18px rgba(20,40,70,.16);";
  openSettingsDetail("Portales académicos", `<p>Selecciona el portal al que deseas ingresar:</p><a href="https://sima.unicartagena.edu.co/" target="_blank" rel="noopener noreferrer" style="${portalLinkStyle}background:#2176ff;">Acceso a SIMA</a><a href="https://sma.unicartagena.edu.co:8443/Smaix12/vista/mainMenu.jsp#" target="_blank" rel="noopener noreferrer" style="${portalLinkStyle}background:#15966b;">Acceso a SMA</a><a href="https://ingles.unicartagena.edu.co/login/index.php" target="_blank" rel="noopener noreferrer" style="${portalLinkStyle}background:#8b52c7;">Acceso a SIMA INGLÉS</a><a href="https://unicartagena.edu.co/biblioteca" target="_blank" rel="noopener noreferrer" style="${portalLinkStyle}background:#e67e22;">Biblioteca Virtual - UDC</a>`);
}

// Asistente de documentos: usa el endpoint autenticado de Cloud Functions; no expone la API key.
const assistantState = { documentText: "", documentName: "", history: [], savedAnswers: [] };
const assistantElements = {
  modal: document.getElementById("academicAssistantModal"),
  file: document.getElementById("assistantFileInput"),
  documentStatus: document.getElementById("assistantDocumentStatus"),
  removeDocument: document.getElementById("removeAssistantDocumentBtn"),
  messages: document.getElementById("assistantChatMessages"),
  form: document.getElementById("assistantChatForm"),
  question: document.getElementById("assistantQuestion"),
  send: document.getElementById("assistantSendBtn"),
  saveConversation: document.getElementById("saveAssistantConversationBtn"),
  deleteData: document.getElementById("deleteAssistantDataBtn"),
  savedAnswers: document.getElementById("assistantSavedAnswers"),
  status: document.getElementById("assistantStatus"),
};
let assistantBusy = false;
const assistantMaxFileBytes = 6 * 1024 * 1024;

function assistantStorageKey() {
  return currentUser ? `academicAssistant_${currentUser.uid}` : "";
}
function persistAssistantState() {
  const key = assistantStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      documentText: assistantState.documentText,
      documentName: assistantState.documentName,
      history: assistantState.history.slice(-12),
      savedAnswers: assistantState.savedAnswers.slice(-50),
    }));
  } catch (error) {
    setAssistantStatus("No se pudo guardar en este dispositivo; libera espacio del navegador.", true);
  }
}
function loadAssistantState() {
  const key = assistantStorageKey();
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(key) || "{}"); } catch {}
  assistantState.documentText = typeof stored.documentText === "string" ? stored.documentText.slice(0, 50000) : "";
  assistantState.documentName = typeof stored.documentName === "string" ? stored.documentName : "";
  assistantState.history = Array.isArray(stored.history) ? stored.history.slice(-12).filter((item) => item && ["user", "model"].includes(item.role) && typeof item.text === "string") : [];
  assistantState.savedAnswers = Array.isArray(stored.savedAnswers) ? stored.savedAnswers.slice(-50).filter((item) => item && typeof item.text === "string") : [];
  assistantElements.documentStatus.textContent = assistantState.documentText
    ? `Documento listo: ${assistantState.documentName} · texto extraído disponible en este dispositivo.`
    : "Aún no hay un documento cargado.";
  assistantElements.removeDocument.disabled = !assistantState.documentText;
  assistantElements.send.disabled = !assistantState.documentText || assistantBusy;
  assistantElements.saveConversation.disabled = !assistantState.history.length;
  renderAssistantMessages();
  renderAssistantSavedAnswers();
}
function setAssistantStatus(message, isError = false) {
  assistantElements.status.textContent = message;
  assistantElements.status.classList.toggle("error", isError);
}
function renderAssistantMessages() {
  assistantElements.messages.replaceChildren();
  if (!assistantState.history.length) {
    const welcome = document.createElement("p");
    welcome.className = "assistant-welcome";
    welcome.textContent = assistantState.documentText
      ? "Documento listo. Elige una herramienta o escribe una pregunta."
      : "Carga un documento para empezar. Puedes usar las herramientas de estudio o hacer tu propia pregunta.";
    assistantElements.messages.appendChild(welcome);
    return;
  }
  assistantState.history.forEach((item) => {
    const bubble = document.createElement("article");
    bubble.className = `assistant-message ${item.role === "user" ? "user" : "model"}`;
    const text = document.createElement("div");
    text.textContent = item.text;
    bubble.appendChild(text);
    if (item.role === "model") {
      const actions = document.createElement("div");
      actions.className = "assistant-message-actions";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "Copiar";
      copy.onclick = () => copyAssistantText(item.text);
      const save = document.createElement("button");
      save.type = "button";
      save.textContent = "Guardar respuesta";
      save.onclick = () => saveAssistantAnswer(item.text);
      actions.append(copy, save);
      bubble.appendChild(actions);
    }
    assistantElements.messages.appendChild(bubble);
  });
  assistantElements.messages.scrollTop = assistantElements.messages.scrollHeight;
}
function renderAssistantSavedAnswers() {
  assistantElements.savedAnswers.replaceChildren();
  assistantState.savedAnswers.slice().reverse().forEach((item, reverseIndex) => {
    const index = assistantState.savedAnswers.length - 1 - reverseIndex;
    const card = document.createElement("article");
    card.className = "assistant-saved-item";
    const answer = document.createElement("p");
    answer.textContent = item.text;
    const actions = document.createElement("div");
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copiar";
    copy.onclick = () => copyAssistantText(item.text);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Quitar";
    remove.onclick = () => {
      assistantState.savedAnswers.splice(index, 1);
      persistAssistantState();
      renderAssistantSavedAnswers();
    };
    actions.append(copy, remove);
    card.append(answer, actions);
    assistantElements.savedAnswers.appendChild(card);
  });
}
async function copyAssistantText(text) {
  try {
    await navigator.clipboard.writeText(text);
    setAssistantStatus("Respuesta copiada.");
  } catch {
    setAssistantStatus("No se pudo copiar. Revisa los permisos del navegador.", true);
  }
}
function saveAssistantAnswer(text) {
  if (!text) return;
  assistantState.savedAnswers.push({ text, savedAt: new Date().toISOString() });
  assistantState.savedAnswers = assistantState.savedAnswers.slice(-50);
  persistAssistantState();
  renderAssistantSavedAnswers();
  setAssistantStatus("Respuesta guardada en este dispositivo.");
}
function assistantFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
}
async function callAssistantApi(body) {
  if (!currentUser) throw new Error("Inicia sesión para usar el asistente.");
  const token = await currentUser.getIdToken();
  const response = await fetch("/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "No se pudo conectar con el asistente. Verifica que la función esté desplegada.");
  return result;
}
async function uploadAssistantDocument(file) {
  if (!currentUser) return setAssistantStatus("Inicia sesión para usar el asistente.", true);
  const lowerName = file.name.toLowerCase();
  const isPdf = lowerName.endsWith(".pdf") || file.type === "application/pdf";
  const isDocx = lowerName.endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (!isPdf && !isDocx) {
    assistantElements.file.value = "";
    return setAssistantStatus("Formato no compatible. Selecciona un PDF o Word (.docx).", true);
  }
  if (!file.size || file.size > assistantMaxFileBytes) {
    assistantElements.file.value = "";
    return setAssistantStatus("El documento debe tener contenido y pesar máximo 6 MB.", true);
  }
  if (assistantState.documentText && !confirm("Al cargar otro documento se borrará la conversación actual para evitar mezclar materiales. ¿Continuar?")) {
    assistantElements.file.value = "";
    return;
  }
  assistantBusy = true;
  assistantElements.file.disabled = true;
  assistantElements.send.disabled = true;
  assistantElements.documentStatus.textContent = `Analizando ${file.name}…`;
  setAssistantStatus("Extrayendo texto del documento…");
  try {
    const base64 = await assistantFileToBase64(file);
    const result = await callAssistantApi({
      action: "extract",
      fileName: file.name,
      mimeType: isPdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      base64,
    });
    assistantState.documentText = String(result.text || "").slice(0, 50000);
    assistantState.documentName = file.name;
    assistantState.history = [];
    assistantState.savedAnswers = [];
    persistAssistantState();
    assistantElements.documentStatus.textContent = `Documento listo: ${file.name}${result.truncated ? " · se analizaron los primeros 50.000 caracteres" : ""}`;
    assistantElements.removeDocument.disabled = false;
    renderAssistantMessages();
    renderAssistantSavedAnswers();
    setAssistantStatus("Documento analizado. Las preguntas se responderán basándose en este material.");
  } catch (error) {
    assistantElements.documentStatus.textContent = "No se pudo analizar el documento.";
    setAssistantStatus(error.message, true);
  } finally {
    assistantBusy = false;
    assistantElements.file.disabled = false;
    assistantElements.send.disabled = !assistantState.documentText;
    assistantElements.file.value = "";
  }
}
async function sendAssistantQuestion(question = assistantElements.question.value.trim()) {
  if (!assistantState.documentText) return setAssistantStatus("Primero carga un documento PDF o DOCX.", true);
  if (!question || assistantBusy) return;
  if (question.length > 4000) return setAssistantStatus("La pregunta puede tener máximo 4.000 caracteres.", true);
  assistantBusy = true;
  assistantElements.send.disabled = true;
  assistantElements.question.disabled = true;
  assistantElements.file.disabled = true;
  assistantElements.saveConversation.disabled = true;
  const conversationContext = assistantState.history.slice(-12);
  if (conversationContext[0]?.role === "model") conversationContext.shift();
  assistantState.history.push({ role: "user", text: question });
  renderAssistantMessages();
  assistantElements.question.value = "";
  setAssistantStatus("Preparando una respuesta basada en el documento…");
  try {
    const result = await callAssistantApi({
      action: "chat",
      documentText: assistantState.documentText,
      question,
      history: conversationContext,
    });
    assistantState.history.push({ role: "model", text: String(result.answer || "") });
    assistantState.history = assistantState.history.slice(-12);
    if (assistantState.history[0]?.role === "model") assistantState.history.shift();
    persistAssistantState();
    renderAssistantMessages();
    setAssistantStatus("Respuesta basada en el documento. Verifica los datos con tu material.");
  } catch (error) {
    assistantState.history.pop();
    renderAssistantMessages();
    setAssistantStatus(error.message, true);
  } finally {
    assistantBusy = false;
    assistantElements.send.disabled = !assistantState.documentText;
    assistantElements.question.disabled = false;
    assistantElements.file.disabled = false;
    assistantElements.saveConversation.disabled = !assistantState.history.length;
    assistantElements.question.focus();
  }
}
function saveAssistantConversationFile() {
  if (!assistantState.history.length) return;
  const transcript = assistantState.history.map((item) => `${item.role === "user" ? "Estudiante" : "Asistente"}:\n${item.text}`).join("\n\n");
  const blob = new Blob([`Documento: ${assistantState.documentName || "sin nombre"}\n\n${transcript}`], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `conversacion-${(assistantState.documentName || "estudio").replace(/[^\w.-]+/g, "_")}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  persistAssistantState();
  setAssistantStatus("Conversación descargada y guardada en este dispositivo.");
}
function clearAssistantDocument() {
  assistantState.documentText = "";
  assistantState.documentName = "";
  assistantState.history = [];
  assistantState.savedAnswers = [];
  const key = assistantStorageKey();
  if (key) localStorage.removeItem(key);
  assistantElements.file.value = "";
  assistantElements.documentStatus.textContent = "Aún no hay un documento cargado.";
  assistantElements.removeDocument.disabled = true;
  assistantElements.send.disabled = true;
  assistantElements.saveConversation.disabled = true;
  renderAssistantMessages();
  renderAssistantSavedAnswers();
  setAssistantStatus("Documento, conversación y respuestas guardadas eliminados de este dispositivo.");
}

document.getElementById("closeAssistantBtn")?.addEventListener("click", () => assistantElements.modal.classList.add("hidden"));
assistantElements.modal?.addEventListener("click", (event) => {
  if (event.target.dataset.closeAssistant === "true") assistantElements.modal.classList.add("hidden");
});
assistantElements.file?.addEventListener("change", () => {
  const file = assistantElements.file.files?.[0];
  if (file) uploadAssistantDocument(file);
});
assistantElements.removeDocument?.addEventListener("click", () => {
  if (confirm("¿Eliminar el documento, la conversación y las respuestas guardadas?")) clearAssistantDocument();
});
assistantElements.deleteData?.addEventListener("click", () => {
  if (confirm("Se eliminarán del navegador el texto extraído, toda la conversación y las respuestas guardadas. ¿Continuar?")) clearAssistantDocument();
});
assistantElements.form?.addEventListener("submit", (event) => {
  event.preventDefault();
  sendAssistantQuestion();
});
document.querySelectorAll("[data-assistant-prompt]").forEach((button) => {
  button.addEventListener("click", () => sendAssistantQuestion(button.dataset.assistantPrompt));
});
assistantElements.saveConversation?.addEventListener("click", saveAssistantConversationFile);

elements.btnOpenSettings.onclick = () => { elements.settingsMenu.classList.add("hidden"); elements.settingsModal.classList.remove("hidden"); };
elements.btnInviteFriend.onclick = showInviteSettings;
elements.btnInviteFriendFromSettings.onclick = showInviteSettings;
elements.btnAcademicPortals.onclick = showAcademicPortals;
elements.btnLanguageSettings.onclick = showLanguageSettings;
elements.btnPrivacyPolicies.onclick = () => openSettingsDetail("Políticas de privacidad", `<p class="privacy-note">En CONECTA tratamos tus datos con responsabilidad. Puedes controlar la visibilidad de tu fecha de nacimiento, estado civil y correo desde Privacidad de la cuenta. El contenido que publiques se almacena para prestar el servicio y no se vende a terceros. Puedes solicitar la actualización o eliminación de tus datos mediante asistencia.</p>`);
elements.btnActiveStatus.onclick = showActiveStatusSettings;
elements.btnAccountPrivacy.onclick = showAccountPrivacy;
elements.btnTermsSettings.onclick = openTermsModalFromSettings;
elements.closeSettingsBtn.onclick = () => elements.settingsModal.classList.add("hidden");
elements.closeSettingsDetailBtn.onclick = closeSettingsDetail;
elements.settingsModal.addEventListener("click", (event) => { if (event.target.dataset.closeSettings) elements.settingsModal.classList.add("hidden"); });
elements.settingsDetailModal.addEventListener("click", (event) => { if (event.target.dataset.closeSettingsDetail) closeSettingsDetail(); });

// Logout
elements.btnLogout.onclick = async () => {
  elements.settingsMenu.classList.add("hidden");
  if (currentUser && confirm("¿Cerrar sesión?")) {
    try {
      await updateDoc(doc(db, "users", currentUser.uid), {
        online: false,
        lastActive: serverTimestamp(),
      });
    } catch {}
    await signOut(auth);
  }
};

// Posting

// Selección y publicación de varias imágenes (o un único video) en una sola publicación.
let selectedPostFiles = [];
let selectedPostPreviewUrls = [];
let isUploadingPostFile = false;
const maxPostImages = 10;
const maxPostFileSize = 15 * 1024 * 1024;

const postImageInput = document.getElementById('postImageInput');
const postImagePreviewContainer = document.getElementById('postImagePreviewContainer');
const postImagePreviewGrid = document.getElementById('postImagePreviewGrid');
const postMediaSelectionLabel = document.getElementById('postMediaSelectionLabel');
const uploadPostImageBtn = document.getElementById('uploadPostImageBtn');
const postImageBtn = document.getElementById('postImageBtn');
const postInput = document.getElementById('postInput');
postImageBtn?.addEventListener('click', () => postImageInput.click());

function resetPostMediaSelection() {
  selectedPostPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  selectedPostPreviewUrls = [];
  selectedPostFiles = [];
  postImageInput.value = '';
  postImagePreviewGrid.replaceChildren();
  postMediaSelectionLabel.textContent = '';
  postImagePreviewContainer.style.display = 'none';
  uploadPostImageBtn.style.display = 'none';
}

postImageInput.addEventListener('change', () => {
  const files = [...postImageInput.files];
  if (!files.length) {
    resetPostMediaSelection();
    return;
  }

  const videos = files.filter((file) => file.type.startsWith('video/'));
  const invalidType = files.some((file) => !file.type.startsWith('image/') && !file.type.startsWith('video/'));
  if (invalidType || (videos.length && (videos.length !== 1 || files.length !== 1))) {
    resetPostMediaSelection();
    alert('Selecciona hasta 10 imágenes o un solo video por publicación.');
    return;
  }
  if (files.length > maxPostImages || (!videos.length && files.some((file) => file.size > maxPostFileSize))) {
    resetPostMediaSelection();
    alert('Puedes seleccionar hasta 10 imágenes de máximo 15 MB cada una, o un solo video.');
    return;
  }

  resetPostMediaSelection();
  selectedPostFiles = files;
  postImagePreviewGrid.classList.toggle('single-preview', files.length === 1);

  if (videos.length) {
    postMediaSelectionLabel.textContent = `Video seleccionado: ${files[0].name}`;
  } else {
    files.forEach((file, index) => {
      const url = URL.createObjectURL(file);
      selectedPostPreviewUrls.push(url);
      const image = document.createElement('img');
      image.src = url;
      image.alt = `Vista previa ${index + 1}: ${file.name}`;
      image.loading = 'lazy';
      postImagePreviewGrid.appendChild(image);
    });
    postMediaSelectionLabel.textContent = `${files.length} ${files.length === 1 ? 'imagen seleccionada' : 'imágenes seleccionadas'}`;
  }

  postImagePreviewContainer.style.display = 'block';
  uploadPostImageBtn.textContent = videos.length ? 'Subir video' : `Subir ${files.length > 1 ? `${files.length} imágenes` : 'imagen'}`;
  uploadPostImageBtn.style.display = 'inline-block';
});

async function uploadPostMediaFile(file) {
  const isVideo = file.type.startsWith('video/');
  const endpoint = isVideo
    ? `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`
    : `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  const response = await fetch(endpoint, { method: 'POST', body: formData });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Error subiendo archivo multimedia.');
  return data.secure_url;
}

uploadPostImageBtn.addEventListener('click', async () => {
  if (!selectedPostFiles.length) return alert('No hay archivos seleccionados para subir.');
  if (isUploadingPostFile) return;
  if (!currentUser) return alert('Debes iniciar sesión para publicar.');

  isUploadingPostFile = true;
  uploadPostImageBtn.disabled = true;
  postImageInput.disabled = true;
  if (postImageBtn) postImageBtn.disabled = true;
  uploadPostImageBtn.textContent = 'Subiendo…';

  try {
    const files = [...selectedPostFiles];
    const isVideo = files[0].type.startsWith('video/');
    const urls = await Promise.all(files.map(uploadPostMediaFile));
    const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
    if (!userDoc.exists()) throw new Error('Usuario no encontrado.');
    const userData = userDoc.data();
    const authorName = userData.profile?.name?.trim() || userData.username || 'Usuario';

    await addDoc(collection(db, 'posts'), {
      authorId: currentUser.uid,
      authorName,
      authorUsername: userData.username || '',
      text: postInput.value.trim(),
      image: isVideo ? '' : urls[0],
      images: isVideo ? [] : urls,
      video: isVideo ? urls[0] : '',
      reactions: {},
      timestamp: serverTimestamp(),
      privacy: document.getElementById('postPrivacy').value || 'public',
    });

    alert(isVideo ? 'Archivo publicado correctamente.' : 'Imágenes publicadas correctamente.');
    postInput.value = '';
    document.getElementById('postPrivacy').value = 'public';
    resetPostMediaSelection();
  } catch (err) {
    alert('Error al subir archivo: ' + err.message);
  } finally {
    isUploadingPostFile = false;
    uploadPostImageBtn.disabled = false;
    postImageInput.disabled = false;
    if (postImageBtn) postImageBtn.disabled = false;
    uploadPostImageBtn.textContent = selectedPostFiles.length > 1
      ? `Subir ${selectedPostFiles.length} imágenes`
      : 'Subir';
  }
});

// Modificar onsubmit para evitar publicar texto si hay archivo seleccionado
elements.postForm.onsubmit = async (e) => {
  e.preventDefault();

    // Publica los archivos seleccionados como una única publicación multimedia.
  if (selectedPostFiles.length) {
    return alert('Usa el botón "Subir" para publicar los archivos seleccionados.');
  }

  if (!currentUser) return alert('Debes iniciar sesión para publicar.');

  const text = postInput.value.trim();
  if (!text) return alert('Debes escribir un texto para publicar.');

  try {
    const privacy = document.getElementById('postPrivacy').value || 'public';
    const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
    if (!userDoc.exists()) throw new Error('Usuario no encontrado.');
    const userData = userDoc.data();
    const authorName = userData.profile?.name?.trim() !== '' ? userData.profile.name : userData.username;

    await addDoc(collection(db, 'posts'), {
      authorId: currentUser.uid,
      authorName,
      authorUsername: userData.username,
      text,
            image: '',
      images: [],
      video: '',
      reactions: {},
      timestamp: serverTimestamp(),
      privacy,
    });
    postInput.value = '';
    document.getElementById('postPrivacy').value = 'public';
  } catch (err) {
    alert('Error al publicar texto: ' + err.message);
  }
};


// Listener de posts filtrando según privacidad y usuario
async function startPostsListener() {
  const generation = ++postsListenerGeneration;
  if (unsubscribePosts) {
    unsubscribePosts();
    unsubscribePosts = null;
  }
  elements.postsContainer.innerHTML = "";
  if (!currentUser) return;
  const listeningUid = currentUser.uid;

  try {
    const userDoc = await getDoc(doc(db, "users", listeningUid));
    if (generation !== postsListenerGeneration || !currentUser || currentUser.uid !== listeningUid) return;

        const currentUserData = userDoc.exists() ? userDoc.data() : {};
    globalCurrentUserData = currentUserData;
    const friendsList = currentUserData.friends || [];
    const blockedUsers = currentUserData.blockedUsers || [];

    unsubscribePosts = onSnapshot(
      // Bound the live feed so a large history cannot flood the client on every session.
      query(collection(db, "posts"), orderBy("timestamp", "desc"), limit(50)),
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          const postId = change.doc.id;
          const postData = change.doc.data();

          let showPost = false;
          switch (postData.privacy) {
            case "public":
              showPost = true;
              break;
            case "friends":
              showPost = friendsList.includes(postData.authorId) || postData.authorId === currentUser.uid;
              break;
            case "private":
              showPost = postData.authorId === currentUser.uid;
              break;
                        default:
              showPost = true;
          }
          if (blockedUsers.includes(postData.authorId)) showPost = false;

          const existingPost = document.getElementById(`post_${postId}`);
          if (showPost) {
            if (change.type === "added" || change.type === "modified") {
              if (existingPost) {
                updatePost(existingPost, postData);
              } else {
                renderPost(postId, postData);
              }
            }
          } else {
            if (existingPost) existingPost.remove();
          }
          if (change.type === "removed") {
            if (existingPost) existingPost.remove();
          }
        });
      }
    );
  } catch (error) {
    console.error("Error al cargar publicaciones:", error);
  }
}

function updatePost(existingPost, postData) {
  if (!existingPost) return;

  const previousData = existingPost._postData;
  if (previousData) {
    const unchangedExceptViews = [...new Set([
      ...Object.keys(previousData),
      ...Object.keys(postData),
    ])]
      .filter((key) => key !== "videoViews")
      .every((key) => JSON.stringify(previousData[key]) === JSON.stringify(postData[key]));
    if (unchangedExceptViews) {
      existingPost._postData = postData;
      const counter = existingPost.querySelector(".post-video-views");
      if (counter) {
        const views = Math.max(0, Number(postData.videoViews) || 0);
        counter.dataset.count = String(views);
        counter.textContent = `👁 ${views} vistas`;
        counter.setAttribute("aria-label", `Visualizaciones: ${views}`);
      }
      return;
    }
  }

  const postId = existingPost.id.replace(/^post_/, "");
  existingPost.remove();
  renderPost(postId, postData);
}

function stopPostsListener() {
  postsListenerGeneration++;
  if (unsubscribePosts) {
    unsubscribePosts();
    unsubscribePosts = null;
  }
  elements.postsContainer.innerHTML = "";
}


// Muestra únicamente usuarios que todavía no son amigos ni tienen una solicitud pendiente.
let friendSuggestionsRenderId = 0;

async function renderFriendSuggestions() {
  if (!elements.suggestionsList || !currentUser) return;
  const renderId = ++friendSuggestionsRenderId;
  elements.suggestionsList.innerHTML = "";

  try {
    const currentSnap = await getDoc(doc(db, "users", currentUser.uid));
    const currentData = currentSnap.exists() ? currentSnap.data() : {};
        const friends = new Set(currentData.friends || []);
    const blockedUsers = new Set(currentData.blockedUsers || []);
    const incomingRequests = new Set(currentData.friendRequests || []);
    const sentRequests = new Set(currentData.sentFriendRequests || []);
    const usersSnap = await getDocs(collection(db, "users"));

    // También se revisa cada usuario para excluir solicitudes que ya le enviamos.
        const candidates = usersSnap.docs
      .filter(userDoc => {
        if (userDoc.id === currentUser.uid || friends.has(userDoc.id) || blockedUsers.has(userDoc.id)) return false;
        if (incomingRequests.has(userDoc.id) || sentRequests.has(userDoc.id)) return false;

        const userData = userDoc.data();
        const otherFriends = new Set(userData.friends || []);
        const otherIncomingRequests = new Set(userData.friendRequests || []);
        const otherSentRequests = new Set(userData.sentFriendRequests || []);

        return !otherFriends.has(currentUser.uid)
          && !otherIncomingRequests.has(currentUser.uid)
          && !otherSentRequests.has(currentUser.uid);
      })
      // Firestore no debería devolver el mismo documento dos veces, pero este
      // filtro garantiza que la interfaz nunca repita una sugerencia.
      .filter((userDoc, index, docs) =>
        docs.findIndex((candidate) => candidate.id === userDoc.id) === index
      )
      .slice(0, 30);

    // Si otra actualización terminó después, no debe volver a pintar la lista.
    if (renderId !== friendSuggestionsRenderId) return;

    if (!candidates.length) {
      elements.suggestionsList.innerHTML = '<p class="suggestions-empty">No hay nuevas sugerencias por ahora.</p>';
      return;
    }

        const renderedSuggestionIds = new Set();
    candidates.forEach(userDoc => {
      if (renderedSuggestionIds.has(userDoc.id)) return;
      renderedSuggestionIds.add(userDoc.id);

      const data = userDoc.data();
      const profile = data.profile || {};
      const card = document.createElement("article");
      card.className = "suggestion-card";
      const avatar = document.createElement("img");
      avatar.src = profile.photo || "https://uploads.onecompiler.io/44amdv2fa/44amdvnzz/acceso.png";
      avatar.alt = "";
      avatar.loading = "lazy";
      const info = document.createElement("div");
      info.className = "suggestion-info";
      const name = document.createElement("button");
      name.className = "suggestion-name";
      renderDisplayName(name, profile.name || data.username || "Usuario");
      name.onclick = () => showUserInfo(userDoc.id);
      const username = document.createElement("small");
      username.textContent = `@${data.username || "usuario"}`;
      const add = document.createElement("button");
      add.className = "suggestion-add friendBtn";
      add.textContent = "Añadir";
      add.onclick = async () => {
        add.disabled = true;
        add.textContent = "Enviando…";
        try {
          const targetRef = doc(db, "users", userDoc.id);
          const targetSnap = await getDoc(targetRef);
          const targetData = targetSnap.exists() ? targetSnap.data() : {};
          const targetFriends = new Set(targetData.friends || []);
          const targetRequests = new Set(targetData.friendRequests || []);
          const targetSentRequests = new Set(targetData.sentFriendRequests || []);

          if (targetFriends.has(currentUser.uid)
              || targetRequests.has(currentUser.uid)
              || targetSentRequests.has(currentUser.uid)) {
            card.remove();
            return;
          }

          await updateDoc(targetRef, {
            friendRequests: [...targetRequests, currentUser.uid]
          });

          // Registrar también la solicitud enviada para no volver a sugerir a esta persona.
          const currentRef = doc(db, "users", currentUser.uid);
          await updateDoc(currentRef, {
            sentFriendRequests: [...new Set([...(currentData.sentFriendRequests || []), userDoc.id])]
          });

          card.remove();
        } catch (error) {
          add.disabled = false;
          add.textContent = "Añadir";
          alert("No se pudo enviar la solicitud: " + error.message);
        }
      };
      info.append(name, username);
      card.append(avatar, info, add);
      elements.suggestionsList.appendChild(card);
    });
  } catch (error) {
    elements.suggestionsList.innerHTML = '<p class="suggestions-empty">No se pudieron cargar las sugerencias.</p>';
    console.error("Error cargando sugerencias:", error);
  }
}

// Búsqueda rápida del encabezado: nombres parciales y publicaciones por fecha.
let globalSearchTimer;
let globalUsersCache = null;
let globalCurrentUserData = {};

function normalizeSearchText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function clearGlobalSearchResults() {
  if (elements.globalSearchResults) elements.globalSearchResults.innerHTML = "";
}

function renderGlobalSearchMessage(text) {
  if (!elements.globalSearchResults) return;
  elements.globalSearchResults.innerHTML = "";
  const message = document.createElement("p");
  message.className = "global-search-empty";
  message.textContent = text;
  elements.globalSearchResults.appendChild(message);
}

async function loadGlobalUsers() {
  if (!globalUsersCache) {
    const snapshot = await getDocs(collection(db, "users"));
    globalUsersCache = snapshot.docs.map((userDoc) => ({ id: userDoc.id, data: userDoc.data() }));
  }
  return globalUsersCache;
}

async function searchGlobalPeople(value) {
  const term = normalizeSearchText(value);
  if (!term) {
    clearGlobalSearchResults();
    return;
  }

  try {
    const users = await loadGlobalUsers();
    const matches = users.filter(({ id, data }) => {
      if (currentUser && id === currentUser.uid) return false;
            const profileName = data.profile?.name || "";
      const username = data.username || "";
      if ((globalCurrentUserData?.blockedUsers || []).includes(id)) return false;
      return normalizeSearchText(profileName).includes(term)
        || normalizeSearchText(username).includes(term);
    }).slice(0, 12);

    if (!matches.length) {
      renderGlobalSearchMessage("No se encontraron personas.");
      return;
    }

    elements.globalSearchResults.innerHTML = "";
    matches.forEach(({ id, data }) => {
      const profile = data.profile || {};
      const row = document.createElement("div");
      row.className = "global-search-result";
      row.setAttribute("role", "option");

      const avatar = document.createElement("img");
      avatar.src = profile.photo || "https://uploads.onecompiler.io/44amdv2fa/44amdvnzz/acceso.png";
      avatar.alt = "";
      const info = document.createElement("div");
      info.className = "global-search-result-info";
      const name = document.createElement("strong");
      renderDisplayName(name, profile.name || data.username || "Usuario");
      const username = document.createElement("small");
      username.textContent = `@${data.username || "usuario"}`;
      info.append(name, username);

      const action = document.createElement("button");
      action.type = "button";
      const isFriend = Boolean(currentUser && (globalCurrentUserData?.friends || []).includes(id));
      action.textContent = isFriend ? "Chat" : "Añadir";
      action.onclick = async (event) => {
        event.stopPropagation();
        if (isFriend) {
          clearGlobalSearchResults();
          elements.globalPersonSearch.value = "";
          activateTab("messages");
          setTimeout(async () => {
            const targetUser = await getDoc(doc(db, "users", id));
            const targetData = targetUser.exists() ? targetUser.data() : {};
            const targetName = targetData.profile?.name || targetData.username || "";
            const conversationButton = [...(elements.usersInMessages?.querySelectorAll("button") || [])]
              .find((button) => normalizeSearchText(button.textContent).includes(normalizeSearchText(targetName)));
            if (conversationButton) conversationButton.click();
          }, 150);
        } else {
          await sendFriendRequestFromSearch(id, action);
        }
      };

      row.onclick = () => showUserInfo(id);
      row.append(avatar, info, action);
      elements.globalSearchResults.appendChild(row);
    });
  } catch (error) {
    console.error("Error buscando personas:", error);
    renderGlobalSearchMessage("No se pudo realizar la búsqueda.");
  }
}

async function sendFriendRequestFromSearch(uid, button) {
  if (!currentUser) return alert("Debes iniciar sesión para añadir personas.");
  button.disabled = true;
  button.textContent = "Enviando…";
  try {
    const targetRef = doc(db, "users", uid);
    const currentRef = doc(db, "users", currentUser.uid);
    const [targetSnap, currentSnap] = await Promise.all([getDoc(targetRef), getDoc(currentRef)]);
    const targetData = targetSnap.exists() ? targetSnap.data() : {};
    const currentData = currentSnap.exists() ? currentSnap.data() : {};
    const targetFriends = new Set(targetData.friends || []);
    const targetRequests = new Set(targetData.friendRequests || []);
    if (targetFriends.has(currentUser.uid) || targetRequests.has(currentUser.uid)) {
      button.textContent = "Enviada";
      return;
    }
    await updateDoc(targetRef, { friendRequests: [...targetRequests, currentUser.uid] });
    await updateDoc(currentRef, { sentFriendRequests: [...new Set([...(currentData.sentFriendRequests || []), uid])] });
    button.textContent = "Enviada";
  } catch (error) {
    button.disabled = false;
    button.textContent = "Añadir";
    alert("No se pudo enviar la solicitud: " + error.message);
  }
}

function setupGlobalSearch() {
  if (!elements.globalPersonSearch) return;
  elements.globalPersonSearch.addEventListener("input", () => {
    clearTimeout(globalSearchTimer);
    globalSearchTimer = setTimeout(() => searchGlobalPeople(elements.globalPersonSearch.value), 120);
  });
  elements.globalPersonSearch.addEventListener("focus", () => {
    if (elements.globalPersonSearch.value.trim()) searchGlobalPeople(elements.globalPersonSearch.value);
  });
    elements.globalPostDateSearch?.addEventListener("change", () => {
    const date = elements.globalPostDateSearch.value;
    elements.globalPersonSearch.value = "";
    activateTab("home");

    const applyDateFilter = () => {
      const posts = [...elements.postsContainer.querySelectorAll(".post")];
      posts.forEach((post) => {
        const postDate = post.querySelector(".post-date")?.dataset.date || "";
        post.hidden = Boolean(date) && postDate !== date;
      });
    };

    // Espera a que el listener de Firestore pinte las publicaciones.
    requestAnimationFrame(() => setTimeout(applyDateFilter, 650));
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#desktopSearch")) clearGlobalSearchResults();
  });
}
setupGlobalSearch();

// Cumpleaños de amigos y cartas compartidas.
const birthdayState = { people: [], selected: null, letterId: null, readOnly: false };
const birthdayEls = {
  widgetText: document.getElementById("birthdayWidgetText"),
  open: document.getElementById("openBirthdayBtn"),
  modal: document.getElementById("birthdayModal"),
  close: document.getElementById("closeBirthdayBtn"),
  gender: document.getElementById("birthdayGender"),
  message: document.getElementById("birthdayMessage"),
  to: document.getElementById("birthdayLetterTo"),
  from: document.getElementById("birthdayLetterFrom"),
  send: document.getElementById("sendBirthdayBtn"),
  note: document.getElementById("birthdayReadOnlyNote"),
  shell: document.querySelector(".birthday-letter-shell"),
};

function birthdayDateParts(value) {
  // El formulario guarda la fecha como YYYY-MM-DD. El año solo sirve para validar.
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsedDate = new Date(year, month - 1, day);
  if (parsedDate.getFullYear() !== year || parsedDate.getMonth() !== month - 1 || parsedDate.getDate() !== day) {
    return null;
  }
  return { month, day };
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function getBirthdayDate(person, year) {
  const date = birthdayDateParts(person.profile?.birthDate);
  if (!date) return null;
  const day = date.month === 2 && date.day === 29 && !isLeapYear(year) ? 28 : date.day;
  return new Date(year, date.month - 1, day);
}

function getBirthdayInfo(person, referenceDate = new Date()) {
  const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  let birthday = getBirthdayDate(person, today.getFullYear());
  if (!birthday) return null;
  if (birthday < today) birthday = getBirthdayDate(person, today.getFullYear() + 1);
  return { date: birthday, daysUntil: Math.round((birthday - today) / 86400000) };
}

function birthdayName(person) {
  return person.profile?.name?.trim() || person.username || "Tu amigo";
}

let birthdayLoadToken = 0;
async function loadFriendBirthdays() {
  if (!currentUser || !birthdayEls.open) return;
  const loadToken = ++birthdayLoadToken;
  try {
    const ownSnap = await getDoc(doc(db, "users", currentUser.uid));
    if (loadToken !== birthdayLoadToken) return;
    const friendIds = [...new Set(ownSnap.exists() && Array.isArray(ownSnap.data().friends) ? ownSnap.data().friends : [])]
      .filter((uid) => uid && uid !== currentUser.uid);

    // Consultas en paralelo: evita bloquear el navegador cuando hay muchos amigos.
    const friendSnaps = await Promise.all(friendIds.map((uid) => getDoc(doc(db, "users", uid))));
    if (loadToken !== birthdayLoadToken) return;
    const people = friendSnaps
      .filter((snap) => {
        if (!snap.exists() || !birthdayDateParts(snap.data().profile?.birthDate)) return false;
        const birthPrivacy = snap.data().privacy?.birthDate || "public";
        return birthPrivacy !== "private";
      })
      .map((snap) => ({ id: snap.id, ...snap.data() }))
      .map((person) => ({ person, info: getBirthdayInfo(person) }))
      .filter(({ info }) => info)
      .sort((a, b) => a.info.date - b.info.date);

    birthdayState.people = people.map(({ person }) => person);
    const next = people[0];
    const upcoming = people.filter(({ info }) => info.daysUntil >= 0 && info.daysUntil <= 3);

    if (!next) {
      birthdayEls.widgetText.textContent = "Aún no hay fechas registradas entre tus amigos.";
      birthdayEls.open.disabled = true;
      birthdayState.selected = null;
      return;
    }

    const formatDate = (date) => `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
    const forecast = upcoming.length
      ? `Próximos 3 días: ${upcoming.map(({ person, info }) => `${birthdayName(person)} ${info.daysUntil === 0 ? "hoy" : `en ${info.daysUntil} día${info.daysUntil === 1 ? "" : "s"}`} (${formatDate(info.date)})`).join(" · ")}`
      : `Próximo: ${birthdayName(next.person)} · ${formatDate(next.info.date)}`;

    birthdayEls.widgetText.textContent = next.info.daysUntil === 0
      ? `Hoy celebra ${birthdayName(next.person)} 🎉 · ${forecast}`
      : forecast;
    birthdayEls.open.disabled = false;
    birthdayState.selected = next.person;
  } catch (error) {
    if (loadToken !== birthdayLoadToken) return;
    birthdayEls.widgetText.textContent = "No se pudieron cargar los cumpleaños.";
    birthdayEls.open.disabled = true;
    birthdayState.selected = null;
    console.error("Error cargando cumpleaños:", error);
  }
}

function openBirthdayEditor(person, options = {}) {
  if (!person || !birthdayEls.modal) return;
  birthdayState.selected = person;
  birthdayState.letterId = options.letterId || null;
  birthdayState.readOnly = Boolean(options.readOnly);
  birthdayEls.to.textContent = `Para ${birthdayName(person)}`;
  birthdayEls.from.textContent = options.senderName ? `De ${options.senderName}` : `De ${globalCurrentUserData?.profile?.name || globalCurrentUserData?.username || "tu amigo"}`;
  birthdayEls.message.value = options.message || "Que este nuevo año de vida llegue lleno de alegría, sueños cumplidos y momentos inolvidables. ¡Feliz cumpleaños! 🎉";
  birthdayEls.gender.value = options.gender || "woman";
  birthdayEls.message.readOnly = birthdayState.readOnly;
  birthdayEls.gender.disabled = birthdayState.readOnly;
  birthdayEls.send.classList.toggle("hidden", birthdayState.readOnly);
  birthdayEls.note.classList.toggle("hidden", !birthdayState.readOnly);
  birthdayEls.shell.dataset.gender = birthdayEls.gender.value;
  birthdayEls.modal.classList.remove("hidden");
}

function closeBirthdayModal() { birthdayEls.modal?.classList.add("hidden"); }

birthdayEls.gender?.addEventListener("change", () => { birthdayEls.shell.dataset.gender = birthdayEls.gender.value; });
birthdayEls.open?.addEventListener("click", () => openBirthdayEditor(birthdayState.selected));
birthdayEls.close?.addEventListener("click", closeBirthdayModal);
birthdayEls.modal?.addEventListener("click", (event) => { if (event.target.dataset.closeBirthday) closeBirthdayModal(); });

birthdayEls.send?.addEventListener("click", async () => {
  const recipient = birthdayState.selected;
  if (!currentUser || !recipient) return;
  birthdayEls.send.disabled = true;
  birthdayEls.send.textContent = "Enviando…";
  try {
    const senderSnap = await getDoc(doc(db, "users", currentUser.uid));
    const sender = senderSnap.exists() ? senderSnap.data() : {};
    const senderName = sender.profile?.name?.trim() || sender.username || "Un amigo";
    const letter = await addDoc(collection(db, "birthdayLetters"), {
      senderId: currentUser.uid,
      recipientId: recipient.id,
      senderName,
      recipientName: birthdayName(recipient),
      message: birthdayEls.message.value.trim() || "¡Feliz cumpleaños! 🎉",
      gender: birthdayEls.gender.value,
      createdAt: serverTimestamp(),
    });
    const url = new URL(window.location.href);
    url.hash = `birthday-letter=${letter.id}`;
    const chatId = [currentUser.uid, recipient.id].sort().join("_");
    await addDoc(collection(db, "chats", chatId, "messages"), {
      sender: currentUser.uid,
      receiver: recipient.id,
      message: `${senderName} quiere felicitarte!\n${url.toString()}`,
      image: null,
      timestamp: serverTimestamp(),
      read: false,
      readTimestamp: null,
    });
    closeBirthdayModal();
    alert("La felicitación fue enviada al chat.");
  } catch (error) {
    alert("No se pudo enviar la felicitación: " + error.message);
  } finally {
    birthdayEls.send.disabled = false;
    birthdayEls.send.textContent = "Enviar felicitación";
  }
});

async function openBirthdayLetterFromHash() {
  const match = window.location.hash.match(/^#birthday-letter=(.+)$/);
  if (!match || !birthdayEls.modal) return;
  try {
    const snap = await getDoc(doc(db, "birthdayLetters", decodeURIComponent(match[1])));
    if (!snap.exists()) return;
    const data = snap.data();
    openBirthdayEditor({ id: data.recipientId, username: data.recipientName, profile: { name: data.recipientName } }, {
      readOnly: true, letterId: snap.id, senderName: data.senderName, message: data.message, gender: data.gender,
    });
  } catch (error) { console.error("No se pudo abrir la carta:", error); }
}
window.addEventListener("hashchange", openBirthdayLetterFromHash);
// La carga se inicia al activar Inicio, cuando la sesión ya está disponible.
setTimeout(openBirthdayLetterFromHash, 350);

// Convierte los enlaces de cartas en enlaces accesibles dentro de las burbujas del chat.
function linkifyBirthdayMessages() {
  const root = elements.chatMessages;
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest("a, script, style")) continue;
    if (/https?:\/\/[^\s]+birthday-letter=[^\s]+/.test(node.nodeValue || "")) textNodes.push(node);
  }
  textNodes.forEach((textNode) => {
    const fragment = document.createDocumentFragment();
    const value = textNode.nodeValue;
    const expression = /(https?:\/\/[^\s]+birthday-letter=[^\s]+)/g;
    let lastIndex = 0;
    value.replace(expression, (url, _match, offset) => {
      fragment.appendChild(document.createTextNode(value.slice(lastIndex, offset)));
      const link = document.createElement("a");
      link.href = url.replace(/[.,!?]+$/, "");
      link.textContent = "Abrir carta de cumpleaños";
      link.target = "_self";
      link.rel = "noopener";
      link.className = "birthday-chat-link";
      fragment.appendChild(link);
      lastIndex = offset + url.length;
      return url;
    });
    fragment.appendChild(document.createTextNode(value.slice(lastIndex)));
    textNode.replaceWith(fragment);
  });
}
const birthdayChatObserver = elements.chatMessages && new MutationObserver(linkifyBirthdayMessages);
birthdayChatObserver?.observe(elements.chatMessages, { childList: true, subtree: true });
linkifyBirthdayMessages();

// Get username helper and profile name (used in users list and elsewhere)
async function getUserName(uid) {
  try {
    const userDoc = await getDoc(doc(db, "users", uid));
    if (!userDoc.exists()) return "Desconocido";
    const userData = userDoc.data();
    const pn = userData.profile?.name?.trim();
    if (pn && pn !== "") return pn;
    return userData.username || "Desconocido";
  } catch {
    return "Desconocido";
  }
}

// Audio for reaction sound
const reactionAudio = new Audio(
  "https://actions.google.com/sounds/v1/cartoon/pop.ogg"
);
reactionAudio.volume = 0.3;

// Audio para notificaciones nuevas
const notificationAudio = new Audio(
  "https://actions.google.com/sounds/v1/cartoon/pop.ogg"
); // sonido Ding
notificationAudio.volume = 0.3;

// Variable para guardar el conteo previo de notificaciones sin leer
let previousUnreadNotifCount = 0;

// Cambios en setupPressReaction para que el popup de reacciones permanezca visible hasta que el usuario elija una opción

// Assistance button to WhatsApp in settings menu
const btnAssistance = document.getElementById('btnAssistance');
btnAssistance.addEventListener('click', () => {
  window.open('https://wa.me/573145033938?text=Hola,%20solicito%20asistencia%20personal', '_blank', 'noopener,noreferrer');
});

function setupPressReaction(postDiv, postId, postData) {
  let popup;
  let popupVisible = false;
  let pressTimeout;

  const showPopup = () => {
    if (popupVisible) return;
    popup = document.createElement("div");
    popup.className = "reaction-popup";
    reactionEmojis.forEach((emoji) => {
      const btn = document.createElement("button");
      btn.textContent = emoji;
      btn.title = emoji;
      btn.addEventListener("click", async () => {
        if (!currentUser) return alert("Inicia sesión para reaccionar.");
        try {
          const postRef = doc(db, "posts", postId);
          const currentReactions = postData.reactions || {};
          const updatedReactions = { ...currentReactions };
          Object.keys(updatedReactions).forEach((key) => {
            updatedReactions[key] = updatedReactions[key].filter(
              (uid) => uid !== currentUser.uid
            );
            if (updatedReactions[key].length === 0) delete updatedReactions[key];
          });
          updatedReactions[emoji] = (updatedReactions[emoji] || []).concat(
            currentUser.uid
          );
          await updateDoc(postRef, {
            reactions: updatedReactions,
          });
          // Animación en el icono de reacción (pulso)
          reactionIcon.animate(
            [
              { transform: "scale(1)" },
              { transform: "scale(1.4)" },
              { transform: "scale(1)" },
            ],
            { duration: 400, easing: "ease-in-out" }
          );
          // Reproducir sonido
          reactionAudio.currentTime = 0;
          reactionAudio.play().catch(() => {});
          closePopup();
        } catch (e) {
          alert("Error al reaccionar: " + e.message);
        }
      });
      popup.appendChild(btn);
    });
        postDiv.appendChild(popup);

    // Keep the reaction picker beside its trigger and inside the post's horizontal bounds.
    const postRect = postDiv.getBoundingClientRect();
    const triggerRect = reactionIcon.getBoundingClientRect();
    const popupWidth = popup.offsetWidth;
    const popupHeight = popup.offsetHeight;
    const gap = 8;
    let left = triggerRect.right - postRect.left + gap;
    if (left + popupWidth > postRect.width - gap) {
      left = triggerRect.left - postRect.left - popupWidth - gap;
    }
    left = Math.max(gap, Math.min(left, postRect.width - popupWidth - gap));
    const top = triggerRect.top - postRect.top + (triggerRect.height - popupHeight) / 2;
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popupVisible = true;
  };

  const closePopup = () => {
    if (popup) {
      popup.remove();
      popup = null;
      popupVisible = false;
    }
  };

  let reactionIcon;

  return {
    setReactionIcon(el) {
      reactionIcon = el;
    },
    onPointerDown() {
      // Mostrar popup tras 500ms de presionar
      pressTimeout = setTimeout(() => {
        showPopup();
      }, 500);
    },
    onPointerUp() {
      clearTimeout(pressTimeout);
      // No cerrar popup aquí para que permanezca visible
    },
    onPointerLeave() {
      clearTimeout(pressTimeout);
      // NO cerrar popup al salir del área para que permanezca visible hasta selección
    },
  };
}

// Create reactions summary (emoji + count) with click to open details
function createReactionsSummary(postId, postData) {
  const container = document.createElement("div");
  container.style.marginTop = "6px";
  container.style.marginBottom = "8px";
  container.style.display = "flex";
  container.style.flexWrap = "wrap";
  container.style.gap = "6px";
  container.style.fontSize = "18px";
  container.style.userSelect = "none";
  container.style.cursor = "pointer";

  if (!postData.reactions || Object.keys(postData.reactions).length === 0) {
    container.textContent = "";
    return container;
  }

  let totalReactionsCount = 0;
  Object.values(postData.reactions).forEach((users) => {
    totalReactionsCount += users.length;
  });
  container.textContent = `❤️ ${totalReactionsCount}`;
  container.title = "Ver personas que reaccionaron";
  container.onclick = () => {
    showReactionsView(postId, postData.reactions);
  };

  return container;
}

// Show modal with people who reacted and their emoji
async function showReactionsView(postId, reactions) {
  elements.reactionsViewList.innerHTML = "";

  try {
    for (const [emoji, userIds] of Object.entries(reactions)) {
      for (const uid of userIds) {
        const userName = await getUserName(uid);
        const li = document.createElement("li");
        li.textContent = `${userName}: ${emoji}`;
        li.style.padding = "6px 4px";
        elements.reactionsViewList.appendChild(li);
      }
    }
  } catch {
    elements.reactionsViewList.textContent = "Error cargando reacciones.";
  }

  elements.reactionsViewModal.classList.remove("hidden");
}
elements.closeReactionsViewBtn.onclick = () => {
  elements.reactionsViewModal.classList.add("hidden");
};

function highlightElement(el) {
  const originalBG = el.style.backgroundColor;
  el.style.backgroundColor = "#ffff88";
  setTimeout(() => {
    el.style.transition = "background-color 2.5s ease";
    el.style.backgroundColor = originalBG || "";
    setTimeout(() => (el.style.transition = ""), 2600);
  }, 10);
}

const imageLightbox = document.getElementById("imageLightbox");
const imageLightboxGallery = document.getElementById("imageLightboxGallery");
const closeImageLightboxBtn = document.getElementById("closeImageLightbox");
let previousBodyOverflow = "";
let imageLightboxReturnFocus = null;

function openImageLightbox(imageUrls, selectedIndex = 0) {
  if (!imageLightbox || !imageLightboxGallery || !imageUrls.length) return;
  imageLightboxGallery.replaceChildren();
  const images = imageUrls.map((url, index) => {
    const image = document.createElement("img");
    image.src = url;
    image.alt = `Imagen ${index + 1} de ${imageUrls.length}`;
    image.decoding = "async";
    image.loading = index === selectedIndex ? "eager" : "lazy";
    imageLightboxGallery.appendChild(image);
    return image;
  });
  imageLightboxReturnFocus = document.activeElement;
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  imageLightbox.classList.remove("hidden");
  imageLightbox.setAttribute("aria-hidden", "false");
  closeImageLightboxBtn?.focus();
  requestAnimationFrame(() => {
    imageLightboxGallery.scrollTo({ top: images[selectedIndex]?.offsetTop || 0, behavior: "smooth" });
  });
}

function closeImageLightbox() {
  if (!imageLightbox) return;
  imageLightbox.classList.add("hidden");
  imageLightbox.setAttribute("aria-hidden", "true");
  document.body.style.overflow = previousBodyOverflow;
  if (imageLightboxReturnFocus?.isConnected) imageLightboxReturnFocus.focus();
  imageLightboxReturnFocus = null;
}

closeImageLightboxBtn?.addEventListener("click", closeImageLightbox);
imageLightbox?.addEventListener("click", (event) => {
  if (event.target.dataset.closeLightbox === "true") closeImageLightbox();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && imageLightbox && !imageLightbox.classList.contains("hidden")) {
    closeImageLightbox();
  }
});

// Render each post
// Render each post with options menu °°°
async function renderPost(postId, postData, target = elements.postsContainer, idPrefix = "") {
    const postDiv = document.createElement("div");
  postDiv._postData = postData;
  postDiv.className = "post";
  postDiv.dataset.postId = postId;
  postDiv.dataset.authorId = postData.authorId || "";
  postDiv.dataset.hasPoll = postData.poll ? "true" : "false";
  postDiv.style.position = "relative";
  postDiv.id = `${idPrefix}post_${postId}`;

  // Contenedor superior con nombre y menú
  const topContainer = document.createElement("div");
  topContainer.style.display = "flex";
  topContainer.style.justifyContent = "space-between";
  topContainer.style.alignItems = "center";
  topContainer.style.position = "relative";

  // Nombre clickeable
  const authorEl = document.createElement("div");
  authorEl.className = "post-author";
  authorEl.tabIndex = 0;
  authorEl.style.userSelect = "text";
  authorEl.style.outline = "none";
  authorEl.style.textDecoration = "none";
  authorEl.style.flexGrow = "1";
  authorEl.addEventListener("click", () => showUserInfo(postData.authorId));

  renderDisplayName(authorEl, postData.authorName);

  // Botón menú °°°
  const menuBtn = document.createElement("button");
  menuBtn.textContent = "°°°";
  menuBtn.title = "Opciones de publicación";
  menuBtn.style.background = "transparent";
  menuBtn.style.border = "none";
  menuBtn.style.fontSize = "18px";
  menuBtn.style.cursor = "pointer";
  menuBtn.style.userSelect = "none";

  // Estilos para posicionarlo a la derecha sin desplazar texto
  menuBtn.style.position = "absolute";
  menuBtn.style.right = "0";
  menuBtn.style.top = "50%";
  menuBtn.style.transform = "translateY(-50%)";
  menuBtn.style.left = "auto";

  // Crear menú de opciones desplegable
  const menu = document.createElement("div");
  menu.style.position = "absolute";
  menu.style.top = "100%";
  menu.style.right = "0";
  menu.style.background = "white";
  menu.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
  menu.style.borderRadius = "8px";
  menu.style.padding = "6px 12px";
  menu.style.display = "none";
  menu.style.zIndex = "1000";
  menu.style.minWidth = "150px";
  menu.style.fontSize = "14px";
  menu.style.userSelect = "none";

  // Opción eliminar publicación (solo para autor)
  if (currentUser && currentUser.uid === postData.authorId) {
    const deleteOption = document.createElement("div");
    deleteOption.textContent = "Eliminar publicación";
    deleteOption.style.padding = "6px 8px";
    deleteOption.style.cursor = "pointer";
    deleteOption.style.color = "#e63946";
    deleteOption.addEventListener("click", async () => {
      if (confirm("¿Eliminar esta publicación?")) {
        try {
          await deleteDoc(doc(db, "posts", postId));
          menu.style.display = "none";
        } catch (e) {
          alert("Error eliminando publicación: " + e.message);
        }
      }
    });
    menu.appendChild(deleteOption);
  }

  // Opción compartir publicación
  const shareOption = document.createElement("div");
  shareOption.textContent = "Compartir publicación";
  shareOption.style.padding = "6px 8px";
  shareOption.style.cursor = "pointer";
  shareOption.style.color = "#2176FF";

  shareOption.addEventListener("click", async () => {
    if (!currentUser) {
      alert("Debes iniciar sesión para compartir publicaciones.");
      elements.authSection.classList.remove("hidden");
      const appElement = document.getElementById("app");
      if (appElement) appElement.style.display = "none";
      menu.style.display = "none";
      return;
    }
    const url = new URL(window.location.href);
    url.hash = `post_${postId}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Publicación en CONECTA",
          text: postData.text || "Publicación en CONECTA",
          url: url.toString(),
        });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url.toString());
        alert("Enlace copiado al portapapeles");
      } else {
        // Fallback simple para navegadores sin Clipboard API
        prompt("Copia el enlace de la publicación:", url.toString());
      }
    } catch (e) {
      alert("Error compartiendo: " + e.message);
    }
    menu.style.display = "none";
  });

  menu.appendChild(shareOption);

  // Botón para cerrar menú fuera del botón (~evento global)
  function closeMenuOnClickOutside(ev) {
    if (!menu.contains(ev.target) && ev.target !== menuBtn) {
      menu.style.display = "none";
      document.removeEventListener("click", closeMenuOnClickOutside);
    }
  }

  menuBtn.addEventListener("click", (ev) => {
    ev.stopPropagation(); // evitar colapsar inmediato
    if (menu.style.display === "none") {
      menu.style.display = "block";
      document.addEventListener("click", closeMenuOnClickOutside);
    } else {
      menu.style.display = "none";
      document.removeEventListener("click", closeMenuOnClickOutside);
    }
  });

  // Añadir nombre y menú a contenedor superior
  topContainer.appendChild(authorEl);
  topContainer.appendChild(menuBtn);
  topContainer.appendChild(menu);

  // Fecha con emoji y el icono de privacidad
    const dateEl = document.createElement("div");
  dateEl.className = "post-date";
  const postDate = postData.timestamp?.toDate ? postData.timestamp.toDate() : null;
  const dateText = postDate ? postDate.toLocaleString() : "";
  if (postDate) {
    const year = postDate.getFullYear();
    const month = String(postDate.getMonth() + 1).padStart(2, "0");
    const day = String(postDate.getDate()).padStart(2, "0");
    dateEl.dataset.date = `${year}-${month}-${day}`;
  }

  // Mapea privacidad a icono
  const privacyIcons = {
    public: "https://uploads.onecompiler.io/448k9pkeq/448kbzjkm/publico.png",
    friends: "https://uploads.onecompiler.io/448k9pkeq/448kbzjkm/amigos.png",
    private: "https://uploads.onecompiler.io/448k9pkeq/448kbzjkm/solo%20yo.png",
  };
  const privacy = postData.privacy || "public";
  const privacyIconUrl = privacyIcons[privacy] || privacyIcons.public;

  // Crear img para icono privacidad
  const privacyImg = document.createElement("img");
  privacyImg.src = privacyIconUrl;
  privacyImg.alt =
    privacy === "public"
      ? "Público"
      : privacy === "friends"
      ? "Amigos"
      : "Solo yo";
  privacyImg.title = privacyImg.alt;
  privacyImg.style.width = "15px";        //tamaño íconos de privacidad
  privacyImg.style.height = "15px";
  privacyImg.style.verticalAlign = "middle";
  privacyImg.style.marginLeft = "8px";

 // Texto de la fecha de la publicación
dateEl.textContent = dateText;
dateEl.appendChild(privacyImg);

  // Ensamblar post
  postDiv.appendChild(topContainer);
  postDiv.appendChild(dateEl);

  // Texto si existe y no vacío
  if (postData.text && postData.text.trim() !== "") {
    const textEl = document.createElement("div");
    textEl.className = "post-text";
    textEl.textContent = postData.text;
    postDiv.appendChild(textEl);
  }

    // Video si existe
  if (postData.video) {
    const videoEl = document.createElement("video");
    videoEl.src = postData.video;
    videoEl.controls = true;
    videoEl.preload = "metadata";
    videoEl.style.maxWidth = "100%";
    videoEl.style.maxHeight = "500px";
    videoEl.style.borderRadius = "10px";
        videoEl.style.marginTop = "3px";
    postDiv.appendChild(videoEl);

    const initialViews = Math.max(0, Number(postData.videoViews) || 0);
    const viewCounter = document.createElement("small");
    viewCounter.className = "post-video-views";
    viewCounter.dataset.count = String(initialViews);
    viewCounter.textContent = `👁 ${initialViews} vistas`;
    viewCounter.setAttribute("aria-label", `Visualizaciones: ${initialViews}`);
    postDiv.appendChild(viewCounter);

    let countedThisPlayback = false;
    videoEl.addEventListener("playing", async () => {
      if (countedThisPlayback || !currentUser) return;
      countedThisPlayback = true;
      try {
        await updateDoc(doc(db, "posts", postId), { videoViews: increment(1) });
        // Las publicaciones del feed reciben el total actualizado desde Firestore.
        // En perfiles, actualiza también el indicador que no tiene listener en vivo.
        if (!postDiv.closest("#postsContainer")) {
          const nextViews = (Number(viewCounter.dataset.count) || initialViews) + 1;
          viewCounter.dataset.count = String(nextViews);
          viewCounter.textContent = `👁 ${nextViews} vistas`;
          viewCounter.setAttribute("aria-label", `Visualizaciones: ${nextViews}`);
        }
      } catch (error) {
        countedThisPlayback = false;
        console.warn("No se pudo registrar la visualización del video:", error);
      }
    });
    videoEl.addEventListener("ended", () => { countedThisPlayback = false; });
  }

    // Soporta publicaciones nuevas con varias fotos y las antiguas con un solo campo image.
  const imageUrls = Array.isArray(postData.images) && postData.images.length
    ? postData.images.filter((url) => typeof url === "string" && url)
    : (postData.image ? [postData.image] : []);
  if (imageUrls.length) {
    const imageGrid = document.createElement("div");
    imageGrid.className = `post-image-grid${imageUrls.length === 1 ? " single-image" : ""}`;
    imageUrls.forEach((url, index) => {
      const imageButton = document.createElement("button");
      imageButton.type = "button";
      imageButton.className = "post-image-trigger";
      imageButton.setAttribute("aria-label", `Ver imagen ${index + 1} de ${imageUrls.length}`);
      const imgEl = document.createElement("img");
      imgEl.src = url;
      imgEl.alt = `Imagen ${index + 1} de la publicación`;
      imgEl.loading = "lazy";
      imgEl.decoding = "async";
      imageButton.appendChild(imgEl);
      imageButton.addEventListener("click", () => openImageLightbox(imageUrls, index));
      imageGrid.appendChild(imageButton);
    });
    postDiv.appendChild(imageGrid);
  }

  // Código para reacciones, comentarios 
  // Crear botón de reacción corazón
  const reactionButton = document.createElement("button");
  reactionButton.className = "reaction-icon";
  reactionButton.title = "Mantén presionado para opciones de reacción";
  reactionButton.style.position = "relative";
  reactionButton.style.fontSize = "24px";
  reactionButton.style.lineHeight = "1";
  reactionButton.style.width = "36px";
  reactionButton.style.height = "36px";
  reactionButton.style.padding = "0";
  reactionButton.style.display = "flex";
  reactionButton.style.justifyContent = "center";
  reactionButton.style.alignItems = "center";
  reactionButton.style.userSelect = "none";
  reactionButton.style.border = "none";
  reactionButton.style.background = "transparent";
  reactionButton.style.cursor = "pointer";
  reactionButton.style.borderRadius = "6px";

  const emojiSpan = document.createElement("span");
  emojiSpan.textContent = "❤️";
  emojiSpan.setAttribute("aria-hidden", "true");
  reactionButton.appendChild(emojiSpan);

  const pressHandler = setupPressReaction(postDiv, postId, postData);
  pressHandler.setReactionIcon(reactionButton);

  reactionButton.addEventListener("pointerdown", pressHandler.onPointerDown);
  reactionButton.addEventListener("pointerup", pressHandler.onPointerUp);
  reactionButton.addEventListener("pointercancel", pressHandler.onPointerLeave);
  reactionButton.addEventListener("pointerleave", pressHandler.onPointerLeave);
  reactionButton.addEventListener("contextmenu", (e) => e.preventDefault());

  const reactionsSummary = createReactionsSummary(postId, postData);

  // Comentarios
  const commentsSection = document.createElement("div");
  commentsSection.className = "comments-section";
  commentsSection.textContent = "Cargando comentarios...";

  const commentForm = document.createElement("form");
  commentForm.className = "comment-form";
  const commentInput = document.createElement("input");
  commentInput.type = "text";
  commentInput.placeholder = "Escribe un comentario...";
  commentInput.className = "comment-input";
  const commentSubmit = document.createElement("button");
  commentSubmit.type = "submit";
  commentSubmit.className = "comment-submit-btn";
  commentSubmit.textContent = "Enviar";
  commentForm.appendChild(commentInput);
  commentForm.appendChild(commentSubmit);

  let replyingTo = null;
  const replyStatus = document.createElement("div");
  replyStatus.className = "reply-status";
  replyStatus.style.display = "none";
  replyStatus.style.fontSize = "12px";
  replyStatus.style.color = "#2176ff";
  replyStatus.style.marginBottom = "5px";
  commentForm.insertBefore(replyStatus, commentInput);

  function setReplyTarget(commentId, comment) {
    replyingTo = {
      id: commentId,
      authorId: comment.authorId,
      authorName: comment.authorName || "Usuario",
    };
    replyStatus.textContent = `Respondiendo a ${replyingTo.authorName}`;
    replyStatus.style.display = "block";
    commentInput.placeholder = "Escribe tu respuesta...";
    commentInput.focus();
  }

  function cancelReply() {
    replyingTo = null;
    replyStatus.textContent = "";
    replyStatus.style.display = "none";
    commentInput.placeholder = "Escribe un comentario...";
  }

  commentForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUser) return alert("Inicia sesión para comentar.");
    const text = commentInput.value.trim();
    if (!text) return;
    try {
      const userDoc = await getDoc(doc(db, "users", currentUser.uid));
      if (!userDoc.exists()) throw new Error("Usuario no encontrado.");
      const userData = userDoc.data();
      const authorName = userData.profile?.name || userData.username;
      const commentData = {
        authorId: currentUser.uid,
        authorName,
        text,
        timestamp: serverTimestamp(),
      };

      if (replyingTo) {
        commentData.parentCommentId = replyingTo.id;
        commentData.parentCommentAuthorId = replyingTo.authorId;
        commentData.parentCommentAuthorName = replyingTo.authorName;
      }

      await addDoc(collection(db, "posts", postId, "comments"), commentData);
      commentInput.value = "";
      cancelReply();
      loadComments();
    } catch (e) {
      alert("Error al comentar: " + e.message);
    }
  });

  commentInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && replyingTo) cancelReply();
  });

  async function loadComments() {
    commentsSection.innerHTML = "";
    try {
      const commentsSnap = await getDocs(
        query(collection(db, "posts", postId, "comments"), orderBy("timestamp", "asc"))
      );
      if (commentsSnap.empty) {
        commentsSection.textContent = "Sin comentarios.";
        return;
      }
      commentsSnap.forEach((docSnap) => {
        const comment = docSnap.data();
        const commentDiv = document.createElement("div");
        commentDiv.className = "comment";
        if (comment.parentCommentId) {
          commentDiv.classList.add("comment-reply");
          commentDiv.style.marginLeft = "24px";
          commentDiv.style.borderLeft = "3px solid #2176ff";
          commentDiv.style.paddingLeft = "10px";
        }

        let pressTimer;
        let replyAction;
        const showReplyAction = (event) => {
          event.preventDefault();
          if (replyAction) return;
          replyAction = document.createElement("button");
          replyAction.type = "button";
          replyAction.className = "comment-reply-action";
          replyAction.textContent = "Responder";
          replyAction.style.display = "block";
          replyAction.style.marginTop = "8px";
          replyAction.style.padding = "6px 12px";
          replyAction.style.border = "0";
          replyAction.style.borderRadius = "999px";
          replyAction.style.background = "#eaf2ff";
          replyAction.style.color = "#2176ff";
          replyAction.style.fontWeight = "700";
          replyAction.style.cursor = "pointer";
          replyAction.addEventListener("click", (replyEvent) => {
            replyEvent.stopPropagation();
            setReplyTarget(docSnap.id, comment);
            replyAction.remove();
            replyAction = null;
          });
          commentDiv.appendChild(replyAction);
        };
                commentDiv.addEventListener("pointerdown", () => {
          pressTimer = setTimeout(() => showReplyAction(new Event("longpress")), 550);
        });

        ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
          commentDiv.addEventListener(eventName, () => clearTimeout(pressTimer));
        });
        commentDiv.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          showReplyAction(event);
        });

        const authorSpan = document.createElement("div");
        authorSpan.className = "comment-author";
        authorSpan.tabIndex = 0;
        authorSpan.style.userSelect = "text";
        authorSpan.style.textDecoration = "none";
        authorSpan.addEventListener("click", () => showUserInfo(comment.authorId));

        renderDisplayName(authorSpan, comment.authorName);

        if (currentUser && currentUser.uid === comment.authorId) {
          const deleteBtn = document.createElement("button");
          deleteBtn.className = "comment-delete-btn";
          deleteBtn.textContent = "Eliminar";
          deleteBtn.title = "Eliminar comentario";
          deleteBtn.onclick = async (ev) => {
            ev.stopPropagation();
            if (!confirm("¿Eliminar este comentario?")) return;
            try {
              await deleteDoc(doc(db, "posts", postId, "comments", docSnap.id));
              loadComments();
            } catch {
              alert("Error eliminando comentario.");
            }
          };
          authorSpan.appendChild(deleteBtn);
        }

        const textSpan = document.createElement("div");
        textSpan.className = "comment-text";
        textSpan.textContent = comment.text;

        if (comment.parentCommentId) {
          const replyLabel = document.createElement("small");
          replyLabel.className = "comment-reply-label";
          replyLabel.textContent = `↳ Respuesta a ${comment.parentCommentAuthorName || "este comentario"}`;
          replyLabel.style.display = "block";
          replyLabel.style.color = "#71809a";
          replyLabel.style.marginBottom = "3px";
          commentDiv.insertBefore(replyLabel, authorSpan);
        }

        commentDiv.appendChild(authorSpan);
        commentDiv.appendChild(textSpan);
        commentsSection.appendChild(commentDiv);
      });
    } catch {
      commentsSection.textContent = "No se pudieron cargar los comentarios.";
    }
  }
  loadComments();

  // Agregar elementos reacción y comentarios al final del post
  postDiv.appendChild(reactionButton);
  postDiv.appendChild(reactionsSummary);
  postDiv.appendChild(commentsSection);
  postDiv.appendChild(commentForm);

        target.appendChild(postDiv);
    if (postData.poll) window.renderPostPoll?.(postDiv, postData.poll);
}

// Detectar si hay hash y si apunta a una publicación y mostrarla con scroll
window.addEventListener("load", () => {
  if (window.location.hash) {
    const hash = window.location.hash.substring(1);
    if (hash.startsWith("post_")) {
      const postId = hash.substring(5);
      // Si no está autenticado, mostrar login
      if (!currentUser) {
        alert("Debes iniciar sesión o registrarte para ver esta publicación.");
        elements.authSection.classList.remove("hidden");
        const appElement = document.getElementById("app");
      if (appElement) appElement.style.display = "none";
      } else {
        // Mostrar pestaña home y luego scroll a la publicación
        activateTab("home");
        setTimeout(() => {
          const postEl = document.getElementById(`post_${postId}`);
          if (postEl) {
            postEl.scrollIntoView({ behavior: "smooth", block: "center" });
            postEl.style.backgroundColor = "#ffff88";
            setTimeout(() => {
              postEl.style.transition = "background-color 2500ms ease";
              postEl.style.backgroundColor = "";
            }, 2000);
          } else {
            alert("Publicación no encontrada o eliminada.");
          }
        }, 500);
      }
    }
  }
});

// Profile loading and saving
async function loadProfile() {
  if (!currentUser) return;
  const userDoc = await getDoc(doc(db, "users", currentUser.uid));
  if (!userDoc.exists()) return;

  const userData = userDoc.data();
  const profile = userData.profile || {};

  elements.profileName.value = profile.name || "";
  elements.birthDate.value = profile.birthDate || "";
  elements.civilStatus.value = profile.civilStatus || "";
  elements.birthPlace.value = profile.birthPlace || "";
  

 elements.profilePreview.src = profile.photo || "https://uploads.onecompiler.io/44amdv2fa/44amdvnzz/acceso.png";
 elements.profileCareer.value = profile.career || "";
 elements.profileSemester.value = profile.semester || "";
}



elements.profileForm.onsubmit = async (e) => {
  e.preventDefault();
  if (!currentUser) return alert("Debes iniciar sesión.");

  const name = elements.profileName.value.trim();
  const birthDate = elements.birthDate.value;
  const civilStatus = elements.civilStatus.value;
  const birthPlace = elements.birthPlace.value.trim();
  const career = elements.profileCareer.value.trim();
  const semester = elements.profileSemester.value;
  let photoUrl = "";

  try {
    if (elements.profilePic.files.length > 0) {
      const file = elements.profilePic.files[0];
      photoUrl = await uploadToCloudinary(file);
    }
    const userRef = doc(db, "users", currentUser.uid);
    const userDoc = await getDoc(userRef);
    const userData = userDoc.exists() ? userDoc.data() : {};

    const updatedProfile = {
      name,
      birthDate,
      civilStatus,
      birthPlace,
      career,       // GUARDA carrera
      semester,     // GUARDA semestre
      photo: photoUrl || (userData.profile?.photo || ""),
    };

    await updateDoc(userRef, { profile: updatedProfile });

    alert("Perfil actualizado.");

    // Actualiza la vista previa en el formulario
    elements.profilePreview.src = updatedProfile.photo || "https://via.placeholder.com/120?text=No+Foto";
    elements.profileName.value = updatedProfile.name || "";
    elements.birthDate.value = updatedProfile.birthDate || "";
    elements.civilStatus.value = updatedProfile.civilStatus || "";
    elements.birthPlace.value = updatedProfile.birthPlace || "";
    elements.profileCareer.value = updatedProfile.career || "";
    elements.profileSemester.value = updatedProfile.semester || "";
  } catch (e) {
    alert("Error guardando perfil: " + e.message);
  }
};


// Carga las publicaciones del usuario mostrado en su perfil.
async function loadProfilePosts(uid) {
  const container = elements.profileUserPosts;
  if (!container) return;

  container.innerHTML = "";
  try {
    const postsSnapshot = await getDocs(
      query(collection(db, "posts"), where("authorId", "==", uid))
    );
    const posts = postsSnapshot.docs
      .map((postDoc) => ({ id: postDoc.id, data: postDoc.data() }))
      .sort((a, b) => {
        const aTime = a.data.timestamp?.toMillis?.() || 0;
        const bTime = b.data.timestamp?.toMillis?.() || 0;
        return bTime - aTime;
      });

    if (posts.length === 0) {
      container.innerHTML = '<p style="opacity:.85;">Esta persona todavía no ha realizado publicaciones.</p>';
      return;
    }

    for (const post of posts) {
      await renderPost(post.id, post.data, container, "profile_");
    }
  } catch (error) {
    console.error("Error cargando publicaciones del perfil:", error);
    container.innerHTML = '<p style="opacity:.85;">No se pudieron cargar las publicaciones.</p>';
  }
}

// Show user info modal
async function showUserInfo(uid) {
  const userDoc = await getDoc(doc(db, "users", uid));
  if (!userDoc.exists()) return alert("Usuario no encontrado.");
    const userData = userDoc.data();
  const p = userData.profile || {};
  elements.userInfoSection.dataset.userId = uid;
  const defaultProfilePhoto = "https://uploads.onecompiler.io/44amdv2fa/44amdvnzz/acceso.png";
  elements.userInfoPic.onerror = () => {
    elements.userInfoPic.onerror = null;
    elements.userInfoPic.src = defaultProfilePhoto;
  };
  elements.userInfoPic.src = p.photo || defaultProfilePhoto;
  const nameToShow =
    p.name && p.name.trim() !== "" ? p.name : userData.username || "Desconocido";
  renderDisplayName(elements.userInfoName, nameToShow);
  elements.userInfoUsername.textContent = userData.username || "Desconocido";

    // Respeta la privacidad elegida por cada usuario antes de mostrar sus datos.
  const profilePrivacy = userData.privacy || {};
  const canSee = (field) => profilePrivacy[field] !== "private" && (profilePrivacy[field] !== "friends" || Boolean(globalCurrentUserData?.friends || []).includes(uid) || uid === currentUser?.uid);
  const birthVisible = canSee("birthDate");
  const civilVisible = canSee("civilStatus");
  const emailVisible = canSee("email");
    // Render database values as text, never as HTML; profile fields may contain untrusted data.
  const birthDateText = birthVisible ? (p.birthDate || "N/A") : "No disponible";
  elements.userInfoBirthDate.textContent = birthDateText;
  elements.userInfoBirthDate.style.color = "";
  if (userData.activeStatus !== false && !userData.online && birthDateText !== "N/A") {
    const lastActiveTime = userData.lastActive?.toDate
      ? userData.lastActive.toDate().toLocaleString()
      : "No disponible";
    const activeLabel = document.createElement("span");
    activeLabel.style.color = "red";
    activeLabel.style.fontWeight = "bold";
    activeLabel.textContent = `Última vez activo: ${lastActiveTime}`;
    elements.userInfoBirthDate.append(document.createElement("br"), activeLabel);
    elements.userInfoBirthDate.style.color = "red";
  }


  elements.userInfoCivilStatus.textContent = civilVisible ? (p.civilStatus || "N/A") : "No disponible";
  elements.userInfoBirthPlace.textContent = p.birthPlace || "N/A";
  if (elements.userInfoEmail) elements.userInfoEmail.textContent = emailVisible ? (userData.email || "N/A") : "No disponible";
  if (elements.userInfoCareer) elements.userInfoCareer.textContent = p.career || "N/A";
  if (elements.userInfoSemester) elements.userInfoSemester.textContent = p.semester || "N/A";
  elements.userInfoSection.classList.remove("hidden");
  await loadProfilePosts(uid);
}
elements.closeUserInfoBtn.onclick = () => {
  elements.userInfoSection.classList.add("hidden");
};

// Scroll and highlight a post by id
function goToPost(postId) {
  activateTab("home");
  setTimeout(() => {
    const postEl = document.getElementById(`post_${postId}`);
    if (postEl) {
      postEl.scrollIntoView({ behavior: "smooth", block: "center" });
      highlightElement(postEl);
    }
  }, 400);
}

// INICIO BLOQUE DE NOTIFICACIONES
// Variables de caché local de notificaciones
let notificationsCache = [];

// Leer notificaciones almacenadas en localStorage
function loadNotificationsFromStorage() {
  if (!currentUser) return [];
  const raw = localStorage.getItem(`notif_data_${currentUser.uid}`);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// Guardar notificaciones actualizadas en localStorage
function saveNotificationsToStorage(notifications) {
  if (!currentUser) return;
  localStorage.setItem(`notif_data_${currentUser.uid}`, JSON.stringify(notifications));
}

// Marcar notificación como vista en storage
function markNotificationViewedLocal(notifId) {
  const notifs = loadNotificationsFromStorage();
  const idx = notifs.findIndex(n => n.id === notifId);
  if (idx !== -1 && !notifs[idx].viewed) {
    notifs[idx].viewed = true;
    saveNotificationsToStorage(notifs);
    return true;
  }
  return false;
}

// Actualizar e integrar notificaciones de Firestore con las almacenadas localmente
async function syncNotificationsWithFirestore() {
  if (!currentUser) return;

  try {
    const latestNotifs = [];

    // Obtén notificaciones desde Firestore (reacciones, comentarios, solicitudes amistad)
    // (Adaptar según tu app, similar a tu código original)

        const postsCol = collection(db, "posts");
    // Limita la sincronización al historial reciente para evitar recorridos sin tope.
    const userPostsQ = query(postsCol, where("authorId", "==", currentUser.uid), limit(20));
    const userPostsSnap = await getDocs(userPostsQ);
    const postsWithComments = await Promise.all(userPostsSnap.docs.map(async (postDoc) => ({
      postDoc,
      commentsSnap: await getDocs(query(
        collection(db, "posts", postDoc.id, "comments"),
        orderBy("timestamp", "desc"),
        limit(10)
      )),
    })));
    const userIdsToResolve = new Set();

    for (const { postDoc, commentsSnap } of postsWithComments) {
      const post = postDoc.data();
      for (const [emoji, users] of Object.entries(post.reactions || {})) {
        for (const userId of users.slice(-10)) {
          if (userId !== currentUser.uid) {
            userIdsToResolve.add(userId);
            latestNotifs.push({
              id: `${postDoc.id}_like_${emoji}_${userId}`,
              type: "like",
              message: "",
              timestamp: post.timestamp || null,
              postId: postDoc.id,
              viewed: false,
              actorId: userId,
              emoji,
            });
          }
        }
      }

      commentsSnap.forEach((commentDoc) => {
        const comment = commentDoc.data();
        if (comment.authorId !== currentUser.uid) {
          if (!comment.authorName && comment.authorId) userIdsToResolve.add(comment.authorId);
          latestNotifs.push({
            id: `${postDoc.id}_comment_${commentDoc.id}`,
            type: "comment",
            message: "",
            timestamp: comment.timestamp || null,
            postId: postDoc.id,
            viewed: false,
            actorId: comment.authorId,
            actorName: comment.authorName || "",
            commentText: comment.text || "",
          });
        }
      });
    }

    const resolvedNames = new Map(await Promise.all(
      [...userIdsToResolve].map(async (uid) => [uid, await getUserName(uid)])
    ));
    latestNotifs.forEach((notification) => {
      if (notification.type === "like") {
        notification.message = `${resolvedNames.get(notification.actorId) || "Desconocido"} reaccionó con ${notification.emoji} a tu publicación.`;
        delete notification.actorId;
        delete notification.emoji;
      } else if (notification.type === "comment") {
        const name = notification.actorName || resolvedNames.get(notification.actorId) || "Desconocido";
        notification.message = `${name} comentó en tu publicación: "${notification.commentText}"`;
        delete notification.actorId;
        delete notification.actorName;
        delete notification.commentText;
      }
    });


    

    // Solicitudes de amistad entrantes
    const currentUserDoc = await getDoc(doc(db, "users", currentUser.uid));
    if (currentUserDoc.exists()) {
      const currentUserData = currentUserDoc.data();
      const friendRequests = currentUserData.friendRequests || [];
      for (const fromUserId of friendRequests) {
        if (fromUserId !== currentUser.uid) {
          const name = await getUserName(fromUserId);
          latestNotifs.push({
            id: `friendreq_${fromUserId}`,
            type: "friendRequest",
            message: `${name} te envió una solicitud de amistad.`,
            timestamp: null,
            fromUserId,
            viewed: false,
          });
        }
      }
    }

    // Integrar notificaciones nuevas con las guardadas en localStorage, preservando estado visto
    const storedNotifs = loadNotificationsFromStorage();

    // Crear un map para búsqueda rápida por id
    const storedMap = new Map(storedNotifs.map(n => [n.id, n]));

    // Merge: preserver vistos; añadir nuevos si no existen
    latestNotifs.forEach(latest => {
      if (storedMap.has(latest.id)) {
        // Usar estado visto
        latest.viewed = storedMap.get(latest.id).viewed || false;
      }
    });

    // También conservar notifs almacenadas que ya no estén en Firestore (ej: historial)
    const allNotifsMap = new Map();
    latestNotifs.forEach(n => allNotifsMap.set(n.id, n));
    storedNotifs.forEach(n => {
      if (!allNotifsMap.has(n.id)) {
        allNotifsMap.set(n.id, n);
      }
    });

    // Arreglo final ordenado por timestamp o ID para estabilidad
    notificationsCache = Array.from(allNotifsMap.values()).sort((a, b) => {
      const aTime = a.timestamp && a.timestamp.toMillis ? a.timestamp.toMillis() : 0;
      const bTime = b.timestamp && b.timestamp.toMillis ? b.timestamp.toMillis() : 0;
      return bTime - aTime;
    });

    // Guardar en localStorage actualizado
    saveNotificationsToStorage(notificationsCache);
  } catch (e) {
    console.error("Error sincronizando notificaciones:", e);
  }
}

// Cargar y mostrar notificaciones desde cache local (localStorage) y recargar en bg desde Firestore
async function loadNotifications() {
  if (!currentUser) {
    elements.notificationsList.innerHTML = "<li>Inicia sesión para ver notificaciones.</li>";
    setNotificationBadge(0);
    return;
  }

  // Mostrar desde localStorage inmediatamente
  notificationsCache = loadNotificationsFromStorage();

  renderNotifications();

  // Actualizar en background desde Firestore para integrar las nuevas
  await syncNotificationsWithFirestore();

  // Refrescar lista con datos nuevos
  renderNotifications();
}

// Renderizar lista en UI
function renderNotifications() {
  elements.notificationsList.innerHTML = "";

  if (notificationsCache.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No hay nuevas notificaciones.";
    elements.notificationsList.appendChild(li);
    setNotificationBadge(0);
    return;
  }

  let unreadCount = 0;

    notificationsCache.forEach(n => {
    const li = document.createElement("li");
    li.style.userSelect = "none";
    li.classList.add("clickable");
    li.title = "Haz clic para ver";

    const msgSpan = document.createElement("span");
    msgSpan.textContent = n.message;
    li.appendChild(msgSpan);

    if (n.viewed) {
      li.classList.add("viewed");
    } else {
      unreadCount++;
    }

    li.onclick = () => {
      if (!n.viewed) {
        const changed = markNotificationViewedLocal(n.id);
        if (changed) {
          n.viewed = true;
          unreadCount = Math.max(0, unreadCount - 1);
          setNotificationBadge(unreadCount);
          li.classList.add("viewed");
        }
      }

            if (n.viewed) msgSpan.classList.add("viewed");

    // Si es solicitud amistad, agregamos botón aceptar pequeño
    if (n.type === "friendRequest" && !n.viewed) {
      const acceptBtn = document.createElement("button");
      acceptBtn.textContent = "Aceptar";
      acceptBtn.style.marginLeft = "12px";
      acceptBtn.style.padding = "2px 8px";
      acceptBtn.style.fontSize = "12px";
      acceptBtn.style.borderRadius = "6px";
      acceptBtn.style.cursor = "pointer";
      acceptBtn.style.backgroundColor = "#2176FF";
      acceptBtn.style.color = "white";
      acceptBtn.title = "Aceptar solicitud de amistad";
      acceptBtn.onclick = async (e) => {
        e.stopPropagation(); // evitar trigger del click en li
        acceptBtn.disabled = true;
        acceptBtn.textContent = "Aceptando...";
        await acceptFriendRequestFromNotif(n.fromUserId);
      };
      li.appendChild(acceptBtn);
    }
    
      // Acción según tipo
      switch (n.type) {
        case "friendRequest":
          // Mostrar sección usuarios para gestionar solicitudes
          activateTab("users");
          break;
        case "message":
          // Abrir chat con remitente
          activateTab("messages");
          if (n.fromUserId) getUserName(n.fromUserId).then(name => openChat(name, n.fromUserId));
          break;
        case "like":
        case "comment":
          // Ir a publicación respectiva
          goToPost(n.postId);
          break;
        default:
          activateTab("home");
          break;
      }
    };

    elements.notificationsList.appendChild(li);
  });

  setNotificationBadge(unreadCount);
}

// Marcar todas las notificaciones como leídas en localStorage y actualizar UI
elements.markAllReadBtn.onclick = () => {
  if (!currentUser) return;

  notificationsCache.forEach(n => {
    n.viewed = true;
  });

  saveNotificationsToStorage(notificationsCache);
  loadNotifications();
};

// Actualiza el badge con el total de no leídos
function setNotificationBadge(count) {
  if (count > 0) {
    elements.notificationBadge.textContent = count;
    elements.notificationBadge.classList.remove("hidden");
  } else {
    elements.notificationBadge.classList.add("hidden");
    elements.notificationBadge.textContent = "0";
  }
}

// Final del bloque de notificaciones


// --- NUEVO: Manejo del badge de mensajes sin leer en el botón de mensajes ---
const messageBadge = document.createElement("span");
messageBadge.className = "badge hidden";
elements.btnMessages.appendChild(messageBadge);

function setMessagesBadge(n) {
  if (n > 0) {
    messageBadge.textContent = n;
    messageBadge.classList.remove("hidden");
  } else {
    messageBadge.classList.add("hidden");
  }
}

// Variable cache para almacenar por usuario el número de mensajes sin leer para que se use en renderUsers
let cachedUnreadMessagesPerUser = {};


// Auth forms
const loginForm = document.getElementById("loginForm");
const loginUser = document.getElementById("loginUser");
const loginPass = document.getElementById("loginPass");
const loginError = document.getElementById("loginError");

const registerForm = document.getElementById("registerForm");
const regUser = document.getElementById("regUser");
const regPass = document.getElementById("regPass");
const regPassConfirm = document.getElementById("regPassConfirm");
const registerError = document.getElementById("registerError");

loginForm.onsubmit = async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const email = loginUser.value.trim();
  const password = loginPass.value;
  if (!email || !password) {
    loginError.textContent = "Completa todos los campos.";
    return;
  }
  try {
        await signInWithEmailAndPassword(auth, email, password);
    loginUser.value = "";
    loginPass.value = "";

  } catch (err) {
    if (err.code === "auth/wrong-password" || err.code === "auth/user-not-found") {
      loginError.textContent = "Correo o contraseña incorrectos.";
    } else {
      loginError.textContent = err.message || "Error iniciando sesión.";
    }
  }
};

registerForm.onsubmit = async (e) => {
  e.preventDefault();
  registerError.textContent = "";
  const email = regUser.value.trim();
  const password = regPass.value;
  const confirm = regPassConfirm.value;
  if (!email || !password || !confirm) {
    registerError.textContent = "Completa todos los campos.";
    return;
  }
    if (!/^[^\s@]+@unicartagena\.edu\.co$/i.test(email)) {
    registerError.textContent = "Solo puedes registrarte con un correo @unicartagena.edu.co.";
    return;
  }
  if (password.length < 6) {
    registerError.textContent = "Contraseña debe tener al menos 6 caracteres.";
    return;
  }
  if (password !== confirm) {
    registerError.textContent = "Las contraseñas no coinciden.";
    return;
  }
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    currentUser = userCredential.user;
    const username = email.split("@")[0].toLowerCase();
    await setDoc(doc(db, "users", currentUser.uid), {
      email,
      username,
            online: true,
      activeStatus: true,
      lastActive: serverTimestamp(),
            profile: { name: "", photo: "", birthDate: "", civilStatus: "", birthPlace: "" },
      privacy: { birthDate: "public", civilStatus: "public", email: "private" },
      activeStatus: true,
      friends: [],
      friendRequests: [],
      friendRequestsSent: [],
    });
    regUser.value = "";
    regPass.value = "";
        regPassConfirm.value = "";
    elements.authSection.classList.add("hidden");

    // Request notification permission and token on signup

    await requestNotificationPermissionAndToken();
  } catch (err) {
    if (err.code === "auth/email-already-in-use") {
      registerError.textContent = "Este correo ya está registrado.";
    } else {
      registerError.textContent = err.message || "Error registrando usuario.";
    }
  }
};

// Register one unload handler; adding one per sign-in would leak listeners.
window.addEventListener("beforeunload", () => {
  if (!currentUser) return;
  updateDoc(doc(db, "users", currentUser.uid), {
    online: false,
    lastActive: serverTimestamp(),
  }).catch(() => {});
});

// Auth state change
onAuthStateChanged(auth, async (user) => {

    if (user) {
        currentUser = user;
    hideAuthScreen();
    showNavigation(true);
    activateTab("home");
        const statusSnap = await getDoc(doc(db, "users", currentUser.uid));

    const statusData = statusSnap.exists() ? statusSnap.data() : {};
    await updateDoc(doc(db, "users", currentUser.uid), {
      online: statusData.activeStatus !== false,
      lastActive: serverTimestamp(),
    });
    
    await loadNotifications();

        } else {

    if (currentUser) {
      try {
        await updateDoc(doc(db, "users", currentUser.uid), {
          online: false,
          lastActive: serverTimestamp(),
        });
      } catch {}
    }
            currentUser = null;
    showAuthScreen();
    showNavigation(false);
    // Restablecer completamente la vista pública tras cerrar sesión.

    elements.registerFullScreen?.classList.add("hidden");
    elements.authSection.scrollTop = 0;
    document.getElementById("loginForm")?.reset();
    document.getElementById("registerForm")?.reset();
        const appElement = document.getElementById("app");
    if (appElement) appElement.style.display = "flex";
    elements.homeSection.classList.add("hidden");
    elements.usersSection.classList.add("hidden");
    elements.profileSection.classList.add("hidden");
    elements.notificationsSection.classList.add("hidden");
    elements.messagesSection.classList.add("hidden");
    elements.userInfoSection.classList.add("hidden");
    elements.reactionsViewModal.classList.add("hidden");
    stopPostsListener();
    clearChatMessages();
    elements.postsContainer.innerHTML = "";
    elements.postSection.classList.add("hidden");
    setNotificationBadge(0);
    setMessagesBadge(0);
    previousUnreadNotifCount = 0;
  }
});



// Mostrar modal de términos si no aceptados antes
async function checkTermsAccepted(userId) {
  // Usamos localStorage + Firestore campo para persistencia sencilla
  // Primero verifica localStorage
  const acceptedKey = `termsAccepted_${userId}`;
  if (localStorage.getItem(acceptedKey) === 'true') {
    return true;
  }

  // Luego verifica en Firestore (campo userDoc.data().termsAccepted)
  try {
    const userDocSnap = await getDoc(doc(db, "users", userId));
    if (userDocSnap.exists()) {
      const data = userDocSnap.data();
      if (data.termsAccepted) {
        localStorage.setItem(acceptedKey, 'true');
        return true;
      }
    }
  } catch (e) {
    console.warn("Error comprobando términos:", e);
  }
  return false;
}

// Mostrar/Ocultar el modal de términos
const termsModal = document.getElementById('termsModal');
const acceptCheckbox = document.getElementById('acceptTermsCheckbox');
const acceptBtn = document.getElementById('acceptTermsBtn');

function openTermsModalFromSettings() {
  if (!termsModal || !currentUser) return;
  // Desde Configuración, los términos ya fueron aceptados durante el registro.
  // La casilla queda marcada y bloqueada para que no pueda desactivarse.
  acceptCheckbox.checked = true;
  acceptCheckbox.disabled = true;
  acceptBtn.disabled = false;
  termsModal.style.display = 'flex';
  elements.settingsModal?.classList.add('hidden');
  elements.settingsDetailModal?.classList.add('hidden');
}

acceptCheckbox.onchange = () => {
  acceptBtn.disabled = !acceptCheckbox.checked;
};

acceptBtn.onclick = async () => {
  if (!currentUser) return;
  const userRef = doc(db, "users", currentUser.uid);
  try {
    // Guardar aceptación en Firestore
    await updateDoc(userRef, { termsAccepted: true });
    // También en localStorage para acceso rápido
    localStorage.setItem(`termsAccepted_${currentUser.uid}`, 'true');
    termsModal.style.display = 'none';
    // Permite activar la aplicación normalmente
    activateTab('home');
  } catch (e) {
    alert("Error guardando aceptación: " + e.message);
  }
};

// Modifica onAuthStateChanged para comprobar y requerir aceptación
onAuthStateChanged(auth, async (user) => {
    if (user) {
    currentUser = user;
    hideAuthScreen();

    // Comprobar termsAccepted para el usuario
    const accepted = await checkTermsAccepted(user.uid);
        if (!accepted) {
      // En el registro inicial la casilla debe poder marcarse manualmente.
      acceptCheckbox.checked = false;
      acceptCheckbox.disabled = false;
      acceptBtn.disabled = true;
      // Mostrar modal y ocultar app hasta aceptar
            // The terms dialog is inside #app, so keep its parent visible beneath the modal.
      termsModal.style.display = 'flex';
      elements.app.style.display = 'flex';
    } else {
      termsModal.style.display = 'none';
      elements.app.style.display = 'flex';
      activateTab('home');
    }

    // Resto código ya existente...
    } else {
      currentUser = null;
      showAuthScreen();
      elements.homeSection.classList.add("hidden");
      elements.usersSection.classList.add("hidden");
      elements.profileSection.classList.add("hidden");
      elements.notificationsSection.classList.add("hidden");
      elements.messagesSection.classList.add("hidden");
      elements.userInfoSection.classList.add("hidden");
      elements.reactionsViewModal.classList.add("hidden");
      stopPostsListener();
      clearChatMessages();
      elements.postsContainer.innerHTML = "";
      elements.postSection.classList.add("hidden");
      setNotificationBadge(0);
      setMessagesBadge(0);
      previousUnreadNotifCount = 0;

            // Asegura ocultar modal si hubiera y muestra nuevamente el acceso.
      termsModal.style.display = 'none';
      elements.app.style.display = 'flex';
      elements.authSection.classList.remove('hidden');
      showNavigation(false);
  }
});

function showNavigation(show) {
  const navButtons = [
    elements.btnHome,
    elements.btnNotifications,
    elements.btnUsers,
    elements.btnProfile,
    elements.btnMessages,
    elements.btnSettings
  ];
  navButtons.forEach(btn => {
    btn.style.display = show ? "" : "none";
  });
}


// Function to request notification permission and get FCM token
async function requestNotificationPermissionAndToken() {
  if (!messaging || !("Notification" in window) || !("serviceWorker" in navigator)) {
    console.log("Notificaciones no soportadas en este navegador.");
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      // Replace with your Firebase Cloud Messaging VAPID key:
      const vapidKey = "BA_UJcV9--ZaqS3hR7xfG1IOXYjq6VtbbyVSiuI3A-9SDYw2ajnsZOiMVdBMZ8MptaBYrd5Z9GOLiSbhnGBnWMc";

      const token = await getToken(messaging, { vapidKey });
      console.log("Token FCM:", token);
      if (currentUser && token) {
        await updateDoc(doc(db, "users", currentUser.uid), { fcmToken: token });
      }
    } else {
      console.log("Permiso para notificaciones no concedido");
    }
  } catch (err) {
    console.error("Error solicitando permisos o token:", err);
  }
}

// Show notifications while app is in foreground and play sound
if (messaging) onMessage(messaging, (payload) => {
  console.log("Mensaje recibido en primer plano: ", payload);
  if (Notification.permission === "granted") {
    new Notification(payload.notification.title, {
      body: payload.notification.body,
      icon: payload.notification.icon || "/favicon.ico",
    });
    // Play sound manually (Notification API does not support sound directly)
    const audio = new Audio("/notification_sound.mp3");
    audio.play().catch(() => {
      // ignoring errors from autoplay restrictions
    });
  }
});

// USERS LIST & FRIEND REQUESTS & CHAT BUTTONS
async function renderUsers(searchTerm = "") {
  elements.usersList.innerHTML = "";
  if (!currentUser) {
    elements.usersList.textContent = "Inicia sesión para ver usuarios.";
    return;
  }
  try {
    const usersSnap = await getDocs(collection(db, "users"));
    const currentUserDoc = await getDoc(doc(db, "users", currentUser.uid));
    const currentUserData = currentUserDoc.data();
        const friends = currentUserData.friends || [];
    const blockedUsers = new Set(currentUserData.blockedUsers || []);
    const friendRequestsSent = currentUserData.friendRequestsSent || [];
    const incomingFriendRequests = currentUserData.friendRequests || [];

    for (const userDoc of usersSnap.docs) {
      if (userDoc.id === currentUser.uid || blockedUsers.has(userDoc.id)) continue;
      const userData = userDoc.data();
      const profileName = userData.profile?.name?.trim();
      const username =
        profileName && profileName !== ""
          ? profileName
          : userData.username || userData.email.split("@")[0];
      if (searchTerm && username !== searchTerm) continue;

      const li = document.createElement("li");

      const spanName = document.createElement("span");
      spanName.className = "username";
      spanName.tabIndex = 0;
      spanName.style.position = "relative";

     // Agregar círculo verde a la izquierda si el usuario está online
if (userData.online && userData.activeStatus !== false) {
  const onlineCircle = document.createElement("span");
  onlineCircle.className = "online-indicator";
  onlineCircle.style.position = "absolute";
  onlineCircle.style.left = "0";
  onlineCircle.style.top = "50%";
  onlineCircle.style.transform = "translateY(-50%)";
  spanName.style.paddingLeft = "18px"; // espacio para el círculo
  spanName.appendChild(onlineCircle);
}

      // Nombre e icono se renderizan como elementos separados para mantenerlos en línea.
      const nameContent = document.createElement("span");
      nameContent.className = "user-name-content";
      renderDisplayName(nameContent, username);
      spanName.appendChild(nameContent);

      // Abrir el perfil al pulsar o usar Enter sobre el nombre.
      spanName.addEventListener("click", () => showUserInfo(userDoc.id));
      spanName.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          showUserInfo(userDoc.id);
        }
      });


      // Mostrar número de mensajes sin leer junto al nombre, si hay
      const unreadCountForUser = cachedUnreadMessagesPerUser[userDoc.id] || 0;
      if (unreadCountForUser > 0) {
        const unreadSpan = document.createElement("span");
        unreadSpan.className = "badge";
        unreadSpan.style.marginLeft = "8px";
        unreadSpan.style.verticalAlign = "middle";
        unreadSpan.textContent = unreadCountForUser;
        spanName.appendChild(unreadSpan);
      }

      li.appendChild(spanName);

      if (friends.includes(userDoc.id)) {
        const chatBtn = document.createElement("button");
        chatBtn.className = "chatButton";
        chatBtn.textContent = "Chat";
        chatBtn.onclick = () => {
          const name = userData.profile?.name || username;
          openChat(name, userDoc.id);
          activateTab("messages");
        };
        li.appendChild(chatBtn);
      } else if (incomingFriendRequests.includes(userDoc.id)) {
        const acceptBtn = document.createElement("button");
        acceptBtn.className = "acceptFriendBtn";
        acceptBtn.textContent = "Aceptar";
        acceptBtn.onclick = async () => {
          try {
            await acceptFriendRequest(userDoc.id);
            alert("Solicitud de amistad aceptada.");
            renderUsers(searchTerm);
          } catch {
            alert("Error aceptando solicitud.");
          }
        };
        li.appendChild(acceptBtn);
      } else if (friendRequestsSent.includes(userDoc.id)) {
        const sentBtn = document.createElement("button");
        sentBtn.className = "friendBtn";
        sentBtn.textContent = "Enviada";
        sentBtn.disabled = true;
        li.appendChild(sentBtn);
      } else {
        const addBtn = document.createElement("button");
        addBtn.className = "friendBtn";
        addBtn.textContent = "Agregar";
        addBtn.onclick = async () => {
          try {
            await sendFriendRequest(userDoc.id);
            alert("enviada.");
            renderUsers(searchTerm);
          } catch {
            alert("Error enviando solicitud.");
          }
        };
        li.appendChild(addBtn);
      }
      elements.usersList.appendChild(li);
    }
  } catch {
    elements.usersList.textContent = "Error cargando usuarios.";
  }
}

elements.searchUser.oninput = () => renderUsers(elements.searchUser.value.trim());

async function sendFriendRequest(toUserId) {
  if (!currentUser) throw new Error("No autenticado");
  const fromUserRef = doc(db, "users", currentUser.uid);
  const toUserRef = doc(db, "users", toUserId);

  const fromUserDoc = await getDoc(fromUserRef);
  const fromSent = fromUserDoc.data().friendRequestsSent || [];
  if (!fromSent.includes(toUserId)) {
    await updateDoc(fromUserRef, {
      friendRequestsSent: fromSent.concat(toUserId),
    });
  }

  const toUserDoc = await getDoc(toUserRef);
  const toRequests = toUserDoc.data().friendRequests || [];
  if (!toRequests.includes(currentUser.uid)) {
    await updateDoc(toUserRef, {
      friendRequests: toRequests.concat(currentUser.uid),
    });
  }
}

async function acceptFriendRequestFromNotif(fromUserId) {
  await acceptFriendRequest(fromUserId);
  const notification = notificationsCache.find(
    (item) => item.id === `friendreq_${fromUserId}`
  );
  if (notification) notification.viewed = true;
  saveNotificationsToStorage(notificationsCache);
  renderNotifications();
}

async function acceptFriendRequest(fromUserId) {
  if (!currentUser) throw new Error("No autenticado");
  const currentUserRef = doc(db, "users", currentUser.uid);
  const fromUserRef = doc(db, "users", fromUserId);

  const currentUserDoc = await getDoc(currentUserRef);
  const fromUserDoc = await getDoc(fromUserRef);
  if (!currentUserDoc.exists() || !fromUserDoc.exists()) throw new Error("Usuario no encontrado");

  const currentUserData = currentUserDoc.data();
  const fromUserData = fromUserDoc.data();

  const newCurrentUserFriends = (currentUserData.friends || []).concat(fromUserId);
  const newFromUserFriends = (fromUserData.friends || []).concat(currentUser.uid);

  const newCurrentUserFriendRequests = (currentUserData.friendRequests || []).filter((id) => id !== fromUserId);
  const newFromUserFriendRequestsSent = (fromUserData.friendRequestsSent || []).filter(
    (id) => id !== currentUser.uid
  );

  await updateDoc(currentUserRef, {
    friends: newCurrentUserFriends,
    friendRequests: newCurrentUserFriendRequests,
  });

  await updateDoc(fromUserRef, {
    friends: newFromUserFriends,
    friendRequestsSent: newFromUserFriendRequestsSent,
  });
}

// Chat functions with animations for read messages and read timestamp display
// Chat functions with animations for read messages and read timestamp display
function clearChatMessages() {
  chatOpenGeneration++;
  elements.chatMessages.innerHTML = "";
  if (elements.chatWindow) elements.chatWindow.dataset.chatId = "";
  elements.messagesSection?.classList.remove("messages-chat-open");
  const chatOptions = document.getElementById("chatOptionsContainer");
  if (chatOptions) chatOptions.innerHTML = "";
  const mobileBackButton = document.getElementById("mobileChatBackBtn");
  if (mobileBackButton) mobileBackButton.remove();
  elements.chatWindow.hidden = true;
  elements.usersInMessages.style.display = "flex";
  chatImageData = null;
  elements.chatImagePreview.style.display = "none";
  elements.chatImagePreview.src = "";
  elements.chatImageClearBtn.style.display = "none";
  elements.chatImageInput.value = "";
}

// Obtiene el último mensaje para ordenar y mostrar la vista previa.
async function getLastMessageData(friendId) {
  if (!currentUser) return null;
  try {
    const chatId = [currentUser.uid, friendId].sort().join("_");
    const messagesSnap = await getDocs(query(
      collection(db, "chats", chatId, "messages"),
      orderBy("timestamp", "desc")
    ));
    return messagesSnap.empty ? null : messagesSnap.docs[0].data();
  } catch {
    return null;
  }
}

function getConversationPreview(message) {
  if (!message) return "Sin mensajes aún";
  const content = message.message || (message.image ? "📷 Imagen" : message.audio ? "🎤 Nota de voz" : "Mensaje");
  return `${message.sender === currentUser?.uid ? "Tú: " : ""}${content}`;
}

async function renderConversations() {
  if (!currentUser) return;
  elements.usersInMessages.innerHTML = "";
  if (unsubscribeMessages) {
    unsubscribeMessages();
    unsubscribeMessages = null;
  }
  elements.chatWindow.hidden = true;
  elements.usersInMessages.style.display = "flex";
  try {
    const usersSnap = await getDocs(collection(db, "users"));
    const currentUserDoc = await getDoc(doc(db, "users", currentUser.uid));
        const currentUserData = currentUserDoc.data();
    const blockedUsers = new Set(currentUserData.blockedUsers || []);
    const friends = (currentUserData.friends || []).filter((friendId) => !blockedUsers.has(friendId));

    if (friends.length === 0) {
      const noFriendsMsg = document.createElement("p");
      noFriendsMsg.textContent = "No tienes amigos agregados para chatear.";
      noFriendsMsg.style.textAlign = "center";
      noFriendsMsg.style.color = "#888";
      elements.usersInMessages.appendChild(noFriendsMsg);
      return;
    }

        // Obtener el último mensaje para ordenar y mostrarlo debajo del nombre.
    const friendsWithLastMsg = await Promise.all(
      friends.map(async (friendId) => {
        const lastMessage = await getLastMessageData(friendId);
        return {
          friendId,
          lastMessage,
          lastTimestamp: lastMessage?.timestamp?.toMillis?.() || 0,
        };
      })
    );

    friendsWithLastMsg.sort((a, b) => b.lastTimestamp - a.lastTimestamp);

    // Cache the unread counts para actualizar badges
    const unreadCounts = {};

    // Setup real-time listener para mensajes no leídos por amigo
    const unsubscribers = [];
    for (const friendData of friendsWithLastMsg) {
      const friendId = friendData.friendId;
      const chatId = [currentUser.uid, friendId].sort().join("_");
      const messagesCol = collection(db, "chats", chatId, "messages");
      const unreadQ = query(
        messagesCol,
        where("sender", "==", friendId),
        where("read", "==", false)
      );

      const unsubscribeUnread = onSnapshot(unreadQ, (snapshot) => {
        unreadCounts[friendId] = snapshot.size;
        updateUserButtonBadge(friendId, unreadCounts[friendId]);
        updateMessagesBadgeSum(unreadCounts);
      });
      unsubscribers.push(unsubscribeUnread);
    }

    if (unsubscribeUnreadMessagesListeners) {
      unsubscribeUnreadMessagesListeners.forEach((f) => f());
    }
    unsubscribeUnreadMessagesListeners = unsubscribers;

    // Botón para mostrar todas las personas online (no solo amigos)
    const onlineUsersBtn = document.createElement("button");
    onlineUsersBtn.textContent = "Personas Online";
    onlineUsersBtn.style.width = "100%";
    onlineUsersBtn.style.marginBottom = "12px";
    onlineUsersBtn.style.padding = "10px";
    onlineUsersBtn.style.fontWeight = "700";
    onlineUsersBtn.style.borderRadius = "8px";
    onlineUsersBtn.style.border = "none";
    onlineUsersBtn.style.backgroundColor = "#2176FF";
    onlineUsersBtn.style.color = "white";
    onlineUsersBtn.style.cursor = "pointer";
    onlineUsersBtn.style.userSelect = "none";
    onlineUsersBtn.onclick = async () => {
      elements.usersInMessages.innerHTML = "";
      const onlineUsersSnap = await getDocs(collection(db, "users"));
      const onlineUsers = onlineUsersSnap.docs.filter(doc => doc.data().online && doc.data().activeStatus !== false && doc.id !== currentUser.uid);

      if (onlineUsers.length === 0) {
        const noOnlineMsg = document.createElement("p");
        noOnlineMsg.textContent = "No hay usuarios en línea.";
        noOnlineMsg.style.textAlign = "center";
        noOnlineMsg.style.color = "#888";
        elements.usersInMessages.appendChild(noOnlineMsg);
        return;
      }

      for (const userDoc of onlineUsers) {
        const userData = userDoc.data();
        const profileName = userData.profile?.name?.trim();
        const username =
          profileName && profileName !== ""
            ? profileName
            : userData.username || userData.email.split("@")[0];

        const btn = document.createElement("button");
        btn.title = `Abrir chat con ${username}`;
        btn.style.whiteSpace = "nowrap";
        btn.style.fontWeight = "600";
        btn.style.marginBottom = "6px";
        btn.style.backgroundColor = "#d0e2ff";
        btn.style.color = "#2176FF";
        btn.style.border = "1px solid #2176FF";
        btn.style.borderRadius = "8px";
        btn.style.padding = "8px 12px";
        btn.style.cursor = "pointer";
        btn.style.userSelect = "none";
        btn.style.width = "100%";
        btn.style.textAlign = "left";
        btn.style.position = "relative";

        // Círculo verde para online
        const onlineCircle = document.createElement("span");
        onlineCircle.className = "online-indicator";
        onlineCircle.style.position = "absolute";
        onlineCircle.style.left = "12px";
        onlineCircle.style.top = "50%";
        onlineCircle.style.transform = "translateY(-50%)";
        btn.style.paddingLeft = "40px";
        btn.appendChild(onlineCircle);

        // Nombre
        const nameSpan = document.createElement("span");
        nameSpan.textContent = username;
        nameSpan.style.fontWeight = "600";
        nameSpan.style.color = "#2176FF";
        btn.appendChild(nameSpan);

        btn.onclick = () => {
          openChat(username, userDoc.id);
          activateTab("messages");
        };

        elements.usersInMessages.appendChild(btn);
      }

      // Botón para volver a conversaciones de amigos
      const backBtn = document.createElement("button");
      backBtn.textContent = "← Volver a Conversaciones";
      backBtn.style.marginTop = "12px";
      backBtn.style.padding = "8px";
      backBtn.style.borderRadius = "8px";
      backBtn.style.border = "none";
      backBtn.style.backgroundColor = "#2176FF";
      backBtn.style.color = "white";
      backBtn.style.cursor = "pointer";
      backBtn.style.userSelect = "none";
      backBtn.onclick = () => {
        renderConversations();
      };
      elements.usersInMessages.appendChild(backBtn);
    };
    elements.usersInMessages.appendChild(onlineUsersBtn);

    // Render user buttons para conversaciones recientes con orden y estilos mejorados
    for (const friendData of friendsWithLastMsg) {
      const friendId = friendData.friendId;
      const userDoc = usersSnap.docs.find((d) => d.id === friendId);
      if (!userDoc) continue;
            const userData = userDoc.data();
      const name = userData.profile?.name || userData.username;

      const btn = document.createElement("button");
      btn.dataset.uid = friendId;
      btn.title = `Abrir chat con ${name}`;
      btn.style.whiteSpace = "nowrap";
      btn.style.fontWeight = "600";
      btn.style.marginBottom = "8px";
      btn.style.backgroundColor = "#d0e2ff";
      btn.style.color = "#2176FF";
      btn.style.border = "1px solid #2176FF";
      btn.style.borderRadius = "12px";
      btn.style.padding = "10px 20px";
      btn.style.cursor = "pointer";
      btn.style.userSelect = "none";
      btn.style.display = "flex";
      btn.style.alignItems = "center";
      btn.style.justifyContent = "space-between";
      btn.style.boxShadow = "0 2px 5px rgba(33, 118, 255, 0.2)";
      btn.style.transition = "background-color 0.3s ease";

      btn.onmouseenter = () => {
        btn.style.backgroundColor = "#2176FF";
        btn.style.color = "white";
        btn.style.boxShadow = "0 4px 15px rgba(33, 118, 255, 0.5)";
      };
      btn.onmouseleave = () => {
        btn.style.backgroundColor = "#d0e2ff";
        btn.style.color = "#2176FF";
        btn.style.boxShadow = "0 2px 5px rgba(33, 118, 255, 0.2)";
      };

            // Nombre horizontal, icono de verificación al final y vista previa debajo.
      const personHeader = document.createElement("span");
      personHeader.className = "conversation-person-header";
      renderDisplayName(personHeader, name);

      const preview = document.createElement("span");
      preview.className = "conversation-preview";
      preview.textContent = getConversationPreview(friendData.lastMessage);

      const status = document.createElement("span");
      status.className = "conversation-status";
      if (userData.activeStatus !== false) {
        status.classList.add(userData.online ? "online" : "offline");
        status.title = userData.online ? "Activo" : "No activo";
        status.setAttribute("aria-label", userData.online ? "Activo" : "No activo");
      } else {
        status.classList.add("status-hidden");
        status.setAttribute("aria-hidden", "true");
      }

      const conversationText = document.createElement("span");
      conversationText.className = "conversation-text";
      conversationText.append(personHeader, preview);
      btn.append(status, conversationText);

      // Badge icono para mensajes no leídos
      const badgeSpan = document.createElement("span");
      badgeSpan.className = "badge hidden";
      badgeSpan.style.marginLeft = "10px";
      badgeSpan.style.minWidth = "24px";
      badgeSpan.style.textAlign = "center";
      badgeSpan.style.fontSize = "14px";
      badgeSpan.style.fontWeight = "700";
      badgeSpan.style.backgroundColor = "#e63946";
      badgeSpan.style.color = "white";
      badgeSpan.style.borderRadius = "12px";
      badgeSpan.style.padding = "2px 8px";
      badgeSpan.style.userSelect = "none";
      btn.appendChild(badgeSpan);

      // Configurar badge inicial desde cache
      const initialUnread = cachedUnreadMessagesPerUser[friendId] || 0;
      updateUserButtonBadge(friendId, initialUnread, btn);

      btn.onclick = () => {
        openChat(name, friendId);
      };

      elements.usersInMessages.appendChild(btn);
    }

    // Actualiza badge individual de usuario con botón opcional
    function updateUserButtonBadge(friendId, count, btnToUpdate) {
      if (!btnToUpdate) {
        // Buscar botón si no está dado
        const btns = elements.usersInMessages.querySelectorAll("button");
        for (const btn of btns) {
          if (!btn.textContent) continue;
          const cleanText = btn.textContent.replace(verifiedIconHTML, "").trim();
          const userDoc = usersSnap.docs.find((d) => {
            const userData = d.data();
            const profName = userData.profile?.name?.trim();
            const userName = profName && profName !== "" ? profName : userData.username || "";
            return userName === cleanText;
          });
          if (userDoc && userDoc.id === friendId) {
            btnToUpdate = btn;
            break;
          }
        }
        if (!btnToUpdate) return;
      }
      const badge = btnToUpdate.querySelector(".badge");
      if (!badge) return;
      if (count > 0) {
        badge.textContent = count;
        badge.classList.remove("hidden");
      } else {
        badge.textContent = "";
        badge.classList.add("hidden");
      }
      cachedUnreadMessagesPerUser[friendId] = count;
    }

    // Update total messages badge on btnMessages from unreadCounts sum
    function updateMessagesBadgeSum(unreadCounts) {
      const total = Object.values(unreadCounts).reduce((acc, val) => acc + val, 0);
      setMessagesBadge(total);
      cachedUnreadMessagesPerUser = { ...unreadCounts };
      updateLogoBadge();
    }
  } catch {
    elements.usersInMessages.textContent = "Error cargando conversaciones.";
  }
}

// Store unsubscribe functions for unread message listeners on friends, to clean up on re-render
let unsubscribeUnreadMessagesListeners = null;

function formatReadTimestamp(timestamp) {
  if (!timestamp) return "";
  const d = timestamp.toDate ? timestamp.toDate() : timestamp;
  return d.toLocaleString();
}

async function openChat(name, friendId) {
  if (!currentUser) return;
  const openGeneration = ++chatOpenGeneration;
  chatWithUser = friendId;
  const chatSettings = await getChatSettings(friendId);
  if (openGeneration !== chatOpenGeneration || !currentUser || chatWithUser !== friendId) return;
  chatReadReceiptsDisabled = chatSettings.readReceiptsDisabledFor === currentUser.uid;
    elements.chatWithName.textContent = name;
  renderChatOptions();

  // En móviles se muestra solo el chat; este botón permite regresar a la lista.
  const existingMobileBackButton = document.getElementById("mobileChatBackBtn");
  if (existingMobileBackButton) existingMobileBackButton.remove();
  const mobileBackButton = document.createElement("button");
  mobileBackButton.id = "mobileChatBackBtn";
  mobileBackButton.type = "button";
  mobileBackButton.className = "mobile-chat-back-button";
  mobileBackButton.textContent = "← Conversaciones";
  mobileBackButton.setAttribute("aria-label", "Volver a la lista de conversaciones");
  mobileBackButton.onclick = () => {
    if (unsubscribeMessages) {
      unsubscribeMessages();
      unsubscribeMessages = null;
    }
    chatWithUser = null;
    elements.chatWindow.hidden = true;
    elements.messagesSection?.classList.remove("messages-chat-open");
    elements.usersInMessages.style.display = "flex";
    mobileBackButton.remove();
    clearChatMessages();
  };
  elements.chatWindow.insertBefore(mobileBackButton, elements.chatWindow.firstChild);
  elements.chatWindow.hidden = false;
  elements.messagesSection?.classList.add("messages-chat-open");
  // En móvil se oculta la lista mientras se conversa; en escritorio permanece visible.
  elements.usersInMessages.style.display = "flex";
  elements.chatMessages.innerHTML = "";
  elements.messagesSection.classList.remove("hidden");

  if (unsubscribeMessages) {
    unsubscribeMessages();
    unsubscribeMessages = null;
  }

    const chatId = [currentUser.uid, friendId].sort().join("_");
  elements.chatWindow.dataset.chatId = chatId;
  const messagesCol = collection(db, "chats", chatId, "messages");

  // Variables para grabación de audio
    let mediaRecorder = null;
  let audioChunks = [];
  let isMicPointerDown = false;


  // Crear botón micrófono pequeño a la izquierda del input en el formulario de chat
  const micButton = document.createElement("button");
  micButton.type = "button";
  micButton.title = "Mantén presionado para grabar nota de voz";
  micButton.style.fontSize = "18px";
  micButton.style.padding = "6px 8px";
  micButton.style.marginRight = "6px";
  micButton.style.flexShrink = "0";
  micButton.style.borderRadius = "50%";
  micButton.style.border = "1px solid #2176FF";
  micButton.style.background = "white";
  micButton.style.color = "#2176FF";
  micButton.style.cursor = "pointer";
  micButton.style.userSelect = "none";
  micButton.style.display = "flex";
  micButton.style.alignItems = "center";
  micButton.style.justifyContent = "center";
  micButton.style.height = "38px";
  micButton.style.width = "38px";
  micButton.style.lineHeight = "0";
  micButton.innerHTML = "&#127908;"; // mic emoji

  // Eliminar micButton anterior si existe para evitar duplicados
  const oldMic = elements.chatForm.querySelector(
    "button[title='Mantén presionado para grabar nota de voz']"
  );
  if (oldMic) {
    oldMic.remove();
  }

  // Insertar botón micro a la izquierda del #chatInput
  elements.chatForm.insertBefore(micButton, elements.chatInput);

  // Cambiar el estilo del chatInput para que tenga algo de flex-grow ajustado
  elements.chatInput.style.flexGrow = "1";

  // Función para solicitar permiso micrófono
    async function requestMicPermission() {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      alert("Permiso para el micrófono denegado o no disponible.");
      return null;
    }
  }


  // Cambiar estado visual de botón micrófono
  function updateMicButtonRecording(isRecording) {
    if (isRecording) {
      micButton.style.background = "#e63946";
      micButton.style.color = "white";
    } else {
      micButton.style.background = "white";
      micButton.style.color = "#2176FF";
    }
  }

  // Subir audio blob a Cloudinary (usamos el endpoint video para soportar audio webm)
  async function uploadAudioToCloudinary(blob) {
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`;
    const formData = new FormData();
    formData.append("file", blob);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

    const response = await fetch(url, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || "Error subiendo nota de voz a Cloudinary.");
    }
    return data.secure_url;
  }

  // Evento pointerdown para empezar grabación manteniendo pulsado
    micButton.addEventListener("pointerdown", async (ev) => {
    ev.preventDefault();
    isMicPointerDown = true;
        if (!currentUser || !chatWithUser) {
      isMicPointerDown = false;
      alert("Debes iniciar sesión y seleccionar un chat.");
      return;
    }
    if (mediaRecorder && mediaRecorder.state === "recording") {
      isMicPointerDown = false;
      alert("Por favor, suelta el botón del micrófono primero.");
      return;
    }
    const stream = await requestMicPermission();
    if (!stream) {
      isMicPointerDown = false;
      return;
    }
    if (!isMicPointerDown) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    try {
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
      };

            mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
        audioChunks = [];
        stream.getTracks().forEach((track) => track.stop());
        try {
          const audioUrl = await uploadAudioToCloudinary(audioBlob);
          const chatId = [currentUser.uid, chatWithUser].sort().join("_");
          const messagesCol = collection(db, "chats", chatId, "messages");

          await addDoc(messagesCol, {
            sender: currentUser.uid,
            receiver: chatWithUser,
            message: "",
            image: null,
            audio: audioUrl,
            timestamp: serverTimestamp(),
            read: false,
            readTimestamp: null,
          });
        } catch (err) {
          alert("Error enviando nota de voz: " + err.message);
        }
      };

      mediaRecorder.start();
      updateMicButtonRecording(true);
        } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      isMicPointerDown = false;
      alert("No se pudo iniciar la grabación: " + error.message);
    }
  });

  // Evento pointerup para detener grabación y enviar nota de voz
    micButton.addEventListener("pointerup", (ev) => {
    ev.preventDefault();
    isMicPointerDown = false;
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      updateMicButtonRecording(false);
    }
  });

  // Cancelar grabación si puntero sale del botón
    micButton.addEventListener("pointercancel", (ev) => {
    ev.preventDefault();
    isMicPointerDown = false;
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      updateMicButtonRecording(false);
    }
  });

    micButton.addEventListener("pointerleave", (ev) => {
    if (ev.buttons === 1) isMicPointerDown = false;
    if (ev.buttons === 1 && mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      updateMicButtonRecording(false);
    }
  });

  unsubscribeMessages = onSnapshot(
    query(messagesCol, orderBy("timestamp", "asc")),
    (snapshot) => {
      elements.chatMessages.innerHTML = "";
      snapshot.forEach((docSnap) => {
        const msg = docSnap.data();
        const messageId = docSnap.id;

        const msgDiv = document.createElement("div");
        msgDiv.className = "message " + (msg.sender === currentUser.uid ? "sent" : "received");
        msgDiv.dataset.messageId = messageId;

if (msg.audio) {
  const audioContainer = document.createElement("div");
  audioContainer.className = "audio-player-container";

  const audioEl = document.createElement("audio");
  audioEl.controls = true;
  audioEl.src = msg.audio;
  audioEl.title = "Nota de voz";
    audioEl.className = "audio-player";
  audioEl.style.outline = "none";
  audioContainer.appendChild(audioEl);

  // Botón para reproducir/pausar
  const audioBtn = document.createElement('button');
  audioBtn.textContent = "▶️ Reproducir nota de voz";
  audioBtn.style.marginTop = "6px";

  audioBtn.onclick = () => {
    if (audioEl.paused) {
      audioEl.play();
      audioBtn.textContent = "⏸ Pausar nota de voz";
    } else {
      audioEl.pause();
      audioBtn.textContent = "▶️ Reproducir nota de voz";
    }
  };

  audioEl.onended = () => {
    audioBtn.textContent = "▶️ Reproducir nota de voz";
  };

    audioContainer.appendChild(audioBtn);
  msgDiv.appendChild(audioContainer);
}

        // Estilos mejorados al mensaje
        msgDiv.style.padding = "10px 14px";
        msgDiv.style.borderRadius = "20px";
        msgDiv.style.marginBottom = "8px";
        msgDiv.style.maxWidth = "85%";
        msgDiv.style.wordWrap = "break-word";
        msgDiv.style.fontSize = "15px";
        msgDiv.style.lineHeight = "1.3";
        msgDiv.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
        msgDiv.style.position = "relative";
        msgDiv.style.transition = "background-color 0.3s ease";

        // Diferenciar colores y sombras en modo claro y oscuro
        if (msg.sender === currentUser.uid) {
          msgDiv.style.backgroundColor = "#007aff"; // azul claro
          msgDiv.style.color = "white";
          msgDiv.style.marginLeft = "auto";
          msgDiv.style.borderBottomRightRadius = "4px";
          msgDiv.style.boxShadow = "0 2px 10px rgba(0,122,255,0.6)";
        } else {
          msgDiv.style.backgroundColor = "#f1f0f0"; // gris muy claro
          msgDiv.style.color = "#222";
          msgDiv.style.marginRight = "auto";
          msgDiv.style.borderBottomLeftRadius = "4px";
          msgDiv.style.boxShadow = "0 2px 10px rgba(0,0,0,0.1)";
        }

        // Imagen dentro del mensaje
        if (msg.image) {
          const img = document.createElement("img");
          img.src = msg.image;
          img.alt = "Imagen enviada";
          img.title = "Ver imagen (clic para descargar)";
          img.loading = "lazy";

          img.style.maxWidth = "60%";
          img.style.borderRadius = "12px";
          img.style.cursor = "pointer";
          img.style.marginTop = "6px";
          img.style.boxShadow = "0 4px 8px rgba(0,0,0,0.1)";

          img.onclick = () => window.open(msg.image, "_blank", "noopener,noreferrer");
          msgDiv.appendChild(img);
        }

        // Texto si existe
        if (msg.message) {
          const msgText = document.createElement("div");
          msgText.textContent = msg.message;
          msgText.style.marginTop = msg.audio || msg.image ? "6px" : "0";
          msgDiv.appendChild(msgText);
        }

        // Mostrar leído y fecha solo para mensajes enviados
                if (msg.sender === currentUser.uid && msg.read && !chatReadReceiptsDisabled) {
          msgDiv.classList.add("read");
          const readTime = document.createElement("div");
          readTime.className = "read-timestamp";
          readTime.textContent = `Leído: ${formatReadTimestamp(msg.readTimestamp || msg.timestamp)}`;
          readTime.style.fontSize = "11px";
          readTime.style.opacity = "0.6";
          readTime.style.marginTop = "4px";
          readTime.style.textAlign = "right";
          readTime.style.userSelect = "none";
          msgDiv.appendChild(readTime);
        }

        // Pulsación larga para eliminar mensaje enviado
        if (msg.sender === currentUser.uid) {
          let pressTimer = null;
          msgDiv.addEventListener("pointerdown", () => {
            pressTimer = setTimeout(() => {
              const shouldDelete = confirm("¿Eliminar este mensaje?");
              if (shouldDelete) {
                const chatId = [currentUser.uid, chatWithUser].sort().join("_");
                deleteDoc(doc(db, "chats", chatId, "messages", messageId)).catch(() => {
                  alert("No se pudo eliminar el mensaje.");
                });
              }
            }, 700);
          });
          msgDiv.addEventListener("pointerup", () => {
            if (pressTimer) {
              clearTimeout(pressTimer);
              pressTimer = null;
            }
          });
          msgDiv.addEventListener("pointerleave", () => {
            if (pressTimer) {
              clearTimeout(pressTimer);
              pressTimer = null;
            }
          });
        }

        // Pulsación larga para mostrar hora envío en mensajes recibidos
        if (msg.sender !== currentUser.uid) {
          let pressTimer = null;
          let tooltipDiv = null;

          function showTimestamp() {
            if (tooltipDiv) return;
            tooltipDiv = document.createElement("div");
            tooltipDiv.textContent = `Enviado: ${formatReadTimestamp(msg.timestamp)}`;
            tooltipDiv.style.position = "absolute";
            tooltipDiv.style.backgroundColor = "rgba(0,0,0,0.75)";
            tooltipDiv.style.color = "white";
            tooltipDiv.style.padding = "4px 8px";
            tooltipDiv.style.borderRadius = "6px";
            tooltipDiv.style.fontSize = "12px";
            tooltipDiv.style.top = "-28px";
            tooltipDiv.style.right = "0";
            tooltipDiv.style.whiteSpace = "nowrap";
            tooltipDiv.style.zIndex = "1000";
            msgDiv.style.position = "relative";
            msgDiv.appendChild(tooltipDiv);
          }

          function hideTimestamp() {
            if (tooltipDiv) {
              tooltipDiv.remove();
              tooltipDiv = null;
            }
          }

          msgDiv.addEventListener("pointerdown", () => {
            pressTimer = setTimeout(() => {
              showTimestamp();
            }, 700);
          });

          msgDiv.addEventListener("pointerup", () => {
            clearTimeout(pressTimer);
            pressTimer = null;
            hideTimestamp();
          });

          msgDiv.addEventListener("pointerleave", () => {
            clearTimeout(pressTimer);
            pressTimer = null;
            hideTimestamp();
          });
        }

        elements.chatMessages.appendChild(msgDiv);
      });
      elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    }
  );

    // Marca mensajes leídos solo si esta persona no desactivó sus confirmaciones.
  if (!chatReadReceiptsDisabled) {
    await markMessagesAsRead(chatId, friendId);
  }
}

if (elements.closeChatBtn) {
  elements.closeChatBtn.onclick = () => {
    clearChatMessages();
    chatWithUser = null;
    activateTab(previousTab || "home");
  };
}


// Manejo selección imagen en chat con previsualización miniatura
elements.chatImageInput.onchange = () => {
  const file = elements.chatImageInput.files[0];
  if (!file) {
    chatImageData = null;
    elements.chatImagePreview.style.display = "none";
    elements.chatImagePreview.src = "";
    elements.chatImageClearBtn.style.display = "none";
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    elements.chatImagePreview.src = e.target.result;
    elements.chatImagePreview.style.display = "block";
    elements.chatImageClearBtn.style.display = "inline-block";
    elements.chatImagePreview.style.maxWidth = "80%";
    elements.chatImagePreview.style.maxHeight = "200px";
    elements.chatImagePreview.style.borderRadius = "12px";
    elements.chatImagePreview.style.objectFit = "contain";
    chatImageData = file;
  };
  reader.readAsDataURL(file);
};

// Botón para eliminar imagen seleccionada
elements.chatImageClearBtn.onclick = () => {
  chatImageData = null;
  elements.chatImagePreview.style.display = "none";
  elements.chatImagePreview.src = "";
  elements.chatImageClearBtn.style.display = "none";
  elements.chatImageInput.value = "";
};

// Envío mensaje con o sin imagen
async function uploadImageToCloudinary(file) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || 'Error subiendo imagen a Cloudinary.');
  }
  return data.secure_url; // URL de la imagen subida
}

elements.chatForm.onsubmit = async (e) => {
  e.preventDefault();
  if (!currentUser || !chatWithUser) return;
  const text = elements.chatInput.value.trim();
  if (!text && !chatImageData) return;

  try {
    let imageUrl = null;
    if (chatImageData) {
      imageUrl = await uploadImageToCloudinary(chatImageData);
    }

    const chatId = [currentUser.uid, chatWithUser].sort().join("_");
    const messagesCol = collection(db, "chats", chatId, "messages");

    await addDoc(messagesCol, {
      sender: currentUser.uid,
      receiver: chatWithUser,
      message: text || "",
      image: imageUrl || null,
      timestamp: serverTimestamp(),
      read: false,
      readTimestamp: null,
    });

    elements.chatInput.value = "";
    chatImageData = null;
    elements.chatImagePreview.style.display = "none";
    elements.chatImagePreview.src = "";
    elements.chatImageClearBtn.style.display = "none";
    elements.chatImageInput.value = "";
  } catch (e) {
    alert("Error enviando mensaje: " + e.message);
  }
};

// Marca mensajes como leídos
async function markMessagesAsRead(chatId, senderId) {
  const settingsSnap = await getDoc(doc(db, "chatSettings", chatId));
  const settings = settingsSnap.exists() ? settingsSnap.data() : {};
  if (settings.readReceiptsDisabledFor === currentUser?.uid) return;
  const messagesCol = collection(db, "chats", chatId, "messages");
  const unreadQ = query(messagesCol, where("sender", "==", senderId), where("read", "==", false));
  const unreadSnap = await getDocs(unreadQ);
  unreadSnap.forEach((docSnap) => {
    updateDoc(docSnap.ref, { read: true, readTimestamp: serverTimestamp() }).catch(() => {});
  });
}

const officialLogoUrl = "https://uploads.onecompiler.io/448k9pkeq/448kbzjkm/CONECTA%20-%20Nuevo%20logo.png";
const officialLogo = document.getElementById("logoConecta");

if (officialLogo) {
  officialLogo.addEventListener("click", () => {
    if (officialLogo.src === officialLogoUrl) {
      location.reload();
    }
  });
}

export {
  app,
  auth,
  db,
  storage,
  getDoc,
  doc,
  collection,
  addDoc,
  uploadBytes,
  ref,
  getDownloadURL,
  serverTimestamp,
};

window.currentUser = null; // También actualiza global

// Actualiza currentUser globalmente en onAuthStateChanged
onAuthStateChanged(auth, (user) => {
  window.currentUser = user;
  // tu código adicional...
});



function updateLogoBadge() {
  const badge = document.getElementById("logoBadge");
  if (!badge) return;
  badge.style.display = "none";
}

document.getElementById("closeProfileBtn").addEventListener("click", () => {
  document.getElementById("profileSection").classList.add("hidden");
  // Opcional: activar otra pestaña, por ejemplo "home"
  if (window.activateTab) {
    window.activateTab("home");
  }
});


// Elementos de navegación y secciones
const navButtons = {
  home: document.getElementById("btnHome"),
  notifications: document.getElementById("btnNotifications"),
  users: document.getElementById("btnUsers"),
  profile: document.getElementById("btnProfile"),
  messages: document.getElementById("btnMessages"),
};
const sectionOrder = ["home", "users", "profile", "notifications", "messages"];

let currentIndex = 0; // pestaña activa actual

// Función para activar una pestaña por índice
function activateTabByIndex(idx) {
  if (idx < 0 || idx >= sectionOrder.length) return;
  currentIndex = idx;
  // Activar botón y desactivar otros
  Object.values(navButtons).forEach((btn) => btn.classList.remove("active"));
  const key = sectionOrder[currentIndex];
  if (navButtons[key]) navButtons[key].classList.add("active");
  // Aquí puedes llamar la función para mostrar la sección activa
  if (window.activateTab) window.activateTab(key);
}

// Detectar scroll horizontal en el contenedor principal
const scrollContainer = document.getElementById("mainSectionsContainer");
let scrollTimeout = null;

if (scrollContainer) {
  scrollContainer.addEventListener("wheel", (event) => {
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      event.preventDefault();
      if (scrollTimeout) return; // evitar múltiples cambios rápidos

      if (event.deltaX > 0) {
        // Scroll hacia la derecha: avanzar pestaña
        if (currentIndex < sectionOrder.length - 1) {
          activateTabByIndex(currentIndex + 1);
        }
      } else if (event.deltaX < 0) {
        // Scroll hacia la izquierda: retroceder pestaña
        if (currentIndex > 0) {
          activateTabByIndex(currentIndex - 1);
        }
      }

      // Bloquea cambios rápidos por 300ms
      scrollTimeout = setTimeout(() => {
        scrollTimeout = null;
      }, 300);
    }
  });
}

// Inicializa en home
activateTabByIndex(0);

// Función para detectar estado de conexión
function updateOnlineStatus() {
  // Keep connectivity updates non-blocking; alerts here interrupted login and navigation.
  document.documentElement.dataset.network = navigator.onLine ? "online" : "offline";
}


// Eventos para monitorizar cambios en conexión
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// Ejecuta al cargar la app
updateOnlineStatus();





import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";

const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");

forgotPasswordBtn.addEventListener("click", () => {
  const email = prompt("Por favor, ingresa tu correo electrónico para restablecer la contraseña:");
  if (email && email.trim() !== "") {
    sendPasswordResetEmail(auth, email.trim())
      .then(() => {
        alert("Se ha enviado un correo para restablecer tu contraseña.");
      })
      .catch((error) => {
        alert("Error: " + (error.message || "No se pudo enviar el correo."));
      });
  }
});



