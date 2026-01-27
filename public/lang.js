const LANG_KEY = "manhwa_lang";

const STRINGS = {
  uz: {
    brand: "Manhwa",
    library: "Kutubxona",
    chapters: "Boblar",
    back: "← Orqaga",
    noChapters: "Boblar yo'q",
    noData: "Ma'lumot topilmadi",
    chapter: "Bob",
    pages: "sahifa",
    search: "Qidirish...",
    filter: "Filtr",
    sort: "Saralash",
    filter_all: "Barchasi",
    filter_10: "10+ bob",
    filter_30: "30+ bob",
    filter_recent: "Yaqinda yangilangan",
    sort_latest: "Oxirgi yangilangan",
    sort_alpha: "Alifbo",
    prev: "◀ Oldingi",
    next: "Keyingi ▶",
    back_chapters: "Boblar ro'yxati",
    admin_select: "Manhwa tanlang.",
    admin_status: "Status",
    admin_genres: "Janrlar",
    admin_select_chapter: "Bobni tanlang.",
    admin_saved: "Sahifalar saqlandi.",
    admin_api_error: "API mavjud emas.",
    admin_upload_empty: "Fayllarni tanlang.",
    admin_bot_only: "Faqat Telegram Mini App orqali.",
    admin_sent: "So'rov botga yuborildi.",
    admin_details: "Ma'lumot",
    admin_upload: "Yuklash",
  },
  ru: {
    brand: "Манхва",
    library: "Библиотека",
    chapters: "Главы",
    back: "← Назад",
    noChapters: "Глав нет",
    noData: "Данные не найдены",
    chapter: "Глава",
    pages: "страниц",
    search: "Поиск...",
    filter: "Фильтр",
    sort: "Сортировка",
    filter_all: "Все",
    filter_10: "10+ глав",
    filter_30: "30+ глав",
    filter_recent: "Недавно обновлено",
    sort_latest: "Последние обновления",
    sort_alpha: "Алфавит",
    prev: "◀ Пред.",
    next: "След. ▶",
    back_chapters: "К главам",
    admin_select: "Выберите манхву.",
    admin_status: "Статус",
    admin_genres: "Жанры",
    admin_select_chapter: "Выберите главу.",
    admin_saved: "Страницы сохранены.",
    admin_api_error: "API недоступен.",
    admin_upload_empty: "Выберите файлы.",
    admin_bot_only: "Только через Telegram Mini App.",
    admin_sent: "Запрос отправлен боту.",
    admin_details: "Детали",
    admin_upload: "Загрузка",
  },
};

function getLang() {
  return localStorage.getItem(LANG_KEY) || "uz";
}

function setLang(lang) {
  localStorage.setItem(LANG_KEY, lang);
  applyLang();
}

function t(key) {
  const lang = getLang();
  return STRINGS[lang][key] || key;
}

function applyLang() {
  const lang = getLang();
  document.documentElement.lang = lang;
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lang === lang);
  });
  const brandText = document.getElementById("brandText");
  if (brandText) brandText.textContent = t("brand");
  const libraryTitle = document.getElementById("libraryTitle");
  if (libraryTitle) libraryTitle.textContent = t("library");
  const chaptersTitle = document.getElementById("chaptersTitle");
  if (chaptersTitle) chaptersTitle.textContent = t("chapters");
  const adminLibraryTitle = document.getElementById("adminLibraryTitle");
  if (adminLibraryTitle) adminLibraryTitle.textContent = t("library");
  const adminDetailsTitle = document.getElementById("adminDetailsTitle");
  if (adminDetailsTitle) adminDetailsTitle.textContent = t("admin_details");
  const adminChaptersTitle = document.getElementById("adminChaptersTitle");
  if (adminChaptersTitle) adminChaptersTitle.textContent = t("chapters");
  const adminPagesTitle = document.getElementById("adminPagesTitle");
  if (adminPagesTitle) adminPagesTitle.textContent = t("pages");
  const adminUploadTitle = document.getElementById("adminUploadTitle");
  if (adminUploadTitle) adminUploadTitle.textContent = t("admin_upload");
  const backLink = document.getElementById("backLink");
  if (backLink) backLink.textContent = t("back");
  const searchInput = document.getElementById("searchInput");
  if (searchInput) searchInput.placeholder = t("search");
  const filterLabel = document.getElementById("filterLabel");
  if (filterLabel) filterLabel.textContent = t("filter");
  const sortLabel = document.getElementById("sortLabel");
  if (sortLabel) sortLabel.textContent = t("sort");
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.dataset.i18n;
    if (key) node.textContent = t(key);
  });
  const prevBtn = document.getElementById("prevChapter");
  if (prevBtn) prevBtn.textContent = t("prev");
  const nextBtn = document.getElementById("nextChapter");
  if (nextBtn) nextBtn.textContent = t("next");
  const listBtn = document.getElementById("chapterListBtn");
  if (listBtn) listBtn.textContent = t("back_chapters");
  window.dispatchEvent(new Event("langChanged"));
}

document.addEventListener("click", (event) => {
  const btn = event.target.closest(".lang-btn");
  if (!btn) return;
  setLang(btn.dataset.lang);
});

document.addEventListener("DOMContentLoaded", applyLang);

