const STORAGE_KEY = 'baccarat-tracker-v31-final';
const LADDER = [
  { from: 1, to: 4, bet: 100 },
  { from: 5, to: 8, bet: 200 },
  { from: 9, to: 12, bet: 300 },
  { from: 13, to: 16, bet: 500 },
  { from: 17, to: 20, bet: 800 },
  { from: 21, to: 24, bet: 1200 },
  { from: 25, to: 28, bet: 1900 },
  { from: 29, to: 70, bet: 3000 }
];

const state = loadState();
let deferredInstallPrompt = null;

const el = (id) => document.getElementById(id);
const fmt = (n) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(n || 0));

const refs = {
  installBtn: el('installBtn'),
  installHint: el('installHint'),
  bankrollValue: el('bankrollValue'),
  roundCount: el('roundCount'),
  activeCount: el('activeCount'),
  playerPending: el('playerPending'),
  bankerPending: el('bankerPending'),
  playerKeypad: el('playerKeypad'),
  bankerKeypad: el('bankerKeypad'),
  lastRoundBox: el('lastRoundBox'),
  lastThreeBox: el('lastThreeBox'),
  exposureBox: el('exposureBox'),
  nextBetBox: el('nextBetBox'),
  boardGrid: el('boardGrid'),
  historyTableWrap: el('historyTableWrap'),
  analyticsSummary: el('analyticsSummary'),
  targetProgressBox: el('targetProgressBox'),
  heatMapBox: el('heatMapBox'),
  ladderTableWrap: el('ladderTableWrap'),
  startingBankrollInput: el('startingBankrollInput'),
  targetProfitInput: el('targetProfitInput')
};

function defaultState() {
  return {
    settings: {
      startingBankroll: 30000,
      targetProfit: 5000
    },
    play: {
      pendingPlayer: null,
      pendingBanker: null,
      rounds: [],
      archivedShoes: []
    }
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return {
      ...defaultState(),
      ...parsed,
      settings: { ...defaultState().settings, ...(parsed.settings || {}) },
      play: { ...defaultState().play, ...(parsed.play || {}) }
    };
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getBetForStage(stage) {
  const row = LADDER.find(item => stage >= item.from && stage <= item.to) || LADDER[LADDER.length - 1];
  return row.bet;
}

function analyzeSide(rounds, side) {
  const firstSeen = {};
  const lastSeen = {};
  const active = [];
  const hitHistory = [];
  const counts = { 0:0,1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0,9:0 };

  rounds.forEach((round, idx) => {
    const digit = Number(round[side]);
    counts[digit] = (counts[digit] || 0) + 1;

    if (digit >= 1 && digit <= 9) {
      if (firstSeen[digit] == null) {
        firstSeen[digit] = idx;
        lastSeen[digit] = idx;
      } else {
        hitHistory.push({ digit, stage: idx - firstSeen[digit] + 1, round: idx + 1 });
        delete firstSeen[digit];
        delete lastSeen[digit];
      }
    }

    Object.keys(firstSeen).forEach((num) => {
      const n = Number(num);
      if (n !== digit) {
        lastSeen[n] = idx;
      }
    });
  });

  Object.keys(firstSeen).sort((a,b) => Number(a) - Number(b)).forEach((num) => {
    const digit = Number(num);
    const stage = rounds.length - firstSeen[num] + 1;
    active.push({
      digit,
      stage,
      bet: getBetForStage(stage),
      sinceRound: firstSeen[num] + 1,
      age: rounds.length - firstSeen[num]
    });
  });

  const exposure = active.reduce((sum, item) => sum + item.bet, 0);
  const avgHitStage = hitHistory.length ? (hitHistory.reduce((sum, item) => sum + item.stage, 0) / hitHistory.length) : 0;

  return { active, exposure, hitHistory, counts, avgHitStage };
}

function summarize() {
  const rounds = state.play.rounds;
  const player = analyzeSide(rounds, 'player');
  const banker = analyzeSide(rounds, 'banker');
  const totalExposure = player.exposure + banker.exposure;
  const completed = player.hitHistory.length + banker.hitHistory.length;
  const wonEstimate = player.hitHistory.reduce((s, h) => s + Math.max(0, 900 - getLossBeforeHit(h.stage, getBetForStage)), 0) +
                      banker.hitHistory.reduce((s, h) => s + Math.max(0, 900 - getLossBeforeHit(h.stage, getBetForStage)), 0);
  const bankroll = state.settings.startingBankroll + wonEstimate - totalExposure;
  return { rounds, player, banker, totalExposure, completed, bankroll };
}

function getLossBeforeHit(stage, betFn) {
  let loss = 0;
  for (let s = 1; s < stage; s += 1) loss += betFn(s);
  return loss;
}

function commitRoundIfReady() {
  if (state.play.pendingPlayer === null || state.play.pendingBanker === null) return;
  state.play.rounds.push({
    round: state.play.rounds.length + 1,
    player: Number(state.play.pendingPlayer),
    banker: Number(state.play.pendingBanker),
    ts: Date.now()
  });
  state.play.pendingPlayer = null;
  state.play.pendingBanker = null;
  saveState();
  render();
}

function setPending(side, value) {
  state.play[side === 'player' ? 'pendingPlayer' : 'pendingBanker'] = value;
  saveState();
  render();
  commitRoundIfReady();
}

function resetCurrentShoe() {
  state.play.pendingPlayer = null;
  state.play.pendingBanker = null;
  state.play.rounds = [];
  saveState();
  render();
}

function newShoe() {
  if (state.play.rounds.length) {
    state.play.archivedShoes.unshift({
      endedAt: Date.now(),
      rounds: [...state.play.rounds]
    });
  }
  resetCurrentShoe();
}

function undoLast() {
  if (state.play.pendingPlayer !== null || state.play.pendingBanker !== null) {
    state.play.pendingPlayer = null;
    state.play.pendingBanker = null;
  } else {
    state.play.rounds.pop();
  }
  saveState();
  render();
}

function buildKeypad(root, side) {
  root.innerHTML = '';
  for (let n = 0; n <= 9; n += 1) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `key side-${side}`;
    btn.textContent = n;
    btn.addEventListener('click', () => setPending(side, n));
    root.appendChild(btn);
  }
}

function renderPending() {
  refs.playerPending.textContent = `Pending: ${state.play.pendingPlayer === null ? 'none' : state.play.pendingPlayer}`;
  refs.bankerPending.textContent = `Pending: ${state.play.pendingBanker === null ? 'none' : state.play.pendingBanker}`;
  [...refs.playerKeypad.children].forEach((btn) => btn.classList.toggle('active-pending', String(state.play.pendingPlayer) === btn.textContent));
  [...refs.bankerKeypad.children].forEach((btn) => btn.classList.toggle('active-pending', String(state.play.pendingBanker) === btn.textContent));
}

function renderLastRounds(rounds) {
  if (!rounds.length) {
    refs.lastRoundBox.textContent = 'No round yet';
    refs.lastRoundBox.className = 'summary-box empty-state';
    refs.lastThreeBox.textContent = 'No rounds yet';
    refs.lastThreeBox.className = 'stack-list empty-state';
    return;
  }
  refs.lastRoundBox.className = 'summary-box';
  const last = rounds[rounds.length - 1];
  refs.lastRoundBox.innerHTML = `<div class="stack-item"><strong>Round ${last.round}</strong><div class="dual mono"><span>Player: ${last.player}</span><span>Banker: ${last.banker}</span></div></div>`;
  const lastThree = rounds.slice(-3); // oldest -> newest retained
  refs.lastThreeBox.className = 'stack-list';
  refs.lastThreeBox.innerHTML = lastThree.map(r => `<div class="stack-item"><strong>Round ${r.round}</strong><div class="dual mono"><span>Player: ${r.player}</span><span>Banker: ${r.banker}</span></div></div>`).join('');
}

function renderExposure(summary) {
  refs.exposureBox.innerHTML = [
    `<div class="stack-item"><strong>Player exposure</strong><div class="mono">₹${fmt(summary.player.exposure)}</div></div>`,
    `<div class="stack-item"><strong>Banker exposure</strong><div class="mono">₹${fmt(summary.banker.exposure)}</div></div>`,
    `<div class="stack-item"><strong>Total exposure next round</strong><div class="mono">₹${fmt(summary.totalExposure)}</div></div>`
  ].join('');

  const nextItems = [];
  const pushSide = (label, items) => {
    if (!items.length) {
      nextItems.push(`<div class="stack-item"><strong>${label}</strong><div class="muted">No active numbers</div></div>`);
      return;
    }
    const top = items.slice().sort((a,b) => b.stage - a.stage || a.digit - b.digit).slice(0,4);
    nextItems.push(`<div class="stack-item"><strong>${label}</strong>${top.map(item => `<div class="mono">#${item.digit} • Stage ${item.stage} • Bet ₹${fmt(item.bet)}</div>`).join('')}</div>`);
  };
  pushSide('Player next bets', summary.player.active);
  pushSide('Banker next bets', summary.banker.active);
  refs.nextBetBox.innerHTML = nextItems.join('');
}

function renderBoard(summary) {
  refs.boardGrid.innerHTML = ['player', 'banker'].map((side) => {
    const data = summary[side];
    const cards = Array.from({ length: 9 }, (_, i) => i + 1).map((digit) => {
      const hitCount = data.counts[digit] || 0;
      const active = data.active.find(item => item.digit === digit);
      return `<div class="num-card ${active ? 'active-num' : ''}"><div class="num-title">${digit}</div><div class="num-meta">Hits: ${hitCount}</div><div class="num-meta">${active ? `Stage ${active.stage} • ₹${fmt(active.bet)}` : 'Inactive'}</div></div>`;
    }).join('');
    return `<div class="side-board"><div class="section-head"><h2>${side[0].toUpperCase() + side.slice(1)}</h2><span class="pill">Active ${data.active.length}</span></div><div class="number-grid">${cards}</div></div>`;
  }).join('');
}

function renderHistory(rounds) {
  if (!rounds.length && !state.play.archivedShoes.length) {
    refs.historyTableWrap.innerHTML = '<div class="empty-state">No history yet</div>';
    return;
  }
  const currentRows = rounds.map(r => `<tr><td>${r.round}</td><td>${r.player}</td><td>${r.banker}</td><td>Current Shoe</td></tr>`).join('');
  const archivedRows = state.play.archivedShoes.flatMap((shoe, idx) => shoe.rounds.map((r, ri) => `<tr><td>${ri + 1}</td><td>${r.player}</td><td>${r.banker}</td><td>Archived Shoe ${state.play.archivedShoes.length - idx}</td></tr>`)).join('');
  refs.historyTableWrap.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Round</th><th>Player</th><th>Banker</th><th>Shoe</th></tr></thead><tbody>${currentRows}${archivedRows}</tbody></table></div>`;
}

function renderAnalytics(summary) {
  const rounds = summary.rounds.length;
  refs.analyticsSummary.innerHTML = [
    `<div class="stack-item"><strong>Total live rounds</strong><div class="mono">${rounds}</div></div>`,
    `<div class="stack-item"><strong>Player avg hit stage</strong><div class="mono">${summary.player.avgHitStage ? summary.player.avgHitStage.toFixed(2) : '—'}</div></div>`,
    `<div class="stack-item"><strong>Banker avg hit stage</strong><div class="mono">${summary.banker.avgHitStage ? summary.banker.avgHitStage.toFixed(2) : '—'}</div></div>`,
    `<div class="stack-item"><strong>Estimated current bankroll</strong><div class="mono">₹${fmt(summary.bankroll)}</div></div>`
  ].join('');

  const progress = Math.max(0, Math.min(100, ((summary.bankroll - state.settings.startingBankroll) / Math.max(1, state.settings.targetProfit)) * 100));
  const currentProfit = summary.bankroll - state.settings.startingBankroll;
  refs.targetProgressBox.innerHTML = `
    <div class="stack-item progress-wrap">
      <strong>Target profit</strong>
      <div class="mono">Current: ₹${fmt(currentProfit)} / Target: ₹${fmt(state.settings.targetProfit)}</div>
      <div class="progress-bar"><span style="width:${progress}%"></span></div>
      <div class="mono">${progress.toFixed(1)}%</div>
    </div>`;

  const heat = [];
  ['player','banker'].forEach((side) => {
    Object.entries(summary[side].counts)
      .sort((a,b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))
      .slice(0,5)
      .forEach(([digit, count]) => heat.push(`<span class="chip">${side[0].toUpperCase()}${digit}: ${count}</span>`));
  });
  refs.heatMapBox.innerHTML = heat.join('') || '<div class="empty-state">No data yet</div>';
}

function renderLadder() {
  refs.ladderTableWrap.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Stage From</th><th>Stage To</th><th>Bet</th></tr></thead><tbody>${LADDER.map(row => `<tr><td>${row.from}</td><td>${row.to}</td><td>₹${fmt(row.bet)}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderHeader(summary) {
  refs.bankrollValue.textContent = `₹${fmt(summary.bankroll)}`;
  refs.roundCount.textContent = summary.rounds.length;
  refs.activeCount.textContent = summary.player.active.length + summary.banker.active.length;
}

function renderSettings() {
  refs.startingBankrollInput.value = state.settings.startingBankroll;
  refs.targetProfitInput.value = state.settings.targetProfit;
}

function render() {
  const summary = summarize();
  renderPending();
  renderHeader(summary);
  renderLastRounds(summary.rounds);
  renderExposure(summary);
  renderBoard(summary);
  renderHistory(summary.rounds);
  renderAnalytics(summary);
  renderLadder();
  renderSettings();
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((item) => item.classList.remove('active'));
      document.querySelectorAll('.tab-screen').forEach((item) => item.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    });
  });
}

function setupInstall() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isStandalone) {
    refs.installBtn.classList.add('hidden');
    refs.installHint.classList.add('hidden');
  } else {
    refs.installHint.textContent = 'For first install on GitHub Pages, open once, refresh once, then wait 3 seconds.';
    refs.installHint.classList.remove('hidden');
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    refs.installBtn.classList.remove('hidden');
    refs.installHint.textContent = 'Install App is ready. Tap the button above.';
    refs.installHint.classList.remove('hidden');
  });

  refs.installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    refs.installBtn.classList.add('hidden');
    refs.installHint.textContent = 'If Chrome still shows only shortcut, clear site data once and reopen the site.';
    refs.installHint.classList.remove('hidden');
  });

  window.addEventListener('appinstalled', () => {
    refs.installBtn.classList.add('hidden');
    refs.installHint.textContent = 'App installed successfully.';
    refs.installHint.classList.remove('hidden');
  });
}

function setupActions() {
  el('undoBtn').addEventListener('click', undoLast);
  el('clearBtn').addEventListener('click', resetCurrentShoe);
  el('newShoeBtn').addEventListener('click', newShoe);
  el('saveSettingsBtn').addEventListener('click', () => {
    state.settings.startingBankroll = Number(refs.startingBankrollInput.value || 0);
    state.settings.targetProfit = Number(refs.targetProfitInput.value || 0);
    saveState();
    render();
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).then(async (registration) => {
        await navigator.serviceWorker.ready;
        if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }).catch(() => {});
    });
  }
}

buildKeypad(refs.playerKeypad, 'player');
buildKeypad(refs.bankerKeypad, 'banker');
setupTabs();
setupInstall();
setupActions();
registerServiceWorker();
render();
