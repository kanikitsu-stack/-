const STORAGE_KEY = 'kpop-face-sort-production-v3-light-223';
const DATA_VERSION = 3;

const PHASES = {
  prelim: { label: 'PRELIMINARY', name: '予選', appearances: 2 },
  semi: { label: 'SEMIFINAL', name: '準決勝', appearances: 2 },
  final: { label: 'FINAL', name: '決勝', appearances: 3 }
};

const state = {
  dataVersion: DATA_VERSION,
  phase: 'prelim',
  phaseParticipants: [],
  groups: [],
  currentIndex: 0,
  stats: {},
  qualified: { semi: [], final: [] },
  completed: false,
  pendingTransition: null
};

const screens = {
  start: document.getElementById('start-screen'),
  sort: document.getElementById('sort-screen'),
  transition: document.getElementById('transition-screen'),
  result: document.getElementById('result-screen')
};

const els = {
  candidateGrid: document.getElementById('candidate-grid'),
  noneButton: document.getElementById('none-button'),
  startButton: document.getElementById('start-button'),
  resumeButton: document.getElementById('resume-button'),
  restartButton: document.getElementById('restart-button'),
  showAllButton: document.getElementById('show-all-button'),
  downloadButton: document.getElementById('download-button'),
  idolCount: document.getElementById('idol-count'),
  phaseLabel: document.getElementById('phase-label'),
  phaseDescription: document.getElementById('phase-description'),
  progressCurrent: document.getElementById('progress-current'),
  progressTotal: document.getElementById('progress-total'),
  progressFill: document.getElementById('progress-fill'),
  transitionEyebrow: document.getElementById('transition-eyebrow'),
  transitionTitle: document.getElementById('transition-title'),
  transitionCopy: document.getElementById('transition-copy'),
  transitionButton: document.getElementById('transition-button'),
  winnerProfile: document.getElementById('winner-profile'),
  top9: document.getElementById('top9-grid'),
  allRanking: document.getElementById('all-ranking'),
  resultCanvas: document.getElementById('result-canvas')
};

const idolMap = new Map(IDOLS.map(idol => [idol.id, idol]));
els.idolCount.textContent = `${IDOLS.length}人`;

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function roundDownTo4(n) {
  return Math.max(4, Math.floor(n / 4) * 4);
}

function nextPhaseCount(currentCount, phase) {
  if (phase === 'prelim') {
    if (currentCount <= 48) return roundDownTo4(Math.max(16, Math.ceil(currentCount * 0.5)));
    return 48;
  }
  if (phase === 'semi') return Math.min(16, roundDownTo4(currentCount));
  return currentCount;
}

function freshStats() {
  const stats = {};
  IDOLS.forEach(idol => {
    stats[idol.id] = {
      prelim: { appearances: 0, wins: 0, noPick: 0 },
      semi: { appearances: 0, wins: 0, noPick: 0 },
      final: { appearances: 0, wins: 0, noPick: 0 }
    };
  });
  return stats;
}

// 1ラウンドにつき全員を原則1回登場させる。
// 4で割り切れない場合だけ、その時点で追加登場回数が少ない人を補充する。
function buildBalancedGroups(participantIds, appearancesTarget) {
  const groups = [];
  const extraCounts = Object.fromEntries(participantIds.map(id => [id, 0]));
  let previousGroupKeys = new Set();

  for (let round = 0; round < appearancesTarget; round++) {
    let queue = shuffle(participantIds);
    const remainder = queue.length % 4;
    if (remainder !== 0) {
      const needed = 4 - remainder;
      const candidates = shuffle(participantIds)
        .sort((a, b) => extraCounts[a] - extraCounts[b]);
      const extras = [];
      for (const id of candidates) {
        if (!queue.slice(-remainder).includes(id) && !extras.includes(id)) {
          extras.push(id);
          extraCounts[id] += 1;
          if (extras.length === needed) break;
        }
      }
      queue = queue.concat(extras);
    }

    const roundGroups = [];
    for (let i = 0; i < queue.length; i += 4) {
      let group = queue.slice(i, i + 4);
      let key = [...group].sort().join('|');
      if (previousGroupKeys.has(key) && i + 4 < queue.length) {
        const swapIndex = i + 4;
        [group[3], queue[swapIndex]] = [queue[swapIndex], group[3]];
        queue[i + 3] = group[3];
        key = [...group].sort().join('|');
      }
      roundGroups.push(group);
    }
    previousGroupKeys = new Set(roundGroups.map(g => [...g].sort().join('|')));
    groups.push(...roundGroups);
  }

  return groups;
}

function startNew() {
  Object.assign(state, {
    dataVersion: DATA_VERSION,
    phase: 'prelim',
    phaseParticipants: IDOLS.map(i => i.id),
    groups: buildBalancedGroups(IDOLS.map(i => i.id), PHASES.prelim.appearances),
    currentIndex: 0,
    stats: freshStats(),
    qualified: { semi: [], final: [] },
    completed: false,
    pendingTransition: null
  });
  saveState();
  showScreen('sort');
  renderCurrentGroup();
}

function phaseRate(id, phase) {
  const s = state.stats[id]?.[phase] || { appearances: 0, wins: 0 };
  return s.appearances ? s.wins / s.appearances : 0;
}

function compareWithinPhase(aId, bId, phase) {
  const a = state.stats[aId]?.[phase] || { appearances: 0, wins: 0, noPick: 0 };
  const b = state.stats[bId]?.[phase] || { appearances: 0, wins: 0, noPick: 0 };
  const aRate = a.appearances ? a.wins / a.appearances : 0;
  const bRate = b.appearances ? b.wins / b.appearances : 0;
  if (bRate !== aRate) return bRate - aRate;
  if (b.wins !== a.wins) return b.wins - a.wins;
  if (a.noPick !== b.noPick) return a.noPick - b.noPick;
  return idolMap.get(aId).name.localeCompare(idolMap.get(bId).name, 'ja');
}

function phaseRanking(participants, phase) {
  return [...participants].sort((a, b) => compareWithinPhase(a, b, phase));
}

function finishPhase() {
  if (state.phase === 'final') {
    state.completed = true;
    state.pendingTransition = null;
    saveState();
    showResults();
    return;
  }

  const next = state.phase === 'prelim' ? 'semi' : 'final';
  const count = nextPhaseCount(state.phaseParticipants.length, state.phase);
  const qualifiers = phaseRanking(state.phaseParticipants, state.phase).slice(0, count);
  state.qualified[next] = qualifiers;
  state.pendingTransition = next;
  saveState();
  showTransition(next, qualifiers.length);
}

function beginPendingPhase() {
  const next = state.pendingTransition;
  if (!next) return;
  state.phase = next;
  state.phaseParticipants = [...state.qualified[next]];
  state.groups = buildBalancedGroups(state.phaseParticipants, PHASES[next].appearances);
  state.currentIndex = 0;
  state.pendingTransition = null;
  saveState();
  showScreen('sort');
  renderCurrentGroup();
}

function showTransition(next, count) {
  showScreen('transition');
  const isSemi = next === 'semi';
  els.transitionEyebrow.textContent = isSemi ? 'PRELIMINARY COMPLETE' : 'SEMIFINAL COMPLETE';
  els.transitionTitle.textContent = isSemi ? '準決勝へ' : '決勝へ';
  els.transitionCopy.textContent = isSemi
    ? `予選結果の上位${count}人が準決勝へ進みます。ここから組み合わせを変えて、さらに2回ずつ比較します。`
    : `準決勝結果の上位${count}人が決勝へ進みます。決勝では3回ずつ登場し、TOP9を決めます。`;
}

function renderCurrentGroup() {
  if (state.currentIndex >= state.groups.length) {
    finishPhase();
    return;
  }

  const phase = PHASES[state.phase];
  els.phaseLabel.textContent = `${phase.label} · ${phase.name}`;
  els.phaseDescription.textContent = `${state.phaseParticipants.length}人参加 / 1人あたり約${phase.appearances}回登場`;

  const ids = state.groups[state.currentIndex];
  els.candidateGrid.innerHTML = '';

  ids.map(id => idolMap.get(id)).filter(Boolean).forEach(idol => {
    const btn = document.createElement('button');
    btn.className = 'candidate-card';
    btn.type = 'button';
    btn.setAttribute('aria-label', `${idol.name}を選ぶ`);
    btn.innerHTML = `
      <div class="candidate-photo-wrap">
        <img class="candidate-photo" src="${idol.image}" alt="${idol.name}" loading="eager" />
      </div>
      <div class="candidate-info">
        <div class="candidate-name">${escapeHtml(idol.name)}</div>
        <div class="candidate-group">${escapeHtml(idol.group)}</div>
      </div>`;
    btn.addEventListener('click', () => choose(idol.id));
    els.candidateGrid.appendChild(btn);
  });

  updateProgress();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function choose(winnerId) {
  const ids = state.groups[state.currentIndex];
  const phase = state.phase;
  ids.forEach(id => {
    const s = state.stats[id][phase];
    s.appearances += 1;
    if (!winnerId) s.noPick += 1;
  });
  if (winnerId) state.stats[winnerId][phase].wins += 1;
  state.currentIndex += 1;
  saveState();
  renderCurrentGroup();
}

function updateProgress() {
  const total = state.groups.length || 1;
  const current = Math.min(state.currentIndex + 1, total);
  els.progressCurrent.textContent = current;
  els.progressTotal.textContent = total;
  els.progressFill.style.width = `${(state.currentIndex / total) * 100}%`;
}

function getFinalRankingIds() {
  const allIds = IDOLS.map(i => i.id);
  const finalIds = state.qualified.final || [];
  const semiIds = state.qualified.semi || [];
  const finalSet = new Set(finalIds);
  const semiSet = new Set(semiIds);

  const finalists = phaseRanking(finalIds, 'final');
  const semiEliminated = phaseRanking(semiIds.filter(id => !finalSet.has(id)), 'semi');
  const prelimEliminated = phaseRanking(allIds.filter(id => !semiSet.has(id)), 'prelim');
  return [...finalists, ...semiEliminated, ...prelimEliminated];
}

function statsLabel(id) {
  const reachedFinal = (state.qualified.final || []).includes(id);
  const reachedSemi = (state.qualified.semi || []).includes(id);
  const phase = reachedFinal ? 'final' : reachedSemi ? 'semi' : 'prelim';
  const s = state.stats[id][phase];
  const rate = s.appearances ? Math.round((s.wins / s.appearances) * 100) : 0;
  return `${PHASES[phase].name} ${s.wins}/${s.appearances}選択 · ${rate}%`;
}


function winnerMeta(idol) {
  const soloInfo = window.SOLO_INFO || {};
  const groupInfo = window.GROUP_INFO || {};
  const profileInfo = window.IDOL_PROFILES || {};
  const solo = soloInfo[idol.id];
  const group = groupInfo[idol.group] || {};
  const personal = profileInfo[idol.id] || {};
  return {
    affiliation: solo?.displayAffiliation || idol.group,
    birthday: solo?.birthday || personal.birthday || '—',
    nationality: solo?.nationality || personal.nationality || '—',
    height: solo?.height || personal.height || '—',
    debut: solo?.debut || group.debut || '—',
    mvTitle: solo?.mvTitle || group.mvTitle || '',
    youtubeId: solo?.youtubeId || group.youtubeId || ''
  };
}

function renderWinnerProfile(id) {
  const idol = idolMap.get(id);
  if (!idol || !els.winnerProfile) return;
  let meta;
  try {
    meta = winnerMeta(idol);
  } catch (error) {
    console.error('Winner profile metadata error:', error);
    meta = { affiliation: idol.group || '—', birthday: '—', nationality: '—', height: '—', debut: '—', mvTitle: '', youtubeId: '' };
  }
  const videoId = meta.youtubeId ? encodeURIComponent(meta.youtubeId) : '';
  const youtubeUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : '';
  const canEmbedYouTube = window.location.protocol === 'http:' || window.location.protocol === 'https:';
  const videoBody = videoId ? (canEmbedYouTube ? `
      <div class="video-frame">
        <iframe src="https://www.youtube-nocookie.com/embed/${videoId}" title="${escapeHtml(meta.mvTitle)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
      </div>` : `
      <a class="video-local-fallback" href="${youtubeUrl}" target="_blank" rel="noopener noreferrer" aria-label="YouTubeで${escapeHtml(meta.mvTitle)}を再生">
        <img src="https://i.ytimg.com/vi/${videoId}/hqdefault.jpg" alt="${escapeHtml(meta.mvTitle)} YouTube thumbnail" />
        <span class="video-play-button">▶</span>
        <span class="video-local-note">ローカル表示では埋め込みを使用できません。クリックしてYouTubeで再生</span>
      </a>`) : '';
  const mv = videoId ? `
    <div class="winner-mv">
      <div class="winner-mv-head">
        <div>
          <p class="eyebrow">MOST VIEWED MV · SEP 2026 SNAPSHOT</p>
          <h3>${escapeHtml(meta.mvTitle)}</h3>
        </div>
        <a class="youtube-link" href="${youtubeUrl}" target="_blank" rel="noopener noreferrer">YouTubeで開く ↗</a>
      </div>
      ${videoBody}
    </div>` : '';

  els.winnerProfile.innerHTML = `
    <div class="winner-kicker">YOUR NO.1</div>
    <div class="winner-main">
      <div class="winner-photo-wrap"><img src="${idol.image}" alt="${escapeHtml(idol.name)}" /></div>
      <div class="winner-copy">
        <div class="winner-rank">#1</div>
        <h2>${escapeHtml(idol.name)}</h2>
        <p class="winner-affiliation">${escapeHtml(meta.affiliation)}</p>
        <dl class="profile-grid">
          <div><dt>生年月日</dt><dd>${escapeHtml(meta.birthday)}</dd></div>
          <div><dt>国籍</dt><dd>${escapeHtml(meta.nationality)}</dd></div>
          <div><dt>身長</dt><dd>${escapeHtml(meta.height)}</dd></div>
          <div><dt>デビュー年</dt><dd>${escapeHtml(meta.debut)}</dd></div>
          <div class="profile-wide"><dt>所属 / 活動名義</dt><dd>${escapeHtml(meta.affiliation)}</dd></div>
        </dl>
      </div>
    </div>
    ${mv}`;

  if (!els.winnerProfile.innerHTML.trim()) {
    els.winnerProfile.innerHTML = `<div class="winner-main"><div class="winner-copy"><div class="winner-rank">#1</div><h2>${escapeHtml(idol.name)}</h2><p class="winner-affiliation">${escapeHtml(idol.group || '—')}</p></div></div>`;
  }
}

function showResults() {
  showScreen('result');
  const rankingIds = getFinalRankingIds();
  els.top9.innerHTML = '';
  els.winnerProfile.innerHTML = '';
  els.allRanking.innerHTML = '';
  els.allRanking.classList.add('hidden');
  els.showAllButton.textContent = '全順位を見る';

  if (rankingIds[0]) renderWinnerProfile(rankingIds[0]);

  rankingIds.slice(0, 9).forEach((id, index) => {
    const idol = idolMap.get(id);
    const card = document.createElement('article');
    card.className = `rank-card rank-${index + 1}`;
    card.innerHTML = `
      <div class="rank-num">#${index + 1}</div>
      <div class="rank-photo-wrap"><img class="rank-photo" src="${idol.image}" alt="${escapeHtml(idol.name)}" /></div>
      <div class="rank-body">
        <div class="rank-name">${escapeHtml(idol.name)}</div>
        <div class="rank-group">${escapeHtml(idol.group)}</div>
        <div class="rank-stats">${statsLabel(id)}</div>
      </div>`;
    els.top9.appendChild(card);
  });

  rankingIds.forEach((id, index) => {
    const idol = idolMap.get(id);
    const row = document.createElement('div');
    row.className = 'all-row';
    row.innerHTML = `
      <strong class="all-rank">#${index + 1}</strong>
      <img src="${idol.image}" alt="${escapeHtml(idol.name)}" />
      <div class="all-name"><strong>${escapeHtml(idol.name)}</strong><br /><small>${escapeHtml(idol.group)}</small></div>
      <small class="all-stat">${statsLabel(id)}</small>`;
    els.allRanking.appendChild(row);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  updateResumeVisibility();
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || saved.dataVersion !== DATA_VERSION) return null;
    return saved;
  } catch {
    return null;
  }
}

function resume() {
  const saved = loadState();
  if (!saved) return startNew();
  Object.assign(state, saved);
  if (state.completed) return showResults();
  if (state.pendingTransition) return showTransition(state.pendingTransition, state.qualified[state.pendingTransition].length);
  showScreen('sort');
  renderCurrentGroup();
}

function resetAll() {
  const ok = window.confirm('現在の結果を消して、最初からやり直しますか？');
  if (!ok) return;
  localStorage.removeItem(STORAGE_KEY);
  startNew();
}

function updateResumeVisibility() {
  const saved = loadState();
  els.resumeButton.classList.toggle('hidden', !saved);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawCover(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

async function downloadTop9Image() {
  const ids = getFinalRankingIds().slice(0, 9);
  const canvas = els.resultCanvas;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f8fbfc';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#17324a';
  ctx.textAlign = 'center';
  ctx.font = '700 30px sans-serif';
  ctx.fillText('MY K-POP FACE TOP 9', 540, 70);
  ctx.font = '400 18px sans-serif';
  ctx.fillStyle = '#668092';
  ctx.fillText('K-POP FACE SORT', 540, 104);

  const gap = 18;
  const cardW = 320;
  const cardH = 350;
  const startX = (1080 - (cardW * 3 + gap * 2)) / 2;
  const startY = 145;

  for (let i = 0; i < ids.length; i++) {
    const idol = idolMap.get(ids[i]);
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = startX + col * (cardW + gap);
    const y = startY + row * (cardH + gap);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, cardW, cardH);
    try {
      const img = await loadImage(idol.image);
      drawCover(ctx, img, x, y, cardW, 250);
    } catch {
      ctx.fillStyle = '#c4e9f2';
      ctx.fillRect(x, y, cardW, 250);
    }
    ctx.fillStyle = 'rgba(0,0,0,.78)';
    ctx.fillRect(x + 12, y + 12, 54, 34);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = '700 20px sans-serif';
    ctx.fillText(`#${i + 1}`, x + 39, y + 36);
    ctx.textAlign = 'left';
    ctx.font = '700 24px sans-serif';
    ctx.fillText(idol.name, x + 18, y + 292, cardW - 36);
    ctx.font = '400 16px sans-serif';
    ctx.fillStyle = '#668092';
    ctx.fillText(idol.group, x + 18, y + 322, cardW - 36);
  }

  const link = document.createElement('a');
  link.download = 'kpop-face-sort-top9.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

els.startButton.addEventListener('click', startNew);
els.resumeButton.addEventListener('click', resume);
els.restartButton.addEventListener('click', resetAll);
els.noneButton.addEventListener('click', () => choose(null));
els.transitionButton.addEventListener('click', beginPendingPhase);
els.showAllButton.addEventListener('click', () => {
  const hidden = els.allRanking.classList.toggle('hidden');
  els.showAllButton.textContent = hidden ? '全順位を見る' : '全順位を閉じる';
});
els.downloadButton.addEventListener('click', downloadTop9Image);

updateResumeVisibility();
