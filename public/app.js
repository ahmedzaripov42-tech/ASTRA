const state = {
  manhwas: [],
  selectedManhwaId: null,
  searchQuery: "",
  filter: "all",
  sort: "latest",
};
let lastFetchAt = 0;
const REFRESH_INTERVAL_MS = 5000;

function resolveCoverPath(cover) {
  if (!cover) return "";
  if (cover.startsWith("http://") || cover.startsWith("https://")) return cover;
  if (cover.includes("assets/covers/")) {
    return `/covers/${cover.split("assets/covers/").pop()}`;
  }
  if (cover.startsWith("/")) return cover;
  return `/${cover}`;
}

function getChapterBase(manhwaId, chapterNumber) {
  return `/manhwa/${manhwaId}/chapter-${chapterNumber}/`;
}

async function fetchManhwa() {
  const res = await fetch(`/manhwa.json?t=${Date.now()}`, {
    cache: "no-store",
    headers: { "Cache-Control": "no-store" },
  });
  if (!res.ok) return [];
  return res.json();
}

async function refreshManhwa(force = false) {
  const now = Date.now();
  if (!force && now - lastFetchAt < 1000) return;
  lastFetchAt = now;
  const data = await fetchManhwa();
  if (!Array.isArray(data)) return;
  state.manhwas = data;
  if (state.selectedManhwaId && !state.manhwas.find((item) => item.id === state.selectedManhwaId)) {
    state.selectedManhwaId = null;
  }
  renderIndex(state.manhwas);
  renderReader(state.manhwas);
}

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function renderIndex(manhwas) {
  const grid = document.getElementById("manhwaGrid");
  const chapterList = document.getElementById("chapterList");
  const searchInput = document.getElementById("searchInput");
  const filterSelect = document.getElementById("filterSelect");
  const sortSelect = document.getElementById("sortSelect");
  if (!grid || !chapterList) return;

  grid.innerHTML = "";
  chapterList.innerHTML = `<div class="meta">${t("noData")}</div>`;

  const filtered = applyFilters(manhwas);
  if (!filtered.length) {
    grid.innerHTML = `<div class="meta">${t("noData")}</div>`;
  }
  filtered.forEach((item) => {
    const card = document.createElement("div");
    card.className = `card${state.selectedManhwaId === item.id ? " active" : ""}`;
    const cover = document.createElement("img");
    cover.src = resolveCoverPath(item.cover);
    cover.alt = item.title;
    cover.loading = "lazy";
    cover.onerror = () => {
      cover.src =
        "data:image/svg+xml;charset=UTF-8," +
        encodeURIComponent(
          `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='600'>
             <rect width='100%' height='100%' fill='#151b2c'/>
             <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='#9aa4ff' font-size='20'>
               No Cover
             </text>
           </svg>`
        );
    };
    const body = document.createElement("div");
    body.className = "card-body";
    body.textContent = item.title;
    card.appendChild(cover);
    card.appendChild(body);
    card.onclick = () => {
      const latest = getLatestChapterNumber(item);
      if (latest) {
        window.location.href = `/reader.html?slug=${item.id}&chapter=${latest}`;
        return;
      }
      state.selectedManhwaId = item.id;
      renderIndex(manhwas);
      renderChapters(item);
      updateIndexMeta(item);
    };
    grid.appendChild(card);
  });

  const selected = manhwas.find((item) => item.id === state.selectedManhwaId);
  if (selected) {
    renderChapters(selected);
    updateIndexMeta(selected);
  }

  function renderChapters(manhwa) {
    chapterList.innerHTML = "";
    if (!manhwa.chapters || manhwa.chapters.length === 0) {
      chapterList.innerHTML = `<div class="meta">${t("noChapters")}</div>`;
      return;
    }
    manhwa.chapters
      .slice()
      .sort((a, b) => parseFloat(b.number) - parseFloat(a.number))
      .forEach((chapter) => {
        const btn = document.createElement("button");
        btn.className = "chapter-btn";
        btn.textContent = `${t("chapter")} ${chapter.number}`;
        btn.onclick = () => {
          window.location.href = `/reader.html?slug=${manhwa.id}&chapter=${chapter.number}`;
        };
        chapterList.appendChild(btn);
      });
  }
}

function renderReader(manhwas) {
  const readerTitle = document.getElementById("readerTitle");
  const readerMeta = document.getElementById("readerMeta");
  const pages = document.getElementById("pages");
  if (!readerTitle || !readerMeta || !pages) return;

  const manhwaId = getQueryParam("slug") || getQueryParam("manhwa");
  const chapterNumber = getQueryParam("chapter");
  const manhwa = manhwas.find((item) => item.id === manhwaId);
  if (!manhwa) {
    readerTitle.textContent = t("noData");
    return;
  }
  const chapter = manhwa.chapters.find((ch) => String(ch.number) === String(chapterNumber));
  if (!chapter) {
    readerTitle.textContent = t("noData");
    return;
  }

  readerTitle.textContent = manhwa.title;
  readerMeta.textContent = `${t("chapter")} ${chapter.number} • ${chapter.pages.length} ${t("pages")}`;
  updateReaderMeta(manhwa, chapter);
  pages.innerHTML = "";
  const chapterBase = getChapterBase(manhwa.id, chapter.number);
  const observer = createLazyObserver();
  chapter.pages.forEach((page) => {
    const img = document.createElement("img");
    img.dataset.src = `${chapterBase}${page}`;
    img.loading = "lazy";
    img.alt = `${manhwa.title} ${chapter.number}`;
    if (observer) {
      observer.observe(img);
    } else {
      img.src = img.dataset.src;
    }
    pages.appendChild(img);
  });

  pages.addEventListener("contextmenu", (event) => event.preventDefault());

  setupChapterNav(manhwa, chapter);
}

document.addEventListener("DOMContentLoaded", async () => {
  await refreshManhwa(true);
  const slug = getQueryParam("slug");
  if (slug) {
    state.selectedManhwaId = slug;
  }
  wireControls();
});

window.addEventListener("langChanged", () => {
  if (!state.manhwas.length) return;
  renderIndex(state.manhwas);
  renderReader(state.manhwas);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshManhwa();
  }
});

window.addEventListener("focus", () => {
  refreshManhwa();
});

setInterval(() => {
  if (!document.hidden) {
    refreshManhwa();
  }
}, REFRESH_INTERVAL_MS);

function wireControls() {
  const searchInput = document.getElementById("searchInput");
  const filterSelect = document.getElementById("filterSelect");
  const sortSelect = document.getElementById("sortSelect");
  if (searchInput) {
    searchInput.addEventListener(
      "input",
      debounce((event) => {
        state.searchQuery = event.target.value.trim().toLowerCase();
        renderIndex(state.manhwas);
      }, 250)
    );
  }
  if (filterSelect) {
    filterSelect.addEventListener("change", (event) => {
      state.filter = event.target.value;
      renderIndex(state.manhwas);
    });
  }
  if (sortSelect) {
    sortSelect.addEventListener("change", (event) => {
      state.sort = event.target.value;
      renderIndex(state.manhwas);
    });
  }
}

function applyFilters(manhwas) {
  const normalized = manhwas.map((item) => ({
    ...item,
    chapterCount: item.chapters?.length || 0,
    latestChapter: getLatestChapter(item),
  }));
  let result = normalized;
  if (state.searchQuery) {
    result = result.filter((item) => item.title.toLowerCase().includes(state.searchQuery));
  }
  if (state.filter === "chapters_10") {
    result = result.filter((item) => item.chapterCount >= 10);
  }
  if (state.filter === "chapters_30") {
    result = result.filter((item) => item.chapterCount >= 30);
  }
  if (state.filter === "recent") {
    result = result
      .slice()
      .sort((a, b) => b.latestChapter - a.latestChapter)
      .slice(0, 10);
  }
  if (state.sort === "alpha") {
    result = result.slice().sort((a, b) => a.title.localeCompare(b.title));
  } else {
    result = result.slice().sort((a, b) => b.latestChapter - a.latestChapter);
  }
  return result;
}

function getLatestChapter(manhwa) {
  if (!manhwa.chapters || !manhwa.chapters.length) return 0;
  const numbers = manhwa.chapters
    .map((ch) => parseFloat(ch.number))
    .filter((num) => !Number.isNaN(num));
  return numbers.length ? Math.max(...numbers) : 0;
}

function getLatestChapterNumber(manhwa) {
  if (!manhwa.chapters || !manhwa.chapters.length) return null;
  const sorted = manhwa.chapters
    .slice()
    .sort((a, b) => parseFloat(b.number) - parseFloat(a.number));
  return sorted[0]?.number || null;
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function setupChapterNav(manhwa, chapter) {
  const prevBtn = document.getElementById("prevChapter");
  const nextBtn = document.getElementById("nextChapter");
  const listBtn = document.getElementById("chapterListBtn");
  if (!prevBtn || !nextBtn || !listBtn) return;
  const sorted = manhwa.chapters
    .slice()
    .sort((a, b) => parseFloat(a.number) - parseFloat(b.number));
  const index = sorted.findIndex((ch) => String(ch.number) === String(chapter.number));
  const prev = sorted[index - 1];
  const next = sorted[index + 1];

  prevBtn.disabled = !prev;
  nextBtn.disabled = !next;
  prevBtn.onclick = () => {
    if (!prev) return;
    window.location.href = `/reader.html?slug=${manhwa.id}&chapter=${prev.number}`;
  };
  nextBtn.onclick = () => {
    if (!next) return;
    window.location.href = `/reader.html?slug=${manhwa.id}&chapter=${next.number}`;
  };
  listBtn.onclick = () => {
    window.location.href = `/index.html?slug=${manhwa.id}`;
  };
}

function createLazyObserver() {
  if (!("IntersectionObserver" in window)) return null;
  return new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        img.src = img.dataset.src;
        observer.unobserve(img);
      });
    },
    { rootMargin: "200px 0px" }
  );
}

function updateIndexMeta(manhwa) {
  if (!manhwa) return;
  setMeta({
    title: `${manhwa.title} • Manhwa`,
    description: `${manhwa.title} — ${manhwa.status} • ${manhwa.chapters?.length || 0} chapters`,
    image: resolveCoverPath(manhwa.cover),
  });
}

function updateReaderMeta(manhwa, chapter) {
  setMeta({
    title: `${manhwa.title} • Chapter ${chapter.number}`,
    description: `${manhwa.title} — Chapter ${chapter.number}`,
    image: resolveCoverPath(manhwa.cover),
  });
}

function setMeta({ title, description, image }) {
  document.title = title;
  setMetaTag("description", description);
  setMetaProperty("og:title", title);
  setMetaProperty("og:description", description);
  if (image) {
    setMetaProperty("og:image", image);
  }
}

function setMetaTag(name, content) {
  const tag = document.querySelector(`meta[name="${name}"]`);
  if (tag) tag.setAttribute("content", content);
}

function setMetaProperty(property, content) {
  const tag = document.querySelector(`meta[property="${property}"]`);
  if (tag) tag.setAttribute("content", content);
}

