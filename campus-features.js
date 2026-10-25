import { getApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, getFirestore, increment, limit, onSnapshot, orderBy, query,
  runTransaction, serverTimestamp, setDoc, updateDoc,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const auth = getAuth(getApp());
const db = getFirestore(getApp());
const $ = (id) => document.getElementById(id);
const panel = $("campusFeatures");
const openButton = $("btnCampusFeatures");
const currentUser = () => auth.currentUser;
let activeUser = null;
let unsubscribeTyping = null;
let typingWriteTimer = null;
let typingStopTimer = null;
let typingChatId = "";
const reminderTimers = new Map();
let reminderAudioContext = null;
let storyExpiryTimer = null;

function playReminderSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    reminderAudioContext ||= new AudioContextClass();
    const context = reminderAudioContext;
    if (context.state === "suspended") context.resume();
    [660, 880, 660].forEach((frequency, index) => {
      const startAt = context.currentTime + index * 0.22;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.18);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.19);
    });
  } catch (error) {
    console.warn("No se pudo reproducir el sonido del recordatorio:", error);
  }
}

let unsubscribeStoryFeed = null;

function escapeText(value) { return String(value || "").trim(); }
function displayName(data) { return data.profile?.name?.trim() || data.username || "Estudiante"; }
function showPanel() {
  if (!activeUser) return;
  $("settingsModal")?.classList.add("hidden");
  $("settingsDetailModal")?.classList.add("hidden");
  window.activateTab?.("home");
  panel.classList.remove("hidden");
  ["homeSection", "postSection", "usersSection", "profileSection", "notificationsSection", "messagesSection", "userInfoSection"].forEach((id) => $(id)?.classList.add("hidden"));
  refreshCampusLists();
  renderBlockedUsers();
}
function closePanel() {
  panel.classList.add("hidden");
  if (activeUser) {
    $("homeSection")?.classList.remove("hidden");
    $("postSection")?.classList.remove("hidden");
    window.activateTab?.("home");
  }
  if (storyExpiryTimer) clearTimeout(storyExpiryTimer);
}
openButton?.addEventListener("click", showPanel);
$("closeCampusFeatures")?.addEventListener("click", closePanel);

onAuthStateChanged(auth, (user) => {
  activeUser = user;
  if (openButton) openButton.classList.toggle("hidden", !user);
  if (!user) {
    closePanel();
    closeGroupChat();
    if (unsubscribeTyping) unsubscribeTyping();
    unsubscribeTyping = null;
    if (unsubscribeStoryFeed) unsubscribeStoryFeed();
    unsubscribeStoryFeed = null;
    storyCountSubscriptions.forEach((unsubscribe) => unsubscribe());
    storyCountSubscriptions.clear();
    if (storyViewerIndex >= 0) closeStoryViewer();
    return;
  }
  watchStories();
  loadStories();
  if (!panel.classList.contains("hidden")) {
    refreshCampusLists();
    renderBlockedUsers();
  }
});

// Las historias activas se muestran en el inicio y expiran a las 24 horas.
let activeStories = [];
let storyViewerIndex = -1;
let storyAdvanceTimer = null;
let unsubscribeStoryViews = null;
let unsubscribeStoryViewer = null;
const storyCountSubscriptions = new Map();

async function loadStories() {
  const tray = $("storiesTray");
  const list = $("storiesList");
  if (!activeUser || (!tray && !list)) return;
  try {
    const snap = await getDocs(query(collection(db, "stories"), orderBy("createdAt", "desc"), limit(60)));
    const now = Date.now();
    activeStories = snap.docs.map((item) => ({ id: item.id, ...item.data() }))
      .filter((story) => story.expiresAt?.toMillis?.() > now);
    if (storyExpiryTimer) clearTimeout(storyExpiryTimer);
    const nextExpiry = activeStories.reduce((soonest, story) => Math.min(soonest, story.expiresAt.toMillis()), Infinity);
    if (Number.isFinite(nextExpiry)) storyExpiryTimer = setTimeout(loadStories, Math.min(2147483647, Math.max(50, nextExpiry - now + 50)));
    storyCountSubscriptions.forEach((unsubscribe) => unsubscribe());
    storyCountSubscriptions.clear();
    if (tray) {
      tray.replaceChildren();
      if (!activeStories.length) appendEmpty(tray, "Aún no hay historias activas.");
      activeStories.forEach((story, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "story-thumbnail";
        button.setAttribute("role", "listitem");
        button.setAttribute("aria-label", `Ver historia de ${story.authorName || "Estudiante"}`);
        if (story.mediaType === "image" && story.mediaUrl) {
          const image = document.createElement("img");
          image.src = story.mediaUrl;
          image.alt = "";
          image.loading = "lazy";
          button.appendChild(image);
        } else if (story.mediaType === "video" && story.mediaUrl) {
          const video = document.createElement("video");
          video.src = story.mediaUrl;
          video.muted = true;
          video.playsInline = true;
          video.preload = "metadata";
          button.appendChild(video);
          const videoMark = document.createElement("span");
          videoMark.className = "story-video-mark";
          videoMark.textContent = "▶";
          button.appendChild(videoMark);
        } else {
          const textPreview = document.createElement("span");
          textPreview.className = "story-text-preview";
          textPreview.textContent = story.text || "Historia";
          button.appendChild(textPreview);
        }
        const author = document.createElement("span");
        author.className = "story-thumbnail-author";
        author.textContent = story.authorName || "Estudiante";
        button.appendChild(author);
        let views = null;
        if (story.authorId === activeUser.uid) {
          views = document.createElement("small");
          views.className = "story-thumbnail-views";
          views.textContent = `◉ ${Number(story.viewCount || 0)}`;
          button.appendChild(views);
        }
        button.addEventListener("click", () => openStory(index));
        tray.appendChild(button);
        if (story.authorId === activeUser.uid) {
          const unsubscribe = onSnapshot(doc(db, "stories", story.id), (fresh) => {
            if (!fresh.exists()) return;
            const latest = Number(fresh.data().viewCount || 0);
            views.textContent = `◉ ${latest}`;
            const active = activeStories.find((item) => item.id === story.id);
            if (active) active.viewCount = latest;
          }, () => {});
          storyCountSubscriptions.set(story.id, unsubscribe);
        }
      });
    }
    if (list) {
      list.replaceChildren();
      if (!activeStories.length) appendEmpty(list, "Aún no hay historias activas.");
      activeStories.forEach((story, index) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "campus-list-item campus-story-item";
        const name = document.createElement("strong");
        name.textContent = story.authorName || "Estudiante";
        const summary = document.createElement("span");
        summary.textContent = story.text || (story.mediaType === "video" ? "Video" : "Foto");
        const expires = document.createElement("small");
        expires.textContent = `Expira: ${new Date(story.expiresAt.toMillis()).toLocaleString()}`;
        card.append(name, summary, expires);
        card.addEventListener("click", () => openStory(index));
        list.appendChild(card);
      });
    }
  } catch (error) {
    if (tray) appendEmpty(tray, `No se pudieron cargar historias: ${error.message}`);
    if (list) appendEmpty(list, `No se pudieron cargar historias: ${error.message}`);
  }
}

function watchStories() {
  if (unsubscribeStoryFeed) unsubscribeStoryFeed();
  const storiesQuery = query(collection(db, "stories"), orderBy("createdAt", "desc"), limit(60));
  let firstSnapshot = true;
  let knownIds = new Set();
  unsubscribeStoryFeed = onSnapshot(storiesQuery, (snapshot) => {
    if (firstSnapshot) {
      firstSnapshot = false;
      knownIds = new Set(snapshot.docs.map((item) => item.id));
      return;
    }
    const nextIds = new Set(snapshot.docs.map((item) => item.id));
    const structureChanged = nextIds.size !== knownIds.size
      || [...nextIds].some((id) => !knownIds.has(id));
    knownIds = nextIds;
    if (structureChanged) loadStories();
  }, (error) => console.warn("No se pudieron observar historias en tiempo real:", error));
}

function closeStoryViewer() {
  clearTimeout(storyAdvanceTimer);
  storyViewerIndex = -1;
  const viewer = $("storyViewer");
  viewer?.classList.add("hidden");
  viewer?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("story-viewer-open");
  $("storyViewerMedia")?.replaceChildren();
  $("storyViewerViewers")?.classList.add("hidden");
  if (unsubscribeStoryViews) unsubscribeStoryViews();
  if (unsubscribeStoryViewer) unsubscribeStoryViewer();
  unsubscribeStoryViews = unsubscribeStoryViewer = null;
}

function showNextStory(step = 1) {
  const next = storyViewerIndex + step;
  if (next < 0) return renderStoryViewer(0);
  if (next >= activeStories.length) return closeStoryViewer();
  renderStoryViewer(next);
}

async function registerStoryView(story) {
  if (!activeUser || !story || story.authorId === activeUser.uid) return;
  try {
    const userSnap = await getDoc(doc(db, "users", activeUser.uid));
    const viewerName = userSnap.exists() ? displayName(userSnap.data()) : activeUser.displayName || "Estudiante";
    const storyRef = doc(db, "stories", story.id);
    const viewRef = doc(db, "stories", story.id, "views", activeUser.uid);
    await runTransaction(db, async (transaction) => {
      const [viewSnap, storySnap] = await Promise.all([transaction.get(viewRef), transaction.get(storyRef)]);
      if (!storySnap.exists() || viewSnap.exists()) return;
      transaction.set(viewRef, { userId: activeUser.uid, name: viewerName, viewedAt: serverTimestamp() });
      transaction.update(storyRef, { viewCount: increment(1) });
    });
  } catch (error) { console.warn("No se pudo registrar la reproducción de la historia", error); }
}

function renderStoryViewers(story) {
  const button = $("storyViewerViews");
  const panel = $("storyViewerViewers");
  if (!button || !panel) return;
  button.textContent = `◉ ${Number(story.viewCount || 0)} vistas`;
  button.classList.toggle("hidden", story.authorId !== activeUser?.uid);
  if (story.authorId !== activeUser?.uid) return;
  if (unsubscribeStoryViews) unsubscribeStoryViews();
  const viewsRef = query(collection(db, "stories", story.id, "views"), orderBy("viewedAt", "desc"), limit(100));
  unsubscribeStoryViews = onSnapshot(viewsRef, (snapshot) => {
    button.textContent = `◉ ${Number(story.viewCount || snapshot.size)} vistas`;
    if (panel.classList.contains("hidden")) return;
    panel.replaceChildren();
    if (snapshot.empty) return appendEmpty(panel, "Todavía no hay reproducciones.");
    snapshot.forEach((item) => {
      const row = document.createElement("div");
      row.className = "story-viewer-viewer-row";
      const timestamp = item.data().viewedAt?.toDate?.();
      row.textContent = `${item.data().name || "Estudiante"}${timestamp ? ` · ${timestamp.toLocaleString()}` : ""}`;
      panel.appendChild(row);
    });
  }, () => appendEmpty(panel, "No se pudo cargar la lista de reproducciones."));
}

function renderStoryViewer(index) {
  if (!activeStories.length) return closeStoryViewer();
  storyViewerIndex = Math.max(0, Math.min(index, activeStories.length - 1));
  const story = activeStories[storyViewerIndex];
  const viewer = $("storyViewer");
  const media = $("storyViewerMedia");
  if (!viewer || !media) return;
  clearTimeout(storyAdvanceTimer);
  if (unsubscribeStoryViews) unsubscribeStoryViews();
  if (unsubscribeStoryViewer) unsubscribeStoryViewer();
  viewer.classList.remove("hidden");
  viewer.setAttribute("aria-hidden", "false");
  document.body.classList.add("story-viewer-open");
  $("storyViewerAuthor").textContent = story.authorName || "Estudiante";
  $("storyViewerTime").textContent = story.createdAt?.toDate?.().toLocaleString?.() || "";
  $("storyViewerText").textContent = story.text || "";
  $("storyViewerDelete").classList.toggle("hidden", story.authorId !== activeUser?.uid);
  const progress = $("storyViewerProgress");
  progress.replaceChildren();
  activeStories.forEach((_, itemIndex) => {
    const segment = document.createElement("span");
    segment.className = `story-progress-segment${itemIndex < storyViewerIndex ? " is-complete" : itemIndex === storyViewerIndex ? " is-active" : ""}`;
    progress.appendChild(segment);
  });
  media.replaceChildren();
  if (story.mediaType === "video" && story.mediaUrl) {
    const video = document.createElement("video");
    video.src = story.mediaUrl;
    video.autoplay = true;
    video.controls = true;
    video.playsInline = true;
    video.muted = true;
    video.onended = () => showNextStory(1);
    video.onloadedmetadata = () => {
      video.play().catch(() => {});
      startStoryTimer(Math.min(30000, Math.max(1000, video.duration * 1000 || 30000)));
    };
    media.appendChild(video);
    if (video.readyState >= 1) {
      video.play().catch(() => {});
      startStoryTimer(Math.min(30000, Math.max(1000, video.duration * 1000 || 30000)));
    }
  } else {
    if (story.mediaType === "image" && story.mediaUrl) {
      const image = document.createElement("img");
      image.src = story.mediaUrl;
      image.alt = `Historia de ${story.authorName || "Estudiante"}`;
      media.appendChild(image);
    }
    startStoryTimer(30000);
  }
  renderStoryViewers(story);
  if (story.authorId !== activeUser?.uid) registerStoryView(story);
  unsubscribeStoryViewer = onSnapshot(doc(db, "stories", story.id), (snapshot) => {
    if (!snapshot.exists()) return closeStoryViewer();
    const latestCount = Number(snapshot.data().viewCount || 0);
    story.viewCount = latestCount;
    if (story.authorId === activeUser?.uid) $("storyViewerViews").textContent = `◉ ${latestCount} vistas`;
  }, () => {});
}

function startStoryTimer(duration) {
  clearTimeout(storyAdvanceTimer);
  const activeSegment = $("storyViewerProgress")?.children[storyViewerIndex];
  if (activeSegment) activeSegment.style.setProperty("--story-duration", `${duration}ms`);
  storyAdvanceTimer = setTimeout(() => showNextStory(1), duration);
}

function openStory(index) {
  document.body.classList.add("story-viewer-open");
  renderStoryViewer(index);
}

$("storyViewerClose")?.addEventListener("click", closeStoryViewer);
$("storyViewerPrev")?.addEventListener("click", () => showNextStory(-1));
$("storyViewerNext")?.addEventListener("click", () => showNextStory(1));
$("storyViewerViews")?.addEventListener("click", () => $("storyViewerViewers")?.classList.toggle("hidden"));
$("storyViewerDelete")?.addEventListener("click", async () => {
  const story = activeStories[storyViewerIndex];
  if (!story || story.authorId !== activeUser?.uid || !confirm("¿Eliminar esta historia para todos?")) return;
  try {
    await deleteDoc(doc(db, "stories", story.id));
    activeStories.splice(storyViewerIndex, 1);
    if (!activeStories.length) closeStoryViewer();
    else renderStoryViewer(Math.min(storyViewerIndex, activeStories.length - 1));
    await loadStories();
  } catch (error) { alert(`No se pudo eliminar la historia: ${error.message}`); }
});
$("storyViewer")?.addEventListener("click", (event) => {
  if (event.target === $("storyViewer")) closeStoryViewer();
});
document.addEventListener("keydown", (event) => {
  if (storyViewerIndex < 0) return;
  if (event.key === "Escape") closeStoryViewer();
  if (event.key === "ArrowRight") showNextStory(1);
  if (event.key === "ArrowLeft") showNextStory(-1);
});

const storyForm = $("storyForm");
const storyMediaInput = $("storyMediaInput");
const storyStatus = $("storyMediaStatus");
const publishStoryBtn = $("publishStoryBtn");
const maxStoryImageSize = 15 * 1024 * 1024;
const maxStoryVideoSize = 50 * 1024 * 1024;

function getVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = video.duration;
      URL.revokeObjectURL(url);
      if (Number.isFinite(duration)) resolve(duration);
      else reject(new Error("No se pudo verificar la duración del video."));
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer el video seleccionado."));
    };
    video.src = url;
  });
}

storyMediaInput?.addEventListener("change", async () => {
  const file = storyMediaInput.files?.[0];
  if (!file) {
    if (storyStatus) storyStatus.textContent = "Puedes publicar texto, una foto o un video de hasta 30 segundos.";
    return;
  }
  if (storyMediaInput.files.length !== 1 || (!file.type.startsWith("image/") && !file.type.startsWith("video/"))) {
    storyMediaInput.value = "";
    if (storyStatus) storyStatus.textContent = "Selecciona una foto o un solo video.";
    return;
  }
  const isVideo = file.type.startsWith("video/");
  if (file.size > (isVideo ? maxStoryVideoSize : maxStoryImageSize)) {
    storyMediaInput.value = "";
    if (storyStatus) storyStatus.textContent = isVideo ? "El video no puede superar 50 MB." : "La foto no puede superar 15 MB.";
    return;
  }
  if (isVideo) {
    try {
      const duration = await getVideoDuration(file);
      if (duration > 30) {
        storyMediaInput.value = "";
        if (storyStatus) storyStatus.textContent = "El video debe durar 30 segundos o menos.";
        return;
      }
    } catch (error) {
      storyMediaInput.value = "";
      if (storyStatus) storyStatus.textContent = error.message;
      return;
    }
  }
  if (storyStatus) storyStatus.textContent = `${isVideo ? "Video" : "Foto"} listo para publicar: ${file.name}`;
});

async function uploadStoryMedia(file) {
  const mediaType = file.type.startsWith("video/") ? "video" : "image";
  const endpoint = `https://api.cloudinary.com/v1_1/dv3g5otcv/${mediaType}/upload`;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", "a3trfid7");
  const response = await fetch(endpoint, { method: "POST", body: formData });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "No se pudo subir el medio de la historia.");
  if (!data.secure_url) throw new Error("El servicio no devolvió la URL del medio.");
  const uploadedDuration = Number(data.duration);
  if (mediaType === "video" && (!Number.isFinite(uploadedDuration) || uploadedDuration > 30)) {
    throw new Error("El video debe durar 30 segundos o menos.");
  }
  return { mediaUrl: data.secure_url, mediaType };
}

storyForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeUser) return alert("Debes iniciar sesión para publicar una historia.");
  const text = escapeText($("storyText").value);
  const file = storyMediaInput.files?.[0] || null;
  if (!text && !file) return alert("Escribe una historia o selecciona una foto o un video.");
  if (file?.type.startsWith("video/")) {
    try {
      if (await getVideoDuration(file) > 30) {
        storyMediaInput.value = "";
        if (storyStatus) storyStatus.textContent = "El video debe durar 30 segundos o menos.";
        return;
      }
    } catch (error) {
      storyMediaInput.value = "";
      if (storyStatus) storyStatus.textContent = error.message;
      return;
    }
  }

  publishStoryBtn.disabled = true;
  publishStoryBtn.textContent = "Publicando…";
  try {
    const userSnap = await getDoc(doc(db, "users", activeUser.uid));
    const data = userSnap.exists() ? userSnap.data() : {};
    const uploadedMedia = file ? await uploadStoryMedia(file) : {};
    const created = Date.now();
    await addDoc(collection(db, "stories"), {
      authorId: activeUser.uid,
      authorName: displayName(data),
      text,
      ...uploadedMedia,
      createdAt: serverTimestamp(),
      expiresAt: new Date(created + 24 * 60 * 60 * 1000),
    });
    storyForm.reset();
    if (storyStatus) storyStatus.textContent = "Puedes publicar texto, una foto o un video de hasta 30 segundos.";
    await loadStories();
    alert("Historia publicada. Estará disponible durante 24 horas.");
  } catch (error) {
    alert(`No se pudo publicar la historia: ${error.message}`);
  } finally {
    publishStoryBtn.disabled = false;
    publishStoryBtn.textContent = "Publicar historia";
  }
});

// Grupos y chat colectivo en subcolección propia para cada grupo.
let unsubscribeGroupMessages = null;
let activeGroupChatId = "";
let groupUsersCache = null;
const groupConversationEntries = new Map();
const conversationListObserver = $("usersInMessages") ? new MutationObserver(() => {
  const list = $("usersInMessages");
  if (!list) return;
  for (const [groupId, entry] of groupConversationEntries) {
    if (![...list.children].includes(entry)) list.appendChild(entry);
  }
}) : null;
conversationListObserver?.observe($("usersInMessages"), { childList: true });
function groupColor(uid) {
  let hash = 0;
  for (const character of String(uid || "")) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 72% 42%)`;
}

async function getGroupUsers() {
  if (groupUsersCache) return groupUsersCache;
  const snap = await getDocs(collection(db, "users"));
  groupUsersCache = snap.docs.map((item) => ({
    uid: item.id,
    name: displayName(item.data()),
    username: item.data().username || "",
  }));
  return groupUsersCache;
}

function stopGroupChat() {
  if (unsubscribeGroupMessages) unsubscribeGroupMessages();
  unsubscribeGroupMessages = null;
  activeGroupChatId = "";
}

function closeGroupChat() {
  stopGroupChat();
  if (activeGroupChatPanel && activeGroupChatOrigin) {
    activeGroupChatOrigin.appendChild(activeGroupChatPanel);
    activeGroupChatPanel.classList.add("hidden");
  }
  activeGroupChatPanel = null;
  activeGroupChatOrigin = null;
  $("messagesSection")?.classList.remove("group-chat-open");
}

let activeGroupChatPanel = null;
let activeGroupChatOrigin = null;

function openGroupChat(groupId, groupName, container) {
  closeGroupChat();
  const chat = container.querySelector(".group-chat-panel");
  if (!chat) return;
  activeGroupChatPanel = chat;
  activeGroupChatOrigin = container;
  chat.classList.remove("hidden");
  $("messagesSection")?.appendChild(chat);
  $("messagesSection")?.classList.add("group-chat-open");
  activeGroupChatId = groupId;
  const messages = chat.querySelector(".group-chat-messages");
  const chatTitle = chat.querySelector(".group-chat-title");
  chatTitle.textContent = groupName;
  unsubscribeGroupMessages = onSnapshot(
    query(collection(db, "campusGroups", groupId, "messages"), orderBy("createdAt", "asc"), limit(150)),
    (snapshot) => {
      if (activeGroupChatId !== groupId) return;
      messages.replaceChildren();
      if (snapshot.empty) appendEmpty(messages, "Aún no hay mensajes en este grupo.");
      snapshot.forEach((item) => {
        const data = item.data();
        const row = document.createElement("article");
        row.className = `group-chat-message${data.authorId === activeUser?.uid ? " is-own" : ""}`;
        const author = document.createElement("small");
        author.className = "group-chat-author";
        author.textContent = data.authorName || "Estudiante";
        author.style.color = groupColor(data.authorId);
        const body = document.createElement("div");
        body.className = "group-chat-message-text";
        body.textContent = data.text || "";
        row.append(author, body);
        messages.appendChild(row);
      });
      messages.scrollTop = messages.scrollHeight;
    },
    (error) => appendEmpty(messages, `No se pudo cargar el chat: ${error.message}`),
  );
  chat.querySelector(".group-chat-form").onsubmit = async (event) => {
    event.preventDefault();
    const input = chat.querySelector(".group-chat-input");
    const text = escapeText(input.value);
    if (!text || !activeUser || activeGroupChatId !== groupId) return;
    const send = chat.querySelector("button[type='submit']");
    send.disabled = true;
    try {
      const groupSnap = await getDoc(doc(db, "campusGroups", groupId));
      if (!groupSnap.exists() || !(groupSnap.data().memberIds || []).includes(activeUser.uid)) {
        throw new Error("Ya no perteneces a este grupo.");
      }
      const userSnap = await getDoc(doc(db, "users", activeUser.uid));
      await addDoc(collection(db, "campusGroups", groupId, "messages"), {
        authorId: activeUser.uid,
        authorName: userSnap.exists() ? displayName(userSnap.data()) : activeUser.displayName || "Estudiante",
        text,
        createdAt: serverTimestamp(),
      });
      input.value = "";
    } catch (error) { alert(`No se pudo enviar el mensaje: ${error.message}`); }
    finally { send.disabled = false; }
  };
  chat.querySelector(".group-chat-input").focus();
}

async function loadGroups() {
  const list = $("groupsList");
  if (!activeUser || !list) return;
  closeGroupChat();
  list.replaceChildren();
  const conversationList = $("usersInMessages");
  groupConversationEntries.clear();
  conversationList?.querySelectorAll(".group-conversation-item").forEach((entry) => entry.remove());
  try {
    const snap = await getDocs(query(collection(db, "campusGroups"), orderBy("createdAt", "desc"), limit(50)));
    if (snap.empty) return appendEmpty(list, "Aún no hay grupos.");
    for (const item of snap.docs) {
      const group = item.data();
      const members = group.memberIds || [];
      const isMember = members.includes(activeUser.uid);
      const isCreator = group.createdBy === activeUser.uid;
      if (isMember && conversationList) {
        const groupEntry = document.createElement("button");
        groupEntry.type = "button";
        groupEntry.className = "group-conversation-item";
        groupEntry.dataset.groupId = item.id;
        const groupEntryName = document.createElement("strong");
        groupEntryName.textContent = group.name || "Grupo";
        const groupEntryMeta = document.createElement("small");
        groupEntryMeta.textContent = `Chat grupal · ${members.length} integrantes`;
        groupEntry.append(groupEntryName, groupEntryMeta);
        groupEntry.onclick = () => openGroupChat(item.id, group.name || "Grupo", card);
        groupConversationEntries.set(item.id, groupEntry);
        conversationList.appendChild(groupEntry);
      }
      const card = document.createElement("article");
      card.className = "campus-list-item messages-group-card";
      const heading = document.createElement("div");
      heading.className = "messages-group-heading";
      const title = document.createElement("strong");
      title.textContent = group.name || "Grupo";
      const menuButton = document.createElement("button");
      menuButton.type = "button";
      menuButton.className = "group-menu-toggle";
      menuButton.textContent = "°°°";
      menuButton.setAttribute("aria-label", `Opciones de ${group.name || "grupo"}`);
      heading.append(title, menuButton);
      const category = document.createElement("p");
      category.textContent = `${group.type === "semester" ? "Semestre" : "Carrera"}: ${group.category || "—"} · ${members.length} integrantes`;
      const controls = document.createElement("div");
      controls.className = "messages-group-actions";
      const join = document.createElement("button");
      join.type = "button";
      join.textContent = isCreator ? "Grupo creado por ti" : isMember ? "Abandonar grupo" : "Unirme";
      join.disabled = isCreator;
      join.onclick = async () => {
        join.disabled = true;
        try {
          await runTransaction(db, async (transaction) => {
            const ref = doc(db, "campusGroups", item.id);
            const fresh = await transaction.get(ref);
            if (!fresh.exists()) throw new Error("El grupo ya no existe.");
            const latest = new Set(fresh.data().memberIds || []);
            if (latest.has(activeUser.uid)) {
              if (fresh.data().createdBy === activeUser.uid) throw new Error("La persona creadora no puede abandonar el grupo; elimínalo si ya no se usará.");
              latest.delete(activeUser.uid);
            } else latest.add(activeUser.uid);
            transaction.update(ref, { memberIds: [...latest] });
          });
          loadGroups();
        } catch (error) { alert(`No se pudo actualizar el grupo: ${error.message}`); }
        finally { join.disabled = false; }
      };
      controls.appendChild(join);
      const chatButton = document.createElement("button");
      chatButton.type = "button";
      chatButton.textContent = "Abrir chat";
      chatButton.disabled = !isMember;
      chatButton.onclick = () => openGroupChat(item.id, group.name || "Grupo", card);
      controls.appendChild(chatButton);

      const menu = document.createElement("div");
      menu.className = "group-management-menu hidden";
      const memberSearch = document.createElement("input");
      memberSearch.type = "search";
      memberSearch.placeholder = "Buscar persona por nombre";
      memberSearch.setAttribute("aria-label", "Buscar miembro por nombre");
      const suggestions = document.createElement("div");
      suggestions.className = "group-member-suggestions";
      const addMember = document.createElement("button");
      addMember.type = "button";
      addMember.textContent = "Añadir miembro";
      addMember.disabled = true;
      let selectedMember = null;
      memberSearch.oninput = async () => {
        selectedMember = null;
        addMember.disabled = true;
        suggestions.replaceChildren();
        const term = memberSearch.value.trim().toLocaleLowerCase();
        if (term.length < 2) return;
        try {
          const users = await getGroupUsers();
          users.filter((person) => person.uid !== activeUser.uid && !members.includes(person.uid)
            && `${person.name} ${person.username}`.toLocaleLowerCase().includes(term))
            .slice(0, 6).forEach((person) => {
              const option = document.createElement("button");
              option.type = "button";
              option.textContent = person.name + (person.username ? ` · @${person.username}` : "");
              option.onclick = () => {
                selectedMember = person;
                memberSearch.value = person.name;
                addMember.disabled = false;
                suggestions.replaceChildren();
              };
              suggestions.appendChild(option);
            });
          if (!suggestions.childElementCount) appendEmpty(suggestions, "No se encontraron personas.");
        } catch (error) { appendEmpty(suggestions, `No se pudieron buscar usuarios: ${error.message}`); }
      };
      addMember.onclick = async () => {
        if (!selectedMember) return;
        addMember.disabled = true;
        try {
          await runTransaction(db, async (transaction) => {
            const ref = doc(db, "campusGroups", item.id);
            const fresh = await transaction.get(ref);
            if (!fresh.exists()) throw new Error("El grupo ya no existe.");
            if (fresh.data().createdBy !== activeUser.uid) throw new Error("Solo la persona creadora puede añadir miembros.");
            const nextMembers = new Set(fresh.data().memberIds || []);
            nextMembers.add(selectedMember.uid);
            transaction.update(ref, { memberIds: [...nextMembers] });
          });
          loadGroups();
        } catch (error) { addMember.disabled = false; alert(`No se pudo añadir al miembro: ${error.message}`); }
      };
      menuButton.onclick = () => menu.classList.toggle("hidden");
      if (isCreator) {
        const renameInput = document.createElement("input");
        renameInput.type = "text";
        renameInput.maxLength = 60;
        renameInput.value = group.name || "";
        renameInput.placeholder = "Nombre del grupo";
        renameInput.setAttribute("aria-label", "Nombre del grupo");
        const renameGroup = document.createElement("button");
        renameGroup.type = "button";
        renameGroup.textContent = "Guardar nombre";
        renameGroup.onclick = async () => {
          const nextName = escapeText(renameInput.value);
          if (!nextName) return alert("Escribe un nombre para el grupo.");
          renameGroup.disabled = true;
          try {
            await updateDoc(doc(db, "campusGroups", item.id), { name: nextName });
            loadGroups();
          } catch (error) { alert(`No se pudo cambiar el nombre: ${error.message}`); }
          finally { renameGroup.disabled = false; }
        };
        menu.append(renameInput, renameGroup, memberSearch, suggestions, addMember);
        const removeGroup = document.createElement("button");
        removeGroup.type = "button";
        removeGroup.className = "danger-action";
        removeGroup.textContent = "Eliminar grupo";
        removeGroup.onclick = async () => {
          if (!confirm(`¿Eliminar el grupo “${group.name || "Grupo"}” para todos?`)) return;
          try {
            const messageSnap = await getDocs(collection(db, "campusGroups", item.id, "messages"));
            await Promise.all(messageSnap.docs.map((message) => deleteDoc(message.ref)));
            await deleteDoc(doc(db, "campusGroups", item.id));
            loadGroups();
          } catch (error) { alert(`No se pudo eliminar el grupo: ${error.message}`); }
        };
        menu.appendChild(removeGroup);
      } else if (isMember) {
        const leave = document.createElement("button");
        leave.type = "button";
        leave.textContent = "Abandonar grupo";
        leave.onclick = () => join.click();
        menu.appendChild(leave);
      }
      const chat = document.createElement("section");
      chat.className = "group-chat-panel hidden";
      chat.innerHTML = '<header class="group-chat-header"><button class="group-chat-back" type="button" aria-label="Volver a conversaciones">‹</button><strong class="group-chat-title"></strong></header><div class="group-chat-messages" aria-live="polite"></div><form class="group-chat-form"><input class="group-chat-input" maxlength="2000" autocomplete="off" placeholder="Escribe al grupo…" aria-label="Mensaje al grupo"><button type="submit">Enviar</button></form>';
      chat.querySelector(".group-chat-back").onclick = closeGroupChat;
      card.append(heading, category, controls, menu, chat);
      list.appendChild(card);
    }
  } catch (error) { appendEmpty(list, `No se pudieron cargar grupos: ${error.message}`); }
}
$("groupForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeUser) return;
  const name = escapeText($("groupName").value);
  const category = escapeText($("groupCategory").value);
  const type = $("groupType").value;
  if (!name || !category) return;
  try {
    await addDoc(collection(db, "campusGroups"), {
      name, category, type, createdBy: activeUser.uid, memberIds: [activeUser.uid], createdAt: serverTimestamp(),
    });
    event.target.reset();
    loadGroups();
  } catch (error) { alert(`No se pudo crear el grupo: ${error.message}`); }
});
$("btnMessages")?.addEventListener("click", loadGroups);

async function loadEvents() {
  const list = $("eventsList");
  if (!activeUser || !list) return;
  list.replaceChildren();
  try {
    const snap = await getDocs(query(collection(db, "campusEvents"), orderBy("startsAt", "asc"), limit(40)));
    const upcoming = snap.docs.map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => item.startsAt?.toMillis?.() > Date.now());
    if (!upcoming.length) return appendEmpty(list, "No hay próximos eventos.");
    upcoming.forEach((item) => {
      const card = document.createElement("article");
      card.className = "campus-list-item";
      const title = document.createElement("strong");
      title.textContent = item.title || "Evento";
      const description = document.createElement("p");
      description.textContent = item.description || "";
      const date = document.createElement("small");
      date.textContent = new Date(item.startsAt.toMillis()).toLocaleString();
      const reminder = document.createElement("button");
      reminder.type = "button";
      reminder.textContent = reminderTimers.has(item.id) ? "Recordatorio activado" : "Recordarme 30 min antes";
      reminder.onclick = async () => {
        const reminderAt = item.startsAt.toMillis() - 30 * 60 * 1000;
        if (reminderAt <= Date.now()) return alert("El recordatorio de este evento ya pasó.");
        try {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (AudioContextClass) {
            reminderAudioContext ||= new AudioContextClass();
            if (reminderAudioContext.state === "suspended") await reminderAudioContext.resume();
          }
        } catch (error) { console.warn("No se pudo preparar el sonido del recordatorio:", error); }
        if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
        const oldTimer = reminderTimers.get(item.id);
        if (oldTimer) clearTimeout(oldTimer);
        const delay = reminderAt - Date.now();
        if (delay <= 2147483647) {
          const timer = setTimeout(() => {
            if (document.visibilityState === "visible") playReminderSound();
            else if ("Notification" in window && Notification.permission === "granted") {
              new Notification("Recordatorio universitario", { body: item.title });
            }
            reminderTimers.delete(item.id);
            reminder.textContent = "Recordarme 30 min antes";
          }, delay);
          reminderTimers.set(item.id, timer);
          reminder.textContent = "Recordatorio activado";
        } else alert("El evento está muy lejos para programar un recordatorio local. Vuelve a activarlo más cerca de la fecha.");
      };
      card.append(title, description, date, reminder);
      if (item.createdBy === activeUser.uid) {
        const removeEvent = document.createElement("button");
        removeEvent.type = "button";
        removeEvent.className = "danger-action";
        removeEvent.textContent = "Eliminar";
        removeEvent.setAttribute("aria-label", `Eliminar evento ${item.title || "Evento"}`);
        removeEvent.onclick = async () => {
          if (!confirm(`¿Eliminar el evento “${item.title || "Evento"}”?`)) return;
          removeEvent.disabled = true;
          try {
            const timer = reminderTimers.get(item.id);
            if (timer) clearTimeout(timer);
            reminderTimers.delete(item.id);
            await deleteDoc(doc(db, "campusEvents", item.id));
            await loadEvents();
          } catch (error) {
            removeEvent.disabled = false;
            alert(`No se pudo eliminar el evento: ${error.message}`);
          }
        };
        card.appendChild(removeEvent);
      }
      list.appendChild(card);
    });
  } catch (error) { appendEmpty(list, `No se pudieron cargar eventos: ${error.message}`); }
}
$("eventForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeUser) return;
  const title = escapeText($("eventTitle").value);
  const date = new Date($("eventDate").value);
  if (!title || !Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) return alert("Elige una fecha futura válida.");
  try {
    await addDoc(collection(db, "campusEvents"), {
      title, description: escapeText($("eventDescription").value),
      createdBy: activeUser.uid, startsAt: date, createdAt: serverTimestamp(),
    });
    event.target.reset();
    loadEvents();
  } catch (error) { alert(`No se pudo programar el evento: ${error.message}`); }
});

function appendEmpty(parent, text) {
  const message = document.createElement("p");
  message.className = "campus-empty";
  message.textContent = text;
  parent.appendChild(message);
}
function refreshCampusLists() { loadStories(); loadEvents(); }

async function mountPoll(postElement, suppliedPoll = null) {
  const postId = postElement.dataset.postId;
  if (!postId || postElement.dataset.pollLoaded) return;
  postElement.dataset.pollLoaded = "pending";
  try {
    let poll = suppliedPoll;
    if (!poll) {
      const snap = await getDoc(doc(db, "posts", postId));
      poll = snap.exists() ? snap.data().poll : null;
    }
    if (!poll || !Array.isArray(poll.options) || poll.options.length < 2) {
      postElement.dataset.pollLoaded = "no";
      return;
    }
    postElement.dataset.pollLoaded = "yes";
    const box = document.createElement("section");
    box.className = "post-poll";
    const title = document.createElement("h4");
    title.textContent = poll.question || "Encuesta";
    box.appendChild(title);
    const voters = poll.voters || {};
    const counts = Array.isArray(poll.votes) ? poll.votes : poll.options.map((_, index) => poll.votes?.[String(index)] || 0);
    const total = counts.reduce((sum, number) => sum + Number(number || 0), 0);
    poll.options.forEach((option, index) => {
      const voteButton = document.createElement("button");
      voteButton.type = "button";
      voteButton.className = "post-poll-option";
      voteButton.textContent = `${option} · ${counts[index] || 0}${total ? ` (${Math.round((counts[index] || 0) * 100 / total)}%)` : ""}`;
      voteButton.disabled = Boolean(voters[activeUser?.uid]);
      voteButton.onclick = async () => {
        if (!activeUser) return alert("Inicia sesión para votar.");
        voteButton.disabled = true;
        try {
          await runTransaction(db, async (transaction) => {
            const ref = doc(db, "posts", postId);
            const fresh = await transaction.get(ref);
            if (!fresh.exists()) throw new Error("La publicación ya no existe.");
            const freshPoll = fresh.data().poll;
            const freshVoters = freshPoll.voters || {};
            if (freshVoters[activeUser.uid] !== undefined) return;
            freshVoters[activeUser.uid] = index;
            const freshVotes = freshPoll.options.map((_, optionIndex) =>
              Object.values(freshVoters).filter((value) => value === optionIndex).length
            );
            transaction.update(ref, { poll: { ...freshPoll, voters: freshVoters, votes: freshVotes } });
          });
          postElement.dataset.pollLoaded = "";
          box.remove();
          mountPoll(postElement);
        } catch (error) { voteButton.disabled = false; alert(`No se pudo registrar el voto: ${error.message}`); }
      };
      box.appendChild(voteButton);
    });
    const totalLabel = document.createElement("small");
    totalLabel.textContent = `${total} votos`;
    box.appendChild(totalLabel);
    postElement.appendChild(box);
  } catch (error) { postElement.dataset.pollLoaded = ""; console.warn("No se pudo cargar encuesta", error); }
}
window.renderPostPoll = (postElement, poll) => mountPoll(postElement, poll);
const postObserver = new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => {
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  if (node.matches?.('.post[data-has-poll="true"]')) mountPoll(node);
  node.querySelectorAll?.('.post[data-has-poll="true"]').forEach(mountPoll);
})));
postObserver.observe($("postsContainer"), { childList: true, subtree: true });
postObserver.observe($("profileUserPosts"), { childList: true, subtree: true });

// Reports are private records; blocks are stored on the reporter's own account.
const moderationSearch = $("moderationUserSearch");
const moderationUid = $("moderationUid");
const moderationSuggestions = $("moderationSuggestions");
moderationSearch?.addEventListener("input", async () => {
  if (moderationUid) moderationUid.value = "";
  if (!moderationSuggestions) return;
  moderationSuggestions.replaceChildren();
  const term = moderationSearch.value.trim().toLocaleLowerCase();
  if (!term) return;
  try {
    const people = await getGroupUsers();
    const matches = people
      .filter((person) => person.uid !== activeUser?.uid && person.name.toLocaleLowerCase().includes(term))
      .sort((first, second) => Number(!first.name.toLocaleLowerCase().startsWith(term)) - Number(!second.name.toLocaleLowerCase().startsWith(term)))
      .slice(0, 8);
    if (!matches.length) return appendEmpty(moderationSuggestions, "No se encontraron personas.");
    matches.forEach((person) => {
      const option = document.createElement("button");
      option.type = "button";
      option.setAttribute("role", "option");
      option.textContent = person.name + (person.username ? ` · @${person.username}` : "");
      option.addEventListener("click", () => {
        moderationSearch.value = person.name;
        moderationUid.value = person.uid;
        moderationSuggestions.replaceChildren();
      });
      moderationSuggestions.appendChild(option);
    });
  } catch (error) { appendEmpty(moderationSuggestions, `No se pudieron buscar usuarios: ${error.message}`); }
});

async function renderBlockedUsers() {
  const list = $("blockedUsersList");
  if (!activeUser || !list) return;
  list.replaceChildren();
  try {
    const snap = await getDoc(doc(db, "users", activeUser.uid));
    const blocked = snap.exists() ? snap.data().blockedUsers || [] : [];
    if (!blocked.length) return appendEmpty(list, "No has bloqueado usuarios.");
    const people = await getGroupUsers();
    blocked.forEach((uid) => {
      const row = document.createElement("div");
      row.className = "campus-list-item";
      const label = document.createElement("span");
      label.textContent = people.find((person) => person.uid === uid)?.name || "Usuario";
      const unblock = document.createElement("button");
      unblock.textContent = "Desbloquear";
      unblock.onclick = async () => {
        const latest = await getDoc(doc(db, "users", activeUser.uid));
        await updateDoc(doc(db, "users", activeUser.uid), { blockedUsers: (latest.data()?.blockedUsers || []).filter((item) => item !== uid) });
        renderBlockedUsers();
        window.activateTab?.("home");
      };
      row.append(label, unblock);
      list.appendChild(row);
    });
  } catch (error) { appendEmpty(list, `No se pudo leer la lista: ${error.message}`); }
}
$("moderationForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeUser) return;
  const reportedUid = escapeText(moderationUid?.value);
  if (!reportedUid || reportedUid === activeUser.uid) return alert("Busca y selecciona a una persona de la lista.");
  try {
    await addDoc(collection(db, "userReports"), {
      reporterUid: activeUser.uid, reportedUid, reason: $("reportReason").value,
      status: "open", createdAt: serverTimestamp(),
    });
    $("moderationStatus").textContent = "Reporte enviado. Gracias por ayudar a cuidar la comunidad.";
  } catch (error) { alert(`No se pudo enviar el reporte: ${error.message}`); }
});
$("blockUserBtn")?.addEventListener("click", async () => {
  if (!activeUser) return;
  const blockedUid = escapeText(moderationUid?.value);
  if (!blockedUid || blockedUid === activeUser.uid) return alert("Busca y selecciona a una persona de la lista.");
  try {
    await runTransaction(db, async (transaction) => {
      const ref = doc(db, "users", activeUser.uid);
      const snap = await transaction.get(ref);
      const blocked = new Set(snap.exists() ? snap.data().blockedUsers || [] : []);
      blocked.add(blockedUid);
      transaction.update(ref, { blockedUsers: [...blocked] });
    });
    $("moderationStatus").textContent = "Usuario bloqueado en esta cuenta.";
    renderBlockedUsers();
    window.activateTab?.("home");
  } catch (error) { alert(`No se pudo bloquear al usuario: ${error.message}`); }
});

// Typing presence listens to the active chat ID supplied by the main chat module.
function watchTyping(chatId) {
  clearTimeout(typingWriteTimer);
  clearTimeout(typingStopTimer);
  if (unsubscribeTyping) unsubscribeTyping();
  unsubscribeTyping = null;
  const previousChatId = typingChatId;
  if (previousChatId && previousChatId !== chatId && activeUser) {
    setDoc(doc(db, "chats", previousChatId, "typing", activeUser.uid), { typing: false, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
  }
  typingChatId = chatId || "";
  const header = $("chatWithName");
  let indicator = $("typingIndicator");
  if (!indicator && header) {
    indicator = document.createElement("small");
    indicator.id = "typingIndicator";
    indicator.className = "typing-indicator";
    header.insertAdjacentElement("afterend", indicator);
  }
  if (indicator) indicator.textContent = "";
  if (!typingChatId || !activeUser) return;
  unsubscribeTyping = onSnapshot(collection(db, "chats", typingChatId, "typing"), (snapshot) => {
    const now = Date.now();
    const someoneTyping = snapshot.docs.some((item) => item.id !== activeUser.uid
      && item.data().typing === true
      && item.data().updatedAt?.toMillis?.() > now - 8000);
    if (indicator) indicator.textContent = someoneTyping ? "Escribiendo…" : "";
  });
}
const chatWindow = $("chatWindow");
if (chatWindow) new MutationObserver(() => watchTyping(chatWindow.dataset.chatId || ""))
  .observe(chatWindow, { attributes: true, attributeFilter: ["data-chat-id"] });
$("chatInput")?.addEventListener("input", () => {
  if (!activeUser || !typingChatId) return;
  clearTimeout(typingWriteTimer);
  clearTimeout(typingStopTimer);
  typingWriteTimer = setTimeout(() => {
    setDoc(doc(db, "chats", typingChatId, "typing", activeUser.uid), {
      typing: true, updatedAt: serverTimestamp(),
    }, { merge: true }).catch(() => {});
  }, 250);
  typingStopTimer = setTimeout(() => {
    setDoc(doc(db, "chats", typingChatId, "typing", activeUser.uid), {
      typing: false, updatedAt: serverTimestamp(),
    }, { merge: true }).catch(() => {});
  }, 1800);
});
window.addEventListener("beforeunload", () => {
  if (activeUser && typingChatId) setDoc(doc(db, "chats", typingChatId, "typing", activeUser.uid), { typing: false, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
});
