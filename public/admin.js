const adminState = {
  manhwas: [],
  currentManhwa: null,
  currentChapter: null,
  pages: [],
};

async function fetchManhwa() {
  const res = await fetch("/data/manhwa.json");
  if (!res.ok) return [];
  return res.json();
}

function renderAdminList() {
  const list = document.getElementById("adminList");
  if (!list) return;
  list.innerHTML = "";
  adminState.manhwas.forEach((item) => {
    const row = document.createElement("div");
    row.className = `admin-item${adminState.currentManhwa?.id === item.id ? " active" : ""}`;
    row.textContent = item.title;
    row.onclick = () => selectManhwa(item);
    list.appendChild(row);
  });
}

function renderAdminDetails() {
  const details = document.getElementById("adminDetails");
  if (!details) return;
  if (!adminState.currentManhwa) {
    details.textContent = t("admin_select");
    return;
  }
  details.innerHTML = `
    <div><strong>${adminState.currentManhwa.title}</strong></div>
    <div>${t("admin_status")}: ${adminState.currentManhwa.status}</div>
    <div>${t("admin_genres")}: ${adminState.currentManhwa.genres.join(", ")}</div>
  `;
}

function renderAdminChapters() {
  const container = document.getElementById("adminChapters");
  if (!container) return;
  container.innerHTML = "";
  const chapters = adminState.currentManhwa?.chapters || [];
  chapters
    .slice()
    .sort((a, b) => parseFloat(b.number) - parseFloat(a.number))
    .forEach((chapter) => {
      const btn = document.createElement("button");
      btn.className = "chapter-btn";
      btn.textContent = `${t("chapter")} ${chapter.number}`;
      btn.onclick = () => selectChapter(chapter);
      container.appendChild(btn);
    });
}

function renderAdminPages() {
  const grid = document.getElementById("adminPages");
  if (!grid) return;
  grid.innerHTML = "";
  if (!adminState.currentChapter) {
    grid.innerHTML = `<div class="meta">${t("admin_select_chapter")}</div>`;
    return;
  }
  adminState.pages.forEach((page, index) => {
    const card = document.createElement("div");
    card.className = "page-card";
    const img = document.createElement("img");
    img.src = `${adminState.currentChapter.path}${page}`;
    img.alt = page;
    img.loading = "lazy";
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
    grid.appendChild(card);
  });
}

function selectManhwa(item) {
  adminState.currentManhwa = item;
  adminState.currentChapter = null;
  adminState.pages = [];
  renderAdminList();
  renderAdminDetails();
  renderAdminChapters();
  renderAdminPages();
}

function selectChapter(chapter) {
  adminState.currentChapter = chapter;
  adminState.pages = [...chapter.pages];
  renderAdminPages();
}

function movePage(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= adminState.pages.length) return;
  const next = [...adminState.pages];
  [next[index], next[target]] = [next[target], next[index]];
  adminState.pages = next;
  renderAdminPages();
}

function removePage(index) {
  const next = [...adminState.pages];
  next.splice(index, 1);
  adminState.pages = next;
  renderAdminPages();
}

async function savePageOrder() {
  if (!adminState.currentManhwa || !adminState.currentChapter) return;
  const payload = {
    pages: adminState.pages,
  };
  try {
    const res = await fetch(
      `/api/manhwa/${adminState.currentManhwa.id}/chapters/${adminState.currentChapter.number}/pages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) throw new Error("API unavailable");
    await refresh();
    alert(t("admin_saved"));
  } catch (error) {
    alert(t("admin_api_error"));
  }
}

function wireUploadPreview() {
  const input = document.getElementById("uploadInput");
  const preview = document.getElementById("uploadPreview");
  if (!input || !preview) return;
  input.addEventListener("change", () => {
    const files = Array.from(input.files || []);
    if (!files.length) {
      preview.textContent = t("admin_upload_empty");
      return;
    }
    const lines = files.map((file) => `${file.name} • ${(file.size / 1024).toFixed(1)} KB`);
    preview.innerHTML = lines.join("<br />");
  });
}

function sendToBot() {
  if (!window.Telegram || !window.Telegram.WebApp) {
    alert(t("admin_bot_only"));
    return;
  }
  const data = {
    action: "upload_request",
    manhwa: adminState.currentManhwa?.id || null,
    chapter: adminState.currentChapter?.number || null,
  };
  window.Telegram.WebApp.sendData(JSON.stringify(data));
  alert(t("admin_sent"));
}

async function refresh() {
  adminState.manhwas = await fetchManhwa();
  renderAdminList();
  renderAdminDetails();
  renderAdminChapters();
  renderAdminPages();
}

document.addEventListener("DOMContentLoaded", async () => {
  await refresh();
  document.getElementById("savePagesBtn")?.addEventListener("click", savePageOrder);
  document.getElementById("uploadConfirmBtn")?.addEventListener("click", sendToBot);
  wireUploadPreview();
});

window.addEventListener("langChanged", () => {
  renderAdminList();
  renderAdminDetails();
  renderAdminChapters();
  renderAdminPages();
});

