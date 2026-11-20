/* Presentation-only enhancements for window.RADAR. No network, ranking, valuation or farm math changes. */
(function () {
  'use strict';
  const data = window.RADAR;
  const root = document.getElementById('board');
  if (!data || !root) return;
  const n = v => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
  const number = v => n(v) === null ? '—' : Math.round(n(v)).toLocaleString('en-US');
  const percent = v => n(v) === null ? 'N/A' : Number(v).toFixed(1) + '%';
  const safePct = v => n(v) === null ? 0 : Math.max(0, Math.min(100, Number(v)));
  const el = (tag, cls, txt) => { const x = document.createElement(tag); if (cls) x.className = cls; if (txt != null) x.textContent = txt; return x; };
  const sample = Array.isArray(data.rows) && data.board_size > data.rows.length;
  const stamp = document.getElementById('snapshot-date');
  if (stamp) stamp.textContent = 'SNAPSHOT ' + String(data.as_of || 'UNKNOWN');
  function metric(label, value, note, variant) {
    const card = el('div', 'radar-metric ' + (variant || ''));
    card.append(el('div', 'metric-label', label), el('div', 'metric-value', value), el('div', 'metric-note', note));
    return card;
  }
  function mkPanel(cls, heading, title) {
    const x = el('section', cls);
    const head = el('div', 'insight-heading');
    head.append(el('span', 'eyebrow', heading), el('strong', '', title));
    x.append(head);
    return x;
  }
  function addInsights() {
    const shell = root.querySelector('.shell');
    if (!shell || shell.querySelector('.radar-metrics')) return;
    const title = shell.querySelector('.lede');
    const controls = shell.querySelector('.controls');
    const table = shell.querySelector('.panel.table-wrap') || shell.querySelector('.table-wrap');
    const model = shell.querySelector('.model');
    if (table) (table.closest('.panel') || table).id = 'radar-table';
    if (model) model.id = 'radar-model';

    const kpis = el('section', 'radar-metrics'); kpis.id = 'radar-kpis';
    kpis.setAttribute('aria-label', 'Snapshot metrics');
    kpis.append(
      metric('RANKED PROTOCOLS', number(data.board_size), sample ? 'Sample view · ' + data.rows.length + ' loaded' : 'Snapshot coverage · scored', 'metric-primary'),
      metric('CORE WATCHLIST', number(data.watchlist_size), 'Full watchlist accounted for', ''),
      metric('EARLY RADAR', number(data.early_size), 'Below watchlist TVL floor', ''),
      metric('MODEL E · WITHIN 2×', percent(data.calibration && data.calibration.e_loo_within_2x_pct), 'Leave-one-out · not an accuracy guarantee', 'metric-caution')
    );
    if (title) title.insertAdjacentElement('afterend', kpis);

    const row = el('div', 'insight-grid'); row.id = 'radar-coverage';
    const confidence = mkPanel('model-evidence', 'MODEL VALIDATION', 'Transparent about uncertainty');
    const one = el('div','validation-row');
    one.append(el('span','','Within 2× in leave-one-out'),el('strong','',percent(data.calibration && data.calibration.e_loo_within_2x_pct)));
    const track = el('div','validation-track'); const fill = el('span',''); fill.style.width = safePct(data.calibration && data.calibration.e_loo_within_2x_pct) + '%'; track.append(fill);
    const two = el('div','validation-row small');
    two.append(el('span','','P25–P75 coverage'),el('strong','',percent(data.calibration && data.calibration.e_loo_p25_p75_cov_pct)));
    const track2 = el('div','validation-track faint'); const fill2 = el('span',''); fill2.style.width = safePct(data.calibration && data.calibration.e_loo_p25_p75_cov_pct) + '%'; track2.append(fill2);
    confidence.append(one,track,two,track2);
    const mae = el('div','validation-row small');
    mae.append(el('span','','Mean absolute error (log)'),el('strong','', (data.calibration && Number.isFinite(Number(data.calibration.e_loo_mae_log))) ? Number(data.calibration.e_loo_mae_log).toFixed(3) : 'N/A'));
    confidence.append(mae);
    const note = el('p','validation-note', 'Model E, leave-one-out on the snapshot\'s token-bearing protocols. Single-snapshot backtest, not evidence of future token issuance.'); confidence.append(note);

    const coverage = mkPanel('pipeline-overview', 'DATA COVERAGE', 'One snapshot, separate populations');
    const overview = el('div','coverage-stats');
    overview.append(
      (() => {const x=el('div','coverage-stat'); x.append(el('b','',number(data.watchlist_size)),el('span','','Core watchlist'));return x;})(),
      (() => {const x=el('div','coverage-stat'); x.append(el('b','',number(data.early_size)),el('span','','Early radar'));return x;})(),
      (() => {const x=el('div','coverage-stat'); x.append(el('b','',number(data.live_size)),el('span','','Token live'));return x;})(),
      (() => {const x=el('div','coverage-stat'); x.append(el('b','',number(data.calibration && data.calibration.n)),el('span','','Calibration set'));return x;})()
    );
    const bar = el('div','coverage-track'); const a = el('i',''); const b=el('i','');
    const total = Math.max(1,Number(data.board_size)||1); a.style.width=(Math.min(100,100*(Number(data.watchlist_size)||0)/total))+'%';b.style.width=(Math.max(0,100-100*(Number(data.watchlist_size)||0)/total))+'%';bar.append(a,b);
    const disclaimer = el('div','coverage-caption', sample ? 'DESIGN PREVIEW — sample protocol rows, not the full board.' : 'Snapshot figures are offline and reproducible.');
    coverage.append(overview,bar,disclaimer);
    row.append(confidence,coverage); if (kpis.parentNode) kpis.insertAdjacentElement('afterend',row);

    if (controls) {
      const tableLabel=el('div','table-heading');tableLabel.append(el('div','',null),el('span','table-eyebrow','RANKING DESK'));
      const big=el('div','table-heading-copy');big.append(el('strong','','Protocol intelligence'),el('small','','Select any row to inspect valuation, model inputs and farming scenarios.'));
      tableLabel.firstChild.append(big);
      controls.insertAdjacentElement('beforebegin',tableLabel);
    }
    if (sample && !document.getElementById('sample-ribbon')) {
      const ribbon=el('div','sample-ribbon','SAMPLE DATA PREVIEW · NOT FOR SUBMISSION');ribbon.id='sample-ribbon';document.body.append(ribbon);
    }
  }
  new MutationObserver(addInsights).observe(root,{childList:true,subtree:false});
  addInsights();
  document.querySelectorAll('.side-link[data-scroll]').forEach(function (button) {
    button.addEventListener('click',function(){
      const dst = document.getElementById(button.dataset.scroll);
      if(dst) {dst.scrollIntoView({behavior:'smooth',block:'start'});document.querySelectorAll('.side-link').forEach(x=>x.classList.remove('active'));button.classList.add('active');}
    });
  });
})();
