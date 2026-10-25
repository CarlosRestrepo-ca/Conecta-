import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import {
    getFirestore, collection, doc, getDoc, getDocs, onSnapshot, runTransaction, serverTimestamp, setDoc, writeBatch,

} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBFadmAn_msK29B3Hj-NyXs3dNiMPEH5eE",
  authDomain: "conecta-f0162.firebaseapp.com",
  projectId: "conecta-f0162",
  storageBucket: "conecta-f0162.firebasestorage.app",
  messagingSenderId: "483948542084",
  appId: "1:483948542084:web:ac512a6e91c87a5ea0ead1",
  measurementId: "G-99SX22B1DC",
};

const firebaseApp = getApps().find((item) => item.name === "[DEFAULT]") || initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const composer = document.getElementById("pollComposer");
const form = document.getElementById("pollForm");
const optionEditor = document.getElementById("pollOptions");
const status = document.getElementById("pollStatus");
const feed = document.getElementById("postsContainer");
const polls = new Map();
const voteUnsubscribers = new Map();
const voteIds = new Map();
let currentUser = null;
let currentName = "Usuario";
let currentPhoto = "";
let stopPolls = null;
let rendering = false;

function addOption(value = "") {
  if (optionEditor.children.length >= 8) return;
  const row = document.createElement("div");
  row.className = "poll-option-input-row";
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 100;
  input.required = true;
  input.placeholder = `Opción ${optionEditor.children.length + 1}`;
  input.value = value;
  input.setAttribute("aria-label", input.placeholder);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "poll-remove-option";
  remove.textContent = "×";
  remove.title = "Quitar opción";
  remove.setAttribute("aria-label", "Quitar opción");
  remove.disabled = optionEditor.children.length <= 2;
  remove.addEventListener("click", () => {
    if (optionEditor.children.length <= 2) return;
    row.remove();
    refreshOptionRows();
  });
  row.append(input, remove);
  optionEditor.append(row);
  refreshOptionRows();
}

function refreshOptionRows() {
  const rows = [...optionEditor.children];
  rows.forEach((row, index) => {
    const input = row.querySelector("input");
    input.placeholder = `Opción ${index + 1}`;
    input.setAttribute("aria-label", input.placeholder);
    row.querySelector("button").disabled = rows.length <= 2;
  });
  document.getElementById("addPollOption").disabled = rows.length >= 8;
}

addOption();
addOption();
document.getElementById("addPollOption").addEventListener("click", () => addOption());

const defaultPollColor = "#2176ff";
let selectedPollColor = defaultPollColor;

function setPollColor(color) {
  selectedPollColor = color;
  composer?.style.setProperty("--poll-accent", color);
  document.querySelectorAll(".poll-color-swatch").forEach((swatch) => {
    const selected = swatch.dataset.pollColor === color;
    swatch.classList.toggle("is-selected", selected);
    swatch.setAttribute("aria-pressed", String(selected));
  });
}

document.querySelectorAll(".poll-color-swatch").forEach((swatch) => {
  swatch.addEventListener("click", () => setPollColor(swatch.dataset.pollColor));
});
document.getElementById("pollCustomColor")?.addEventListener("input", (event) => setPollColor(event.target.value));
setPollColor(defaultPollColor);

function timestampMillis(value) {
  if (value?.toMillis) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Number(value) || 0;
}

async function getVoteId(pollId) {
  if (voteIds.has(pollId)) return voteIds.get(pollId);
  const input = new TextEncoder().encode(`${pollId}:${currentUser.uid}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  const opaqueId = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  voteIds.set(pollId, opaqueId);
  return opaqueId;
}

function formatRemaining(expiresAt) {
  const remaining = Number(expiresAt) - Date.now();
  if (remaining <= 0) return "Encuesta finalizada";
  const hours = Math.ceil(remaining / 3600000);
  if (hours < 24) return `Cierra en ${hours} h`;
  const days = Math.ceil(hours / 24);
  return `Cierra en ${days} ${days === 1 ? "día" : "días"}`;
}

function renderAnalytics(card, poll, votes) {
  const panel = document.createElement("section");
  panel.className = "poll-analytics";
  const total = votes.length;
  const choiceCounts = poll.options.map((option) => votes.filter((vote) => vote.optionId === option.id).length);
  const title = document.createElement("div");
  title.className = "poll-analytics-heading";
  title.innerHTML = `<div><span>ANÁLISIS DE ENCUESTA</span><strong>${total} ${total === 1 ? "interacción" : "interacciones"}</strong></div>`;
  const controls = document.createElement("div");
  controls.className = "poll-chart-tabs";
  const distributionButton = document.createElement("button");
  const timelineButton = document.createElement("button");
  distributionButton.type = timelineButton.type = "button";
  distributionButton.textContent = "Respuestas";
  timelineButton.textContent = "Participación";
  controls.append(distributionButton, timelineButton);
  const chart = document.createElement("div");
  chart.className = "poll-chart";
  panel.append(title, controls, chart);

  function showDistribution() {
    distributionButton.classList.add("selected");
    timelineButton.classList.remove("selected");
    chart.className = "poll-chart poll-distribution";
    chart.replaceChildren();
    poll.options.forEach((option, index) => {
      const count = choiceCounts[index];
      const percent = total ? Math.round((count / total) * 100) : 0;
      const row = document.createElement("div");
      row.className = "poll-chart-row";
      const label = document.createElement("div");
      label.className = "poll-chart-label";
      const name = document.createElement("span");
      name.textContent = option.text;
      const metric = document.createElement("b");
      metric.textContent = `${percent}% · ${count}`;
      label.append(name, metric);
      const track = document.createElement("div");
      track.className = "poll-chart-track";
      const bar = document.createElement("span");
      bar.style.width = `${percent}%`;
      bar.style.setProperty("--bar-index", index);
      track.append(bar);
      row.append(label, track);
      chart.append(row);
    });
  }

  function showTimeline() {
    distributionButton.classList.remove("selected");
    timelineButton.classList.add("selected");
    chart.className = "poll-chart poll-timeline";
    chart.replaceChildren();
    const start = timestampMillis(poll.createdAt) || Number(poll.createdAtMs) || Date.now();
    const end = Number(poll.expiresAt) || start + 86400000;
    const buckets = Array(8).fill(0);
    votes.forEach((vote) => {
      const position = Math.max(0, Math.min(0.999, (timestampMillis(vote.createdAt) - start) / Math.max(1, end - start)));
      buckets[Math.floor(position * buckets.length)] += 1;
    });
    const max = Math.max(1, ...buckets);
    const points = buckets.map((count, index) => `${20 + index * 48},${112 - (count / max) * 82}`).join(" ");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 356 132");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Gráfico de participación a lo largo del tiempo");
    const area = document.createElementNS(svg.namespaceURI, "polygon");
    area.setAttribute("points", `20,116 ${points} 356,116`);
    area.setAttribute("class", "poll-chart-area");
    const line = document.createElementNS(svg.namespaceURI, "polyline");
    line.setAttribute("points", points);
    line.setAttribute("class", "poll-chart-line");
    svg.append(area, line);
    buckets.forEach((count, index) => {
      const circle = document.createElementNS(svg.namespaceURI, "circle");
      circle.setAttribute("cx", String(20 + index * 48));
      circle.setAttribute("cy", String(112 - (count / max) * 82));
      circle.setAttribute("r", "3.5");
      circle.setAttribute("class", "poll-chart-point");
      const tip = document.createElementNS(svg.namespaceURI, "title");
      tip.textContent = `${count} ${count === 1 ? "voto" : "votos"}`;
      circle.appendChild(tip);
      svg.appendChild(circle);
    });
    const labels = document.createElement("div");
    labels.className = "poll-timeline-labels";
    labels.innerHTML = "<span>Inicio</span><span>Durante la encuesta</span><span>Cierre</span>";
    chart.append(svg, labels);
  }

  distributionButton.addEventListener("click", showDistribution);
  timelineButton.addEventListener("click", showTimeline);
  showDistribution();
  card.appendChild(panel);
}

function makePollCard(id, poll, votes) {
    const card = document.createElement("article");
  card.className = "post poll-post";
  card.dataset.pollId = id;
  card.style.setProperty("--poll-accent", poll.themeColor || "#2176ff");
  const header = document.createElement("div");
  header.className = "poll-post-header";
  const avatar = document.createElement("div");
  avatar.className = "poll-avatar";
  if (poll.authorPhoto) {
    const image = document.createElement("img");
    image.src = poll.authorPhoto;
    image.alt = "";
    avatar.appendChild(image);
  } else {
    avatar.textContent = String(poll.authorName || "U").trim().charAt(0).toUpperCase();
  }
  const author = document.createElement("div");
  author.className = "poll-author-copy";
  const authorName = document.createElement("strong");
  authorName.textContent = poll.authorName || "Usuario";
  const details = document.createElement("span");
  details.textContent = `${poll.visibility === "anonymous" ? "🔒 Votación anónima" : "🔐 Participantes privados"} · ${formatRemaining(poll.expiresAt)}`;
    author.append(authorName, details);
  header.append(avatar, author);
  if (currentUser?.uid === poll.authorId) {
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "poll-delete-button";
    deleteButton.textContent = "Eliminar";
    deleteButton.setAttribute("aria-label", "Eliminar esta encuesta");
    deleteButton.addEventListener("click", () => deletePoll(id, deleteButton));
    header.appendChild(deleteButton);
  }
  const eyebrow = document.createElement("span");

  eyebrow.className = "poll-eyebrow";
  eyebrow.textContent = "ENCUESTA";
  const question = document.createElement("h3");
  question.className = "poll-question";
  question.textContent = poll.question || "Encuesta";
  const summary = document.createElement("div");
  summary.className = "poll-results-summary";
  const total = votes.length;
  const myVote = votes.find((vote) => currentUser && vote.id === voteIds.get(id));
  const hasVoted = Boolean(myVote);
  const ended = Number(poll.expiresAt) <= Date.now();
  const summaryText = document.createElement("span");
  summaryText.textContent = `${total} ${total === 1 ? "voto" : "votos"}`;
  summary.append(summaryText);
  const options = document.createElement("div");
  options.className = "poll-vote-options";

  poll.options.forEach((option, index) => {
    const count = votes.filter((vote) => vote.optionId === option.id).length;
    const percent = total ? Math.round((count / total) * 100) : 0;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "poll-vote-option";
    button.disabled = hasVoted || ended || !currentUser;
    button.setAttribute("aria-label", `Votar por ${option.text}`);
    if (hasVoted || ended) button.classList.add("poll-option-results");
    const label = document.createElement("span");
    label.className = "poll-option-label";
    label.textContent = option.text;
    const result = document.createElement("span");
    result.className = "poll-option-result";
    result.textContent = `${percent}%`;
    const bar = document.createElement("span");
    bar.className = "poll-option-fill";
    bar.style.width = `${(hasVoted || ended) ? percent : 0}%`;
    bar.style.setProperty("--option-index", index);
    button.append(bar, label, result);
    if (myVote?.optionId === option.id) {
      button.classList.add("poll-voted-choice");
    }
    button.addEventListener("click", () => voteInPoll(id, option.id));
    options.appendChild(button);
  });
  card.append(header, eyebrow, question, options, summary);

  if (currentUser?.uid === poll.authorId && poll.visibility === "public") {
    const voterNames = votes.map((vote) => vote.voterName).filter(Boolean);
    if (voterNames.length) {
      const voterList = document.createElement("p");
      voterList.className = "poll-voter-list";
      voterList.textContent = `Participantes (solo tú): ${voterNames.join(" · ")}`;
      card.appendChild(voterList);
    }
  }

  if (currentUser?.uid === poll.authorId) renderAnalytics(card, poll, votes);
  return card;
}

function renderPolls() {
  if (!feed || rendering) return;
  rendering = true;
  feed.querySelectorAll(":scope > .poll-post").forEach((card) => card.remove());
  const ordered = [...polls.entries()].sort((a, b) => (Number(b[1].data.createdAtMs) || timestampMillis(b[1].data.createdAt)) - (Number(a[1].data.createdAtMs) || timestampMillis(a[1].data.createdAt)));
  ordered.forEach(([id, entry]) => feed.appendChild(makePollCard(id, entry.data, entry.votes || [])));
  rendering = false;
}

async function deletePoll(pollId, button) {
  if (!currentUser || !window.confirm("¿Eliminar esta encuesta y sus votos? Esta acción no se puede deshacer.")) return;
  button.disabled = true;
  status.textContent = "Eliminando encuesta…";
  const pollRef = doc(db, "polls", pollId);
  try {
    await runTransaction(db, async (transaction) => {
      const pollSnapshot = await transaction.get(pollRef);
      if (!pollSnapshot.exists()) throw new Error("La encuesta ya no está disponible.");
      if (pollSnapshot.data().authorId !== currentUser.uid) throw new Error("Solo quien publicó la encuesta puede eliminarla.");
      transaction.delete(pollRef);
    });

    let cleanupFailed = false;
    try {
      const votesSnapshot = await getDocs(collection(db, "polls", pollId, "votes"));
      for (let start = 0; start < votesSnapshot.docs.length; start += 450) {
        const batch = writeBatch(db);
        votesSnapshot.docs.slice(start, start + 450).forEach((vote) => batch.delete(vote.ref));
        await batch.commit();
      }
    } catch (error) {
      cleanupFailed = true;
      console.warn("No se pudieron limpiar todos los votos de la encuesta:", error);
    }

    voteUnsubscribers.get(pollId)?.();
    voteUnsubscribers.delete(pollId);
    polls.delete(pollId);
    voteIds.delete(pollId);
    renderPolls();
    status.textContent = cleanupFailed
      ? "Encuesta eliminada; algunos votos no se pudieron limpiar."
      : "Encuesta eliminada.";
  } catch (error) {
    status.textContent = error.message || "No se pudo eliminar la encuesta.";
  } finally {
    button.disabled = false;
  }
}

async function voteInPoll(pollId, optionId) {

  if (!currentUser) {
    status.textContent = "Inicia sesión para votar.";
    return;
  }
  const pollRef = doc(db, "polls", pollId);
  try {
    const voteId = await getVoteId(pollId);
    const voteRef = doc(db, "polls", pollId, "votes", voteId);
    await runTransaction(db, async (transaction) => {
      const [pollSnapshot, voteSnapshot] = await Promise.all([transaction.get(pollRef), transaction.get(voteRef)]);
      if (!pollSnapshot.exists()) throw new Error("La encuesta ya no está disponible.");
      const poll = pollSnapshot.data();
      if (voteSnapshot.exists()) throw new Error("Ya registraste tu voto en esta encuesta.");
      if (Number(poll.expiresAt) <= Date.now()) throw new Error("El tiempo de votación terminó.");
      if (!poll.options?.some((option) => option.id === optionId)) throw new Error("Esta opción ya no está disponible.");
      const vote = { optionId, createdAt: serverTimestamp() };
      if (poll.visibility === "public") vote.voterName = currentName;
      transaction.set(voteRef, vote);
    });
  } catch (error) {
    status.textContent = error.message || "No se pudo registrar tu voto.";
  }
}

function listenToVotes(pollId) {
  if (voteUnsubscribers.has(pollId)) return;
  const stop = onSnapshot(collection(db, "polls", pollId, "votes"), (snapshot) => {
    const entry = polls.get(pollId);
    if (!entry) return;
    entry.votes = snapshot.docs.map((vote) => ({ id: vote.id, ...vote.data() }));
    renderPolls();
  }, (error) => console.warn("No se pudieron actualizar los votos de la encuesta:", error));
  voteUnsubscribers.set(pollId, stop);
}

function observeFeed() {
  if (!feed) return;
  const observer = new MutationObserver(() => {
    if (rendering) return;
    const existing = new Set([...feed.querySelectorAll(":scope > .poll-post")].map((card) => card.dataset.pollId));
    if ([...polls.keys()].some((id) => !existing.has(id))) renderPolls();
  });
  observer.observe(feed, { childList: true });
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) {
    status.textContent = "Inicia sesión para publicar una encuesta.";
    return;
  }
  const question = document.getElementById("pollQuestion").value.trim();
  const options = [...optionEditor.querySelectorAll("input")].map((input) => input.value.trim()).filter(Boolean);
  if (!question || options.length < 2 || options.length > 8) {
    status.textContent = "Escribe una pregunta y al menos dos opciones.";
    return;
  }
  if (new Set(options.map((option) => option.toLocaleLowerCase())).size !== options.length) {
    status.textContent = "Cada opción debe ser diferente.";
    return;
  }
  const publishButton = form.querySelector(".poll-publish");
  publishButton.disabled = true;
  status.textContent = "Publicando encuesta…";
  try {
    const durationHours = Number(document.getElementById("pollDuration").value);
    await setDoc(doc(collection(db, "polls")), {
      authorId: currentUser.uid,
      authorName: currentName,
      authorPhoto: currentPhoto,
      question,
      options: options.map((text) => ({ id: crypto.randomUUID(), text })),
            durationHours,
      visibility: document.getElementById("pollVisibility").value,
      themeColor: selectedPollColor,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
      expiresAt: Date.now() + durationHours * 3600000,
        });
    form.reset();
    setPollColor(defaultPollColor);
    optionEditor.replaceChildren();
    addOption();
    addOption();
    composer.open = false;
    status.textContent = "Encuesta publicada.";
  } catch (error) {
    status.textContent = `No se pudo publicar: ${error.message}`;
  } finally {
    publishButton.disabled = false;
  }
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  currentName = user?.displayName || user?.email?.split("@")[0] || "Usuario";
  currentPhoto = user?.photoURL || "";
  if (user) {
    try {
      const profile = await getDoc(doc(db, "users", user.uid));
      if (profile.exists()) {
        const data = profile.data();
        currentName = data.profile?.name || data.username || currentName;
        currentPhoto = data.profile?.photoURL || data.profile?.photo || currentPhoto;
      }
    } catch (error) {
      console.warn("No se pudo cargar el perfil para la encuesta:", error);
    }
  }
  if (stopPolls) stopPolls();
  for (const stop of voteUnsubscribers.values()) stop();
  voteUnsubscribers.clear();
  voteIds.clear();
  polls.clear();
  renderPolls();
  if (!user) return;
  stopPolls = onSnapshot(collection(db, "polls"), async (snapshot) => {
    const nextIds = new Set(snapshot.docs.map((item) => item.id));
    for (const [id, stop] of voteUnsubscribers) {
      if (!nextIds.has(id)) {
        stop();
        voteUnsubscribers.delete(id);
      }
    }
    const previousVotes = new Map([...polls].map(([id, entry]) => [id, entry.votes || []]));
    polls.clear();
    snapshot.docs.forEach((item) => {
      polls.set(item.id, { data: item.data(), votes: previousVotes.get(item.id) || [] });
      listenToVotes(item.id);
    });
    if (currentUser) await Promise.all(snapshot.docs.map((item) => getVoteId(item.id)));
    renderPolls();
  }, (error) => {
    status.textContent = "No se pudieron cargar las encuestas. Revisa los permisos de Firestore.";
    console.warn("No se pudieron cargar las encuestas:", error);
  });
});

observeFeed();
