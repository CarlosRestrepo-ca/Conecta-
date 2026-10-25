const storyForm = document.getElementById("storyForm");
const storyText = document.getElementById("storyText");
const storyFileInput = document.getElementById("storyMediaInput");
const storyUploadZone = document.getElementById("storyUploadZone");
const storyTextPanel = document.getElementById("storyTextPanel");
const openStoryTextButton = document.getElementById("openStoryTextBtn");
const storyPreview = document.getElementById("storyMediaPreview");
const storyPreviewContent = document.getElementById("storyMediaPreviewContent");
const storyMediaStatus = document.getElementById("storyMediaStatus");
const storyPublishButton = document.getElementById("publishStoryBtn");
const storyCharacterCount = document.getElementById("storyCharacterCount");
const clearStoryMediaButton = document.getElementById("clearStoryMediaBtn");
const backgroundColorInput = document.getElementById("storyBackgroundColor");
const storyViewerText = document.getElementById("storyViewerText");

let storyPreviewUrl = "";
let storyFileValid = true;
let selectedStoryBackground = backgroundColorInput?.value || "#2176ff";

function updateStoryCharacterCount() {
  if (storyCharacterCount && storyText) {
    storyCharacterCount.textContent = `${storyText.value.length}/500`;
  }
}

function getStoryTextColor(color) {
  const hex = color.slice(1);
  const luminance = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  return luminance > 0.48 ? "#172033" : "#ffffff";
}

function updateStoryBackground(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  selectedStoryBackground = color;
  if (backgroundColorInput) backgroundColorInput.value = color;
  document.querySelectorAll("[data-story-background]").forEach((button) => {
    const selected = button.dataset.storyBackground.toLowerCase() === color.toLowerCase();
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  storyTextPanel?.style.setProperty("--story-background", color);
  if (storyText) {
    storyText.style.setProperty("background-color", color, "important");
    storyText.style.setProperty("color", getStoryTextColor(color), "important");
  }
}

function clearStoryPreview({ clearInput = true } = {}) {
  if (storyPreviewUrl) URL.revokeObjectURL(storyPreviewUrl);
  storyPreviewUrl = "";
  storyPreviewContent?.replaceChildren();
  storyPreview?.classList.add("hidden");
  storyFileValid = true;
  if (clearInput && storyFileInput) storyFileInput.value = "";
  if (storyPublishButton) {
    storyPublishButton.disabled = false;
    storyPublishButton.classList.toggle("hidden", !storyTextPanel || storyTextPanel.classList.contains("hidden"));
  }
  if (storyMediaStatus) {
    storyMediaStatus.textContent = "Puedes publicar texto, una foto o un video de hasta 30 segundos.";
    storyMediaStatus.classList.remove("is-error");
  }
}

function rejectStoryFile(message) {
  clearStoryPreview();
  storyFileValid = true;
  if (storyMediaStatus) {
    storyMediaStatus.textContent = message;
    storyMediaStatus.classList.add("is-error");
  }
  storyFileInput?.focus();
}

function previewStoryFile(file) {
  if (!file) {
    clearStoryPreview();
    return;
  }
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
    rejectStoryFile("Selecciona un archivo de imagen o video.");
    return;
  }

  clearStoryPreview({ clearInput: false });
  storyFileValid = !file.type.startsWith("video/");
  storyPreviewUrl = URL.createObjectURL(file);
  const media = document.createElement(file.type.startsWith("video/") ? "video" : "img");
  media.src = storyPreviewUrl;
  media.className = "story-media-preview-item";
  if (media instanceof HTMLVideoElement) {
    media.controls = true;
    media.playsInline = true;
    media.preload = "metadata";
    media.addEventListener("loadedmetadata", () => {
      if (media.duration > 30) {
        rejectStoryFile("El video supera los 30 segundos. Elige uno más corto.");
        return;
      }
      storyFileValid = true;
      if (storyPublishButton) storyPublishButton.disabled = false;
      if (storyMediaStatus) {
        storyMediaStatus.textContent = "Video listo para publicar.";
        storyMediaStatus.classList.remove("is-error");
      }
    }, { once: true });
    media.addEventListener("error", () => rejectStoryFile("No se pudo leer el video. Prueba con otro archivo."), { once: true });
    if (storyPublishButton) storyPublishButton.disabled = true;
    if (storyMediaStatus) storyMediaStatus.textContent = "Revisando la duración del video…";
  } else {
    media.alt = "Vista previa del archivo seleccionado para la historia";
    if (storyMediaStatus) {
      storyMediaStatus.textContent = "Foto lista para publicar.";
      storyMediaStatus.classList.remove("is-error");
    }
  }

  storyPreviewContent?.replaceChildren(media);
  storyPreview?.classList.remove("hidden");
  storyPublishButton?.classList.remove("hidden");
}

openStoryTextButton?.addEventListener("click", () => {
  const willOpen = storyTextPanel?.classList.contains("hidden");
  storyTextPanel?.classList.toggle("hidden", !willOpen);
  openStoryTextButton.setAttribute("aria-expanded", String(Boolean(willOpen)));
  if (willOpen) {
    storyPublishButton?.classList.remove("hidden");
    storyText?.focus();
  } else if (!storyPreview || storyPreview.classList.contains("hidden")) {
    storyPublishButton?.classList.add("hidden");
  }
});

document.querySelectorAll("[data-story-background]").forEach((button) => {
  button.addEventListener("click", () => updateStoryBackground(button.dataset.storyBackground));
});
backgroundColorInput?.addEventListener("input", () => updateStoryBackground(backgroundColorInput.value));
updateStoryBackground(selectedStoryBackground);

storyText?.addEventListener("input", updateStoryCharacterCount);
storyFileInput?.addEventListener("change", () => previewStoryFile(storyFileInput.files?.[0]));
clearStoryMediaButton?.addEventListener("click", () => clearStoryPreview());
storyForm?.addEventListener("submit", (event) => {
  if (!storyFileValid) {
    event.preventDefault();
    event.stopImmediatePropagation();
    storyUploadZone?.focus();
  }
});

// Store the chosen color as invisible Unicode tag characters so existing story storage keeps it.
const colorTagStart = String.fromCodePoint(0xe0001);
const colorTagEnd = String.fromCodePoint(0xe007f);
function encodeStoryBackground(color) {
  const hex = color.slice(1).toLowerCase();
  return `${colorTagStart}${[...hex].map((char) => String.fromCodePoint(0xe0000 + char.charCodeAt(0))).join("")}${colorTagEnd}`;
}
function readStoryBackground(text) {
  const match = text.match(/\u{e0001}([\u{e0000}-\u{e007f}]{6})\u{e007f}/u);
  if (!match) return null;
  const hex = [...match[1]].map((char) => String.fromCodePoint(char.codePointAt(0) - 0xe0000)).join("");
  return /^#[0-9a-f]{6}$/i.test(`#${hex}`) ? { color: `#${hex}`, marker: match[0] } : null;
}

storyForm?.addEventListener("submit", () => {
  const isTextOnly = !storyFileInput?.files?.length
    && !storyTextPanel?.classList.contains("hidden")
    && storyText?.value.trim();
  if (!isTextOnly || !storyText) return;
  const originalText = storyText.value;
  const decoratedText = `${originalText}\n${encodeStoryBackground(selectedStoryBackground)}`;
  storyText.value = decoratedText;
  setTimeout(() => {
    if (storyText.value === decoratedText) storyText.value = originalText;
    updateStoryCharacterCount();
  }, 0);
}, true);

let storyViewerObserver;
function applyTextStoryBackground() {
  if (!storyViewerText) return;
  const currentText = storyViewerText.textContent || "";
  const result = readStoryBackground(currentText);
  const viewer = storyViewerText.closest(".story-viewer-content");
  if (!viewer) return;
  if (!result) {
    viewer.classList.remove("story-text-background");
    viewer.style.removeProperty("--story-background");
    storyViewerText.style.removeProperty("color");
    storyViewerText.style.removeProperty("text-shadow");
    return;
  }

  storyViewerObserver?.disconnect();
  storyViewerText.textContent = currentText.replace(result.marker, "").trimEnd();
  viewer.classList.add("story-text-background");
  viewer.style.setProperty("--story-background", result.color);
  const textColor = getStoryTextColor(result.color);
  storyViewerText.style.color = textColor;
  storyViewerText.style.textShadow = textColor === "#ffffff" ? "0 2px 12px rgba(0,0,0,.2)" : "none";
  storyViewerObserver?.observe(storyViewerText, { childList: true, characterData: true, subtree: true });
}

if (storyViewerText) {
  storyViewerObserver = new MutationObserver(applyTextStoryBackground);
  storyViewerObserver.observe(storyViewerText, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}

storyForm?.addEventListener("reset", () => {
  setTimeout(() => {
    storyTextPanel?.classList.add("hidden");
    openStoryTextButton?.setAttribute("aria-expanded", "false");
    clearStoryPreview();
    updateStoryBackground("#2176ff");
    updateStoryCharacterCount();
  }, 0);
});

storyUploadZone?.addEventListener("keydown", (event) => {
  if (event.target === storyFileInput || !["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  storyFileInput?.click();
});
storyUploadZone?.addEventListener("dragover", (event) => {
  event.preventDefault();
  storyUploadZone.classList.add("is-dragging");
});
storyUploadZone?.addEventListener("dragleave", () => storyUploadZone.classList.remove("is-dragging"));
storyUploadZone?.addEventListener("drop", (event) => {
  event.preventDefault();
  storyUploadZone.classList.remove("is-dragging");
  const file = event.dataTransfer?.files?.[0];
  if (!file || !storyFileInput) return;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  storyFileInput.files = transfer.files;
  previewStoryFile(file);
});

updateStoryCharacterCount();

// Agrupa las historias activas por autor y coloca el acceso para crear historias al inicio.
const storiesTray = document.getElementById("storiesTray");
const storiesTraySection = document.getElementById("storiesTraySection");
const storyComposer = document.querySelector(".profile-story-composer");
let addStoryButton = null;

if (storiesTray && storiesTraySection) {
  if (storyComposer) {
    storyComposer.id = "storyComposerPanel";
    storyComposer.classList.add("hidden");
    storiesTraySection.appendChild(storyComposer);
  }

  addStoryButton = storiesTray.querySelector(":scope > .story-add-card") || document.createElement("button");
  addStoryButton.type = "button";
  addStoryButton.className = "story-add-card";
  addStoryButton.hidden = false;
  addStoryButton.classList.remove("hidden");
  addStoryButton.style.setProperty("display", "grid", "important");
  addStoryButton.style.setProperty("visibility", "visible", "important");
  addStoryButton.style.setProperty("opacity", "1", "important");
  addStoryButton.setAttribute("aria-label", "Añadir una historia");
  addStoryButton.setAttribute("aria-expanded", "false");
  if (storyComposer) addStoryButton.setAttribute("aria-controls", storyComposer.id);
  const addStoryIcon = document.createElement("img");
  addStoryIcon.src = "https://uploads.onecompiler.io/448k9pkeq/448kbzjkm/%C3%83%C2%8Dcono%20de%20agg%20historia_.png";
  addStoryIcon.alt = "";
  addStoryIcon.addEventListener("error", () => {
    addStoryIcon.replaceWith(Object.assign(document.createElement("span"), {
      textContent: "+",
      ariaHidden: "true",
    }));
  }, { once: true });
  addStoryButton.replaceChildren(addStoryIcon);
  if (addStoryButton.parentElement !== storiesTray) storiesTray.prepend(addStoryButton);
  addStoryButton.addEventListener("click", () => {
    if (!storyComposer) return;
    const willOpen = storyComposer.classList.contains("hidden");
    storyComposer.classList.toggle("hidden", !willOpen);
    addStoryButton.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) storyUploadZone?.focus();
  });
}

const storyGroupsByCard = new Map();
let activeStoryGroup = null;
let orderedStoryGroups = [];
let storyGroupingScheduled = false;
let storyViewerContentObserver = null;
let observedStoryViewer = null;

function storyCardIdentities(card) {
  const identities = new Set();
  // story-uid identifica una historia, no al autor; usarlo separaba las historias del mismo usuario.
  const identitySelector = [
    "[data-story-user-id]", "[data-story-user-uid]", "[data-story-owner-id]",
    "[data-story-author-id]", "[data-story-author-uid]", "[data-author-uid]", "[data-author-id]",
    "[data-author-user-id]", "[data-user-id]", "[data-user-uid]", "[data-profile-uid]",
    "[data-uid]", "[data-owner-id]", "[data-owner-uid]",
  ].join(", ");
  const dataKeys = [
    "storyUserId", "storyUserUid", "storyOwnerId", "storyAuthorId", "storyAuthorUid",
    "authorUid", "authorId", "authorUserId", "userId", "userUid", "profileUid", "uid", "ownerId", "ownerUid",
  ];
  const nodes = [card, ...card.querySelectorAll(identitySelector)];

  nodes.forEach((node) => {
    dataKeys.forEach((key) => {
      const value = node.dataset[key]?.trim();
      if (value) identities.add(`user:${value.toLowerCase()}`);
    });
  });

  const authorName = storyCardAuthorName(card);
  if (authorName) identities.add(`name:${authorName.normalize("NFKC").toLowerCase()}`);
  return identities;
}

function storyViewerNavigationScope(viewer) {
  return viewer?.closest(".story-viewer")
    || viewer?.closest("[role='dialog'], [aria-modal='true']")
    || viewer;
}

function restoreNativeStoryNavigation(viewer) {
  storyViewerNavigationScope(viewer)?.querySelectorAll("[data-story-native-navigation-hidden]").forEach((control) => {
    const display = control.dataset.storyOriginalDisplay || "";
    const priority = control.dataset.storyOriginalDisplayPriority || "";
    if (display) control.style.setProperty("display", display, priority);
    else control.style.removeProperty("display");
    delete control.dataset.storyNativeNavigationHidden;
    delete control.dataset.storyOriginalDisplay;
    delete control.dataset.storyOriginalDisplayPriority;
  });
}

function hideNativeStoryNavigation(viewer) {
  const scope = storyViewerNavigationScope(viewer);
  scope?.querySelectorAll("button, [role='button'], a").forEach((control) => {
    if (control.closest(".story-group-nav")) return;
    const label = `${control.getAttribute("aria-label") || ""} ${control.title || ""} ${control.id || ""} ${control.className || ""} ${control.textContent || ""}`;
    const isNativeStoryArrow = ["storyViewerPrev", "storyViewerNext"].includes(control.id);
    if (!isNativeStoryArrow && !/(anterior|siguiente|retroced|avanz|\bprev(?:ious)?\b|\bnext\b|\bforward\b|[‹›←→❮❯⟨⟩⟵⟶])/i.test(label)) return;
    if (!("storyNativeNavigationHidden" in control.dataset)) {
      control.dataset.storyOriginalDisplay = control.style.getPropertyValue("display");
      control.dataset.storyOriginalDisplayPriority = control.style.getPropertyPriority("display");
      control.dataset.storyNativeNavigationHidden = "true";
    }
    control.style.setProperty("display", "none", "important");
  });
}

function closeStoryViewer() {
  const viewer = document.querySelector(".story-viewer-content");
  if (!viewer) {
    activeStoryGroup = null;
    return;
  }
  restoreNativeStoryNavigation(viewer);
  viewer.querySelectorAll(":scope > .story-group-nav").forEach((controls) => controls.remove());
  viewer.classList.remove("story-group-viewer");


  const modal = viewer.parentElement?.closest('[role="dialog"], [aria-modal="true"], [id*="storyViewer" i], [class*="story-viewer" i]');
  const closeButton = modal && [...modal.querySelectorAll("button")].find((button) =>
    /cerrar|close|×|✕|✖/i.test(`${button.getAttribute("aria-label") || ""} ${button.title || ""} ${button.textContent || ""}`)
  );
  if (closeButton) {
    closeButton.click();
  } else {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (modal) {
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
    }
  }

  activeStoryGroup = null;
  storyViewerContentObserver?.disconnect();
  observedStoryViewer = null;
}

function refreshStoryViewerControls() {
  const viewer = document.querySelector(".story-viewer-content");
  if (!viewer || !activeStoryGroup) return;
  viewer.classList.add("story-group-viewer");
  hideNativeStoryNavigation(viewer);

  let controls = viewer.querySelector(".story-group-nav");
  viewer.querySelectorAll(".story-group-nav").forEach((candidate) => {
    if (candidate !== controls) candidate.remove();
  });
  if (controls && controls.parentElement !== viewer) viewer.appendChild(controls);

  if (!controls) {
    controls = document.createElement("div");
    controls.className = "story-group-nav";
    controls.setAttribute("aria-label", "Navegación de historias");
    const previousButton = document.createElement("button");
    previousButton.type = "button";
    previousButton.className = "story-group-nav-button story-group-previous";
    previousButton.textContent = "‹";
    previousButton.setAttribute("aria-label", "Historia anterior");
    const progressLabel = document.createElement("span");
    progressLabel.className = "story-group-progress";
    progressLabel.setAttribute("aria-live", "polite");
    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className = "story-group-nav-button story-group-next";
    nextButton.textContent = "›";
    nextButton.setAttribute("aria-label", "Historia siguiente");

    const navigate = (step) => {
      if (!activeStoryGroup || !orderedStoryGroups.length) return;
      const currentGroupIndex = orderedStoryGroups.findIndex((group) => group.identity === activeStoryGroup.identity);
      if (currentGroupIndex < 0) return;
      let targetGroupIndex = currentGroupIndex;
      let targetStoryIndex = activeStoryGroup.index + step;

      if (targetStoryIndex >= activeStoryGroup.cards.length) {
        if (currentGroupIndex === orderedStoryGroups.length - 1) {
          closeStoryViewer();
          return;
        }
        targetGroupIndex = currentGroupIndex + 1;
        targetStoryIndex = 0;
      } else if (targetStoryIndex < 0) {
        targetGroupIndex = (currentGroupIndex - 1 + orderedStoryGroups.length) % orderedStoryGroups.length;
        targetStoryIndex = orderedStoryGroups[targetGroupIndex].cards.length - 1;
      }

      orderedStoryGroups[targetGroupIndex].cards[targetStoryIndex]?.click();
      window.setTimeout(refreshStoryViewerControls, 0);
    };
    previousButton.addEventListener("click", (event) => { event.stopPropagation(); navigate(-1); });
    nextButton.addEventListener("click", (event) => { event.stopPropagation(); navigate(1); });
    controls.append(previousButton, progressLabel, nextButton);
    viewer.appendChild(controls);
  }

  [".story-group-previous", ".story-group-progress", ".story-group-next"].forEach((selector) => {
    [...controls.querySelectorAll(selector)].slice(1).forEach((duplicate) => duplicate.remove());
  });
  const previous = controls.querySelector(".story-group-previous");
  const progress = controls.querySelector(".story-group-progress");
  const next = controls.querySelector(".story-group-next");
  const total = activeStoryGroup.cards.length;
  const progressText = `${activeStoryGroup.index + 1} / ${total}`;
  if (progress && progress.textContent !== progressText) progress.textContent = progressText;
  const allStoriesCount = orderedStoryGroups.reduce((count, group) => count + group.cards.length, 0);
  if (previous) previous.disabled = allStoriesCount < 2;
  if (next) next.disabled = allStoriesCount < 2;
}

function observeStoryViewer() {
  const viewer = document.querySelector(".story-viewer-content");
  if (!viewer || viewer === observedStoryViewer) return;
  storyViewerContentObserver?.disconnect();
  observedStoryViewer = viewer;
  storyViewerContentObserver = new MutationObserver(() => {
    if (activeStoryGroup) refreshStoryViewerControls();
  });
  storyViewerContentObserver.observe(viewer, { childList: true, subtree: true });
}

function groupActiveStories() {
  storyGroupingScheduled = false;
  if (!storiesTray) return;
  if (addStoryButton) {
    addStoryButton.hidden = false;
    addStoryButton.removeAttribute("hidden");
    addStoryButton.classList.remove("hidden");
    addStoryButton.style.setProperty("display", "grid", "important");
    addStoryButton.style.setProperty("visibility", "visible", "important");
    addStoryButton.style.setProperty("opacity", "1", "important");
    if (addStoryButton.parentElement !== storiesTray || storiesTray.firstElementChild !== addStoryButton) {
      storiesTray.prepend(addStoryButton);
    }
  }
  const cards = [...storiesTray.children].filter((card) => card instanceof HTMLElement && !card.matches(".story-group-count, .story-add-card"));
  cards.forEach((card) => { card.hidden = false; });

  const parents = cards.map((_, index) => index);
  const findRoot = (index) => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const union = (first, second) => {
    const firstRoot = findRoot(first);
    const secondRoot = findRoot(second);
    if (firstRoot !== secondRoot) parents[secondRoot] = firstRoot;
  };
  const aliasesByCard = cards.map(storyCardIdentities);
  const cardsByUserId = new Map();
  aliasesByCard.forEach((aliases, index) => {
    aliases.forEach((alias) => {
      if (!alias.startsWith("user:")) return;
      const matchingCards = cardsByUserId.get(alias) || [];
      matchingCards.forEach((otherIndex) => union(index, otherIndex));
      matchingCards.push(index);
      cardsByUserId.set(alias, matchingCards);
    });
  });

  const cardsByName = new Map();
  aliasesByCard.forEach((aliases, index) => {
    aliases.forEach((alias) => {
      if (!alias.startsWith("name:")) return;
      const matchingCards = cardsByName.get(alias) || [];
      matchingCards.push(index);
      cardsByName.set(alias, matchingCards);
    });
  });
  cardsByName.forEach((matchingCards) => {
    const knownUserIds = new Set(matchingCards.flatMap((index) =>
      [...aliasesByCard[index]].filter((alias) => alias.startsWith("user:"))
    ));
    if (knownUserIds.size <= 1) {
      matchingCards.slice(1).forEach((index) => union(matchingCards[0], index));
      return;
    }

    // A name-only card must not merge two different accounts that share a name.
    const cardsWithoutIds = matchingCards.filter((index) =>
      ![...aliasesByCard[index]].some((alias) => alias.startsWith("user:"))
    );
    cardsWithoutIds.slice(1).forEach((index) => union(cardsWithoutIds[0], index));
  });

  const groups = new Map();
  cards.forEach((card, index) => {
    const root = findRoot(index);
    if (!groups.has(root)) groups.set(root, { cards: [], identities: new Set() });
    const group = groups.get(root);
    group.cards.push(card);
    aliasesByCard[index].forEach((alias) => group.identities.add(alias));
  });

  orderedStoryGroups = [...groups.values()].map(({ cards: groupCards, identities }) => {
    const storyTimes = groupCards.map(storyCardTimestamp);
    const hasCompleteTimestamps = storyTimes.every((timestamp) => timestamp !== null);
    const orderedCards = hasCompleteTimestamps
      ? groupCards.slice().sort((first, second) => storyCardTimestamp(first) - storyCardTimestamp(second))
      : groupCards.slice();
    return {
      identity: [...identities].find((identity) => identity.startsWith("user:"))
        || [...identities][0]
        || `story-card:${cards.indexOf(groupCards[0])}`,
      cards: orderedCards,
    };
  });
  storyGroupsByCard.clear();
  orderedStoryGroups.forEach(({ identity, cards: groupCards }) => {
    const lead = groupCards[0];
    groupCards.forEach((card, index) => storyGroupsByCard.set(card, { identity, cards: groupCards, index }));
    updateStoryCardThumbnail(lead, groupCards);
    lead.classList.add("story-thumbnail-card");
    groupCards.slice(1).forEach((card) => {
      card.hidden = true;
      card.querySelector(":scope > .story-group-count")?.remove();
      card.querySelector(":scope > .story-group-preview")?.remove();
      card.querySelector(":scope > .story-group-avatar")?.remove();
      card.classList.remove("has-story-group", "story-thumbnail-card");
      if ("storyOriginalAriaLabel" in card.dataset) {
        const originalLabel = card.dataset.storyOriginalAriaLabel;
        if (originalLabel) card.setAttribute("aria-label", originalLabel);
        else card.removeAttribute("aria-label");
        delete card.dataset.storyOriginalAriaLabel;
      }
    });

    let count = lead.querySelector(":scope > .story-group-count");
    if (groupCards.length > 1) {
      if (!count) {
        count = document.createElement("span");
        count.className = "story-group-count";
        count.setAttribute("aria-hidden", "true");
        lead.appendChild(count);
      }
      if (count.textContent !== String(groupCards.length)) count.textContent = String(groupCards.length);
      if (!("storyOriginalAriaLabel" in lead.dataset)) {
        lead.dataset.storyOriginalAriaLabel = lead.getAttribute("aria-label") || "";
      }
      const originalLabel = lead.dataset.storyOriginalAriaLabel;
      lead.setAttribute("aria-label", `${originalLabel ? `${originalLabel}. ` : ""}${groupCards.length} historias activas`);
      lead.classList.add("has-story-group");
    } else {
      count?.remove();
      lead.classList.remove("has-story-group");
      if ("storyOriginalAriaLabel" in lead.dataset) {
        const originalLabel = lead.dataset.storyOriginalAriaLabel;
        if (originalLabel) lead.setAttribute("aria-label", originalLabel);
        else lead.removeAttribute("aria-label");
        delete lead.dataset.storyOriginalAriaLabel;
      }
    }
  });
}

function storyCardTimestamp(card) {
  const timestampValues = [
    card.querySelector("time[datetime]")?.dateTime,
    card.dataset.storyCreatedAt,
    card.dataset.storyTimestamp,
    card.dataset.createdAt,
    card.dataset.timestamp,
    card.querySelector("time")?.textContent,
  ];
  for (const value of timestampValues) {
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "object") {
      const milliseconds = typeof value.toMillis === "function"
        ? value.toMillis()
        : Number.isFinite(value.seconds) ? value.seconds * 1000 : NaN;
      if (Number.isFinite(milliseconds)) return milliseconds;
    }
    const text = String(value).trim();
    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e12 ? numeric * 1000 : numeric;
    const parsed = Date.parse(text);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function storyExplicitProfileImage(card) {
  const images = [...card.querySelectorAll("img")];
  return images.find((image) => /profile|avatar|perfil|usuario|user-photo|profile-pic/i.test(
    `${image.className} ${image.id} ${image.alt} ${image.dataset.type || ""} ${image.dataset.role || ""}`
  )) || images.find((image) => image.alt.trim() && !/^(historia|story|foto|imagen)$/i.test(image.alt.trim())) || null;
}

function storyProfileImage(card) {
  return storyExplicitProfileImage(card) || card.querySelector("img");
}

function storyCardAuthorName(card) {
  const nameSelector = ".story-author, .story-user-name, .story-card-name, .story-card-author, .story-username, .story-name, [data-story-author], [data-story-author-name], [data-story-user-name], [data-story-owner-name], [data-author-name], [data-user-name], [data-username]";
  const nameNodes = [...card.querySelectorAll(nameSelector)];
  if (card.matches(nameSelector)) nameNodes.unshift(card);
  const candidates = [
    card.dataset.storyAuthorName,
    card.dataset.storyAuthor,
    card.dataset.storyUserName,
    card.dataset.storyOwnerName,
    card.dataset.authorName,
    card.dataset.userName,
    card.dataset.username,
    ...nameNodes.map((node) => node.textContent),
    (card.dataset.storyOriginalAriaLabel || card.getAttribute("aria-label"))
      ?.replace(/^(ver|abrir)\s+(la\s+)?historias?\s+(de|del)\s+/i, ""),
    storyExplicitProfileImage(card)?.alt?.replace(/^(foto|imagen|perfil|avatar)(\s+(de|del))?\s+/i, ""),
  ];
  return candidates.map((value) => value?.normalize("NFKC").trim().replace(/\s+/g, " "))
    .find((value) => value && value.length < 100 && !/^(historia|story|foto|imagen|usuario)$/i.test(value)) || "";
}

function updateStoryCardThumbnail(card, cards) {
  const timestampedStories = cards
    .map((story) => ({ story, timestamp: storyCardTimestamp(story) }))
    .filter(({ timestamp }) => timestamp !== null);
  const latestCard = timestampedStories.length
    ? timestampedStories.reduce((latest, item) => item.timestamp >= latest.timestamp ? item : latest).story
    : cards[cards.length - 1];
    const latestProfileImage = storyExplicitProfileImage(latestCard);
  const profileUrl = cards.map((story) =>
    story.dataset.profileImage || story.dataset.profileImageUrl || story.dataset.profilePhoto
      || story.dataset.profilePhotoUrl || story.dataset.avatarUrl || story.dataset.avatar
      || story.dataset.userPhoto || story.dataset.profilePic || story.dataset.photoUrl
  ).find(Boolean) || latestProfileImage?.currentSrc || latestProfileImage?.src
    || cards.map(storyProfileImage).map((image) => image?.currentSrc || image?.src).find(Boolean) || "";
  const latestImage = [...latestCard.querySelectorAll("img")]
    .find((image) => image !== latestProfileImage);
  const latestVideo = latestCard.querySelector("video");
  const mediaUrl = profileUrl || latestVideo?.poster || latestImage?.currentSrc || latestImage?.src || latestVideo?.currentSrc || latestVideo?.src || "";
  let preview = card.querySelector(":scope > .story-group-preview");
  if (!preview) {
    preview = document.createElement("span");
    preview.className = "story-group-preview";
    preview.setAttribute("aria-hidden", "true");
    card.prepend(preview);
  }
  preview.replaceChildren();
  if (mediaUrl) {
    const media = document.createElement(latestVideo && !latestVideo.poster && !latestImage ? "video" : "img");
    media.src = mediaUrl;
    media.alt = "";
    if (media instanceof HTMLVideoElement) {
      media.muted = true;
      media.loop = true;
      media.autoplay = true;
      media.playsInline = true;
      media.preload = "metadata";
    }
    preview.appendChild(media);
  } else {
    const storyTextNode = latestCard.querySelector(".story-text, [data-story-text], .story-card-text");
    const text = storyTextNode?.textContent?.trim();
    if (text) preview.textContent = text.slice(0, 100);
  }
  const authorName = storyCardAuthorName(latestCard) || cards.map(storyCardAuthorName).find(Boolean) || "";
  if (authorName) {
    const nameLabel = document.createElement("span");
    nameLabel.className = "story-group-author-name";
    nameLabel.textContent = authorName;
    preview.appendChild(nameLabel);
  }

  let avatar = card.querySelector(":scope > .story-group-avatar");
  if (!avatar) {
    avatar = document.createElement("img");
    avatar.className = "story-group-avatar";
    avatar.alt = "";
    avatar.setAttribute("aria-hidden", "true");
    card.appendChild(avatar);
  }
  if (profileUrl) avatar.src = profileUrl;
  else avatar.removeAttribute("src");
}

function scheduleStoryGrouping() {
  if (storyGroupingScheduled) return;
  storyGroupingScheduled = true;
  window.requestAnimationFrame(groupActiveStories);
}

if (storiesTray) {
  const storyTrayObserver = new MutationObserver(scheduleStoryGrouping);
  storyTrayObserver.observe(storiesTray, {
    childList: true,
    attributes: true,
    attributeFilter: [
      "data-story-user-id", "data-story-user-uid", "data-story-owner-id", "data-story-author-id",
      "data-story-author-uid", "data-author-uid", "data-author-id", "data-author-user-id",
      "data-user-id", "data-user-uid", "data-profile-uid", "data-uid", "data-owner-id", "data-owner-uid",
      "data-story-author-name", "data-story-author", "data-story-user-name", "data-story-owner-name",
      "data-author-name", "data-user-name", "data-username",
    ],
  });
  storiesTray.addEventListener("click", (event) => {
    let card = event.target;
    while (card && card.parentElement !== storiesTray) card = card.parentElement;
    if (card?.matches(".story-add-card")) return;
    let group = card && storyGroupsByCard.get(card);
    if (!group && card) {
      groupActiveStories();
      group = storyGroupsByCard.get(card);
    }
    if (!group) return;
    activeStoryGroup = { ...group, cards: group.cards.slice() };
    window.setTimeout(() => {
      observeStoryViewer();
      refreshStoryViewerControls();
    }, 0);
  }, true);
  scheduleStoryGrouping();
}

const storyGroupStyles = document.createElement("style");
storyGroupStyles.textContent = `
  #storiesTraySection { position: relative; z-index: 25; }
  #storiesTray { display: flex !important; flex-wrap: nowrap; align-items: stretch; gap: 10px; overflow-x: auto; }
  #storiesTray > [hidden] { display: none !important; }
  #storiesTray > .story-thumbnail-card { position: relative; isolation: isolate; overflow: hidden; flex: 0 0 88px; width: 88px !important; min-width: 88px; height: 132px !important; }
  #storiesTray > .story-add-card { display: grid !important; order: -1; flex: 0 0 88px; place-items: center; width: 88px !important; min-width: 88px; height: 132px !important; margin: 0 !important; padding: 7px !important; overflow: hidden; border: 2px solid #2176ff !important; border-radius: 14px !important; background: #fff !important; box-shadow: 0 6px 16px rgba(33,118,255,.18); cursor: pointer; }
  #storiesTray > .story-add-card { display: grid !important; visibility: visible !important; opacity: 1 !important; }
  #storiesTray > .story-add-card img { display: block !important; visibility: visible !important; opacity: 1 !important; width: 100%; height: 100%; object-fit: contain; }
  #storiesTray > .story-add-card > span { display: grid; place-items: center; width: 100%; height: 100%; color: #2176ff; font: 700 48px/1 Arial,sans-serif; }
  #storiesTray > .story-add-card:focus-visible { outline: 3px solid rgba(33,118,255,.35); outline-offset: 2px; }
  #storyComposerPanel:not(.hidden) { position: absolute !important; z-index: 100; top: 58px; left: 0; width: min(440px, calc(100vw - 24px)) !important; max-height: calc(100dvh - 180px); margin: 0 !important; overflow-y: auto !important; box-shadow: 0 18px 48px rgba(20,60,120,.25) !important; }
  [data-theme="dark"] #storiesTray > .story-add-card { background: #203759 !important; border-color: #78aeff !important; }
  #storiesTray > .story-thumbnail-card > :not(.story-group-preview):not(.story-group-avatar):not(.story-group-count) { visibility: hidden !important; }
  #storiesTray .story-group-preview { position: absolute; z-index: 1; inset: 0; display: grid; place-items: center; overflow: hidden; padding: 9px; border-radius: inherit; background: linear-gradient(145deg,#183c75,#2176ff); color: #fff; font: 700 12px/1.25 Arial,sans-serif; text-align: center; overflow-wrap: anywhere; pointer-events: none; }
  #storiesTray .story-group-preview img, #storiesTray .story-group-preview video { width: 100%; height: 100%; object-fit: cover; }
  #storiesTray .story-group-author-name { position: absolute; z-index: 2; inset: auto 0 0; display: block; overflow: hidden; padding: 22px 8px 9px 52px; background: linear-gradient(transparent,rgba(0,0,0,.72)); color: #fff; font: 700 12px/1.2 Arial,sans-serif; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
  #storiesTray .story-group-avatar { position: absolute; z-index: 3; left: 8px; bottom: 8px; width: 38px; height: 38px; border: 2px solid #fff; border-radius: 50%; background: #dbeafe; object-fit: cover; box-shadow: 0 2px 8px rgba(0,0,0,.28); pointer-events: none; }
  #storiesTray .story-group-author-name { padding-left: 42px; font-size: 10px; }
  #storiesTray .story-group-avatar { left: 7px; bottom: 7px; width: 28px; height: 28px; }
  #storiesTray > .has-story-group { position: relative; }
  #storiesTray .story-group-count { position: absolute; top: 5px; right: 5px; z-index: 4; display: grid; place-items: center; min-width: 23px; height: 23px; padding: 0 5px; border: 2px solid #fff; border-radius: 999px; background: linear-gradient(135deg,#2176ff,#7c3aed); color: #fff; font: 700 11px/1 Arial,sans-serif; box-shadow: 0 2px 8px rgba(12,35,75,.28); pointer-events: none; }
  .story-viewer-content.story-group-viewer { position: relative; }
  .story-group-nav { position: absolute; z-index: 20; inset: 50% 10px auto; display: flex; align-items: center; justify-content: space-between; transform: translateY(-50%); pointer-events: none; }
  .story-group-nav-button { display: grid !important; place-items: center; width: 42px !important; min-width: 42px; height: 52px; margin: 0 !important; padding: 0 0 5px !important; border: 1px solid rgba(255,255,255,.45) !important; border-radius: 16px !important; background: rgba(13,25,45,.42) !important; color: #fff !important; font-size: 38px !important; line-height: 1; backdrop-filter: blur(8px); pointer-events: auto; }
  .story-group-nav-button:disabled { opacity: .42; }
  .story-group-progress { position: absolute; top: min(68vh, 560px); left: 50%; transform: translateX(-50%); padding: 5px 10px; border-radius: 99px; background: rgba(13,25,45,.55); color: #fff; font: 700 12px/1.2 Arial,sans-serif; pointer-events: none; }
  @media (max-width: 480px) { .story-group-nav { inset-inline: 7px; } .story-group-nav-button { width: 38px !important; min-width: 38px; height: 46px; } }
`;
document.head.appendChild(storyGroupStyles);
