/* =========================================
   FIREBASE (Global Variables from Compat)
   ========================================= */
const firebaseConfig = {
  apiKey: "AIzaSyA_IfWftCmZEJHzRA7O8A1W3_9apn2BX8s",
  authDomain: "flowwatch-9d2b4.firebaseapp.com",
  projectId: "flowwatch-9d2b4",
  storageBucket: "flowwatch-9d2b4.firebasestorage.app",
  messagingSenderId: "566478675194",
  appId: "1:566478675194:web:095ec93634d5136ce8fd43",
  measurementId: "G-56EVTRPK5K"
};

let db = null;
let auth = null;
let currentUser = null;

try {
  if (window.firebase) {
    firebase.initializeApp(firebaseConfig);
    firebase.analytics();
    auth = firebase.auth();
    db = firebase.firestore();
  }
} catch (e) {
  console.log("Firebase not loaded/init failed.", e);
}

/* =========================================
   API CONFIGURATION
   ========================================= */
const TMDB_API_KEY = "66a48a534909571f090b1c975c6b132c"; 
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const ANILIST_API_URL = "https://graphql.anilist.co";

const TMDB_GENRES = {
  28: "Ação", 12: "Aventura", 16: "Animação", 35: "Comédia", 80: "Crime", 99: "Documentário", 18: "Drama", 10751: "Família", 14: "Fantasia", 36: "História", 27: "Terror", 10402: "Música", 9648: "Mistério", 10749: "Romance", 878: "Ficção Científica", 10770: "Filme TV", 53: "Thriller", 10752: "Guerra", 37: "Faroeste",
  10759: "Ação e Aventura", 10762: "Kids", 10765: "Sci-Fi & Fantasy", 10768: "War & Politics"
};

/* =========================================
   STATE MANAGEMENT (LocalStorage + Cloud)
   ========================================= */
const STORE_KEY = "flowwatch_library";

let library = [];
try {
  library = JSON.parse(localStorage.getItem(STORE_KEY)) || [];
} catch (e) {
  library = [];
}

let isSyncing = false;
let filterModal = null;
let currentIsCatalogFilter = false;
let activeSearchGenre = ''; 
let catalogActiveGenre = '';
let catalogActiveType = 'all';
let tempSelectedGenre = '';
let currentSearchType = 'movie'; 
let currentSearchResults = [];
let libraryActiveFilter = 'all'; 
let currentSelectedItem = null; 

function saveLibrary() {
  localStorage.setItem(STORE_KEY, JSON.stringify(library));
  if (currentUser && db && !isSyncing) {
    syncToCloud();
  }
}

async function syncToCloud() {
  if (!currentUser || !db || isSyncing) return;
  isSyncing = true;
  try {
    await db.collection('users').doc(currentUser.uid).set({
      library: JSON.stringify(library),
      lastSync: firebase.firestore.FieldValue.serverTimestamp(),
      email: currentUser.email
    }, { merge: true });
    console.log('☁️ Backup sincronizado com a nuvem.');
  } catch (e) {
    console.error('Erro ao sincronizar:', e);
  } finally {
    isSyncing = false;
  }
}

async function syncFromCloud() {
  if (!currentUser || !db) return;
  try {
    const doc = await db.collection('users').doc(currentUser.uid).get();
    if (doc.exists && doc.data().library) {
      const cloudLibrary = JSON.parse(doc.data().library);
      // Merge: combine local + cloud, deduplicate by id+type
      const merged = [...library];
      cloudLibrary.forEach(cloudItem => {
        const existsIndex = merged.findIndex(l => l.id === cloudItem.id && l.type === cloudItem.type);
        if (existsIndex === -1) {
          merged.push(cloudItem);
        }
        // If exists locally, keep local version (user's device is priority)
      });
      library = merged;
      localStorage.setItem(STORE_KEY, JSON.stringify(library));
      // Push merged result back to cloud
      await syncToCloud();
      console.log('☁️ Biblioteca mesclada com dados da nuvem.');
      // Re-render current view
      renderHome();
      renderLibrary();
      renderStats();
    }
  } catch (e) {
    console.error('Erro ao buscar dados da nuvem:', e);
  }
}

/* =========================================
   FIREBASE AUTH: LOGIN / LOGOUT
   ========================================= */
async function handleGoogleLogin() {
  if (!auth) { alert('Firebase não carregou. Verifique sua conexão.'); return; }
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
  } catch (e) {
    console.error('Erro no login:', e);
    if (e.code !== 'auth/popup-closed-by-user') {
      alert('Erro ao fazer login. Tente novamente.');
    }
  }
}

async function handleLogout() {
  if (!auth) return;
  try {
    await auth.signOut();
  } catch (e) {
    console.error('Erro ao sair:', e);
  }
}

function updateSettingsUI(user) {
  const unauthView = document.getElementById('settings-unauth-view');
  const authView = document.getElementById('settings-auth-view');
  const emailDisplay = document.getElementById('user-email-display');
  if (!unauthView || !authView) return;

  if (user) {
    unauthView.classList.add('hidden');
    authView.classList.remove('hidden');
    emailDisplay.textContent = user.email || user.displayName || 'Conta conectada';
  } else {
    unauthView.classList.remove('hidden');
    authView.classList.add('hidden');
    emailDisplay.textContent = '';
  }
}

// Auth state listener
if (auth) {
  auth.onAuthStateChanged(async (user) => {
    currentUser = user;
    updateSettingsUI(user);
    if (user) {
      await syncFromCloud();
    }
  });
}

// Translate logic wrappers
const T = {
  types: { 'movie': 'Filme', 'tv': 'Série', 'anime': 'Anime' },
  status: { 'watching': 'Assistindo', 'completed': 'Concluído', 'plan': 'Pretendido', 'dropped': 'Abandonado' }
};

/* =========================================
   UI NAVIGATION
   ========================================= */
const navItems = document.querySelectorAll('.bottom-nav .nav-item');
const views = document.querySelectorAll('.view');
const btnSearchNav = document.querySelector('[data-target="search"]');

navItems.forEach(btn => {
  btn.addEventListener('click', () => {
    navItems.forEach(n => n.classList.remove('active'));
    btn.classList.add('active');

    const target = btn.getAttribute('data-target');
    views.forEach(v => {
      v.classList.remove('active');
      if (v.id === `view-${target}`) {
        v.classList.add('active');
      }
    });

    if (target === 'home') renderHome();
    if (target === 'library') renderLibrary();
    if (target === 'stats') renderStats();
    if (target === 'catalog') fetchAndRenderCatalog();
    window.scrollTo(0, 0);
  });
});

// Filter Modal Logic
function populateFilterModal() {
  if (!filterGenresGrid) return;
  filterGenresGrid.innerHTML = '';
  // Combine custom genres
  const genres = ["Ação", "Aventura", "Animação", "Comédia", "Drama", "Ficção Científica", "Fantasia", "Terror", "Romance", "Mistério", "Thriller"];
  
  const allBtn = document.createElement('button');
  allBtn.className = `segment ${tempSelectedGenre === '' ? 'active' : ''}`;
  allBtn.textContent = 'Todos';
  allBtn.onclick = () => { tempSelectedGenre = ''; updateFilterSelection(); };
  filterGenresGrid.appendChild(allBtn);

  genres.forEach(g => {
    const btn = document.createElement('button');
    btn.className = `segment ${tempSelectedGenre === g ? 'active' : ''}`;
    btn.textContent = g;
    btn.onclick = () => { tempSelectedGenre = g; updateFilterSelection(); };
    filterGenresGrid.appendChild(btn);
  });
}

function updateFilterSelection() {
  Array.from(filterGenresGrid.children).forEach(b => {
    b.classList.toggle('active', b.textContent === tempSelectedGenre || (tempSelectedGenre === '' && b.textContent === 'Todos'));
  });
}

document.getElementById('btn-open-filter-modal')?.addEventListener('click', () => {
  currentIsCatalogFilter = false;
  tempSelectedGenre = activeSearchGenre;
  document.getElementById('sort-section').classList.add('hidden');
  document.getElementById('filter-modal-title').textContent = 'Busca';
  populateFilterModal();
  filterModal.classList.add('active'); // Changed from remove hidden
});

document.getElementById('btn-open-catalog-filter')?.addEventListener('click', () => {
  currentIsCatalogFilter = true;
  tempSelectedGenre = catalogActiveGenre;
  document.getElementById('sort-section').classList.remove('hidden');
  document.getElementById('filter-modal-title').textContent = 'Catálogo';
  populateFilterModal();
  filterModal.classList.add('active'); // Changed from remove hidden
});

document.getElementById('filter-close')?.addEventListener('click', () => filterModal.classList.remove('active'));
document.getElementById('filter-modal-backdrop')?.addEventListener('click', () => filterModal.classList.remove('active'));

document.getElementById('btn-apply-filters')?.addEventListener('click', () => {
  filterModal.classList.remove('active'); // Changed from add hidden
  if (currentIsCatalogFilter) {
    catalogActiveGenre = tempSelectedGenre;
    fetchAndRenderCatalog();
  } else {
    activeSearchGenre = tempSelectedGenre;
    renderSearchResults();
  }
});

/* =========================================
   UI RENDERING: HOME
   ========================================= */
async function renderHome() {
  // Greeting
  const hour = new Date().getHours();
  let greeting = "BOA NOITE";
  if (hour < 12) greeting = "BOM DIA";
  else if (hour < 18) greeting = "BOA TARDE";
  document.getElementById('greeting-time').textContent = `${greeting}, CURADOR`;

  // Stats
  let totalMinutes = 0;
  let completedCount = 0;
  
  const watchingItems = library.filter(i => i.status === 'watching');
  
  library.forEach(item => {
    if (item.status === 'completed') completedCount++;
    if (item.progress && item.duration) {
      totalMinutes += (item.progress * item.duration);
    }
  });

  const completionRate = library.length ? Math.round((completedCount / library.length) * 100) : 0;
  
  document.getElementById('home-hours').textContent = Math.round(totalMinutes / 60);
  document.getElementById('home-completion').textContent = `${completionRate}%`;

  // In Progress scroll
  const inProgressContainer = document.getElementById('home-in-progress');
  const inProgressTitle = document.getElementById('in-progress-title');
  inProgressContainer.innerHTML = '';
  
  if (watchingItems.length === 0) {
    inProgressTitle.textContent = "Tendências de Anime";
    inProgressContainer.innerHTML = `<div class="loading-spinner"></div>`;
    try {
      const trending = await fetchAniListTrending();
      inProgressContainer.innerHTML = '';
      trending.slice(0, 5).forEach(item => {
         inProgressContainer.appendChild(createHomePosterCard(item, false, false));
      });
    } catch(e) {
      inProgressContainer.innerHTML = `<div class="empty-state" style="padding:40px;">Nada em andamento.</div>`;
    }
  } else {
    inProgressTitle.textContent = "Em Andamento";
    watchingItems.forEach(item => {
      inProgressContainer.appendChild(createHomePosterCard(item, true, true));
    });
  }

  document.getElementById('mo-entries').textContent = library.length;
  const grid = document.getElementById('mo-grid');
  grid.innerHTML = '';
  for(let i=0; i<35; i++) {
    const box = document.createElement('div');
    box.className = 'mo-day-box';
    if(library.length > 0) {
       if(i % 5 === 0) box.classList.add('active-low');
       if(i % 11 === 0) box.classList.add('active-med');
       if(i === 17) box.classList.add('active-high');
    }
    grid.appendChild(box);
  }

  const recent = [...library].reverse().slice(0, 4);
  const recentContainer = document.getElementById('home-recently-curated');
  recentContainer.innerHTML = '';
  
  if (recent.length === 0) {
    recentContainer.innerHTML = `<div class="empty-state">Sua estante está esperando para ser preenchida.</div>`;
  } else {
    recent.forEach(item => {
      recentContainer.appendChild(createGridItemCard(item));
    });
  }
}

function createHomePosterCard(item, showProgress, inLibrary) {
  const typeLabel = T.types[item.type];
  const genresTags = (item.genres || []).slice(0, 2).filter(Boolean).join(' • ');
  const progressPercent = item.totalUnits ? Math.min(100, Math.round(((item.progress||0) / item.totalUnits)*100)) : (item.progress ? 10 : 0);
  
  const card = document.createElement('div');
  card.className = 'card-poster';
  card.innerHTML = `
    <img src="${item.poster}" alt="${item.title}" loading="lazy" />
    <div class="card-overlay">
      ${showProgress ? `
      <div class="progress-info">
        <span>${item.type === 'movie' ? (item.progress>0?'Assistido':'Não assistido') : `Ep ${item.progress||0} de ${item.totalUnits || '?'}`}</span>
        <span>${progressPercent}%</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: ${progressPercent}%;"></div>
      </div>
      ` : ''}
      <div class="card-meta">
        <div class="card-title">${item.title}</div>
        <div class="card-subtitle">${typeLabel}${genresTags ? ' | ' + genresTags : ''}</div>
      </div>
    </div>
  `;
  
  card.addEventListener('click', () => openSearchDetail(item));
  return card;
}

function incrementItemProgress(item) {
  const i = library.findIndex(el => el.id === item.id && el.type === item.type);
  if (i > -1) {
    library[i].progress = (library[i].progress || 0) + 1;
    saveLibrary();
    renderHome(); // Re-render imediato
  }
}

function createGridItemCard(item) {
  const typeLabel = T.types[item.type];
  const showStatus = item.status ? `background:var(--status-${item.status})` : '';
  const labelText = item.status ? T.status[item.status].toUpperCase() : typeLabel.toUpperCase();
  
  const div = document.createElement('div');
  div.className = 'item-card';
  div.innerHTML = `
    <div class="poster-wrapper">
      <img src="${item.poster || 'https://via.placeholder.com/300x450/161514/404040?text=Sem+Foto'}" alt="${item.title}" loading="lazy"/>
      <div class="item-badge" style="${showStatus}">${labelText}</div>
    </div>
    <div class="item-rating"><i class="bi bi-star-fill"></i> ${item.rating || item.voteAverage || '--'}</div>
    <div class="item-title">${item.title}</div>
    <div class="item-genres" style="font-size:0.75rem; color:var(--text-muted); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${(item.genres || []).filter(Boolean).slice(0,2).join(', ')}</div>
  `;
  div.addEventListener('click', () => openSearchDetail(item));
  return div;
}

/* =========================================
   SEARCH LOGIC
   ========================================= */
const searchSegments = document.querySelectorAll('#search-segments .segment');
const searchInput = document.getElementById('search-input');
const resultsContainer = document.getElementById('search-results-container');
const resultsGrid = document.getElementById('search-results-grid');
const searchIdle = document.getElementById('search-idle');
const searchLoading = document.getElementById('search-loading');

document.querySelectorAll('#catalog-segments .segment').forEach(seg => {
  seg.addEventListener('click', (e) => {
    document.querySelectorAll('#catalog-segments .segment').forEach(s => s.classList.remove('active'));
    seg.classList.add('active');
    catalogActiveType = e.target.getAttribute('data-type');
    fetchAndRenderCatalog();
  });
});

document.getElementById('catalog-sort')?.addEventListener('change', () => {
  fetchAndRenderCatalog();
});

async function fetchAndRenderCatalog() {
    const loader = document.getElementById('catalog-loading');
    const container = document.getElementById('catalog-results-container');
    const grid = document.getElementById('catalog-results-grid');
    const sortMode = document.getElementById('catalog-sort').value;
    
    loader.classList.remove('hidden');
    container.classList.add('hidden');
    grid.innerHTML = '';
    
    try {
        let items = [];
        
        const formatTMDb = (item, explicitType) => {
            const type = explicitType || item.media_type || (item.name ? 'tv' : 'movie');
            return {
                id: item.id.toString(), type: type, title: item.title || item.name,
                poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
                banner: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : null,
                year: (item.release_date || item.first_air_date || '').split('-')[0],
                voteAverage: item.vote_average ? item.vote_average.toFixed(1) : null,
                genres: (item.genre_ids || []).map(id => TMDB_GENRES[id]).filter(Boolean),
                description: item.overview, totalUnits: type === 'movie' ? 1 : null
            };
        };

        if (catalogActiveType === 'all' || catalogActiveType === 'movie' || catalogActiveType === 'tv') {
            const typeStr = catalogActiveType === 'all' ? 'all' : catalogActiveType;
            let url = '';
            
            if (sortMode === 'trending') {
                url = `${TMDB_BASE_URL}/trending/${typeStr}/day?api_key=${TMDB_API_KEY}&language=pt-BR`;
            } else {
                if (typeStr === 'all') url = `${TMDB_BASE_URL}/movie/top_rated?api_key=${TMDB_API_KEY}&language=pt-BR`;
                else url = `${TMDB_BASE_URL}/${typeStr}/top_rated?api_key=${TMDB_API_KEY}&language=pt-BR`;
            }

            const res = await fetch(url);
            const data = await res.json();
            let arr = data.results || [];
            
            if (catalogActiveType === 'tv' || catalogActiveType === 'all') {
                arr = arr.filter(i => {
                   const t = i.media_type || (i.name ? 'tv' : 'movie');
                   if(t === 'tv') return !((i.genre_ids||[]).includes(16) && i.original_language === 'ja');
                   return true;
                });
            }
            items = items.concat(arr.map(i => formatTMDb(i, catalogActiveType !== 'all' ? catalogActiveType : null)));
        }

        if (catalogActiveType === 'all' || catalogActiveType === 'anime') {
             const sortArg = sortMode === 'trending' ? 'TRENDING_DESC' : 'SCORE_DESC';
             const q = `query { Page(page:1, perPage:20) { media(type: ANIME, sort: ${sortArg}) { id title { romaji english native } coverImage { large } bannerImage averageScore description episodes duration genres seasonYear } } }`;
             const res = await fetch(ANILIST_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: q })
             });
             const data = await res.json();
             const arr = data.data.Page.media || [];
             items = items.concat(arr.map(a => ({
                id: a.id.toString(), type: 'anime',
                title: a.title.romaji || a.title.english || a.title.native,
                poster: a.coverImage?.large, banner: a.bannerImage,
                year: a.seasonYear, voteAverage: a.averageScore ? (a.averageScore / 10).toFixed(1) : null,
                genres: a.genres || [], description: a.description, totalUnits: a.episodes, duration: a.duration
             })));
        }

        if (catalogActiveGenre) {
           items = items.filter(i => {
              const g = i.genres || [];
              return g.some(genre => genre.toLowerCase().includes(catalogActiveGenre.toLowerCase()));
           });
        }
        
        if (catalogActiveType === 'all') {
            items.sort((a,b) => (b.voteAverage || 0) - (a.voteAverage || 0)); 
        }

        if (items.length === 0) {
            grid.innerHTML = '<div style="color:var(--text-muted); padding:16px; grid-column:1/-1;">Nenhum título encontrado com este filtro.</div>';
        } else {
            items.slice(0, 30).forEach(item => {
                grid.appendChild(createGridItemCard(item));
            });
        }
        
    } catch(err) {
        console.error("Catalog Error", err);
        grid.innerHTML = '<div style="color:var(--danger-color); padding:16px; grid-column:1/-1;">Erro ao carregar catálogo.</div>';
    } finally {
        loader.classList.add('hidden');
        container.classList.remove('hidden');
    }
}

searchSegments.forEach(seg => {
  seg.addEventListener('click', (e) => {
    searchSegments.forEach(s => s.classList.remove('active'));
    seg.classList.add('active');
    currentSearchType = e.target.getAttribute('data-type');
    activeSearchGenre = ''; // reset genre on type change
    // Not relying on hidden DOM filters anymore, using UI variable
    
    if(searchInput.value.trim().length > 2) {
      performSearch(searchInput.value.trim());
    }
  });
});

let debounceTimer;
searchInput.addEventListener('input', (e) => {
  const query = e.target.value.trim();
  clearTimeout(debounceTimer);
  
  if(query.length < 2) {
    searchIdle.classList.remove('hidden');
    resultsContainer.classList.add('hidden');
    return;
  }
  
  debounceTimer = setTimeout(() => {
    performSearch(query);
  }, 600);
});

async function performSearch(query) {
  searchIdle.classList.add('hidden');
  resultsContainer.classList.add('hidden');
  searchLoading.classList.remove('hidden');
  resultsGrid.innerHTML = '';

  try {
    const results = currentSearchType === 'anime' 
      ? await fetchAniListSearch(query) 
      : await fetchTMDbSearch(query, currentSearchType);
    
    currentSearchResults = results;
    renderSearchResults();
  } catch (err) {
    console.error(err);
    resultsGrid.innerHTML = '<div style="color:var(--danger-color); padding: 16px;">Erro ao buscar. Tente novamente mais tarde.</div>';
  } finally {
    searchLoading.classList.add('hidden');
    resultsContainer.classList.remove('hidden');
  }
}

function renderSearchResults() {
    const resultsGrid = document.getElementById('search-results-grid');
    resultsGrid.innerHTML = '';
    
    // Filter results locally
    const toRender = activeSearchGenre ? currentSearchResults.filter(item => {
      const g = item.genres || [];
      return g.some(genre => genre.toLowerCase().includes(activeSearchGenre.toLowerCase()));
    }) : currentSearchResults;

    if (toRender.length === 0) {
      resultsGrid.innerHTML = '<div style="color:var(--text-muted); padding: 16px;">Nenhum título encontrado com este filtro.</div>';
      return;
    }
    
    toRender.forEach(item => {
      resultsGrid.appendChild(createGridItemCard(item));
    });
}

/* =========================================
   LIBRARY LOGIC
   ========================================= */
const libraryFilters = document.querySelectorAll('#library-filters .segment');
const libraryGrid = document.getElementById('library-grid');

libraryFilters.forEach(seg => {
  seg.addEventListener('click', () => {
    libraryFilters.forEach(s => s.classList.remove('active'));
    seg.classList.add('active');
    libraryActiveFilter = seg.getAttribute('data-filter');
    renderLibrary();
  });
});

function renderLibrary() {
  libraryGrid.innerHTML = '';
  const filtered = libraryActiveFilter === 'all' 
    ? [...library].reverse() 
    : library.filter(i => i.status === libraryActiveFilter).reverse();
  
  if (filtered.length === 0) {
    libraryGrid.innerHTML = `<div class="empty-state">Nada por aqui ainda.</div>`;
    return;
  }

  filtered.forEach(item => {
    libraryGrid.appendChild(createGridItemCard(item));
  });
}

/* =========================================
   STATS LOGIC
   ========================================= */
function renderStats() {
  let totalMin = 0;
  let movies = 0, series = 0, animes = 0;
  const genres = {};

  library.forEach(item => {
    if(item.type === 'movie') movies++;
    if(item.type === 'tv') series++;
    if(item.type === 'anime') animes++;
    
    if (item.progress && item.duration) {
       totalMin += (item.progress * item.duration);
    } else if (item.type === 'movie' && item.status === 'completed') {
       totalMin += 120;
    } else if (item.progress) {
       totalMin += (item.progress * 24); 
    }

    if (item.genres && item.genres.length > 0) {
      item.genres.forEach(g => {
        genres[g] = (genres[g] || 0) + 1;
      });
    }
  });

  document.getElementById('stats-total-hours').textContent = Math.round(totalMin / 60) + 'h';
  document.getElementById('stats-movies-count').textContent = movies;
  document.getElementById('stats-series-count').textContent = series;
  document.getElementById('stats-anime-count').textContent = animes;

  const genreList = document.getElementById('stats-genres');
  genreList.innerHTML = '';
  
  const sortedGenres = Object.entries(genres).sort((a,b) => b[1] - a[1]).slice(0, 5);
  
  if(sortedGenres.length === 0) {
    genreList.innerHTML = `<li class="empty-state">Adicione histórias para ver aqui.</li>`;
  } else {
    const maxVal = sortedGenres[0][1];
    sortedGenres.forEach(([name, val]) => {
      const pct = (val / maxVal) * 100;
      genreList.innerHTML += `
        <li class="genre-item">
          <div class="genre-label">${name}</div>
          <div class="genre-bar-wrap">
            <div class="genre-bar" style="width: ${pct}%"></div>
          </div>
          <div class="genre-value">${val}</div>
        </li>
      `;
    });
  }
}

/* =========================================
   DETAIL MODAL LOGIC
   ========================================= */
const modal = document.getElementById('detail-modal');
const modalClose = document.querySelector('.modal-close');

modalClose.addEventListener('click', () => {
  modal.classList.remove('active');
});

// Stepper local state for modal
let tempProgress = 0;

async function openSearchDetail(basicItem) {
  currentSelectedItem = basicItem;
  const existing = library.find(i => i.id === basicItem.id && i.type === basicItem.type);
  if (existing) {
    currentSelectedItem = existing; 
  }
  tempProgress = currentSelectedItem.progress || 0;
  
  populateModalData(currentSelectedItem, existing !== undefined);
  modal.classList.add('active');

  // Load Extra Details & Providers dynamically
  await loadExtraDetails(currentSelectedItem, existing !== undefined);
}

function formatRuntime(item) {
  if (item.type === 'movie') {
    if (!item.duration) return '';
    const h = Math.floor(item.duration / 60);
    const m = item.duration % 60;
    if (h > 0) return `${h} hrs e ${m} min`;
    return `${m} min`;
  } else {
    const eps = item.totalUnits ? item.totalUnits : '?';
    const mins = item.duration ? `${item.duration} min/ep` : '';
    if (eps === '?' && !mins) return 'Série/Anime';
    return `${eps} Episódios${mins ? ' • ' + mins : ''}`;
  }
}

function calculateCuriosity(item) {
  if (item.type !== 'movie' && item.totalUnits && item.duration) {
    const totalMins = item.totalUnits * item.duration;
    if (totalMins > 0) {
      const h = Math.floor(totalMins / 60);
      const m = totalMins % 60;
      const timeStr = h > 0 ? `${h} hrs${m > 0 ? ` e ${m} min` : ''}` : `${m} min`;
      return `🕒 Tempo total para maratona: ${timeStr}`;
    }
  }
  return '';
}

function getProgressInputHtml(item) {
  if (item.type === 'movie') {
     return `
       <select id="modal-movie-progress" class="custom-select">
         <option value="0" ${tempProgress===0?'selected':''}>0 (Não assistido)</option>
         <option value="1" ${tempProgress===1?'selected':''}>1 (Assistido)</option>
       </select>
     `;
  }
  // Stepper for Series / Anime
  return `
    <div class="progress-stepper">
      <button class="stepper-btn" id="stepper-minus"><i class="bi bi-dash"></i></button>
      <div class="stepper-value-container">
        <span id="stepper-value">${tempProgress}</span>
        ${item.totalUnits ? `<span class="stepper-max">/ ${item.totalUnits}</span>` : ''}
      </div>
      <button class="stepper-btn" id="stepper-plus"><i class="bi bi-plus"></i></button>
    </div>
  `;
}

function bindStepperListeners() {
  const btnMinus = document.getElementById('stepper-minus');
  const btnPlus = document.getElementById('stepper-plus');
  const txtValue = document.getElementById('stepper-value');
  
  if(btnMinus && btnPlus) {
    btnMinus.addEventListener('click', () => {
      if(tempProgress > 0) tempProgress--;
      txtValue.textContent = tempProgress;
    });
    btnPlus.addEventListener('click', () => {
      tempProgress++;
      txtValue.textContent = tempProgress;
    });
  }
}

function populateModalData(item, inLibrary) {
  const typeBadgeEl = document.getElementById('detail-type-badge');
  const titleEl = document.getElementById('detail-title');
  const metaEl = document.getElementById('detail-meta');
  const runtimeEl = document.getElementById('detail-runtime');
  const curiosityEl = document.getElementById('detail-curiosity');
  const descEl = document.getElementById('detail-desc');
  const imageEl = document.getElementById('detail-image');
  const actionBlock = document.getElementById('detail-action-block');
  const providersContainer = document.getElementById('detail-providers');
  
  providersContainer.classList.add('hidden'); // Oculta até buscar novos

  const typeLabel = T.types[item.type];
  
  typeBadgeEl.textContent = typeLabel.toUpperCase();
  titleEl.textContent = item.title;
  metaEl.textContent = `${item.year || 'Sem data'} • ${item.voteAverage ? '⭐ '+item.voteAverage : ''}`;
  runtimeEl.textContent = formatRuntime(item);
  curiosityEl.textContent = calculateCuriosity(item);
  if (item.type === 'anime' && item.description) {
    descEl.innerHTML = `<span style="opacity:0.6;font-style:italic;font-size:0.85em;display:block;margin-bottom:10px;">(Sinopse fornecida em Inglês pelo banco de dados AniList)</span>` + item.description;
  } else {
    descEl.textContent = item.description || 'Nenhuma sinopse disponível.';
  }
  imageEl.style.backgroundImage = `url('${item.banner || item.poster}')`;

  if (inLibrary) {
    actionBlock.innerHTML = `
      <div class="form-group">
        <label>Status</label>
        <select id="modal-status" class="custom-select">
          <option value="watching" ${item.status==='watching'?'selected':''}>Assistindo</option>
          <option value="completed" ${item.status==='completed'?'selected':''}>Concluído</option>
          <option value="plan" ${item.status==='plan'?'selected':''}>Pretendido</option>
          <option value="dropped" ${item.status==='dropped'?'selected':''}>Abandonado</option>
        </select>
      </div>
      <div class="form-group">
        <label>${item.type==='movie'?'Foi assistido?':'Andamento (Eps)'}</label>
        ${getProgressInputHtml(item)}
      </div>
      <div class="form-group">
        <label>Minha Nota (1-10)</label>
        <input type="number" id="modal-rating" value="${item.rating || ''}" min="1" max="10">
      </div>
      <div class="form-group">
        <label>Reflexão / Anotações</label>
        <textarea id="modal-review" placeholder="Como esta arte fez você se sentir?">${item.review || ''}</textarea>
      </div>
      <button class="primary-btn" id="modal-save">Atualizar Registro</button>
      <button class="primary-btn danger" id="modal-remove">Remover da Estante</button>
    `;

    bindStepperListeners();

    document.getElementById('modal-save').addEventListener('click', () => updateLibraryItem(item));
    document.getElementById('modal-remove').addEventListener('click', () => removeFromLibrary(item));

  } else {
    actionBlock.innerHTML = `
      <button class="primary-btn" id="modal-add"><i class="bi bi-plus-lg"></i> Adicionar à Coleção</button>
    `;
    document.getElementById('modal-add').addEventListener('click', () => addToLibrary(item));
  }
}

function addToLibrary(item) {
  const newItem = {
    ...item,
    status: 'watching', 
    progress: 0,
    rating: null,
    review: '',
    dateAdded: new Date().toISOString(),
    duration: item.type === 'movie' ? 120 : 24
  };
  library.push(newItem);
  saveLibrary();
  tempProgress = 0;
  populateModalData(newItem, true);
  renderHome();
}

function updateLibraryItem(item) {
  const i = library.findIndex(el => el.id === item.id && el.type === item.type);
  if (i > -1) {
    library[i].status = document.getElementById('modal-status').value;
    
    if (item.type === 'movie') {
      tempProgress = parseInt(document.getElementById('modal-movie-progress').value, 10);
    }
    // Para series/anime o tempProgress já é atualizado pelos botões +/-
    library[i].progress = tempProgress;
    
    // Se marcou completo "na mão", ou chegou no final
    if (library[i].totalUnits && library[i].progress >= library[i].totalUnits) {
       library[i].status = 'completed';
    }

    const rateVal = parseInt(document.getElementById('modal-rating').value, 10);
    library[i].rating = isNaN(rateVal) ? null : rateVal;
    library[i].review = document.getElementById('modal-review').value;
    
    saveLibrary();
    modal.classList.remove('active');
    renderHome();
    if(document.getElementById('view-library').classList.contains('active')) renderLibrary();
    if(document.getElementById('view-stats').classList.contains('active')) renderStats();
  }
}

function removeFromLibrary(item) {
  library = library.filter(el => !(el.id === item.id && el.type === item.type));
  saveLibrary();
  modal.classList.remove('active');
  renderHome();
  if(document.getElementById('view-library').classList.contains('active')) renderLibrary();
  if(document.getElementById('view-stats').classList.contains('active')) renderStats();
}

/* =========================================
   API FETCHERS (WITH PROVIDERS)
   ========================================= */

// Providers and Metadata loader logic
async function loadExtraDetails(item, inLibrary) {
  const pContainer = document.getElementById('detail-providers');
  const pList = document.getElementById('provider-list-container');
  pList.innerHTML = '';
  
  let providers = [];
  try {
     if (item.type === 'anime') {
        providers = item.externalLinks || [];
     } else {
        if(TMDB_API_KEY !== "YOUR_TMDB_API_KEY_HERE") {
           // Fetch deeper TMDb details along with stream providers (append_to_response)
           const res = await fetch(`${TMDB_BASE_URL}/${item.type}/${item.id}?api_key=${TMDB_API_KEY}&append_to_response=watch/providers&language=pt-BR`);
           const json = await res.json();
           
           if (item.type === 'movie') {
               item.duration = json.runtime;
           } else {
               item.totalUnits = json.number_of_episodes;
               if (json.episode_run_time && json.episode_run_time.length > 0) {
                   item.duration = json.episode_run_time[0];
               }
           }
           
           // Update runtime text directly
           document.getElementById('detail-runtime').textContent = formatRuntime(item);
           document.getElementById('detail-curiosity').textContent = calculateCuriosity(item);
           
           // If the item is in the library and progress stepper needs update (totalUnits might have changed from ? to a number)
           if (inLibrary && item.type !== 'movie') {
               const stepperMax = document.querySelector('.stepper-max');
               if (stepperMax) stepperMax.textContent = item.totalUnits ? `/ ${item.totalUnits}` : '';
               else if (item.totalUnits) { // Create span if it didn't exist
                  const sVal = document.getElementById('stepper-value');
                  if (sVal) sVal.insertAdjacentHTML('afterend', `<span class="stepper-max">/ ${item.totalUnits}</span>`);
               }
           }

           if(json['watch/providers'] && json['watch/providers'].results && json['watch/providers'].results.BR && json['watch/providers'].results.BR.flatrate) {
              const deduplicatedProviders = new Map();
              
              json['watch/providers'].results.BR.flatrate.forEach(p => {
                 let name = p.provider_name;
                 if (name.includes('Netflix')) name = 'Netflix';
                 else if (name.includes('Paramount')) name = 'Paramount+';
                 else if (name.includes('Amazon') || name.includes('Prime Video')) name = 'Prime Video';
                 else if (name.includes('Crunchyroll')) name = 'Crunchyroll';
                 else if (name.includes('Disney')) name = 'Disney+';
                 else if (name.includes('Max')) name = 'Max';
                 else if (name.includes('Apple TV')) name = 'Apple TV+';
                 else if (name.includes('Claro tv')) name = 'Claro tv+';
                 else if (name.includes('Globoplay')) name = 'Globoplay';
                 
                 if (!deduplicatedProviders.has(name)) {
                     deduplicatedProviders.set(name, {
                         url: '#',
                         icon: `https://image.tmdb.org/t/p/w200${p.logo_path}`,
                         site: name
                     });
                 }
              });
              
              providers = Array.from(deduplicatedProviders.values());
           }
        } else {
           // Mock
           providers = [{ site: "Netflix", icon: "https://upload.wikimedia.org/wikipedia/commons/0/08/Netflix_2015_logo.svg", url: "#" }];
        }
     }
  } catch(e) {
     console.error("Provider load failed", e);
  }

  pContainer.classList.remove('hidden');
  if (providers.length > 0) {
     providers.forEach(p => {
       const iconImg = p.icon ? `<img src="${p.icon}">` : `<i class="bi bi-box-arrow-up-right"></i>`;
       pList.innerHTML += `
         <a href="${p.url}" target="_blank" class="provider-tag">
           ${iconImg} ${p.site}
         </a>
       `;
     });
  } else {
     pList.innerHTML = `<span style="font-size: 0.9rem; opacity: 0.6;">Nenhum streaming oficial localizado (Brasil).</span>`;
  }
}

// AniList (GraphQL) fetch
async function fetchAniListSearch(query) {
  const gql = `
  query ($search: String) {
    Page(page: 1, perPage: 15) {
      media(search: $search, type: ANIME, sort: POPULARITY_DESC) {
        id title { romaji english }
        coverImage { large }
        startDate { year }
        averageScore description episodes duration genres bannerImage
        externalLinks { site url icon }
      }
    }
  }`;

  const response = await fetch(ANILIST_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query: gql, variables: { search: query } })
  });
  
  const json = await response.json();
  const list = json.data.Page.media || [];
  
  return list.map(item => ({
    id: item.id.toString(), type: 'anime',
    title: item.title.english || item.title.romaji,
    poster: item.coverImage.large,
    banner: item.bannerImage || item.coverImage.large,
    year: item.startDate.year,
    voteAverage: item.averageScore ? (item.averageScore / 10).toFixed(1) : null,
    description: item.description ? item.description.replace(/<[^>]*>?/gm, '') : '',
    totalUnits: item.episodes, duration: item.duration, genres: item.genres,
    externalLinks: (item.externalLinks||[]).filter(l => ['Crunchyroll', 'Netflix', 'Amazon Prime Video'].includes(l.site))
  }));
}

// Just to populate Home screen when it's empty
async function fetchAniListTrending() {
  const gql = `
  query {
    Page(page: 1, perPage: 6) {
      media(type: ANIME, sort: TRENDING_DESC) {
        id title { romaji english }
        coverImage { large }
        startDate { year } averageScore description episodes duration genres bannerImage
        externalLinks { site url icon }
      }
    }
  }`;
  const response = await fetch(ANILIST_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query: gql })
  });
  const json = await response.json();
  return (json.data.Page.media || []).map(item => ({
    id: item.id.toString(), type: 'anime',
    title: item.title.english || item.title.romaji, poster: item.coverImage.large, banner: item.bannerImage || item.coverImage.large,
    year: item.startDate.year, voteAverage: item.averageScore ? (item.averageScore / 10).toFixed(1) : null,
    description: item.description ? item.description.replace(/<[^>]*>?/gm, '') : '',
    totalUnits: item.episodes, duration: item.duration, genres: item.genres,
    externalLinks: (item.externalLinks||[]).filter(l => ['Crunchyroll', 'Netflix', 'Amazon Prime Video'].includes(l.site))
  }));
}

// TMDb (REST) fetch
async function fetchTMDbSearch(query, type) {
  if (TMDB_API_KEY === "YOUR_TMDB_API_KEY_HERE") {
    return Array.from({length: 4}).map((_, i) => ({
      id: `mockt-${i}`, type: type, title: `Mock ${type.toUpperCase()} Result ${i+1}`,
      poster: `https://via.placeholder.com/300x450/161514/404040?text=Mock+${type}+${i+1}`,
      year: 2024, voteAverage: "8.5", description: 'Chave de API não informada. Resultado demonstração sem link real de Streaming.',
      genres: ['Sci-Fi', 'Drama']
    }));
  }

  // Use pt-BR language param for translated descriptions
  const url = `${TMDB_BASE_URL}/search/${type}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}&page=1&language=pt-BR`;
  const res = await fetch(url);
  const data = await res.json();
  
  let validResults = data.results || [];
  // Exclude animes from TV series search properly
  if (type === 'tv') {
    validResults = validResults.filter(item => {
      const isAnime = (item.genre_ids && item.genre_ids.includes(16)) && item.original_language === 'ja';
      return !isAnime;
    });
  }

  return validResults.slice(0, 15).map(item => ({
    id: item.id.toString(), type: type, title: item.title || item.name,
    poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
    banner: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : null,
    year: (item.release_date || item.first_air_date || '').split('-')[0],
    voteAverage: item.vote_average ? item.vote_average.toFixed(1) : null,
    genres: (item.genre_ids || []).map(id => TMDB_GENRES[id]).filter(Boolean),
    description: item.overview, totalUnits: type === 'movie' ? 1 : null, // Not fetching episodes count here to prevent overload API requests
  }));
}

document.addEventListener('DOMContentLoaded', () => {
  renderHome();

  // Firebase Auth Observer
  if (auth) {
    auth.onAuthStateChanged(user => {
      if (user) {
        currentUser = user;
        updateSettingsUI(true, user);
        syncFromCloud();
      } else {
        currentUser = null;
        updateSettingsUI(false);
      }
    });
  }

  // Settings modal
  const settingsModal = document.getElementById('settings-modal');
  const settingsBtn = document.getElementById('header-settings-btn');
  const settingsClose = document.getElementById('settings-close');
  const settingsBackdrop = document.getElementById('settings-modal-backdrop');

  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      settingsModal.classList.add('active');
    });
  }
  if (settingsClose) {
    settingsClose.addEventListener('click', () => {
      settingsModal.classList.remove('active');
    });
  }
  if (settingsBackdrop) {
    settingsBackdrop.addEventListener('click', () => {
      settingsModal.classList.remove('active');
    });
  }

  // Filter modal
  filterModal = document.getElementById('filter-modal');
  const filterBtn = document.getElementById('btn-open-filter-modal');
  const filterClose = document.getElementById('filter-close');
  const filterBackdrop = document.getElementById('filter-modal-backdrop');

  if (filterBtn) {
    filterBtn.addEventListener('click', () => {
      currentIsCatalogFilter = false;
      tempSelectedGenre = activeSearchGenre;
      document.getElementById('sort-section').classList.add('hidden');
      document.getElementById('filter-modal-title').textContent = 'Busca';
      populateFilterModal();
      filterModal.classList.add('active');
    });
  }
  if (filterClose) {
    filterClose.addEventListener('click', () => {
      filterModal.classList.remove('active');
    });
  }
  if (filterBackdrop) {
    filterBackdrop.addEventListener('click', () => {
      filterModal.classList.remove('active');
    });
  }

  // Login / Logout buttons
  document.getElementById('btn-login-google')?.addEventListener('click', handleGoogleLogin);
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await handleLogout();
    settingsModal.classList.remove('active');
  });
});
