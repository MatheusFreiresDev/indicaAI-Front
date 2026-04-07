/* ==============================
   INDICAAI — APP LOGIC
   app.js
============================== */

const API = 'http://localhost:8080';

let token = localStorage.getItem('iai_tk') || '';
let me = {};
let listData = [], curFilter = 'ALL';
let rUM = null, rID = null;         // review modal: userMovieId, reviewId
let rMovieTitle = '';               // review modal: title display

const STATUS_LABEL = {
  ASSISTIDO: '✅ Assistido',
  QUERO_VER: '🎬 Quero Ver',
  ASSISTINDO: '▶ Assistindo',
  ABANDONEI:  '✕ Abandonei',
};

// ==============================
// INIT
// ==============================
window.onload = async () => {
  if (token) {
    try { me = JSON.parse(atob(token.split('.')[1])); } catch { me = {}; }
    await fetchMeNickname();
    showApp();
    loadFeed();
  }
};

// ==============================
// AUTH
// ==============================
function authTab(t, btn) {
  document.querySelectorAll('.atab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('f-login').style.display = t === 'login' ? 'flex' : 'none';
  document.getElementById('f-reg').style.display   = t === 'reg'   ? 'flex' : 'none';
}

async function fetchMeNickname() {
  if (!token) return;
  try {
    // Pega perfil do próprio usuário via endpoint público /users/{username}/profile
    const payload = JSON.parse(atob(token.split('.')[1]));
    const username = payload.username || payload.sub; // se não tiver username, usa sub
    if (!username) throw new Error('Username não encontrado no token');

    const profile = await aGet(`/users/me/profile`);

    // Salva no objeto me
    me = {
      id: profile.id || me.id,
      nickname: profile.username,
      totalWatched: profile.totalWatched,
      averageRating: profile.averageRating
    };

  } catch (e) {
    console.warn('Não foi possível carregar perfil:', e);
    me.nickname = me.sub || '?';
  }
}
async function doLogin() {
  const email    = V('l-email');
  const password = V('l-pass');
  if (!email || !password) return showErr('l-err', 'Preencha todos os campos');
  try {
    const r = await post('/auth/login', { email, password });
    token = r.token;
    localStorage.setItem('iai_tk', token);
    try { me = JSON.parse(atob(token.split('.')[1])); } catch { me = { sub: email }; }
    await fetchMeNickname();
    showApp();
    loadFeed();
  } catch (e) {
    showErr('l-err', e.message || 'Email ou senha incorretos');
  }
}

async function doReg() {
  const username = V('r-user');
  const email    = V('r-email');
  const password = V('r-pass');
  if (!username || !email || !password) return showErr('r-err', 'Preencha todos os campos');
  try {
    await post('/auth/cadastro', { username, email, password });
    toast('Conta criada! Faça login 🎉', 'ok');
    authTab('login', document.querySelectorAll('.atab')[0]);
  } catch (e) {
    showErr('r-err', e.message || 'Erro ao cadastrar');
  }
}

function logout() {
  token = '';
  localStorage.removeItem('iai_tk');
  document.getElementById('auth-page').classList.add('active');
  document.getElementById('app-page').classList.remove('active');
}

function showApp() {
  document.getElementById('auth-page').classList.remove('active');
  document.getElementById('app-page').classList.add('active');
  const name = me.nickname || me.sub || '?';
  updateSidebarName(name); // Usa a função atualizada
}



// ==============================
// NAVIGATION
// ==============================
function goTo(sec, btn) {
  document.querySelectorAll('.sb-item').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('s-' + sec).classList.add('active');

  if (sec === 'feed')    loadFeed();
  if (sec === 'list')    loadList();
  if (sec === 'reviews') loadReviews();
  if (sec === 'profile') loadProfile();
}

// ==============================
// FEED (homepage)
// ==============================
async function loadFeed() {
  const el = document.getElementById('r-feed');
  el.innerHTML = loadHTML('Carregando feed...');
  try {
    const reviews = await aGet('/reviews/all');
    if (!reviews || !reviews.length) {
      el.innerHTML = emptyHTML('🎬', 'Nenhuma review ainda. Seja o primeiro!');
      return;
    }

    // Enrich reviews with movie data
    const enriched = await Promise.all(reviews.map(async r => {
      try {
        const movie = await aGet(`/movies/${r.movieId}`);
        return { ...r, movie };
      } catch {
        return { ...r, movie: null };
      }
    }));

    el.innerHTML = `<div class="feed-grid">${enriched.map(feedCard).join('')}</div>`;
  } catch (e) {
    el.innerHTML = emptyHTML('❌', e.message || 'Erro ao carregar feed');
  }
}

function feedCard(r) {
  const m = r.movie;
  const posterUrl = m?.poster_path ? `https://image.tmdb.org/t/p/w300${m.poster_path}` : null;
  const bannerUrl = m?.backdrop_path ? `https://image.tmdb.org/t/p/w780${m.backdrop_path}` : null;
  const username = r.username || 'usuário';
  const initial  = username[0].toUpperCase();
  const title    = m?.title || `Filme #${r.movieId}`;

  const posterImg = posterUrl
    ? `<img src="${posterUrl}" alt="" loading="lazy">`
    : `<div class="fc-poster-ph">🎬</div>`;

  return `<div class="feed-card">
    <div class="fc-header">
      <div class="fc-av">${initial}</div>
      <div>
        <div class="fc-username" onclick="openPubModalByUsername('${esc(username)}')">${esc(username)}</div>
      </div>
      <div class="fc-nota">⭐ ${r.nota}/10</div>
    </div>
    <div class="fc-body">
      <div class="fc-poster">${posterImg}</div>
      <div class="fc-info">
        <div class="fc-movie-title">${esc(title)}</div>
        ${r.descricao
          ? `<div class="fc-desc">"${esc(r.descricao)}"</div>`
          : `<div class="fc-no-desc">Sem texto de review</div>`
        }
      </div>
    </div>
  </div>`;
}

// ==============================
// USER SEARCH (feed bar)
// ==============================
let userSearchTimeout = null;

async function searchUser(val) {
  const res = document.getElementById('user-search-results');
  clearTimeout(userSearchTimeout);

  if (!val || val.trim().length < 2) {
    res.classList.remove('open');
    return;
  }

  userSearchTimeout = setTimeout(async () => {
    try {
      // Try fetching profile directly by username
      const profile = await aGet(`/users/${encodeURIComponent(val.trim())}/profile`);
      if (profile && profile.username) {
        res.innerHTML = `
          <div class="user-result-item" onclick="openPubModalByUsername('${esc(profile.username)}');document.getElementById('feed-search-input').value='';document.getElementById('user-search-results').classList.remove('open')">
            <div class="user-result-av">${profile.username[0].toUpperCase()}</div>
            <div>
              <div class="user-result-name">${esc(profile.username)}</div>
              <div class="user-result-sub">${profile.totalWatched || 0} filmes assistidos</div>
            </div>
          </div>`;
        res.classList.add('open');
      } else {
        res.innerHTML = `<div class="user-result-item"><div class="user-result-sub">Usuário não encontrado</div></div>`;
        res.classList.add('open');
      }
    } catch {
      res.innerHTML = `<div class="user-result-item"><div class="user-result-sub">Usuário não encontrado</div></div>`;
      res.classList.add('open');
    }
  }, 350);
}

// Close user search on outside click
document.addEventListener('click', e => {
  const wrap = document.getElementById('user-search-results');
  if (wrap && !wrap.contains(e.target) && !e.target.closest('.feed-search-box')) {
    wrap.classList.remove('open');
  }
});

// ==============================
// PUBLIC PROFILE MODAL
// ==============================
async function openPubModalByUsername(username) {
  const ov   = document.getElementById('pub-modal-ov');
  const body = document.getElementById('pub-modal-body');
  ov.classList.add('open');
  body.innerHTML = loadHTML('Carregando perfil...');

  try {
    const [prof, reviews] = await Promise.all([
      aGet(`/users/${encodeURIComponent(username)}/profile`),
      aGet(`/users/${encodeURIComponent(username)}/reviews`),
    ]);

    // Enrich reviews with movie data
    const enriched = await Promise.all((reviews || []).map(async r => {
      try { return { ...r, movie: await aGet(`/movies/${r.movieId}`) }; }
      catch { return { ...r, movie: null }; }
    }));

    body.innerHTML = buildPubProfile(prof, enriched);
  } catch (e) {
    body.innerHTML = emptyHTML('❌', 'Erro: ' + (e.message || 'Perfil não encontrado'));
  }
}

function buildPubProfile(prof, reviews) {
  return `
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;padding-bottom:1.5rem;border-bottom:1px solid var(--border);padding-right:2.5rem">
      <div class="prof-av">${prof.username[0].toUpperCase()}</div>
      <div>
        <div class="prof-name">${esc(prof.username)}</div>
        <div class="prof-tag">Perfil público · indicaAI</div>
      </div>
    </div>
    <div class="stats-grid" style="margin-bottom:1.5rem">
      <div class="stat-card"><div class="stat-val sv-r">${prof.totalWatched || 0}</div><div class="stat-label">Assistidos</div></div>
      <div class="stat-card"><div class="stat-val sv-a">${prof.averageRating ? prof.averageRating.toFixed(1) : '—'}</div><div class="stat-label">Nota Média</div></div>
      <div class="stat-card"><div class="stat-val sv-t">${reviews.length}</div><div class="stat-label">Reviews</div></div>
    </div>
    ${reviews.length ? `
      <div style="font-family:'Syne',sans-serif;font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;color:var(--text2);margin-bottom:1rem">Reviews</div>
      <div class="reviews-grid">${reviews.map(r => buildReviewCard(r, false)).join('')}</div>
    ` : ''}
  `;
}

function closePubModal(e, force) {
  if (force || e?.target === document.getElementById('pub-modal-ov')) {
    document.getElementById('pub-modal-ov').classList.remove('open');
  }
}

// ==============================
// SEARCH (movies)
// ==============================
async function doSearch() {
  const q = V('q');
  if (!q) return;
  const el = document.getElementById('r-search');
  el.innerHTML = loadHTML('Buscando filmes...');
  try {
    const data = await aGet('/movies/search?query=' + encodeURIComponent(q));
    if (!data || !data.length) {
      el.innerHTML = emptyHTML('🎬', `Nenhum filme encontrado para "${q}"`);
      return;
    }
    el.innerHTML = `<div class="movie-grid">${data.map(movieCard).join('')}</div>`;
  } catch (e) {
    el.innerHTML = emptyHTML('❌', e.message || 'Erro na busca');
  }
}

function movieCard(m) {
  const tid  = m.tmdbId;
  const md   = JSON.stringify(m).replace(/"/g, '&quot;');
  const img  = m.poster_path
    ? `<img src="https://image.tmdb.org/t/p/w300${m.poster_path}" loading="lazy" alt="">`
    : `<div class="mcard-no-img">🎬</div>`;

  return `<div class="mcard" onclick='openDM(${md})'>
    <div class="mcard-poster">
      ${img}
      <div class="mcard-overlay">
        <div class="ov-film">${esc(m.title)}</div>
        <div class="ov-btns">
          <button class="ovbtn" onclick="event.stopPropagation();addList(${tid},'QUERO_VER')">🎬 Quero Ver</button>
          <button class="ovbtn" onclick="event.stopPropagation();addList(${tid},'ASSISTINDO')">▶ Assistindo</button>
          <button class="ovbtn" onclick="event.stopPropagation();addList(${tid},'ASSISTIDO')">✅ Já Assisti</button>
          <button class="ovbtn" onclick="event.stopPropagation();addList(${tid},'ABANDONEI')">✕ Abandonei</button>
        </div>
      </div>
    </div>
    <div class="mcard-info">
      <div class="mcard-title">${esc(m.title)}</div>
      ${m.release_date ? `<div class="mcard-year">${m.release_date.slice(0, 4)}</div>` : ''}
    </div>
  </div>`;
}

// Movie detail modal
function openDM(m) {
  if (typeof m === 'string') m = JSON.parse(m);
  window._dmId    = m.tmdbId;
  window._dmTitle = m.title;

  document.getElementById('dm-poster').innerHTML = m.poster_path
    ? `<img src="https://image.tmdb.org/t/p/w400${m.poster_path}" alt="">`
    : `<div class="mm-poster-ph">🎬</div>`;

  document.getElementById('dm-title').textContent    = m.title;
  document.getElementById('dm-meta').textContent     = m.release_date ? '📅 ' + m.release_date.slice(0, 4) : '';
  document.getElementById('dm-overview').textContent = m.overview || 'Sem descrição disponível.';
  document.getElementById('detail-ov').classList.add('open');
}

function closeDM(e, force) {
  if (force || e?.target === document.getElementById('detail-ov'))
    document.getElementById('detail-ov').classList.remove('open');
}

async function addListFromModal(status) {
  if (!window._dmId) return toast('Filme sem ID válido', 'fail');
  await addList(window._dmId, status);
}

async function addList(tmdbId, status) {
  if (!tmdbId || tmdbId <= 0) return toast('ID inválido', 'fail');
  try {
    await aPost('/user-movies', { tmdbId, status });
    toast(`Adicionado: ${STATUS_LABEL[status]}`, 'ok');
    document.getElementById('detail-ov').classList.remove('open');
  } catch (e) {
    toast(e.message || 'Erro ao adicionar', 'fail');
  }
}

// ==============================
// MY LIST
// ==============================
async function loadList() {
  const el = document.getElementById('r-list');
  el.innerHTML = loadHTML('Carregando sua lista...');
  try {
    listData = await aGet('/user-movies/me');
    renderList();
  } catch (e) {
    el.innerHTML = emptyHTML('❌', e.message);
  }
}

function renderList() {
  const el = document.getElementById('r-list');
  const data = curFilter === 'ALL' ? listData : listData.filter(i => i.status === curFilter);
  if (!data.length) {
    el.innerHTML = emptyHTML('🎬', 'Nenhum filme aqui. Busque e adicione filmes!');
    return;
  }
  el.innerHTML = `<div class="list-grid">${data.map(listCard).join('')}</div>`;
}

function listCard(i) {
  const img = i.posterPath
    ? `<img src="https://image.tmdb.org/t/p/w92${i.posterPath}" alt="">`
    : '🎬';

  return `<div class="lcard">
    <div class="lcard-poster">${img}</div>
    <div class="lcard-info">
      <div class="lcard-title">${esc(i.movieTitle || 'Filme')}</div>
      <div class="status-badge s-${i.status}">${STATUS_LABEL[i.status] || i.status}</div>
      <div class="lcard-actions">
        <select class="status-sel" onchange="updStatus(${i.id},this.value)">
          <option value="QUERO_VER"  ${i.status === 'QUERO_VER'  ? 'selected' : ''}>🎬 Quero Ver</option>
          <option value="ASSISTINDO" ${i.status === 'ASSISTINDO' ? 'selected' : ''}>▶ Assistindo</option>
          <option value="ASSISTIDO"  ${i.status === 'ASSISTIDO'  ? 'selected' : ''}>✅ Assistido</option>
          <option value="ABANDONEI"  ${i.status === 'ABANDONEI'  ? 'selected' : ''}>✕ Abandonei</option>
        </select>
        ${i.status === 'ASSISTIDO'
          ? `<button class="btn-review-sm" onclick="openRM(${i.id},'${esc(i.movieTitle || '')}')">✍️ Review</button>`
          : ''}
        <button class="btn-del-sm" onclick="delList(${i.id})">🗑</button>
      </div>
    </div>
  </div>`;
}

function filt(s, btn) {
  curFilter = s;
  document.querySelectorAll('.fchip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderList();
}

async function updStatus(id, status) {
  try {
    await aPatch(`/user-movies/${id}`, { status });
    toast('Status atualizado!', 'ok');
    loadList();
  } catch (e) {
    toast(e.message || 'Erro', 'fail');
  }
}

async function delList(id) {
  try {
    await aDel(`/user-movies/${id}`);
    toast('Removido!', 'ok');
    loadList();
  } catch (e) {
    toast(e.message || 'Erro', 'fail');
  }
}
// ==============================
// REVIEWS
// ==============================
async function loadReviews() {
  const el = document.getElementById('r-reviews');
  el.innerHTML = loadHTML('Carregando reviews...');
  try {
    const reviews = await aGet('/reviews/me'); // espera ReviewResponse[]
    if (!reviews.length) {
      el.innerHTML = emptyHTML('⭐', 'Nenhuma review ainda. Marque filmes como assistidos e escreva sua opinião!');
      return;
    }

    // Enrich with movie data
    const enriched = await Promise.all(reviews.map(async r => {
      try { 
        const movie = await aGet(`/movies/${r.movieId}`); // garante que movieId existe
        return { ...r, movie }; 
      } catch { 
        return { ...r, movie: null }; 
      }
    }));

    el.innerHTML = `<div class="reviews-grid">${enriched.map(r => buildReviewCard(r, true)).join('')}</div>`;
  } catch (e) {
    el.innerHTML = emptyHTML('❌', e.message);
  }
}

function buildReviewCard(r, editable) {
  const m = r.movie;
  const title    = m?.title || `Filme #${r.movieId}`;
  const poster   = m?.poster_path   ? `https://image.tmdb.org/t/p/w92${m.poster_path}`     : null;
  const backdrop = m?.backdrop_path ? `https://image.tmdb.org/t/p/w780${m.backdrop_path}`  : null;
  const desc     = (r.descricao || '').replace(/'/g, "\\'");

  const bannerInner = backdrop
    ? `<img src="${backdrop}" alt="" loading="lazy">`
    : `<div class="rcard-banner-ph">🎬</div>`;

  const thumbInner = poster
    ? `<img src="${poster}" alt="">`
    : `<div class="rcard-thumb-ph">🎬</div>`;

  return `<div class="rcard">
    <div class="rcard-banner">
      ${bannerInner}
      <div class="rcard-nota-overlay">⭐ ${r.nota}/10</div>
    </div>
    <div class="rcard-body">
      <div class="rcard-top">
        <div class="rcard-thumb">${thumbInner}</div>
        <div class="rcard-meta">
          <div class="rcard-movie-title">${esc(title)}</div>
        </div>
      </div>
      ${r.descricao ? `<div class="rcard-desc">"${esc(r.descricao)}"</div>` : ''}
      ${editable ? `
        <div class="rcard-actions">
          <button class="btn-review-sm" onclick="openEditRM(${r.id},${r.nota},'${desc}','${esc(title)}')">✏️ Editar</button>
          <button class="btn-del-sm" onclick="delRev(${r.id})">🗑</button>
        </div>` : ''}
    </div>
  </div>`;
}

// Review modal
function openRM(umid, movieTitle) {
  rUM = umid; rID = null;
  rMovieTitle = movieTitle || '';
  document.getElementById('rev-ttl').textContent       = 'Nova Review';
  document.getElementById('rev-nota-range').value      = 7;
  document.getElementById('rev-nota-val').textContent  = '7';
  document.getElementById('rev-desc').value            = '';
  document.getElementById('rm-movie-info').textContent = rMovieTitle;
  document.getElementById('rev-ov').classList.add('open');
}

function openEditRM(id, nota, desc, movieTitle) {
  rID = id; rUM = null;
  rMovieTitle = movieTitle || '';
  document.getElementById('rev-ttl').textContent       = 'Editar Review';
  document.getElementById('rev-nota-range').value      = nota;
  document.getElementById('rev-nota-val').textContent  = nota;
  document.getElementById('rev-desc').value            = desc;
  document.getElementById('rm-movie-info').textContent = rMovieTitle;
  document.getElementById('rev-ov').classList.add('open');
}

function closeRM() {
  document.getElementById('rev-ov').classList.remove('open');
}

async function saveRev() {
  const nota      = parseInt(document.getElementById('rev-nota-range').value);
  const descricao = document.getElementById('rev-desc').value;
  if (isNaN(nota) || nota < 0 || nota > 10) return toast('Nota entre 0 e 10', 'fail');
  try {
    if (rID) await aPatch(`/reviews/${rID}`, { nota, descricao });
    else     await aPost(`/reviews/${rUM}`, { nota, descricao }); // envia para o endpoint /reviews/{userMovieId}
    closeRM();
    toast('Review salva! ⭐', 'ok');
    loadReviews();
  } catch (e) {
    toast(e.message || 'Erro', 'fail');
  }
}

async function delRev(id) {
  try {
    await aDel(`/reviews/${id}`);
    toast('Review removida!', 'ok');
    loadReviews();
  } catch (e) {
    toast(e.message || 'Erro', 'fail');
  }
}

// ==============================
// RECOMMENDATIONS
// ==============================
async function loadRecs() {
  const el = document.getElementById('r-recs');
  el.innerHTML = loadHTML('A IA está analisando seus filmes...');
  try {
    const data = await aGet('/recommendations/me');
    if (!data || !data.length) {
      el.innerHTML = emptyHTML('🤖', 'Sem recomendações. Assista e avalie mais filmes!');
      return;
    }
    el.innerHTML = `<div class="rec-list">${data.map(recCard).join('')}</div>`;
  } catch (e) {
    el.innerHTML = emptyHTML('❌', e.message || 'Erro ao carregar recomendações');
  }
}

function recCard(r) {
  const img = r.posterPath
    ? `<img src="https://image.tmdb.org/t/p/w154${r.posterPath}" alt="" loading="lazy">`
    : `<div class="rec-ph">🎬</div>`;

  return `<div class="reccard">
    <div class="rec-poster">${img}</div>
    <div class="rec-content">
      <div class="rec-ai-badge">✨ IA</div>
      <div class="rec-title">${esc(r.title || 'Filme')}</div>
      <div class="rec-reason">${esc(r.reason || '')}</div>
    </div>
  </div>`;
}

// ==============================
// PROFILE
// ==============================
async function loadProfile() {
  const el = document.getElementById('r-profile');
  el.innerHTML = loadHTML('Carregando perfil...');

  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const username = payload.username || payload.sub;
    if (!username) throw new Error('Username não encontrado no token');

    const profile = await aGet(`/users/me/profile`);

    // Se não tiver nickname, usa o username
    const displayName = profile.nickname || profile.username || '?';

    el.innerHTML = `
      <div class="profile-hero">
        <div class="prof-av">${displayName[0].toUpperCase()}</div>
        <div>
          <div class="prof-name">${esc(profile.username)}</div>
          <div class="prof-tag">Meu perfil · indicaAI</div>
        </div>
      </div>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-val sv-r">${profile.totalWatched || 0}</div><div class="stat-label">Assistidos</div></div>
        <div class="stat-card"><div class="stat-val sv-a">${profile.averageRating?.toFixed(1) || '—'}</div><div class="stat-label">Nota Média</div></div>
      </div>
    `;

    updateSidebarName(displayName);

  } catch (e) {
    console.error(e);
    el.innerHTML = `<div>Erro ao carregar perfil</div>`;
  }
}
// Função auxiliar para atualizar sidebar
function updateSidebarName(name) {
  const nick = me.nickname || name || '?';
  document.getElementById('sb-av').textContent = nick[0].toUpperCase();
  document.getElementById('sb-uname').textContent = nick;
}
// ==============================
// HTTP HELPERS
// ==============================
async function post(path, body) {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(text);
  try { return JSON.parse(text); } catch { return text; }
}

async function aGet(path) {
  const r = await fetch(API + path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(text);
  try { return JSON.parse(text); } catch { return text; }
}

async function aPost(path, body) {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(text);
  try { return JSON.parse(text); } catch { return text; }
}

async function aPatch(path, body) {
  const r = await fetch(API + path, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(text);
  try { return JSON.parse(text); } catch { return text; }
}

async function aDel(path) {
  const r = await fetch(API + path, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(await r.text());
}

// ==============================
// UI HELPERS
// ==============================
function V(id)  { return document.getElementById(id).value.trim(); }
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loadHTML(msg) {
  return `<div class="loading-state"><div class="spinner"></div><p>${msg}</p></div>`;
}

function emptyHTML(icon, msg) {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><p>${msg}</p></div>`;
}

function showErr(id, msg) {
  const el = document.getElementById(id);
  el.textContent   = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast ${type} show`;
  setTimeout(() => el.classList.remove('show'), 3000);
}