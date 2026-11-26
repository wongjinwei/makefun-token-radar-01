// app.js — Token Radar dashboard. Reads window.RADAR (data.js) and renders
// the board, the live view, filters, sorting and the detail drawer.
// No network: every value comes from the snapshot-derived data file.
(function () {
  'use strict';
  var D = window.RADAR || { rows: [], live: [], multiples: {}, constants: {} };
  var rows = D.rows || [];
  var live = D.live || [];
  var tab = 'board';
  var state = { q: '', cat: '', chain: '', sort: 'rank' };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function money(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(v) {
    if (v == null) return '—';
    var s = (v > 0 ? '+' : '') + v.toFixed(1) + '%';
    return '<span class="' + (v > 0 ? 'up' : v < 0 ? 'down' : '') + '">' + s + '</span>';
  }
  function ageFmt(d) {
    if (d == null) return '—';
    if (d < 365) return d + 'd';
    return (d / 365).toFixed(1) + 'y';
  }
  function chainList(c) { return (c || []).slice(0, 3).join(', ') + ((c || []).length > 3 ? ' +' + ((c || []).length - 3) : ''); }

  // ---- header stats
  $('asof').textContent = D.as_of || '—';
  $('floor').textContent = money(D.floor_usd);
  $('nBoard').textContent = rows.length;
  $('nLive').textContent = live.length;
  $('nWatch').textContent = D.watchlist_count || rows.filter(function (r) { return r.tvl_usd >= (D.floor_usd || 0); }).length;

  // ---- filter options
  var cats = {}, chains = {};
  rows.concat(live).forEach(function (r) {
    cats[r.category] = 1;
    (r.chains || []).forEach(function (c) { chains[c] = 1; });
  });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c;
    $('fCat').appendChild(o);
  });
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c;
    $('fChain').appendChild(o);
  });

  // ---- table
  function visible() {
    var list = tab === 'board' ? rows : live;
    var q = state.q.trim().toLowerCase();
    return list.filter(function (r) {
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) < 0) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      return true;
    });
  }
  function sorted(list) {
    var s = list.slice();
    var k = state.sort;
    if (k === 'implied') s.sort(function (a, b) { return (b.implied_value_usd || 0) - (a.implied_value_usd || 0); });
    else if (k === 'tvl') s.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (k === 'chg') s.sort(function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); });
    else if (k === 'age') s.sort(function (a, b) { return (b.age_days || 0) - (a.age_days || 0); });
    else s.sort(function (a, b) { return (a.rank || 0) - (b.rank || 0); });
    return s;
  }
  function render() {
    var list = sorted(visible());
    var tb = $('rows');
    tb.innerHTML = list.map(function (r) {
      var rankCell = tab === 'board' ? '<td class="num">' + r.rank + '</td>' : '<td class="num">—</td>';
      var valCell = tab === 'board'
        ? '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>'
        : '<td class="num">' + money(r.mcap_usd) + '</td>';
      return '<tr class="row" data-slug="' + esc(r.slug) + '">' + rankCell +
        '<td><b>' + esc(r.name) + '</b><br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td><span class="cat">' + esc(r.category) + '</span></td>' +
        '<td><span class="chains">' + esc(chainList(r.chains)) + '</span></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageFmt(r.age_days) + '</td>' + valCell +
        '<td>' + (tab === 'board' ? '<span class="pill">farm plan</span>' : '<span class="pill">live</span>') + '</td></tr>';
    }).join('');
    $('empty').hidden = list.length > 0;
    $('count').textContent = list.length + ' of ' + (tab === 'board' ? rows.length : live.length) + ' shown';
    var th = document.querySelector('th[data-k="implied"]');
    if (th) th.textContent = tab === 'board' ? 'Implied value' : 'Market cap';
  }
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr.row');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });

  // ---- detail drawer
  function findRow(slug) {
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) return rows[i];
    for (var j = 0; j < live.length; j++) if (live[j].slug === slug) return live[j];
    return null;
  }
  function openDetail(slug) {
    var r = findRow(slug);
    if (!r) return;
    var d = $('detail');
    var m = r.model;
    var mult = D.multiples && D.multiples[r.category] != null ? D.multiples[r.category] : D.global_multiple;
    var fallback = D.multiples && D.multiples[r.category] == null;
    var head = '<h2>' + esc(r.name) + '</h2>' +
      '<p class="meta">' + esc(r.slug) + ' · ' + esc(r.category) + ' · ' + esc(chainList(r.chains)) +
      ' · TVL ' + money(r.tvl_usd) + ' · age ' + ageFmt(r.age_days) + '</p>';
    if (tab === 'board' || r.token_status === 'pre-token') {
      var steps = (r.farm_steps || []).map(function (s, i) {
        var parts = s.split('Cost:');
        var body = parts[0].trim();
        var ct = parts[1] ? 'Cost:' + parts[1] : '';
        return '<li><b>Step ' + (i + 1) + '.</b> ' + esc(body) +
          (ct ? '<span class="ct">' + esc(ct) + '</span>' : '') + '</li>';
      }).join('');
      d.innerHTML = head +
        '<p class="big">' + money(r.implied_value_usd) + '</p>' +
        '<p class="meta">Implied value if ' + esc(r.name) + ' issued a token on this record.</p>' +
        '<h3>How the value breaks down</h3>' +
        '<div class="math">' + money(r.tvl_usd) + ' TVL<br>' +
        '× <b>' + m.base_multiple.toFixed(3) + '</b> <span class="eq">' + esc(r.category) + ' comparable multiple' + (fallback ? ' (global median — too few live protocols in this category to use its own)' : '') + '</span><br>' +
        '× <b>' + m.growth_multiplier.toFixed(3) + '</b> <span class="eq">growth (' + (m.growth_pct > 0 ? '+' : '') + m.growth_pct.toFixed(1) + '% 7d, clamped −60…+120, weight 0.5)</span><br>' +
        '× <b>' + m.maturity_multiplier.toFixed(3) + '</b> <span class="eq">maturity (' + m.age_days + ' days)</span><br>' +
        '× <b>' + m.chain_multiplier.toFixed(3) + '</b> <span class="eq">chains (' + (r.chains || []).length + ')</span><br>' +
        '= <b>' + money(r.implied_value_usd) + '</b></div>' +
        '<h3>Farm plan — 6 steps</h3><ol class="farm">' + steps + '</ol>';
    } else {
      d.innerHTML = head +
        '<p class="big">' + money(r.mcap_usd) + '</p>' +
        '<p class="meta">Market cap — this token already trades, so it is shown for comparison only and never ranked.</p>' +
        '<div class="math">mcap / TVL = <b>' + (r.mcap_usd / r.tvl_usd).toFixed(3) + '</b> <span class="eq">(one of the live comparables behind the ' + esc(r.category) + ' multiple of ' + mult.toFixed(3) + ')</span></div>';
    }
    $('drawer').hidden = false;
    if (history.replaceState) history.replaceState(null, '', '#detail-' + r.slug);
  }
  function closeDetail() {
    $('drawer').hidden = true;
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
  }
  $('close').addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });

  // ---- controls
  $('q').addEventListener('input', function () { state.q = this.value; render(); });
  $('fCat').addEventListener('change', function () { state.cat = this.value; render(); });
  $('fChain').addEventListener('change', function () { state.chain = this.value; render(); });
  $('fSort').addEventListener('change', function () { state.sort = this.value; render(); });
  document.querySelectorAll('th[data-k]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      state.sort = k === 'rank' ? 'rank' : k === 'tvl' ? 'tvl' : k === 'chg' ? 'chg' : k === 'age' ? 'age' : 'implied';
      $('fSort').value = state.sort;
      render();
    });
  });
  function setTab(t) {
    tab = t;
    $('tabBoard').classList.toggle('on', t === 'board');
    $('tabLive').classList.toggle('on', t === 'live');
    render();
  }
  $('tabBoard').addEventListener('click', function () { setTab('board'); });
  $('tabLive').addEventListener('click', function () { setTab('live'); });

  // ---- methodology: category multiples
  var mlist = Object.keys(D.multiples || {}).sort(function (a, b) { return D.multiples[b] - D.multiples[a]; })
    .slice(0, 12).map(function (c) { return c + ' ' + D.multiples[c].toFixed(3); }).join(' · ');
  $('mults').textContent = 'Top category multiples (median live mcap/TVL): ' + mlist +
    ' · global median ' + (D.global_multiple || 0).toFixed(3) + '.';

  // ---- deep links: #detail-<slug>, #category-<name>, #tab-live
  var h = location.hash || '';
  if (h.indexOf('#detail-') === 0) { openDetail(h.slice(8)); }
  else if (h.indexOf('#category-') === 0) {
    var c = decodeURIComponent(h.slice(10));
    state.cat = c; $('fCat').value = c;
  } else if (h === '#tab-live') { setTab('live'); }
  render();
})();
