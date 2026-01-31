const tg = window.Telegram.WebApp;
tg.expand();

const state = {
  manhwas: [],
  currentManhwa: null,
  currentChapter: null,
  pages: [],
  dirty: false,
};

const manhwaList = document.getElementById("manhwaList");
const chapterList = document.getElementById("chapterList");
const pageGrid = document.getElementById("pageGrid");
const details = document.getElementById("details");
const refreshBtn = document.getElementById("refreshBtn");
const saveBtn = document.getElementById("saveBtn");

async function api(path, options = {}) {
  const headers = options.headers || {};
  headers["X-Telegram-InitData"] = tg.initData || "";
  return fetch(path, { ...options, headers, cache: "no-store" });
}

function getChapterBase(manhwaId, chapterNumber) {
  return `/manhwa/${manhwaId}/chapter-${chapterNumber}/`;
}

function setDirty(value) {
  state.dirty = value;
  saveBtn.disabled = !value;
}

function renderList() {
  manhwaList.innerHTML = "";
  state.manhwas.forEach((item) => {
    const li = document.createElement("li");
    li.className = "list-item" + (state.currentManhwa?.id === item.id ? " active" : "");
    li.textContent = item.title;
    li.onclick = () => selectManhwa(item.id);
    manhwaList.appendChild(li);
  });
}

function renderDetails() {
  if (!state.currentManhwa) {
    details.innerHTML = '<div class="empty-state">Select a manhwa to start managing chapters.</div>';
    return;
  }
  const status = formatStatus(state.currentManhwa.status);
  details.innerHTML = `
    <div class="section-title">Manhwa</div>
    <div><strong>${state.currentManhwa.title}</strong></div>
    <div>Status: ${status}</div>
    <div>Genres: ${state.currentManhwa.genres.join(", ")}</div>
  `;
}

function formatStatus(status) {
  if (!status) return "";
  const normalized = String(status).toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function renderChapters() {
  chapterList.innerHTML = "";
  if (!state.currentManhwa) return;
  state.currentManhwa.chapters.forEach((chapter) => {
    const chip = document.createElement("div");
    chip.className =
      "chapter-chip" + (state.currentChapter?.number === chapter.number ? " active" : "");
    chip.textContent = `Chapter ${chapter.number} (${chapter.pages.length})`;
    chip.onclick = () => selectChapter(chapter);
    chapterList.appendChild(chip);
  });
}

function renderPages() {
  pageGrid.innerHTML = "";
  if (!state.currentChapter) return;
  const base = getChapterBase(state.currentManhwa.id, state.currentChapter.number);
  state.pages.forEach((page, index) => {
    const card = document.createElement("div");
    card.className = "page-card";
    const img = document.createElement("img");
    img.src = base + page;
    card.appendChild(img);
    const actions = document.createElement("div");
    actions.className = "page-actions";
    const up = document.createElement("button");
    up.textContent = "Up";
    up.onclick = () => movePage(index, -1);
    const down = document.createElement("button");
    down.textContent = "Down";
    down.onclick = () => movePage(index, 1);
    const del = document.createElement("button");
    del.textContent = "Remove";
    del.onclick = () => removePage(index);
    actions.appendChild(up);
    actions.appendChild(down);
    actions.appendChild(del);
    card.appendChild(actions);
    pageGrid.appendChild(card);
  });
}

function movePage(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= state.pages.length) return;
  const next = [...state.pages];
  [next[index], next[target]] = [next[target], next[index]];
  state.pages = next;
  setDirty(true);
  renderPages();
}

function removePage(index) {
  const next = [...state.pages];
  next.splice(index, 1);
  state.pages = next;
  setDirty(true);
  renderPages();
}

async function selectManhwa(manhwaId) {
  const response = await api(`/api/manhwa/${manhwaId}`);
  state.currentManhwa = await response.json();
  state.currentChapter = null;
  state.pages = [];
  setDirty(false);
  renderList();
  renderDetails();
  renderChapters();
  renderPages();
}

function selectChapter(chapter) {
  state.currentChapter = chapter;
  state.pages = [...chapter.pages];
  setDirty(false);
  renderChapters();
  renderPages();
}

async function loadManhwas() {
  const response = await api("/api/manhwa");
  state.manhwas = await response.json();
  renderList();
  renderDetails();
  renderChapters();
  renderPages();
}

async function saveChanges() {
  if (!state.currentManhwa || !state.currentChapter) return;
  await api(`/api/manhwa/${state.currentManhwa.id}/chapters/${state.currentChapter.number}/pages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pages: state.pages }),
  });
  setDirty(false);
  await loadManhwas();
}

refreshBtn.onclick = loadManhwas;
saveBtn.onclick = saveChanges;

window.addEventListener("beforeunload", (event) => {
  if (state.dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

loadManhwas();

function refreshIfSafe() {
  if (state.dirty) return;
  loadManhwas();
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshIfSafe();
  }
});

window.addEventListener("focus", () => {
  refreshIfSafe();
});

