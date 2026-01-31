/**
 * AZURA APP - Complete System
 * Barcha sahifalar uchun to'liq funksional
 */

// ============================================
// GLOBAL STATE
// ============================================

let manhwasData = [];
let currentSliderIndex = 0;
const MANHWA_URL = "/manhwa.json";
function getManhwaUrl() {
    return `${MANHWA_URL}?t=${Date.now()}`;
}
// sliderInterval removed - auto-scroll disabled for now
// let sliderInterval = null;

/**
 * Haptic Feedback Utility - Professional mobile experience
 * Provides tactile feedback for user interactions
 */
function hapticFeedback(type = 'light') {
    try {
        if ('vibrate' in navigator) {
            const patterns = {
                light: 10,      // Light tap
                medium: 20,     // Medium tap
                heavy: 30,      // Heavy tap
                success: [10, 50, 10],  // Success pattern
                error: [20, 50, 20, 50, 20],  // Error pattern
                selection: 5    // Selection change
            };
            
            const pattern = patterns[type] || patterns.light;
            navigator.vibrate(pattern);
        }
    } catch (err) {
        // Silently fail - haptic feedback is optional
    }
}

// Google OAuth Client ID
// Set via window.GOOGLE_CLIENT_ID in HTML or environment variable
// For Netlify: Set in Environment Variables in dashboard
// CRITICAL: Safe access - don't fail if window not ready
let GOOGLE_CLIENT_ID = '';
try {
    GOOGLE_CLIENT_ID = (typeof window !== 'undefined' && window.GOOGLE_CLIENT_ID) ? window.GOOGLE_CLIENT_ID : '';
} catch (err) {
    // Ignore - OAuth is optional
    GOOGLE_CLIENT_ID = '';
}

// Channels data
const channelsData = [
    { 
        name: 'KuroKami', 
        logo: 'assets/channels/kurokami.png',
        link: 'https://t.me/kuro_kam1',
        description: 'Premium manhwa tarjimalari'
    },
    { 
        name: 'Hani Manga', 
        logo: 'assets/channels/hani-manga.png',
        link: 'https://t.me/Hani_uz',
        description: 'Qorong\'u fantaziya janri'
    },
    { 
        name: 'WebMan', 
        logo: 'assets/channels/webman.png',
        link: 'https://t.me/WebMan_olami',
        description: 'Keng manhwa katalogi'
    }
];

// ============================================
// RATING SYSTEM - 5 STAR RATING
// ============================================

/**
 * Get rating data for a manhwa from localStorage
 */
function getManhwaRating(manhwaId) {
    // CRITICAL: Null check - return null if manhwaId is invalid
    if (!manhwaId || typeof manhwaId !== 'string') {
        return null;
    }
    
    try {
        const ratingsStr = localStorage.getItem('azura_ratings');
        if (!ratingsStr) return null;
        
        const ratings = JSON.parse(ratingsStr);
        return ratings[manhwaId] || null;
    } catch (err) {
        console.warn('[RATING] Error reading ratings:', err);
        return null;
    }
}

/**
 * Save rating for a manhwa
 */
function saveManhwaRating(manhwaId, rating) {
    if (!manhwaId || rating < 1 || rating > 5) {
        console.warn('[RATING] Invalid rating:', { manhwaId, rating });
        return false;
    }
    
    try {
        const ratingsStr = localStorage.getItem('azura_ratings') || '{}';
        const ratings = JSON.parse(ratingsStr);
        
        // Get existing rating data
        const existing = ratings[manhwaId] || { totalRating: 0, ratingCount: 0, userRating: 0 };
        
        // If user already rated, subtract old rating
        if (existing.userRating > 0) {
            existing.totalRating -= existing.userRating;
            existing.ratingCount -= 1;
        }
        
        // Add new rating
        existing.totalRating += rating;
        existing.ratingCount += 1;
        existing.userRating = rating;
        
        ratings[manhwaId] = existing;
        localStorage.setItem('azura_ratings', JSON.stringify(ratings));
        
        console.log('[RATING] Saved rating:', { manhwaId, rating, avg: existing.totalRating / existing.ratingCount });
        return true;
    } catch (err) {
        console.error('[RATING] Error saving rating:', err);
        return false;
    }
}

/**
 * Calculate average rating
 */
function calculateAverageRating(manhwaId) {
    // CRITICAL: Null check - return null if manhwaId is invalid
    if (!manhwaId || typeof manhwaId !== 'string') {
        return null;
    }
    
    try {
        const ratingData = getManhwaRating(manhwaId);
        if (!ratingData || !ratingData.ratingCount || ratingData.ratingCount === 0) {
            return null;
        }
        
        if (typeof ratingData.totalRating !== 'number' || typeof ratingData.ratingCount !== 'number') {
            return null;
        }
        
        const avg = ratingData.totalRating / ratingData.ratingCount;
        if (isNaN(avg) || !isFinite(avg)) {
            return null;
        }
        
        return parseFloat(avg.toFixed(1)); // 1 decimal place
    } catch (err) {
        console.warn('[RATING] Error calculating average:', err);
        return null;
    }
}

/**
 * Get user's rating for a manhwa
 */
function getUserRating(manhwaId) {
    const ratingData = getManhwaRating(manhwaId);
    return ratingData?.userRating || 0;
}

/**
 * Format rating display (e.g., "4.3" or "4.0")
 */
function formatRating(rating) {
    if (rating === null || rating === undefined || isNaN(rating)) {
        return '0.0';
    }
    try {
        const num = parseFloat(rating);
        if (isNaN(num) || !isFinite(num)) {
            return '0.0';
        }
        return num.toFixed(1);
    } catch (err) {
        return '0.0';
    }
}

/**
 * Create star rating display (non-interactive)
 */
function createStarDisplay(rating, size = 'small') {
    const container = document.createElement('span');
    container.className = `star-rating-display star-rating-${size}`;
    
    let starsHTML = '';
    
    if (rating === null || rating === 0 || isNaN(rating)) {
        // Show 5 empty stars for no rating
        for (let i = 0; i < 5; i++) {
            starsHTML += '<span class="star-empty">⭐</span>';
        }
        starsHTML += '<span class="rating-text">0.0</span>';
    } else {
        // Clamp rating to 0-5
        const clampedRating = Math.min(5, Math.max(0, rating));
        const fullStars = Math.floor(clampedRating);
        const hasHalfStar = (clampedRating % 1) >= 0.5 && fullStars < 5;
        
        // Full stars
        for (let i = 0; i < fullStars; i++) {
            starsHTML += '<span class="star-filled">⭐</span>';
        }
        
        // Half star (if needed)
        if (hasHalfStar) {
            starsHTML += '<span class="star-half">⭐</span>';
        }
        
        // Empty stars to complete 5
        const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
        for (let i = 0; i < emptyStars; i++) {
            starsHTML += '<span class="star-empty">⭐</span>';
        }
        
        starsHTML += `<span class="rating-text">${formatRating(clampedRating)}</span>`;
    }
    
    container.innerHTML = starsHTML;
    return container;
}

/**
 * Create interactive 5-star rating component
 */
function createInteractiveStarRating(manhwaId, currentRating = 0) {
    const container = document.createElement('div');
    container.className = 'interactive-star-rating';
    container.dataset.manhwaId = manhwaId;
    
    const starsContainer = document.createElement('div');
    starsContainer.className = 'stars-container';
    
    // Create 5 stars
    for (let i = 1; i <= 5; i++) {
        const star = document.createElement('button');
        star.className = 'star-btn';
        star.dataset.rating = i;
        star.type = 'button';
        star.setAttribute('aria-label', `${i} yulduz`);
        
        if (i <= currentRating) {
            star.classList.add('active');
        }
        
        star.innerHTML = '⭐';
        
        // Hover effect
        star.addEventListener('mouseenter', () => {
            highlightStars(starsContainer, i);
        });
        
        star.addEventListener('mouseleave', () => {
            highlightStars(starsContainer, currentRating);
        });
        
        // Click to rate
        star.addEventListener('click', () => {
            const rating = parseInt(star.dataset.rating);
            saveManhwaRating(manhwaId, rating);
            currentRating = rating;
            highlightStars(starsContainer, rating);
            
            // Update rating display if it exists
            updateRatingDisplay(manhwaId);
        });
        
        starsContainer.appendChild(star);
    }
    
    container.appendChild(starsContainer);
    
    // Rating info display
    const infoContainer = document.createElement('div');
    infoContainer.className = 'rating-info';
    const avgRating = calculateAverageRating(manhwaId);
    const ratingData = getManhwaRating(manhwaId);
    const count = ratingData?.ratingCount || 0;
    
    infoContainer.innerHTML = `
        <span class="rating-avg">${formatRating(avgRating !== null ? avgRating : 0)}</span>
        <span class="rating-count">(${count} ${count === 1 ? 'ovoz' : 'ovoz'})</span>
    `;
    
    container.appendChild(infoContainer);
    
    return container;
}

/**
 * Highlight stars up to a certain rating
 */
function highlightStars(container, rating) {
    const stars = container.querySelectorAll('.star-btn');
    stars.forEach((star, index) => {
        if (index + 1 <= rating) {
            star.classList.add('active');
        } else {
            star.classList.remove('active');
        }
    });
}

/**
 * Update rating display after rating change
 * CRITICAL: Only works on manhwa detail page, safe guards included
 */
function updateRatingDisplay(manhwaId) {
    // CRITICAL: Guard - only update if on manhwa detail page
    const pageType = getPageType();
    if (pageType !== 'manhwa') {
        return;
    }
    
    // CRITICAL: Null check
    if (!manhwaId || typeof manhwaId !== 'string') {
        return;
    }
    
    try {
        // Update detail page rating display
        const detailRatingEl = document.querySelector('#detail-rating .rating-value');
        if (detailRatingEl) {
            const avgRating = calculateAverageRating(manhwaId);
            const ratingData = getManhwaRating(manhwaId);
            const count = ratingData?.ratingCount || 0;
            
            if (avgRating !== null && avgRating > 0) {
                detailRatingEl.textContent = `${formatRating(avgRating)} (${count} ${count === 1 ? 'ovoz' : 'ovoz'})`;
            } else {
                detailRatingEl.textContent = '0.0 (0 ovoz)';
            }
        }
        
        // Update stars display in detail page
        const starsEl = document.querySelector('#detail-rating .stars');
        if (starsEl) {
            const avgRating = calculateAverageRating(manhwaId);
            const starDisplay = createStarDisplay(avgRating !== null ? avgRating : 0, 'medium');
            if (starDisplay) {
                starsEl.innerHTML = starDisplay.innerHTML;
            }
        }
        
        // Update interactive rating component info
        const interactiveRating = document.querySelector(`.interactive-star-rating[data-manhwa-id="${manhwaId}"]`);
        if (interactiveRating) {
            const infoContainer = interactiveRating.querySelector('.rating-info');
            if (infoContainer) {
                const avgRating = calculateAverageRating(manhwaId);
                const ratingData = getManhwaRating(manhwaId);
                const count = ratingData?.ratingCount || 0;
                
                infoContainer.innerHTML = `
                    <span class="rating-avg">${formatRating(avgRating !== null ? avgRating : 0)}</span>
                    <span class="rating-count">(${count} ${count === 1 ? 'ovoz' : 'ovoz'})</span>
                `;
            }
            
            // Update active stars based on user's new rating
            const userRating = getUserRating(manhwaId);
            const starsContainer = interactiveRating.querySelector('.stars-container');
            if (starsContainer) {
                highlightStars(starsContainer, userRating);
            }
        }
    } catch (err) {
        console.warn('[RATING] Error updating rating display:', err);
    }
}

/**
 * Update favorite button state
 */
function updateFavoriteButton(manhwaId) {
    const favoriteBtn = document.getElementById('favorite-btn');
    if (favoriteBtn && manhwaId) {
        const isFav = isFavorite(manhwaId);
        favoriteBtn.classList.toggle('active', isFav);
    }
}

// ============================================
// DATA LOADING
// ============================================

// CRITICAL: Make loadData globally accessible
async function loadData() {
    // CRITICAL: NO AUTH CHECK - Data loading mustaqil
    console.log('[DATA] ========== loadData() CHAQIRILDI ==========');
    console.log('[DATA] Current manhwasData.length:', manhwasData.length);
    
    // If data already loaded, still re-render while fetching fresh data
    const wasDataLoaded = manhwasData.length > 0;
    if (wasDataLoaded) {
        console.log('[DATA] Data allaqachon yuklangan, lekin render qilishni tekshiramiz...');
        // CRITICAL: Always trigger re-render if on index page
        const pageType = getPageType();
        if (pageType === 'index') {
            const carousel = document.getElementById('new-carousel');
            const homePage = document.getElementById('home-page');
            const isHomePageActive = homePage && homePage.classList.contains('active') && 
                                     homePage.style.display !== 'none' && 
                                     !homePage.hasAttribute('data-hidden');
            
            if (isHomePageActive && carousel) {
                const hasContent = carousel.querySelectorAll('.epic-manhwa-card, .manhwa-card').length > 0;
                console.log('[DATA] Carousel has content:', hasContent);
                if (!hasContent) {
                    console.log('[DATA] Data mavjud lekin sahifa render qilinmagan, qayta render qilish...');
                    // Reset flags and re-render
                    carousel.dataset.rendered = 'false';
                    carousel.innerHTML = '';
                    const slider = document.getElementById('hero-slider');
                    const grid = document.getElementById('manhwa-grid');
                    if (slider) slider.dataset.rendered = 'false';
                    if (grid) grid.dataset.rendered = 'false';
                    setTimeout(() => {
                        console.log('[DATA] Calling renderIndexPage() and renderNewlyAdded()...');
                        renderIndexPage();
                        renderNewlyAdded();
                    }, 100);
                } else {
                    console.log('[DATA] Carousel allaqachon render qilingan');
                }
            }
        }
    }
    
    const fetchUrl = getManhwaUrl();
    try {
        console.log(`[DATA] Fetching ${fetchUrl}...`);
        const response = await fetch(fetchUrl, {
            cache: 'no-store',
            headers: {
                'Accept': 'application/json'
            }
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: Data yuklanmadi`);
        }
        const data = await response.json();
        console.log('[DATA] JSON parsed, data type:', Array.isArray(data) ? 'Array' : typeof data, ', length:', Array.isArray(data) ? data.length : 'N/A');
        
        if (Array.isArray(data)) {
            manhwasData = data;
            console.log(`[DATA] ✅ ${manhwasData.length} manhwa yuklandi`);
            
            // CRITICAL: Data yuklangandan keyin sahifalarni qayta render qilish
            const pageType = getPageType();
            console.log('[DATA] Page type detected:', pageType);
            
            if (pageType === 'index') {
                // Re-render index page now that data is loaded
                const slider = document.getElementById('hero-slider');
                const carousel = document.getElementById('new-carousel');
                const grid = document.getElementById('manhwa-grid');
                const homePage = document.getElementById('home-page');
                
                console.log('[DATA] Resetting render flags...');
                if (slider) {
                    slider.dataset.rendered = 'false';
                    slider.innerHTML = '';
                }
                if (carousel) {
                    carousel.dataset.rendered = 'false';
                    carousel.innerHTML = '';
                }
                if (grid) {
                    grid.dataset.rendered = 'false';
                    grid.innerHTML = '';
                }
                
                // CRITICAL: Always render if home-page is active
                const isHomePageActive = homePage && homePage.classList.contains('active') && 
                                         homePage.style.display !== 'none' && 
                                         !homePage.hasAttribute('data-hidden');
                
                console.log('[DATA] Home page active:', isHomePageActive);
                if (isHomePageActive) {
                    console.log('[DATA] ✅ Re-rendering index page with loaded data...');
                    // Use setTimeout for immediate render
                    setTimeout(() => {
                        try {
                            renderIndexPage();
                            // CRITICAL: Also directly call renderNewlyAdded
                            setTimeout(() => {
                                renderNewlyAdded();
                            }, 100);
                            console.log('[DATA] ✅ Index page re-rendered');
                        } catch (err) {
                            console.error('[DATA] ❌ Error re-rendering:', err);
                        }
                    }, 50);
                }
            } else if (pageType === 'search') {
                // Re-render search page genre cards with loaded data
                console.log('[DATA] Data yuklandi, search sahifa genre kartalarini qayta render qilish');
                try {
                    renderGenreCards();
                } catch (err) {
                    console.error('[DATA] Error re-rendering genre cards:', err);
                }
            }
        } else {
            console.error('[ERROR] JSON array emas, format noto\'g\'ri');
            manhwasData = [];
        }
    } catch (error) {
        console.error('[ERROR] ❌ Data yuklash xatosi:', error);
        console.error('[ERROR] Error details:', error.message, error.stack);
        console.error('[ERROR] Error type:', error.name);
        console.error('[ERROR] Fetch URL attempted:', fetchUrl);
        manhwasData = [];
        
        // CRITICAL: Data yuklanmagan bo'lsa ham, kanallar render qilish (hardcoded data)
        const pageType = getPageType();
        if (pageType === 'index') {
            try {
                // Kanallar har doim render bo'lishi kerak (hardcoded data)
                // Channels section removed - no longer needed
                // renderChannels();
                
                // Show informative error state
                const slider = document.getElementById('hero-slider');
                const carousel = document.getElementById('new-carousel');
                const grid = document.getElementById('manhwa-grid');
                
                if (slider && (!slider.innerHTML || slider.innerHTML.trim() === '' || slider.innerHTML.includes('Yuklanmoqda'))) {
                    slider.innerHTML = '<div class="empty-state" style="padding: 60px 20px; text-align: center; color: var(--text-secondary);">Ma\'lumotlar yuklanmadi<br><small style="opacity: 0.7; margin-top: 10px; display: block;">Sahifani yangilang (F5)</small></div>';
                }
                if (carousel && (!carousel.innerHTML || carousel.innerHTML.trim() === '' || carousel.innerHTML.includes('Yuklanmoqda'))) {
                    carousel.innerHTML = '<div class="empty-state" style="padding: 40px 20px; text-align: center; color: var(--text-secondary); min-width: 200px;">Ma\'lumotlar yuklanmadi<br><small style="opacity: 0.7; margin-top: 8px; display: block;">Sahifani yangilang</small></div>';
                }
                    if (grid && (!grid.innerHTML || grid.innerHTML.trim() === '' || grid.innerHTML.includes('Yuklanmoqda'))) {
                    grid.innerHTML = '<div class="empty-state" style="padding: 60px 20px; text-align: center; color: var(--text-secondary); grid-column: 1 / -1;">Ma\'lumotlar yuklanmadi<br><small style="opacity: 0.7; margin-top: 10px; display: block;">Sahifani yangilang (F5)</small></div>';
                }
                
                // Render recent comments on homepage (non-blocking)
                try {
                    // renderRecentComments(); // REMOVED - no longer needed on homepage
                } catch (commentErr) {
                    console.warn('[COMMENT] Error rendering recent comments on homepage:', commentErr);
                }
            } catch (renderErr) {
                console.error('[ERROR] Error state render failed:', renderErr);
            }
        }
        
        // CRITICAL: Retry data loading after delay
        console.log('[DATA] Data yuklash muvaffaqiyatsiz, 2 soniyadan keyin qayta urinib ko\'rish...');
        setTimeout(() => {
            try {
                loadData().then(() => {
                    console.log('[DATA] Retry successful, data loaded');
                    // Only render if home-page is currently active
                    const homePage = document.getElementById('home-page');
                    const isHomePageActive = homePage && 
                                             homePage.classList.contains('active') && 
                                             homePage.style.display !== 'none' && 
                                             !homePage.hasAttribute('data-hidden');
                    
                    if (isHomePageActive) {
                        renderIndexPage();
                        console.log('[DATA] Index page re-rendered after retry (home-page is active)');
                    } else {
                        console.log('[DATA] Skipping index page render after retry - home-page is not active');
                    }
                }).catch(retryErr => {
                    console.error('[DATA] Retry also failed:', retryErr);
                });
            } catch (retryErr) {
                console.error('[DATA] Retry attempt error:', retryErr);
            }
        }, 2000);
    }
}

// ============================================
// UTILITIES
// ============================================

function getPageType() {
    // DOM FAIL-SAFE: Never throw, always return a valid page type
    try {
        // CRITICAL: First check active page (for SPA navigation within index.html)
        // This is the most reliable indicator for SPA pages
        if (document && document.body) {
            try {
                const activePage = document.querySelector('.page.active');
                if (activePage && activePage.id) {
                    const pageId = activePage.id;
                    if (pageId === 'search-page') {
                        console.log('[PAGE TYPE] ✅ Active page: search-page');
                        return 'search';
                    }
                    if (pageId === 'channels-page') {
                        console.log('[PAGE TYPE] ✅ Active page: channels-page');
                        return 'channels';
                    }
                    if (pageId === 'history-page') {
                        console.log('[PAGE TYPE] ✅ Active page: history-page');
                        return 'history';
                    }
                    if (pageId === 'detail-page') {
                        console.log('[PAGE TYPE] ✅ Active page: detail-page');
                        return 'manhwa';
                    }
                    if (pageId === 'reader-page') {
                        console.log('[PAGE TYPE] ✅ Active page: reader-page');
                        return 'reader';
                    }
                    if (pageId === 'home-page') {
                        console.log('[PAGE TYPE] ✅ Active page: home-page');
                        return 'index';
                    }
                }
            } catch (activeErr) {
                console.warn('[PAGE TYPE] Error checking active page:', activeErr);
            }
            
            // Check body data-page attribute
            try {
                const body = document.body;
                if (body) {
                    const pageType = body.getAttribute('data-page');
                    if (pageType) {
                        console.log('[PAGE TYPE] Using body data-page:', pageType);
                        return pageType;
                    }
                }
            } catch (dataPageErr) {
                console.warn('[PAGE TYPE] Error checking data-page:', dataPageErr);
            }
        }
        
        // Fallback: Check URL pathname
        const path = window.location?.pathname || '';
        const pathname = path.toLowerCase();
        
        if (pathname.includes('search.html')) return 'search';
        if (pathname.includes('manhwa.html')) return 'manhwa';
        if (pathname.includes('auth.html')) return 'auth';
        if (pathname.includes('register.html')) return 'register';
        if (pathname.includes('profile.html')) return 'profile';
        if (pathname === '/index.html' || pathname === '/index' || pathname === '/' || pathname.endsWith('/index.html')) {
            return 'index';
        }
        
        // Ultimate fallback: return 'index'
        return 'index';
    } catch (err) {
        console.error('[PAGE TYPE] Error determining page type:', err);
        return 'index'; // Always fallback to index
    }
}

function createManhwaCard(manhwa) {
    // DOM FAIL-SAFE: Never throw, always return valid card (even if empty)
    try {
        // Validate input
        if (!manhwa || typeof manhwa !== 'object') {
            console.warn('[CARD] Invalid manhwa object:', manhwa);
            // Return minimal card instead of null
            const fallbackCard = document.createElement('div');
            fallbackCard.className = 'epic-manhwa-card manhwa-card';
            fallbackCard.innerHTML = '<div class="empty-state">Manhwa ma\'lumoti topilmadi</div>';
            return fallbackCard;
        }
        
        // EPIC SOLO LEVELING STYLE - Unified for index, search, and carousel
        // Cover as background-image, dark gradient overlay, epic title
        // 100% identical design across all pages
        
        const card = document.createElement('div');
        card.className = 'epic-manhwa-card manhwa-card'; // Both classes for compatibility
        
        // Cover as background-image - EPIC STYLE (with error handling)
        try {
            const coverUrl = manhwa.cover || 'assets/logo.svg';
            card.style.backgroundImage = `url('${coverUrl}')`;
            card.style.backgroundSize = 'cover';
            card.style.backgroundPosition = 'center center';
            card.style.backgroundRepeat = 'no-repeat';
            card.style.backgroundColor = 'var(--bg-tertiary)';
            
            // Handle image error - test if image exists (non-blocking)
            try {
                const testImg = new Image();
                testImg.onerror = function() {
                    try {
                        if (card && card.style) {
                            card.style.backgroundImage = 'url("assets/logo.svg")';
                            card.style.backgroundColor = 'var(--bg-tertiary)';
                        }
                    } catch (err) {
                        // Ignore style errors
                    }
                };
                testImg.src = coverUrl;
            } catch (imgErr) {
                // Ignore image test errors
            }
        } catch (styleErr) {
            console.warn('[CARD] Error setting card styles:', styleErr);
            card.style.backgroundColor = 'var(--bg-tertiary)';
        }
        
        // Dark gradient overlay at bottom
        const overlay = document.createElement('div');
        overlay.className = 'epic-card-overlay';
        
        // Content container
        const content = document.createElement('div');
        content.className = 'epic-card-content';
        
        // Top row: Rating and Views (with error handling)
        try {
            const metaRow = document.createElement('div');
            metaRow.className = 'epic-card-meta';
            
            // Rating - use calculated average rating from localStorage
            // CRITICAL: Rating calculation must NEVER block card rendering
            const rating = document.createElement('div');
            rating.className = 'epic-card-rating';
            try {
                const manhwaId = manhwa.id || manhwa.slug || '';
                if (manhwaId && typeof manhwaId === 'string' && manhwaId.length > 0) {
                    try {
                        const avgRating = calculateAverageRating(manhwaId);
                        const ratingValue = avgRating !== null && avgRating > 0 ? avgRating : (manhwa.rating || 0);
                        if (ratingValue > 0 && !isNaN(ratingValue) && isFinite(ratingValue)) {
                            rating.innerHTML = `⭐ ${parseFloat(ratingValue).toFixed(1)}`;
                        } else {
                            rating.innerHTML = '⭐ —';
                        }
                    } catch (calcErr) {
                        // Rating calculation failed - show default or manhwa.rating
                        const ratingValue = manhwa.rating || 0;
                        if (ratingValue > 0 && !isNaN(ratingValue)) {
                            rating.innerHTML = `⭐ ${parseFloat(ratingValue).toFixed(1)}`;
                        } else {
                            rating.innerHTML = '⭐ —';
                        }
                    }
                } else {
                    // No manhwa ID - use default rating from data
                    const ratingValue = manhwa.rating || 0;
                    if (ratingValue > 0 && !isNaN(ratingValue)) {
                        rating.innerHTML = `⭐ ${parseFloat(ratingValue).toFixed(1)}`;
                    } else {
                        rating.innerHTML = '⭐ —';
                    }
                }
            } catch (ratingErr) {
                // Complete fallback - always show something
                rating.innerHTML = '⭐ —';
            }
            
            // Views
            const views = document.createElement('div');
            views.className = 'epic-card-views';
            try {
                const viewsValue = manhwa.views || 0;
                views.innerHTML = `👁 ${viewsValue > 0 ? viewsValue.toLocaleString() : '0'}`;
            } catch (viewsErr) {
                views.innerHTML = '👁 0';
            }
            
            metaRow.appendChild(rating);
            metaRow.appendChild(views);
            content.appendChild(metaRow);
        } catch (metaErr) {
            console.warn('[CARD] Error creating meta row:', metaErr);
        }
        
        // Genres (pills/chips style) - with error handling
        try {
            const genresContainer = document.createElement('div');
            genresContainer.className = 'epic-card-genres';
            
            if (Array.isArray(manhwa.genres) && manhwa.genres.length > 0) {
                // Show first 2-3 genres max
                const displayGenres = manhwa.genres.slice(0, 3);
                displayGenres.forEach(genre => {
                    try {
                        if (genre && typeof genre === 'string') {
                            const genrePill = document.createElement('span');
                            genrePill.className = 'epic-genre-pill';
                            genrePill.textContent = genre;
                            genresContainer.appendChild(genrePill);
                        }
                    } catch (err) {
                        // Skip invalid genres
                    }
                });
            }
            
            if (genresContainer.children.length > 0) {
                content.appendChild(genresContainer);
            }
        } catch (genresErr) {
            console.warn('[CARD] Error creating genres:', genresErr);
        }
        
        // Title - EPIC STYLE at bottom
        try {
            const title = document.createElement('h3');
            title.className = 'epic-card-title';
            title.textContent = manhwa.title || 'Noma\'lum';
            content.appendChild(title);
        } catch (titleErr) {
            console.warn('[CARD] Error creating title:', titleErr);
        }
        
        overlay.appendChild(content);
        card.appendChild(overlay);
        
        // Click handler - FAIL-SAFE
        try {
            card.addEventListener('click', () => {
                try {
                    const manhwaId = manhwa?.id || manhwa?.slug || '';
                    if (manhwaId) {
                        // Add to history before navigation (non-blocking)
                        try {
                            addToHistory(manhwaId);
                        } catch (err) {
                            console.warn('[CARD] Error adding to history:', err);
                            // Continue navigation even if history fails
                        }
                        
                        // Navigate (always works)
                        window.location.href = `manhwa.html?id=${manhwaId}`;
                    }
                } catch (err) {
                    console.error('[CARD] Error in card click handler:', err);
                    // Don't block - try navigation anyway if manhwa exists
                    try {
                        const manhwaId = manhwa?.id || manhwa?.slug || '';
                        if (manhwaId) {
                            window.location.href = `manhwa.html?id=${manhwaId}`;
                        }
                    } catch (navErr) {
                        console.error('[CARD] Navigation also failed:', navErr);
                    }
                }
            });
        } catch (handlerErr) {
            console.warn('[CARD] Error adding click handler:', handlerErr);
        }
        
        // CRITICAL: Always return card, even if there were errors
        console.log('[CARD] Card created successfully for:', manhwa.title || manhwa.id || 'Noma\'lum');
        return card;
    } catch (err) {
        console.error('[CARD] Critical error in createManhwaCard:', err);
        // Return minimal fallback card instead of null
        const fallbackCard = document.createElement('div');
        fallbackCard.className = 'epic-manhwa-card manhwa-card';
        fallbackCard.style.backgroundColor = 'var(--bg-tertiary)';
        fallbackCard.innerHTML = '<div class="empty-state">Xatolik</div>';
        return fallbackCard;
    }
}

// ============================================
// INDEX PAGE - COMPLETE
// ============================================

function getTop5Manhwas() {
    // DATA FAIL-SAFE: Never throw, always return array
    try {
        if (!manhwasData || !Array.isArray(manhwasData) || manhwasData.length === 0) {
            return [];
        }
        
        // RATING ASOSIDA SORT - 5 yulduzli rating tizimidan foydalanamiz
        const sorted = [...manhwasData].filter(m => m && typeof m === 'object').sort((a, b) => {
            try {
                const manhwaIdA = a?.id || a?.slug || '';
                const manhwaIdB = b?.id || b?.slug || '';
                
                // Calculate average rating from localStorage rating system (safe)
                let avgRatingA = null;
                let avgRatingB = null;
                
                try {
                    avgRatingA = manhwaIdA ? calculateAverageRating(manhwaIdA) : null;
                } catch (err) {
                    // Ignore rating errors
                }
                
                try {
                    avgRatingB = manhwaIdB ? calculateAverageRating(manhwaIdB) : null;
                } catch (err) {
                    // Ignore rating errors
                }
                
                // Convert null to 0 for sorting (ratings with no votes go to bottom)
                const ratingValueA = avgRatingA !== null && avgRatingA > 0 ? avgRatingA : 0;
                const ratingValueB = avgRatingB !== null && avgRatingB > 0 ? avgRatingB : 0;
                
                // Sort by rating (descending) - highest rated first
                if (ratingValueA !== ratingValueB) {
                    return ratingValueB - ratingValueA;
                }
                
                // If ratings are equal, use views as secondary sort
                const viewsA = a?.views || 0;
                const viewsB = b?.views || 0;
                return viewsB - viewsA;
            } catch (err) {
                console.warn('[TOP5] Error sorting manhwa:', err);
                return 0; // Keep original order on error
            }
        });
        
        return sorted.slice(0, 5);
    } catch (err) {
        console.error('[TOP5] Critical error in getTop5Manhwas:', err);
        return []; // Always return array, never null
    }
}

function renderTop5Slider() {
    // DOM FAIL-SAFE: Never throw, always handle gracefully
    try {
        // CRITICAL: Guard - only on index page, NO AUTH CHECK
        const pageType = getPageType();
        if (pageType !== 'index') {
            return;
        }
        
        const slider = document.getElementById('hero-slider');
        const dots = document.getElementById('hero-dots');
        
        // CRITICAL: If elements not found, skip silently - don't block other renders
        if (!slider || !dots) {
            console.warn('[RENDER] Top 5 slider elements not found, skipping');
            return;
        }
        
        // DATA FAIL-SAFE: Check if data is loaded
        // CRITICAL: Agar data yo'q bo'lsa ham, kamida placeholder ko'rsatish
        if (!manhwasData || !Array.isArray(manhwasData) || manhwasData.length === 0) {
            console.warn('[RENDER] Top 5 slider: data yuklanmagan - placeholder ko\'rsatilmoqda');
            slider.innerHTML = '<div class="empty-state" style="padding: 60px 20px; text-align: center; color: var(--text-secondary); font-size: 0.9rem;">Ma\'lumotlar yuklanmoqda...<br><small style="opacity: 0.7; margin-top: 10px; display: block;">Iltimos, biroz kuting</small></div>';
            // CRITICAL: Data yuklanmasa ham, qayta urinib ko'rish (retry mechanism)
            setTimeout(() => {
                try {
                    if (manhwasData && Array.isArray(manhwasData) && manhwasData.length > 0) {
                        console.log('[RENDER] Data endi yuklangan, qayta render qilish...');
                        renderTop5Slider();
                    } else {
                        // Data hali ham yo'q - loadData ni chaqirish
                        loadData().then(() => {
                            if (manhwasData && manhwasData.length > 0) {
                                renderTop5Slider();
                            }
                        }).catch(() => {
                            console.error('[RENDER] Data yuklash muvaffaqiyatsiz');
                        });
                    }
                } catch (retryErr) {
                    console.error('[RENDER] Retry error:', retryErr);
                }
            }, 500);
            return;
        }
        
        // CRITICAL: Guard - prevent duplicate initialization ONLY if already rendered with data
        if (slider.dataset.rendered === 'true') {
            const existingSlides = slider.querySelectorAll('.hero-slide');
            if (existingSlides.length > 0) {
                console.log('[RENDER] Top 5 slider allaqachon render qilingan, skipping');
                return;
            }
        }
        
        slider.dataset.rendered = 'true';
        
        const top5 = getTop5Manhwas();
        
        if (!top5 || top5.length === 0) {
            console.warn('[RENDER] Top 5 bo\'sh - data yuklanmagan yoki manhwalar topilmadi');
            slider.innerHTML = '<div class="empty-state" style="padding: 60px 20px; text-align: center; color: var(--text-secondary); font-size: 0.9rem;">Top manhwalar topilmadi<br><small style="opacity: 0.7; margin-top: 10px; display: block;">Ma\'lumotlar yuklanmaguncha kuting</small></div>';
            // Retry after delay
            setTimeout(() => {
                if (manhwasData && manhwasData.length > 0) {
                    renderTop5Slider();
                }
            }, 1000);
            return;
        }
        
        // Clear existing
        slider.innerHTML = '';
        if (dots) dots.innerHTML = '';
        
        // Render slides (with validation)
        top5.forEach((manhwa, index) => {
            try {
                if (!manhwa || typeof manhwa !== 'object') {
                    console.warn(`[RENDER] Invalid manhwa in top5 at index ${index}`);
                    return;
                }
                
                const slide = document.createElement('div');
                slide.className = 'hero-slide';
                if (index === 0) slide.classList.add('active');
                
                const bg = document.createElement('div');
                bg.className = 'hero-slide-bg';
                bg.style.backgroundImage = `url(${manhwa.cover || 'assets/logo.svg'})`;
                
                const content = document.createElement('div');
                content.className = 'hero-slide-content';
                
                const rankBadge = document.createElement('div');
                rankBadge.className = 'hero-rank-badge';
                rankBadge.textContent = `#${index + 1}`;
                
                const title = document.createElement('h2');
                title.className = 'hero-title';
                title.textContent = manhwa.title || 'Noma\'lum';
                
                const meta = document.createElement('div');
                meta.className = 'hero-meta';
                
                const rating = document.createElement('div');
                rating.className = 'hero-rating';
                // Use calculated average rating from localStorage rating system (safe)
                // CRITICAL: Rating must NEVER block slider rendering
                try {
                    const manhwaId = manhwa.id || manhwa.slug || '';
                    if (manhwaId && typeof manhwaId === 'string' && manhwaId.length > 0) {
                        try {
                            const avgRating = calculateAverageRating(manhwaId);
                            const ratingValue = avgRating !== null && avgRating > 0 ? avgRating : (manhwa.rating || 0);
                            if (ratingValue > 0 && !isNaN(ratingValue) && isFinite(ratingValue)) {
                                rating.innerHTML = `⭐ ${formatRating(ratingValue)}`;
                            } else {
                                rating.innerHTML = '⭐ —';
                            }
                        } catch (calcErr) {
                            // Rating calculation failed - use default
                            const ratingValue = manhwa.rating || 0;
                            if (ratingValue > 0 && !isNaN(ratingValue)) {
                                rating.innerHTML = `⭐ ${formatRating(ratingValue)}`;
                            } else {
                                rating.innerHTML = '⭐ —';
                            }
                        }
                    } else {
                        const ratingValue = manhwa.rating || 0;
                        if (ratingValue > 0 && !isNaN(ratingValue)) {
                            rating.innerHTML = `⭐ ${formatRating(ratingValue)}`;
                        } else {
                            rating.innerHTML = '⭐ —';
                        }
                    }
                } catch (ratingErr) {
                    // Complete fallback - always show something
                    rating.innerHTML = '⭐ —';
                }
                
                const views = document.createElement('div');
                views.className = 'hero-views';
                try {
                    views.innerHTML = `👁 ${((manhwa.views || 0).toLocaleString())}`;
                } catch (viewsErr) {
                    views.innerHTML = '👁 0';
                }
                
                meta.appendChild(rating);
                meta.appendChild(views);
                
                const ctaBtn = document.createElement('button');
                ctaBtn.className = 'hero-cta-btn';
                ctaBtn.textContent = 'O\'qishni boshlash';
                ctaBtn.addEventListener('click', () => {
                    try {
                        const manhwaId = manhwa.id || manhwa.slug || '';
                        if (manhwaId) {
                            // Add to history before navigation (non-blocking)
                            try {
                                addToHistory(manhwaId);
                            } catch (histErr) {
                                console.warn('[SLIDER] Error adding to history:', histErr);
                            }
                            window.location.href = `manhwa.html?id=${manhwaId}`;
                        }
                    } catch (clickErr) {
                        console.error('[SLIDER] Error in CTA button click:', clickErr);
                    }
                });
                
                content.appendChild(rankBadge);
                content.appendChild(title);
                content.appendChild(meta);
                content.appendChild(ctaBtn);
                
                slide.appendChild(bg);
                slide.appendChild(content);
                if (slider) slider.appendChild(slide);
                
                // Dot
                const dot = document.createElement('button');
                dot.className = 'hero-dot';
                if (index === 0) dot.classList.add('active');
                dot.addEventListener('click', () => {
                    try {
                        goToSlide(index);
                    } catch (dotErr) {
                        console.warn('[SLIDER] Error in dot click:', dotErr);
                    }
                });
                if (dots) dots.appendChild(dot);
            } catch (err) {
                console.warn(`[RENDER] Error rendering slide ${index}:`, err);
            }
        });
        
        // Setup auto-slide functionality (ENABLED)
        try {
            setupSliderAutoSlide();
            console.log('[RENDER] Top 5 slider auto-slide ENABLED');
        } catch (autoSlideErr) {
            console.warn('[RENDER] Auto-slide setup failed (non-critical):', autoSlideErr);
        }
        console.log(`[RENDER] Top 5 slider render qilindi: ${top5.length} ta (with auto-slide)`);
    } catch (err) {
        console.error('[RENDER] Critical error in renderTop5Slider:', err);
        const slider = document.getElementById('hero-slider');
        if (slider) {
            slider.innerHTML = '<div class="empty-state">Slider xatosi</div>';
        }
    }
}

/**
 * Setup slider auto-slide - ENABLED
 * Auto-scroll har 5 soniyada keyingi slide ga o'tadi
 */
function setupSliderAutoSlide() {
    try {
        // CRITICAL: Guard - only on index page
        const pageType = getPageType();
        if (pageType !== 'index') {
            return;
        }
        
        const slider = document.getElementById('hero-slider');
        const dots = document.getElementById('hero-dots');
        
        if (!slider || !dots) {
            console.warn('[SLIDER] Auto-slide: Slider elements not found');
            return;
        }
        
        const slides = slider.querySelectorAll('.hero-slide');
        if (!slides || slides.length === 0) {
            console.warn('[SLIDER] Auto-slide: No slides found');
            return;
        }
        
        // Clear any existing auto-slide interval
        if (window.azuraSliderInterval) {
            clearInterval(window.azuraSliderInterval);
            window.azuraSliderInterval = null;
        }
        
        // Reset to first slide
        currentSliderIndex = 0;
        
        // Auto-slide interval: 5 seconds
        window.azuraSliderInterval = setInterval(() => {
            try {
                // Check if slider still exists and is visible
                if (!document.getElementById('hero-slider')) {
                    clearInterval(window.azuraSliderInterval);
                    window.azuraSliderInterval = null;
                    return;
                }
                
                const currentSlides = document.querySelectorAll('.hero-slide');
                if (!currentSlides || currentSlides.length === 0) {
                    clearInterval(window.azuraSliderInterval);
                    window.azuraSliderInterval = null;
                    return;
                }
                
                // Move to next slide
                currentSliderIndex = (currentSliderIndex + 1) % currentSlides.length;
                goToSlide(currentSliderIndex);
                
                console.log(`[SLIDER] Auto-slide: Moved to slide ${currentSliderIndex + 1}/${currentSlides.length}`);
            } catch (err) {
                console.warn('[SLIDER] Auto-slide interval error:', err);
                // Clear interval on error to prevent infinite errors
                if (window.azuraSliderInterval) {
                    clearInterval(window.azuraSliderInterval);
                    window.azuraSliderInterval = null;
                }
            }
        }, 5000); // 5 seconds interval
        
        console.log('[SLIDER] Auto-slide setup complete - slides will change every 5 seconds');
    } catch (err) {
        console.error('[SLIDER] Auto-slide setup error:', err);
        // Don't throw - auto-slide is non-critical
    }
}

function goToSlide(index) {
    // DOM FAIL-SAFE: Never throw, always handle gracefully
    try {
        // CRITICAL: Guard - check if on index page
        const pageType = getPageType();
        if (pageType !== 'index') {
            return;
        }
        
        // Validate index
        if (typeof index !== 'number' || index < 0 || !isFinite(index)) {
            console.warn('[SLIDER] Invalid slide index:', index);
            return;
        }
        
        const slider = document.getElementById('hero-slider');
        const dots = document.getElementById('hero-dots');
        
        if (!slider || !dots) {
            console.warn('[SLIDER] Slider elements not found');
            return;
        }
        
        // Check if elements are still in DOM
        if (!document.body.contains(slider) || !document.body.contains(dots)) {
            console.warn('[SLIDER] Elements not in DOM');
            return;
        }
        
        const slides = slider.querySelectorAll('.hero-slide');
        const dotButtons = dots.querySelectorAll('.hero-dot');
        
        if (!slides || slides.length === 0) {
            console.warn('[SLIDER] No slides found');
            return;
        }
        
        if (index >= slides.length) {
            console.warn('[SLIDER] Index out of range:', index, 'max:', slides.length - 1);
            return;
        }
        
        currentSliderIndex = index;
        
        slides.forEach((slide, i) => {
            try {
                if (slide && slide.classList) {
                    slide.classList.toggle('active', i === index);
                }
            } catch (err) {
                console.warn('[SLIDER] Error updating slide:', err);
            }
        });
        
        dotButtons.forEach((dot, i) => {
            try {
                if (dot && dot.classList) {
                    dot.classList.toggle('active', i === index);
                }
            } catch (err) {
                console.warn('[SLIDER] Error updating dot:', err);
            }
        });
    } catch (err) {
        console.error('[SLIDER] Critical error in goToSlide:', err);
        // Never throw - slider navigation is non-critical
    }
}

// CRITICAL: Make renderNewlyAdded globally accessible
function renderNewlyAdded() {
    // DOM FAIL-SAFE: Never throw, always handle gracefully
    console.log('[RENDER] ========== renderNewlyAdded() CHAQIRILDI ==========');
    try {
        // CRITICAL: Guard - only on index page, NO AUTH CHECK
        const pageType = getPageType();
        console.log('[RENDER] Page type:', pageType);
        if (pageType !== 'index') {
            console.log('[RENDER] Not index page, skipping renderNewlyAdded');
            return;
        }
        
        const carousel = document.getElementById('new-carousel');
        console.log('[RENDER] Carousel element:', carousel ? 'topildi' : 'topilmadi');
        
        // CRITICAL: If element not found, skip silently - don't block other renders
        if (!carousel) {
            console.warn('[RENDER] ❌ New releases carousel element not found, skipping');
            return;
        }
        
        // DATA FAIL-SAFE: Check if data is loaded
        console.log('[RENDER] Checking manhwasData:', {
            exists: !!manhwasData,
            isArray: Array.isArray(manhwasData),
            length: manhwasData ? manhwasData.length : 0
        });
        
        if (!manhwasData || !Array.isArray(manhwasData) || manhwasData.length === 0) {
            console.warn('[RENDER] ⚠️ New releases: data yuklanmagan - placeholder ko\'rsatilmoqda');
            carousel.innerHTML = '<div class="empty-state" style="padding: 40px 20px; text-align: center; color: var(--text-secondary); font-size: 0.9rem; min-width: 200px;">Yangi manhwalar yuklanmoqda...<br><small style="opacity: 0.7; margin-top: 8px; display: block;">Sahifani yangilang</small></div>';
            // CRITICAL: Data yuklanmasa ham, darhol loadData ni chaqirish
            console.log('[RENDER] 🔄 Data yo\'q, loadData() ni chaqiryapman...');
            loadData().then(() => {
                console.log('[RENDER] ✅ loadData() muvaffaqiyatli, manhwasData.length:', manhwasData ? manhwasData.length : 0);
                if (manhwasData && Array.isArray(manhwasData) && manhwasData.length > 0) {
                    console.log('[RENDER] 🔄 Data endi yuklangan, yangi manhwalarni qayta render qilish...');
                    carousel.dataset.rendered = 'false';
                    carousel.innerHTML = '';
                    renderNewlyAdded();
                }
            }).catch((err) => {
                console.error('[RENDER] ❌ Data yuklash muvaffaqiyatsiz:', err);
            });
            return;
        }
        
        console.log('[RENDER] ✅ Data mavjud, render qilishni davom ettiramiz...');
        
        // CRITICAL: Always clear and re-render (remove guard that prevents re-render)
        carousel.dataset.rendered = 'false';
        
        // Oxirgi 10 ta manhwa (yangi qo'shilganlar) - safe slice
        console.log(`[RENDER] manhwasData.length: ${manhwasData.length}`);
        const sliceCount = Math.min(10, manhwasData.length);
        const newlyAdded = manhwasData.slice(-sliceCount).reverse().filter(m => m && typeof m === 'object');
        console.log(`[RENDER] newlyAdded.length: ${newlyAdded.length}`);
        
        if (newlyAdded.length === 0) {
            console.warn('[RENDER] ⚠️ Yangi manhwalar bo\'sh');
            carousel.innerHTML = '<div class="empty-state" style="padding: 40px 20px; text-align: center; color: var(--text-secondary); font-size: 0.9rem; min-width: 200px;">Yangi manhwalar topilmadi</div>';
            return;
        }
        
        // CRITICAL: Clear carousel first
        carousel.innerHTML = '';
        let renderedCount = 0;
        
        console.log(`[RENDER] ${newlyAdded.length} ta yangi manhwa topildi, kartalarni yaratish...`);
        
        // CRITICAL: Create cards directly and append immediately (no fragment)
        newlyAdded.forEach((manhwa, index) => {
            try {
                if (!manhwa || typeof manhwa !== 'object') {
                    console.warn(`[RENDER] Invalid manhwa at index ${index}`);
                    return;
                }
                
                console.log(`[RENDER] Creating card ${index + 1}/${newlyAdded.length} for:`, manhwa.title || manhwa.id || 'Noma\'lum');
                const card = createManhwaCard(manhwa);
                
                if (card) {
                    // CRITICAL: Append directly to carousel (not fragment)
                    carousel.appendChild(card);
                    renderedCount++;
                    console.log(`[RENDER] ✅ Card ${index + 1} carousel ga qo'shildi`);
                } else {
                    console.error(`[RENDER] ❌ Card ${index + 1} yaratilmadi`);
                }
            } catch (err) {
                console.error(`[RENDER] ❌ Error creating card ${index + 1}:`, err);
            }
        });
        
        // CRITICAL: Set rendered flag after all cards added
        if (renderedCount > 0) {
            carousel.dataset.rendered = 'true';
            console.log(`[RENDER] ✅ Yangi qo'shilgan: ${renderedCount} manhwa render qilindi`);
            console.log(`[RENDER] Carousel childNodes: ${carousel.childNodes.length} elements`);
        } else {
            console.error('[RENDER] ❌ Hech qanday card yaratilmadi!');
            carousel.innerHTML = '<div class="empty-state" style="padding: 40px 20px; text-align: center; color: var(--text-secondary); font-size: 0.9rem; min-width: 200px;">Kartalar yaratilmadi<br><small style="opacity: 0.7; margin-top: 8px; display: block;">Konsolni tekshiring</small></div>';
        }
        
        // Setup drag/swipe functionality
        try {
            setupCarouselDrag(carousel);
        } catch (err) {
            console.warn('[RENDER] Error setting up carousel drag:', err);
        }
    } catch (err) {
        console.error('[RENDER] Critical error in renderNewlyAdded:', err);
        console.error('[RENDER] Error details:', err.message, err.stack);
        const carousel = document.getElementById('new-carousel');
        if (carousel) {
            carousel.innerHTML = '<div class="empty-state">Yangi manhwalar yuklanmadi</div>';
        }
    }
}

/**
 * Setup drag/swipe functionality for carousel (NO auto-scroll)
 * CRITICAL: Only on index page, simplified logic
 */
function setupCarouselDrag(carousel) {
    // SLIDER PROTECTION: Multiple guards
    if (!carousel) return;
    
    // Check if element is in DOM
    if (!carousel.parentElement || !document.body.contains(carousel)) {
        console.warn('[CAROUSEL] Element not in DOM, skipping drag setup');
        return;
    }
    
    // Check container width - prevent setup if hidden/zero width
    const rect = carousel.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
        console.warn('[CAROUSEL] Container has zero dimensions, skipping drag setup');
        return;
    }
    
    // CRITICAL: Guard - only on index page
    const pageType = getPageType();
    if (pageType !== 'index') {
        return;
    }
    
    // CRITICAL: Prevent duplicate initialization
    if (carousel.dataset.dragSetup === 'true') {
        console.warn('[CAROUSEL] Drag already setup, skipping');
        return;
    }
    
    carousel.dataset.dragSetup = 'true';
    
    try {
        // State variables for drag
        let isDragging = false;
        let startX = 0;
        let scrollLeft = 0;
        
        // Touch swipe variables
        let touchStartX = 0;
        let touchScrollLeft = 0;
        
        // INFINITE LOOP PROTECTION: Timeout guard
        let lastDragTime = 0;
        const MAX_DRAG_EVENTS_PER_SEC = 60; // Prevent excessive events
        
        // Mouse drag support
        carousel.addEventListener('mousedown', (e) => {
            try {
                // Check if element still exists
                if (!document.body.contains(carousel)) {
                    isDragging = false;
                    return;
                }
                
                // Rate limiting
                const now = Date.now();
                if (now - lastDragTime < 1000 / MAX_DRAG_EVENTS_PER_SEC) {
                    return;
                }
                lastDragTime = now;
                
                // SLIDER PROTECTION: Check container width
                const rect = carousel.getBoundingClientRect();
                if (rect.width === 0) {
                    isDragging = false;
                    return;
                }
                
                isDragging = true;
                startX = e.pageX - carousel.offsetLeft;
                scrollLeft = carousel.scrollLeft;
                carousel.style.cursor = 'grabbing';
                carousel.style.scrollBehavior = 'auto';
            } catch (err) {
                console.warn('[CAROUSEL] Mousedown error:', err);
                isDragging = false;
            }
        });
        
        carousel.addEventListener('mouseleave', () => {
            try {
                if (isDragging) {
                    isDragging = false;
                    if (document.body.contains(carousel)) {
                        carousel.style.cursor = 'grab';
                    }
                }
            } catch (err) {
                console.warn('[CAROUSEL] Mouseleave error:', err);
                isDragging = false;
            }
        });
        
        carousel.addEventListener('mouseup', () => {
            try {
                if (isDragging) {
                    isDragging = false;
                    if (document.body.contains(carousel)) {
                        carousel.style.cursor = 'grab';
                    }
                }
            } catch (err) {
                console.warn('[CAROUSEL] Mouseup error:', err);
                isDragging = false;
            }
        });
        
        carousel.addEventListener('mousemove', (e) => {
            try {
                // SLIDER PROTECTION: Multiple guards
                if (!isDragging) return;
                if (!document.body.contains(carousel)) {
                    isDragging = false;
                    return;
                }
                
                const rect = carousel.getBoundingClientRect();
                if (rect.width === 0) {
                    isDragging = false;
                    return;
                }
                
                e.preventDefault();
                const x = e.pageX - carousel.offsetLeft;
                const walk = (x - startX) * 1.5; // Scroll speed multiplier
                carousel.scrollLeft = scrollLeft - walk;
            } catch (err) {
                console.warn('[CAROUSEL] Mousemove error:', err);
                isDragging = false;
            }
        });
        
        // Touch swipe support (mobile)
        carousel.addEventListener('touchstart', (e) => {
            try {
                if (!e.touches || e.touches.length === 0) return;
                isDragging = true;
                touchStartX = e.touches[0].pageX - carousel.offsetLeft;
                touchScrollLeft = carousel.scrollLeft;
            } catch (err) {
                console.warn('[CAROUSEL] Touchstart error:', err);
            }
        }, { passive: true });
        
        carousel.addEventListener('touchmove', (e) => {
            try {
                if (!isDragging || !e.touches || e.touches.length === 0) return;
                const x = e.touches[0].pageX - carousel.offsetLeft;
                const walk = (x - touchStartX) * 1.5;
                carousel.scrollLeft = touchScrollLeft - walk;
            } catch (err) {
                console.warn('[CAROUSEL] Touchmove error:', err);
            }
        }, { passive: true });
        
        carousel.addEventListener('touchend', () => {
            try {
                if (isDragging) {
                    isDragging = false;
                    // Haptic feedback on swipe end
                    hapticFeedback('light');
                }
            } catch (err) {
                console.warn('[CAROUSEL] Touchend error:', err);
            }
        });
        
        // Set cursor style
        carousel.style.cursor = 'grab';
        
        console.log('[CAROUSEL] Drag/swipe setup completed (NO auto-scroll)');
    } catch (err) {
        console.error('[CAROUSEL] Setup error:', err);
    }
}

function renderChannels() {
    // DOM FAIL-SAFE: Never throw, always handle gracefully
    // CRITICAL: Channels MUST ALWAYS render - hardcoded data, no dependencies
    let channelsContainer;
    try {
        // CRITICAL: NO AUTH CHECK - Channels render har doim ishlaydi
        channelsContainer = document.getElementById('channels-scroll');
        
        // CRITICAL: If element not found, skip silently - don't block other renders
        if (!channelsContainer) {
            console.warn('[RENDER] Channels container not found, skipping');
            return;
        }
        
        // CRITICAL: Guard - only on index page (but allow if page type detection fails)
        const pageType = getPageType();
        if (pageType !== 'index') {
            console.log(`[RENDER] Not index page (${pageType}), skipping channels render`);
            return;
        }
        
        // CRITICAL: Guard - prevent duplicate initialization ONLY if already rendered with REAL content
        if (channelsContainer.dataset.rendered === 'true') {
            const existingChannels = channelsContainer.querySelectorAll('.channel-item');
            if (existingChannels.length > 0) {
                console.log('[RENDER] Channels allaqachon render qilingan (' + existingChannels.length + ' items), skipping');
                return;
            } else {
                // Rendered but empty - reset and try again
                console.warn('[RENDER] Channels marked as rendered but empty, resetting and retrying');
                channelsContainer.dataset.rendered = 'false';
            }
        }
        
        channelsContainer.dataset.rendered = 'true';
        channelsContainer.innerHTML = '';
        const fragment = document.createDocumentFragment();
        
        // CRITICAL: channelsData is hardcoded at top of file (line 28) - should ALWAYS exist
        // Check if channelsData is defined globally
        let data = [];
        try {
            if (typeof channelsData !== 'undefined' && Array.isArray(channelsData) && channelsData.length > 0) {
                data = channelsData;
            } else {
                console.warn('[RENDER] channelsData undefined or empty - using fallback hardcoded data');
                // Fallback: Use inline hardcoded data if global variable failed
                data = [
                    { name: 'KuroKami', logo: 'assets/channels/kurokami.png', link: 'https://t.me/kuro_kam1', description: 'Premium manhwa tarjimalari' },
                    { name: 'Hani Manga', logo: 'assets/channels/hani-manga.png', link: 'https://t.me/Hani_uz', description: 'Qorong\'u fantaziya janri' },
                    { name: 'WebMan', logo: 'assets/channels/webman.png', link: 'https://t.me/WebMan_olami', description: 'Keng manhwa katalogi' }
                ];
            }
        } catch (dataErr) {
            console.error('[RENDER] Error accessing channelsData:', dataErr);
            // Use inline fallback
            data = [
                { name: 'KuroKami', logo: 'assets/channels/kurokami.png', link: 'https://t.me/kuro_kam1' },
                { name: 'Hani Manga', logo: 'assets/channels/hani-manga.png', link: 'https://t.me/Hani_uz' },
                { name: 'WebMan', logo: 'assets/channels/webman.png', link: 'https://t.me/WebMan_olami' }
            ];
        }
        
        if (!data || data.length === 0) {
            console.error('[RENDER] CRITICAL: channelsData completely empty even after fallback!');
            channelsContainer.innerHTML = '<div class="empty-state" style="padding: 20px; text-align: center; color: var(--text-secondary);">Kanallar topilmadi</div>';
            channelsContainer.dataset.rendered = 'false'; // Allow retry
            return;
        }
        
        console.log(`[RENDER] Rendering ${data.length} channels`);
        
        let renderedCount = 0;
        data.forEach((channel, index) => {
            try {
                if (!channel || typeof channel !== 'object') {
                    console.warn(`[RENDER] Invalid channel at index ${index}`);
                    return;
                }
                
                const channelItem = document.createElement('a');
                channelItem.href = channel.link || '#';
                channelItem.target = '_blank';
                channelItem.rel = 'noopener noreferrer';
                channelItem.className = 'channel-item';
                
                const img = document.createElement('img');
                img.src = channel.logo || 'assets/logo.svg';
                img.alt = channel.name || 'Channel';
                img.className = 'channel-logo';
                img.onerror = function() {
                    try {
                        this.src = 'assets/logo.svg';
                    } catch (err) {
                        // Ignore error handling errors
                    }
                };
                
                const name = document.createElement('span');
                name.className = 'channel-name';
                name.textContent = channel.name || 'Channel';
                
                channelItem.appendChild(img);
                channelItem.appendChild(name);
                
                if (fragment) {
                    fragment.appendChild(channelItem);
                    renderedCount++;
                }
            } catch (err) {
                console.warn(`[RENDER] Error creating channel item at index ${index}:`, err);
            }
        });
        
        if (fragment && fragment.childNodes.length > 0 && channelsContainer) {
            channelsContainer.appendChild(fragment);
            console.log(`[RENDER] ✅ Kanallar render qilindi: ${renderedCount} ta (expected: ${data.length})`);
        } else {
            console.error('[RENDER] ❌ CRITICAL: Kanallar fragment bo\'sh - no channels rendered!');
            console.error('[RENDER] Fragment:', fragment, 'Container:', channelsContainer);
            console.error('[RENDER] Data:', data, 'Data length:', data ? data.length : 0);
            if (channelsContainer) {
                channelsContainer.innerHTML = '<div class="empty-state" style="padding: 20px; text-align: center; color: var(--text-secondary);">Kanallar topilmadi</div>';
            }
            channelsContainer.dataset.rendered = 'false'; // Allow retry
        }
    } catch (err) {
        console.error('[RENDER] Channels render error:', err);
        console.error('[RENDER] Channels error details:', err.message, err.stack);
        if (channelsContainer) {
            channelsContainer.innerHTML = '<div class="empty-state" style="padding: 20px; text-align: center; color: var(--text-secondary);">Kanallar yuklanmadi</div>';
        }
    }
}

function renderAllManhwas(filter = 'all') {
    // DOM FAIL-SAFE: Never throw, always handle gracefully
    try {
        // CRITICAL: NO AUTH CHECK - Render har doim ishlaydi
        const grid = document.getElementById('manhwa-grid');
        
        // CRITICAL: If element not found, skip silently - don't block other renders
        if (!grid) {
            console.warn('[RENDER] Manhwa grid element not found, skipping');
            return;
        }
        
        // DATA FAIL-SAFE: Check if data is loaded
        // CRITICAL: Agar data yo'q bo'lsa ham, kamida placeholder ko'rsatish
        if (!manhwasData || !Array.isArray(manhwasData) || manhwasData.length === 0) {
            console.warn('[RENDER] All manhwas: data yuklanmagan - placeholder ko\'rsatilmoqda');
            grid.innerHTML = '<div class="empty-state" style="padding: 60px 20px; text-align: center; color: var(--text-secondary); font-size: 0.9rem; grid-column: 1 / -1;">Barcha manhwalar yuklanmoqda...<br><small style="opacity: 0.7; margin-top: 10px; display: block;">Ma\'lumotlar yuklanmaguncha kuting</small></div>';
            // CRITICAL: Data yuklanmasa ham, qayta urinib ko'rish (retry mechanism)
            setTimeout(() => {
                try {
                    if (manhwasData && Array.isArray(manhwasData) && manhwasData.length > 0) {
                        console.log('[RENDER] Data endi yuklangan, barcha manhwalarni qayta render qilish...');
                        renderAllManhwas(filter);
                    } else {
                        // Data hali ham yo'q - loadData ni chaqirish
                        loadData().then(() => {
                            if (manhwasData && manhwasData.length > 0) {
                                renderAllManhwas(filter);
                            }
                        }).catch(() => {
                            console.error('[RENDER] Data yuklash muvaffaqiyatsiz');
                        });
                    }
                } catch (retryErr) {
                    console.error('[RENDER] Retry error:', retryErr);
                }
            }, 500);
            return;
        }
        
        // Reset pagination
        currentManhwaPage = 1;
        
        // Apply filter
        let filteredManhwas = [...manhwasData];
        
        // 18+ filter check
        const adultFilterEnabled = localStorage.getItem('azura_adult_content_enabled') === 'true';
        if (!adultFilterEnabled) {
            // Filter out adult content if filter is disabled
            filteredManhwas = filteredManhwas.filter(m => {
                const genres = (m.genres || []).map(g => g.toLowerCase());
                return !genres.includes('18+') && !genres.includes('adult') && !genres.includes('mature');
            });
        }
        
        // Apply other filters
        if (filter === 'popular') {
            filteredManhwas.sort((a, b) => {
                const aRating = a.rating || 0;
                const bRating = b.rating || 0;
                return bRating - aRating;
            });
        } else if (filter === 'newest') {
            // Sort by ID or timestamp if available (newest first)
            filteredManhwas.reverse();
        } else if (filter === 'rating') {
            filteredManhwas.sort((a, b) => {
                const aRating = a.rating || 0;
                const bRating = b.rating || 0;
                return bRating - aRating;
            });
        }
        
        // Pagination: Show first page only
        const manhwasToShow = filteredManhwas.slice(0, MANHWAS_PER_PAGE);
        
        // Clear existing content
        grid.innerHTML = '';
        const fragment = document.createDocumentFragment();
        let renderedCount = 0;
        
        // Render manhwas (with validation)
        manhwasToShow.forEach((manhwa, index) => {
            try {
                // Validate manhwa object
                if (!manhwa || typeof manhwa !== 'object') {
                    console.warn(`[RENDER] Invalid manhwa at index ${index}:`, manhwa);
                    return;
                }
                
                const card = createManhwaCard(manhwa);
                if (card && fragment) {
                    fragment.appendChild(card);
                    renderedCount++;
                }
            } catch (err) {
                console.warn(`[RENDER] Error creating card for manhwa at index ${index}:`, err);
            }
        });
        
        // Show/hide load more button
        const loadMoreContainer = document.getElementById('load-more-container');
        if (loadMoreContainer) {
            if (filteredManhwas.length > MANHWAS_PER_PAGE) {
                loadMoreContainer.style.display = 'flex';
            } else {
                loadMoreContainer.style.display = 'none';
            }
        }
        
        if (fragment && fragment.childNodes.length > 0 && grid) {
            grid.appendChild(fragment);
            
            console.log(`[RENDER] ✅ ${renderedCount} manhwa rendered (filter: ${filter}, total: ${filteredManhwas.length})`);
            
            // CRITICAL: Manhwa grid'ga scroll qo'shish - bosib turib scroll qilish uchun
            try {
                // Event listener duplicate'ni oldini olish
                if (!grid.dataset.scrollAdded) {
                    // Desktop uchun horizontal wheel scroll
                    grid.addEventListener('wheel', (e) => {
                        if (Math.abs(e.deltaX) > 0) {
                            grid.scrollLeft += e.deltaX;
                            e.preventDefault();
                        } else if (Math.abs(e.deltaY) > 0 && e.shiftKey) {
                            // Shift + wheel = horizontal scroll
                            grid.scrollLeft += e.deltaY;
                            e.preventDefault();
                        }
                    }, { passive: false });
                    
                    // Desktop uchun mouse drag-scroll (click-drag)
                    let isDragging = false;
                    let startX = 0;
                    let scrollLeft = 0;
                    
                    grid.addEventListener('mousedown', (e) => {
                        isDragging = true;
                        grid.style.cursor = 'grabbing';
                        startX = e.pageX - grid.getBoundingClientRect().left;
                        scrollLeft = grid.scrollLeft;
                    }, { passive: true });
                    
                    grid.addEventListener('mouseleave', () => {
                        isDragging = false;
                        grid.style.cursor = 'grab';
                    });
                    
                    grid.addEventListener('mouseup', () => {
                        isDragging = false;
                        grid.style.cursor = 'grab';
                    });
                    
                    grid.addEventListener('mousemove', (e) => {
                        if (!isDragging) return;
                        e.preventDefault();
                        const x = e.pageX - grid.getBoundingClientRect().left;
                        const walk = (x - startX) * 1.5;
                        grid.scrollLeft = scrollLeft - walk;
                    }, { passive: false });
                    
                    grid.dataset.scrollAdded = 'true';
                    console.log('[MANHWA GRID] Scroll functionality added - desktop (wheel+drag) and mobile (touch)');
                }
            } catch (scrollErr) {
                console.warn('[MANHWA GRID] Error adding scroll events:', scrollErr);
            }
        }
        
        console.log(`[RENDER] Barcha manhwalar: ${renderedCount} ta render qilindi (total: ${manhwasData.length})`);
    } catch (err) {
        console.error('[RENDER] Critical error in renderAllManhwas:', err);
        const grid = document.getElementById('manhwa-grid');
        if (grid) {
            grid.innerHTML = '<div class="empty-state">Manhwalar yuklanmadi</div>';
        }
    }
}

// CRITICAL: Make renderIndexPage globally accessible
function renderIndexPage() {
    // CRITICAL: Index sahifa render - AUTH TEKSHRUV YO'Q, MUSTAQIL RENDER
    // Page load'da darrov ishlaydi - auth hech qanday ta'sir qilmaydi
    // OUTER FAIL-SAFE: Wrap everything to guarantee homepage always renders
    console.log('[RENDER] ========== Index page render STARTED ==========');
    
    try {
        // CRITICAL: Check if home-page is currently active BEFORE rendering
        // This prevents home-page from being rendered when user navigated to another page
        const homePage = document.getElementById('home-page');
        const isHomePageActive = homePage && 
                                 homePage.classList.contains('active') && 
                                 homePage.style.display !== 'none' && 
                                 !homePage.hasAttribute('data-hidden');
        
        if (!isHomePageActive) {
            console.log('[RENDER] Home-page is not active (user navigated to another page), skipping renderIndexPage');
            return;
        }
        
        // Additional check: getPageType() to verify we're on index page
        try {
            const pageType = getPageType();
            if (pageType !== 'index') {
                console.log(`[RENDER] Not index page (${pageType}), skipping renderIndexPage`);
                return;
            }
        } catch (pageTypeErr) {
            console.warn('[RENDER] getPageType check failed, continuing with active check:', pageTypeErr);
            // Continue if getPageType fails - active check is primary
        }
        
        console.log('[RENDER] STEP 1: Home-page is active, confirmed = index');
        
        // CRITICAL: Ensure data is loaded before rendering
        if (!manhwasData || manhwasData.length === 0) {
            console.log('[RENDER] STEP 1.5: No data, loading first...');
            loadData().then(() => {
                console.log('[RENDER] STEP 1.5: Data loaded, continuing render...');
                // Continue with rendering after data loads
                continueRenderIndexPage();
            }).catch(err => {
                console.error('[RENDER] STEP 1.5: Error loading data:', err);
                // Continue anyway with placeholders
                continueRenderIndexPage();
            });
            return;
        }
        
        continueRenderIndexPage();
    } catch (err) {
        console.error('[RENDER] ========== CRITICAL ERROR in renderIndexPage ==========');
        console.error('[RENDER] ERROR:', err);
        console.error('[RENDER] ERROR Details:', err.message, err.stack);
        // EMERGENCY FALLBACK: Even if everything fails, show something
        try {
            emergencyHomepageRender();
            console.log('[RENDER] Emergency fallback executed');
        } catch (emergencyErr) {
            console.error('[RENDER] Emergency render also failed:', emergencyErr);
        }
    }
}

function continueRenderIndexPage() {
    try {
        console.log('[RENDER] ========== Continuing index page render ==========');
        
        // Channels section removed from homepage - no longer needed
        
        // IMMEDIATE render attempt - don't wait for data
        console.log('[RENDER] STEP 2: Rendering Top 5 slider (IMMEDIATE - will show placeholder if no data)');
        try {
            renderTop5Slider();
            console.log('[RENDER] STEP 2 OK: Top 5 slider render attempted');
        } catch (err) {
            console.error('[RENDER] STEP 2 ERROR: Top 5 slider failed:', err);
            console.error('[RENDER] STEP 2 ERROR Details:', err.message, err.stack);
            // Show fallback content - ensure something is always shown
            try {
                const slider = document.getElementById('hero-slider');
                if (slider) {
                    slider.innerHTML = '<div class="empty-state" style="padding: 60px 20px; text-align: center; color: var(--text-secondary); font-size: 0.9rem;">Top manhwalar yuklanmoqda...<br><small style="opacity: 0.7; margin-top: 10px; display: block;">Iltimos, biroz kuting</small></div>';
                }
            } catch (fallbackErr) {
                console.error('[RENDER] STEP 2 FALLBACK ERROR:', fallbackErr);
            }
        }
        
        // IMMEDIATE render attempt - don't wait for data
        console.log('[RENDER] STEP 3: Rendering newly added (IMMEDIATE - will show placeholder if no data)');
        console.log('[RENDER] manhwasData before renderNewlyAdded:', manhwasData ? `length=${manhwasData.length}` : 'null/undefined');
        try {
            // CRITICAL: If no data, load it first
            if (!manhwasData || manhwasData.length === 0) {
                console.log('[RENDER] STEP 3: No data, loading first...');
                loadData().then(() => {
                    console.log('[RENDER] STEP 3: Data loaded, now rendering...');
                    renderNewlyAdded();
                }).catch(err => {
                    console.error('[RENDER] STEP 3: Error loading data:', err);
                });
            } else {
                renderNewlyAdded();
            }
            console.log('[RENDER] STEP 3 OK: Newly added render attempted');
        } catch (err) {
            console.error('[RENDER] STEP 3 ERROR: Newly added failed:', err);
            console.error('[RENDER] STEP 3 ERROR Details:', err.message, err.stack);
            // Show fallback content - ensure something is always shown
            try {
                const carousel = document.getElementById('new-carousel');
                if (carousel) {
                    carousel.innerHTML = '<div class="empty-state" style="padding: 40px 20px; text-align: center; color: var(--text-secondary); font-size: 0.9rem; min-width: 200px;">Yangi manhwalar yuklanmoqda...<br><small style="opacity: 0.7; margin-top: 8px; display: block;">Sahifani yangilang</small></div>';
                }
            } catch (fallbackErr) {
                console.error('[RENDER] STEP 3 FALLBACK ERROR:', fallbackErr);
            }
        }
        
        // IMMEDIATE render attempt - don't wait for data
        console.log('[RENDER] STEP 5: Rendering all manhwas (IMMEDIATE - will show placeholder if no data)');
        try {
            renderAllManhwas();
            console.log('[RENDER] STEP 5 OK: All manhwas render attempted');
        } catch (err) {
            console.error('[RENDER] STEP 5 ERROR: All manhwas failed:', err);
            console.error('[RENDER] STEP 5 ERROR Details:', err.message, err.stack);
            // Show fallback content - ensure something is always shown
            try {
                const grid = document.getElementById('manhwa-grid');
                if (grid) {
                    grid.innerHTML = '<div class="empty-state" style="padding: 60px 20px; text-align: center; color: var(--text-secondary); font-size: 0.9rem; grid-column: 1 / -1;">Barcha manhwalar yuklanmoqda...<br><small style="opacity: 0.7; margin-top: 10px; display: block;">Ma\'lumotlar yuklanmaguncha kuting</small></div>';
                }
            } catch (fallbackErr) {
                console.error('[RENDER] STEP 5 FALLBACK ERROR:', fallbackErr);
            }
        }
        
        console.log('[RENDER] ========== Index page render COMPLETE (all sections attempted) ==========');
    } catch (err) {
        console.error('[RENDER] ========== CRITICAL ERROR in continueRenderIndexPage ==========');
        console.error('[RENDER] ERROR:', err);
        console.error('[RENDER] ERROR Details:', err.message, err.stack);
        // EMERGENCY FALLBACK: Even if everything fails, show something
        try {
            emergencyHomepageRender();
            console.log('[RENDER] Emergency fallback executed');
        } catch (emergencyErr) {
            console.error('[RENDER] Emergency render also failed:', emergencyErr);
            // Last resort: force show placeholders manually
            try {
                const heroSlider = document.getElementById('hero-slider');
                const newCarousel = document.getElementById('new-carousel');
                const manhwaGrid = document.getElementById('manhwa-grid');
                // Channels section removed - no longer needed
            // const channelsScroll = document.getElementById('channels-scroll');
                
                if (heroSlider && (!heroSlider.innerHTML || heroSlider.innerHTML.trim() === '')) {
                    heroSlider.innerHTML = '<div style="padding: 60px 20px; text-align: center; color: #b8bcc8; font-size: 0.9rem;">Top manhwalar yuklanmoqda...</div>';
                }
                if (newCarousel && (!newCarousel.innerHTML || newCarousel.innerHTML.trim() === '')) {
                    newCarousel.innerHTML = '<div style="padding: 40px 20px; text-align: center; color: #b8bcc8; font-size: 0.9rem; min-width: 200px;">Yangi manhwalar yuklanmoqda...</div>';
                }
                if (manhwaGrid && (!manhwaGrid.innerHTML || manhwaGrid.innerHTML.trim() === '')) {
                    manhwaGrid.innerHTML = '<div style="padding: 60px 20px; text-align: center; color: #b8bcc8; font-size: 0.9rem; grid-column: 1 / -1;">Barcha manhwalar yuklanmoqda...</div>';
                }
                    // Channels section removed from homepage - no longer needed
                console.log('[RENDER] Manual placeholders set as last resort');
            } catch (finalErr) {
                console.error('[RENDER] FINAL FALLBACK ALSO FAILED:', finalErr);
            }
        }
    }
}

// ============================================
// SEARCH PAGE - ADVANCED GENRE HUB
// ============================================

// Common manhwa genres (Uzbek translation)
const DEFAULT_GENRES = [
    'Fantaziya',
    'Aksiyon',
    'Romantika',
    'Drama',
    'Komediya',
    'Qo\'rqinch',
    'Triller',
    'Sir',
    'Shaxsiy Rivojlanish',
    'Isekai',
    'Zamonaviy',
    'Tarixiy',
    'Urush',
    'Sport',
    'Fan-Texnika',
    'Shoujo',
    'Shounen',
    'Seinen',
    'Yaoi',
    'Yuri'
];

/**
 * Extract all unique genres from manhwa data
 * If genres are empty, assign genres based on title keywords or use defaults
 */
function extractGenres() {
    // DATA FAIL-SAFE: Never throw, always return valid Map
    try {
        const genreMap = new Map();
        
        // Collect genres from manhwa data (safe iteration)
        // NOTE: Even if manhwasData is empty, we still use DEFAULT_GENRES
        const hasManhwaData = manhwasData && Array.isArray(manhwasData) && manhwasData.length > 0;
        
        if (hasManhwaData) {
            try {
                manhwasData.forEach((manhwa, index) => {
                    try {
                        if (!manhwa || typeof manhwa !== 'object') {
                            console.warn(`[GENRES] Invalid manhwa at index ${index}, skipping`);
                            return;
                        }
                        
                        const genres = manhwa.genres || [];
                        if (Array.isArray(genres) && genres.length > 0) {
                            genres.forEach(genre => {
                                try {
                                    if (genre && typeof genre === 'string' && genre.trim()) {
                                        const normalizedGenre = genre.trim();
                                        if (!genreMap.has(normalizedGenre)) {
                                            genreMap.set(normalizedGenre, []);
                                        }
                                        const genreList = genreMap.get(normalizedGenre);
                                        if (genreList && Array.isArray(genreList)) {
                                            genreList.push(manhwa);
                                        }
                                    }
                                } catch (genreErr) {
                                    console.warn('[GENRES] Error processing genre:', genreErr);
                                }
                            });
                        }
                    } catch (manhwaErr) {
                        console.warn(`[GENRES] Error processing manhwa at index ${index}:`, manhwaErr);
                    }
                });
            } catch (forEachErr) {
                console.error('[GENRES] Error in forEach loop:', forEachErr);
            }
        } else {
            console.log('[GENRES] No manhwa data available, will use DEFAULT_GENRES');
        }
        
        // If no genres found OR no data, assign default genres (CRITICAL: Always use DEFAULT_GENRES if empty)
        if (genreMap.size === 0) {
            try {
                if (DEFAULT_GENRES && Array.isArray(DEFAULT_GENRES) && DEFAULT_GENRES.length > 0) {
                    console.log(`[GENRES] ✅ Using DEFAULT_GENRES (${DEFAULT_GENRES.length} genres) - genre cards will be shown`);
                    
                    // Initialize all default genres with empty arrays
                    DEFAULT_GENRES.forEach(genre => {
                        if (genre && typeof genre === 'string') {
                            genreMap.set(genre, []);
                        }
                    });
                    
                    // Distribute manhwas across genres (if data available) - safe iteration
                    if (hasManhwaData) {
                        manhwasData.forEach((manhwa, index) => {
                            try {
                                if (manhwa && typeof manhwa === 'object' && DEFAULT_GENRES.length > 0) {
                                    const genre = DEFAULT_GENRES[index % DEFAULT_GENRES.length];
                                    if (genre) {
                                        const genreList = genreMap.get(genre);
                                        if (genreList && Array.isArray(genreList)) {
                                            genreList.push(manhwa);
                                        }
                                    }
                                }
                            } catch (distErr) {
                                console.warn(`[GENRES] Error distributing manhwa at index ${index}:`, distErr);
                            }
                        });
                        console.log(`[GENRES] Distributed ${manhwasData.length} manhwas across ${DEFAULT_GENRES.length} genres`);
                    } else {
                        // If no manhwa data, still create genre cards (empty genres are OK for display)
                        console.log(`[GENRES] ✅ Created ${genreMap.size} empty genre cards from DEFAULT_GENRES (no manhwa data)`);
                    }
                } else {
                    console.error('[GENRES] DEFAULT_GENRES not available!');
                }
            } catch (defaultErr) {
                console.error('[GENRES] Error assigning default genres:', defaultErr);
            }
        } else {
            console.log(`[GENRES] ✅ Found ${genreMap.size} genres in manhwa data`);
        }
        
        return genreMap;
    } catch (err) {
        console.error('[GENRES] CRITICAL error in extractGenres:', err);
        // Always return valid Map, even if empty
        return new Map();
    }
}

/**
 * Find representative cover for a genre (ADVANCED)
 * Priority: 
 * 1. Most read manhwa (highest views from history/localStorage)
 * 2. Highest average rating (if views are equal)
 * 3. If new manhwa appears and gets more views/ratings → will replace cover automatically
 */
function findGenreCover(genreManhwas) {
    // DATA FAIL-SAFE: Never throw, always return valid cover URL
    try {
        if (!genreManhwas || !Array.isArray(genreManhwas) || genreManhwas.length === 0) {
            console.warn('[GENRE COVER] Empty genre manhwas array');
            return 'assets/logo.svg';
        }
        
        // Filter valid manhwas first
        const validManhwas = genreManhwas.filter(m => {
            try {
                return m && typeof m === 'object' && (m.id || m.slug) && m.cover;
            } catch (err) {
                return false;
            }
        });
        
        if (validManhwas.length === 0) {
            console.warn('[GENRE COVER] No valid manhwas with covers found');
            return 'assets/logo.svg';
        }
        
        // Sort by priority: views > rating > newest (safe, advanced)
        let sorted;
        try {
            sorted = [...validManhwas].sort((a, b) => {
                try {
                    const manhwaIdA = a?.id || a?.slug || '';
                    const manhwaIdB = b?.id || b?.slug || '';
                    
                    // PRIORITY 1: Views (from localStorage history or data) - MOST IMPORTANT
                    let viewsA = 0;
                    let viewsB = 0;
                    try {
                        viewsA = getManhwaViews(a) || a?.views || 0;
                    } catch (err) {
                        viewsA = a?.views || 0;
                    }
                    try {
                        viewsB = getManhwaViews(b) || b?.views || 0;
                    } catch (err) {
                        viewsB = b?.views || 0;
                    }
                    
                    // If views differ significantly, prioritize views
                    if (Math.abs(viewsA - viewsB) > 10) {
                        return viewsB - viewsA; // Higher views first
                    }
                    
                    // PRIORITY 2: Average rating (if views are close) - SECONDARY
                    let ratingA = 0;
                    let ratingB = 0;
                    try {
                        ratingA = manhwaIdA ? (calculateAverageRating(manhwaIdA) || 0) : 0;
                    } catch (err) {
                        ratingA = 0;
                    }
                    try {
                        ratingB = manhwaIdB ? (calculateAverageRating(manhwaIdB) || 0) : 0;
                    } catch (err) {
                        ratingB = 0;
                    }
                    
                    // If ratings differ, prioritize higher rating
                    if (Math.abs(ratingA - ratingB) > 0.5) {
                        return ratingB - ratingA; // Higher rating first
                    }
                    
                    // PRIORITY 3: If both views and ratings are similar, use trending score
                    // Trending score: views * 0.7 + rating * 30 (emphasize views more)
                    const trendingScoreA = viewsA * 0.7 + ratingA * 30;
                    const trendingScoreB = viewsB * 0.7 + ratingB * 30;
                    
                    if (trendingScoreA !== trendingScoreB) {
                        return trendingScoreB - trendingScoreA; // Higher trending score first
                    }
                    
                    // PRIORITY 4: If all equal, prefer first one (stable ordering)
                    return 0;
                } catch (sortErr) {
                    console.warn('[GENRE COVER] Sort error:', sortErr);
                    return 0; // Keep original order on error
                }
            });
        } catch (sortErr) {
            console.error('[GENRE COVER] Critical sort error:', sortErr);
            sorted = validManhwas; // Fallback to valid manhwas without sorting
        }
        
        if (!sorted || sorted.length === 0) {
            console.warn('[GENRE COVER] Sort resulted in empty array');
            // Try to get first valid manhwa with cover
            const firstValid = validManhwas.find(m => m && m.cover);
            if (firstValid && firstValid.cover) {
                return firstValid.cover;
            }
            return 'assets/logo.svg';
        }
        
        const bestManhwa = sorted[0];
        if (!bestManhwa || typeof bestManhwa !== 'object') {
            console.warn('[GENRE COVER] Best manhwa is invalid');
            return 'assets/logo.svg';
        }
        
        const coverUrl = bestManhwa.cover || 'assets/logo.svg';
        console.log(`[GENRE COVER] Selected cover for genre: ${coverUrl} (from "${bestManhwa.title || bestManhwa.id || 'unknown'}")`);
        
        return coverUrl;
    } catch (err) {
        console.error('[GENRE COVER] CRITICAL error in findGenreCover:', err);
        console.error('[GENRE COVER] Error details:', err.message, err.stack);
        return 'assets/logo.svg'; // Always return valid fallback
    }
}

/**
 * Get manhwa views from history (localStorage)
 */
function getManhwaViews(manhwa) {
    // DATA FAIL-SAFE: Never throw, always return number
    try {
        if (!manhwa || typeof manhwa !== 'object') {
            return 0;
        }
        
        const manhwaId = manhwa.id || manhwa.slug || '';
        if (!manhwaId) {
            return manhwa.views || 0;
        }
        
        try {
            const historyStr = localStorage?.getItem('azura_history');
            if (!historyStr) {
                return manhwa.views || 0;
            }
            
            const history = JSON.parse(historyStr);
            if (!Array.isArray(history)) {
                return manhwa.views || 0;
            }
            
            // Count occurrences in history (safe filter)
            let count = 0;
            try {
                history.forEach(item => {
                    try {
                        if (typeof item === 'string' && item === manhwaId) {
                            count++;
                        } else if (typeof item === 'object' && item.manhwaId === manhwaId) {
                            count++;
                        }
                    } catch (itemErr) {
                        // Skip invalid items
                    }
                });
            } catch (forEachErr) {
                console.warn('[VIEWS] Error counting history:', forEachErr);
            }
            
            return count || manhwa.views || 0;
        } catch (localStorageErr) {
            console.warn('[VIEWS] localStorage error:', localStorageErr);
            return manhwa.views || 0;
        }
    } catch (err) {
        console.error('[VIEWS] CRITICAL error in getManhwaViews:', err);
        return 0; // Always return number
    }
}

/**
 * Render genre cards grid
 */
function renderGenreCards() {
    // DOM FAIL-SAFE: Never throw, always handle gracefully
    console.log('[GENRE HUB] Genre cards render STARTED');
    
    try {
        const genreCardsGrid = document.getElementById('genre-cards-grid');
        if (!genreCardsGrid) {
            console.warn('[GENRE HUB] Genre cards grid not found, skipping');
            return;
        }
        
        // Extract genres (safe function) - works even without manhwa data (uses DEFAULT_GENRES)
        let genreMap;
        try {
            genreMap = extractGenres();
        } catch (extractErr) {
            console.error('[GENRE HUB] Error extracting genres:', extractErr);
            genreCardsGrid.innerHTML = '<div class="empty-state">Janrlar topilmadi</div>';
            return;
        }
        
        // Check if genreMap is valid (even if empty, DEFAULT_GENRES should populate it)
        if (!genreMap || typeof genreMap !== 'object' || !(genreMap instanceof Map)) {
            console.error('[GENRE HUB] Invalid genreMap returned from extractGenres');
            genreCardsGrid.innerHTML = '<div class="empty-state">Janrlar topilmadi</div>';
            return;
        }
        
        if (genreMap.size === 0) {
            // Even if no genres found, try to use DEFAULT_GENRES directly
            console.warn('[GENRE HUB] No genres found in genreMap, trying to use DEFAULT_GENRES directly');
            if (DEFAULT_GENRES && Array.isArray(DEFAULT_GENRES) && DEFAULT_GENRES.length > 0) {
                DEFAULT_GENRES.forEach(genre => {
                    if (genre && typeof genre === 'string') {
                        genreMap.set(genre, []);
                    }
                });
                console.log(`[GENRE HUB] Created ${genreMap.size} genre cards from DEFAULT_GENRES`);
            } else {
                genreCardsGrid.innerHTML = '<div class="empty-state">Janrlar topilmadi</div>';
                console.warn('[GENRE HUB] DEFAULT_GENRES not available');
                return;
            }
        }
        
        const genres = Array.from(genreMap.entries());
        
        if (genres.length === 0) {
            genreCardsGrid.innerHTML = '<div class="empty-state">Janrlar topilmadi</div>';
            return;
        }
        
        genreCardsGrid.innerHTML = '';
        const fragment = document.createDocumentFragment();
        let renderedCount = 0;
        
        genres.forEach(([genreName, genreManhwas], index) => {
            try {
                if (!genreName || typeof genreName !== 'string') {
                    console.warn(`[GENRE HUB] Invalid genre name at index ${index}`);
                    return;
                }
                
                // Allow empty genres for display (they will show 0 ta manhwa)
                // This allows DEFAULT_GENRES to show even when data is loading
                if (!genreManhwas || !Array.isArray(genreManhwas)) {
                    console.warn(`[GENRE HUB] Invalid genreManhwas for ${genreName}, skipping`);
                    return;
                }
                
                // Note: We allow empty arrays (length === 0) for genres that are valid but have no manhwas yet
                
                const genreCard = document.createElement('div');
                genreCard.className = 'genre-card';
                genreCard.dataset.genre = genreName;
                
                // Find representative cover (safe)
                let coverUrl = 'assets/logo.svg';
                try {
                    // Only find cover if genre has manhwas
                    if (genreManhwas && Array.isArray(genreManhwas) && genreManhwas.length > 0) {
                        const foundCover = findGenreCover(genreManhwas);
                        if (foundCover && typeof foundCover === 'string' && foundCover !== 'assets/logo.svg') {
                            coverUrl = foundCover;
                        }
                    }
                    // If genre is empty, use default logo (already set above)
                } catch (coverErr) {
                    console.warn(`[GENRE HUB] Error finding cover for ${genreName}:`, coverErr);
                }
                
                // Background image - 2-chi rasmdagidek (full-bleed, markazda)
                const bg = document.createElement('div');
                bg.className = 'genre-card-bg';
                try {
                    bg.style.backgroundImage = `url(${coverUrl})`;
                    // 2-chi rasmdagidek: Cover rasmlar full-bleed (butun kartani to'ldiradi)
                    bg.style.backgroundSize = 'cover';
                    // Markazda - 2-chi rasmdagidek
                    bg.style.backgroundPosition = 'center';
                    bg.style.backgroundRepeat = 'no-repeat';
                    // Background aniq (no opacity reduction) - orqa fon hiralashmaydi
                    bg.style.opacity = '1';
                    // Note: onerror for div background-image doesn't work in JS, CSS handles fallback
                } catch (styleErr) {
                    console.warn('[GENRE HUB] Error setting background:', styleErr);
                }
                
                // Overlay with genre name
                const overlay = document.createElement('div');
                overlay.className = 'genre-card-overlay';
                
                const name = document.createElement('h3');
                name.className = 'genre-card-name';
                name.textContent = genreName;
                
                const count = document.createElement('div');
                count.className = 'genre-card-count';
                const manhwaCount = genreManhwas ? genreManhwas.length : 0;
                count.textContent = `${manhwaCount} ta manhwa`;
                
                overlay.appendChild(name);
                overlay.appendChild(count);
                
                genreCard.appendChild(bg);
                genreCard.appendChild(overlay);
                
                // CRITICAL: Simple click handler - scroll halaqit bermasligi uchun
                // Grid container scroll qiladi, kartalar faqat click uchun
                // Barcha touch events olib tashlandi - faqat click qoldirildi
                try {
                    // Simple click handler - scroll'ni bloklamasligi uchun
                    genreCard.addEventListener('click', (e) => {
                        try {
                            filterByGenre(genreName);
                        } catch (filterErr) {
                            console.error('[GENRE HUB] Filter by genre error:', filterErr);
                        }
                    });
                } catch (handlerErr) {
                    console.warn('[GENRE HUB] Error adding click handler:', handlerErr);
                }
                
                if (fragment) fragment.appendChild(genreCard);
                renderedCount++;
            } catch (err) {
                console.warn(`[GENRE HUB] Error rendering genre card at index ${index}:`, err);
            }
        });
        
        if (fragment && fragment.childNodes.length > 0 && genreCardsGrid) {
            genreCardsGrid.appendChild(fragment);
            
            // CRITICAL: Native scroll ishlatiladi - desktop va mobile uchun
            // CSS'da touch-action: pan-x pan-y bor - mobile uchun native touch scroll
            // Desktop uchun: mouse wheel (native) + click-drag
            // Mobile uchun: touch scroll (native)
            try {
                // Desktop uchun horizontal wheel scroll (native scroll'ga yordam)
                genreCardsGrid.addEventListener('wheel', (e) => {
                    // Agar horizontal scroll bo'lsa, grid container'ni scroll qilish
                    if (Math.abs(e.deltaX) > 0) {
                        genreCardsGrid.scrollLeft += e.deltaX;
                        e.preventDefault();
                    } else if (Math.abs(e.deltaY) > 0 && e.shiftKey) {
                        // Shift + wheel = horizontal scroll
                        genreCardsGrid.scrollLeft += e.deltaY;
                        e.preventDefault();
                    }
                }, { passive: false });
                
                // Desktop uchun mouse drag-scroll (click-drag)
                let isDragging = false;
                let startX = 0;
                let scrollLeft = 0;
                
                genreCardsGrid.addEventListener('mousedown', (e) => {
                    isDragging = true;
                    genreCardsGrid.style.cursor = 'grabbing';
                    startX = e.pageX - genreCardsGrid.getBoundingClientRect().left;
                    scrollLeft = genreCardsGrid.scrollLeft;
                }, { passive: true });
                
                genreCardsGrid.addEventListener('mouseleave', () => {
                    isDragging = false;
                    genreCardsGrid.style.cursor = 'grab';
                });
                
                genreCardsGrid.addEventListener('mouseup', () => {
                    isDragging = false;
                    genreCardsGrid.style.cursor = 'grab';
                });
                
                genreCardsGrid.addEventListener('mousemove', (e) => {
                    if (!isDragging) return;
                    e.preventDefault();
                    const x = e.pageX - genreCardsGrid.getBoundingClientRect().left;
                    const walk = (x - startX) * 1.5;
                    genreCardsGrid.scrollLeft = scrollLeft - walk;
                }, { passive: false });
                
                console.log('[GENRE HUB] Native scroll enabled - desktop (wheel+drag) and mobile (touch)');
            } catch (scrollErr) {
                console.warn('[GENRE HUB] Error adding scroll events:', scrollErr);
            }
        }
        
        console.log(`[GENRE HUB] ${renderedCount} janr kartasi render qilindi (total genres: ${genres.length})`);
    } catch (err) {
        console.error('[GENRE HUB] CRITICAL error in renderGenreCards:', err);
        const genreCardsGrid = document.getElementById('genre-cards-grid');
        if (genreCardsGrid) {
            genreCardsGrid.innerHTML = '<div class="empty-state">Janrlar yuklanmadi</div>';
        }
    }
}

/**
 * Filter manhwas by genre
 */
function filterByGenre(genreName) {
    // DOM FAIL-SAFE: Never throw, always handle gracefully
    console.log(`[GENRE FILTER] Filtering by genre: ${genreName}`);
    
    try {
        if (!genreName || typeof genreName !== 'string') {
            console.warn('[GENRE FILTER] Invalid genre name');
            return;
        }
        
        // Hide genre hub, show results (safe)
        try {
            const genreHubSection = document.getElementById('genre-hub-section');
            const searchResultsSection = document.getElementById('search-results-section');
            const clearFilterBtn = document.getElementById('clear-filter-btn');
            const resultsTitle = document.getElementById('filtered-results-title');
            const searchInput = document.getElementById('search-input');
            
            // Hide genre hub, show filtered results
            if (genreHubSection) {
                genreHubSection.style.display = 'none';
            }
            
            if (searchResultsSection) {
                searchResultsSection.style.display = 'block';
            }
            
            // Update results title
            if (resultsTitle) {
                resultsTitle.textContent = `${genreName} janri`;
            }
            
            // Show and setup clear filter button
            if (clearFilterBtn) {
                clearFilterBtn.style.display = 'flex';
                // Remove old listeners, add new one (prevent duplicates)
                const newBtn = clearFilterBtn.cloneNode(true);
                clearFilterBtn.parentNode.replaceChild(newBtn, clearFilterBtn);
                newBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                        clearGenreFilter();
                    } catch (err) {
                        console.error('[GENRE FILTER] Clear filter error:', err);
                    }
                });
            }
            
            // Clear search input when filtering by genre (non-blocking)
            try {
                if (searchInput) {
                    searchInput.value = '';
                }
            } catch (inputErr) {
                console.warn('[GENRE FILTER] Error clearing search input:', inputErr);
            }
            
            // Scroll to top smoothly (non-blocking)
            try {
                const appRoot = document.querySelector('.app-root');
                if (appRoot) {
                    appRoot.scrollTo({ top: 0, behavior: 'smooth' });
                } else {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            } catch (scrollErr) {
                console.warn('[GENRE FILTER] Scroll error:', scrollErr);
            }
        } catch (displayErr) {
            console.warn('[GENRE FILTER] Error updating display:', displayErr);
        }
        
        // DATA FAIL-SAFE: Check if data is loaded
        if (!manhwasData || !Array.isArray(manhwasData) || manhwasData.length === 0) {
            const resultsContainer = document.getElementById('search-results');
            if (resultsContainer) {
                resultsContainer.innerHTML = '<div class="empty-state">Ma\'lumotlar yuklanmoqda...</div>';
            }
            // Try to load data
            loadData().then(() => {
                filterByGenre(genreName);
            }).catch(() => {
                if (resultsContainer) {
                    resultsContainer.innerHTML = '<div class="empty-state">Ma\'lumotlar yuklanmadi</div>';
                }
            });
            return;
        }
        
        // Filter manhwas (safe)
        let genreMap;
        try {
            genreMap = extractGenres();
        } catch (extractErr) {
            console.error('[GENRE FILTER] Error extracting genres:', extractErr);
            const resultsContainer = document.getElementById('search-results');
            if (resultsContainer) {
                resultsContainer.innerHTML = '<div class="empty-state">Janrlar topilmadi</div>';
            }
            return;
        }
        
        if (!genreMap || genreMap.size === 0) {
            const resultsContainer = document.getElementById('search-results');
            if (resultsContainer) {
                resultsContainer.innerHTML = '<div class="empty-state">Janrlar topilmadi</div>';
            }
            return;
        }
        
        const genreManhwas = genreMap.get(genreName) || [];
        
        if (!Array.isArray(genreManhwas) || genreManhwas.length === 0) {
            renderFilteredResults([], genreName);
            return;
        }
        
        // Sort by trending (views + rating) - safe
        let sorted;
        try {
            sorted = [...genreManhwas].filter(m => m && typeof m === 'object').sort((a, b) => {
                try {
                    const manhwaIdA = a?.id || a?.slug || '';
                    const manhwaIdB = b?.id || b?.slug || '';
                    
                    let viewsA = 0;
                    let viewsB = 0;
                    try {
                        viewsA = getManhwaViews(a) || a?.views || 0;
                    } catch (err) {
                        viewsA = a?.views || 0;
                    }
                    try {
                        viewsB = getManhwaViews(b) || b?.views || 0;
                    } catch (err) {
                        viewsB = b?.views || 0;
                    }
                    
                    let ratingA = 0;
                    let ratingB = 0;
                    try {
                        ratingA = manhwaIdA ? (calculateAverageRating(manhwaIdA) || 0) : 0;
                    } catch (err) {
                        ratingA = 0;
                    }
                    try {
                        ratingB = manhwaIdB ? (calculateAverageRating(manhwaIdB) || 0) : 0;
                    } catch (err) {
                        ratingB = 0;
                    }
                    
                    // Trending score: views * 0.6 + rating * 40
                    const scoreA = viewsA * 0.6 + ratingA * 40;
                    const scoreB = viewsB * 0.6 + ratingB * 40;
                    
                    return scoreB - scoreA;
                } catch (sortErr) {
                    console.warn('[GENRE FILTER] Sort error:', sortErr);
                    return 0;
                }
            });
        } catch (sortErr) {
            console.error('[GENRE FILTER] Critical sort error:', sortErr);
            sorted = genreManhwas.filter(m => m && typeof m === 'object');
        }
        
        renderFilteredResults(sorted || [], genreName);
    } catch (err) {
        console.error('[GENRE FILTER] CRITICAL error in filterByGenre:', err);
        const resultsContainer = document.getElementById('search-results');
        if (resultsContainer) {
            resultsContainer.innerHTML = '<div class="empty-state">Filter xatosi</div>';
        }
    }
}

/**
 * Clear genre filter and show genre hub again
 */
function clearGenreFilter() {
    // DOM FAIL-SAFE: Never throw, always handle gracefully
    console.log('[GENRE FILTER] Clearing genre filter');
    
    try {
        const genreHubSection = document.getElementById('genre-hub-section');
        const searchResultsSection = document.getElementById('search-results-section');
        const clearFilterBtn = document.getElementById('clear-filter-btn');
        const searchInput = document.getElementById('search-input');
        
        try {
            if (genreHubSection) {
                genreHubSection.style.display = 'block';
            }
        } catch (err) {
            console.warn('[GENRE FILTER] Error showing genre hub:', err);
        }
        
        try {
            if (searchResultsSection) {
                searchResultsSection.style.display = 'none';
            }
        } catch (err) {
            console.warn('[GENRE FILTER] Error hiding results:', err);
        }
        
        try {
            if (clearFilterBtn) {
                clearFilterBtn.style.display = 'none';
            }
        } catch (err) {
            console.warn('[GENRE FILTER] Error hiding clear button:', err);
        }
        
        // Clear search input
        try {
            if (searchInput) {
                searchInput.value = '';
            }
        } catch (err) {
            console.warn('[GENRE FILTER] Error clearing search input:', err);
        }
        
        // Clear filtered results container
        try {
            const resultsContainer = document.getElementById('search-results');
            if (resultsContainer) {
                resultsContainer.innerHTML = '';
            }
        } catch (clearErr) {
            console.warn('[GENRE FILTER] Error clearing results container:', clearErr);
        }
        
        // Clear results title
        try {
            const resultsTitle = document.getElementById('filtered-results-title');
            if (resultsTitle) {
                resultsTitle.textContent = '';
            }
        } catch (titleErr) {
            console.warn('[GENRE FILTER] Error clearing results title:', titleErr);
        }
        
        // Scroll to top smoothly (non-blocking)
        try {
            const appRoot = document.querySelector('.app-root');
            if (appRoot) {
                appRoot.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        } catch (scrollErr) {
            // Fallback to instant scroll
            try {
                const appRoot = document.querySelector('.app-root');
                if (appRoot) {
                    appRoot.scrollTo(0, 0);
                } else {
                    window.scrollTo(0, 0);
                }
            } catch (fallbackErr) {
                console.warn('[GENRE FILTER] Scroll failed:', fallbackErr);
            }
        }
        
        console.log('[GENRE FILTER] ✅ Filter cleared successfully - genre hub shown');
    } catch (err) {
        console.error('[GENRE FILTER] CRITICAL error in clearGenreFilter:', err);
        // Never throw - this is non-critical
    }
}

/**
 * Render filtered results
 */
function renderFilteredResults(manhwas, genreName) {
    // DOM FAIL-SAFE: Never throw, always handle gracefully
    console.log(`[GENRE FILTER] Rendering filtered results: ${manhwas?.length || 0} manhwas for "${genreName || 'unknown'}"`);
    
    try {
        const resultsContainer = document.getElementById('search-results');
        if (!resultsContainer) {
            console.warn('[GENRE FILTER] Results container not found');
            return;
        }
        
        // Validate input
        if (!manhwas || !Array.isArray(manhwas) || manhwas.length === 0) {
            resultsContainer.innerHTML = '<div class="empty-state">Ushbu janrda manhwa topilmadi</div>';
            return;
        }
        
        resultsContainer.innerHTML = '';
        const grid = document.createElement('div');
        grid.className = 'manhwa-grid';
        
        const fragment = document.createDocumentFragment();
        let renderedCount = 0;
        
        manhwas.forEach((manhwa, index) => {
            try {
                if (!manhwa || typeof manhwa !== 'object') {
                    console.warn(`[GENRE FILTER] Invalid manhwa at index ${index}`);
                    return;
                }
                
                const card = createManhwaCard(manhwa);
                if (card && fragment) {
                    fragment.appendChild(card);
                    renderedCount++;
                }
            } catch (err) {
                console.warn(`[GENRE FILTER] Error creating card at index ${index}:`, err);
            }
        });
        
        if (fragment && fragment.childNodes.length > 0 && grid && resultsContainer) {
            grid.appendChild(fragment);
            resultsContainer.appendChild(grid);
            console.log(`[GENRE FILTER] ${renderedCount} natija "${genreName}" janri uchun render qilindi`);
        } else {
            resultsContainer.innerHTML = '<div class="empty-state">Natijalar ko\'rsatilmadi</div>';
        }
    } catch (err) {
        console.error('[GENRE FILTER] CRITICAL error in renderFilteredResults:', err);
        const resultsContainer = document.getElementById('search-results');
        if (resultsContainer) {
            resultsContainer.innerHTML = '<div class="empty-state">Natijalar yuklanmadi</div>';
        }
    }
}

/**
 * Render search results (text search)
 */
function renderSearchResults(query) {
    // DOM FAIL-SAFE: Never throw, always handle gracefully
    try {
        const genreHubSection = document.getElementById('genre-hub-section');
        const searchResultsSection = document.getElementById('search-results-section');
        const clearFilterBtn = document.getElementById('clear-filter-btn');
        const resultsTitle = document.getElementById('filtered-results-title');
        const resultsContainer = document.getElementById('search-results');
        
        if (!resultsContainer) {
            console.warn('[SEARCH] Results container not found');
            return;
        }
        
        const searchQuery = (query || '').toLowerCase().trim();
        
        if (searchQuery.length === 0) {
            // Show genre hub, hide results (user cleared search)
            try {
                if (genreHubSection) {
                    genreHubSection.style.display = 'block';
                }
                if (searchResultsSection) {
                    searchResultsSection.style.display = 'none';
                }
                if (clearFilterBtn) {
                    clearFilterBtn.style.display = 'none';
                }
                if (resultsContainer) {
                    resultsContainer.innerHTML = '';
                }
            } catch (displayErr) {
                console.warn('[SEARCH] Error showing/hiding sections:', displayErr);
            }
            return;
        }
        
        // Show search results (genre hub removed)
        try {
            if (searchResultsSection) {
                searchResultsSection.style.display = 'block';
                console.log('[SEARCH] ✅ Results section displayed');
            }
            if (clearFilterBtn) {
                clearFilterBtn.style.display = 'none';
            }
            if (resultsTitle) {
                resultsTitle.textContent = `"${query}" qidiruv natijalari`;
            }
        } catch (displayErr) {
            console.warn('[SEARCH] Error updating display:', displayErr);
        }
        
        // DATA FAIL-SAFE: Check if data is loaded before filtering
        if (!manhwasData || !Array.isArray(manhwasData) || manhwasData.length === 0) {
            resultsContainer.innerHTML = '<div class="empty-state">Ma\'lumotlar yuklanmoqda...</div>';
            // Try to load data and retry
            loadData().then(() => {
                renderSearchResults(query);
            }).catch(() => {
                resultsContainer.innerHTML = '<div class="empty-state">Ma\'lumotlar yuklanmadi</div>';
            });
            return;
        }
        
        // EPIC: Enhanced search - title, description, genres
        const results = manhwasData.filter(manhwa => {
            try {
                if (!manhwa || typeof manhwa !== 'object') return false;
                const title = (manhwa.title || '').toLowerCase();
                const description = (manhwa.description || '').toLowerCase();
                const genres = (manhwa.genres || []).map(g => g.toLowerCase()).join(' ');
                const slug = (manhwa.slug || '').toLowerCase();
                
                return title.includes(searchQuery) || 
                       description.includes(searchQuery) ||
                       genres.includes(searchQuery) ||
                       slug.includes(searchQuery);
            } catch (err) {
                return false;
            }
        });
        
        // Update results count BEFORE showing results
        const resultsCount = document.getElementById('search-results-count');
        if (resultsCount) {
            resultsCount.textContent = `${results.length} ta natija topildi`;
        }
        
        if (results.length === 0) {
            resultsContainer.innerHTML = '<div class="empty-state">Natija topilmadi</div>';
            return;
        }
        
        // Grid yaratish - index'dagi manhwa-grid bilan bir xil (safe)
        try {
            resultsContainer.innerHTML = '';
            const grid = document.createElement('div');
            grid.className = 'manhwa-grid';
            
            const fragment = document.createDocumentFragment();
            let renderedCount = 0;
            
            results.forEach((manhwa, index) => {
                try {
                    if (!manhwa || typeof manhwa !== 'object') {
                        console.warn(`[SEARCH] Invalid manhwa at index ${index}`);
                        return;
                    }
                    
                    const card = createManhwaCard(manhwa);
                    if (card && fragment) {
                        fragment.appendChild(card);
                        renderedCount++;
                    }
                } catch (err) {
                    console.warn(`[SEARCH] Error creating card at index ${index}:`, err);
                }
            });
            
            if (fragment && fragment.childNodes.length > 0 && grid) {
                grid.appendChild(fragment);
                resultsContainer.appendChild(grid);
                console.log(`[SEARCH] ✅ Rendered ${renderedCount} results for query: "${query}"`);
            } else {
                resultsContainer.innerHTML = '<div class="empty-state">Natijalar render qilinmadi</div>';
            }
        } catch (gridErr) {
            console.error('[SEARCH] Error creating results grid:', gridErr);
            resultsContainer.innerHTML = '<div class="empty-state">Natijalar ko\'rsatilmadi</div>';
        }
    } catch (err) {
        console.error('[SEARCH] CRITICAL error in renderSearchResults:', err);
        const resultsContainer = document.getElementById('search-results');
        if (resultsContainer) {
            resultsContainer.innerHTML = '<div class="empty-state">Qidiruv xatosi</div>';
        }
    }
}

/**
 * Get recent comments from localStorage
 */
function getRecentComments(limit = 10) {
    try {
        const commentsStr = localStorage.getItem('azura_comments');
        if (!commentsStr) return [];
        
        const comments = JSON.parse(commentsStr);
        if (!Array.isArray(comments)) return [];
        
        // Sort by timestamp (newest first)
        const sorted = [...comments].sort((a, b) => {
            const timeA = a.timestamp || 0;
            const timeB = b.timestamp || 0;
            return timeB - timeA;
        });
        
        return sorted.slice(0, limit);
    } catch (err) {
        console.warn('[COMMENTS] Error loading comments:', err);
        return [];
    }
}


/**
 * Get time ago string (e.g., "2 soat oldin")
 */
function getTimeAgo(date) {
    // SAFE: Never throw, always return valid string
    try {
        if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
            return 'Endi';
        }
        
        const now = new Date();
        const diffMs = now - date;
        
        if (diffMs < 0) {
            return 'Endi';
        }
        
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        
        if (diffMins < 1) {
            return 'Endi';
        } else if (diffMins < 60) {
            return `${diffMins} minut oldin`;
        } else if (diffHours < 24) {
            return `${diffHours} soat oldin`;
        } else if (diffDays < 7) {
            return `${diffDays} kun oldin`;
        } else {
            try {
                return date.toLocaleDateString('uz-UZ');
            } catch (localeErr) {
                return `${diffDays} kun oldin`;
            }
        }
    } catch (err) {
        console.warn('[TIME] Error in getTimeAgo:', err);
        return 'Endi';
    }
}

function setupSearchPage() {
    // DOM FAIL-SAFE: Never throw, always handle gracefully
    console.log('[SEARCH] STEP 1: Search page setup STARTED');
    
    try {
        // DOM CHECK: Ensure we're on search page
        try {
            const pageType = getPageType();
            if (pageType !== 'search') {
                console.warn('[SEARCH] Not on search page, skipping setup');
                return;
            }
        } catch (pageErr) {
            console.warn('[SEARCH] Page type check failed, continuing anyway:', pageErr);
        }
        
        console.log('[SEARCH] STEP 2: Search page setup (auth tekshiruvi YO\'Q, Genre Hub)');
        
        // Genre cards removed - moved to hamburger menu
        console.log('[SEARCH] STEP 3: Genre cards removed (moved to sidebar menu)');
        
        // Search input handler (CRITICAL: Must work for search to function)
        console.log('[SEARCH] STEP 5: Setting up search input handler');
        try {
            const searchInput = document.getElementById('search-input');
            if (searchInput) {
                // Event listener faqat 1 marta
                if (searchInput.dataset.listenerAdded !== 'true') {
                    searchInput.dataset.listenerAdded = 'true';
                    
                    console.log('[SEARCH] STEP 5.1: Adding input event listener');
                    searchInput.addEventListener('input', (e) => {
                        try {
                            const query = e.target?.value || '';
                            console.log(`[SEARCH] Input changed: "${query}"`);
                            
                            // Show loading
                            const loadingContainer = document.getElementById('search-loading-container');
                            if (loadingContainer) {
                                loadingContainer.style.display = 'flex';
                            }
                            
                            // Hide loading after results render
                            setTimeout(() => {
                                if (loadingContainer) {
                                    loadingContainer.style.display = 'none';
                                }
                            }, 800);
                            
                            // Render results with delay for better UX
                            setTimeout(() => {
                                renderSearchResults(query);
                            }, 300);
                        } catch (err) {
                            console.error('[SEARCH] Input handler error:', err);
                            const loadingContainer = document.getElementById('search-loading-container');
                            if (loadingContainer) {
                                loadingContainer.style.display = 'none';
                            }
                        }
                    });
                    console.log('[SEARCH] STEP 5.1 OK: Input listener added');
                } else {
                    console.log('[SEARCH] STEP 5.1 SKIP: Input listener already added');
                }
            } else {
                console.warn('[SEARCH] STEP 5 WARNING: Search input element not found');
            }
        } catch (inputErr) {
            console.error('[SEARCH] STEP 5 ERROR: Search input setup failed:', inputErr);
        }
        
        // Clear filter button - setup click handler (non-blocking)
        console.log('[SEARCH] STEP 6: Setting up clear filter button');
        try {
            const clearFilterBtn = document.getElementById('clear-filter-btn');
            if (clearFilterBtn) {
                clearFilterBtn.style.display = 'none';
                // Handler will be set in filterByGenre (non-critical)
                console.log('[SEARCH] STEP 6 OK: Clear filter button ready');
            }
        } catch (btnErr) {
            console.warn('[SEARCH] STEP 6 WARNING: Clear filter button setup failed:', btnErr);
        }
        
        // Ensure initial state: results hidden (non-blocking)
        console.log('[SEARCH] STEP 7: Setting initial display state');
        try {
            const searchResultsSection = document.getElementById('search-results-section');
            if (searchResultsSection) {
                searchResultsSection.style.display = 'none';
            }
            console.log('[SEARCH] STEP 7 OK: Initial state set');
        } catch (displayErr) {
            console.warn('[SEARCH] STEP 7 WARNING: Display state setup failed:', displayErr);
        }
        
        // EPIC: Setup search page comments (with retry after data loads)
        setupSearchPageComments();
        
        // Retry comments setup after data loads (if data not ready)
        if (!manhwasData || manhwasData.length === 0) {
            loadData().then(() => {
                console.log('[SEARCH] Data loaded, retrying comments setup...');
                setupSearchPageComments();
            }).catch(() => {
                console.warn('[SEARCH] Data load failed, comments may not show covers');
            });
        }
        
        // EPIC: Setup search input clear button
        setupSearchClearButton();
        
        // EPIC: Setup loading animation
        setupSearchLoading();
        
        // EPIC: Ensure search sidebar toggle is set up (retry if needed)
        const setupSearchSidebarToggle = () => {
            const searchToggle = document.getElementById('search-sidebar-toggle');
            const sidebarMenu = document.getElementById('sidebar-menu');
            
            if (searchToggle && sidebarMenu) {
                // Remove old listener if exists
                const newToggle = searchToggle.cloneNode(true);
                searchToggle.parentNode.replaceChild(newToggle, searchToggle);
                
                const currentToggle = document.getElementById('search-sidebar-toggle');
                if (currentToggle) {
                    currentToggle.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log('[SEARCH] Search sidebar toggle clicked');
                        hapticFeedback('light');
                        sidebarMenu.classList.toggle('active');
                        if (sidebarMenu.classList.contains('active')) {
                            document.body.style.overflow = 'hidden';
                        } else {
                            document.body.style.overflow = '';
                        }
                    });
                    console.log('[SEARCH] ✅ Search sidebar toggle setup complete');
                    return true;
                }
            }
            return false;
        };
        
        // Try immediately
        if (!setupSearchSidebarToggle()) {
            // Retry after delay
            setTimeout(() => {
                if (!setupSearchSidebarToggle()) {
                    console.warn('[SEARCH] ⚠️ Search sidebar toggle setup failed after retry');
                }
            }, 300);
        }
        
        console.log('[SEARCH] Search page setup COMPLETE');
    } catch (err) {
        console.error('[SEARCH] CRITICAL error in setupSearchPage:', err);
        // Never throw - search page setup is non-critical for site stability
    }
}

// ============================================
// MANHWA DETAIL PAGE
// ============================================

function renderManhwaPage() {
    // Manhwa detail sahifa render - AUTH TEKSHRUV YO'Q, FAIL-SAFE
    // Page load'da darrov ishlaydi, login so'ramaydi
    console.log('[RENDER] Manhwa page render boshlandi (auth tekshiruvi YO\'Q)');
    
    try {
        // DOM FAIL-SAFE: Check if required elements exist
        if (!document || !document.body) {
            console.warn('[MANHWA] DOM not ready, skipping render');
            return;
        }
        
        const urlParams = new URLSearchParams(window.location.search);
        const manhwaId = urlParams.get('id');
        
        if (!manhwaId) {
            const titleEl = document.getElementById('detail-title');
            if (titleEl) {
                titleEl.textContent = 'ID topilmadi';
            }
            const chaptersList = document.getElementById('chapters-list');
            if (chaptersList) {
                chaptersList.innerHTML = '<div class="empty-state">ID topilmadi</div>';
            }
            return;
        }
        
        // DATA FAIL-SAFE: Check if data is loaded
        if (!manhwasData || !Array.isArray(manhwasData) || manhwasData.length === 0) {
            const titleEl = document.getElementById('detail-title');
            if (titleEl) {
                titleEl.textContent = 'Ma\'lumotlar yuklanmoqda...';
            }
            const chaptersList = document.getElementById('chapters-list');
            if (chaptersList) {
                chaptersList.innerHTML = '<div class="empty-state">Ma\'lumotlar yuklanmoqda...</div>';
            }
            
            // Try to load data and re-render
            loadData().then(() => {
                renderManhwaPage();
            }).catch(err => {
                console.error('[MANHWA] Data load failed:', err);
                if (titleEl) titleEl.textContent = 'Manhwa topilmadi';
                if (chaptersList) chaptersList.innerHTML = '<div class="empty-state">Ma\'lumotlar yuklanmadi</div>';
            });
            return;
        }
        
        // Manhwa'ni topish
        const manhwa = manhwasData.find(m => {
            try {
                return (m && (m.id === manhwaId || m.slug === manhwaId));
            } catch (err) {
                return false;
            }
        });
        
        if (!manhwa) {
            const titleEl = document.getElementById('detail-title');
            if (titleEl) {
                titleEl.textContent = 'Manhwa topilmadi';
            }
            const chaptersList = document.getElementById('chapters-list');
            if (chaptersList) {
                chaptersList.innerHTML = '<div class="empty-state">Manhwa topilmadi</div>';
            }
            return;
        }
        
        // Ma'lumotlarni ko'rsatish (all inside try block)
        const coverEl = document.getElementById('detail-cover');
        const titleEl = document.getElementById('detail-title');
        const ratingEl = document.querySelector('#detail-rating .rating-value');
        const chaptersEl = document.getElementById('detail-chapters');
        const viewsEl = document.getElementById('detail-views');
        const genresEl = document.getElementById('detail-genres');
        const descriptionEl = document.getElementById('detail-description');
        const starsEl = document.querySelector('#detail-rating .stars');
        
        if (coverEl) {
            coverEl.src = manhwa.cover || 'assets/logo.svg';
            coverEl.alt = manhwa.title || 'Manhwa';
            coverEl.onerror = function() {
                if (this) this.src = 'assets/logo.svg';
            };
        }
        
        if (titleEl) {
            const title = manhwa.title || 'Noma\'lum';
            titleEl.textContent = title;
            try {
                document.title = `${title} - AZURA`;
            } catch (e) {
                // Ignore title setting errors
            }
        }
        
        // Get manhwa ID for use throughout
        const currentManhwaId = manhwa.id || manhwa.slug || '';
        
        // Add to history (track last opened manhwas) - non-blocking
        if (currentManhwaId) {
            try {
                addToHistory(currentManhwaId);
            } catch (err) {
                console.warn('[MANHWA] Error adding to history:', err);
            }
        }
        
        // Update rating display with calculated average
        try {
            const avgRating = currentManhwaId ? calculateAverageRating(currentManhwaId) : null;
            const ratingData = currentManhwaId ? getManhwaRating(currentManhwaId) : null;
            const ratingCount = ratingData?.ratingCount || 0;
            
            if (ratingEl) {
                if (avgRating !== null && avgRating > 0) {
                    ratingEl.textContent = `${formatRating(avgRating)} (${ratingCount} ${ratingCount === 1 ? 'ovoz' : 'ovoz'})`;
                } else {
                    ratingEl.textContent = '0.0 (0 ovoz)';
                }
            }
            
            if (starsEl) {
                starsEl.innerHTML = '';
                if (avgRating !== null && avgRating > 0) {
                    const starDisplay = createStarDisplay(avgRating, 'medium');
                    if (starDisplay) starsEl.appendChild(starDisplay);
                } else {
                    starsEl.innerHTML = '<span class="star-empty">⭐</span><span class="star-empty">⭐</span><span class="star-empty">⭐</span><span class="star-empty">⭐</span><span class="star-empty">⭐</span>';
                }
            }
        } catch (err) {
            console.warn('[MANHWA] Error updating rating display:', err);
        }
        
        // Setup favorite button (non-blocking)
        try {
            let favoriteBtn = document.getElementById('favorite-btn');
            if (favoriteBtn && currentManhwaId) {
                // Remove existing listener if any
                if (favoriteBtn.dataset.listenerAdded === 'true') {
                    try {
                        // Clone to remove all event listeners
                        const newBtn = favoriteBtn.cloneNode(true);
                        if (favoriteBtn.parentNode) {
                            favoriteBtn.parentNode.replaceChild(newBtn, favoriteBtn);
                            favoriteBtn = document.getElementById('favorite-btn');
                        }
                    } catch (err) {
                        console.warn('[MANHWA] Error cloning favorite button:', err);
                    }
                }
                
                // Set initial state
                try {
                    const isFav = isFavorite(currentManhwaId);
                    favoriteBtn.classList.toggle('active', isFav);
                    favoriteBtn.dataset.listenerAdded = 'true';
                    
                    favoriteBtn.addEventListener('click', (e) => {
                        try {
                            e.preventDefault();
                            e.stopPropagation();
                            
                            if (isFavorite(currentManhwaId)) {
                                removeFromFavorites(currentManhwaId);
                                favoriteBtn.classList.remove('active');
                                console.log('[FAVORITES] Removed from favorites:', currentManhwaId);
                            } else {
                                addToFavorites(currentManhwaId);
                                favoriteBtn.classList.add('active');
                                console.log('[FAVORITES] Added to favorites:', currentManhwaId);
                            }
                        } catch (err) {
                            console.error('[MANHWA] Favorite button click error:', err);
                        }
                    });
                } catch (err) {
                    console.warn('[MANHWA] Error setting up favorite button:', err);
                }
            }
        } catch (err) {
            console.warn('[MANHWA] Error with favorite button:', err);
        }
        
        // Add interactive rating component (non-blocking)
        try {
            const detailInfoEl = document.querySelector('.detail-info');
            if (detailInfoEl && currentManhwaId) {
                // Remove existing interactive rating if any
                const existingInteractive = detailInfoEl.querySelector('.interactive-star-rating');
                if (existingInteractive) {
                    existingInteractive.remove();
                }
                
                // Get user's current rating
                const userRating = getUserRating(currentManhwaId);
                
                // Create interactive rating component
                const interactiveRating = createInteractiveStarRating(currentManhwaId, userRating);
                
                if (interactiveRating) {
                    // Insert after genres section, before description
                    const genresEl = document.getElementById('detail-genres');
                    const descriptionEl = document.getElementById('detail-description');
                    
                    if (genresEl && genresEl.nextSibling) {
                        detailInfoEl.insertBefore(interactiveRating, genresEl.nextSibling);
                    } else if (descriptionEl) {
                        detailInfoEl.insertBefore(interactiveRating, descriptionEl);
                    } else {
                        detailInfoEl.appendChild(interactiveRating);
                    }
                }
            }
        } catch (err) {
            console.warn('[MANHWA] Error adding interactive rating:', err);
        }
        
        if (chaptersEl) {
            chaptersEl.textContent = '0 bob';
        }
        
        if (viewsEl) {
            const views = manhwa.views || 0;
            viewsEl.textContent = `${views} ko'rish`;
        }
        
        if (genresEl) {
            if (Array.isArray(manhwa.genres) && manhwa.genres.length > 0) {
                try {
                    genresEl.innerHTML = manhwa.genres.map(genre => 
                        `<span class="genre-tag">${genre || ''}</span>`
                    ).join('');
                } catch (err) {
                    console.warn('[MANHWA] Error rendering genres:', err);
                    genresEl.innerHTML = '';
                }
            } else {
                genresEl.innerHTML = '';
            }
        }
        
        if (descriptionEl) {
            descriptionEl.textContent = manhwa.description || 'Tavsif mavjud emas.';
        }
        
        const chaptersList = document.getElementById('chapters-list');
        if (chaptersList) {
            chaptersList.innerHTML = '<div class="empty-state">Boblar tez orada qo\'shiladi</div>';
        }
        
        // Start reading button - Open chapter selector modal
        try {
            const startReadingBtn = document.getElementById('start-reading-btn');
            if (startReadingBtn && startReadingBtn.dataset.listenerAdded !== 'true') {
                startReadingBtn.dataset.listenerAdded = 'true';
                startReadingBtn.addEventListener('click', () => {
                    try {
                        // Add to currently reading
                        if (currentManhwaId) {
                            addToCurrentlyReading(currentManhwaId);
                            console.log('[READING] Added to currently reading:', currentManhwaId);
                        }
                        // Open chapter selector modal
                        openChapterSelectorModal(currentManhwaId, manhwa);
                    } catch (err) {
                        console.error('[MANHWA] Error in start reading button:', err);
                    }
                });
            }
        } catch (err) {
            console.warn('[MANHWA] Error setting up start reading button:', err);
        }
        
        console.log(`[RENDER] Manhwa detail render qilindi: ${manhwa.title || 'Noma\'lum'}`);
        
        // CRITICAL: Setup comment form and render comments after page render
        try {
            setupCommentForm();
            renderComments(currentManhwaId);
        } catch (commentErr) {
            console.warn('[COMMENT] Error setting up comments on detail page:', commentErr);
        }
    } catch (err) {
        console.error('[MANHWA] Critical error in renderManhwaPage:', err);
        // Show error state
        const titleEl = document.getElementById('detail-title');
        const chaptersList = document.getElementById('chapters-list');
        if (titleEl) {
            titleEl.textContent = 'Xatolik yuz berdi';
        }
        if (chaptersList) {
            chaptersList.innerHTML = '<div class="empty-state">Sahifa yuklanmadi</div>';
        }
    }
}

// ============================================
// CHAPTER SELECTOR MODAL
// ============================================

/**
 * Open chapter selector modal and populate with chapters
 */
function openChapterSelectorModal(manhwaId, manhwa) {
    try {
        const modal = document.getElementById('chapter-selector-modal');
        if (!modal) {
            console.warn('[CHAPTER SELECTOR] Modal not found');
            return;
        }
        
        // Get chapters from manhwa data
        const chapters = manhwa && manhwa.chapters ? manhwa.chapters : [];
        
        // Populate modal with chapters
        populateChapterSelector(chapters, manhwaId);
        
        // Show modal
        modal.classList.add('active');
        
        // Setup close handlers
        setupChapterSelectorCloseHandlers();
        
        console.log('[CHAPTER SELECTOR] Modal opened with', chapters.length, 'chapters');
    } catch (err) {
        console.error('[CHAPTER SELECTOR] Error opening modal:', err);
    }
}

/**
 * Populate chapter selector list with chapters
 */
function populateChapterSelector(chapters, manhwaId) {
    try {
        const list = document.getElementById('chapter-selector-list');
        if (!list) {
            console.warn('[CHAPTER SELECTOR] List element not found');
            return;
        }
        
        // Clear existing content
        list.innerHTML = '';
        
        if (!chapters || chapters.length === 0) {
            list.innerHTML = '<div class="empty-state" style="padding: var(--spacing-xl); text-align: center; color: var(--text-secondary);">Boblar hali qo\'shilmagan</div>';
            return;
        }
        
        // Get read chapters from localStorage
        const readChapters = getReadChapters(manhwaId);
        
        // Create chapter items
        const fragment = document.createDocumentFragment();
        chapters.forEach((chapter, index) => {
            try {
                const item = document.createElement('div');
                item.className = 'chapter-selector-item';
                item.dataset.chapterIndex = index;
                item.dataset.manhwaId = manhwaId;
                
                // Check if chapter is read
                if (readChapters && readChapters.includes(index)) {
                    item.classList.add('read');
                }
                
                const number = document.createElement('div');
                number.className = 'chapter-selector-number';
                number.textContent = `Bob ${index + 1}`;
                
                const arrow = document.createElement('div');
                arrow.className = 'chapter-selector-arrow';
                arrow.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>';
                
                item.appendChild(number);
                item.appendChild(arrow);
                
                // Click handler
                item.addEventListener('click', () => {
                    try {
                        selectChapter(manhwaId, index);
                    } catch (err) {
                        console.error('[CHAPTER SELECTOR] Error selecting chapter:', err);
                    }
                });
                
                fragment.appendChild(item);
            } catch (err) {
                console.warn('[CHAPTER SELECTOR] Error creating chapter item:', err);
            }
        });
        
        list.appendChild(fragment);
    } catch (err) {
        console.error('[CHAPTER SELECTOR] Error populating list:', err);
    }
}

/**
 * Get read chapters for a manhwa from localStorage
 */
function getReadChapters(manhwaId) {
    try {
        if (!manhwaId) return [];
        
        const stored = localStorage.getItem('azura_read_chapters');
        if (!stored) return [];
        
        const data = JSON.parse(stored);
        if (!data || typeof data !== 'object') return [];
        
        return data[manhwaId] || [];
    } catch (err) {
        console.warn('[CHAPTER SELECTOR] Error getting read chapters:', err);
        return [];
    }
}

/**
 * Mark chapter as read in localStorage
 */
function markChapterAsRead(manhwaId, chapterIndex) {
    try {
        if (!manhwaId || typeof chapterIndex !== 'number') return;
        
        const stored = localStorage.getItem('azura_read_chapters');
        let data = stored ? JSON.parse(stored) : {};
        if (typeof data !== 'object') data = {};
        
        if (!data[manhwaId]) {
            data[manhwaId] = [];
        }
        
        if (!data[manhwaId].includes(chapterIndex)) {
            data[manhwaId].push(chapterIndex);
            localStorage.setItem('azura_read_chapters', JSON.stringify(data));
        }
    } catch (err) {
        console.warn('[CHAPTER SELECTOR] Error marking chapter as read:', err);
    }
}

/**
 * Handle chapter selection - navigate to reader
 */
function selectChapter(manhwaId, chapterIndex) {
    try {
        // Close modal
        closeChapterSelectorModal();
        
        // Mark as read (optional - can be done after reading)
        // markChapterAsRead(manhwaId, chapterIndex);
        
        // Navigate to reader page
        const readerUrl = `reader.html?id=${encodeURIComponent(manhwaId)}&chapter=${chapterIndex}`;
        window.location.href = readerUrl;
        
        console.log('[CHAPTER SELECTOR] Navigating to chapter:', chapterIndex, 'of manhwa:', manhwaId);
    } catch (err) {
        console.error('[CHAPTER SELECTOR] Error selecting chapter:', err);
    }
}

/**
 * Close chapter selector modal
 */
function closeChapterSelectorModal() {
    try {
        const modal = document.getElementById('chapter-selector-modal');
        if (modal) {
            modal.classList.remove('active');
        }
    } catch (err) {
        console.warn('[CHAPTER SELECTOR] Error closing modal:', err);
    }
}

/**
 * Setup close handlers for chapter selector modal
 */
function setupChapterSelectorCloseHandlers() {
    try {
        const modal = document.getElementById('chapter-selector-modal');
        const closeBtn = document.getElementById('chapter-selector-close');
        const overlay = modal ? modal.querySelector('.chapter-selector-overlay') : null;
        
        // Close button
        if (closeBtn && closeBtn.dataset.listenerAdded !== 'true') {
            closeBtn.dataset.listenerAdded = 'true';
            closeBtn.addEventListener('click', () => {
                closeChapterSelectorModal();
            });
        }
        
        // Overlay click
        if (overlay && overlay.dataset.listenerAdded !== 'true') {
            overlay.dataset.listenerAdded = 'true';
            overlay.addEventListener('click', () => {
                closeChapterSelectorModal();
            });
        }
        
        // ESC key
        const handleEsc = (e) => {
            if (e.key === 'Escape' && modal && modal.classList.contains('active')) {
                closeChapterSelectorModal();
                document.removeEventListener('keydown', handleEsc);
            }
        };
        document.addEventListener('keydown', handleEsc);
    } catch (err) {
        console.warn('[CHAPTER SELECTOR] Error setting up close handlers:', err);
    }
}

// ============================================
// CHANNELS PAGE
// ============================================

function renderChannelsPage() {
    // DOM FAIL-SAFE: Never throw, always handle gracefully
    try {
        console.log('[RENDER] Channels page render boshlandi');
        
        const channelsGrid = document.getElementById('channels-grid');
        if (!channelsGrid) {
            console.warn('[CHANNELS] Channels grid not found, skipping');
            return;
        }
        
        // DATA FAIL-SAFE: Check channelsData
        if (!channelsData || !Array.isArray(channelsData) || channelsData.length === 0) {
            channelsGrid.innerHTML = '<div class="empty-state">Kanallar topilmadi</div>';
            return;
        }
        
        channelsGrid.innerHTML = '';
        const fragment = document.createDocumentFragment();
        
        channelsData.forEach((channel, index) => {
            try {
                if (!channel || typeof channel !== 'object') {
                    console.warn('[CHANNELS] Invalid channel data at index:', index);
                    return;
                }
                
                const channelCard = document.createElement('a');
                channelCard.href = channel.link || '#';
                channelCard.target = '_blank';
                channelCard.rel = 'noopener noreferrer';
                channelCard.className = 'channel-card';
                
                const img = document.createElement('img');
                img.src = channel.logo || 'assets/logo.svg';
                img.alt = channel.name || 'Channel';
                img.className = 'channel-card-logo';
                img.onerror = function() {
                    if (this) this.src = 'assets/logo.svg';
                };
                
                const name = document.createElement('div');
                name.className = 'channel-card-name';
                name.textContent = channel.name || 'Channel';
                
                const desc = document.createElement('div');
                desc.className = 'channel-card-description';
                desc.textContent = channel.description || '';
                
                channelCard.appendChild(img);
                channelCard.appendChild(name);
                channelCard.appendChild(desc);
                fragment.appendChild(channelCard);
            } catch (err) {
                console.warn(`[CHANNELS] Error rendering channel at index ${index}:`, err);
            }
        });
        
        if (fragment && fragment.childNodes.length > 0) {
            channelsGrid.appendChild(fragment);
        }
        
        console.log(`[RENDER] Kanallar sahifasi render qilindi: ${channelsData.length} kanal`);
    } catch (err) {
        console.error('[CHANNELS] Critical error in renderChannelsPage:', err);
        const channelsGrid = document.getElementById('channels-grid');
        if (channelsGrid) {
            channelsGrid.innerHTML = '<div class="empty-state">Kanallar yuklanmadi</div>';
        }
    }
}

// ============================================
// HISTORY PAGE
// ============================================

function renderHistoryPage() {
    // DOM FAIL-SAFE: Never throw, always handle gracefully
    try {
        console.log('[RENDER] History page render boshlandi');
        
        const historyList = document.getElementById('history-list');
        if (!historyList) {
            console.warn('[HISTORY] History list not found, skipping');
            return;
        }
        
        // DATA FAIL-SAFE: Check if manhwasData is loaded FIRST
        if (!manhwasData || !Array.isArray(manhwasData) || manhwasData.length === 0) {
            historyList.innerHTML = '<div class="empty-state">Ma\'lumotlar yuklanmoqda...</div>';
            // Try to load data and re-render
            loadData().then(() => {
                renderHistoryPage();
            }).catch(() => {
                historyList.innerHTML = '<div class="empty-state">Ma\'lumotlar yuklanmadi</div>';
            });
            return;
        }
        
        // localStorage dan tarixni o'qish (CRITICAL FIX: Check both keys for compatibility)
        let history = [];
        try {
            // Try both keys - azura_history (used by addToHistory) and azura_reading_history (legacy)
            let historyData = localStorage.getItem('azura_history');
            if (!historyData) {
                historyData = localStorage.getItem('azura_reading_history');
            }
            
            if (historyData) {
                const parsed = JSON.parse(historyData);
                if (Array.isArray(parsed)) {
                    // Normalize format - convert array of IDs to array of objects if needed
                    if (parsed.length > 0) {
                        if (typeof parsed[0] === 'string') {
                            // Array of IDs - convert to objects
                            history = parsed.map(id => ({ manhwaId: id, chapter: 1 }));
                        } else {
                            // Array of objects - use as is
                            history = parsed;
                        }
                    }
                }
            }
        } catch (err) {
            console.warn('[HISTORY] Error reading history from localStorage:', err);
            history = [];
        }
        
        if (history.length === 0) {
            historyList.innerHTML = '<div class="empty-state">Tarix bo\'sh</div>';
            return;
        }
        
        historyList.innerHTML = '';
        const fragment = document.createDocumentFragment();
        let renderedCount = 0;
        
        history.forEach((item, index) => {
            try {
                if (!item) {
                    console.warn('[HISTORY] Invalid history item at index:', index);
                    return;
                }
                
                // Support both formats: { manhwaId, chapter } or just ID string
                const manhwaId = (typeof item === 'object' && item.manhwaId) ? item.manhwaId : (typeof item === 'string' ? item : '');
                if (!manhwaId || typeof manhwaId !== 'string') {
                    console.warn('[HISTORY] Invalid manhwaId at index:', index);
                    return;
                }
                
                const manhwa = manhwasData.find(m => {
                    try {
                        if (!m || typeof m !== 'object') return false;
                        return (m.id === manhwaId || m.slug === manhwaId);
                    } catch (err) {
                        return false;
                    }
                });
                
                if (!manhwa) {
                    console.warn('[HISTORY] Manhwa not found for ID:', manhwaId);
                    return; // Skip missing manhwas, don't crash
                }
                
                const historyItem = document.createElement('div');
                historyItem.className = 'history-item';
                
                const img = document.createElement('img');
                img.src = manhwa.cover || 'assets/logo.svg';
                img.alt = manhwa.title || 'Manhwa';
                img.className = 'history-image';
                img.onerror = function() {
                    if (this) this.src = 'assets/logo.svg';
                };
                
                const info = document.createElement('div');
                info.className = 'history-info';
                
                const title = document.createElement('div');
                title.className = 'history-title';
                title.textContent = manhwa.title || 'Noma\'lum';
                
                const progress = document.createElement('div');
                progress.className = 'history-progress';
                const chapter = (typeof item === 'object' && item.chapter) ? item.chapter : 1;
                progress.textContent = `Bob ${chapter}`;
                
                info.appendChild(title);
                info.appendChild(progress);
                
                historyItem.appendChild(img);
                historyItem.appendChild(info);
                
                historyItem.addEventListener('click', () => {
                    try {
                        if (manhwaId) {
                            window.location.href = `manhwa.html?id=${manhwaId}`;
                        }
                    } catch (err) {
                        console.error('[HISTORY] Error navigating to manhwa:', err);
                    }
                });
                
                if (fragment) fragment.appendChild(historyItem);
                renderedCount++;
            } catch (err) {
                console.warn(`[HISTORY] Error rendering history item at index ${index}:`, err);
            }
        });
        
        if (fragment && fragment.childNodes.length > 0 && historyList) {
            historyList.appendChild(fragment);
        } else if (renderedCount === 0 && history.length > 0) {
            historyList.innerHTML = '<div class="empty-state">Tarixda ma\'lumotlar topilmadi</div>';
        }
        
        console.log(`[RENDER] Tarix render qilindi: ${renderedCount} ta`);
    } catch (error) {
        console.error('[HISTORY] Critical error in renderHistoryPage:', error);
        const historyList = document.getElementById('history-list');
        if (historyList) {
            historyList.innerHTML = '<div class="empty-state">Tarix yuklanmadi</div>';
        }
    }
}

// ============================================
// NAVIGATION - COMPLETE
// ============================================

function navigateToInternalPage(pageId) {
    // DOM FAIL-SAFE: Never throw, always handle gracefully
    try {
        // CRITICAL: NO getPageType() check - directly navigate to prevent delays and home-page flash
        // If target page exists in DOM, navigate directly (we're on index.html)
        
        if (!pageId || typeof pageId !== 'string') {
            console.warn('[NAV] Invalid pageId:', pageId);
            return;
        }
        
        // Verify target page exists in DOM (single check)
        const targetPage = document.getElementById(pageId);
        if (!targetPage) {
            console.warn('[NAV] Target page not found in DOM:', pageId);
            return;
        }
        
        // Batch all DOM operations to prevent browser from showing home-page during transition
        const fragment = document.createDocumentFragment();
        
        // Step 1: Hide ALL pages (including home-page) - use direct style manipulation
        // CRITICAL: Do this in single synchronous batch to prevent any flash
        const allPages = document.querySelectorAll('.page');
        allPages.forEach(page => {
            try {
                if (page && page.id !== pageId) {
                    // Hide ALL pages except target with maximum priority inline styles
                    page.style.cssText = 'display: none !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; z-index: -1 !important; position: fixed !important; left: -9999px !important; top: -9999px !important; width: 0 !important; height: 0 !important; overflow: hidden !important; clip: rect(0,0,0,0) !important;';
                    // Remove .active class
                    if (page.classList) {
                        page.classList.remove('active');
                    }
                }
            } catch (err) {
                // Silent skip
            }
        });
        
        // Step 2: Force immediate synchronous paint BEFORE showing target page
        try {
            // Force reflow to hide all pages first
            if (document.body) {
                const reflow = document.body.offsetHeight;
                void reflow;
            }
            // Extra force for home-page specifically
            const homePage = document.getElementById('home-page');
            if (homePage && homePage.id !== pageId) {
                homePage.offsetHeight; // Force paint
                homePage.offsetWidth; // Force paint
            }
        } catch (err) {
            // Silent skip
        }
        
        // Step 3: Show ONLY target page AFTER all others are guaranteed hidden
        try {
            targetPage.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important; pointer-events: auto !important; z-index: 1 !important; position: relative !important; left: auto !important; top: auto !important; width: auto !important; height: auto !important; overflow: visible !important; clip: auto !important;';
            targetPage.classList.add('active');
            // Force immediate synchronous paint
            targetPage.offsetHeight;
            targetPage.offsetWidth;
        } catch (err) {
            console.error('[NAV] Error showing target page:', err);
            return;
        }
        
        // Step 4: FINAL TRIPLE CHECK - ensure home-page is absolutely hidden
        const homePage = document.getElementById('home-page');
        if (homePage && homePage.id !== pageId) {
            try {
                // Triple protection: force hide again with maximum priority
                homePage.style.cssText = 'display: none !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; z-index: -1 !important; position: fixed !important; left: -9999px !important; top: -9999px !important; width: 0 !important; height: 0 !important; overflow: hidden !important; clip: rect(0,0,0,0) !important;';
                homePage.classList.remove('active');
                // Force paint one more time
                homePage.offsetHeight;
                homePage.offsetWidth;
                // Set data attribute to mark as hidden (extra protection)
                homePage.setAttribute('data-hidden', 'true');
            } catch (finalErr) {
                // Silent skip
            }
        }
        
        // Step 5: Remove hidden marker from target page if present
        if (targetPage) {
            try {
                targetPage.removeAttribute('data-hidden');
            } catch (markerErr) {
                // Silent skip
            }
        }
        
        // NO cleanup - inline styles stay FOREVER to prevent any flash
        
        // CRITICAL: Update navigation active state (bottom nav buttons)
        try {
            const navItems = document.querySelectorAll('.nav-item');
            navItems.forEach(navItem => {
                try {
                    if (navItem && navItem.classList && navItem.dataset) {
                        const isActive = navItem.dataset.page === pageId;
                        navItem.classList.toggle('active', isActive);
                    }
                } catch (navErr) {
                    console.warn('[NAV] Error updating nav item state:', navErr);
                }
            });
            console.log(`[NAV] Navigation active state updated for: ${pageId}`);
        } catch (navStateErr) {
            console.warn('[NAV] Error updating navigation active state:', navStateErr);
        }
        
        // Scroll to top (non-blocking)
        try {
            const appRoot = document.querySelector('.app-root');
            if (appRoot) {
                appRoot.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        } catch (err) {
            // Fallback if smooth scroll fails
            try {
                const appRoot = document.querySelector('.app-root');
                if (appRoot) {
                    appRoot.scrollTo(0, 0);
                } else {
                    window.scrollTo(0, 0);
                }
            } catch (e) {
                console.warn('[NAV] Scroll failed:', e);
            }
        }
        
        // CRITICAL: Update body data-page attribute for getPageType() to work correctly
        try {
            const body = document.body;
            if (body) {
                // Map pageId to pageType
                let pageTypeAttr = 'index';
                if (pageId === 'search-page') pageTypeAttr = 'search';
                else if (pageId === 'channels-page') pageTypeAttr = 'channels';
                else if (pageId === 'history-page') pageTypeAttr = 'history';
                else if (pageId === 'detail-page') pageTypeAttr = 'manhwa';
                else if (pageId === 'reader-page') pageTypeAttr = 'reader';
                else if (pageId === 'home-page') pageTypeAttr = 'index';
                
                body.setAttribute('data-page', pageTypeAttr);
                console.log(`[NAV] Updated body data-page to: ${pageTypeAttr}`);
            }
        } catch (attrErr) {
            console.warn('[NAV] Error updating body data-page:', attrErr);
        }
        
        // Render page content IMMEDIATELY (don't delay - critical for UX)
        try {
            if (pageId === 'channels-page') {
                console.log('[NAV] Rendering channels page content');
                try {
                    renderChannelsPage();
                    console.log('[NAV] Channels page rendered');
                } catch (err) {
                    console.error('[NAV] Channels page render failed:', err);
                }
            } else if (pageId === 'history-page') {
                console.log('[NAV] Rendering history page content');
                try {
                    renderHistoryPage();
                    console.log('[NAV] History page rendered');
                } catch (err) {
                    console.error('[NAV] History page render failed:', err);
                }
            } else if (pageId === 'search-page') {
                console.log('[NAV] ⚡ Setting up search page (FULL SETUP - IMMEDIATE)');
                try {
                    // CRITICAL: Call setupSearchPage() to render genre cards
                    setupSearchPage();
                    console.log('[NAV] ✅ Search page setup complete (genre cards)');
                } catch (searchErr) {
                    console.error('[NAV] Error in setupSearchPage:', searchErr);
                    // Fallback: at least try to render genre cards
                    try {
                        renderGenreCards();
                    } catch (fallbackErr) {
                        console.error('[NAV] Fallback render also failed:', fallbackErr);
                    }
                }
            } else if (pageId === 'reader-page') {
                // Setup post-reading system when navigating to reader page
                // CRITICAL: Only initialize if actually on reader page
                try {
                    const readerPage = document.getElementById('reader-page');
                    if (readerPage && readerPage.classList.contains('active')) {
                        // Reset initialization flag when navigating to reader page
                        window.postReadingInitialized = false;
                        
                        setTimeout(() => {
                            try {
                                initializePostReadingSystem();
                            } catch (postErr) {
                                console.warn('[POST-READING] Error initializing on navigation:', postErr);
                                // Silent fail - don't block navigation
                            }
                        }, 500); // Small delay to ensure reader content is loaded
                    }
                } catch (postErr) {
                    console.warn('[POST-READING] Error checking reader page on navigation:', postErr);
                    // Silent fail - don't block navigation
                }
            }
        } catch (err) {
            console.error('[NAV] Error in page content render:', err);
            // Continue - navigation already succeeded
        }
        
        // Bottom nav active state (non-blocking)
        try {
            const navItems = document.querySelectorAll('.nav-item');
            navItems.forEach(item => {
                try {
                    if (item && item.classList && item.dataset) {
                        item.classList.toggle('active', item.dataset.page === pageId);
                    }
                } catch (err) {
                    console.warn('[NAV] Error updating nav item:', err);
                }
            });
        } catch (err) {
            console.error('[NAV] Error updating nav items:', err);
        }
        
        console.log(`[NAV] Internal page: ${pageId}`);
    } catch (err) {
        console.error('[NAV] Critical error in navigateToInternalPage:', err);
        // Never throw - navigation is non-critical
    }
}

// ============================================
// PROFILE ICON UPDATE - SHOW EMAIL/AVATAR IF LOGGED IN
// ============================================
function updateProfileIcon() {
    // DOM FAIL-SAFE: Only update if elements exist, never throw
    try {
        // Check if DOM is ready
        if (!document || !document.body) {
            console.warn('[PROFILE] DOM not ready, skipping icon update');
            return;
        }
        
        const profileBtns = document.querySelectorAll('.profile-btn');
        const profileAvatars = document.querySelectorAll('.profile-avatar');
        
        // If no elements found, skip silently (not an error)
        if (profileBtns.length === 0 && profileAvatars.length === 0) {
            return; // No profile elements on this page
        }
        
        const userStr = localStorage.getItem('azura_user');
        const loggedIn = localStorage.getItem('azura_logged_in') === 'true';
        
        if (!userStr || !loggedIn) {
            // User "kirmagan", default avatar qoladi
            profileAvatars.forEach(avatar => {
                try {
                    if (avatar && avatar.nodeType === 1) { // Element node check
                        // CRITICAL: Ensure default avatar is set
                        avatar.onerror = null;
                        avatar.src = 'assets/avatars/avatar-male.png';
                        avatar.alt = 'Profile';
                        avatar.title = 'Profile';
                        if (avatar.style) {
                            avatar.style.borderColor = 'var(--gold-primary)';
                        }
                        console.log('[PROFILE] Set default avatar for guest user');
                    }
                } catch (err) {
                    console.warn('[PROFILE] Error updating avatar:', err);
                }
            });
            profileBtns.forEach(btn => {
                try {
                    if (btn && btn.nodeType === 1) {
                        btn.title = 'Profile';
                        btn.setAttribute('aria-label', 'Profile');
                    }
                } catch (err) {
                    console.warn('[PROFILE] Error updating button:', err);
                }
            });
            return;
        }
        
        try {
            const user = JSON.parse(userStr);
            if (!user || typeof user !== 'object') {
                throw new Error('Invalid user object');
            }
            
            // Agar user "kirgan" bo'lsa, username/email va avatar ko'rsatamiz
            profileAvatars.forEach(avatar => {
                try {
                    if (!avatar || avatar.nodeType !== 1) return;
                    
                    const username = user.username || user.email || '';
                    let avatarUrl = null;
                    
                    // CRITICAL: Check custom avatar first (from unified system)
                    try {
                        const profileData = getUserProfile(username);
                        if (profileData && profileData.avatar) {
                            avatarUrl = profileData.avatar;
                            console.log('[PROFILE] Using custom avatar for:', username);
                        }
                    } catch (profileErr) {
                        console.warn('[PROFILE] Error getting custom avatar:', profileErr);
                    }
                    
                    // Fallback: Show Google avatar if available and no custom avatar
                    if (!avatarUrl && user.picture && user.provider === 'google') {
                        avatarUrl = user.picture;
                        console.log('[PROFILE] Using Google avatar for:', username);
                    }
                    
                    // Final fallback: default avatar
                    if (!avatarUrl) {
                        avatarUrl = 'assets/avatars/avatar-male.png';
                    }
                    
                    // CRITICAL: Validate avatar URL before setting
                    if (!avatarUrl || avatarUrl.trim() === '') {
                        avatarUrl = 'assets/avatars/avatar-male.png';
                    }
                    
                    // Check if URL is valid (starts with http, https, data:, or relative path)
                    const isValidUrl = avatarUrl.startsWith('http://') || 
                                      avatarUrl.startsWith('https://') || 
                                      avatarUrl.startsWith('data:') || 
                                      avatarUrl.startsWith('/') ||
                                      avatarUrl.startsWith('./') ||
                                      !avatarUrl.includes('://');
                    
                    if (!isValidUrl) {
                        console.warn('[PROFILE] Invalid avatar URL, using default:', avatarUrl);
                        avatarUrl = 'assets/avatars/avatar-male.png';
                    }
                    
                    // Set avatar image with proper error handling
                    avatar.src = avatarUrl;
                    
                    // CRITICAL: Remove any existing error handlers to prevent conflicts
                    avatar.onerror = null;
                    avatar.onload = null;
                    
                    // Set up error handler
                    avatar.onerror = function() {
                        console.warn('[PROFILE] Avatar failed to load:', this.src);
                        // Prevent infinite loop
                        if (this && this.src !== 'assets/avatars/avatar-male.png') {
                            this.onerror = null; // Remove handler to prevent loop
                            this.src = 'assets/avatars/avatar-male.png';
                            console.log('[PROFILE] Fallback to default avatar');
                        }
                    };
                    
                    // Set up load handler for debugging
                    avatar.onload = function() {
                        console.log('[PROFILE] Avatar loaded successfully:', this.src);
                    };
                    
                    const displayName = user.username || user.name || user.email || 'Profile';
                    avatar.alt = displayName;
                    avatar.title = displayName;
                    if (avatar.style) {
                        avatar.style.borderColor = 'var(--gold-primary)';
                    }
                } catch (err) {
                    console.error('[PROFILE] Error updating avatar element:', err);
                    // Ensure default avatar is set even on error
                    try {
                        if (avatar && avatar.nodeType === 1) {
                            avatar.onerror = null; // Remove any existing handlers
                            avatar.src = 'assets/avatars/avatar-male.png';
                            console.log('[PROFILE] Set default avatar due to error');
                        }
                    } catch (fallbackErr) {
                        console.error('[PROFILE] Error setting fallback avatar:', fallbackErr);
                    }
                }
            });
            
            // Profile button'ga title va aria-label qo'shamiz
            profileBtns.forEach(btn => {
                try {
                    if (!btn || btn.nodeType !== 1) return;
                    
                    const displayName = user.username || user.name || user.email || 'Profile';
                    btn.title = displayName;
                    btn.setAttribute('aria-label', `Profile: ${displayName}`);
                } catch (err) {
                    console.warn('[PROFILE] Error updating button element:', err);
                }
            });
            
            console.log('[PROFILE] Profile icon updated for:', user.username || user.email || 'User');
        } catch (err) {
            console.warn('[PROFILE] Error parsing user data:', err);
            // Fallback: clear invalid data (non-blocking)
            try {
                localStorage.removeItem('azura_user');
                localStorage.removeItem('azura_logged_in');
            } catch (e) {
                // Ignore localStorage errors
                console.warn('[PROFILE] Could not clear localStorage:', e);
            }
        }
    } catch (err) {
        console.error('[PROFILE] Critical error in updateProfileIcon:', err);
        // Never throw - this is a non-critical function
    }
}

// ============================================
// GET USER FROM LOCALSTORAGE (UTILITY)
// ============================================
function getCurrentUser() {
    const userStr = localStorage.getItem('azura_user');
    if (!userStr) return null;
    
    try {
        return JSON.parse(userStr);
    } catch (err) {
        console.warn('[AUTH] Invalid user data in localStorage');
        return null;
    }
}

function setupNavigation() {
    console.log('[NAV] STEP 1: Navigation setup STARTED');
    
    // ASYNC GUARD: Only setup if DOM is ready
    try {
        if (!document || !document.body) {
            console.warn('[NAV] DOM not ready, retrying in 100ms');
            setTimeout(setupNavigation, 100);
            return;
        }
    } catch (err) {
        console.error('[NAV] DOM check failed:', err);
        setTimeout(setupNavigation, 100);
        return;
    }
    
    console.log('[NAV] STEP 2: DOM ready, setting up navigation');
    
    try {
        // Bottom navigation - CRITICAL: This MUST work or site is unusable
        console.log('[NAV] STEP 3: Finding nav items');
        let navItems;
        try {
            navItems = document.querySelectorAll('.nav-item');
            console.log(`[NAV] STEP 3 OK: Found ${navItems.length} nav items`);
        } catch (err) {
            console.error('[NAV] STEP 3 ERROR: Cannot query nav items:', err);
            navItems = [];
        }
        
        if (navItems && navItems.length > 0) {
            console.log('[NAV] STEP 4: Setting up nav item click handlers');
            navItems.forEach((item, index) => {
                try {
                    if (!item || typeof item !== 'object') {
                        console.warn(`[NAV] Invalid nav item at index ${index}`);
                        return;
                    }
                    
                    // Skip if already set up (prevent duplicates)
                    if (item.dataset && item.dataset.listenerAdded === 'true') {
                        console.log(`[NAV] Nav item ${index} already has listener, skipping`);
                        return;
                    }
                    
                    // Mark as set up BEFORE adding listener to prevent race conditions
                    if (item.dataset) {
                        item.dataset.listenerAdded = 'true';
                    }
                    
                    console.log(`[NAV] STEP 4.${index}: Adding click handler to nav item with page=${item.dataset?.page || 'unknown'}`);
                    
                    item.addEventListener('click', (e) => {
                        console.log(`[NAV] Nav item clicked: ${item.dataset?.page || 'unknown'}`);
                        try {
                            e.preventDefault();
                            e.stopPropagation();
                            
                            // Haptic feedback for navigation
                            hapticFeedback('selection');
                            
                            const pageId = item?.dataset?.page;
                            if (!pageId || typeof pageId !== 'string') {
                                console.warn('[NAV] No valid pageId, ignoring click');
                                return;
                            }
                            
                            console.log(`[NAV] Navigating to: ${pageId}`);
                            
                            // CRITICAL: Always use internal navigation for index.html
                            // Check if target page exists in DOM - if yes, navigate directly
                            // NO getPageType() check - directly navigate to prevent home-page flash
                            const targetPageExists = document.getElementById(pageId);
                            
                            if (targetPageExists) {
                                // Internal page navigation (index.html ichida - switch between .page divs)
                                // DIRECT navigation - NO delays, NO getPageType(), NO home-page flash
                                console.log(`[NAV] Direct internal navigation to: ${pageId}`);
                                try {
                                    // Navigate IMMEDIATELY - no checks, no delays
                                    navigateToInternalPage(pageId);
                                    console.log(`[NAV] Navigation to ${pageId} complete`);
                                } catch (navErr) {
                                    console.error('[NAV] Navigation failed:', navErr);
                                    // Simplified fallback - same as navigateToInternalPage
                                    try {
                                        // Hide ALL pages with inline style FIRST (including home-page)
                                        const allPages = document.querySelectorAll('.page');
                                        allPages.forEach(p => {
                                            if (p && p.id !== pageId) {
                                                p.style.cssText = 'display: none !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; z-index: -1 !important; position: fixed !important; left: -9999px !important; top: -9999px !important; width: 0 !important; height: 0 !important; overflow: hidden !important; clip: rect(0,0,0,0) !important;';
                                                p.classList.remove('active');
                                                p.setAttribute('data-hidden', 'true');
                                            }
                                        });
                                        // Force immediate paint
                                        void document.body.offsetHeight;
                                        // Show target page
                                        const targetPage = document.getElementById(pageId);
                                        if (targetPage) {
                                            targetPage.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important; pointer-events: auto !important; z-index: 1 !important; position: relative !important; left: auto !important; top: auto !important; width: auto !important; height: auto !important; overflow: visible !important; clip: auto !important;';
                                            targetPage.classList.add('active');
                                            targetPage.removeAttribute('data-hidden');
                                            // Force immediate paint
                                            targetPage.offsetHeight;
                                            targetPage.offsetWidth;
                                            // Update nav active state
                                            navItems.forEach(nav => {
                                                if (nav && nav.classList && nav.dataset) {
                                                    nav.classList.toggle('active', nav.dataset.page === pageId);
                                                }
                                            });
                                            console.log('[NAV] Fallback navigation succeeded');
                                        } else {
                                            console.error(`[NAV] Target page element not found: ${pageId}`);
                                        }
                                    } catch (fallbackErr) {
                                        console.error('[NAV] Fallback navigation also failed:', fallbackErr);
                                    }
                                }
                            } else {
                                // External navigation (boshqa HTML fayllardan)
                                console.log('[NAV] Using external navigation');
                                try {
                                    if (pageId === 'home-page') {
                                        window.location.href = 'index.html';
                                    } else if (pageId === 'search-page') {
                                        window.location.href = 'search.html';
                                    } else if (pageId === 'channels-page') {
                                        try {
                                            if (sessionStorage) {
                                                sessionStorage.setItem('azura_target_page', 'channels-page');
                                            }
                                        } catch (storageErr) {
                                            console.warn('[NAV] SessionStorage failed:', storageErr);
                                        }
                                        window.location.href = 'index.html';
                                    } else if (pageId === 'history-page') {
                                        try {
                                            if (sessionStorage) {
                                                sessionStorage.setItem('azura_target_page', 'history-page');
                                            }
                                        } catch (storageErr) {
                                            console.warn('[NAV] SessionStorage failed:', storageErr);
                                        }
                                        window.location.href = 'index.html';
                                    } else {
                                        console.warn(`[NAV] Unknown pageId for external nav: ${pageId}`);
                                    }
                                } catch (externalErr) {
                                    console.error('[NAV] External navigation failed:', externalErr);
                                }
                            }
                        } catch (err) {
                            console.error('[NAV] CRITICAL: Navigation click handler error:', err);
                            // Don't block - at least try basic navigation
                            try {
                                const pageId = item?.dataset?.page;
                                if (pageId === 'home-page') {
                                    window.location.href = 'index.html';
                                }
                            } catch (finalErr) {
                                console.error('[NAV] Final fallback navigation failed:', finalErr);
                            }
                        }
                    });
                    console.log(`[NAV] STEP 4.${index} OK: Click handler added`);
                } catch (err) {
                    console.error(`[NAV] STEP 4.${index} ERROR: Failed to setup nav item:`, err);
                }
            });
            console.log('[NAV] STEP 4 OK: All nav item handlers set up');
        } else {
            console.warn('[NAV] STEP 4 WARNING: No nav items found - navigation will not work');
        }
        
        // ============================================
        // PROFILE BUTTON - HANDLE ON ALL PAGES (ISOLATED, NON-BLOCKING)
        // ============================================
        console.log('[NAV] STEP 5: Setting up profile button handlers');
        try {
            // CRITICAL: Profile button works on ALL pages, but auth check is OPTIONAL
            // Index page: profile button → auth.html (no check)
            // Other pages: profile button → profile.html if logged in, else auth.html
            if (!document.body.dataset || document.body.dataset.profileListenerAdded !== 'true') {
                if (document.body.dataset) {
                    document.body.dataset.profileListenerAdded = 'true';
                }
                
                console.log('[NAV] STEP 5.1: Adding profile button delegation');
                document.body.addEventListener('click', (e) => {
                    try {
                        // Check if click is on profile button or inside it
                        const profileBtn = e.target.closest ? e.target.closest('.profile-btn') : null;
                        if (!profileBtn) {
                            // Also check if clicked element itself is profile-btn
                            if (!e.target.classList || !e.target.classList.contains('profile-btn')) {
                                return;
                            }
                            // e.target is the profile button
                        }
                        
                        const targetBtn = profileBtn || e.target;
                        
                        console.log('[NAV] Profile button clicked');
                        
                        e.preventDefault();
                        e.stopPropagation();
                        
                        let pageType;
                        try {
                            pageType = getPageType();
                        } catch (err) {
                            console.warn('[NAV] getPageType failed, defaulting to index:', err);
                            pageType = 'index';
                        }
                        
                        console.log(`[NAV] Profile button: pageType=${pageType}`);
                        
                        // CRITICAL: Check if user is logged in FIRST (for all pages including index)
                        let userStr = null;
                        let loggedIn = false;
                        try {
                            userStr = localStorage?.getItem('azura_user');
                            loggedIn = localStorage?.getItem('azura_logged_in') === 'true';
                        } catch (authCheckErr) {
                            console.warn('[PROFILE] Auth check error:', authCheckErr);
                        }
                        
                        // If user is logged in, go directly to profile (for ALL pages)
                        if (userStr && loggedIn) {
                            try {
                                const user = JSON.parse(userStr);
                                if (user && typeof user === 'object') {
                                    console.log('[PROFILE] User logged in, going to profile.html');
                                    window.location.href = 'profile.html';
                                    return;
                                } else {
                                    throw new Error('Invalid user object');
                                }
                            } catch (err) {
                                console.warn('[PROFILE] Invalid user data in localStorage:', err);
                                // Clear invalid data
                                try {
                                    if (localStorage) {
                                        localStorage.removeItem('azura_user');
                                        localStorage.removeItem('azura_logged_in');
                                    }
                                } catch (clearErr) {
                                    // Ignore clear errors
                                }
                                // Continue to auth.html after clearing invalid data
                            }
                        }
                        
                        // User not logged in - go to auth.html
                        console.log('[NAV] Profile: Not logged in → auth.html');
                        try {
                            window.location.href = 'auth.html';
                        } catch (navErr) {
                            console.error('[NAV] Auth navigation failed:', navErr);
                        }
                    } catch (err) {
                        console.error('[NAV] Profile button click handler error:', err);
                        // Fallback: always navigate to auth
                        try {
                            window.location.href = 'auth.html';
                        } catch (navErr) {
                            console.error('[NAV] Final fallback navigation failed:', navErr);
                        }
                    }
                });
                console.log('[NAV] STEP 5.1 OK: Profile button delegation set up');
            } else {
                console.log('[NAV] STEP 5.1 SKIP: Profile button already set up');
            }
        } catch (err) {
            console.error('[NAV] STEP 5.1 ERROR: Profile button setup failed:', err);
        }
        
        // Profile icon update (non-blocking, isolated, delayed)
        console.log('[NAV] STEP 6: Setting up profile icon update (delayed)');
        setTimeout(() => {
            try {
                updateProfileIcon();
                console.log('[NAV] STEP 6 OK: Profile icon updated');
            } catch (err) {
                console.error('[NAV] STEP 6 ERROR: Profile icon update failed (non-critical):', err);
            }
        }, 50);
        
        // Back buttons - CRITICAL: Must work or users get stuck
        console.log('[NAV] STEP 7: Setting up back buttons');
        try {
            let backButtons;
            try {
                backButtons = document.querySelectorAll('.back-btn, .reader-back-btn');
                console.log(`[NAV] STEP 7.1: Found ${backButtons.length} back buttons`);
            } catch (err) {
                console.error('[NAV] STEP 7.1 ERROR: Cannot query back buttons:', err);
                backButtons = [];
            }
            
            if (backButtons && backButtons.length > 0) {
                backButtons.forEach((btn, index) => {
                    try {
                        if (!btn || typeof btn !== 'object') {
                            console.warn(`[NAV] Invalid back button at index ${index}`);
                            return;
                        }
                        
                        if (btn.dataset && btn.dataset.listenerAdded === 'true') {
                            console.log(`[NAV] Back button ${index} already has listener, skipping`);
                            return;
                        }
                        
                        if (btn.dataset) {
                            btn.dataset.listenerAdded = 'true';
                        }
                        
                        console.log(`[NAV] STEP 7.${index + 2}: Adding click handler to back button`);
                        
                        btn.addEventListener('click', (e) => {
                            console.log('[NAV] Back button clicked');
                            try {
                                e.preventDefault();
                                e.stopPropagation();
                                
                                let pageType;
                                try {
                                    pageType = getPageType();
                                } catch (err) {
                                    console.warn('[NAV] getPageType failed in back button, defaulting to index:', err);
                                    pageType = 'index';
                                }
                                
                                if (pageType === 'index') {
                                    console.log('[NAV] Back: Index page → home-page');
                                    try {
                                        navigateToInternalPage('home-page');
                                    } catch (navErr) {
                                        console.error('[NAV] Back navigation failed, using fallback:', navErr);
                                        // Fallback: direct element access
                                        try {
                                            const homePage = document.getElementById('home-page');
                                            if (homePage) {
                                                document.querySelectorAll('.page').forEach(p => {
                                                    if (p && p.classList) p.classList.remove('active');
                                                });
                                                homePage.classList.add('active');
                                            }
                                        } catch (fallbackErr) {
                                            console.error('[NAV] Back fallback also failed:', fallbackErr);
                                        }
                                    }
                                } else {
                                    console.log('[NAV] Back: External page → index.html');
                                    try {
                                        window.location.href = 'index.html';
                                    } catch (navErr) {
                                        console.error('[NAV] Back external navigation failed:', navErr);
                                    }
                                }
                            } catch (err) {
                                console.error('[NAV] Back button click handler error:', err);
                                // Fallback: always go to index
                                try {
                                    window.location.href = 'index.html';
                                } catch (finalErr) {
                                    console.error('[NAV] Back final fallback failed:', finalErr);
                                }
                            }
                        });
                        console.log(`[NAV] STEP 7.${index + 2} OK: Back button handler added`);
                    } catch (err) {
                        console.error(`[NAV] STEP 7.${index + 2} ERROR: Failed to setup back button:`, err);
                    }
                });
                console.log('[NAV] STEP 7 OK: All back buttons set up');
            } else {
                console.warn('[NAV] STEP 7 WARNING: No back buttons found');
            }
        } catch (err) {
            console.error('[NAV] STEP 7 ERROR: Back button setup failed:', err);
        }
        
        console.log('[NAV] Navigation setup COMPLETE');
    } catch (err) {
        console.error('[NAV] CRITICAL ERROR: Navigation setup completely failed:', err);
        // Last resort: try to set up basic navigation manually
        try {
            console.log('[NAV] Attempting manual navigation recovery');
            const manualNavItems = document.querySelectorAll('.nav-item');
            manualNavItems.forEach(item => {
                if (item && !item.onclick) {
                    item.onclick = function() {
                        const pageId = this.dataset?.page;
                        if (pageId === 'home-page') {
                            window.location.href = 'index.html';
                        } else if (pageId === 'search-page') {
                            window.location.href = 'search.html';
                        }
                    };
                }
            });
        } catch (recoveryErr) {
            console.error('[NAV] Manual recovery also failed:', recoveryErr);
        }
    }
}

// ============================================
// INITIALIZATION - HARD STABILITY FIX
// ============================================

// EMERGENCY BOOTSTRAP: Minimal homepage render protection
// CRITICAL: This function MUST NEVER FAIL - it's the last safety net
function emergencyHomepageRender() {
    console.log('[EMERGENCY] Emergency render STARTED');
    try {
        // Check if we're on index page
        try {
            const body = document.body;
            if (!body) {
                console.warn('[EMERGENCY] Body not found, skipping');
                return;
            }
            
            const pageType = body.getAttribute('data-page');
            const path = window.location?.pathname || '';
            const isIndex = pageType === 'index' || (!pageType && !path.includes('.html')) || path.includes('index.html');
            
            if (!isIndex) {
                console.log('[EMERGENCY] Not index page, skipping emergency render');
                return;
            }
        } catch (checkErr) {
            console.warn('[EMERGENCY] Page check failed, continuing anyway:', checkErr);
        }
        
        // CRITICAL: Force render homepage sections even if everything else fails
        // Use individual try-catch for each element to prevent cascade failure
        // ALWAYS show something - never leave sections completely empty
        try {
            const heroSlider = document.getElementById('hero-slider');
            if (heroSlider) {
                const currentContent = heroSlider.innerHTML || '';
                if (!currentContent.trim() || currentContent.trim() === '<!-- Hero slides will be inserted here -->' || currentContent.includes('Yuklanmoqda')) {
                    heroSlider.innerHTML = '<div class="empty-state" style="padding: 40px; text-align: center; color: var(--text-secondary);">Top manhwalar yuklanmoqda...</div>';
                    console.log('[EMERGENCY] Hero slider rendered with placeholder');
                }
            } else {
                console.warn('[EMERGENCY] Hero slider element not found');
            }
        } catch (err) {
            console.error('[EMERGENCY] Hero slider render error:', err);
        }
        
        try {
            const newCarousel = document.getElementById('new-carousel');
            if (newCarousel) {
                const currentContent = newCarousel.innerHTML || '';
                if (!currentContent.trim() || currentContent.trim() === '<!-- Cards will be inserted here - auto-scrolling, no buttons -->' || currentContent.includes('Yuklanmoqda')) {
                    newCarousel.innerHTML = '<div class="empty-state" style="padding: 40px; text-align: center; color: var(--text-secondary); min-width: 200px;">Yangi manhwalar yuklanmoqda...</div>';
                    console.log('[EMERGENCY] New carousel rendered with placeholder');
                }
            } else {
                console.warn('[EMERGENCY] New carousel element not found');
            }
        } catch (err) {
            console.error('[EMERGENCY] New carousel render error:', err);
        }
        
        try {
            const manhwaGrid = document.getElementById('manhwa-grid');
            if (manhwaGrid) {
                const currentContent = manhwaGrid.innerHTML || '';
                if (!currentContent.trim() || currentContent.trim() === '<!-- Grid items will be inserted here -->' || currentContent.includes('Yuklanmoqda')) {
                    manhwaGrid.innerHTML = '<div class="empty-state" style="padding: 40px; text-align: center; color: var(--text-secondary); grid-column: 1 / -1;">Barcha manhwalar yuklanmoqda...</div>';
                    console.log('[EMERGENCY] Manhwa grid rendered with placeholder');
                }
            } else {
                console.warn('[EMERGENCY] Manhwa grid element not found');
            }
        } catch (err) {
            console.error('[EMERGENCY] Manhwa grid render error:', err);
        }
        
        // Also ensure channels section has content (channels should always work - hardcoded data)
        try {
            // Channels section removed - no longer needed
            // const channelsScroll = document.getElementById('channels-scroll');
            if (channelsScroll) {
                const currentContent = channelsScroll.innerHTML || '';
                if (!currentContent.trim() || currentContent.trim() === '<!-- Channels will be inserted here -->') {
                    // Try to render channels directly (should work even without manhwa data)
                    try {
                        // Channels section removed - no longer needed
                // renderChannels();
                    } catch (renderErr) {
                        channelsScroll.innerHTML = '<div class="empty-state" style="padding: 20px; text-align: center; color: var(--text-secondary);">Kanallar yuklanmoqda...</div>';
                    }
                    console.log('[EMERGENCY] Channels scroll rendered');
                }
            }
        } catch (err) {
            console.error('[EMERGENCY] Channels scroll render error:', err);
        }
        
        console.log('[EMERGENCY] Emergency render COMPLETE');
    } catch (err) {
        console.error('[EMERGENCY] CRITICAL: Emergency render failed completely:', err);
        // Last resort: try to show at least something in body
        try {
            if (document.body && !document.body.innerHTML.includes('Yuklanmoqda')) {
                const fallbackDiv = document.createElement('div');
                fallbackDiv.className = 'empty-state';
                fallbackDiv.style.padding = '20px';
                fallbackDiv.style.textAlign = 'center';
                fallbackDiv.textContent = 'Sayt yuklanmoqda...';
                document.body.insertBefore(fallbackDiv, document.body.firstChild);
            }
        } catch (finalErr) {
            console.error('[EMERGENCY] FINAL FALLBACK ALSO FAILED:', finalErr);
        }
    }
}

// ============================================
// EMERGENCY MODE: BULLETPROOF INITIALIZATION
// ============================================

// CRITICAL: Global error handler to catch ANY unhandled errors
window.addEventListener('error', function(e) {
    console.error('[GLOBAL ERROR] Unhandled error caught:', e.error, e.message, e.filename, e.lineno);
    // Don't let errors stop execution
    return true;
});

window.addEventListener('unhandledrejection', function(e) {
    console.error('[GLOBAL ERROR] Unhandled promise rejection:', e.reason);
    // Prevent default handling
    e.preventDefault();
});

// CRITICAL: Wrap entire initialization in try-catch to prevent ANY script failure
(function() {
    'use strict';
    
    console.log('[BOOTSTRAP] STEP 0: Script loaded and IIFE executing');
    
    // CRITICAL: initializeApp must be defined FIRST (hoisting ensures it's available)
    function initializeApp() {
        console.log('[BOOTSTRAP] STEP 1: DOM ready, starting initialization');
        
        // OUTER SAFETY NET: If ANYTHING fails, at least show emergency content
        try {
            // STEP 1: Emergency homepage render FIRST (immediate, no dependencies)
            // CRITICAL: This MUST execute and show placeholders immediately
            console.log('[BOOTSTRAP] STEP 1.1: Emergency render check (IMMEDIATE)');
            try {
                emergencyHomepageRender();
                console.log('[BOOTSTRAP] STEP 1.1 OK: Emergency render complete - placeholders shown');
            } catch (err) {
                console.error('[BOOTSTRAP] STEP 1.1 ERROR:', err);
                console.error('[BOOTSTRAP] STEP 1.1 ERROR Details:', err.message, err.stack);
                // CRITICAL: Even if emergency render fails, try to show something
                try {
                    const heroSlider = document.getElementById('hero-slider');
                    const newCarousel = document.getElementById('new-carousel');
                    const manhwaGrid = document.getElementById('manhwa-grid');
                    // Channels section removed - no longer needed
            // const channelsScroll = document.getElementById('channels-scroll');
                    
                    if (heroSlider && (!heroSlider.innerHTML || heroSlider.innerHTML.trim() === '')) {
                        heroSlider.innerHTML = '<div style="padding: 60px 20px; text-align: center; color: #b8bcc8; font-size: 0.9rem;">Yuklanmoqda...</div>';
                    }
                    if (newCarousel && (!newCarousel.innerHTML || newCarousel.innerHTML.trim() === '')) {
                        newCarousel.innerHTML = '<div style="padding: 40px 20px; text-align: center; color: #b8bcc8; font-size: 0.9rem; min-width: 200px;">Yuklanmoqda...</div>';
                    }
                    if (manhwaGrid && (!manhwaGrid.innerHTML || manhwaGrid.innerHTML.trim() === '')) {
                        manhwaGrid.innerHTML = '<div style="padding: 60px 20px; text-align: center; color: #b8bcc8; font-size: 0.9rem; grid-column: 1 / -1;">Yuklanmoqda...</div>';
                    }
                    // Channels section removed from homepage - no longer needed
                    console.log('[BOOTSTRAP] STEP 1.1 FALLBACK: Manual placeholders set');
                } catch (fallbackErr) {
                    console.error('[BOOTSTRAP] STEP 1.1 FALLBACK ERROR:', fallbackErr);
                }
            }
            
            // STEP 2: Determine page type (safe, synchronous)
            console.log('[BOOTSTRAP] STEP 2: Determining page type');
            let pageType = 'index'; // Default fallback
            try {
                pageType = getPageType();
                console.log(`[BOOTSTRAP] STEP 2 OK: Page type = ${pageType}`);
            } catch (err) {
                console.error('[BOOTSTRAP] STEP 2 ERROR: Page type detection failed:', err);
                // Use fallback
                try {
                    const path = window.location?.pathname || '';
                    if (path.includes('search.html')) pageType = 'search';
                    else if (path.includes('manhwa.html')) pageType = 'manhwa';
                    else if (path.includes('auth.html')) pageType = 'auth';
                    else if (path.includes('register.html')) pageType = 'register';
                    else if (path.includes('profile.html')) pageType = 'profile';
                    else pageType = 'index';
                    console.log(`[BOOTSTRAP] STEP 2 FALLBACK: Page type = ${pageType}`);
                } catch (fallbackErr) {
                    console.error('[BOOTSTRAP] STEP 2 FALLBACK ERROR:', fallbackErr);
                    pageType = 'index'; // Ultimate fallback
                }
            }
            
            // STEP 3: Check sessionStorage and hash BEFORE rendering homepage
            // CRITICAL: If navigating to another page, skip home-page render to prevent flash
            let shouldRenderHomePage = true;
            let targetPageFromStorage = null;
            
            if (pageType === 'index') {
                // Check sessionStorage FIRST (before rendering home-page)
                try {
                    const storedTarget = sessionStorage?.getItem('azura_target_page');
                    if (storedTarget) {
                        sessionStorage.removeItem('azura_target_page');
                        targetPageFromStorage = storedTarget;
                        shouldRenderHomePage = false; // Don't render home-page if navigating elsewhere
                        console.log(`[BOOTSTRAP] STEP 3: Found target page in sessionStorage: ${storedTarget} - SKIPPING home-page render`);
                    }
                } catch (storageErr) {
                    console.warn('[BOOTSTRAP] STEP 3: SessionStorage check failed:', storageErr);
                }
                
                // Check hash SECOND (before rendering home-page)
                if (shouldRenderHomePage) {
                    try {
                        const hash = (window.location?.hash || '').replace('#', '');
                        if (hash === 'channels' || hash === 'channels-page') {
                            targetPageFromStorage = 'channels-page';
                            shouldRenderHomePage = false;
                            console.log('[BOOTSTRAP] STEP 3: Found hash navigation to channels - SKIPPING home-page render');
                        } else if (hash === 'history' || hash === 'history-page') {
                            targetPageFromStorage = 'history-page';
                            shouldRenderHomePage = false;
                            console.log('[BOOTSTRAP] STEP 3: Found hash navigation to history - SKIPPING home-page render');
                        } else if (hash === 'search' || hash === 'search-page') {
                            targetPageFromStorage = 'search-page';
                            shouldRenderHomePage = false;
                            console.log('[BOOTSTRAP] STEP 3: Found hash navigation to search - SKIPPING home-page render');
                        }
                    } catch (hashErr) {
                        console.warn('[BOOTSTRAP] STEP 3: Hash check failed:', hashErr);
                    }
                }
                
                // STEP 3.1: Navigate to target page FIRST (if found, BEFORE rendering home-page)
                // CRITICAL: Navigate IMMEDIATELY if target page found to prevent home-page flash
                if (targetPageFromStorage) {
                    try {
                        console.log(`[BOOTSTRAP] STEP 3.1: Navigating to ${targetPageFromStorage} IMMEDIATELY (before home-page render)`);
                        // Hide home-page FIRST before navigation
                        const homePage = document.getElementById('home-page');
                        if (homePage && homePage.id !== targetPageFromStorage) {
                            homePage.style.cssText = 'display: none !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; z-index: -1 !important; position: fixed !important; left: -9999px !important; top: -9999px !important; width: 0 !important; height: 0 !important; overflow: hidden !important; clip: rect(0,0,0,0) !important;';
                            homePage.classList.remove('active');
                            homePage.setAttribute('data-hidden', 'true');
                            void homePage.offsetHeight; // Force immediate paint
                        }
                        // Navigate to target page IMMEDIATELY
                        navigateToInternalPage(targetPageFromStorage);
                        console.log(`[BOOTSTRAP] STEP 3.1 OK: Navigation to ${targetPageFromStorage} complete`);
                        // SKIP home-page render - already navigated to target page
                        shouldRenderHomePage = false; // Prevent home-page render
                    } catch (navErr) {
                        console.error('[BOOTSTRAP] STEP 3.1 ERROR: Target page navigation failed:', navErr);
                        // If navigation fails, continue with home-page render
                    }
                }
                
                // STEP 3.2: Render homepage ONLY if not navigating to another page
                if (shouldRenderHomePage) {
                    console.log('[BOOTSTRAP] STEP 3.2: Rendering homepage (no target page found)');
                    try {
                        // First: Emergency render to show placeholders immediately
                        emergencyHomepageRender();
                        console.log('[BOOTSTRAP] STEP 3.2 OK: Emergency render complete');
                        
                        // Then: Full render (will show placeholders if data not loaded)
                        renderIndexPage();
                        console.log('[BOOTSTRAP] STEP 3.2 OK: Homepage render complete');
                    } catch (err) {
                        console.error('[BOOTSTRAP] STEP 3.2 ERROR: Homepage render failed:', err);
                        console.error('[BOOTSTRAP] STEP 3.2 ERROR Details:', err.message, err.stack);
                        // Emergency fallback - MUST work
                        try {
                            emergencyHomepageRender();
                            console.log('[BOOTSTRAP] STEP 3.2 FALLBACK: Emergency render used');
                        } catch (emergencyErr) {
                            console.error('[BOOTSTRAP] STEP 3.2 FALLBACK ERROR:', emergencyErr);
                            // Last resort: force show at least structure
                            try {
                                const heroSlider = document.getElementById('hero-slider');
                                const newCarousel = document.getElementById('new-carousel');
                                const manhwaGrid = document.getElementById('manhwa-grid');
                                if (heroSlider) heroSlider.innerHTML = '<div style="padding: 60px 20px; text-align: center; color: #b8bcc8;">Top manhwalar yuklanmoqda...</div>';
                                if (newCarousel) newCarousel.innerHTML = '<div style="padding: 40px 20px; text-align: center; color: #b8bcc8; min-width: 200px;">Yangi manhwalar yuklanmoqda...</div>';
                                if (manhwaGrid) manhwaGrid.innerHTML = '<div style="padding: 60px 20px; text-align: center; color: #b8bcc8; grid-column: 1 / -1;">Barcha manhwalar yuklanmoqda...</div>';
                            } catch (finalErr) {
                                console.error('[BOOTSTRAP] STEP 3.2 FINAL ERROR:', finalErr);
                            }
                        }
                    }
                } else if (targetPageFromStorage) {
                    // Extra protection: Ensure home-page is definitely hidden if navigating
                    try {
                        const homePage = document.getElementById('home-page');
                        if (homePage && homePage.id !== targetPageFromStorage) {
                            homePage.style.cssText = 'display: none !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; z-index: -1 !important; position: fixed !important; left: -9999px !important; top: -9999px !important; width: 0 !important; height: 0 !important; overflow: hidden !important; clip: rect(0,0,0,0) !important;';
                            homePage.classList.remove('active');
                            homePage.setAttribute('data-hidden', 'true');
                            void homePage.offsetHeight; // Force paint again
                            console.log(`[BOOTSTRAP] STEP 3.2: Home-page hidden (navigated to ${targetPageFromStorage})`);
                        }
                    } catch (hideErr) {
                        console.warn('[BOOTSTRAP] STEP 3.2: Error hiding home-page:', hideErr);
                    }
                }
            }
            
            // STEP 4: Setup navigation IMMEDIATELY (CRITICAL - must work or site unusable)
            // NOTE: Navigation to target page already happened in STEP 3.1 if targetPageFromStorage was found
            // Navigation MUST work even if render fails, so it's priority
            console.log('[BOOTSTRAP] STEP 4: Setting up navigation (IMMEDIATE - CRITICAL)');
            try {
                setupNavigation();
                console.log('[BOOTSTRAP] STEP 4 OK: Navigation setup complete');
            } catch (err) {
                console.error('[BOOTSTRAP] STEP 4 ERROR: Navigation setup failed, retrying:', err);
                // CRITICAL: Retry navigation setup - site is unusable without it
                setTimeout(() => {
                    try {
                        setupNavigation();
                        console.log('[BOOTSTRAP] STEP 4 RETRY OK: Navigation setup succeeded on retry');
                    } catch (retryErr) {
                        console.error('[BOOTSTRAP] STEP 4 RETRY ERROR: Navigation still failed:', retryErr);
                        // Last resort: manual navigation setup
                        try {
                            const navItems = document.querySelectorAll('.nav-item');
                            navItems.forEach(item => {
                                if (item && !item.onclick) {
                                    item.onclick = function() {
                                        const pageId = this.dataset?.page;
                                        if (pageId) {
                                            try {
                                                navigateToInternalPage(pageId);
                                            } catch (e) {
                                                console.error('[NAV] Manual nav failed:', e);
                                            }
                                        }
                                    };
                                }
                            });
                            console.log('[BOOTSTRAP] STEP 4 MANUAL: Manual navigation fallback set up');
                        } catch (manualErr) {
                            console.error('[BOOTSTRAP] STEP 4 MANUAL ERROR:', manualErr);
                        }
                    }
                }, 100);
            }
            
            // STEP 5: Page-specific setup (AFTER render, non-blocking, isolated)
            console.log('[BOOTSTRAP] STEP 5: Setting up page-specific features (delayed)');
            setTimeout(() => {
                console.log(`[BOOTSTRAP] STEP 5 EXECUTING: Page type = ${pageType}`);
                
                // CRITICAL: Setup sidebar menu for ALL pages (not just index)
                try {
                    setupSidebarMenu();
                    console.log('[BOOTSTRAP] STEP 5.0 OK: Sidebar menu setup (all pages)');
                } catch (err) {
                    console.error('[BOOTSTRAP] STEP 5.0 ERROR: Sidebar menu setup failed:', err);
                }
                
                try {
                    if (pageType === 'index') {
                        // Internal pages setup (non-critical)
                        try {
                            setupInternalPages();
                            console.log('[BOOTSTRAP] STEP 5.1 OK: Internal pages setup');
                        } catch (err) {
                            console.error('[BOOTSTRAP] STEP 5.1 ERROR: Internal pages setup failed:', err);
                        }
                        
                        // NEW: Setup news section
                        try {
                            renderNews();
                            setupNewsAddButton();
                            console.log('[BOOTSTRAP] STEP 5.1.2 OK: News section setup');
                        } catch (err) {
                            console.error('[BOOTSTRAP] STEP 5.1.2 ERROR: News section setup failed:', err);
                        }
                        
                        // NEW: Setup manhwa filters
                        try {
                            setupManhwaFilters();
                            console.log('[BOOTSTRAP] STEP 5.1.3 OK: Manhwa filters setup');
                        } catch (err) {
                            console.error('[BOOTSTRAP] STEP 5.1.3 ERROR: Manhwa filters setup failed:', err);
                        }
                        
                        // NEW: Setup load more
                        try {
                            setupLoadMore();
                            console.log('[BOOTSTRAP] STEP 5.1.4 OK: Load more setup');
                        } catch (err) {
                            console.error('[BOOTSTRAP] STEP 5.1.4 ERROR: Load more setup failed:', err);
                        }
                        
                        // STEP 5.2: Navigation already happened in STEP 3.5 (before navigation setup)
                        // No need to navigate again - target page is already active
                    } else if (pageType === 'search') {
                        try {
                            setupSearchPage();
                            console.log('[BOOTSTRAP] STEP 5.4 OK: Search page setup');
                        } catch (err) {
                            console.error('[BOOTSTRAP] STEP 5.4 ERROR: Search page setup failed:', err);
                        }
                    } else if (pageType === 'manhwa') {
                        try {
                            renderManhwaPage();
                            console.log('[BOOTSTRAP] STEP 5.5 OK: Manhwa page render');
                        } catch (err) {
                            console.error('[BOOTSTRAP] STEP 5.5 ERROR: Manhwa page render failed:', err);
                        }
                    } else if (pageType === 'auth') {
                        try {
                            setupAuthPage();
                            console.log('[BOOTSTRAP] STEP 5.6 OK: Auth page setup');
                        } catch (err) {
                            console.error('[BOOTSTRAP] STEP 5.6 ERROR: Auth page setup failed:', err);
                        }
                    } else if (pageType === 'register') {
                        try {
                            setupRegisterPage();
                            console.log('[BOOTSTRAP] STEP 5.7 OK: Register page setup');
                        } catch (err) {
                            console.error('[BOOTSTRAP] STEP 5.7 ERROR: Register page setup failed:', err);
                        }
                    } else if (pageType === 'profile') {
                        try {
                            if (document.documentElement) {
                                document.documentElement.classList.add('profile-page-active');
                            }
                            setupProfilePage();
                            console.log('[BOOTSTRAP] STEP 5.8 OK: Profile page setup');
                        } catch (err) {
                            console.error('[BOOTSTRAP] STEP 5.8 ERROR: Profile page setup failed:', err);
                        }
                    }
                    console.log('[BOOTSTRAP] STEP 5 OK: Page-specific setup complete');
                } catch (err) {
                    console.error('[BOOTSTRAP] STEP 5 CRITICAL ERROR:', err);
                    // Continue - page setup is non-critical
                }
            }, 0);
            
            // STEP 6: Load data ASYNC (non-blocking, fires after render, isolated)
            // CRITICAL: Load data IMMEDIATELY, then re-render home page after data loads
            console.log('[BOOTSTRAP] STEP 6: Loading data (immediate, async)');
            // CRITICAL: Call loadData immediately - don't wrap in Promise.resolve
            console.log('[BOOTSTRAP] STEP 6 EXECUTING: Data load - calling loadData() now');
            // CRITICAL: Call loadData directly - ensure it executes
            (async () => {
                try {
                    await loadData();
                    console.log('[BOOTSTRAP] STEP 6 OK: Data loaded successfully');
                    // CRITICAL: Re-render home page AFTER data loads ONLY if home-page is currently active
                    // Don't re-render if user navigated to another page (prevents home-page flash)
                    if (pageType === 'index') {
                        try {
                            // Check if home-page is currently active before re-rendering
                            const homePage = document.getElementById('home-page');
                            const isHomePageActive = homePage && homePage.classList.contains('active') && 
                                                     homePage.style.display !== 'none' && 
                                                     !homePage.hasAttribute('data-hidden');
                            
                            if (isHomePageActive) {
                                console.log('[BOOTSTRAP] STEP 6.1: Re-rendering home page with loaded data (home-page is active)');
                                renderIndexPage();
                                console.log('[BOOTSTRAP] STEP 6.1 OK: Home page re-rendered with data');
                            } else {
                                console.log('[BOOTSTRAP] STEP 6.1: Skipping home page re-render - user navigated to another page');
                            }
                        } catch (rerenderErr) {
                            console.error('[BOOTSTRAP] STEP 6.1 ERROR: Re-render failed:', rerenderErr);
                            // Emergency fallback only if home-page is active
                            try {
                                const homePage = document.getElementById('home-page');
                                if (homePage && homePage.classList.contains('active') && 
                                    homePage.style.display !== 'none') {
                                    emergencyHomepageRender();
                                }
                            } catch (emergencyErr) {
                                console.error('[BOOTSTRAP] STEP 6.1 EMERGENCY FAILED:', emergencyErr);
                            }
                        }
                    }
                } catch (err) {
                    console.error('[BOOTSTRAP] STEP 6 ERROR: Data load failed:', err);
                    console.error('[BOOTSTRAP] STEP 6 ERROR Details:', err.message, err.stack);
                    // Show error states if needed (non-blocking)
                    try {
                        if (pageType === 'index') {
                            const heroSlider = document.getElementById('hero-slider');
                            const newCarousel = document.getElementById('new-carousel');
                            const manhwaGrid = document.getElementById('manhwa-grid');
                            if (heroSlider && (!heroSlider.innerHTML.trim() || heroSlider.innerHTML.includes('Yuklanmoqda'))) {
                                heroSlider.innerHTML = '<div class="empty-state">Ma\'lumotlar yuklanmadi. Sahifani yangilang.</div>';
                            }
                            if (newCarousel && (!newCarousel.innerHTML.trim() || newCarousel.innerHTML.includes('Yuklanmoqda'))) {
                                newCarousel.innerHTML = '<div class="empty-state">Ma\'lumotlar yuklanmadi. Sahifani yangilang.</div>';
                            }
                            if (manhwaGrid && (!manhwaGrid.innerHTML.trim() || manhwaGrid.innerHTML.includes('Yuklanmoqda'))) {
                                manhwaGrid.innerHTML = '<div class="empty-state">Ma\'lumotlar yuklanmadi. Sahifani yangilang.</div>';
                            }
                        }
                    } catch (renderErr) {
                        console.error('[BOOTSTRAP] STEP 6 ERROR STATE RENDER FAILED:', renderErr);
                    }
                }
            })(); // Execute immediately
            
            console.log('[BOOTSTRAP] STEP FINAL: Initialization sequence started (non-blocking)');
        } catch (criticalErr) {
            console.error('[BOOTSTRAP] CRITICAL ERROR IN INITIALIZATION:', criticalErr);
            // Last resort: try emergency render
            try {
                emergencyHomepageRender();
            } catch (emergencyErr) {
                console.error('[BOOTSTRAP] EMERGENCY RENDER ALSO FAILED:', emergencyErr);
            }
        }
    }
    
    // CRITICAL: Call initializeApp after defining it
    // Try immediate initialization
    try {
        // CRITICAL: Force immediate data load FIRST, then initialize
        console.log('[BOOTSTRAP] FORCE: Starting immediate data load...');
        
        // Function to initialize after data loads
        function initAfterDataLoad() {
            if (document.body && document.getElementById('home-page')) {
                console.log('[BOOTSTRAP] DOM ready, calling initializeApp immediately');
                initializeApp();
            } else if (document.readyState === 'loading') {
                console.log('[BOOTSTRAP] DOM loading, waiting for DOMContentLoaded');
                document.addEventListener('DOMContentLoaded', initializeApp);
            } else {
                console.log('[BOOTSTRAP] DOM ready, calling initializeApp');
                initializeApp();
            }
        }
        
        // Load data first, then initialize
        loadData().then(() => {
            console.log('[BOOTSTRAP] FORCE: Data loaded, manhwasData.length:', manhwasData.length);
            // Initialize app after data loads
            initAfterDataLoad();
            // CRITICAL: Force render immediately after data loads
            setTimeout(() => {
                const homePage = document.getElementById('home-page');
                const carousel = document.getElementById('new-carousel');
                if (homePage && homePage.classList.contains('active')) {
                    console.log('[BOOTSTRAP] FORCE: Force rendering index page...');
                    // Reset render flags
                    if (carousel) {
                        carousel.dataset.rendered = 'false';
                        carousel.innerHTML = '';
                    }
                    const slider = document.getElementById('hero-slider');
                    const grid = document.getElementById('manhwa-grid');
                    if (slider) slider.dataset.rendered = 'false';
                    if (grid) grid.dataset.rendered = 'false';
                    
                    // Render index page
                    renderIndexPage();
                    
                    // CRITICAL: Also directly call renderNewlyAdded multiple times to ensure it runs
                    setTimeout(() => {
                        if (manhwasData && manhwasData.length > 0) {
                            console.log('[BOOTSTRAP] FORCE: Directly calling renderNewlyAdded (attempt 1)...');
                            renderNewlyAdded();
                        }
                    }, 200);
                    
                    setTimeout(() => {
                        if (manhwasData && manhwasData.length > 0) {
                            console.log('[BOOTSTRAP] FORCE: Directly calling renderNewlyAdded (attempt 2)...');
                            renderNewlyAdded();
                        }
                    }, 500);
                    
                    setTimeout(() => {
                        if (manhwasData && manhwasData.length > 0) {
                            console.log('[BOOTSTRAP] FORCE: Directly calling renderNewlyAdded (attempt 3)...');
                            renderNewlyAdded();
                        }
                    }, 1000);
                }
            }, 100);
        }).catch(err => {
            console.error('[BOOTSTRAP] FORCE: Error loading data:', err);
            console.error('[BOOTSTRAP] FORCE: Error details:', err.message, err.stack);
            // Initialize anyway
            initAfterDataLoad();
        });
        
        // Also initialize immediately (in case data already loaded)
        if (document.body && document.getElementById('home-page')) {
            console.log('[BOOTSTRAP] DOM ready, calling initializeApp immediately');
            initializeApp();
            
            // Initialize post-reading system (ONLY if on reader page)
            // CRITICAL: Check page type before initializing
            try {
                const readerPage = document.getElementById('reader-page');
                if (readerPage && readerPage.classList.contains('active')) {
                    // Small delay to ensure reader content is loaded
                    setTimeout(() => {
                        try {
                            initializePostReadingSystem();
                        } catch (postErr) {
                            console.warn('[POST-READING] Error initializing on DOM ready:', postErr);
                        }
                    }, 500);
                }
            } catch (postErr) {
                console.warn('[POST-READING] Error checking reader page:', postErr);
                // Silent fail - don't block initialization
            }
        } else if (document.readyState === 'loading') {
            console.log('[BOOTSTRAP] DOM loading, waiting for DOMContentLoaded');
            document.addEventListener('DOMContentLoaded', initializeApp);
        } else {
            console.log('[BOOTSTRAP] DOM ready, calling initializeApp');
            initializeApp();
        }
    } catch (initErr) {
        console.error('[BOOTSTRAP] Initial call to initializeApp failed:', initErr);
        // Retry after delay
        setTimeout(() => {
            try {
                initializeApp();
            } catch (retryErr) {
                console.error('[BOOTSTRAP] Retry call failed:', retryErr);
            }
        }, 100);
    }
})();

// CRITICAL: Expose functions to global scope IMMEDIATELY after IIFE
// This ensures functions are available even if IIFE hasn't executed yet
if (typeof window !== 'undefined') {
    // Force expose functions to window
    if (typeof loadData === 'function') {
        window.loadData = loadData;
    }
    if (typeof renderNewlyAdded === 'function') {
        window.renderNewlyAdded = renderNewlyAdded;
    }
    if (typeof renderIndexPage === 'function') {
        window.renderIndexPage = renderIndexPage;
    }
    // Expose manhwasData
    if (typeof manhwasData !== 'undefined') {
        Object.defineProperty(window, 'manhwasData', {
            get: function() { return manhwasData; },
            set: function(value) { manhwasData = value; },
            configurable: true
        });
    }
    console.log('[GLOBAL] ✅ Functions exposed to window (after IIFE):', {
        loadData: typeof window.loadData,
        renderNewlyAdded: typeof window.renderNewlyAdded,
        renderIndexPage: typeof window.renderIndexPage,
        manhwasData: typeof window.manhwasData
    });
}

let lastDataRefreshAt = 0;
function refreshManhwaData(reason = '') {
    const now = Date.now();
    if (now - lastDataRefreshAt < 2000) {
        return;
    }
    lastDataRefreshAt = now;
    if (typeof loadData === 'function') {
        console.log('[DATA] Refresh trigger:', reason);
        loadData();
    }
}

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        refreshManhwaData('visibility');
    }
});

window.addEventListener('focus', () => {
    refreshManhwaData('focus');
});

// ============================================
// AUTH / REGISTER PAGES - OPTIONAL UI ONLY
// AUTH COMPLETELY DISABLED - NO REQUIREMENTS
// ============================================

// ============================================
// GOOGLE OAUTH - REAL AUTHENTICATION
// ============================================

/**
 * Initialize Google Sign-In
 */
function initializeGoogleSignIn() {
    if (typeof google === 'undefined' || !google.accounts) {
        console.warn('[AUTH] Google Identity Services not loaded yet');
        return false;
    }

    if (!GOOGLE_CLIENT_ID) {
        console.warn('[AUTH] GOOGLE_CLIENT_ID not set. Check ENV_SETUP.md for configuration.');
        const messageEl = document.getElementById('auth-message');
        if (messageEl) {
            messageEl.textContent = 'Google OAuth not configured. Please set GOOGLE_CLIENT_ID.';
            messageEl.style.display = 'block';
        }
        return false;
    }

    // Initialize Google Identity Services
    google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleSignInResponse
    });

    return true;
}

/**
 * Handle Google Sign-In Response
 */
async function handleGoogleSignInResponse(response) {
    try {
        // Decode the credential (JWT token)
        const idToken = response.credential;

        // Show loading state
        const googleBtn = document.getElementById('google-signin-btn');
        if (googleBtn) {
            googleBtn.disabled = true;
            const span = googleBtn.querySelector('span');
            if (span) span.textContent = 'Signing in...';
        }

        // Try to send token to backend for verification (if Netlify function exists)
        // If backend is not available, use demo mode with localStorage
        let authData;
        try {
            const authResponse = await fetch('/.netlify/functions/google-auth', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ idToken })
            });

            if (authResponse.ok) {
                authData = await authResponse.json();
                if (!authData.success) {
                    throw new Error(authData.error || 'Authentication failed');
                }
            } else {
                // Backend not available - use demo mode
                throw new Error('Backend not available, using demo mode');
            }
        } catch (fetchErr) {
            console.warn('[AUTH] Backend not available, using demo mode:', fetchErr);
            // DEMO MODE: Decode JWT token manually (simple decode, no verification)
            try {
                const payload = JSON.parse(atob(idToken.split('.')[1]));
                authData = {
                    success: true,
                    user: {
                        email: payload.email || 'demo@google.com',
                        name: payload.name || payload.given_name || 'Google User',
                        picture: payload.picture || 'assets/avatars/avatar-male.png',
                        emailVerified: payload.email_verified || true
                    }
                };
                console.log('[AUTH] Demo mode: Using decoded token data');
            } catch (decodeErr) {
                // If decode fails, use default demo user
                console.warn('[AUTH] Token decode failed, using default demo user:', decodeErr);
                authData = {
                    success: true,
                    user: {
                        email: 'demo@google.com',
                        name: 'Google User',
                        picture: 'assets/avatars/avatar-male.png',
                        emailVerified: true
                    }
                };
            }
        }

        // Save user data to localStorage (no token stored, only user info)
        const userData = {
            email: authData.user.email,
            name: authData.user.name,
            username: authData.user.name || authData.user.email.split('@')[0],
            picture: authData.user.picture,
            emailVerified: authData.user.emailVerified,
            provider: 'google',
            loggedIn: true
        };

        localStorage.setItem('azura_user', JSON.stringify(userData));
        localStorage.setItem('azura_logged_in', 'true');

        console.log('[AUTH] Google Sign-In successful:', userData);

        // Redirect to profile page
        window.location.href = 'profile.html';

    } catch (error) {
        console.error('[AUTH] Google Sign-In Error:', error);
        
        // Reset button state
        const googleBtn = document.getElementById('google-signin-btn');
        if (googleBtn) {
            googleBtn.disabled = false;
            const span = googleBtn.querySelector('span');
            if (span) span.textContent = 'Continue with Google';
        }
        
        // Show error message (no alert, just inline text)
        const messageEl = document.getElementById('auth-message');
        if (messageEl) {
            messageEl.textContent = 'Google login muvaffaqiyatsiz. Boshqa usul bilan kirib ko\'ring.';
            messageEl.style.display = 'block';
            messageEl.style.color = '#ef4444';
        }

        // Note: Button already reset above at line 4712, no need to duplicate
    }
}

/**
 * Trigger Google Sign-In (account picker)
 */
function triggerGoogleSignIn() {
    // NON-BLOCKING: If Google OAuth not available, just return silently
    if (typeof google === 'undefined' || !google.accounts) {
        console.log('[AUTH] Google Identity Services not loaded (non-blocking)');
        return;
    }

    if (!GOOGLE_CLIENT_ID) {
        console.log('[AUTH] GOOGLE_CLIENT_ID not configured (non-blocking)');
        return;
    }

    // Use Google One Tap prompt - shows account picker
    // This is the simplest and most reliable approach
    try {
        google.accounts.id.prompt((notification) => {
            if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
                // If One Tap is not displayed, show a message
                // User can try clicking the button again
                console.log('[AUTH] One Tap not displayed:', notification.getNotDisplayedReason());
                
                // Alternative: Render a visible Google button as fallback
                const googleBtn = document.getElementById('google-signin-btn');
                if (googleBtn && !document.getElementById('google-button-fallback')) {
                    const fallbackContainer = document.createElement('div');
                    fallbackContainer.id = 'google-button-fallback';
                    fallbackContainer.style.cssText = 'margin-top: 16px;';
                    googleBtn.parentNode.insertBefore(fallbackContainer, googleBtn.nextSibling);
                    
                    google.accounts.id.renderButton(fallbackContainer, {
                        type: 'standard',
                        theme: 'outline',
                        size: 'large',
                        text: 'signin_with',
                        width: '100%'
                    });
                }
            }
        });
    } catch (error) {
        console.error('[AUTH] Error triggering Google Sign-In:', error);
        const messageEl = document.getElementById('auth-message');
        if (messageEl) {
            messageEl.textContent = 'Failed to start Google Sign-In. Please refresh and try again.';
            messageEl.style.display = 'block';
        }
    }
}

function setupAuthPage() {
    // DOM FAIL-SAFE: Never throw, always handle gracefully
    console.log('[AUTH] Auth page setup STARTED');
    
    try {
        // CRITICAL: Guard - only on auth page
        let pageType;
        try {
            pageType = getPageType();
        } catch (err) {
            console.warn('[AUTH] getPageType failed, checking manually:', err);
            const path = window.location?.pathname || '';
            pageType = path.includes('auth.html') ? 'auth' : '';
        }
        
        if (pageType !== 'auth') {
            console.log('[AUTH] Not on auth page, skipping setup');
            return;
        }
        
        console.log('[AUTH] STEP 1: Setting up auth page - Local Login');
        
        // Setup manual login form (non-blocking)
        try {
            const loginForm = document.getElementById('login-form');
            const messageEl = document.getElementById('auth-message');
            
            if (loginForm && loginForm.dataset.setup !== 'true') {
                loginForm.dataset.setup = 'true';
                console.log('[AUTH] STEP 2: Setting up login form');
                
                loginForm.addEventListener('submit', (e) => {
                    try {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        const email = document.getElementById('login-email')?.value?.trim();
                        const password = document.getElementById('login-password')?.value;
                        
                        if (!email || !password) {
                            if (messageEl) {
                                messageEl.textContent = 'Email va parol kiriting';
                                messageEl.style.display = 'block';
                                messageEl.style.color = '#ef4444';
                            }
                            return;
                        }
                        
                        // Check localStorage for user (safe)
                        try {
                            const usersStr = localStorage?.getItem('azura_users') || '[]';
                            let users = [];
                            try {
                                users = JSON.parse(usersStr);
                                if (!Array.isArray(users)) {
                                    users = [];
                                }
                            } catch (parseErr) {
                                console.warn('[AUTH] Error parsing users:', parseErr);
                                users = [];
                            }
                            
                            const user = users.find(u => u && u.email === email && u.password === password);
                            
                            if (!user) {
                                if (messageEl) {
                                    messageEl.textContent = 'Email yoki parol noto\'g\'ri';
                                    messageEl.style.display = 'block';
                                    messageEl.style.color = '#ef4444';
                                }
                                return;
                            }
                            
                            // Login successful - save current user (safe)
                            try {
                                const userData = {
                                    username: user.username || '',
                                    email: user.email || '',
                                    provider: 'local',
                                    loggedIn: true
                                };
                                
                                localStorage.setItem('azura_user', JSON.stringify(userData));
                                localStorage.setItem('azura_logged_in', 'true');
                                
                                // Redirect to profile
                                window.location.href = 'profile.html';
                            } catch (saveErr) {
                                console.error('[AUTH] Error saving user data:', saveErr);
                                if (messageEl) {
                                    messageEl.textContent = 'Ma\'lumotlar saqlanmadi';
                                    messageEl.style.display = 'block';
                                    messageEl.style.color = '#ef4444';
                                }
                            }
                        } catch (localStorageErr) {
                            console.error('[AUTH] localStorage error:', localStorageErr);
                            if (messageEl) {
                                messageEl.textContent = 'Xatolik yuz berdi';
                                messageEl.style.display = 'block';
                                messageEl.style.color = '#ef4444';
                            }
                        }
                    } catch (err) {
                        console.error('[AUTH] Login form submit error:', err);
                        if (messageEl) {
                            messageEl.textContent = 'Xatolik yuz berdi. Qayta urinib ko\'ring.';
                            messageEl.style.display = 'block';
                            messageEl.style.color = '#ef4444';
                        }
                    }
                });
                console.log('[AUTH] STEP 2 OK: Login form set up');
            } else {
                console.log('[AUTH] STEP 2 SKIP: Login form already set up or not found');
            }
        } catch (formErr) {
            console.error('[AUTH] STEP 2 ERROR: Login form setup failed:', formErr);
        }
        
        // Setup Google OAuth (IMMEDIATE - with demo mode fallback)
        console.log('[AUTH] STEP 3: Setting up Google OAuth (immediate, with demo mode fallback)');
        try {
            setupGoogleAuthOptional();
            console.log('[AUTH] STEP 3 OK: Google OAuth setup attempted');
        } catch (err) {
            console.warn('[AUTH] STEP 3 WARNING: Google OAuth setup failed (non-critical):', err);
            // Try again after delay
            setTimeout(() => {
                try {
                    setupGoogleAuthOptional();
                    console.log('[AUTH] STEP 3 RETRY OK: Google OAuth setup retried');
                } catch (retryErr) {
                    console.warn('[AUTH] STEP 3 RETRY WARNING: Google OAuth setup still failed:', retryErr);
                }
            }, 500);
        }
        
        console.log('[AUTH] Auth page setup COMPLETE');
    } catch (err) {
        console.error('[AUTH] CRITICAL error in setupAuthPage:', err);
        // Never throw - auth page setup is non-critical for site stability
    }
}

/**
 * Setup Google OAuth - OPTIONAL and NON-BLOCKING
 */
function setupGoogleAuthOptional() {
    const googleBtn = document.getElementById('google-signin-btn');
    if (!googleBtn) return;
    
    // NON-BLOCKING: Try to initialize Google OAuth
    // If Google OAuth is not available, use demo mode
    try {
        // Check if Google Identity Services is loaded
        if (typeof google !== 'undefined' && google.accounts) {
            // Google Identity Services is loaded - check for client ID
            if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_ID.length > 0) {
                // Real Google OAuth - initialize it
                console.log('[AUTH] Setting up real Google OAuth');
                if (initializeGoogleSignIn()) {
                    if (googleBtn.dataset.listenerAdded !== 'true') {
                        googleBtn.dataset.listenerAdded = 'true';
                        googleBtn.addEventListener('click', (e) => {
                            e.preventDefault();
                            triggerGoogleSignIn();
                        });
                    }
                    // Button is active
                    googleBtn.style.opacity = '1';
                    googleBtn.style.cursor = 'pointer';
                    console.log('[AUTH] Google OAuth setup complete - real mode');
                    return; // Success, exit
                }
            } else {
                // Google loaded but no CLIENT_ID - use demo mode
                console.log('[AUTH] Google loaded but no CLIENT_ID - using demo mode');
            }
        } else {
            // Google not loaded - wait a bit, then try demo mode
            console.log('[AUTH] Google Identity Services not loaded yet - will try demo mode');
            setTimeout(() => {
                if (typeof google === 'undefined' || !google.accounts) {
                    console.log('[AUTH] Google still not loaded - setting up demo mode');
                    setupGoogleDemoMode(googleBtn);
                }
            }, 2000);
        }
        
        // DEMO MODE: Google OAuth not available - use localStorage simulation
        setupGoogleDemoMode(googleBtn);
        
    } catch (err) {
        console.warn('[AUTH] Google OAuth setup failed, using demo mode:', err);
        setupGoogleDemoMode(googleBtn);
    }
}

/**
 * Setup Google OAuth Demo Mode (localStorage simulation)
 * This allows Google button to work even without GOOGLE_CLIENT_ID
 */
function setupGoogleDemoMode(googleBtn) {
    if (!googleBtn) return;
    
    try {
        // Remove hint text if exists
        const hint = googleBtn.querySelector('.auth__google-hint');
        if (hint) {
            hint.style.display = 'none';
        }
        
        // Button is active (demo mode)
        googleBtn.style.opacity = '1';
        googleBtn.style.cursor = 'pointer';
        
        // Add click handler for demo mode
        if (googleBtn.dataset.listenerAdded !== 'true') {
            googleBtn.dataset.listenerAdded = 'true';
            googleBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                try {
                    // Show loading state
                    const span = googleBtn.querySelector('span');
                    if (span) {
                        span.textContent = 'Kirilmoqda...';
                    }
                    googleBtn.disabled = true;
                    
                    // DEMO MODE: Simulate Google login with localStorage
                    // In production, this would be replaced with real Google OAuth
                    console.log('[AUTH] Demo mode: Simulating Google login');
                    
                    // Wait a bit to simulate network request
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    // Create demo Google user
                    const demoUser = {
                        email: 'demo@google.com',
                        name: 'Google Demo User',
                        username: 'google_demo',
                        picture: 'assets/avatars/avatar-male.png',
                        emailVerified: true,
                        provider: 'google',
                        loggedIn: true
                    };
                    
                    // Save to localStorage
                    localStorage.setItem('azura_user', JSON.stringify(demoUser));
                    localStorage.setItem('azura_logged_in', 'true');
                    
                    console.log('[AUTH] Demo mode: Login successful, redirecting to profile');
                    
                    // Redirect to profile
                    window.location.href = 'profile.html';
                    
                } catch (demoErr) {
                    console.error('[AUTH] Demo mode error:', demoErr);
                    // Reset button
                    googleBtn.disabled = false;
                    const span = googleBtn.querySelector('span');
                    if (span) {
                        span.textContent = 'Continue with Google';
                    }
                    
                    // Show error message
                    const messageEl = document.getElementById('auth-message');
                    if (messageEl) {
                        messageEl.textContent = 'Demo login xatosi. Qayta urinib ko\'ring.';
                        messageEl.style.display = 'block';
                        messageEl.style.color = '#ef4444';
                    }
                }
            });
        }
        
        console.log('[AUTH] Google OAuth demo mode setup complete');
    } catch (err) {
        console.error('[AUTH] Demo mode setup error:', err);
        // Fallback: disable button
        if (googleBtn) {
            googleBtn.style.opacity = '0.6';
            googleBtn.style.cursor = 'not-allowed';
        }
    }
}

function setupRegisterPage() {
    // DOM FAIL-SAFE: Never throw, always handle gracefully
    console.log('[REGISTER] Register page setup STARTED');
    
    try {
        // CRITICAL: Guard - only on register page
        let pageType;
        try {
            pageType = getPageType();
        } catch (err) {
            console.warn('[REGISTER] getPageType failed, checking manually:', err);
            const path = window.location?.pathname || '';
            pageType = path.includes('register.html') ? 'register' : '';
        }
        
        if (pageType !== 'register') {
            console.log('[REGISTER] Not on register page, skipping setup');
            return;
        }
        
        console.log('[REGISTER] STEP 1: Setting up register page - Local Registration');
        
        // Setup manual register form (non-blocking)
        try {
            const registerForm = document.getElementById('register-form');
            const messageEl = document.getElementById('auth-message');
            
            if (registerForm && registerForm.dataset.setup !== 'true') {
                registerForm.dataset.setup = 'true';
                console.log('[REGISTER] STEP 2: Setting up register form');
                
                registerForm.addEventListener('submit', (e) => {
                    try {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        const username = document.getElementById('register-username')?.value?.trim();
                        const email = document.getElementById('register-email')?.value?.trim();
                        const password = document.getElementById('register-password')?.value;
                        
                        if (!username || !email || !password) {
                            if (messageEl) {
                                messageEl.textContent = 'Barcha maydonlarni to\'ldiring';
                                messageEl.style.display = 'block';
                                messageEl.style.color = '#ef4444';
                            }
                            return;
                        }
                        
                        // Check if email already exists (safe)
                        try {
                            const usersStr = localStorage?.getItem('azura_users') || '[]';
                            let users = [];
                            try {
                                users = JSON.parse(usersStr);
                                if (!Array.isArray(users)) {
                                    users = [];
                                }
                            } catch (parseErr) {
                                console.warn('[REGISTER] Error parsing users:', parseErr);
                                users = [];
                            }
                            
                            if (users.find(u => u && u.email === email)) {
                                if (messageEl) {
                                    messageEl.textContent = 'Bu email allaqachon ro\'yxatdan o\'tgan';
                                    messageEl.style.display = 'block';
                                    messageEl.style.color = '#ef4444';
                                }
                                return;
                            }
                            
                            // Create new user (safe)
                            try {
                                const newUser = {
                                    username: username || '',
                                    email: email || '',
                                    password: password || '' // NOTE: In production, password should be hashed
                                };
                                
                                users.push(newUser);
                                localStorage.setItem('azura_users', JSON.stringify(users));
                                
                                // Auto-login after registration (safe)
                                const userData = {
                                    username: newUser.username,
                                    email: newUser.email,
                                    provider: 'local',
                                    loggedIn: true
                                };
                                
                                localStorage.setItem('azura_user', JSON.stringify(userData));
                                localStorage.setItem('azura_logged_in', 'true');
                                
                                // Redirect to profile
                                window.location.href = 'profile.html';
                            } catch (saveErr) {
                                console.error('[REGISTER] Error saving user:', saveErr);
                                if (messageEl) {
                                    messageEl.textContent = 'Ma\'lumotlar saqlanmadi';
                                    messageEl.style.display = 'block';
                                    messageEl.style.color = '#ef4444';
                                }
                            }
                        } catch (localStorageErr) {
                            console.error('[REGISTER] localStorage error:', localStorageErr);
                            if (messageEl) {
                                messageEl.textContent = 'Xatolik yuz berdi';
                                messageEl.style.display = 'block';
                                messageEl.style.color = '#ef4444';
                            }
                        }
                    } catch (err) {
                        console.error('[REGISTER] Registration form submit error:', err);
                        if (messageEl) {
                            messageEl.textContent = 'Xatolik yuz berdi. Qayta urinib ko\'ring.';
                            messageEl.style.display = 'block';
                            messageEl.style.color = '#ef4444';
                        }
                    }
                });
                console.log('[REGISTER] STEP 2 OK: Register form set up');
            } else {
                console.log('[REGISTER] STEP 2 SKIP: Register form already set up or not found');
            }
        } catch (formErr) {
            console.error('[REGISTER] STEP 2 ERROR: Register form setup failed:', formErr);
        }
        
        // Setup Google OAuth (IMMEDIATE - with demo mode fallback)
        console.log('[REGISTER] STEP 3: Setting up Google OAuth (immediate, with demo mode fallback)');
        try {
            setupGoogleAuthOptional();
            console.log('[REGISTER] STEP 3 OK: Google OAuth setup attempted');
        } catch (err) {
            console.warn('[REGISTER] STEP 3 WARNING: Google OAuth setup failed (non-critical):', err);
            // Try again after delay
            setTimeout(() => {
                try {
                    setupGoogleAuthOptional();
                    console.log('[REGISTER] STEP 3 RETRY OK: Google OAuth setup retried');
                } catch (retryErr) {
                    console.warn('[REGISTER] STEP 3 RETRY WARNING: Google OAuth setup still failed:', retryErr);
                }
            }, 500);
        }
        
        console.log('[REGISTER] Register page setup COMPLETE');
    } catch (err) {
        console.error('[REGISTER] CRITICAL error in setupRegisterPage:', err);
        // Never throw - register page setup is non-critical for site stability
    }
}

// ============================================
// FAVORITES / CURRENTLY READING / HISTORY SYSTEM
// ============================================

/**
 * Add manhwa to favorites
 */
function addToFavorites(manhwaId) {
    if (!manhwaId) return false;
    
    try {
        const favoritesStr = localStorage.getItem('azura_favorites') || '[]';
        const favorites = JSON.parse(favoritesStr);
        
        if (!favorites.includes(manhwaId)) {
            favorites.push(manhwaId);
            localStorage.setItem('azura_favorites', JSON.stringify(favorites));
            console.log('[FAVORITES] Added to favorites:', manhwaId);
            return true;
        }
        return false;
    } catch (err) {
        console.error('[FAVORITES] Error adding to favorites:', err);
        return false;
    }
}

/**
 * Remove manhwa from favorites
 */
function removeFromFavorites(manhwaId) {
    if (!manhwaId) return false;
    
    try {
        const favoritesStr = localStorage.getItem('azura_favorites') || '[]';
        const favorites = JSON.parse(favoritesStr);
        const index = favorites.indexOf(manhwaId);
        
        if (index > -1) {
            favorites.splice(index, 1);
            localStorage.setItem('azura_favorites', JSON.stringify(favorites));
            console.log('[FAVORITES] Removed from favorites:', manhwaId);
            return true;
        }
        return false;
    } catch (err) {
        console.error('[FAVORITES] Error removing from favorites:', err);
        return false;
    }
}

/**
 * Check if manhwa is in favorites
 */
function isFavorite(manhwaId) {
    if (!manhwaId) return false;
    
    try {
        const favoritesStr = localStorage.getItem('azura_favorites') || '[]';
        const favorites = JSON.parse(favoritesStr);
        return favorites.includes(manhwaId);
    } catch (err) {
        return false;
    }
}

/**
 * Get all favorites
 */
function getFavorites() {
    try {
        const favoritesStr = localStorage.getItem('azura_favorites') || '[]';
        return JSON.parse(favoritesStr);
    } catch (err) {
        return [];
    }
}

/**
 * Add to currently reading
 */
function addToCurrentlyReading(manhwaId, chapterId = null) {
    if (!manhwaId) return false;
    
    try {
        const currentlyReading = {
            manhwaId: manhwaId,
            chapterId: chapterId,
            timestamp: Date.now()
        };
        localStorage.setItem('azura_currentlyReading', JSON.stringify(currentlyReading));
        console.log('[READING] Added to currently reading:', manhwaId);
        return true;
    } catch (err) {
        console.error('[READING] Error adding to currently reading:', err);
        return false;
    }
}

/**
 * Get currently reading
 */
function getCurrentlyReading() {
    try {
        const readingStr = localStorage.getItem('azura_currentlyReading');
        if (!readingStr) return null;
        return JSON.parse(readingStr);
    } catch (err) {
        return null;
    }
}

/**
 * Clear currently reading
 */
function clearCurrentlyReading() {
    localStorage.removeItem('azura_currentlyReading');
}

/**
 * Add to history (last 3-5 manhwas)
 */
function addToHistory(manhwaId) {
    if (!manhwaId) return false;
    
    try {
        const historyStr = localStorage.getItem('azura_history') || '[]';
        let history = JSON.parse(historyStr);
        
        // Remove if already exists
        history = history.filter(id => id !== manhwaId);
        
        // Add to beginning
        history.unshift(manhwaId);
        
        // Keep only last 5
        history = history.slice(0, 5);
        
        localStorage.setItem('azura_history', JSON.stringify(history));
        console.log('[HISTORY] Added to history:', manhwaId);
        return true;
    } catch (err) {
        console.error('[HISTORY] Error adding to history:', err);
        return false;
    }
}

/**
 * Get history
 */
function getHistory() {
    try {
        const historyStr = localStorage.getItem('azura_history') || '[]';
        return JSON.parse(historyStr);
    } catch (err) {
        return [];
    }
}

// ============================================
// PROFILE PAGE - USER PROFILE DISPLAY
// ============================================
function setupProfilePage() {
    // DOM FAIL-SAFE: Never throw, always handle gracefully
    try {
        // CRITICAL: Guard - only on profile page
        const pageType = getPageType();
        if (pageType !== 'profile') {
            return;
        }
        
        // DOM CHECK: Ensure DOM is ready
        if (!document || !document.body) {
            console.warn('[PROFILE] DOM not ready, skipping profile setup');
            return;
        }
        
        console.log('[INIT] Profile sahifasi');
        
        // CRITICAL: Auth OPTIONAL - Show guest state if not logged in
        let userStr;
        let loggedIn = false;
        try {
            userStr = localStorage.getItem('azura_user');
            loggedIn = localStorage.getItem('azura_logged_in') === 'true';
        } catch (err) {
            console.warn('[PROFILE] Error reading localStorage:', err);
            userStr = null;
            loggedIn = false;
        }
        
        if (!userStr || !loggedIn) {
            // Show guest state - DON'T redirect, DON'T block
            try {
                renderGuestProfile();
            } catch (err) {
                console.error('[PROFILE] Error rendering guest profile:', err);
            }
            return;
        }
        
        try {
            const user = JSON.parse(userStr);
            if (!user || typeof user !== 'object') {
                throw new Error('Invalid user object');
            }
            
            // Update profile avatar (non-blocking)
            try {
                const avatarImg = document.getElementById('profile-avatar-img');
                if (avatarImg) {
                    const username = user.username || user.email || '';
                    let avatarUrl = null;
                    
                    // CRITICAL: Check custom avatar first (from unified system)
                    try {
                        const profileData = getUserProfile(username);
                        if (profileData && profileData.avatar) {
                            avatarUrl = profileData.avatar;
                            console.log('[PROFILE] Profile page: Using custom avatar for:', username);
                        }
                    } catch (profileErr) {
                        console.warn('[PROFILE] Error getting custom avatar:', profileErr);
                    }
                    
                    // Fallback: Show Google avatar if available and no custom avatar
                    if (!avatarUrl && user.picture && user.provider === 'google') {
                        avatarUrl = user.picture;
                        console.log('[PROFILE] Profile page: Using Google avatar for:', username);
                    }
                    
                    // Final fallback: default avatar
                    if (!avatarUrl) {
                        avatarUrl = 'assets/avatars/avatar-male.png';
                    }
                    
                    // CRITICAL: Validate avatar URL before setting
                    if (!avatarUrl || avatarUrl.trim() === '') {
                        avatarUrl = 'assets/avatars/avatar-male.png';
                    }
                    
                    // Check if URL is valid
                    const isValidUrl = avatarUrl.startsWith('http://') || 
                                      avatarUrl.startsWith('https://') || 
                                      avatarUrl.startsWith('data:') || 
                                      avatarUrl.startsWith('/') ||
                                      avatarUrl.startsWith('./') ||
                                      !avatarUrl.includes('://');
                    
                    if (!isValidUrl) {
                        console.warn('[PROFILE] Profile page: Invalid avatar URL, using default:', avatarUrl);
                        avatarUrl = 'assets/avatars/avatar-male.png';
                    }
                    
                    // Remove any existing handlers
                    avatarImg.onerror = null;
                    avatarImg.onload = null;
                    
                    avatarImg.src = avatarUrl;
                    avatarImg.onerror = function() {
                        console.warn('[PROFILE] Profile page: Avatar failed to load:', this.src);
                        if (this && this.src !== 'assets/avatars/avatar-male.png') {
                            this.onerror = null; // Prevent loop
                            this.src = 'assets/avatars/avatar-male.png';
                            console.log('[PROFILE] Profile page: Fallback to default avatar');
                        }
                    };
                    avatarImg.onload = function() {
                        console.log('[PROFILE] Profile page: Avatar loaded successfully:', this.src);
                    };
                    avatarImg.alt = user.username || user.name || user.email || 'User';
                }
            } catch (err) {
                console.warn('[PROFILE] Error updating avatar:', err);
            }
            
            // Update username (non-blocking)
            try {
                const usernameEl = document.getElementById('profile-username');
                if (usernameEl) {
                    const username = user.username || user.name || (user.email ? user.email.split('@')[0] : '') || 'Foydalanuvchi';
                    usernameEl.textContent = username;
                }
            } catch (err) {
                console.warn('[PROFILE] Error updating username:', err);
            }
            
            // Update email (non-blocking)
            try {
                const emailEl = document.getElementById('profile-email');
                if (emailEl) {
                    emailEl.textContent = user.email || 'email@example.com';
                }
            } catch (err) {
                console.warn('[PROFILE] Error updating email:', err);
            }
            
            // Account management button - OPEN EDIT PROFILE MODAL
            try {
                const accountBtn = document.getElementById('account-management-btn');
                if (accountBtn && accountBtn.dataset.listenerAdded !== 'true') {
                    accountBtn.dataset.listenerAdded = 'true';
                    accountBtn.addEventListener('click', (e) => {
                        try {
                            e.preventDefault();
                            e.stopPropagation();
                            openEditProfileModal(user);
                        } catch (err) {
                            console.warn('[PROFILE] Account button error:', err);
                        }
                    });
                }
            } catch (err) {
                console.warn('[PROFILE] Error setting up account button:', err);
            }
            
            // Load and apply custom profile data
            try {
                const username = user.username || user.email || '';
                const profileData = getUserProfile(username);
                if (profileData) {
                    // Update avatar (custom avatar takes priority)
                    const avatarImg = document.getElementById('profile-avatar-img');
                    if (avatarImg) {
                        let avatarUrl = null;
                        
                        // CRITICAL: Use custom avatar if available
                        if (profileData.avatar) {
                            avatarUrl = profileData.avatar;
                            console.log('[PROFILE] Profile page: Applying custom avatar from profileData:', avatarUrl);
                        } else {
                            // Fallback to Google picture if no custom avatar
                            if (user.picture && user.provider === 'google') {
                                avatarUrl = user.picture;
                                console.log('[PROFILE] Profile page: Using Google avatar as fallback');
                            } else {
                                avatarUrl = 'assets/avatars/avatar-male.png';
                            }
                        }
                        
                        avatarImg.src = avatarUrl;
                        avatarImg.onerror = function() {
                            if (this && this.src !== 'assets/avatars/avatar-male.png') {
                                console.warn('[PROFILE] Profile page: Custom avatar failed to load, using default:', this.src);
                                this.src = 'assets/avatars/avatar-male.png';
                            }
                        };
                    }
                    
                    // Update username/nickname
                    const usernameEl = document.getElementById('profile-username');
                    if (usernameEl && profileData.nickname) {
                        usernameEl.textContent = profileData.nickname;
                    }
                } else {
                    // No custom profile data, but ensure avatar is set (already set above)
                    console.log('[PROFILE] Profile page: No custom profile data found');
                }
            } catch (err) {
                console.warn('[PROFILE] Error loading custom profile:', err);
            }
            
            // Logout button - REAL LOGOUT (non-blocking)
            try {
                const logoutBtn = document.getElementById('profile-logout-btn');
                if (logoutBtn) {
                    logoutBtn.style.display = 'block'; // Show logout button when logged in
                    
                    if (logoutBtn.dataset.listenerAdded !== 'true') {
                        logoutBtn.dataset.listenerAdded = 'true';
                        logoutBtn.addEventListener('click', (e) => {
                            try {
                                e.preventDefault();
                                e.stopPropagation();
                                
                                // QAT'IY: localStorage'dagi user ma'lumotlarini TO'LIQ o'chirish
                                try {
                                    localStorage.removeItem('azura_user');
                                    localStorage.removeItem('azura_logged_in');
                                } catch (localErr) {
                                    console.warn('[LOGOUT] Error clearing localStorage:', localErr);
                                }
                                
                                console.log('[LOGOUT] User logged out, localStorage cleared');
                                
                                // Redirect to index (always works)
                                window.location.href = 'index.html';
                            } catch (err) {
                                console.error('[LOGOUT] Error during logout:', err);
                                // Force redirect even on error
                                try {
                                    window.location.href = 'index.html';
                                } catch (navErr) {
                                    console.error('[LOGOUT] Redirect failed:', navErr);
                                }
                            }
                        });
                    }
                }
            } catch (err) {
                console.warn('[PROFILE] Error setting up logout button:', err);
            }
            
            // Load and display favorites - ONLY IF manhwasData IS LOADED (non-blocking, delayed)
            setTimeout(() => {
                try {
                    if (manhwasData && manhwasData.length > 0) {
                        renderFavorites();
                    } else {
                        // Try to load data first
                        loadData().then(() => {
                            if (manhwasData && manhwasData.length > 0) {
                                renderFavorites();
                            }
                        }).catch(() => {
                            // Ignore - favorites are optional
                        });
                    }
                } catch (err) {
                    console.warn('[PROFILE] Error rendering favorites:', err);
                }
            }, 0);
            
            // Load and display currently reading - ONLY IF manhwasData IS LOADED (non-blocking, delayed)
            setTimeout(() => {
                try {
                    if (manhwasData && manhwasData.length > 0) {
                        renderCurrentlyReading();
                    } else {
                        // Try to load data first
                        loadData().then(() => {
                            if (manhwasData && manhwasData.length > 0) {
                                renderCurrentlyReading();
                            }
                        }).catch(() => {
                            // Ignore - currently reading is optional
                        });
                    }
                } catch (err) {
                    console.warn('[PROFILE] Error rendering currently reading:', err);
                }
            }, 0);
            
            // Load and display history (non-blocking, delayed)
            setTimeout(() => {
                try {
                    renderHistory();
                } catch (err) {
                    console.warn('[PROFILE] Error rendering history:', err);
                }
            }, 0);
            
            // Load and display profile stats (non-blocking, delayed)
            setTimeout(() => {
                try {
                    renderProfileStats(user.username || user.email || '');
                    renderMyComments(user.username || user.email || '');
                    renderLikedComments();
                } catch (err) {
                    console.warn('[PROFILE] Error rendering profile stats:', err);
                }
            }, 0);
            
            console.log('[PROFILE] Profile page loaded for:', user.email || user.username || 'User');
        } catch (err) {
            console.error('[PROFILE] Error loading profile:', err);
            // Show guest state on error instead of redirecting or blocking
            try {
                renderGuestProfile();
            } catch (guestErr) {
                console.error('[PROFILE] Error rendering guest profile:', guestErr);
            }
        }
    } catch (err) {
        console.error('[PROFILE] Critical error in setupProfilePage:', err);
        // Never throw - profile setup is non-critical for homepage
    }
}

/**
 * Render guest profile state (not logged in)
 */
function renderGuestProfile() {
    // DOM FAIL-SAFE: Never throw, always handle gracefully
    try {
        // Update profile avatar (non-blocking)
        try {
            const avatarImg = document.getElementById('profile-avatar-img');
            if (avatarImg) {
                avatarImg.src = 'assets/avatars/avatar-male.png';
                avatarImg.alt = 'Guest';
            }
        } catch (err) {
            console.warn('[PROFILE] Error updating guest avatar:', err);
        }
        
        // Update username (non-blocking)
        try {
            const usernameEl = document.getElementById('profile-username');
            if (usernameEl) {
                usernameEl.textContent = 'Mehmon';
            }
        } catch (err) {
            console.warn('[PROFILE] Error updating guest username:', err);
        }
        
        // Update email (non-blocking)
        try {
            const emailEl = document.getElementById('profile-email');
            if (emailEl) {
                emailEl.textContent = 'Kirish yoki ro\'yxatdan o\'tish';
            }
        } catch (err) {
            console.warn('[PROFILE] Error updating guest email:', err);
        }
        
        // Hide logout button (non-blocking)
        try {
            const logoutBtn = document.getElementById('profile-logout-btn');
            if (logoutBtn) {
                logoutBtn.style.display = 'none';
            }
        } catch (err) {
            console.warn('[PROFILE] Error hiding logout button:', err);
        }
        
        // Replace account management button with login/register button (non-blocking)
        try {
            const accountBtn = document.getElementById('account-management-btn');
            if (accountBtn && accountBtn.parentNode) {
                // Check if already has guest listener
                if (accountBtn.dataset.guestMode === 'true') {
                    return; // Already set up
                }
                
                // Remove old listeners by cloning (safe)
                try {
                    const newBtn = accountBtn.cloneNode(true);
                    if (accountBtn.parentNode) {
                        accountBtn.parentNode.replaceChild(newBtn, accountBtn);
                        
                        // Update button content
                        newBtn.innerHTML = `
                            <svg class="profile-action-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                                <polyline points="10 17 15 12 10 7"></polyline>
                                <line x1="15" y1="12" x2="3" y2="12"></line>
                            </svg>
                            <span>Kirish / Ro'yxatdan o'tish</span>
                            <svg class="profile-action-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="9 18 15 12 9 6"></polyline>
                            </svg>
                        `;
                        
                        // Add new listener (non-blocking)
                        newBtn.dataset.listenerAdded = 'true';
                        newBtn.dataset.guestMode = 'true';
                        newBtn.addEventListener('click', (e) => {
                            try {
                                e.preventDefault();
                                e.stopPropagation();
                                window.location.href = 'auth.html';
                            } catch (navErr) {
                                console.error('[PROFILE] Navigation error:', navErr);
                            }
                        });
                    }
                } catch (cloneErr) {
                    console.warn('[PROFILE] Error cloning account button:', cloneErr);
                    // Fallback: just update content without cloning
                    try {
                        accountBtn.innerHTML = `
                            <svg class="profile-action-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                                <polyline points="10 17 15 12 10 7"></polyline>
                                <line x1="15" y1="12" x2="3" y2="12"></line>
                            </svg>
                            <span>Kirish / Ro'yxatdan o'tish</span>
                        `;
                        accountBtn.dataset.guestMode = 'true';
                        if (accountBtn.dataset.listenerAdded !== 'true') {
                            accountBtn.dataset.listenerAdded = 'true';
                            accountBtn.addEventListener('click', () => {
                                window.location.href = 'auth.html';
                            });
                        }
                    } catch (fallbackErr) {
                        console.warn('[PROFILE] Fallback button update failed:', fallbackErr);
                    }
                }
            }
        } catch (err) {
            console.warn('[PROFILE] Error setting up guest account button:', err);
        }
        
        console.log('[PROFILE] Guest profile state rendered');
    } catch (err) {
        console.error('[PROFILE] Critical error in renderGuestProfile:', err);
        // Never throw - guest profile is non-critical
    }
}


/**
 * Render favorites list in profile
 * CRITICAL: Only works if manhwasData is loaded
 */
function renderFavorites() {
    // CRITICAL: Guard - check if on profile page and data loaded
    const pageType = getPageType();
    if (pageType !== 'profile') {
        return;
    }
    
    if (!manhwasData || manhwasData.length === 0) {
        console.warn('[PROFILE] Cannot render favorites: manhwasData not loaded');
        return;
    }
    
    try {
        // Find the "O'qiladigan manhwalar" section (2nd section)
        const sections = document.querySelectorAll('.profile-section');
        let favoritesSection = null;
        
        // Find section containing "O'qiladigan manhwalar" title
        sections.forEach(section => {
            const title = section.querySelector('.profile-section-title');
            if (title && title.textContent.includes('O\'qiladigan')) {
                favoritesSection = section;
            }
        });
        
        if (!favoritesSection) {
            // Fallback to 2nd section
            favoritesSection = sections[1];
        }
        
        if (!favoritesSection) return;
        
        // Remove existing grid if any (prevent duplicates)
        const existingGrid = favoritesSection.querySelector('.profile-list-grid');
        if (existingGrid) {
            existingGrid.remove();
        }
        
        const placeholder = favoritesSection.querySelector('.profile-list-placeholder');
        const favorites = getFavorites();
        
        if (!favorites || favorites.length === 0) {
            // Show placeholder if no favorites
            if (placeholder) {
                placeholder.style.display = 'block';
            }
            return;
        }
        
        // Hide placeholder
        if (placeholder) {
            placeholder.style.display = 'none';
        }
        
        // Create grid container
        const grid = document.createElement('div');
        grid.className = 'profile-list-grid';
        
        favorites.forEach(manhwaId => {
            try {
                const manhwa = manhwasData.find(m => (m.id || m.slug) === manhwaId);
                if (manhwa) {
                    const card = createManhwaCard(manhwa);
                    if (card) {
                        grid.appendChild(card);
                    }
                }
            } catch (err) {
                console.warn(`[PROFILE] Error creating card for ${manhwaId}:`, err);
            }
        });
        
        // Insert grid before placeholder (or append if no placeholder)
        if (placeholder && placeholder.parentNode) {
            placeholder.parentNode.insertBefore(grid, placeholder);
        } else {
            favoritesSection.appendChild(grid);
        }
    } catch (err) {
        console.error('[PROFILE] Error in renderFavorites:', err);
    }
}

/**
 * Render currently reading in profile
 * CRITICAL: Only works if manhwasData is loaded
 */
function renderCurrentlyReading() {
    // CRITICAL: Guard - check if on profile page and data loaded
    const pageType = getPageType();
    if (pageType !== 'profile') {
        return;
    }
    
    if (!manhwasData || manhwasData.length === 0) {
        console.warn('[PROFILE] Cannot render currently reading: manhwasData not loaded');
        return;
    }
    
    try {
        // Find the "Hozir o'qiyotgan" section (3rd section)
        const sections = document.querySelectorAll('.profile-section');
        let readingSection = null;
        
        // Find section containing "Hozir o'qiyotgan" title
        sections.forEach(section => {
            const title = section.querySelector('.profile-section-title');
            if (title && title.textContent.includes('Hozir')) {
                readingSection = section;
            }
        });
        
        if (!readingSection) {
            // Fallback to 3rd section
            readingSection = sections[2];
        }
        
        if (!readingSection) return;
        
        // Remove existing grid if any (prevent duplicates)
        const existingGrid = readingSection.querySelector('.profile-list-grid');
        if (existingGrid) {
            existingGrid.remove();
        }
        
        const placeholder = readingSection.querySelector('.profile-list-placeholder');
        const currentlyReading = getCurrentlyReading();
        
        if (!currentlyReading || !currentlyReading.manhwaId) {
            // Show placeholder if nothing is being read
            if (placeholder) {
                placeholder.style.display = 'block';
            }
            return;
        }
        
        const manhwa = manhwasData.find(m => (m.id || m.slug) === currentlyReading.manhwaId);
        if (!manhwa) {
            // Show placeholder if manhwa not found
            if (placeholder) {
                placeholder.style.display = 'block';
            }
            return;
        }
        
        // Hide placeholder
        if (placeholder) {
            placeholder.style.display = 'none';
        }
        
        // Create grid container (single item)
        const grid = document.createElement('div');
        grid.className = 'profile-list-grid';
        
        try {
            const card = createManhwaCard(manhwa);
            if (card) {
                grid.appendChild(card);
            }
        } catch (err) {
            console.warn('[PROFILE] Error creating currently reading card:', err);
            if (placeholder) {
                placeholder.style.display = 'block';
            }
            return;
        }
        
        // Insert grid before placeholder (or append if no placeholder)
        if (placeholder && placeholder.parentNode) {
            placeholder.parentNode.insertBefore(grid, placeholder);
        } else {
            readingSection.appendChild(grid);
        }
    } catch (err) {
        console.error('[PROFILE] Error in renderCurrentlyReading:', err);
    }
}

/**
 * Render history in profile (optional, can be added to a new section)
 * CRITICAL: Currently just logs, doesn't render to DOM
 */
function renderHistory() {
    // CRITICAL: Guard - check if on profile page
    const pageType = getPageType();
    if (pageType !== 'profile') {
        return;
    }
    
    try {
        const history = getHistory();
        if (!history || history.length === 0) {
            console.log('[PROFILE] History is empty');
            return;
        }
        
        // History is tracked but not displayed in a separate section for MVP
        // Can be enhanced later to show in a dedicated section
        console.log('[PROFILE] History:', history);
    } catch (err) {
        console.warn('[PROFILE] Error in renderHistory:', err);
    }
}

/**
 * Calculate and render profile stats
 */
function renderProfileStats(username) {
    try {
        const pageType = getPageType();
        if (pageType !== 'profile') return;
        
        if (!username || username === 'Guest') {
            // Set all stats to 0 for guest
            const readStat = document.getElementById('profile-stat-read');
            const commentsStat = document.getElementById('profile-stat-comments');
            const likesStat = document.getElementById('profile-stat-likes');
            if (readStat) readStat.textContent = '0';
            if (commentsStat) commentsStat.textContent = '0';
            if (likesStat) likesStat.textContent = '0';
            return;
        }
        
        // Calculate read count (from history)
        const history = getHistory();
        const readCount = history ? history.length : 0;
        
        // Calculate comments count
        const allComments = loadAllComments();
        const userComments = allComments.filter(c => 
            (c.username === username || c.username === username.toLowerCase()) && !c.parentId
        );
        const repliesCount = allComments.reduce((count, c) => {
            if (c.replies && Array.isArray(c.replies)) {
                return count + c.replies.filter(r => r.username === username || r.username === username.toLowerCase()).length;
            }
            return count;
        }, 0);
        const commentsCount = userComments.length + repliesCount;
        
        // Calculate liked comments count
        const userId = getCurrentUserId();
        let likedCount = 0;
        allComments.forEach(comment => {
            if (comment.likes && Array.isArray(comment.likes) && comment.likes.includes(userId)) {
                likedCount++;
            }
            if (comment.replies && Array.isArray(comment.replies)) {
                comment.replies.forEach(reply => {
                    if (reply.likes && Array.isArray(reply.likes) && reply.likes.includes(userId)) {
                        likedCount++;
                    }
                });
            }
        });
        
        // Update DOM
        const readStat = document.getElementById('profile-stat-read');
        const commentsStat = document.getElementById('profile-stat-comments');
        const likesStat = document.getElementById('profile-stat-likes');
        
        if (readStat) readStat.textContent = readCount.toString();
        if (commentsStat) commentsStat.textContent = commentsCount.toString();
        if (likesStat) likesStat.textContent = likedCount.toString();
        
    } catch (err) {
        console.warn('[PROFILE] Error rendering stats:', err);
    }
}

/**
 * Render user's own comments
 */
function renderMyComments(username) {
    try {
        const pageType = getPageType();
        if (pageType !== 'profile') return;
        
        const commentsList = document.getElementById('profile-comments-list');
        if (!commentsList) return;
        
        if (!username || username === 'Guest') {
            return; // Keep placeholder
        }
        
        const allComments = loadAllComments();
        const userComments = allComments.filter(c => 
            (c.username === username || c.username === username.toLowerCase()) && !c.parentId
        );
        
        if (userComments.length === 0) {
            return; // Keep placeholder
        }
        
        // Remove placeholder styling
        commentsList.className = 'profile-comments-container';
        commentsList.innerHTML = '';
        
        // Sort by timestamp (newest first)
        const sorted = userComments.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        
        // Limit to 10 most recent
        sorted.slice(0, 10).forEach(comment => {
            try {
                const card = createProfileCommentCard(comment, false);
                if (card) commentsList.appendChild(card);
            } catch (err) {
                console.warn('[PROFILE] Error creating comment card:', err);
            }
        });
        
    } catch (err) {
        console.warn('[PROFILE] Error rendering my comments:', err);
    }
}

/**
 * Render liked comments
 */
function renderLikedComments() {
    try {
        const pageType = getPageType();
        if (pageType !== 'profile') return;
        
        const commentsList = document.getElementById('profile-liked-comments-list');
        if (!commentsList) return;
        
        const userId = getCurrentUserId();
        const allComments = loadAllComments();
        const likedComments = [];
        
        allComments.forEach(comment => {
            if (comment.likes && Array.isArray(comment.likes) && comment.likes.includes(userId)) {
                likedComments.push(comment);
            }
            if (comment.replies && Array.isArray(comment.replies)) {
                comment.replies.forEach(reply => {
                    if (reply.likes && Array.isArray(reply.likes) && reply.likes.includes(userId)) {
                        likedComments.push({ ...reply, parentComment: comment });
                    }
                });
            }
        });
        
        if (likedComments.length === 0) {
            return; // Keep placeholder
        }
        
        // Remove placeholder styling
        commentsList.className = 'profile-comments-container';
        commentsList.innerHTML = '';
        
        // Sort by timestamp (newest first)
        const sorted = likedComments.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        
        // Limit to 10 most recent
        sorted.slice(0, 10).forEach(comment => {
            try {
                const card = createProfileCommentCard(comment, true);
                if (card) commentsList.appendChild(card);
            } catch (err) {
                console.warn('[PROFILE] Error creating liked comment card:', err);
            }
        });
        
    } catch (err) {
        console.warn('[PROFILE] Error rendering liked comments:', err);
    }
}

/**
 * Create a comment card for profile page
 */
function createProfileCommentCard(comment, isLiked = false) {
    try {
        const card = document.createElement('div');
        card.className = 'profile-comment-card';
        
        const manhwa = manhwasData.find(m => m.id === comment.manhwaId);
        const manhwaTitle = manhwa ? manhwa.title : 'Noma\'lum manhwa';
        
        // Click to navigate to manhwa
        card.addEventListener('click', () => {
            try {
                window.location.href = `index.html?id=${comment.manhwaId}`;
            } catch (err) {
                console.warn('[PROFILE] Error navigating:', err);
            }
        });
        
        const header = document.createElement('div');
        header.className = 'profile-comment-header';
        
        const title = document.createElement('div');
        title.className = 'profile-comment-manhwa';
        title.textContent = manhwaTitle;
        
        const time = document.createElement('div');
        time.className = 'profile-comment-time';
        time.textContent = formatRelativeTime(comment.timestamp || Date.now());
        
        header.appendChild(title);
        header.appendChild(time);
        
        const text = document.createElement('div');
        text.className = 'profile-comment-text';
        const preview = (comment.text || '').length > 100 
            ? (comment.text || '').substring(0, 100) + '...' 
            : (comment.text || '');
        text.textContent = preview;
        
        const footer = document.createElement('div');
        footer.className = 'profile-comment-footer';
        
        if (isLiked) {
            const likeIcon = document.createElement('span');
            likeIcon.textContent = '❤️';
            likeIcon.className = 'profile-comment-like-icon';
            footer.appendChild(likeIcon);
        }
        
        const likes = getCommentLikeCount(comment.id, comment.parentId || null);
        if (likes > 0) {
            const likesSpan = document.createElement('span');
            likesSpan.className = 'profile-comment-likes';
            likesSpan.textContent = `❤️ ${likes}`;
            footer.appendChild(likesSpan);
        }
        
        card.appendChild(header);
        card.appendChild(text);
        card.appendChild(footer);
        
        return card;
    } catch (err) {
        console.warn('[PROFILE] Error creating profile comment card:', err);
        return null;
    }
}

function setupInternalPages() {
    // DOM FAIL-SAFE: Only setup if elements exist, never block
    try {
        // Index.html ichidagi search-page uchun search setup
        const internalSearchInput = document.querySelector('#search-page #search-input');
        if (internalSearchInput && internalSearchInput.dataset.listenerAdded !== 'true') {
            try {
                internalSearchInput.dataset.listenerAdded = 'true';
                internalSearchInput.addEventListener('input', (e) => {
                    try {
                        const query = e.target?.value || '';
                        const resultsContainer = document.querySelector('#search-page #search-results');
                        if (!resultsContainer) return;
                        
                        // Use same renderSearchResults logic
                        const searchQuery = query.toLowerCase().trim();
                        
                        if (searchQuery.length === 0) {
                            resultsContainer.innerHTML = '<div class="empty-state">Qidiruv natijalari</div>';
                            return;
                        }
                        
                        // DATA FAIL-SAFE: Check if data is loaded
                        if (!manhwasData || !Array.isArray(manhwasData) || manhwasData.length === 0) {
                            resultsContainer.innerHTML = '<div class="empty-state">Ma\'lumotlar yuklanmoqda...</div>';
                            // Try to load data
                            loadData().then(() => {
                                // Retry search after data loads
                                if (e.target) {
                                    e.target.dispatchEvent(new Event('input'));
                                }
                            }).catch(() => {
                                resultsContainer.innerHTML = '<div class="empty-state">Ma\'lumotlar yuklanmadi</div>';
                            });
                            return;
                        }
                        
                        const results = manhwasData.filter(manhwa => {
                            try {
                                if (!manhwa || typeof manhwa !== 'object') return false;
                                const title = (manhwa.title || '').toLowerCase();
                                return title.includes(searchQuery);
                            } catch (err) {
                                return false;
                            }
                        });
                        
                        if (results.length === 0) {
                            resultsContainer.innerHTML = '<div class="empty-state">Natija topilmadi</div>';
                            return;
                        }
                        
                        resultsContainer.innerHTML = '';
                        const grid = document.createElement('div');
                        grid.className = 'manhwa-grid';
                        
                        const fragment = document.createDocumentFragment();
                        results.forEach(manhwa => {
                            try {
                                if (!manhwa) return;
                                const card = createManhwaCard(manhwa);
                                if (card && fragment) fragment.appendChild(card);
                            } catch (err) {
                                console.warn('[INTERNAL] Error creating card:', err);
                            }
                        });
                        
                        if (grid && fragment) {
                            grid.appendChild(fragment);
                            resultsContainer.appendChild(grid);
                        }
                    } catch (err) {
                        console.error('[INTERNAL] Search input error:', err);
                        const resultsContainer = document.querySelector('#search-page #search-results');
                        if (resultsContainer) {
                            resultsContainer.innerHTML = '<div class="empty-state">Qidiruv xatosi</div>';
                        }
                    }
                });
            } catch (err) {
                console.error('[INTERNAL] Error setting up search input:', err);
            }
        }
        
        // Channels va History sahifalarini render qilish (non-critical, isolated)
        try {
            renderChannelsPage();
        } catch (err) {
            console.error('[INTERNAL] Channels page render error (non-critical):', err);
        }
        
        try {
            renderHistoryPage();
        } catch (err) {
            console.error('[INTERNAL] History page render error (non-critical):', err);
        }
    } catch (err) {
        console.error('[INTERNAL] Internal pages setup error:', err);
        // Never throw - this is non-critical
    }
}

// ============================================
// COMMENT SYSTEM - MANHWA COMMENTS & ACTIVITY FEED
// ============================================

/**
 * Comment localStorage functions
 */
function saveComment(comment) {
    try {
        if (!comment || !comment.manhwaId || !comment.text) {
            console.warn('[COMMENT] Invalid comment data');
            return false;
        }
        
        // CRITICAL: Normalize username (trim and lowercase for consistency)
        let username = (comment.username || 'Guest').trim();
        if (username !== 'Guest' && username) {
            // For non-guest users, try to get the actual username from localStorage
            // This ensures consistency between comment username and stored user data
            try {
                const userStr = localStorage.getItem('azura_user');
                if (userStr) {
                    const authUser = JSON.parse(userStr);
                    const authUsername = (authUser.username || '').trim();
                    const authEmail = (authUser.email || '').trim();
                    const usernameLower = username.toLowerCase();
                    
                    // If comment username matches auth user, use auth username for consistency
                    if (authUsername && authUsername.toLowerCase() === usernameLower) {
                        username = authUsername;
                    } else if (authEmail && authEmail.toLowerCase() === usernameLower) {
                        username = authEmail;
                    }
                }
            } catch (err) {
                console.warn('[COMMENT] Error normalizing username:', err);
            }
        }
        
        // SIMPLE VERSION: Get and save avatar
        let userAvatar = null;
        if (username !== 'Guest') {
            userAvatar = getUserAvatar(username);
        }
        
        const comments = loadAllComments();
        // Get manhwa title for comment
        let manhwaTitle = comment.manhwaTitle || 'Noma\'lum manhwa';
        if (comment.manhwaId && manhwasData) {
            const manhwa = manhwasData.find(m => m.id === comment.manhwaId || m.slug === comment.manhwaId);
            if (manhwa && manhwa.title) {
                manhwaTitle = manhwa.title;
            }
        }
        
        const newComment = {
            manhwaId: comment.manhwaId,
            manhwaTitle: manhwaTitle,
            userId: comment.userId || null,
            username: username,
            avatar: userAvatar || comment.avatar || null,
            text: comment.text.trim(),
            timestamp: comment.timestamp || Date.now(),
            createdAt: comment.createdAt || Date.now(),
            id: comment.id || `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            likes: comment.likes || 0, // Like count
            userLiked: comment.userLiked || false, // User liked status
            replies: comment.replies || [], // Initialize replies array
            parentId: comment.parentId || null, // For nested replies
            replyTo: comment.replyTo || null // Username being replied to
        };
        
        // If this is a reply, add it to parent comment's replies array
        if (comment.parentId) {
            const parentComment = comments.find(c => c.id === comment.parentId);
            if (parentComment) {
                if (!parentComment.replies || !Array.isArray(parentComment.replies)) {
                    parentComment.replies = [];
                }
                parentComment.replies.push(newComment);
                
                // Save updated comments with reply added to parent
                localStorage.setItem('azura_comments', JSON.stringify(comments));
                
                // Update genre activity (on parent manhwa)
                updateGenreActivity(parentComment.manhwaId);
                
                // Trigger global update
                triggerGlobalCommentUpdate();
                
                console.log('[COMMENT] Reply saved:', newComment.id);
                return true;
            } else {
                console.warn('[COMMENT] Parent comment not found:', comment.parentId);
                return false;
            }
        } else {
            // Top-level comment
            comments.push(newComment);
            localStorage.setItem('azura_comments', JSON.stringify(comments));
            
            // Update genre activity
            updateGenreActivity(newComment.manhwaId);
            
            // Trigger global update
            triggerGlobalCommentUpdate();
            
            console.log('[COMMENT] Comment saved:', newComment.id);
            return true;
        }
    } catch (err) {
        console.error('[COMMENT] Error saving comment:', err);
        return false;
    }
}

function loadAllComments() {
    try {
        const stored = localStorage.getItem('azura_comments');
        if (!stored) return [];
        const comments = JSON.parse(stored);
        return Array.isArray(comments) ? comments : [];
    } catch (err) {
        console.warn('[COMMENT] Error loading comments:', err);
        return [];
    }
}

function getCommentsByManhwaId(manhwaId) {
    try {
        const allComments = loadAllComments();
        // Filter only top-level comments (not replies)
        const filtered = allComments.filter(c => c.manhwaId === manhwaId && !c.parentId);
        
        // Initialize likes and replies for legacy comments
        filtered.forEach(comment => {
            if (!comment.likes || typeof comment.likes === 'number') {
                comment.likes = [];
            }
            if (!comment.replies || !Array.isArray(comment.replies)) {
                comment.replies = [];
            }
            // Initialize replies' likes as well
            if (comment.replies && Array.isArray(comment.replies)) {
                comment.replies.forEach(reply => {
                    if (!reply.likes || typeof reply.likes === 'number') {
                        reply.likes = [];
                    }
                });
            }
        });
        
        // Sort: Top liked first, then by timestamp (newest first)
        return filtered.sort((a, b) => {
            const aLikes = Array.isArray(a.likes) ? a.likes.length : 0;
            const bLikes = Array.isArray(b.likes) ? b.likes.length : 0;
            
            // If one has significantly more likes, prioritize it
            if (aLikes > 0 && bLikes === 0) return -1;
            if (bLikes > 0 && aLikes === 0) return 1;
            
            // If both have likes, sort by like count
            if (aLikes !== bLikes) {
                return bLikes - aLikes;
            }
            
            // Otherwise sort by timestamp
            return (b.timestamp || 0) - (a.timestamp || 0);
        });
    } catch (err) {
        console.warn('[COMMENT] Error getting comments by manhwaId:', err);
        return [];
    }
}

// ============================================
// LIKE SYSTEM FOR COMMENTS
// ============================================

/**
 * Get current user ID (for like tracking)
 */
function getCurrentUserId() {
    try {
        // Try to get from localStorage user data
        const userStr = localStorage.getItem('azura_user');
        if (userStr) {
            const user = JSON.parse(userStr);
            if (user && user.email) {
                return user.email; // Use email as unique ID
            }
        }
        
        // Fallback: Use browser fingerprint (simple)
        let userId = localStorage.getItem('azura_guest_id');
        if (!userId) {
            userId = 'guest_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('azura_guest_id', userId);
        }
        return userId;
    } catch (err) {
        // Ultimate fallback
        return 'guest_' + Date.now();
    }
}

/**
 * Toggle like on a comment or reply
 */
function toggleCommentLike(commentId, parentId = null) {
    try {
        const comments = loadAllComments();
        let comment = null;
        
        // If parentId is provided, search in replies
        if (parentId) {
            const parentComment = comments.find(c => c.id === parentId);
            if (parentComment && parentComment.replies) {
                comment = parentComment.replies.find(r => r.id === commentId);
            }
        } else {
            // Search in top-level comments
            comment = comments.find(c => c.id === commentId);
        }
        
        if (!comment) {
            console.warn('[LIKE] Comment not found:', commentId);
            return false;
        }
        
        // Initialize likes array if needed
        if (!comment.likes || typeof comment.likes === 'number') {
            comment.likes = [];
        }
        
        const userId = getCurrentUserId();
        const likeIndex = comment.likes.indexOf(userId);
        
        if (likeIndex > -1) {
            // Unlike
            comment.likes.splice(likeIndex, 1);
        } else {
            // Like
            comment.likes.push(userId);
        }
        
        // Save updated comments
        localStorage.setItem('azura_comments', JSON.stringify(comments));
        
        return true;
    } catch (err) {
        console.error('[LIKE] Error toggling like:', err);
        return false;
    }
}

/**
 * Check if current user liked a comment or reply
 */
function isCommentLiked(commentId, parentId = null) {
    try {
        const comments = loadAllComments();
        let comment = null;
        
        if (parentId) {
            const parentComment = comments.find(c => c.id === parentId);
            if (parentComment && parentComment.replies) {
                comment = parentComment.replies.find(r => r.id === commentId);
            }
        } else {
            comment = comments.find(c => c.id === commentId);
        }
        
        if (!comment || !comment.likes || !Array.isArray(comment.likes)) {
            return false;
        }
        
        const userId = getCurrentUserId();
        return comment.likes.indexOf(userId) > -1;
    } catch (err) {
        return false;
    }
}

/**
 * Get like count for a comment or reply
 */
function getCommentLikeCount(commentId, parentId = null) {
    try {
        const comments = loadAllComments();
        let comment = null;
        
        if (parentId) {
            const parentComment = comments.find(c => c.id === parentId);
            if (parentComment && parentComment.replies) {
                comment = parentComment.replies.find(r => r.id === commentId);
            }
        } else {
            comment = comments.find(c => c.id === commentId);
        }
        
        if (!comment || !comment.likes || !Array.isArray(comment.likes)) {
            return 0;
        }
        return comment.likes.length;
    } catch (err) {
        return 0;
    }
}

// ============================================
// UNIFIED USER SYSTEM (azura_users)
// ============================================

/**
 * Get unified user data from azura_users
 * Migrates from azura_profiles if needed
 */
function getUnifiedUser(username) {
    try {
        if (!username || username === 'Guest') {
            return {
                id: 'guest',
                username: 'Guest',
                email: null,
                avatar: null,
                nickname: null,
                bio: null,
                createdAt: Date.now()
            };
        }
        
        // Try azura_users first
        let users = {};
        try {
            const usersStr = localStorage.getItem('azura_users');
            if (usersStr) {
                users = JSON.parse(usersStr);
            }
        } catch (err) {
            users = {};
        }
        
        // Find user by username or email (case-insensitive)
        let user = null;
        const usernameLower = username.toLowerCase().trim();
        if (users && typeof users === 'object') {
            // Check if it's an array or object
            if (Array.isArray(users)) {
                user = users.find(u => {
                    const uUsername = (u.username || '').toLowerCase().trim();
                    const uEmail = (u.email || '').toLowerCase().trim();
                    return uUsername === usernameLower || uEmail === usernameLower;
                });
            } else {
                // Try exact match first
                user = users[username] || null;
                // If not found, try case-insensitive search
                if (!user) {
                    const keys = Object.keys(users);
                    const matchingKey = keys.find(key => {
                        const keyLower = key.toLowerCase().trim();
                        return keyLower === usernameLower;
                    });
                    if (matchingKey) {
                        user = users[matchingKey];
                    }
                }
            }
        }
        
        // If not found, try migration from azura_profiles
        if (!user) {
            user = migrateUserFromProfiles(username);
        }
        
        return user || null;
    } catch (err) {
        console.warn('[USER] Error getting unified user:', err);
        return null;
    }
}

/**
 * Migrate user from azura_profiles to azura_users
 */
function migrateUserFromProfiles(username) {
    try {
        const profilesStr = localStorage.getItem('azura_profiles');
        if (!profilesStr) return null;
        
        const profiles = JSON.parse(profilesStr);
        const profile = profiles[username];
        
        if (!profile) return null;
        
        // Create unified user object
        const user = {
            id: username,
            username: username,
            email: null,
            avatar: profile.avatar || null,
            nickname: profile.nickname || username,
            bio: profile.bio || null,
            createdAt: profile.updatedAt || Date.now()
        };
        
        // Save to azura_users
        saveUnifiedUser(user);
        
        return user;
    } catch (err) {
        console.warn('[USER] Error migrating user:', err);
        return null;
    }
}

/**
 * Save unified user to azura_users
 */
function saveUnifiedUser(userData) {
    try {
        if (!userData || !userData.username || userData.username === 'Guest') {
            return false;
        }
        
        let users = {};
        try {
            const usersStr = localStorage.getItem('azura_users');
            if (usersStr) {
                users = JSON.parse(usersStr);
                // Handle array format (migrate to object)
                if (Array.isArray(users)) {
                    const newUsers = {};
                    users.forEach(u => {
                        if (u.username) {
                            newUsers[u.username] = u;
                        }
                    });
                    users = newUsers;
                }
            }
        } catch (err) {
            users = {};
        }
        
        // Ensure user object has all required fields
        const user = {
            id: userData.id || userData.username,
            username: userData.username,
            email: userData.email || null,
            avatar: userData.avatar || null,
            nickname: userData.nickname || userData.username,
            bio: userData.bio || null,
            createdAt: userData.createdAt || Date.now()
        };
        
        // Update existing user or create new
        users[user.username] = user;
        
        localStorage.setItem('azura_users', JSON.stringify(users));
        return true;
    } catch (err) {
        console.error('[USER] Error saving unified user:', err);
        return false;
    }
}

/**
 * Get user profile data (backward compatibility - uses unified system)
 */
function getUserProfile(username) {
    try {
        const user = getUnifiedUser(username);
        if (!user) {
            if (!username || username === 'Guest') {
                return {
                    username: 'Guest',
                    avatar: null,
                    bio: null,
                    nickname: null
                };
            }
            return null;
        }
        
        return {
            username: user.username,
            nickname: user.nickname || user.username,
            avatar: user.avatar || null,
            bio: user.bio || null
        };
    } catch (err) {
        console.warn('[PROFILE] Error getting user profile:', err);
        return null;
    }
}

/**
 * Save user profile data (backward compatibility - uses unified system)
 */
function saveUserProfile(username, profileData) {
    try {
        if (!username || username === 'Guest') {
            return false;
        }
        
        const existingUser = getUnifiedUser(username);
        
        const userData = {
            id: existingUser?.id || username,
            username: username,
            email: existingUser?.email || null,
            avatar: profileData.avatar || existingUser?.avatar || null,
            nickname: profileData.nickname || username,
            bio: profileData.bio || null,
            createdAt: existingUser?.createdAt || Date.now()
        };
        
        return saveUnifiedUser(userData);
    } catch (err) {
        console.error('[PROFILE] Error saving profile:', err);
        return false;
    }
}

/**
 * Get display name for a user (nickname or username) - unified system
 */
function getDisplayName(username) {
    try {
        if (!username || username === 'Guest') {
            return 'Guest';
        }
        
        const user = getUnifiedUser(username);
        if (user && user.nickname) {
            return user.nickname;
        }
        return username;
    } catch (err) {
        return username || 'Guest';
    }
}

/**
 * Get avatar for a user - SIMPLE AND RELIABLE VERSION
 * Checks all possible sources in order
 */
function getUserAvatar(username) {
    if (!username || username === 'Guest' || username.trim() === '') {
        return null;
    }
    
    const usernameLower = username.toLowerCase().trim();
    let avatar = null;
    
    // 1. Try getUnifiedUser (handles azura_users and migration)
    try {
        const user = getUnifiedUser(username);
        if (user && user.avatar && user.avatar.trim() !== '') {
            console.log(`[AVATAR] Found for ${username} in unified system`);
            return user.avatar;
        }
    } catch (e) {
        console.warn(`[AVATAR] Error in getUnifiedUser for ${username}:`, e);
    }
    
    // 2. Try azura_users directly (case-insensitive)
    try {
        const usersStr = localStorage.getItem('azura_users');
        if (usersStr) {
            const users = JSON.parse(usersStr);
            
            if (Array.isArray(users)) {
                for (const u of users) {
                    const uName = (u.username || '').toLowerCase().trim();
                    const uEmail = (u.email || '').toLowerCase().trim();
                    if ((uName === usernameLower || uEmail === usernameLower) && u.avatar && u.avatar.trim() !== '') {
                        console.log(`[AVATAR] Found for ${username} in azura_users array`);
                        return u.avatar;
                    }
                }
            } else if (typeof users === 'object' && users !== null) {
                // Try exact key
                if (users[username] && users[username].avatar && users[username].avatar.trim() !== '') {
                    console.log(`[AVATAR] Found for ${username} in azura_users (exact)`);
                    return users[username].avatar;
                }
                // Try case-insensitive
                for (const key in users) {
                    if (key.toLowerCase().trim() === usernameLower && users[key].avatar && users[key].avatar.trim() !== '') {
                        console.log(`[AVATAR] Found for ${username} in azura_users (case-insensitive)`);
                        return users[key].avatar;
                    }
                }
            }
        }
    } catch (e) {
        console.warn(`[AVATAR] Error searching azura_users for ${username}:`, e);
    }
    
    // 3. Try azura_profiles (legacy)
    try {
        const profilesStr = localStorage.getItem('azura_profiles');
        if (profilesStr) {
            const profiles = JSON.parse(profilesStr);
            if (profiles[username] && profiles[username].avatar && profiles[username].avatar.trim() !== '') {
                console.log(`[AVATAR] Found for ${username} in azura_profiles`);
                return profiles[username].avatar;
            }
            // Case-insensitive
            for (const key in profiles) {
                if (key.toLowerCase().trim() === usernameLower && profiles[key].avatar && profiles[key].avatar.trim() !== '') {
                    console.log(`[AVATAR] Found for ${username} in azura_profiles (case-insensitive)`);
                    return profiles[key].avatar;
                }
            }
        }
    } catch (e) {
        console.warn(`[AVATAR] Error searching azura_profiles for ${username}:`, e);
    }
    
    // 4. Try Google auth user
    try {
        const userStr = localStorage.getItem('azura_user');
        if (userStr) {
            const authUser = JSON.parse(userStr);
            const authName = (authUser.username || '').toLowerCase().trim();
            const authEmail = (authUser.email || '').toLowerCase().trim();
            if ((authName === usernameLower || authEmail === usernameLower) && authUser.picture && authUser.picture.trim() !== '') {
                console.log(`[AVATAR] Found for ${username} in Google auth`);
                return authUser.picture;
            }
        }
    } catch (e) {
        console.warn(`[AVATAR] Error checking Google auth for ${username}:`, e);
    }
    
    console.warn(`[AVATAR] No avatar found for ${username}`);
    return null;
}

/**
 * Update all profile avatars across the site (unified system)
 */
function updateAllProfileAvatars(username, avatarUrl) {
    try {
        if (!username || username === 'Guest') return;
        
        // Save to unified user system
        try {
            const user = getUnifiedUser(username);
            if (user) {
                user.avatar = avatarUrl;
                saveUnifiedUser(user);
            } else {
                // Create new user entry
                saveUnifiedUser({
                    id: username,
                    username: username,
                    email: null,
                    avatar: avatarUrl,
                    nickname: username,
                    bio: null,
                    createdAt: Date.now()
                });
            }
        } catch (err) {
            console.warn('[AVATAR] Error saving to unified system:', err);
        }
        
        // Update all profile avatar images in headers
        const profileAvatars = document.querySelectorAll('.profile-avatar');
        profileAvatars.forEach(avatar => {
            try {
                if (avatar && avatar.nodeType === 1) {
                    // Check if this avatar belongs to the user
                    const avatarUsername = avatar.dataset.username || 
                        (avatar.alt && avatar.alt !== 'Profile' ? avatar.alt : null);
                    
                    if (avatarUsername === username || !avatarUsername) {
                        // Update if it's the user's avatar or no username is set
                        if (avatarUrl) {
                            avatar.src = avatarUrl;
                            avatar.onerror = function() {
                                if (this) this.src = 'assets/avatars/avatar-male.png';
                            };
                        }
                    }
                }
            } catch (err) {
                console.warn('[AVATAR] Error updating avatar element:', err);
            }
        });
        
        // Re-render comments to update avatars (note: old comments keep their stored avatars)
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const manhwaId = urlParams.get('id');
            if (manhwaId) {
                setTimeout(() => {
                    renderComments(manhwaId);
                }, 100);
            }
        } catch (err) {
            // Ignore - comment rendering is optional
        }
        
        // Re-render recent comments
        try {
            setTimeout(() => {
                renderRecentComments();
            }, 100);
        } catch (err) {
            // Ignore - recent comments rendering is optional
        }
        
        // Update profile page if on profile page
        try {
            const profilePage = document.querySelector('.profile-page');
            if (profilePage) {
                const avatarImg = document.getElementById('profile-avatar-img');
                if (avatarImg) {
                    if (avatarUrl) {
                        avatarImg.src = avatarUrl;
                        avatarImg.onerror = function() {
                            if (this) this.src = 'assets/avatars/avatar-male.png';
                        };
                    }
                }
            }
        } catch (err) {
            // Ignore
        }
        
    } catch (err) {
        console.warn('[AVATAR] Error updating all profile avatars:', err);
    }
}

// ============================================
// EDIT PROFILE MODAL
// ============================================

/**
 * Open edit profile modal
 */
function openEditProfileModal(user) {
    try {
        const modal = document.getElementById('edit-profile-modal');
        if (!modal) {
            console.warn('[PROFILE] Edit modal not found');
            return;
        }
        
        const username = user.username || user.email || '';
        const profile = getUserProfile(username);
        
        // Set current values
        const nicknameInput = document.getElementById('edit-profile-nickname');
        const bioInput = document.getElementById('edit-profile-bio');
        const avatarPreview = document.getElementById('edit-profile-avatar-img');
        
        if (nicknameInput) {
            nicknameInput.value = profile ? (profile.nickname || username) : username;
        }
        
        if (bioInput) {
            bioInput.value = profile ? (profile.bio || '') : '';
        }
        
        if (avatarPreview) {
            if (profile && profile.avatar) {
                avatarPreview.src = profile.avatar;
            } else if (user.picture && user.provider === 'google') {
                avatarPreview.src = user.picture;
            } else {
                avatarPreview.src = 'assets/avatars/avatar-male.png';
            }
        }
        
        // Store current username for saving
        modal.dataset.username = username;
        
        // Show modal
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        
        // Setup event listeners
        setupEditProfileModal();
        
        console.log('[PROFILE] Edit modal opened');
    } catch (err) {
        console.error('[PROFILE] Error opening edit modal:', err);
    }
}

/**
 * Close edit profile modal
 */
function closeEditProfileModal() {
    try {
        const modal = document.getElementById('edit-profile-modal');
        if (modal) {
            modal.style.display = 'none';
        }
        document.body.style.overflow = '';
    } catch (err) {
        console.warn('[PROFILE] Error closing modal:', err);
    }
}

/**
 * Setup edit profile modal event listeners
 */
function setupEditProfileModal() {
    try {
        const modal = document.getElementById('edit-profile-modal');
        if (!modal || modal.dataset.setup === 'true') {
            return;
        }
        modal.dataset.setup = 'true';
        
        // Close button
        const closeBtn = document.getElementById('edit-profile-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeEditProfileModal);
        }
        
        // Cancel button
        const cancelBtn = document.getElementById('edit-profile-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', closeEditProfileModal);
        }
        
        // Overlay click to close
        const overlay = modal.querySelector('.edit-profile-overlay');
        if (overlay) {
            overlay.addEventListener('click', closeEditProfileModal);
        }
        
        // Avatar upload button
        const avatarBtn = document.getElementById('edit-profile-avatar-btn');
        const avatarInput = document.getElementById('edit-profile-avatar-input');
        const avatarPreview = document.getElementById('edit-profile-avatar-img');
        
        if (avatarBtn && avatarInput) {
            avatarBtn.addEventListener('click', () => {
                avatarInput.click();
            });
            
            avatarInput.addEventListener('change', (e) => {
                try {
                    const file = e.target.files[0];
                    if (!file) return;
                    
                    if (!file.type.startsWith('image/')) {
                        console.warn('[PROFILE] Invalid file type');
                        return;
                    }
                    
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        try {
                            const dataUrl = event.target.result;
                            if (avatarPreview) {
                                avatarPreview.src = dataUrl;
                            }
                            // Store in modal for saving
                            modal.dataset.avatarData = dataUrl;
                        } catch (err) {
                            console.warn('[PROFILE] Error loading avatar:', err);
                        }
                    };
                    reader.readAsDataURL(file);
                } catch (err) {
                    console.warn('[PROFILE] Error handling avatar upload:', err);
                }
            });
        }
        
        // Save button
        const saveBtn = document.getElementById('edit-profile-save');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                try {
                    const username = modal.dataset.username;
                    if (!username) {
                        console.warn('[PROFILE] No username for saving');
                        return;
                    }
                    
                    const nicknameInput = document.getElementById('edit-profile-nickname');
                    const bioInput = document.getElementById('edit-profile-bio');
                    
                    const profileData = {
                        nickname: nicknameInput ? nicknameInput.value.trim() : '',
                        bio: bioInput ? bioInput.value.trim() : '',
                        avatar: modal.dataset.avatarData || null
                    };
                    
                    // Get existing profile to preserve avatar if not changed
                    const existingProfile = getUserProfile(username);
                    if (!profileData.avatar && existingProfile && existingProfile.avatar) {
                        profileData.avatar = existingProfile.avatar;
                    }
                    
                    if (saveUserProfile(username, profileData)) {
                        // Update profile page display
                        const usernameEl = document.getElementById('profile-username');
                        const avatarImg = document.getElementById('profile-avatar-img');
                        
                        if (usernameEl && profileData.nickname) {
                            usernameEl.textContent = profileData.nickname;
                        }
                        
                        if (avatarImg && profileData.avatar) {
                            avatarImg.src = profileData.avatar;
                            avatarImg.onerror = function() {
                                if (this) this.src = 'assets/avatars/avatar-male.png';
                            };
                        }
                        
                        // Update all profile icons/avatars on the site
                        updateAllProfileAvatars(username, profileData.avatar);
                        updateProfileIcon();
                        
                        // Re-render comments to show updated profiles
                        const urlParams = new URLSearchParams(window.location.search);
                        const manhwaId = urlParams.get('id');
                        if (manhwaId) {
                            renderComments(manhwaId);
                        }
                        // renderRecentComments(); // REMOVED - no longer needed on homepage
                        
                        closeEditProfileModal();
                        console.log('[PROFILE] Profile saved successfully');
                    }
                } catch (err) {
                    console.error('[PROFILE] Error saving profile:', err);
                }
            });
        }
    } catch (err) {
        console.error('[PROFILE] Error setting up edit modal:', err);
    }
}

function getRecentComments(limit = 10) {
    try {
        const allComments = loadAllComments();
        
        // Filter only top-level comments (not replies) for homepage feed
        const topLevelComments = allComments.filter(c => !c.parentId);
        
        // Sort by timestamp (newest first)
        const sorted = topLevelComments.sort((a, b) => {
            const timeA = a.timestamp || a.createdAt || 0;
            const timeB = b.timestamp || b.createdAt || 0;
            return timeB - timeA;
        });
        
        return sorted.slice(0, limit);
    } catch (err) {
        console.warn('[COMMENT] Error getting recent comments:', err);
        return [];
    }
}

/**
 * Trigger global comment update across all pages
 */
function triggerGlobalCommentUpdate() {
    try {
        // Update homepage recent comments if on homepage
        const homePage = document.getElementById('home-page');
        if (homePage && homePage.classList.contains('active')) {
            setTimeout(() => {
                renderRecentComments();
            }, 100);
        }
        
        // Update manhwa detail page comments if on detail page
        const detailPage = document.getElementById('detail-page');
        if (detailPage && detailPage.classList.contains('active')) {
            try {
                const urlParams = new URLSearchParams(window.location.search);
                const manhwaId = urlParams.get('id');
                if (manhwaId) {
                    setTimeout(() => {
                        renderComments(manhwaId);
                    }, 100);
                }
            } catch (err) {
                // Ignore
            }
        }
        
        // Update profile page if on profile page
        const profilePage = document.querySelector('.profile-page');
        if (profilePage) {
            try {
                const userStr = localStorage.getItem('azura_user');
                if (userStr) {
                    const user = JSON.parse(userStr);
                    const username = user.username || user.email;
                    if (username) {
                        setTimeout(() => {
                            renderMyComments(username);
                        }, 100);
                    }
                }
            } catch (err) {
                // Ignore
            }
        }
    } catch (err) {
        console.warn('[COMMENT] Error triggering global update:', err);
    }
}

/**
 * Genre activity tracking
 */
function updateGenreActivity(manhwaId) {
    try {
        const manhwa = manhwasData.find(m => m.id === manhwaId);
        if (!manhwa || !manhwa.genres || !Array.isArray(manhwa.genres)) return;
        
        const activity = getGenreActivity();
        manhwa.genres.forEach(genre => {
            if (!activity[genre]) {
                activity[genre] = { comments: 0, lastActivity: 0 };
            }
            activity[genre].comments++;
            activity[genre].lastActivity = Date.now();
        });
        
        localStorage.setItem('azura_genre_activity', JSON.stringify(activity));
    } catch (err) {
        console.warn('[COMMENT] Error updating genre activity:', err);
    }
}

function getGenreActivity() {
    try {
        const stored = localStorage.getItem('azura_genre_activity');
        if (!stored) return {};
        return JSON.parse(stored);
    } catch (err) {
        console.warn('[COMMENT] Error loading genre activity:', err);
        return {};
    }
}

/**
 * Render comments for a manhwa
 */
function renderComments(manhwaId) {
    try {
        const commentsList = document.getElementById('comments-list');
        if (!commentsList) {
            console.warn('[COMMENT] Comments list element not found');
            return;
        }
        
        const comments = getCommentsByManhwaId(manhwaId);
        
        if (comments.length === 0) {
            commentsList.innerHTML = '<div class="no-comments">Hozircha izohlar yo\'q. Birinchi izohni yozing!</div>';
            return;
        }
        
        // CRITICAL: Update avatars for comments that don't have one stored
        let commentsUpdated = false;
        comments.forEach(comment => {
            if (!comment.avatar && comment.username && comment.username !== 'Guest') {
                const avatar = getUserAvatar(comment.username);
                if (avatar) {
                    comment.avatar = avatar;
                    commentsUpdated = true;
                    console.log(`[COMMENT] Updated missing avatar for ${comment.username} in comment ${comment.id}`);
                }
            }
        });
        
        // Save updated comments if any were updated
        if (commentsUpdated) {
            try {
                const allComments = loadAllComments();
                const commentIndex = allComments.findIndex(c => c.id === comments[0].id);
                if (commentIndex !== -1) {
                    // Update the comment in the main array
                    const updatedComment = allComments[commentIndex];
                    const avatar = getUserAvatar(updatedComment.username);
                    if (avatar) {
                        updatedComment.avatar = avatar;
                    }
                    // Also update all comments in the array
                    allComments.forEach(c => {
                        if (c.manhwaId === manhwaId && !c.avatar && c.username && c.username !== 'Guest') {
                            const av = getUserAvatar(c.username);
                            if (av) {
                                c.avatar = av;
                            }
                        }
                    });
                    localStorage.setItem('azura_comments', JSON.stringify(allComments));
                    console.log('[COMMENT] Updated comments with missing avatars');
                }
            } catch (updateErr) {
                console.warn('[COMMENT] Error updating comments with avatars:', updateErr);
            }
        }
        
        const fragment = document.createDocumentFragment();
        comments.forEach(comment => {
            try {
                const commentCard = createCommentCard(comment);
                if (commentCard) fragment.appendChild(commentCard);
            } catch (err) {
                console.warn('[COMMENT] Error creating comment card:', err);
            }
        });
        
        commentsList.innerHTML = '';
        commentsList.appendChild(fragment);
        
        console.log(`[COMMENT] ${comments.length} comments rendered for manhwa: ${manhwaId}`);
    } catch (err) {
        console.error('[COMMENT] Error rendering comments:', err);
    }
}

function createCommentCard(comment) {
    try {
        const card = document.createElement('div');
        card.className = 'comment-card';
        card.dataset.commentId = comment.id;
        
        // Check if this is the top liked comment (Eng foydali)
        // Only consider top-level comments, not replies
        const likeCount = getCommentLikeCount(comment.id);
        const allComments = getCommentsByManhwaId(comment.manhwaId);
        
        // Calculate max likes from top-level comments only
        let maxLikes = 0;
        allComments.forEach(c => {
            const likes = getCommentLikeCount(c.id);
            if (likes > maxLikes) {
                maxLikes = likes;
            }
        });
        
        const isTopLiked = likeCount > 0 && likeCount === maxLikes && maxLikes > 0;
        
        if (isTopLiked) {
            card.classList.add('comment-card-top-liked');
        }
        
        // Get user profile data
        const username = comment.username || 'Guest';
        const displayName = getDisplayName(username);
        
        // SIMPLE VERSION: Get avatar
        let commentAvatar = comment.avatar || getUserAvatar(username);
        
        // Avatar element
        const avatar = document.createElement('div');
        avatar.className = 'comment-avatar comment-avatar-clickable';
        avatar.dataset.username = username;
        avatar.title = `${displayName} profilini ko'rish`;
        
        if (commentAvatar && commentAvatar.trim() !== '') {
            const img = document.createElement('img');
            img.src = commentAvatar;
            img.alt = displayName;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.borderRadius = '50%';
            img.style.objectFit = 'cover';
            
            img.onerror = function() {
                this.style.display = 'none';
                avatar.textContent = displayName.charAt(0).toUpperCase();
                avatar.style.backgroundColor = getAvatarColor(username);
            };
            
            avatar.appendChild(img);
        } else {
            avatar.textContent = displayName.charAt(0).toUpperCase();
            avatar.style.backgroundColor = getAvatarColor(username);
        }
        
        // Click to open profile
        avatar.addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                window.location.href = `profile.html?user=${encodeURIComponent(username)}`;
            } catch (err) {
                console.warn('[COMMENT] Error navigating to profile:', err);
            }
        });
        
        const content = document.createElement('div');
        content.className = 'comment-content';
        
        const header = document.createElement('div');
        header.className = 'comment-header';
        
        const headerLeft = document.createElement('div');
        headerLeft.className = 'comment-header-left';
        
        // Top liked badge
        if (isTopLiked) {
            const badge = document.createElement('span');
            badge.className = 'comment-badge-top-liked';
            badge.textContent = 'Eng foydali';
            headerLeft.appendChild(badge);
        }
        
        const usernameSpan = document.createElement('span');
        usernameSpan.className = 'comment-username comment-username-clickable';
        usernameSpan.textContent = displayName;
        usernameSpan.dataset.username = username;
        usernameSpan.title = `${displayName} profilini ko'rish`;
        
        // Click to open profile
        usernameSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                window.location.href = `profile.html?user=${encodeURIComponent(username)}`;
            } catch (err) {
                console.warn('[COMMENT] Error navigating to profile:', err);
            }
        });
        
        headerLeft.appendChild(usernameSpan);
        
        const time = document.createElement('span');
        time.className = 'comment-time';
        time.textContent = formatRelativeTime(comment.timestamp || Date.now());
        
        header.appendChild(headerLeft);
        header.appendChild(time);
        
        const text = document.createElement('div');
        text.className = 'comment-text';
        text.textContent = comment.text || '';
        
        // Like button
        const likeButton = document.createElement('button');
        likeButton.className = 'comment-like-btn';
        likeButton.type = 'button';
        likeButton.setAttribute('aria-label', 'Like');
        
        const isLiked = isCommentLiked(comment.id);
        const likes = getCommentLikeCount(comment.id);
        
        likeButton.innerHTML = `<span class="comment-like-icon">${isLiked ? '❤️' : '🤍'}</span> <span class="comment-like-count">${likes}</span>`;
        
        if (isLiked) {
            likeButton.classList.add('comment-like-btn-liked');
        }
        
        likeButton.addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                toggleCommentLike(comment.id);
                // Update UI
                const newIsLiked = isCommentLiked(comment.id);
                const newLikes = getCommentLikeCount(comment.id);
                
                likeButton.innerHTML = `<span class="comment-like-icon">${newIsLiked ? '❤️' : '🤍'}</span> <span class="comment-like-count">${newLikes}</span>`;
                
                if (newIsLiked) {
                    likeButton.classList.add('comment-like-btn-liked');
                } else {
                    likeButton.classList.remove('comment-like-btn-liked');
                }
                
                // Re-render comments to update "Eng foydali" badge
                setTimeout(() => {
                    const urlParams = new URLSearchParams(window.location.search);
                    const manhwaId = urlParams.get('id');
                    if (manhwaId) {
                        renderComments(manhwaId);
                    }
                }, 100);
            } catch (err) {
                console.warn('[COMMENT] Error toggling like:', err);
            }
        });
        
        const footer = document.createElement('div');
        footer.className = 'comment-footer';
        
        // Reply button
        const replyButton = document.createElement('button');
        replyButton.className = 'comment-reply-btn';
        replyButton.type = 'button';
        replyButton.setAttribute('aria-label', 'Reply');
        replyButton.textContent = 'Javob berish';
        replyButton.addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                toggleReplyForm(comment.id);
            } catch (err) {
                console.warn('[COMMENT] Error toggling reply form:', err);
            }
        });
        
        footer.appendChild(likeButton);
        footer.appendChild(replyButton);
        
        content.appendChild(header);
        content.appendChild(text);
        content.appendChild(footer);
        
        // Replies container
        const repliesContainer = document.createElement('div');
        repliesContainer.className = 'comment-replies-container';
        repliesContainer.id = `replies-${comment.id}`;
        
        // Render replies if they exist
        if (comment.replies && Array.isArray(comment.replies) && comment.replies.length > 0) {
            const repliesHeader = document.createElement('div');
            repliesHeader.className = 'comment-replies-header';
            
            const repliesCount = comment.replies.length;
            const repliesToggle = document.createElement('button');
            repliesToggle.className = 'comment-replies-toggle';
            repliesToggle.innerHTML = `<span class="replies-count">${repliesCount}</span> <span class="replies-label">javob</span> <span class="replies-icon">▼</span>`;
            repliesToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                try {
                    toggleRepliesDisplay(comment.id);
                } catch (err) {
                    console.warn('[COMMENT] Error toggling replies:', err);
                }
            });
            
            repliesHeader.appendChild(repliesToggle);
            
            const repliesList = document.createElement('div');
            repliesList.className = 'comment-replies-list';
            repliesList.id = `replies-list-${comment.id}`;
            
            // Sort replies by timestamp (newest first)
            const sortedReplies = [...comment.replies].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            
            sortedReplies.forEach(reply => {
                try {
                    const replyCard = createReplyCard(reply, comment.id);
                    if (replyCard) repliesList.appendChild(replyCard);
                } catch (err) {
                    console.warn('[COMMENT] Error creating reply card:', err);
                }
            });
            
            repliesContainer.appendChild(repliesHeader);
            repliesContainer.appendChild(repliesList);
            
            // Show replies by default (expanded)
            repliesList.style.display = 'block';
            
            // Update icon to show expanded state
            const icon = repliesToggle.querySelector('.replies-icon');
            if (icon) {
                icon.textContent = '▲';
            }
        } else {
            // Empty state - will show reply form when needed
            const emptyRepliesList = document.createElement('div');
            emptyRepliesList.className = 'comment-replies-list';
            emptyRepliesList.id = `replies-list-${comment.id}`;
            emptyRepliesList.style.display = 'none';
            repliesContainer.appendChild(emptyRepliesList);
        }
        
        // Reply form (hidden by default)
        const replyForm = document.createElement('div');
        replyForm.className = 'comment-reply-form';
        replyForm.id = `reply-form-${comment.id}`;
        replyForm.style.display = 'none';
        
        const replyFormUsername = document.createElement('input');
        replyFormUsername.type = 'text';
        replyFormUsername.className = 'comment-username-input reply-username-input';
        replyFormUsername.placeholder = 'Ism (ixtiyoriy, default: Guest)';
        
        const replyFormTextWrapper = document.createElement('div');
        replyFormTextWrapper.className = 'reply-text-wrapper';
        
        const replyFormText = document.createElement('textarea');
        replyFormText.className = 'comment-text-input reply-text-input';
        replyFormText.placeholder = `@${displayName} ga javob bering...`;
        replyFormText.rows = 2;
        
        // Sticker button for reply form
        const replyStickerBtn = document.createElement('button');
        replyStickerBtn.type = 'button';
        replyStickerBtn.className = 'sticker-picker-trigger reply-sticker-btn';
        replyStickerBtn.textContent = '😊';
        replyStickerBtn.setAttribute('aria-label', 'Stickerlar');
        replyStickerBtn.title = 'Stickerlar va emojilar';
        replyStickerBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleStickerPicker(`reply-form-${comment.id}`);
        });
        
        // Create sticker picker for reply form
        setTimeout(() => {
            createStickerPicker(`reply-form-${comment.id}`, (sticker) => {
                const textarea = replyForm.querySelector('.reply-text-input');
                if (textarea) {
                    const cursorPos = textarea.selectionStart || 0;
                    const textBefore = textarea.value.substring(0, cursorPos);
                    const textAfter = textarea.value.substring(textarea.selectionEnd || cursorPos);
                    textarea.value = textBefore + sticker + textAfter;
                    const newPos = cursorPos + sticker.length;
                    textarea.setSelectionRange(newPos, newPos);
                    textarea.focus();
                }
                toggleStickerPicker(`reply-form-${comment.id}`);
            });
        }, 0);
        
        const replyStickerContainer = document.createElement('div');
        replyStickerContainer.className = 'comment-sticker-container';
        replyStickerContainer.appendChild(replyStickerBtn);
        
        replyFormTextWrapper.appendChild(replyFormText);
        replyFormTextWrapper.appendChild(replyStickerContainer);
        
        const replyFormButtons = document.createElement('div');
        replyFormButtons.className = 'reply-form-buttons';
        
        const replySubmitBtn = document.createElement('button');
        replySubmitBtn.className = 'comment-submit-btn reply-submit-btn';
        replySubmitBtn.textContent = 'Yuborish';
        replySubmitBtn.addEventListener('click', () => {
            try {
                const replyText = replyFormText.value.trim();
                if (!replyText) return;
                
                const replyUsername = replyFormUsername.value.trim() || 'Guest';
                const urlParams = new URLSearchParams(window.location.search);
                const manhwaId = urlParams.get('id');
                
                if (!manhwaId) return;
                
                const reply = {
                    manhwaId: manhwaId,
                    username: replyUsername,
                    text: replyText,
                    timestamp: Date.now(),
                    id: `reply_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    parentId: comment.id,
                    replyTo: comment.username || 'Guest',
                    likes: []
                };
                
                if (saveComment(reply)) {
                    replyFormText.value = '';
                    replyFormUsername.value = '';
                    replyForm.style.display = 'none';
                    
                    // Re-render comments to show new reply
                    renderComments(manhwaId);
                }
            } catch (err) {
                console.error('[COMMENT] Error submitting reply:', err);
            }
        });
        
        const replyCancelBtn = document.createElement('button');
        replyCancelBtn.className = 'comment-cancel-btn reply-cancel-btn';
        replyCancelBtn.textContent = 'Bekor qilish';
        replyCancelBtn.addEventListener('click', () => {
            replyForm.style.display = 'none';
            replyFormText.value = '';
        });
        
        replyFormButtons.appendChild(replyCancelBtn);
        replyFormButtons.appendChild(replySubmitBtn);
        
        replyForm.appendChild(replyFormUsername);
        replyForm.appendChild(replyFormTextWrapper);
        replyForm.appendChild(replyFormButtons);
        
        content.appendChild(repliesContainer);
        content.appendChild(replyForm);
        
        card.appendChild(avatar);
        card.appendChild(content);
        
        return card;
    } catch (err) {
        console.warn('[COMMENT] Error creating comment card:', err);
        return null;
    }
}

/**
 * Create a reply card (nested under comment)
 */
function createReplyCard(reply, parentCommentId) {
    try {
        const card = document.createElement('div');
        card.className = 'comment-reply-card';
        card.dataset.replyId = reply.id;
        card.dataset.parentId = parentCommentId;
        
        // Get user profile data
        const username = reply.username || 'Guest';
        const displayName = getDisplayName(username);
        
        // Use stored avatar from reply (captured at creation time) or fallback to current user avatar
        const replyAvatar = reply.avatar || getUserAvatar(username);
        const replyToUsername = reply.replyTo || 'Guest';
        const replyToDisplayName = getDisplayName(replyToUsername);
        
        // Avatar (smaller for replies)
        const avatar = document.createElement('div');
        avatar.className = 'comment-reply-avatar';
        
        if (replyAvatar) {
            const img = document.createElement('img');
            img.src = replyAvatar;
            img.alt = displayName;
            img.onerror = function() {
                this.style.display = 'none';
                avatar.textContent = displayName.charAt(0).toUpperCase();
                avatar.style.backgroundColor = getAvatarColor(username);
            };
            avatar.appendChild(img);
        } else {
            avatar.textContent = displayName.charAt(0).toUpperCase();
            avatar.style.backgroundColor = getAvatarColor(username);
        }
        
        const content = document.createElement('div');
        content.className = 'comment-reply-content';
        
        const header = document.createElement('div');
        header.className = 'comment-reply-header';
        
        const headerLeft = document.createElement('div');
        headerLeft.className = 'comment-reply-header-left';
        
        const usernameSpan = document.createElement('span');
        usernameSpan.className = 'comment-reply-username';
        usernameSpan.textContent = displayName;
        
        // Show @username if replying to someone
        if (replyToUsername && replyToUsername !== 'Guest') {
            const replyToSpan = document.createElement('span');
            replyToSpan.className = 'comment-reply-to';
            replyToSpan.textContent = `@${replyToDisplayName}`;
            headerLeft.appendChild(usernameSpan);
            headerLeft.appendChild(document.createTextNode(' '));
            headerLeft.appendChild(replyToSpan);
        } else {
            headerLeft.appendChild(usernameSpan);
        }
        
        const time = document.createElement('span');
        time.className = 'comment-reply-time';
        time.textContent = formatRelativeTime(reply.timestamp || Date.now());
        
        header.appendChild(headerLeft);
        header.appendChild(time);
        
        const text = document.createElement('div');
        text.className = 'comment-reply-text';
        text.textContent = reply.text || '';
        
        // Like button for reply
        const likeButton = document.createElement('button');
        likeButton.className = 'comment-like-btn reply-like-btn';
        likeButton.type = 'button';
        likeButton.setAttribute('aria-label', 'Like');
        
        const isLiked = isCommentLiked(reply.id, parentCommentId);
        const likes = getCommentLikeCount(reply.id, parentCommentId);
        
        likeButton.innerHTML = `<span class="comment-like-icon">${isLiked ? '❤️' : '🤍'}</span> <span class="comment-like-count">${likes}</span>`;
        
        if (isLiked) {
            likeButton.classList.add('comment-like-btn-liked');
        }
        
        likeButton.addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                toggleCommentLike(reply.id, parentCommentId);
                const newIsLiked = isCommentLiked(reply.id, parentCommentId);
                const newLikes = getCommentLikeCount(reply.id, parentCommentId);
                
                likeButton.innerHTML = `<span class="comment-like-icon">${newIsLiked ? '❤️' : '🤍'}</span> <span class="comment-like-count">${newLikes}</span>`;
                
                if (newIsLiked) {
                    likeButton.classList.add('comment-like-btn-liked');
                } else {
                    likeButton.classList.remove('comment-like-btn-liked');
                }
            } catch (err) {
                console.warn('[COMMENT] Error toggling reply like:', err);
            }
        });
        
        const footer = document.createElement('div');
        footer.className = 'comment-reply-footer';
        footer.appendChild(likeButton);
        
        content.appendChild(header);
        content.appendChild(text);
        content.appendChild(footer);
        
        card.appendChild(avatar);
        card.appendChild(content);
        
        return card;
    } catch (err) {
        console.warn('[COMMENT] Error creating reply card:', err);
        return null;
    }
}

/**
 * Toggle reply form visibility
 */
function toggleReplyForm(commentId) {
    try {
        const replyForm = document.getElementById(`reply-form-${commentId}`);
        if (!replyForm) return;
        
        const isVisible = replyForm.style.display !== 'none';
        replyForm.style.display = isVisible ? 'none' : 'block';
        
        // Focus textarea if showing
        if (!isVisible) {
            const textarea = replyForm.querySelector('.reply-text-input');
            if (textarea) {
                setTimeout(() => textarea.focus(), 100);
            }
        }
    } catch (err) {
        console.warn('[COMMENT] Error toggling reply form:', err);
    }
}

/**
 * Toggle replies list visibility
 */
function toggleRepliesDisplay(commentId) {
    try {
        const repliesList = document.getElementById(`replies-list-${commentId}`);
        const repliesToggle = document.querySelector(`#replies-${commentId} .comment-replies-toggle`);
        
        if (!repliesList || !repliesToggle) return;
        
        const isVisible = repliesList.style.display !== 'none';
        repliesList.style.display = isVisible ? 'none' : 'block';
        
        // Update icon
        const icon = repliesToggle.querySelector('.replies-icon');
        if (icon) {
            icon.textContent = isVisible ? '▼' : '▲';
        }
    } catch (err) {
        console.warn('[COMMENT] Error toggling replies display:', err);
    }
}

function getAvatarColor(username) {
    const colors = [
        'var(--gold-primary)',
        '#8B5CF6',
        '#EC4899',
        '#10B981',
        '#3B82F6',
        '#F59E0B',
        '#EF4444'
    ];
    const index = (username || 'Guest').length % colors.length;
    return colors[index];
}

function formatRelativeTime(timestamp) {
    try {
        const now = Date.now();
        const diff = now - timestamp;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (seconds < 60) return 'hozir';
        if (minutes < 60) return `${minutes} daqiqa oldin`;
        if (hours < 24) return `${hours} soat oldin`;
        if (days < 7) return `${days} kun oldin`;
        
        const date = new Date(timestamp);
        return date.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'short' });
    } catch (err) {
        return 'vaqt noma\'lum';
    }
}

/**
 * Render global activity feed (recent comments)
 */
function renderRecentComments() {
    try {
        const recentCommentsList = document.getElementById('recent-comments-list');
        if (!recentCommentsList) {
            console.warn('[COMMENT] Recent comments list element not found');
            return;
        }
        
        // Get latest 10 comments for homepage feed
        const comments = getRecentComments(10);
        
        if (comments.length === 0) {
            recentCommentsList.innerHTML = `
                <div class="recent-comments-empty">
                    <div class="recent-comments-empty-icon">💬</div>
                    <div class="recent-comments-empty-text">Hozircha izohlar yo'q</div>
                    <div class="recent-comments-empty-subtext">Birinchi izohni yozing va jamoaga qo'shiling!</div>
                </div>
            `;
            return;
        }
        
        const fragment = document.createDocumentFragment();
        comments.forEach(comment => {
            try {
                const activityCard = createActivityCard(comment);
                if (activityCard) fragment.appendChild(activityCard);
            } catch (err) {
                console.warn('[COMMENT] Error creating activity card:', err);
            }
        });
        
        recentCommentsList.innerHTML = '';
        recentCommentsList.appendChild(fragment);
        
        console.log(`[COMMENT] ${comments.length} recent comments rendered`);
    } catch (err) {
        console.error('[COMMENT] Error rendering recent comments:', err);
    }
}

function createActivityCard(comment) {
    try {
        const manhwa = manhwasData.find(m => m.id === comment.manhwaId);
        const manhwaTitle = manhwa ? manhwa.title : 'Noma\'lum manhwa';
        
        // Get rating for this manhwa (if available)
        let rating = null;
        try {
            // Try to get rating from azura_ratings (post-reading ratings)
            const ratingData = getManhwaRating(comment.manhwaId);
            if (ratingData && ratingData.totalRating && ratingData.ratingCount > 0) {
                rating = Math.round((ratingData.totalRating / ratingData.ratingCount) * 10) / 10;
            } else {
                // Try alternative format (array of ratings)
                try {
                    const ratingsStr = localStorage.getItem('azura_ratings');
                    if (ratingsStr) {
                        const ratings = JSON.parse(ratingsStr);
                        const manhwaRatings = ratings[comment.manhwaId];
                        if (Array.isArray(manhwaRatings) && manhwaRatings.length > 0) {
                            const sum = manhwaRatings.reduce((acc, r) => acc + (r.rating || 0), 0);
                            rating = Math.round((sum / manhwaRatings.length) * 10) / 10;
                        }
                    }
                } catch (altErr) {
                    // Silent fail
                }
            }
        } catch (ratingErr) {
            // Silent fail - rating is optional
        }
        
        const card = document.createElement('div');
        card.className = 'activity-card';
        card.dataset.manhwaId = comment.manhwaId;
        
        // Click to navigate to manhwa
        card.addEventListener('click', () => {
            try {
                navigateToManhwaDetail(comment.manhwaId);
            } catch (err) {
                console.warn('[COMMENT] Error navigating to manhwa:', err);
            }
        });
        
        // Get user profile data
        const username = comment.username || 'Guest';
        const displayName = getDisplayName(username);
        
        // SIMPLE VERSION: Get avatar
        let commentAvatar = comment.avatar || getUserAvatar(username);
        
        const avatar = document.createElement('div');
        avatar.className = 'activity-avatar activity-avatar-clickable';
        avatar.dataset.username = username;
        avatar.title = `${displayName} profilini ko'rish`;
        
        if (commentAvatar && commentAvatar.trim() !== '') {
            const img = document.createElement('img');
            img.src = commentAvatar;
            img.alt = displayName;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.borderRadius = '50%';
            img.style.objectFit = 'cover';
            
            img.onerror = function() {
                this.style.display = 'none';
                avatar.textContent = displayName.charAt(0).toUpperCase();
                avatar.style.backgroundColor = getAvatarColor(username);
            };
            
            avatar.appendChild(img);
        } else {
            avatar.textContent = displayName.charAt(0).toUpperCase();
            avatar.style.backgroundColor = getAvatarColor(username);
        }
        
        // Click to open profile
        avatar.addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                window.location.href = `profile.html?user=${encodeURIComponent(username)}`;
            } catch (err) {
                console.warn('[COMMENT] Error navigating to profile:', err);
            }
        });
        
        const content = document.createElement('div');
        content.className = 'activity-content';
        
        const header = document.createElement('div');
        header.className = 'activity-header';
        
        const usernameWrapper = document.createElement('div');
        usernameWrapper.className = 'activity-username-wrapper';
        
        const usernameSpan = document.createElement('span');
        usernameSpan.className = 'activity-username activity-username-clickable';
        usernameSpan.textContent = displayName;
        usernameSpan.dataset.username = username;
        usernameSpan.title = `${displayName} profilini ko'rish`;
        
        // Click to open profile
        usernameSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                window.location.href = `profile.html?user=${encodeURIComponent(username)}`;
            } catch (err) {
                console.warn('[COMMENT] Error navigating to profile:', err);
            }
        });
        
        usernameWrapper.appendChild(usernameSpan);
        
        // Add rating if available
        if (rating && rating > 0) {
            const ratingEl = document.createElement('span');
            ratingEl.className = 'activity-rating';
            ratingEl.innerHTML = `⭐ ${rating.toFixed(1)}`;
            usernameWrapper.appendChild(ratingEl);
        }
        
        const time = document.createElement('span');
        time.className = 'activity-time';
        time.innerHTML = `🕒 ${formatRelativeTime(comment.timestamp || Date.now())}`;
        
        header.appendChild(usernameWrapper);
        header.appendChild(time);
        
        const manhwaName = document.createElement('div');
        manhwaName.className = 'activity-manhwa';
        manhwaName.innerHTML = `📘 ${manhwaTitle}`;
        
        const text = document.createElement('div');
        text.className = 'activity-text';
        const textPreview = (comment.text || '').length > 120 
            ? (comment.text || '').substring(0, 120) + '...' 
            : (comment.text || '');
        text.innerHTML = `💬 ${textPreview}`;
        
        content.appendChild(header);
        content.appendChild(manhwaName);
        content.appendChild(text);
        
        card.appendChild(avatar);
        card.appendChild(content);
        
        return card;
    } catch (err) {
        console.warn('[COMMENT] Error creating activity card:', err);
        return null;
    }
}

function navigateToManhwaDetail(manhwaId) {
    try {
        window.location.href = `index.html?id=${manhwaId}`;
    } catch (err) {
        console.warn('[COMMENT] Error navigating:', err);
    }
}

/**
 * Setup comment form on detail page
 */
function setupCommentForm() {
    try {
        // Check for either comments-section (legacy) or community-chat-section (new)
        const commentSection = document.getElementById('comments-section');
        const communityChatSection = document.getElementById('community-chat-section');
        
        if (!commentSection && !communityChatSection) {
            console.warn('[COMMENT] Comments section not found');
            return;
        }
        
        const submitBtn = document.getElementById('comment-submit-btn');
        const usernameInput = document.getElementById('comment-username');
        const textInput = document.getElementById('comment-text');
        
        if (!submitBtn || !textInput) {
            console.warn('[COMMENT] Comment form elements not found');
            return;
        }
        
        // Add sticker picker to comment form
        addStickerPickerToCommentForm();
        
        // Submit button click
        submitBtn.addEventListener('click', () => {
            try {
                const urlParams = new URLSearchParams(window.location.search);
                const manhwaId = urlParams.get('id');
                
                if (!manhwaId) {
                    console.warn('[COMMENT] Manhwa ID not found');
                    return;
                }
                
                // CRITICAL: Get username - prioritize logged-in user
                let username = 'Guest';
                try {
                    const loggedIn = localStorage.getItem('azura_logged_in') === 'true';
                    if (loggedIn) {
                        const userStr = localStorage.getItem('azura_user');
                        if (userStr) {
                            const authUser = JSON.parse(userStr);
                            // Use username or email from logged-in user
                            username = authUser.username || authUser.email || 'Guest';
                            console.log('[COMMENT] Using logged-in username:', username);
                        }
                    }
                } catch (err) {
                    console.warn('[COMMENT] Error getting logged-in user:', err);
                }
                
                // Fallback to input field if not logged in or no user found
                if (username === 'Guest' && usernameInput) {
                    const inputUsername = usernameInput.value.trim();
                    if (inputUsername) {
                        username = inputUsername;
                        console.log('[COMMENT] Using input username:', username);
                    }
                }
                
                const text = textInput.value.trim();
                
                if (!text) {
                    console.warn('[COMMENT] Comment text is empty');
                    return;
                }
                
                // Get userId from unified system if available
                let userId = null;
                if (username !== 'Guest') {
                    try {
                        const user = getUnifiedUser(username);
                        userId = user ? user.id : null;
                    } catch (err) {
                        // Ignore - userId is optional
                    }
                }
                
                const comment = {
                    manhwaId: manhwaId,
                    userId: userId,
                    username: username, // Use normalized username
                    text: text,
                    timestamp: Date.now(),
                    createdAt: Date.now()
                };
                
                if (saveComment(comment)) {
                    // Clear form
                    if (textInput) textInput.value = '';
                    if (usernameInput) usernameInput.value = '';
                    
                    // Re-render comments (triggerGlobalCommentUpdate already called in saveComment)
                    renderComments(manhwaId);
                    
                    console.log('[COMMENT] Comment submitted successfully');
                }
            } catch (err) {
                console.error('[COMMENT] Error submitting comment:', err);
            }
        });
        
        // Enter key to submit
        if (textInput) {
            textInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.ctrlKey) {
                    e.preventDefault();
                    submitBtn.click();
                }
            });
        }
        
        console.log('[COMMENT] Comment form setup complete');
    } catch (err) {
        console.error('[COMMENT] Error setting up comment form:', err);
    }
}

// ============================================
// STICKER & EMOJI PICKER SYSTEM
// ============================================

/**
 * AZURA Custom Stickers - 45 Epic Stickers
 */
const AZURA_STICKERS = {
    girls: [
        '👸', '🌸', '💖', '✨', '🌟',
        '👗', '💄', '👠', '🎀', '🌺',
        '💋', '👑', '💅', '🦄', '🌙'
    ],
    boys: [
        '🤴', '⚔️', '🛡️', '🔥', '💪',
        '🎯', '⚡', '🗡️', '👊', '🌊',
        '🎮', '🚀', '⚽', '🏆', '💎'
    ],
    mix: [
        '💕', '🎭', '🎪', '🎨', '🎬',
        '🍕', '🍜', '🍰', '☕', '🍻',
        '🎵', '🎶', '🎸', '🎹', '🎤'
    ]
};

/**
 * Standard emojis for quick access
 */
const QUICK_EMOJIS = [
    '😀', '😂', '🥰', '😍', '🤔', '😎', '😢', '😡',
    '👍', '👎', '❤️', '💯', '🔥', '⭐', '🎉', '🙏'
];

/**
 * Create sticker/emoji picker UI
 */
function createStickerPicker(containerId, onSelect) {
    try {
        const container = document.getElementById(containerId);
        if (!container) return null;
        
        // Check if picker already exists
        const existingPicker = container.querySelector('.sticker-picker');
        if (existingPicker) {
            return existingPicker;
        }
        
        const picker = document.createElement('div');
        picker.className = 'sticker-picker';
        picker.id = `sticker-picker-${containerId}`;
        picker.style.display = 'none';
        
        // Tabs
        const tabs = document.createElement('div');
        tabs.className = 'sticker-picker-tabs';
        
        const tabQuick = document.createElement('button');
        tabQuick.className = 'sticker-tab active';
        tabQuick.textContent = 'Tezkor';
        tabQuick.dataset.tab = 'quick';
        
        const tabGirls = document.createElement('button');
        tabGirls.className = 'sticker-tab';
        tabGirls.textContent = 'Qizlar 👸';
        tabGirls.dataset.tab = 'girls';
        
        const tabBoys = document.createElement('button');
        tabBoys.className = 'sticker-tab';
        tabBoys.textContent = 'Yigitlar 🤴';
        tabBoys.dataset.tab = 'boys';
        
        const tabMix = document.createElement('button');
        tabMix.className = 'sticker-tab';
        tabMix.textContent = 'Mix 🎭';
        tabMix.dataset.tab = 'mix';
        
        tabs.appendChild(tabQuick);
        tabs.appendChild(tabGirls);
        tabs.appendChild(tabBoys);
        tabs.appendChild(tabMix);
        
        // Content area
        const content = document.createElement('div');
        content.className = 'sticker-picker-content';
        
        // Quick emojis
        const quickGrid = createStickerGrid('quick', QUICK_EMOJIS, onSelect);
        quickGrid.className = 'sticker-grid active';
        content.appendChild(quickGrid);
        
        // Girls stickers
        const girlsGrid = createStickerGrid('girls', AZURA_STICKERS.girls, onSelect);
        girlsGrid.className = 'sticker-grid';
        content.appendChild(girlsGrid);
        
        // Boys stickers
        const boysGrid = createStickerGrid('boys', AZURA_STICKERS.boys, onSelect);
        boysGrid.className = 'sticker-grid';
        content.appendChild(boysGrid);
        
        // Mix stickers
        const mixGrid = createStickerGrid('mix', AZURA_STICKERS.mix, onSelect);
        mixGrid.className = 'sticker-grid';
        content.appendChild(mixGrid);
        
        // Tab switching
        tabs.addEventListener('click', (e) => {
            if (e.target.classList.contains('sticker-tab')) {
                const tabName = e.target.dataset.tab;
                
                // Update active tab
                tabs.querySelectorAll('.sticker-tab').forEach(tab => {
                    tab.classList.remove('active');
                });
                e.target.classList.add('active');
                
                // Show corresponding grid
                content.querySelectorAll('.sticker-grid').forEach(grid => {
                    grid.classList.remove('active');
                });
                const targetGrid = content.querySelector(`.sticker-grid[data-category="${tabName}"]`);
                if (targetGrid) {
                    targetGrid.classList.add('active');
                }
            }
        });
        
        picker.appendChild(tabs);
        picker.appendChild(content);
        
        // Insert before container's first child
        if (container.firstChild) {
            container.insertBefore(picker, container.firstChild);
        } else {
            container.appendChild(picker);
        }
        
        return picker;
    } catch (err) {
        console.warn('[STICKER] Error creating sticker picker:', err);
        return null;
    }
}

/**
 * Create sticker grid
 */
function createStickerGrid(category, stickers, onSelect) {
    const grid = document.createElement('div');
    grid.className = 'sticker-grid';
    grid.dataset.category = category;
    
    stickers.forEach(sticker => {
        const item = document.createElement('button');
        item.className = 'sticker-item';
        item.type = 'button';
        item.textContent = sticker;
        item.setAttribute('aria-label', `Add ${sticker}`);
        
        item.addEventListener('click', () => {
            if (onSelect && typeof onSelect === 'function') {
                onSelect(sticker);
            }
        });
        
        grid.appendChild(item);
    });
    
    return grid;
}

/**
 * Toggle sticker picker visibility
 */
function toggleStickerPicker(containerId) {
    try {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const picker = container.querySelector('.sticker-picker');
        if (!picker) {
            // Create picker if doesn't exist
            createStickerPicker(containerId, (sticker) => {
                insertStickerIntoInput(containerId, sticker);
            });
            return;
        }
        
        const isVisible = picker.style.display !== 'none';
        picker.style.display = isVisible ? 'none' : 'block';
        
        // Close on outside click
        if (!isVisible) {
            setTimeout(() => {
                const closeHandler = (e) => {
                    if (!picker.contains(e.target) && !e.target.closest('.sticker-picker-trigger')) {
                        picker.style.display = 'none';
                        document.removeEventListener('click', closeHandler);
                    }
                };
                document.addEventListener('click', closeHandler);
            }, 100);
        }
    } catch (err) {
        console.warn('[STICKER] Error toggling picker:', err);
    }
}

/**
 * Insert sticker into text input/textarea
 */
function insertStickerIntoInput(containerId, sticker) {
    try {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        // Find text input or textarea
        const textInput = container.querySelector('textarea') || container.querySelector('input[type="text"]');
        if (!textInput) return;
        
        const cursorPos = textInput.selectionStart || 0;
        const textBefore = textInput.value.substring(0, cursorPos);
        const textAfter = textInput.value.substring(textInput.selectionEnd || cursorPos);
        
        textInput.value = textBefore + sticker + textAfter;
        
        // Set cursor position after inserted sticker
        const newPos = cursorPos + sticker.length;
        textInput.setSelectionRange(newPos, newPos);
        textInput.focus();
        
        // Close picker
        const picker = container.querySelector('.sticker-picker');
        if (picker) {
            picker.style.display = 'none';
        }
        
        // Trigger input event for any listeners
        textInput.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (err) {
        console.warn('[STICKER] Error inserting sticker:', err);
    }
}

/**
 * Add sticker picker button to comment form
 */
function addStickerPickerToCommentForm() {
    try {
        const commentsSection = document.getElementById('comments-section');
        if (!commentsSection) return;
        
        const commentForm = commentsSection.querySelector('.comments-form');
        if (!commentForm) return;
        
        // Check if button already exists
        if (commentForm.querySelector('.sticker-picker-trigger')) return;
        
        const textInput = commentForm.querySelector('.comment-text-input');
        if (!textInput) return;
        
        // Create wrapper for input and button
        const inputGroup = textInput.parentElement;
        if (!inputGroup) return;
        
        // Create button container
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'comment-sticker-container';
        
        // Sticker button
        const stickerBtn = document.createElement('button');
        stickerBtn.type = 'button';
        stickerBtn.className = 'sticker-picker-trigger comment-sticker-btn';
        stickerBtn.textContent = '😊';
        stickerBtn.setAttribute('aria-label', 'Stickerlar');
        stickerBtn.title = 'Stickerlar va emojilar';
        
        stickerBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleStickerPicker('comments-section');
        });
        
        buttonContainer.appendChild(stickerBtn);
        
        // Add button after textarea
        inputGroup.appendChild(buttonContainer);
        
        // Create picker
        createStickerPicker('comments-section', (sticker) => {
            insertStickerIntoInput('comments-section', sticker);
        });
        
        // Also add to reply forms (they're created dynamically)
        // This will be handled when reply forms are created
        
    } catch (err) {
        console.warn('[STICKER] Error adding sticker picker to comment form:', err);
    }
}

// ============================================
// POST-READING RATING & FEEDBACK SYSTEM
// ============================================

/**
 * Check if current chapter is the last chapter (SAFE - with full validation)
 */
function isLastChapter(manhwaId, chapterIndex) {
    try {
        // CRITICAL: Validate inputs
        if (!manhwaId || typeof manhwaId !== 'string') {
            return false;
        }
        if (typeof chapterIndex !== 'number' || chapterIndex < 0) {
            return false;
        }
        
        // CRITICAL: Check if data is loaded
        if (!manhwasData || !Array.isArray(manhwasData) || manhwasData.length === 0) {
            return false;
        }
        
        const manhwa = manhwasData.find(m => m && m.id === manhwaId);
        if (!manhwa || !manhwa.chapters || !Array.isArray(manhwa.chapters) || manhwa.chapters.length === 0) {
            return false;
        }
        
        // Check if chapterIndex is last
        return chapterIndex >= manhwa.chapters.length - 1;
    } catch (err) {
        console.warn('[POST-READING] Error checking last chapter:', err);
        return false; // FAIL-SAFE: Return false on any error
    }
}

/**
 * Get current chapter info from URL or state (SAFE - with validation)
 */
function getCurrentChapterInfo() {
    try {
        // CRITICAL: Check if we're on reader page
        const readerPage = document.getElementById('reader-page');
        if (!readerPage || !readerPage.classList.contains('active')) {
            return { manhwaId: null, chapterIndex: -1, isValid: false };
        }
        
        const urlParams = new URLSearchParams(window.location.search);
        const manhwaId = urlParams.get('id');
        const chapterIndex = parseInt(urlParams.get('chapter')) || 0;
        
        // Validate
        if (!manhwaId || typeof manhwaId !== 'string') {
            return { manhwaId: null, chapterIndex: -1, isValid: false };
        }
        
        return { manhwaId, chapterIndex, isValid: true };
    } catch (err) {
        console.warn('[POST-READING] Error getting chapter info:', err);
        return { manhwaId: null, chapterIndex: -1, isValid: false };
    }
}

/**
 * Check if user has already submitted feedback for this manhwa (SAFE - localStorage protection)
 */
function hasSubmittedPostReadingFeedback(manhwaId) {
    try {
        // CRITICAL: Validate input
        if (!manhwaId || typeof manhwaId !== 'string') {
            return false;
        }
        
        const stored = localStorage.getItem('azura_post_reading_feedback');
        if (!stored) return false;
        
        // CRITICAL: Safe JSON parse with error handling
        let feedbacks;
        try {
            feedbacks = JSON.parse(stored);
        } catch (parseErr) {
            console.warn('[POST-READING] Invalid JSON in localStorage, clearing:', parseErr);
            localStorage.removeItem('azura_post_reading_feedback');
            return false;
        }
        
        if (!Array.isArray(feedbacks)) {
            return false;
        }
        
        return feedbacks.some(f => f && f.manhwaId === manhwaId);
    } catch (err) {
        console.warn('[POST-READING] Error checking feedback:', err);
        return false; // FAIL-SAFE: Return false on error
    }
}

/**
 * Save post-reading feedback (SAFE - with full validation and localStorage protection)
 */
function savePostReadingFeedback(manhwaId, rating, comment) {
    try {
        // CRITICAL: Validate inputs
        if (!manhwaId || typeof manhwaId !== 'string') {
            console.warn('[POST-READING] Invalid manhwaId');
            return false;
        }
        
        // CRITICAL: Safe localStorage read
        let feedbacks = [];
        try {
            const stored = localStorage.getItem('azura_post_reading_feedback');
            if (stored) {
                feedbacks = JSON.parse(stored);
                if (!Array.isArray(feedbacks)) {
                    feedbacks = [];
                }
            }
        } catch (parseErr) {
            console.warn('[POST-READING] Error parsing stored feedback, resetting:', parseErr);
            feedbacks = [];
        }
        
        const feedback = {
            manhwaId: manhwaId,
            rating: (rating && rating > 0 && rating <= 5) ? rating : null,
            comment: (comment && typeof comment === 'string') ? comment.trim() : null,
            timestamp: Date.now()
        };
        
        // Remove existing feedback for this manhwa (if any)
        const filtered = feedbacks.filter(f => f && f.manhwaId !== manhwaId);
        filtered.push(feedback);
        
        // CRITICAL: Safe localStorage write
        try {
            localStorage.setItem('azura_post_reading_feedback', JSON.stringify(filtered));
        } catch (storageErr) {
            console.error('[POST-READING] Error writing to localStorage:', storageErr);
            return false;
        }
        
        // If comment exists, save it as regular comment (non-blocking)
        if (feedback.comment) {
            try {
                saveComment({
                    manhwaId: manhwaId,
                    username: 'Guest',
                    text: feedback.comment,
                    timestamp: Date.now()
                });
            } catch (commentErr) {
                console.warn('[POST-READING] Error saving comment:', commentErr);
                // Continue - comment save failure doesn't block feedback save
            }
        }
        
        // If rating exists, save it (non-blocking)
        if (feedback.rating) {
            try {
                savePostReadingRating(manhwaId, feedback.rating);
            } catch (ratingErr) {
                console.warn('[POST-READING] Error saving rating:', ratingErr);
                // Continue - rating save failure doesn't block feedback save
            }
        }
        
        console.log('[POST-READING] Feedback saved:', manhwaId);
        return true;
    } catch (err) {
        console.error('[POST-READING] Error saving feedback:', err);
        return false; // FAIL-SAFE: Return false on error
    }
}

/**
 * Save post-reading rating (SAFE - with localStorage protection)
 */
function savePostReadingRating(manhwaId, rating) {
    try {
        // CRITICAL: Validate inputs
        if (!manhwaId || typeof manhwaId !== 'string') {
            return;
        }
        if (!rating || rating < 1 || rating > 5) {
            return;
        }
        
        // CRITICAL: Safe localStorage read
        let ratings = {};
        try {
            const stored = localStorage.getItem('azura_ratings');
            if (stored) {
                ratings = JSON.parse(stored);
                if (typeof ratings !== 'object' || ratings === null) {
                    ratings = {};
                }
            }
        } catch (parseErr) {
            console.warn('[POST-READING] Error parsing stored ratings, resetting:', parseErr);
            ratings = {};
        }
        
        if (!ratings[manhwaId] || !Array.isArray(ratings[manhwaId])) {
            ratings[manhwaId] = [];
        }
        
        ratings[manhwaId].push({
            rating: rating,
            timestamp: Date.now(),
            source: 'post-reading'
        });
        
        // CRITICAL: Safe localStorage write
        try {
            localStorage.setItem('azura_ratings', JSON.stringify(ratings));
            console.log('[POST-READING] Rating saved:', manhwaId, rating);
        } catch (storageErr) {
            console.error('[POST-READING] Error writing rating to localStorage:', storageErr);
        }
    } catch (err) {
        console.warn('[POST-READING] Error saving rating:', err);
        // Silent fail - don't block other operations
    }
}

/**
 * Show post-reading modal (SAFE - with full validation)
 */
function showPostReadingModal(manhwaId) {
    try {
        // CRITICAL: Validate input
        if (!manhwaId || typeof manhwaId !== 'string') {
            console.warn('[POST-READING] Invalid manhwaId for modal');
            return;
        }
        
        // CRITICAL: Check if we're on reader page
        const readerPage = document.getElementById('reader-page');
        if (!readerPage || !readerPage.classList.contains('active')) {
            console.warn('[POST-READING] Not on reader page, skipping modal');
            return;
        }
        
        const modal = document.getElementById('post-reading-modal');
        if (!modal) {
            console.warn('[POST-READING] Modal not found');
            return;
        }
        
        // Check if already submitted
        if (hasSubmittedPostReadingFeedback(manhwaId)) {
            console.log('[POST-READING] Feedback already submitted for this manhwa');
            return;
        }
        
        // Store current manhwa ID
        modal.dataset.manhwaId = manhwaId;
        
        // Reset form
        resetPostReadingForm();
        
        // Show modal (non-blocking)
        modal.style.display = 'flex';
        try {
            document.body.style.overflow = 'hidden';
        } catch (overflowErr) {
            console.warn('[POST-READING] Error setting overflow:', overflowErr);
        }
        
        console.log('[POST-READING] Modal shown for manhwa:', manhwaId);
    } catch (err) {
        console.error('[POST-READING] Error showing modal:', err);
        // Silent fail - don't block page
    }
}

/**
 * Hide post-reading modal (SAFE)
 */
function hidePostReadingModal() {
    try {
        const modal = document.getElementById('post-reading-modal');
        if (modal) {
            modal.style.display = 'none';
        }
        
        // CRITICAL: Restore body overflow safely
        try {
            if (document.body) {
                document.body.style.overflow = '';
            }
        } catch (overflowErr) {
            // Silent fail
        }
    } catch (err) {
        console.warn('[POST-READING] Error hiding modal:', err);
        // Silent fail - don't block page
    }
}

/**
 * Reset post-reading form (SAFE - with element checks)
 */
function resetPostReadingForm() {
    try {
        const stars = document.querySelectorAll('#post-reading-stars .star');
        if (stars.length > 0) {
            stars.forEach(star => {
                try {
                    star.classList.remove('active');
                } catch (starErr) {
                    // Silent fail for individual star
                }
            });
        }
        
        const ratingText = document.getElementById('post-reading-rating-text');
        if (ratingText) {
            try {
                ratingText.textContent = 'Baholash (ixtiyoriy)';
            } catch (textErr) {
                console.warn('[POST-READING] Error setting rating text:', textErr);
            }
        }
        
        const feedbackText = document.getElementById('post-reading-feedback-text');
        if (feedbackText) {
            try {
                feedbackText.value = '';
            } catch (feedbackErr) {
                console.warn('[POST-READING] Error clearing feedback text:', feedbackErr);
            }
        }
        
        const usernameInput = document.getElementById('post-reading-feedback-username');
        if (usernameInput) {
            try {
                usernameInput.value = '';
            } catch (usernameErr) {
                console.warn('[POST-READING] Error clearing username:', usernameErr);
            }
        }
    } catch (err) {
        console.warn('[POST-READING] Error resetting form:', err);
        // Silent fail - don't block other operations
    }
}

/**
 * Setup post-reading modal (SAFE - with duplicate prevention and element checks)
 */
function setupPostReadingModal() {
    try {
        // CRITICAL: Check if already set up (prevent duplicate listeners)
        const modal = document.getElementById('post-reading-modal');
        if (!modal) {
            console.warn('[POST-READING] Modal not found, skipping setup');
            return;
        }
        
        if (modal.dataset.setupComplete === 'true') {
            console.log('[POST-READING] Modal already set up, skipping');
            return;
        }
        
        // Star rating (with element check)
        const stars = document.querySelectorAll('#post-reading-stars .star');
        let selectedRating = 0;
        
        if (stars.length > 0) {
            stars.forEach((star, index) => {
                try {
                    star.addEventListener('click', () => {
                        try {
                            selectedRating = index + 1;
                            stars.forEach((s, i) => {
                                if (i < selectedRating) {
                                    s.classList.add('active');
                                } else {
                                    s.classList.remove('active');
                                }
                            });
                            
                            const ratingText = document.getElementById('post-reading-rating-text');
                            if (ratingText) {
                                const texts = ['', 'Yomon', 'Qoniqarsiz', 'Yaxshi', 'Juda yaxshi', 'Ajoyib'];
                                ratingText.textContent = texts[selectedRating] || 'Baholash (ixtiyoriy)';
                            }
                        } catch (starErr) {
                            console.warn('[POST-READING] Error in star click:', starErr);
                        }
                    });
                } catch (starListenerErr) {
                    console.warn('[POST-READING] Error adding star listener:', starListenerErr);
                }
            });
        }
        
        // Close button (with element check)
        const closeBtn = document.getElementById('post-reading-close');
        if (closeBtn) {
            try {
                closeBtn.addEventListener('click', () => {
                    hidePostReadingModal();
                });
            } catch (closeErr) {
                console.warn('[POST-READING] Error adding close listener:', closeErr);
            }
        }
        
        // Overlay click to close (with element check)
        const overlay = modal.querySelector('.post-reading-overlay');
        if (overlay) {
            try {
                overlay.addEventListener('click', () => {
                    hidePostReadingModal();
                });
            } catch (overlayErr) {
                console.warn('[POST-READING] Error adding overlay listener:', overlayErr);
            }
        }
        
        // Skip button (with element check)
        const skipBtn = document.getElementById('post-reading-skip');
        if (skipBtn) {
            try {
                skipBtn.addEventListener('click', () => {
                    hidePostReadingModal();
                });
            } catch (skipErr) {
                console.warn('[POST-READING] Error adding skip listener:', skipErr);
            }
        }
        
        // Submit button (with element check)
        const submitBtn = document.getElementById('post-reading-submit');
        if (submitBtn) {
            try {
                submitBtn.addEventListener('click', () => {
                    try {
                        const manhwaId = modal.dataset.manhwaId;
                        if (!manhwaId) {
                            console.warn('[POST-READING] Manhwa ID not found');
                            return;
                        }
                        
                        const feedbackText = document.getElementById('post-reading-feedback-text');
                        const usernameInput = document.getElementById('post-reading-feedback-username');
                        
                        const comment = feedbackText ? feedbackText.value.trim() : '';
                        const username = usernameInput ? (usernameInput.value.trim() || 'Guest') : 'Guest';
                        
                        // Save feedback (rating and/or comment) - non-blocking
                        if (savePostReadingFeedback(manhwaId, selectedRating, comment)) {
                            // If comment exists, save with username (non-blocking)
                            if (comment) {
                                try {
                                    // Get userId from unified system if available
                                    let userId = null;
                                    if (username !== 'Guest') {
                                        try {
                                            const user = getUnifiedUser(username);
                                            userId = user ? user.id : null;
                                        } catch (err) {
                                            // Ignore - userId is optional
                                        }
                                    }
                                    
                                    saveComment({
                                        manhwaId: manhwaId,
                                        userId: userId,
                                        username: username,
                                        text: comment,
                                        timestamp: Date.now(),
                                        createdAt: Date.now()
                                    });
                                } catch (commentErr) {
                                    console.warn('[POST-READING] Error saving comment:', commentErr);
                                    // Continue - comment save failure doesn't block
                                }
                            }
                            
                            // triggerGlobalCommentUpdate already called in saveComment
                            // Continue - render failure doesn't block
                            
                            hidePostReadingModal();
                            console.log('[POST-READING] Feedback submitted successfully');
                        }
                    } catch (submitErr) {
                        console.error('[POST-READING] Error in submit handler:', submitErr);
                    }
                });
            } catch (submitListenerErr) {
                console.warn('[POST-READING] Error adding submit listener:', submitListenerErr);
            }
        }
        
        // Add sticker picker to post-reading modal
        const stickerBtn = modal.querySelector('.post-reading-sticker-btn');
        if (stickerBtn) {
            try {
                stickerBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleStickerPicker('post-reading-modal');
                });
                
                // Create sticker picker for post-reading modal
                createStickerPicker('post-reading-modal', (sticker) => {
                    const textarea = document.getElementById('post-reading-feedback-text');
                    if (textarea) {
                        const cursorPos = textarea.selectionStart || 0;
                        const textBefore = textarea.value.substring(0, cursorPos);
                        const textAfter = textarea.value.substring(textarea.selectionEnd || cursorPos);
                        textarea.value = textBefore + sticker + textAfter;
                        const newPos = cursorPos + sticker.length;
                        textarea.setSelectionRange(newPos, newPos);
                        textarea.focus();
                    }
                    toggleStickerPicker('post-reading-modal');
                });
            } catch (stickerErr) {
                console.warn('[POST-READING] Error setting up sticker picker:', stickerErr);
            }
        }
        
        // Mark as set up
        modal.dataset.setupComplete = 'true';
        console.log('[POST-READING] Modal setup complete');
    } catch (err) {
        console.error('[POST-READING] Error setting up modal:', err);
        // Silent fail - don't block page
    }
}

/**
 * Setup scroll detection for last chapter (SAFE - with full validation and duplicate prevention)
 */
function setupPostReadingScrollDetection() {
    try {
        // CRITICAL: Check if we're on reader page
        const readerPage = document.getElementById('reader-page');
        if (!readerPage || !readerPage.classList.contains('active')) {
            console.log('[POST-READING] Not on reader page, skipping scroll detection');
            return;
        }
        
        const readerContent = document.getElementById('reader-content');
        if (!readerContent) {
            console.warn('[POST-READING] Reader content not found');
            return;
        }
        
        // CRITICAL: Check if already set up (prevent duplicate listeners)
        if (readerContent.dataset.postReadingSetup === 'true') {
            console.log('[POST-READING] Scroll detection already set up');
            return;
        }
        
        const chapterInfo = getCurrentChapterInfo();
        if (!chapterInfo.isValid || !chapterInfo.manhwaId || !isLastChapter(chapterInfo.manhwaId, chapterInfo.chapterIndex)) {
            console.log('[POST-READING] Not last chapter, skipping scroll detection');
            return; // Not last chapter, skip
        }
        
        // Check if already submitted
        if (hasSubmittedPostReadingFeedback(chapterInfo.manhwaId)) {
            console.log('[POST-READING] Feedback already submitted, skipping scroll detection');
            return;
        }
        
        let hasShown = false;
        const manhwaId = chapterInfo.manhwaId;
        
        // Scroll detection (safe with try-catch)
        const checkScroll = () => {
            try {
                if (hasShown) return;
                
                // CRITICAL: Re-check if still on reader page
                if (!readerPage || !readerPage.classList.contains('active')) {
                    return;
                }
                
                const scrollTop = readerContent.scrollTop || window.pageYOffset || 0;
                const scrollHeight = readerContent.scrollHeight || document.documentElement.scrollHeight || 0;
                const clientHeight = readerContent.clientHeight || window.innerHeight || 0;
                
                // Check if scrolled to bottom (with 100px threshold)
                if (scrollHeight > 0 && scrollTop + clientHeight >= scrollHeight - 100) {
                    hasShown = true;
                    showPostReadingModal(manhwaId);
                    
                    // Show finish button (non-blocking)
                    try {
                        const finishBtn = document.getElementById('finish-reading-btn');
                        if (finishBtn) {
                            finishBtn.style.display = 'block';
                        }
                    } catch (btnErr) {
                        console.warn('[POST-READING] Error showing finish button:', btnErr);
                    }
                }
            } catch (scrollErr) {
                console.warn('[POST-READING] Error in scroll check:', scrollErr);
            }
        };
        
        // Add scroll listeners (with error handling)
        try {
            readerContent.addEventListener('scroll', checkScroll, { passive: true });
        } catch (scrollListenerErr) {
            console.warn('[POST-READING] Error adding scroll listener:', scrollListenerErr);
        }
        
        try {
            window.addEventListener('scroll', checkScroll, { passive: true });
        } catch (windowScrollErr) {
            console.warn('[POST-READING] Error adding window scroll listener:', windowScrollErr);
        }
        
        // Also check on load (with delay)
        setTimeout(() => {
            try {
                checkScroll();
            } catch (timeoutErr) {
                console.warn('[POST-READING] Error in timeout check:', timeoutErr);
            }
        }, 1000);
        
        // Finish button (with element check and duplicate prevention)
        const finishBtn = document.getElementById('finish-reading-btn');
        if (finishBtn && finishBtn.dataset.listenerAdded !== 'true') {
            try {
                finishBtn.addEventListener('click', () => {
                    try {
                        if (!hasShown) {
                            hasShown = true;
                            showPostReadingModal(manhwaId);
                        }
                    } catch (finishErr) {
                        console.warn('[POST-READING] Error in finish button click:', finishErr);
                    }
                });
                finishBtn.dataset.listenerAdded = 'true';
            } catch (finishListenerErr) {
                console.warn('[POST-READING] Error adding finish button listener:', finishListenerErr);
            }
        }
        
        // Mark as set up
        readerContent.dataset.postReadingSetup = 'true';
        console.log('[POST-READING] Scroll detection setup complete');
    } catch (err) {
        console.error('[POST-READING] Error setting up scroll detection:', err);
        // Silent fail - don't block page
    }
}

/**
 * Initialize post-reading system (SAFE - with full validation and isolation)
 */
function initializePostReadingSystem() {
    try {
        // CRITICAL: Check if we're on reader page FIRST
        const readerPage = document.getElementById('reader-page');
        if (!readerPage) {
            console.log('[POST-READING] Reader page not found, skipping initialization');
            return; // Not on reader page, skip entirely
        }
        
        if (!readerPage.classList.contains('active')) {
            console.log('[POST-READING] Reader page not active, skipping initialization');
            return; // Not active, skip
        }
        
        // CRITICAL: Check if already initialized (prevent duplicate initialization)
        if (window.postReadingInitialized === true) {
            console.log('[POST-READING] Already initialized, skipping');
            return;
        }
        
        // Setup modal (non-blocking)
        try {
            setupPostReadingModal();
        } catch (modalErr) {
            console.warn('[POST-READING] Error setting up modal:', modalErr);
            // Continue - modal setup failure doesn't block scroll detection
        }
        
        // Setup scroll detection (only if on reader page and last chapter)
        try {
            setupPostReadingScrollDetection();
        } catch (scrollErr) {
            console.warn('[POST-READING] Error setting up scroll detection:', scrollErr);
            // Continue - scroll detection failure doesn't block page
        }
        
        // Mark as initialized
        window.postReadingInitialized = true;
        console.log('[POST-READING] System initialized');
    } catch (err) {
        console.error('[POST-READING] Error initializing system:', err);
        // Silent fail - don't block page or other systems
    }
}

// Cleanup on page unload - NO sliderInterval cleanup needed (auto-scroll disabled)
// window.addEventListener('beforeunload', () => {
//     if (sliderInterval) {
//         clearInterval(sliderInterval);
//         sliderInterval = null;
//     }
// });

// CRITICAL: Expose functions to global scope for HTML script access
// These functions are defined outside IIFE, so they should be globally accessible
// But we'll also explicitly expose them to window for safety
if (typeof window !== 'undefined') {
    // Expose immediately (functions are already defined)
    window.loadData = loadData;
    window.renderNewlyAdded = renderNewlyAdded;
    window.renderIndexPage = renderIndexPage;
    window.getUserAvatar = getUserAvatar;
    window.debugAvatar = function(username) {
        console.log('=== DEBUG AVATAR FOR:', username, '===');
        const usernameLower = (username || '').toLowerCase().trim();
        
        // 1. azura_users tekshirish
        try {
            const usersStr = localStorage.getItem('azura_users');
            if (usersStr) {
                const users = JSON.parse(usersStr);
                console.log('1. azura_users:', users);
                if (Array.isArray(users)) {
                    const user = users.find(u => {
                        const uUsername = (u.username || '').toLowerCase().trim();
                        const uEmail = (u.email || '').toLowerCase().trim();
                        return uUsername === usernameLower || uEmail === usernameLower;
                    });
                    console.log('   Found in array:', user);
                    if (user && user.avatar) {
                        console.log('   ✅ Avatar found in array:', user.avatar.substring(0, 50) + '...');
                        return user.avatar;
                    }
                } else if (typeof users === 'object') {
                    console.log('   Found in object (exact):', users[username]);
                    console.log('   Found in object (lowercase):', users[usernameLower]);
                    if (users[username] && users[username].avatar) {
                        console.log('   ✅ Avatar found (exact):', users[username].avatar.substring(0, 50) + '...');
                        return users[username].avatar;
                    }
                    const keys = Object.keys(users);
                    const matchingKey = keys.find(key => key.toLowerCase().trim() === usernameLower);
                    if (matchingKey && users[matchingKey].avatar) {
                        console.log('   ✅ Avatar found (case-insensitive):', users[matchingKey].avatar.substring(0, 50) + '...');
                        return users[matchingKey].avatar;
                    }
                }
            } else {
                console.log('1. azura_users: NOT FOUND');
            }
        } catch (err) {
            console.error('1. azura_users error:', err);
        }
        
        // 2. azura_profiles tekshirish
        try {
            const profilesStr = localStorage.getItem('azura_profiles');
            if (profilesStr) {
                const profiles = JSON.parse(profilesStr);
                console.log('2. azura_profiles:', profiles);
                if (profiles[username] && profiles[username].avatar) {
                    console.log('   ✅ Avatar found (exact):', profiles[username].avatar.substring(0, 50) + '...');
                    return profiles[username].avatar;
                }
                const keys = Object.keys(profiles);
                const matchingKey = keys.find(key => key.toLowerCase().trim() === usernameLower);
                if (matchingKey && profiles[matchingKey].avatar) {
                    console.log('   ✅ Avatar found (case-insensitive):', profiles[matchingKey].avatar.substring(0, 50) + '...');
                    return profiles[matchingKey].avatar;
                }
            } else {
                console.log('2. azura_profiles: NOT FOUND');
            }
        } catch (err) {
            console.error('2. azura_profiles error:', err);
        }
        
        // 3. azura_user (Google auth) tekshirish
        try {
            const userStr = localStorage.getItem('azura_user');
            if (userStr) {
                const authUser = JSON.parse(userStr);
                console.log('3. azura_user:', {
                    username: authUser.username,
                    email: authUser.email,
                    picture: authUser.picture ? authUser.picture.substring(0, 50) + '...' : null
                });
                const authUsername = (authUser.username || '').toLowerCase().trim();
                const authEmail = (authUser.email || '').toLowerCase().trim();
                const usernameMatch = authUsername === usernameLower;
                const emailMatch = authEmail === usernameLower;
                console.log('   Username match:', usernameMatch, 'Email match:', emailMatch);
                if ((usernameMatch || emailMatch) && authUser.picture) {
                    console.log('   ✅ Avatar found (Google auth):', authUser.picture.substring(0, 50) + '...');
                    return authUser.picture;
                }
            } else {
                console.log('3. azura_user: NOT FOUND');
            }
        } catch (err) {
            console.error('3. azura_user error:', err);
        }
        
        // 4. getUserAvatar() chaqirish
        console.log('4. Calling getUserAvatar()...');
        const avatar = getUserAvatar(username);
        console.log('   getUserAvatar result:', avatar ? avatar.substring(0, 50) + '...' : 'null');
        
        console.log('=== END DEBUG ===');
        return avatar;
    };
    
    // Expose manhwasData with getter
    Object.defineProperty(window, 'manhwasData', {
        get: function() { return manhwasData; },
        set: function(value) { manhwasData = value; },
        configurable: true
    });
    console.log('[GLOBAL] ✅ Functions exposed to window object:', {
        loadData: typeof window.loadData,
        renderNewlyAdded: typeof window.renderNewlyAdded,
        renderIndexPage: typeof window.renderIndexPage,
        getUserAvatar: typeof window.getUserAvatar,
        debugAvatar: typeof window.debugAvatar,
        manhwasData: typeof window.manhwasData
    });
}

// ============================================
// SIDEBAR MENU - EPIC DESIGN
// ============================================

function setupSidebarMenu() {
    try {
        const sidebarToggle = document.getElementById('sidebar-toggle-btn');
        const searchSidebarToggle = document.getElementById('search-sidebar-toggle');
        const sidebarMenu = document.getElementById('sidebar-menu');
        const sidebarClose = document.getElementById('sidebar-close');
        const sidebarOverlay = document.getElementById('sidebar-overlay');
        
        if (!sidebarMenu) {
            console.warn('[SIDEBAR] Sidebar menu not found, retrying...');
            // Retry after a short delay
            setTimeout(() => {
                const retryMenu = document.getElementById('sidebar-menu');
                if (retryMenu) {
                    console.log('[SIDEBAR] Retry successful, setting up sidebar...');
                    setupSidebarMenu();
                } else {
                    console.error('[SIDEBAR] Sidebar menu still not found after retry');
                }
            }, 500);
            return;
        }
        
        console.log('[SIDEBAR] Setting up sidebar menu...');
        
        // Toggle sidebar
        const toggleSidebar = () => {
            hapticFeedback('light');
            sidebarMenu.classList.toggle('active');
            // Prevent body scroll when sidebar is open
            if (sidebarMenu.classList.contains('active')) {
                document.body.style.overflow = 'hidden';
            } else {
                document.body.style.overflow = '';
            }
        };
        
        // Setup main sidebar toggle button
        if (sidebarToggle) {
            // Remove existing listeners to prevent duplicates
            const newToggle = sidebarToggle.cloneNode(true);
            sidebarToggle.parentNode.replaceChild(newToggle, sidebarToggle);
            
            // Open sidebar
            const currentToggle = document.getElementById('sidebar-toggle-btn');
            if (currentToggle) {
                currentToggle.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('[SIDEBAR] Toggle button clicked');
                    toggleSidebar();
                });
            }
        }
        
        // Setup search page sidebar toggle button
        if (searchSidebarToggle) {
            // Remove existing listeners to prevent duplicates
            const newSearchToggle = searchSidebarToggle.cloneNode(true);
            searchSidebarToggle.parentNode.replaceChild(newSearchToggle, searchSidebarToggle);
            
            // Open sidebar from search page
            const currentSearchToggle = document.getElementById('search-sidebar-toggle');
            if (currentSearchToggle) {
                currentSearchToggle.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('[SIDEBAR] Search toggle button clicked');
                    toggleSidebar();
                });
            }
        }
        
        // Close sidebar
        if (sidebarClose) {
            sidebarClose.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                hapticFeedback('light');
                sidebarMenu.classList.remove('active');
                document.body.style.overflow = '';
            });
        }
        
        // Close on overlay click
        if (sidebarOverlay) {
            sidebarOverlay.addEventListener('click', () => {
                hapticFeedback('light');
                sidebarMenu.classList.remove('active');
                document.body.style.overflow = '';
            });
        }
        
        // 18+ Filter handler
        const adultFilter = document.getElementById('adult-content-filter');
        if (adultFilter) {
            adultFilter.addEventListener('change', (e) => {
                hapticFeedback('selection');
                const isEnabled = e.target.checked;
                localStorage.setItem('azura_adult_content_enabled', isEnabled ? 'true' : 'false');
                console.log('[SIDEBAR] 18+ filter:', isEnabled ? 'enabled' : 'disabled');
                // Re-render manhwas with filter
                if (typeof renderAllManhwas === 'function') {
                    renderAllManhwas();
                }
            });
            
            // Load saved preference
            const saved = localStorage.getItem('azura_adult_content_enabled');
            if (saved === 'true') {
                adultFilter.checked = true;
            }
        }
        
        // Menu item handlers
        const menuItems = document.querySelectorAll('.sidebar-menu-item');
        menuItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                hapticFeedback('light');
                const action = item.dataset.action;
                
                if (action === 'home') {
                    if (typeof navigateToInternalPage === 'function') {
                        navigateToInternalPage('home-page');
                    }
                } else if (action === 'search') {
                    if (typeof navigateToInternalPage === 'function') {
                        navigateToInternalPage('search-page');
                    }
                } else if (action === 'profile') {
                    if (typeof navigateToInternalPage === 'function') {
                        navigateToInternalPage('profile-page');
                    }
                } else if (action === 'settings') {
                    console.log('[SIDEBAR] Settings clicked');
                    // TODO: Open settings
                } else if (action === 'about') {
                    console.log('[SIDEBAR] About clicked');
                    // TODO: Show about modal
                }
                
                // Close sidebar after action
                sidebarMenu.classList.remove('active');
                document.body.style.overflow = '';
            });
        });
        
        // Setup sidebar genres
        setupSidebarGenres();
        
        console.log('[SIDEBAR] Sidebar menu setup complete');
    } catch (err) {
        console.error('[SIDEBAR] Error setting up sidebar:', err);
    }
}

// ============================================
// SIDEBAR GENRES - EPIC DESIGN
// ============================================

function setupSidebarGenres() {
    try {
        const sidebarGenres = document.getElementById('sidebar-genres');
        if (!sidebarGenres) return;
        
        // Get all unique genres from manhwas
        const genres = new Set();
        if (manhwasData && Array.isArray(manhwasData)) {
            manhwasData.forEach(manhwa => {
                if (manhwa.genres && Array.isArray(manhwa.genres)) {
                    manhwa.genres.forEach(genre => {
                        if (genre && genre.trim()) {
                            genres.add(genre.trim());
                        }
                    });
                }
            });
        }
        
        // If no genres found, use default list
        if (genres.size === 0) {
            const defaultGenres = [
                'Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy',
                'Horror', 'Romance', 'Sci-Fi', 'Slice of Life', 'Supernatural',
                'Thriller', 'Mystery', 'Sports', 'Historical', 'Military'
            ];
            defaultGenres.forEach(g => genres.add(g));
        }
        
        // Sort genres
        const sortedGenres = Array.from(genres).sort();
        
        // Render genre items
        sidebarGenres.innerHTML = '';
        sortedGenres.forEach(genre => {
            const genreItem = document.createElement('button');
            genreItem.className = 'sidebar-genre-item';
            genreItem.textContent = genre;
            genreItem.dataset.genre = genre;
            
            genreItem.addEventListener('click', (e) => {
                e.preventDefault();
                hapticFeedback('selection');
                
                // Toggle active state
                document.querySelectorAll('.sidebar-genre-item').forEach(item => {
                    item.classList.remove('active');
                });
                genreItem.classList.add('active');
                
                // Navigate to search page with genre filter
                if (typeof navigateToInternalPage === 'function') {
                    navigateToInternalPage('search-page');
                    // Set genre filter in search
                    setTimeout(() => {
                        const searchInput = document.getElementById('search-input');
                        if (searchInput) {
                            searchInput.value = genre;
                            // Trigger search
                            if (typeof setupSearchPage === 'function') {
                                setupSearchPage();
                            }
                        }
                    }, 300);
                }
                
                // Close sidebar
                sidebarMenu.classList.remove('active');
                document.body.style.overflow = '';
            });
            
            sidebarGenres.appendChild(genreItem);
        });
        
        console.log(`[SIDEBAR] ${sortedGenres.length} genres loaded`);
    } catch (err) {
        console.error('[SIDEBAR] Error setting up genres:', err);
    }
}

// ============================================
// NEWS SECTION - EPIC DESIGN
// ============================================

function renderNews() {
    try {
        const newsContainer = document.getElementById('news-container');
        if (!newsContainer) {
            console.warn('[NEWS] News container not found');
            return;
        }
        
        // Get news from localStorage
        let news = [];
        try {
            const newsStr = localStorage.getItem('azura_news');
            if (newsStr) {
                news = JSON.parse(newsStr);
            }
        } catch (err) {
            console.warn('[NEWS] Error loading news:', err);
        }
        
        if (!Array.isArray(news)) {
            news = [];
        }
        
        // Show empty state if no news
        if (news.length === 0) {
            newsContainer.innerHTML = `
                <div class="news-empty-state">
                    <div class="news-empty-icon">📰</div>
                    <div class="news-empty-text">Hozircha yangiliklar yo'q</div>
                    <div class="news-empty-subtext">Birinchi yangilikni qo'shing!</div>
                </div>
            `;
            return;
        }
        
        // Render news items
        const fragment = document.createDocumentFragment();
        news.forEach((item, index) => {
            try {
                const newsItem = document.createElement('div');
                newsItem.className = 'news-item';
                
                newsItem.innerHTML = `
                    ${item.image ? `<img src="${item.image}" alt="${item.title}" class="news-item-image">` : ''}
                    <div class="news-item-content">
                        <h3 class="news-item-title">${item.title || 'Yangilik'}</h3>
                        <p class="news-item-text">${item.text || ''}</p>
                        <div class="news-item-date">${item.date ? new Date(item.date).toLocaleDateString('uz-UZ') : ''}</div>
                    </div>
                `;
                
                fragment.appendChild(newsItem);
            } catch (err) {
                console.warn(`[NEWS] Error creating news item ${index}:`, err);
            }
        });
        
        newsContainer.innerHTML = '';
        newsContainer.appendChild(fragment);
        
        console.log(`[NEWS] ${news.length} news items rendered`);
    } catch (err) {
        console.error('[NEWS] Error rendering news:', err);
    }
}

function setupNewsAddButton() {
    try {
        const addNewsBtn = document.getElementById('add-news-btn');
        if (!addNewsBtn) return;
        
        addNewsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            hapticFeedback('medium');
            
            // TODO: Open add news modal
            console.log('[NEWS] Add news button clicked');
            alert('Yangi yangilik qo\'shish funksiyasi tez orada qo\'shiladi!');
        });
    } catch (err) {
        console.error('[NEWS] Error setting up add button:', err);
    }
}

// ============================================
// MANHWA FILTERS - EPIC DESIGN
// ============================================

function setupManhwaFilters() {
    try {
        const filterBtns = document.querySelectorAll('.filter-btn');
        if (filterBtns.length === 0) return;
        
        filterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                hapticFeedback('selection');
                
                // Remove active from all
                filterBtns.forEach(b => b.classList.remove('active'));
                // Add active to clicked
                btn.classList.add('active');
                
                const filter = btn.dataset.filter;
                console.log('[FILTER] Filter changed to:', filter);
                
                // Apply filter
                if (typeof renderAllManhwas === 'function') {
                    renderAllManhwas(filter);
                }
            });
        });
        
        console.log('[FILTER] Manhwa filters setup complete');
    } catch (err) {
        console.error('[FILTER] Error setting up filters:', err);
    }
}

// ============================================
// LOAD MORE FUNCTIONALITY - 600 MANHWA SUPPORT
// ============================================

let currentManhwaPage = 1;
const MANHWAS_PER_PAGE = 20;

function setupLoadMore() {
    try {
        const loadMoreBtn = document.getElementById('load-more-btn');
        const loadMoreContainer = document.getElementById('load-more-container');
        
        if (!loadMoreBtn || !loadMoreContainer) return;
        
        loadMoreBtn.addEventListener('click', (e) => {
            e.preventDefault();
            hapticFeedback('medium');
            
            loadMoreBtn.classList.add('loading');
            loadMoreBtn.innerHTML = '<span>Yuklanmoqda...</span>';
            
            // Load next page
            setTimeout(() => {
                currentManhwaPage++;
                loadMoreManhwas(currentManhwaPage);
                loadMoreBtn.classList.remove('loading');
                loadMoreBtn.innerHTML = '<span>Ko\'proq yuklash</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>';
            }, 500);
        });
        
        console.log('[LOAD MORE] Load more button setup complete');
    } catch (err) {
        console.error('[LOAD MORE] Error setting up load more:', err);
    }
}

function loadMoreManhwas(page) {
    try {
        if (!manhwasData || manhwasData.length === 0) return;
        
        const grid = document.getElementById('manhwa-grid');
        if (!grid) return;
        
        // Get current filter
        const activeFilter = document.querySelector('.filter-btn.active');
        const filter = activeFilter ? activeFilter.dataset.filter : 'all';
        
        // Apply filter (same logic as renderAllManhwas)
        let filteredManhwas = [...manhwasData];
        
        // 18+ filter check
        const adultFilterEnabled = localStorage.getItem('azura_adult_content_enabled') === 'true';
        if (!adultFilterEnabled) {
            filteredManhwas = filteredManhwas.filter(m => {
                const genres = (m.genres || []).map(g => g.toLowerCase());
                return !genres.includes('18+') && !genres.includes('adult') && !genres.includes('mature');
            });
        }
        
        // Apply other filters
        if (filter === 'popular' || filter === 'rating') {
            filteredManhwas.sort((a, b) => {
                const aRating = a.rating || 0;
                const bRating = b.rating || 0;
                return bRating - aRating;
            });
        } else if (filter === 'newest') {
            filteredManhwas.reverse();
        }
        
        // Load up to current page
        const endIndex = page * MANHWAS_PER_PAGE;
        const manhwasToShow = filteredManhwas.slice(0, endIndex);
        
        // Clear and re-render
        grid.innerHTML = '';
        const fragment = document.createDocumentFragment();
        manhwasToShow.forEach(manhwa => {
            try {
                const card = createManhwaCard(manhwa);
                if (card) fragment.appendChild(card);
            } catch (err) {
                console.warn('[LOAD MORE] Error creating card:', err);
            }
        });
        
        grid.appendChild(fragment);
        
        // Show/hide load more button
        const loadMoreContainer = document.getElementById('load-more-container');
        if (loadMoreContainer) {
            if (endIndex >= filteredManhwas.length) {
                loadMoreContainer.style.display = 'none';
            } else {
                loadMoreContainer.style.display = 'flex';
            }
        }
        
        console.log(`[LOAD MORE] Loaded page ${page}, showing ${manhwasToShow.length} of ${filteredManhwas.length} manhwas`);
    } catch (err) {
        console.error('[LOAD MORE] Error loading more manhwas:', err);
    }
}

// ============================================
// SEARCH PAGE COMMENTS - EPIC DESIGN
// ============================================

function setupSearchPageComments() {
    try {
        const sliderTrack = document.getElementById('comments-slider-track');
        const sliderDots = document.getElementById('comments-slider-dots');
        
        if (!sliderTrack) {
            console.warn('[SEARCH COMMENTS] Slider track not found');
            return;
        }
        
        // Get recent comments (10 ta)
        let comments = getRecentComments(10);
        
        // DEBUG: Log comments for troubleshooting
        console.log('[SEARCH COMMENTS] Found comments:', comments.length);
        if (comments.length > 0) {
            console.log('[SEARCH COMMENTS] First comment:', comments[0]);
        }
        
        // If no comments, show empty state but don't return - allow retry after data loads
        if (comments.length === 0) {
            // Check if data is still loading
            if (!manhwasData || manhwasData.length === 0) {
                // Data might still be loading, show loading state
                sliderTrack.innerHTML = `
                    <div class="search-comment-empty">
                        <div class="search-comment-empty-icon">⏳</div>
                        <div class="search-comment-empty-text">Ma'lumotlar yuklanmoqda...</div>
                    </div>
                `;
                // Retry after data loads
                setTimeout(() => {
                    setupSearchPageComments();
                }, 1000);
                return;
            }
            
            // No comments and data is loaded - show empty state
            sliderTrack.innerHTML = `
                <div class="search-comment-empty">
                    <div class="search-comment-empty-icon">💬</div>
                    <div class="search-comment-empty-text">Hozircha izohlar yo'q</div>
                    <div class="search-comment-empty-subtext">Birinchi izohni yozing va jamoaga qo'shiling!</div>
                </div>
            `;
            return;
        }
        
        // Render slider items
        sliderTrack.innerHTML = '';
        const fragment = document.createDocumentFragment();
        
        comments.forEach((comment, index) => {
            try {
                const sliderItem = createSearchCommentSliderItem(comment, index);
                if (sliderItem) fragment.appendChild(sliderItem);
            } catch (err) {
                console.warn(`[SEARCH COMMENTS] Error creating slider item ${index}:`, err);
            }
        });
        
        sliderTrack.appendChild(fragment);
        
        // Setup slider dots
        if (sliderDots) {
            sliderDots.innerHTML = '';
            comments.forEach((_, index) => {
                const dot = document.createElement('button');
                dot.className = 'comments-slider-dot';
                if (index === 0) dot.classList.add('active');
                dot.dataset.slide = index;
                dot.addEventListener('click', () => goToSlide(index));
                sliderDots.appendChild(dot);
            });
        }
        
        // Setup slider auto-play and navigation
        setupCommentsSlider();
        
        // Setup like buttons
        setupSearchCommentLikes();
        
        console.log(`[SEARCH COMMENTS] ${comments.length} comments rendered in slider`);
    } catch (err) {
        console.error('[SEARCH COMMENTS] Error setting up comments:', err);
    }
}

let currentCommentSlide = 0;
let commentSliderInterval = null;

function createSearchCommentSliderItem(comment, index) {
    try {
        const item = document.createElement('div');
        item.className = 'comments-slider-item';
        if (index === 0) item.classList.add('active');
        
        const username = comment.username || 'Guest';
        const avatar = comment.avatar || getUserAvatar(username);
        const manhwaTitle = comment.manhwaTitle || 'Noma\'lum manhwa';
        const text = comment.text || '';
        const likes = comment.likes || 0;
        const timestamp = comment.timestamp || Date.now();
        
        // Get manhwa cover - SAFE: prevent null/undefined
        let manhwaCover = '';
        if (comment.manhwaId && manhwasData && Array.isArray(manhwasData)) {
            try {
                const manhwa = manhwasData.find(m => {
                    if (!m || typeof m !== 'object') return false;
                    return (m.id === comment.manhwaId || m.slug === comment.manhwaId);
                });
                if (manhwa && manhwa.cover && typeof manhwa.cover === 'string' && manhwa.cover.trim() !== '') {
                    manhwaCover = manhwa.cover.trim();
                }
            } catch (err) {
                console.warn('[SEARCH COMMENTS] Error finding manhwa cover:', err);
            }
        }
        
        // Convert timestamp to Date if needed
        let timeAgo = 'Endi';
        try {
            if (timestamp) {
                const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
                if (!isNaN(date.getTime())) {
                    timeAgo = getTimeAgo(date);
                }
            }
        } catch (err) {
            console.warn('[SEARCH COMMENTS] Error formatting time:', err);
        }
        
        // SAFE: Only show cover if valid URL
        const coverHTML = (manhwaCover && manhwaCover !== 'null' && manhwaCover !== 'undefined') ? `
                <div class="comment-manhwa-cover">
                    <img src="${manhwaCover}" alt="${manhwaTitle}" onerror="this.style.display='none'; this.parentElement.style.display='none';">
                    <div class="comment-cover-overlay"></div>
                </div>
                ` : '';
        
        item.innerHTML = `
            <div class="comment-slider-card">
                ${coverHTML}
                <div class="comment-slider-content">
                    <div class="search-comment-header">
                        <img src="${avatar}" alt="${username}" class="search-comment-avatar" onerror="this.src='assets/avatars/avatar-male.png'">
                        <div class="search-comment-user-info">
                            <div class="search-comment-username">${username}</div>
                            <div class="search-comment-manhwa">${manhwaTitle}</div>
                        </div>
                        <div class="search-comment-time">${timeAgo}</div>
                    </div>
                    <div class="search-comment-text">${text}</div>
                    <div class="search-comment-actions">
                        <button class="search-comment-like-btn" data-comment-id="${comment.id || Date.now()}" data-liked="${comment.userLiked || false}">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                            </svg>
                            <span class="like-count">${likes}</span>
                        </button>
                        <button class="search-comment-reply-btn">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                            </svg>
                            <span>Javob</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        return item;
    } catch (err) {
        console.error('[SEARCH COMMENTS] Error creating slider item:', err);
        return null;
    }
}

function setupCommentsSlider() {
    try {
        const sliderTrack = document.getElementById('comments-slider-track');
        if (!sliderTrack) return;
        
        // Auto-play slider
        startCommentSliderAutoPlay();
        
        // Touch/swipe support
        let startX = 0;
        let isDragging = false;
        
        sliderTrack.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            isDragging = true;
            stopCommentSliderAutoPlay();
        });
        
        sliderTrack.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
        });
        
        sliderTrack.addEventListener('touchend', (e) => {
            if (!isDragging) return;
            isDragging = false;
            
            const endX = e.changedTouches[0].clientX;
            const diff = startX - endX;
            
            if (Math.abs(diff) > 50) {
                if (diff > 0) {
                    nextCommentSlide();
                } else {
                    prevCommentSlide();
                }
            }
            
            startCommentSliderAutoPlay();
        });
        
        console.log('[SEARCH COMMENTS] Slider setup complete');
    } catch (err) {
        console.error('[SEARCH COMMENTS] Error setting up slider:', err);
    }
}

function startCommentSliderAutoPlay() {
    stopCommentSliderAutoPlay();
    commentSliderInterval = setInterval(() => {
        nextCommentSlide();
    }, 5000); // 5 seconds
}

function stopCommentSliderAutoPlay() {
    if (commentSliderInterval) {
        clearInterval(commentSliderInterval);
        commentSliderInterval = null;
    }
}

function nextCommentSlide() {
    const items = document.querySelectorAll('.comments-slider-item');
    if (items.length === 0) return;
    
    currentCommentSlide = (currentCommentSlide + 1) % items.length;
    goToSlide(currentCommentSlide);
}

function prevCommentSlide() {
    const items = document.querySelectorAll('.comments-slider-item');
    if (items.length === 0) return;
    
    currentCommentSlide = (currentCommentSlide - 1 + items.length) % items.length;
    goToSlide(currentCommentSlide);
}

function goToSlide(index) {
    try {
        const items = document.querySelectorAll('.comments-slider-item');
        const dots = document.querySelectorAll('.comments-slider-dot');
        
        if (items.length === 0) return;
        
        currentCommentSlide = index;
        
        items.forEach((item, i) => {
            if (i === index) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
        
        dots.forEach((dot, i) => {
            if (i === index) {
                dot.classList.add('active');
            } else {
                dot.classList.remove('active');
            }
        });
        
        // Restart auto-play
        startCommentSliderAutoPlay();
    } catch (err) {
        console.error('[SEARCH COMMENTS] Error going to slide:', err);
    }
}

function createSearchCommentItem(comment) {
    try {
        const item = document.createElement('div');
        item.className = 'search-comment-item';
        
        const username = comment.username || 'Guest';
        const avatar = comment.avatar || getUserAvatar(username);
        const manhwaTitle = comment.manhwaTitle || 'Noma\'lum manhwa';
        const text = comment.text || '';
        const likes = comment.likes || 0;
        const timestamp = comment.timestamp || Date.now();
        
        const timeAgo = getTimeAgo(timestamp);
        
        item.innerHTML = `
            <div class="search-comment-header">
                <img src="${avatar}" alt="${username}" class="search-comment-avatar" onerror="this.src='assets/avatars/avatar-male.png'">
                <div class="search-comment-user-info">
                    <div class="search-comment-username">${username}</div>
                    <div class="search-comment-manhwa">${manhwaTitle}</div>
                </div>
                <div class="search-comment-time">${timeAgo}</div>
            </div>
            <div class="search-comment-text">${text}</div>
            <div class="search-comment-actions">
                <button class="search-comment-like-btn" data-comment-id="${comment.id || Date.now()}" data-liked="${comment.userLiked || false}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                    </svg>
                    <span class="like-count">${likes}</span>
                </button>
                <button class="search-comment-reply-btn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                    <span>Javob</span>
                </button>
            </div>
        `;
        
        return item;
    } catch (err) {
        console.error('[SEARCH COMMENTS] Error creating comment item:', err);
        return null;
    }
}

function setupSearchCommentLikes() {
    try {
        const likeBtns = document.querySelectorAll('.search-comment-like-btn');
        likeBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                hapticFeedback('light');
                
                const commentId = btn.dataset.commentId;
                const isLiked = btn.dataset.liked === 'true';
                const likeCountEl = btn.querySelector('.like-count');
                
                // Toggle like
                if (isLiked) {
                    btn.dataset.liked = 'false';
                    btn.classList.remove('liked');
                    if (likeCountEl) {
                        const currentCount = parseInt(likeCountEl.textContent) || 0;
                        likeCountEl.textContent = Math.max(0, currentCount - 1);
                    }
                } else {
                    btn.dataset.liked = 'true';
                    btn.classList.add('liked');
                    if (likeCountEl) {
                        const currentCount = parseInt(likeCountEl.textContent) || 0;
                        likeCountEl.textContent = currentCount + 1;
                    }
                }
                
                // Save to localStorage
                saveCommentLike(commentId, !isLiked);
            });
        });
    } catch (err) {
        console.error('[SEARCH COMMENTS] Error setting up likes:', err);
    }
}

function saveCommentLike(commentId, isLiked) {
    try {
        let likes = {};
        try {
            const likesStr = localStorage.getItem('azura_comment_likes');
            if (likesStr) {
                likes = JSON.parse(likesStr);
            }
        } catch (err) {
            console.warn('[SEARCH COMMENTS] Error loading likes:', err);
        }
        
        likes[commentId] = isLiked;
        localStorage.setItem('azura_comment_likes', JSON.stringify(likes));
    } catch (err) {
        console.error('[SEARCH COMMENTS] Error saving like:', err);
    }
}

function getTimeAgo(timestamp) {
    try {
        const now = Date.now();
        const diff = now - timestamp;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) return `${days} kun oldin`;
        if (hours > 0) return `${hours} soat oldin`;
        if (minutes > 0) return `${minutes} daqiqa oldin`;
        return 'Hozir';
    } catch (err) {
        return '';
    }
}

// ============================================
// SEARCH CLEAR BUTTON
// ============================================

function setupSearchClearButton() {
    try {
        const searchInput = document.getElementById('search-input');
        const clearBtn = document.getElementById('search-clear-btn');
        
        if (!searchInput || !clearBtn) return;
        
        // Show/hide clear button based on input
        searchInput.addEventListener('input', (e) => {
            if (e.target.value.trim()) {
                clearBtn.style.display = 'flex';
            } else {
                clearBtn.style.display = 'none';
            }
        });
        
        // Clear input on button click
        clearBtn.addEventListener('click', (e) => {
            e.preventDefault();
            hapticFeedback('light');
            searchInput.value = '';
            clearBtn.style.display = 'none';
            searchInput.focus();
            
            // Reset search results
            const genreHub = document.getElementById('genre-hub-section');
            const resultsSection = document.getElementById('search-results-section');
            if (genreHub) genreHub.style.display = 'block';
            if (resultsSection) resultsSection.style.display = 'none';
        });
    } catch (err) {
        console.error('[SEARCH] Error setting up clear button:', err);
    }
}

// ============================================
// SEARCH LOADING ANIMATION
// ============================================

function setupSearchLoading() {
    try {
        const searchInput = document.getElementById('search-input');
        const loadingContainer = document.getElementById('search-loading-container');
        
        if (!searchInput || !loadingContainer) return;
        
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            
            // Clear previous timeout
            clearTimeout(searchTimeout);
            
            if (query.length > 0) {
                // Show loading after 300ms
                searchTimeout = setTimeout(() => {
                    loadingContainer.style.display = 'flex';
                }, 300);
            } else {
                loadingContainer.style.display = 'none';
            }
        });
    } catch (err) {
        console.error('[SEARCH] Error setting up loading:', err);
    }
}
