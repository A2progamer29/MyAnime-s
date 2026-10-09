/* =========================================================
   LumaAnime — pages/coins.js
   Anime Coins : récompense quotidienne, succès, boutique Premium
   ========================================================= */

var coinsUser = null;

document.addEventListener('myanimes:user', function (e) {
  var guard = document.querySelector('[data-coins-guard]');
  if (!guard) return;
  coinsUser = e.detail;
  if (!coinsUser) {
    guard.hidden = false;
    guard.innerHTML = '<div class="state">' + icon('coin') + '<strong>Connexion nécessaire</strong>' +
      '<p>Les Anime Coins sont liés à ton compte : connecte-toi pour récupérer ta récompense du jour.</p>' +
      '<a class="btn btn-primary btn-sm" href="connexion.html?next=coins.html">Se connecter</a></div>';
    return;
  }
  document.querySelector('[data-coins-content]').hidden = false;
  renderCoinsPage();
}, { once: true });

async function reloadCoinsUser() {
  coinsUser = await refreshedUser();
  if (coinsUser) { renderAccount(coinsUser); renderCoinsPage(); }
}

function renderCoinsPage() {
  var u = coinsUser;
  document.querySelector('[data-coins-balance]').innerHTML = icon('coin') + '<span>' + Number(u.coins || 0).toLocaleString('fr-FR') + '</span><small>Anime Coins</small>';
  document.querySelector('[data-coins-streak]').innerHTML = icon('flame') + (u.streak ? 'Série en cours : ' + u.streak + ' jour' + (u.streak > 1 ? 's' : '') + ' consécutif' + (u.streak > 1 ? 's' : '') : 'Aucune série en cours');
  renderDaily();
  renderShop();
  renderProgress();
  renderAchievements();
  renderLedger();
}

/* ---- Récompense quotidienne ---- */
function msUntilParisMidnight() {
  var now = new Date();
  var parts = new Intl.DateTimeFormat('fr-FR', { timeZone: COIN_RULES.timeZone, hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  var get = function (t) { return Number((parts.filter(function (p) { return p.type === t; })[0] || {}).value || 0); };
  return ((23 - get('hour')) * 3600 + (59 - get('minute')) * 60 + (60 - get('second'))) * 1000;
}

function streakTrackHTML(filled, next) {
  var cells = '';
  for (var i = 1; i <= 7; i++) {
    var cls = i <= filled ? 'is-done' : (i === next ? 'is-next' : '');
    cells += '<li class="' + cls + '">' + (i === 7 ? icon('gift') + '+50' : 'J' + i) + '</li>';
  }
  return '<ol class="streak-track" aria-hidden="true">' + cells + '</ol>';
}

function renderDaily() {
  var box = document.querySelector('[data-daily]');
  var u = coinsUser;
  var preview = dailyPreview(u);
  var cycle = function (s) { return s > 0 && s % 7 === 0 ? 7 : s % 7; };

  if (!preview.available) {
    box.innerHTML =
      '<p class="daily-reward">Récupérée ✓</p>' +
      '<p>Tu as déjà récupéré ta récompense aujourd\'hui. La prochaine sera disponible dans <strong>' + formatRemaining(msUntilParisMidnight()) + '</strong> (minuit, heure de Paris).</p>' +
      streakTrackHTML(cycle(u.streak), 0) +
      '<p class="field-hint">Jour ' + cycle(u.streak) + ' sur 7 de ta semaine de série.</p>';
    return;
  }

  var grows = preview.streak !== (u.streak || 0);
  var filledBefore = grows ? cycle(preview.streak - 1 < 0 ? 0 : preview.streak - 1) : cycle(u.streak);
  if (grows && preview.streak % 7 === 1) filledBefore = 0;
  var total = preview.reward + preview.bonus;
  var notes = [];
  if (preview.resets) notes.push('Plus de deux jours sans récompense : ta série repart à 1.');
  if (preview.grace) notes.push('Tu as manqué un jour : ta série est conservée mais ne progresse pas aujourd\'hui.');
  if (preview.bonus) notes.push('Bonus de série inclus : +' + preview.bonus + ' AC.');

  box.innerHTML =
    '<p class="daily-reward">+' + total + ' AC</p>' +
    (notes.length ? '<p>' + escapeHTML(notes.join(' ')) + '</p>' : '<p>Reviens chaque jour pour faire grimper ta série et ta récompense (30 AC maximum par jour).</p>') +
    streakTrackHTML(filledBefore, grows ? filledBefore + 1 : 0) +
    '<div><button class="btn btn-primary" type="button" data-claim-daily>' + icon('coin') + '<span>Récupérer mes ' + total + ' Anime Coins</span></button></div>';

  box.querySelector('[data-claim-daily]').addEventListener('click', async function () {
    var btn = this;
    setBusy(btn, true, 'Récupération…');
    var res = await claimDailyReward();
    if (!res.ok) { setBusy(btn, false); showToast(res.error, res.reason === 'already_claimed' ? 'warning' : 'error'); if (res.reason === 'already_claimed') reloadCoinsUser(); return; }
    showToast('+' + (res.reward + res.bonus) + ' Anime Coins ! Série : ' + res.streak + ' jour' + (res.streak > 1 ? 's' : '') + '.', 'success');
    await reloadCoinsUser();
    var title = document.getElementById('daily-title');
    if (title) { title.setAttribute('tabindex', '-1'); title.focus(); }
  });
}

/* ---- Boutique : Soutien par paliers de 30, 60 ou 90 jours ---- */
var COIN_DAYS = [30, 60, 90];

async function renderShop() {
  var u = coinsUser;
  var status = premiumStatus(u);
  var shop = document.querySelector('[data-coins-shop]');
  var cfg = (typeof loadSiteSettings === 'function' ? await loadSiteSettings() : null) || {};
  var tiers = cfg.coin_tiers || {};
  shop.innerHTML = COIN_DAYS.map(function (days) {
    var cost = Number(tiers[days]) || 0;
    var pct = cost ? Math.min(100, Math.round((u.coins / cost) * 100)) : 0;
    var missing = Math.max(0, cost - u.coins);
    var action;
    if (!cost) action = '<p class="muted">Prix indisponible pour le moment.</p>';
    else if (status.active && status.lifetime) action = '<p>Tu as déjà Soutien + à vie : aucun échange n\'est nécessaire.</p>';
    else if (missing) action = '<p>Il te manque <strong class="coin-amount">' + formatCoins(missing) + '</strong>.</p>' +
      '<button class="btn btn-sm" type="button" disabled>' + icon('lock') + '<span>Pas assez de coins</span></button>';
    else action = '<button class="btn btn-primary btn-sm" type="button" data-buy-days="' + days + '" data-cost="' + cost + '">' + icon('crown') + '<span>Échanger contre ' + days + ' jours</span></button>';
    return '<li class="shop-tier">' +
      '<h3><span class="shop-days">' + days + ' jours</span> <span class="muted">· Soutien</span></h3>' +
      '<p class="coin-amount">' + icon('coin') + (cost ? formatCoins(cost) : '—') + '</p>' +
      '<div class="meter" role="progressbar" aria-label="Progression vers ' + days + ' jours de Soutien" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><span style="width:' + pct + '%"></span></div>' +
      '<p>' + escapeHTML(PREMIUM_TIERS.soutien.perks.join(' · ')) + '</p>' +
      action +
    '</li>';
  }).join('');

  shop.querySelectorAll('[data-buy-days]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var days = Number(btn.getAttribute('data-buy-days'));
      var cost = Number(btn.getAttribute('data-cost'));
      var st = premiumStatus(coinsUser);
      var ok = await confirmDialog({
        title: 'Échanger contre ' + days + ' jours de Soutien ?',
        message: formatCoins(cost) + ' seront retirés de ton solde. ' +
          (st.active && st.until ? days + ' jours s\'ajoutent à ton Premium actuel, qui se termine le ' + formatDateFr(st.until) + '.' : 'Ton Soutien commence tout de suite pour ' + days + ' jours.') +
          ' Cette opération ne peut pas être annulée.',
        confirmLabel: 'Échanger ' + formatCoins(cost),
        cancelLabel: 'Garder mes coins'
      });
      if (!ok) return;
      shop.querySelectorAll('[data-buy-days]').forEach(function (b) { b.disabled = true; });
      setBusy(btn, true, 'Échange en cours…');
      var res = await buyPremiumDays(days);
      if (!res.ok) { setBusy(btn, false); showToast(res.error, 'error'); await reloadCoinsUser(); return; }
      showToast('Soutien activé jusqu\'au ' + formatDateFr(res.until) + ' !', 'success');
      await reloadCoinsUser();
    });
  });
}

/* ---- Succès à paliers ---- */
var progressClaimed = false;

function tierMinAge(goal) { return goal >= 1000 ? 30 : goal >= 100 ? 7 : 0; }

function tierRewardText(t) {
  var parts = [];
  if (t.reward_coins) parts.push('+' + Number(t.reward_coins).toLocaleString('fr-FR') + ' AC');
  if (t.badge) parts.push('badge « ' + t.badge.name + ' »');
  if (t.decoration) parts.push('décoration « ' + t.decoration + ' »');
  return parts.join(', ');
}

async function renderProgress() {
  var list = document.querySelector('[data-progress]');
  if (!list) return;
  if (!progressClaimed) {
    progressClaimed = true;
    var claim = await claimProgress();
    if (claim.ok && claim.reached && claim.reached.length) {
      var last = claim.reached[claim.reached.length - 1];
      showToast(claim.reached.length === 1
        ? 'Palier atteint : ' + last.achievement + ' ' + last.level + (claim.coins_gained ? ' (+' + claim.coins_gained + ' AC)' : '') + ' !'
        : claim.reached.length + ' paliers atteints' + (claim.coins_gained ? ' (+' + claim.coins_gained.toLocaleString('fr-FR') + ' AC)' : '') + ' !', 'success');
      await reloadCoinsUser();
      return;
    }
  }
  var ov = await progressOverview();
  if (!ov.ok) {
    list.innerHTML = '<li class="catalog-status">' + (ov.error === 'missing' ? 'Les succès à paliers seront disponibles très bientôt.' : 'Progression indisponible pour le moment.') + '</li>';
    return;
  }
  var metrics = ov.metrics || {};
  var done = ov.achieved || [];
  if (!ov.achievements.length) { list.innerHTML = '<li class="catalog-status">Aucun succès à paliers pour le moment.</li>'; return; }
  list.innerHTML = ov.achievements.map(function (a) {
    var tiers = a.tiers || [];
    var value = Number(metrics[a.metric] || 0);
    var reached = tiers.filter(function (t) { return done.indexOf(t.id) !== -1; }).length;
    var next = tiers.filter(function (t) { return done.indexOf(t.id) === -1; })[0];
    var prevGoal = reached ? tiers[reached - 1].goal : 0;
    var unit = a.unit ? ' ' + a.unit : '';
    var pct = next ? Math.max(0, Math.min(100, Math.floor(((value - prevGoal) / (next.goal - prevGoal)) * 100))) : 100;
    var afterNext = next ? tiers[tiers.indexOf(next) + 1] : null;
    var badges = tiers.filter(function (t) { return t.badge && done.indexOf(t.id) !== -1; }).map(function (t) { return t.badge; });
    return '<li class="prog-card' + (next ? '' : ' is-complete') + '">' +
      '<div class="prog-head">' +
        '<div class="ach-icon" aria-hidden="true">' + icon(a.icon || 'trophy') + '</div>' +
        '<div><h3>' + escapeHTML(a.name) + '</h3><p class="prog-level">Palier ' + reached + ' / ' + tiers.length + '</p></div>' +
      '</div>' +
      (a.description ? '<p class="ach-text">' + escapeHTML(a.description) + '</p>' : '') +
      (next
        ? '<p class="prog-value"><strong>' + Math.min(value, next.goal).toLocaleString('fr-FR') + ' / ' + next.goal.toLocaleString('fr-FR') + '</strong>' + escapeHTML(unit) + '</p>' +
          '<div class="meter meter--thin" role="progressbar" aria-label="Progression vers le palier ' + next.level + ' : ' + escapeHTML(a.name) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><span style="width:' + pct + '%"></span></div>' +
          '<p class="prog-next">Palier ' + next.level + (tierRewardText(next) ? ' · récompense : ' + escapeHTML(tierRewardText(next)) : '') + '</p>' +
          (value >= next.goal && (metrics.age_days || 0) < tierMinAge(next.goal)
            ? '<p class="prog-next muted">Disponible après ' + tierMinAge(next.goal) + ' jours d\'ancienneté</p>' : '') +
          (afterNext ? '<p class="prog-next muted">Ensuite : ' + afterNext.goal.toLocaleString('fr-FR') + escapeHTML(unit) + '</p>' : '')
        : '<p class="prog-value"><strong>' + value.toLocaleString('fr-FR') + '</strong>' + escapeHTML(unit) + '</p><p class="prog-next">' + icon('check') + ' Tous les paliers sont terminés. Bravo !</p>') +
      (badges.length ? '<div class="prog-badges">' + badges.map(badgeHTML).join('') + '</div>' : '') +
      '<details class="prog-tiers"><summary>Voir les ' + tiers.length + ' paliers</summary><ol>' +
        tiers.map(function (t) {
          var ok = done.indexOf(t.id) !== -1;
          return '<li class="' + (ok ? 'is-done' : '') + '"><span>' + (ok ? icon('check') : '') + 'Palier ' + t.level + '</span><span>' + t.goal.toLocaleString('fr-FR') + escapeHTML(unit) + '</span><span class="muted">' + escapeHTML(tierRewardText(t) || '—') + '</span></li>';
        }).join('') +
      '</ol></details>' +
    '</li>';
  }).join('');
}

/* ---- Succès ---- */
var achState = { filter: 'all', overview: null };

function percentLabel(count, members) {
  if (!members) return 'Aucun membre pour le moment';
  var pct = (count / members) * 100;
  var text = pct === 0 ? '0' : pct < 0.1 ? '< 0,1' : pct.toLocaleString('fr-FR', { maximumFractionDigits: pct < 10 ? 1 : 0 });
  return 'Obtenu par ' + text + ' % des membres';
}

function achievementCardHTML(a, metrics, stats, members, claimedList) {
  var claimed = claimedList.indexOf(a.code) !== -1;
  var value = Math.max(0, Number(metrics[a.metric] || 0));
  var ageOk = (metrics.age_days || 0) >= a.minAge;
  var ready = !claimed && value >= a.threshold && ageOk;
  var pct = claimed ? 100 : Math.min(100, Math.floor((value / a.threshold) * 100));
  var diff = DIFFICULTIES[a.difficulty];
  var cat = ACHIEVEMENT_CATEGORIES.filter(function (c) { return c.key === a.category; })[0];
  var progressText = a.threshold > 1
    ? Math.min(value, a.threshold).toLocaleString('fr-FR') + ' / ' + a.threshold.toLocaleString('fr-FR')
    : (value >= 1 ? 'Condition remplie' : 'Pas encore');
  var end;
  if (claimed) end = '<span class="badge badge--gold">' + icon('check') + 'Obtenu</span>';
  else if (ready) end = '<button class="btn btn-primary btn-sm" type="button" data-claim-ach="' + a.code + '">' + icon('coin') + '<span>Récupérer ' + a.reward.toLocaleString('fr-FR') + ' AC</span></button>';
  else if (value >= a.threshold && !ageOk) end = '<span class="badge badge--muted">Après ' + a.minAge + ' jours d\'ancienneté</span>';
  else end = '<span class="badge badge--muted">' + icon('lock') + 'Verrouillé</span>';
  return '<li class="ach-card ach--' + a.difficulty + (claimed ? ' is-claimed' : '') + (ready ? ' is-ready' : '') + '">' +
    '<div class="ach-icon" aria-hidden="true">' + icon(cat ? cat.icon : 'trophy') + '</div>' +
    '<div class="ach-body">' +
      '<p class="ach-meta"><span class="ach-diff">' + diff.label + '</span><span class="ach-reward">' + icon('coin') + '+' + a.reward.toLocaleString('fr-FR') + ' AC</span></p>' +
      '<h3>' + escapeHTML(a.title) + '</h3>' +
      '<p class="ach-text">' + escapeHTML(a.text) + (a.minAge ? ' Membre depuis au moins ' + a.minAge + ' jours.' : '') + '</p>' +
      '<div class="meter meter--thin" role="progressbar" aria-label="Progression : ' + escapeHTML(a.title) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '" aria-valuetext="' + escapeHTML(progressText) + '"><span style="width:' + pct + '%"></span></div>' +
      '<p class="ach-foot"><span>' + escapeHTML(progressText) + '</span><span>' + escapeHTML(percentLabel(stats[a.code] || 0, members)) + '</span></p>' +
    '</div>' +
    '<div class="ach-end">' + end + '</div>' +
  '</li>';
}

async function renderAchievements(skipFetch) {
  var u = coinsUser;
  var list = document.querySelector('[data-coins-achievements]');
  var filters = document.querySelector('[data-ach-filters]');
  var summary = document.querySelector('[data-ach-summary]');
  if (!skipFetch) {
    var ov = await achievementsOverview();
    achState.overview = ov.ok ? ov : null;
  }
  var ov2 = achState.overview;
  var metrics = Object.assign(localAchievementMetrics(u), ov2 && ov2.metrics ? ov2.metrics : {});
  var stats = (ov2 && ov2.stats) || {};
  var members = (ov2 && ov2.members) || 0;
  var claimedList = u.achievements || [];
  var owned = ACHIEVEMENTS.filter(function (a) { return claimedList.indexOf(a.code) !== -1; });
  var earned = owned.reduce(function (s, a) { return s + a.reward; }, 0);
  var ready = ACHIEVEMENTS.filter(function (a) {
    return claimedList.indexOf(a.code) === -1 && Number(metrics[a.metric] || 0) >= a.threshold && (metrics.age_days || 0) >= a.minAge;
  }).length;

  summary.innerHTML =
    '<div><strong>' + owned.length + ' / ' + ACHIEVEMENTS.length + '</strong><span>succès obtenus</span></div>' +
    '<div><strong>' + formatCoins(earned) + '</strong><span>gagnés grâce aux succès</span></div>' +
    '<div><strong>' + ready + '</strong><span>prêt' + (ready > 1 ? 's' : '') + ' à récupérer</span></div>';

  filters.innerHTML = [{ key: 'all', label: 'Tous', icon: 'grid' }].concat(ACHIEVEMENT_CATEGORIES).map(function (c) {
    var n = c.key === 'all' ? ACHIEVEMENTS.length : ACHIEVEMENTS.filter(function (a) { return a.category === c.key; }).length;
    return '<button class="chip-btn" type="button" data-ach-filter="' + c.key + '" aria-pressed="' + (achState.filter === c.key) + '">' + icon(c.icon) + escapeHTML(c.label) + ' <span class="muted">' + n + '</span></button>';
  }).join('');

  var shown = ACHIEVEMENTS.filter(function (a) { return achState.filter === 'all' || a.category === achState.filter; })
    .slice().sort(function (x, y) {
      function order(a) {
        if (claimedList.indexOf(a.code) !== -1) return 2;
        return Number(metrics[a.metric] || 0) >= a.threshold && (metrics.age_days || 0) >= a.minAge ? 0 : 1;
      }
      return order(x) - order(y) || DIFFICULTIES[x.difficulty].rank - DIFFICULTIES[y.difficulty].rank || x.threshold - y.threshold;
    });
  list.innerHTML = shown.map(function (a) { return achievementCardHTML(a, metrics, stats, members, claimedList); }).join('');

  filters.querySelectorAll('[data-ach-filter]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      achState.filter = btn.getAttribute('data-ach-filter');
      renderAchievements(true);
      var again = document.querySelector('[data-ach-filter="' + achState.filter + '"]');
      if (again) again.focus();
    });
  });
  list.querySelectorAll('[data-claim-ach]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      setBusy(btn, true, 'Récupération…');
      var res = await claimAchievement(btn.getAttribute('data-claim-ach'));
      if (!res.ok) { setBusy(btn, false); showToast(res.error, 'warning'); return; }
      showToast('Succès obtenu : +' + res.reward + ' Anime Coins.', 'success');
      await reloadCoinsUser();
    });
  });
}

/* ---- Historique ---- */
var LEDGER_LABELS = { quotidien: 'Récompense quotidienne', cle: 'Clé d\'Anime Coins', admin: 'Ajustement par l\'équipe' };

function ledgerLabel(reason) {
  if (LEDGER_LABELS[reason]) return LEDGER_LABELS[reason];
  if (reason.indexOf('succes:') === 0) {
    var a = ACHIEVEMENTS.filter(function (x) { return x.code === reason.slice(7); })[0];
    return 'Succès : ' + (a ? a.title : reason.slice(7));
  }
  if (reason.indexOf('premium:soutien_') === 0) return 'Échange : ' + reason.slice(16) + ' jours de Soutien';
  if (reason.indexOf('premium:') === 0) {
    var t = PREMIUM_TIERS[reason.slice(8)];
    return 'Échange : Premium ' + (t ? t.name : '');
  }
  if (reason.indexOf('palier:') === 0) return 'Palier de succès atteint';
  if (reason.indexOf('decoration:') === 0) return 'Décoration de profil';
  return reason;
}

async function renderLedger() {
  var list = document.querySelector('[data-coins-ledger]');
  var rows = await listCoinHistory();
  list.innerHTML = rows.length
    ? rows.map(function (r) {
      return '<li><div>' + escapeHTML(ledgerLabel(r.reason)) + '<time datetime="' + escapeHTML(r.created_at) + '">' + escapeHTML(formatDateFr(r.created_at, true)) + '</time></div>' +
        '<span class="' + (r.amount >= 0 ? 'plus' : 'minus') + '">' + (r.amount >= 0 ? '+' : '−') + Math.abs(r.amount).toLocaleString('fr-FR') + ' AC</span></li>';
    }).join('')
    : '<li><span class="muted">Aucun mouvement pour le moment.</span></li>';
}
