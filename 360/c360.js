/* Client 360 · Blue Ribbon · v1 10/31/2026
   Runs on our IDX Broker site (blueribbon.idxbroker.com) so it can read listing pages directly.
   Flow: agent types Agent ID + MLS #  ->  read IDX listing page  ->  build a Bright-style one-page PDF
         ->  open it in a new tab  ->  Make C360-003 emails it to the agent's roster email.
   Make bots:  C360-001 roster lookup (name, phone, email only)   C360-003 email the PDF            */
(function () {
  'use strict';

  // ---- Settings Tracy may change ----
  var ROSTER_URL = 'https://hook.us2.make.com/vzcb3ya13oubdr290jxgisqiw5s7qyse'; // C360-001
  var EMAIL_URL  = 'https://hook.us2.make.com/ryo0uyub2rvy3718xkup3aen5ez957p1'; // C360-003
  var IDX_ID     = 'b004';   // Bright MLS on IDX Broker
  var ASSET_BASE = 'https://cda.ribbonway.com/360/';
  var BANNER_LINK = 'https://mymortgage.revolutionmortgage.com/homehub/signup/hadams@revolutionmortgage.com';
  var COMPANY    = 'Weichert, Realtors® – Blue Ribbon';
  var KEY        = 'c360_agent_id'; // remembers the Agent ID on this computer

  var LIBS = [
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
  ];

  // ---------- small helpers ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function loadScript(src) { return new Promise(function (ok, bad) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { bad(new Error('Could not load ' + src)); }; document.head.appendChild(s); }); }
  var libsReady = null;
  function libs() { if (!libsReady) libsReady = LIBS.reduce(function (p, src) { return p.then(function () { return loadScript(src); }); }, Promise.resolve()); return libsReady; }
  function blobToDataURL(b) { return new Promise(function (ok, bad) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = bad; r.readAsDataURL(b); }); }
  function imgData(url) { return fetch(url, { mode: 'cors' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.blob(); }).then(blobToDataURL); }
  function cap(v) { v = String(v || '').trim(); if (/^yes$/i.test(v)) return 'Yes'; if (/^no$/i.test(v)) return 'No'; return v; }
  function cleanMls(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

  // ---------- 1. read the IDX listing page ----------
  function readListing(mls) {
    return fetch('/idx/details/listing/' + IDX_ID + '/' + mls, { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('not found'); return r.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        if (!doc.querySelector('.IDX-fieldContainer')) throw new Error('not found');
        var F = {}, order = [];
        doc.querySelectorAll('.IDX-fieldContainer').forEach(function (c) {
          var sec = ((c.querySelector('h2,h3,h4') || {}).textContent || '').trim();
          c.querySelectorAll('.IDX-field').forEach(function (f) {
            var l = ((f.querySelector('.IDX-label') || {}).textContent || '').trim();
            var v = ((f.querySelector('.IDX-text') || {}).textContent || '').replace(/\s+/g, ' ').trim();
            if (!l || !v) return;
            // same label twice: keep the real value over a bare yes/no (e.g. Association Recreation Fee)
            if (F[l] && !/^(y|n|yes|no)$/i.test(F[l].v) && /^(y|n|yes|no)$/i.test(v)) return;
            if (!F[l]) order.push(l);
            F[l] = { v: v, sec: sec };
          });
        });
        var addrRaw = ((doc.querySelector('#IDX-detailsAddress') || {}).textContent || '').replace(/\s+/g, ' ').trim();
        var addr = addrRaw.replace(/,?\s*[A-Za-z .]+?\s+([A-Z]{2})\s*(\d{5})(-\d{4})?\s*$/, ', $1 $2');
        var remarks = ((doc.querySelector('#IDX-description') || {}).textContent || '').replace(/\s+/g, ' ').trim();
        var photo = null;
        doc.querySelectorAll('img').forEach(function (i) {
          var s = i.getAttribute('src') || i.getAttribute('data-src') || '';
          if (!photo && /bright-media/.test(s)) photo = s;
        });
        var map = doc.querySelector('[data-lat]');
        var lat = map ? parseFloat(map.getAttribute('data-lat')) : NaN;
        var lng = map ? parseFloat(map.getAttribute('data-lng') || map.getAttribute('data-lon')) : NaN;
        // Bright/IDX disclaimer, word for word from the page
        var disc = '';
        doc.querySelectorAll('div,p,span,section').forEach(function (e) {
          var t = e.textContent.replace(/\s+/g, ' ').trim();
          if (/All rights reserved/i.test(t) && /Bright MLS/i.test(t) && (!disc || t.length < disc.length)) disc = t;
        });
        var courtesy = ((disc || doc.body.textContent).match(/Listing courtesy of[^.\n]*/i) || [''])[0].trim();
        var status = F['Status'] ? F['Status'].v : '';
        return { mls: mls, F: F, order: order, addr: addr || addrRaw, remarks: remarks, photo: photo, lat: lat, lng: lng, disc: disc, courtesy: courtesy, status: status };
      });
  }

  // ---------- 2. roster lookup (Make C360-001) ----------
  function readAgent(id) {
    id = String(id || '').replace(/[^0-9]/g, '');
    if (!id) return Promise.resolve(null);
    return fetch(ROSTER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent_id: id }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { return d && d.agent && d.agent.found ? { id: id, name: d.agent.name, phone: d.agent.phone, email: d.agent.email } : null; })
      .catch(function () { return null; });
  }

  // ---------- 3. small street map from OpenStreetMap tiles ----------
  function mapImage(lat, lng) {
    if (!isFinite(lat) || !isFinite(lng)) return Promise.resolve(null);
    var z = 15, n = Math.pow(2, z);
    var xf = (lng + 180) / 360 * n;
    var yf = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n;
    var x0 = Math.floor(xf) - 1, y0 = Math.floor(yf) - 1;
    var cv = document.createElement('canvas'); cv.width = 768; cv.height = 768;
    var ctx = cv.getContext('2d');
    var jobs = [];
    for (var dx = 0; dx < 3; dx++) for (var dy = 0; dy < 3; dy++) (function (dx, dy) {
      jobs.push(new Promise(function (ok) {
        var im = new Image(); im.crossOrigin = 'anonymous';
        im.onload = function () { ctx.drawImage(im, dx * 256, dy * 256); ok(); };
        im.onerror = function () { ok(); };
        im.src = 'https://tile.openstreetmap.org/' + z + '/' + (x0 + dx) + '/' + (y0 + dy) + '.png';
      }));
    })(dx, dy);
    return Promise.all(jobs).then(function () {
      var px = (xf - x0) * 256, py = (yf - y0) * 256, W = 440, H = 280;
      var out = document.createElement('canvas'); out.width = W; out.height = H;
      var o = out.getContext('2d');
      o.drawImage(cv, px - W / 2, py - H / 2, W, H, 0, 0, W, H);
      // pin
      o.fillStyle = '#d93025'; o.beginPath(); o.arc(W / 2, H / 2 - 18, 11, 0, Math.PI * 2); o.fill();
      o.beginPath(); o.moveTo(W / 2 - 9, H / 2 - 12); o.lineTo(W / 2 + 9, H / 2 - 12); o.lineTo(W / 2, H / 2 + 4); o.fill();
      o.fillStyle = '#fff'; o.beginPath(); o.arc(W / 2, H / 2 - 18, 4, 0, Math.PI * 2); o.fill();
      o.fillStyle = 'rgba(255,255,255,.85)'; o.fillRect(W - 168, H - 16, 168, 16);
      o.fillStyle = '#333'; o.font = '11px Arial'; o.fillText('© OpenStreetMap contributors', W - 162, H - 4);
      try { return out.toDataURL('image/png'); } catch (e) { return null; }
    });
  }

  // ---------- 4. build the report (Bright Client 360 look) ----------
  var SKIP = /Source$|Units$|^Year Assessed$|^Property Manager|^Story List$|^Automatically Update Tax Values$|^Listing ID$|^Status$|^Price$|^Country$/i;

  function buildReport(L, agent, imgs) {
    var F = L.F, used = {};
    function get(label) { var f = F[label]; if (!f) return ''; used[label] = 1; return cap(f.v); }
    function pair(label, value) { return value ? '<div class="r"><span class="l">' + esc(label) + ':</span><span class="v">' + esc(value) + '</span></div>' : ''; }
    function grid(rows) {
      rows = rows.filter(function (r) { return r[1]; });
      var half = Math.ceil(rows.length / 2), a = '', b = '';
      rows.forEach(function (r, i) { (i < half ? (a += pair(r[0], r[1])) : (b += pair(r[0], r[1]))); });
      return rows.length ? '<div class="g"><div>' + a + '</div><div>' + b + '</div></div>' : '';
    }
    function section(title, rows) { var g = grid(rows); return g ? '<div class="sh">' + esc(title) + '</div>' + g : ''; }
    function rest(secRegex) {
      return L.order.filter(function (l) { return !used[l] && !SKIP.test(l) && secRegex.test(F[l].sec); })
        .map(function (l) { return [l, get(l)]; });
    }

    var price = get('Price'); var type = get('Property Type');
    var summary = [
      ['MLS #', L.mls], ['Ownership Interest', get('Ownership Interest')], ['Structure Type', get('Property Sub Type')],
      ['Levels/Stories', get('Levels Count')], ['Waterfront', get('Waterfront')], ['Garage', get('Garage')],
      ['Beds', get('Bedrooms')], ['Baths', get('Total Baths')], ['Total SQFT', get('Total SqFt') || get('SqFt')],
      ['Price / Sq Ft', (get('Price/SqFt') || '').replace(/^\$/, '')], ['Year Built', get('Year Built')],
      ['Style', get('Architectural Style')], ['Central Air', get('Central Air')], ['Basement', get('Basement')]
    ];
    ['SqFt', 'Full Baths', 'Subdivision'].forEach(function (l) { used[l] = 1; });
    var loc = [
      ['County', get('County')], ['In City Limits', get('In City Limits')], ['Subdiv / Neigh', F['Subdivision'] ? cap(F['Subdivision'].v) : ''],
      ['Zoning', get('Zoning')], ['Acres', get('Acres')], ['School District', get('School District Name')], ['HOA', get('HOA')],
      ['Condo/Co-op Association', get('Condo/Co-op Association')], ['Senior Community', get('Senior Community')]
    ].filter(function (r) { return r[1]; });
    var taxes = [
      ['Tax Annual Amount', get('Tax Annual Amount')], ['Tax Assessed Value', get('Tax Assessed Value')], ['Tax Year', get('Tax Year')],
      ['Tax Lot', get('Tax Lot')], ['Tax Total Finished SqFt', get('Tax Total Finished SqFt')]
    ];
    var interior = rest(/Interior/i), exterior = rest(/External|Exterior/i);
    var details = rest(/Financial|Additional|Primary|Location|Snapshot/i);

    var locRows = loc.map(function (r) { return '<div class="r2"><span class="l">' + esc(r[0]) + ':</span><span class="v">' + esc(r[1]) + '</span></div>'; }).join('');

    var agentRow = agent
      ? '<b>' + esc(agent.name) + '</b><span>' + COMPANY + '</span>' + (agent.phone ? '<span>' + esc(agent.phone) + '</span>' : '') + (agent.email ? '<span>' + esc(agent.email) + '</span>' : '')
      : '<span>Snapshot provided by <b>' + COMPANY + '</b></span>';

    var now = new Date();
    var prepared = now.toLocaleDateString('en-US') + ' ' + now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    return '' +
      '<div id="c360-page">' +
      (imgs.banner ? '<img id="c360-banner" src="' + imgs.banner + '" alt="Revolution Mortgage">' : '') +
      '<div class="arow"><div class="who">' + agentRow + '</div><div class="brand">Blue <em>Ribbon</em></div></div>' +
      '<div class="t">Client 360</div>' +
      '<div class="hl"><b class="ad">' + esc(L.addr) + '</b><b>' + esc(cap(L.status).replace(/^(\w)(\w*)$/, function (m, a, b) { return a + b.toLowerCase(); })) + '</b><b>' + esc(type) + '</b><b>' + esc(price) + '</b></div>' +
      '<div class="media">' + (imgs.photo ? '<img class="ph" src="' + imgs.photo + '" alt="">' : '<div class="ph"></div>') +
      '<div class="pr"><div class="prh">Public Remarks</div><div class="prt" id="c360-rt">' + esc(L.remarks) + '</div></div></div>' +
      grid(summary) +
      '<div class="sh">Location</div><div class="locwrap"><div class="locg">' + locRows + '</div>' + (imgs.map ? '<img class="map" src="' + imgs.map + '" alt="">' : '') + '</div>' +
      section('Taxes and Assessment', taxes) +
      section('Interior Features', interior) +
      section('Exterior Features', exterior) +
      section('Listing Details', details) +
      '<div class="fine">' + esc(L.disc || ('Listing courtesy of ' + L.courtesy)) + (L.disc && L.courtesy && L.disc.indexOf(L.courtesy) < 0 ? ' ' + esc(L.courtesy) + '.' : '') +
      ' Prepared ' + esc(prepared) + '.</div>' +
      '</div>';
  }

  var REPORT_CSS = '' +
    '#c360-stage{position:fixed;left:-10000px;top:0;width:816px;background:#fff}' +
    '#c360-page{width:816px;padding:24px 40px 20px;background:#fff;color:#111;font:12px/1.3 Arial,Helvetica,sans-serif;box-sizing:border-box}' +
    '#c360-page *{box-sizing:border-box}' +
    '#c360-banner{display:block;width:736px;height:auto;margin:0 0 6px}' +
    '#c360-page .arow{display:flex;justify-content:space-between;align-items:center;background:#0b2545;color:#fff;padding:7px 12px;border-bottom:3px solid #c9a227}' +
    '#c360-page .who{display:flex;gap:14px;flex-wrap:wrap;align-items:baseline;font-size:12.5px}#c360-page .who b{font-size:13.5px}' +
    '#c360-page .brand{font:700 18px Georgia,serif;white-space:nowrap}#c360-page .brand em{font-style:normal;color:#e0b84a}' +
    '#c360-page .t{text-align:center;font-weight:700;font-size:17px;margin:8px 0 2px}' +
    '#c360-page .hl{display:grid;grid-template-columns:2.3fr 1fr 1fr 1fr;border-bottom:1px solid #444;padding-bottom:3px;font-size:12.5px}#c360-page .hl b:last-child{text-align:right}' +
    '#c360-page .media{display:flex;gap:14px;margin:10px 0 10px}' +
    '#c360-page .ph{width:330px;height:250px;object-fit:cover;flex:none;background:#eee}' +
    '#c360-page .pr{flex:1;height:250px;overflow:hidden;background:#f4f6f9;border-left:3px solid #0b2545;padding:8px 10px}' +
    '#c360-page .prh{font-weight:700;margin-bottom:3px}#c360-page .prt{font-size:13px;line-height:1.38}' +
    '#c360-page .g{display:grid;grid-template-columns:1fr 1fr;column-gap:24px;margin-bottom:6px}' +
    '#c360-page .r{display:grid;grid-template-columns:158px 1fr;gap:6px;padding:1px 0}' +
    '#c360-page .l{color:#222}#c360-page .v{color:#000}' +
    '#c360-page .sh{font-weight:700;font-size:13px;border-bottom:1px solid #444;margin:8px 0 4px;padding-bottom:1px}' +
    '#c360-page .locwrap{display:flex;gap:12px;margin-bottom:6px}#c360-page .locg{flex:1;display:grid;grid-template-columns:1fr 1fr;column-gap:16px;align-content:start}' +
    '#c360-page .r2{display:grid;grid-template-columns:108px 1fr;gap:6px;padding:2px 0}' +
    '#c360-page .map{width:220px;height:140px;object-fit:cover;flex:none;border:1px solid #ccc}' +
    '#c360-page .fine{margin-top:10px;border-top:1px solid #bbb;padding-top:5px;font-size:8.5px;line-height:1.35;color:#333}';

  // ---------- 5. make the PDF ----------
  function makePdf(L, agent) {
    var imgs = {};
    var jobs = [
      imgData(ASSET_BASE + 'rev-banner.jpg').then(function (d) { imgs.banner = d; }).catch(function () {}),
      L.photo ? imgData(L.photo).then(function (d) { imgs.photo = d; }).catch(function () {}) : null,
      mapImage(L.lat, L.lng).then(function (d) { imgs.map = d; }).catch(function () {}),
      libs()
    ];
    return Promise.all(jobs).then(function () {
      var stage = $('c360-stage'); if (!stage) { stage = document.createElement('div'); stage.id = 'c360-stage'; document.body.appendChild(stage); }
      stage.innerHTML = buildReport(L, agent, imgs);
      // shrink remarks text until it fits beside the photo
      var box = stage.querySelector('.pr'), rt = $('c360-rt'), fs = 13;
      while (box.scrollHeight > box.clientHeight && fs > 8.5) { fs -= 0.25; rt.style.fontSize = fs + 'px'; }
      var page = $('c360-page');
      var waitImgs = Array.prototype.map.call(page.querySelectorAll('img'), function (im) { return im.complete ? null : new Promise(function (ok) { im.onload = im.onerror = ok; }); });
      return Promise.all(waitImgs).then(function () {
        var banner = $('c360-banner');
        var bannerBox = banner ? { x: banner.offsetLeft, y: banner.offsetTop, w: banner.offsetWidth, h: banner.offsetHeight } : null;
        return window.html2canvas(page, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false }).then(function (canvas) {
          var jsPDF = window.jspdf.jsPDF;
          var pdf = new jsPDF({ unit: 'pt', format: 'letter' });
          var pw = 612, ph = 792, m = 14;
          var W = page.offsetWidth, H = page.offsetHeight;
          var s = Math.min((pw - 2 * m) / W, (ph - 2 * m) / H);
          var ox = (pw - W * s) / 2, oy = m;
          pdf.addImage(canvas.toDataURL('image/jpeg', 0.86), 'JPEG', ox, oy, W * s, H * s);
          if (bannerBox) pdf.link(ox + bannerBox.x * s, oy + bannerBox.y * s, bannerBox.w * s, bannerBox.h * s, { url: BANNER_LINK });
          pdf.setProperties({ title: 'Client 360 – ' + L.addr, subject: 'MLS ' + L.mls, author: agent ? agent.name : COMPANY, creator: 'Blue Ribbon Client 360' });
          stage.innerHTML = '';
          return pdf;
        });
      });
    });
  }

  // ---------- 6. the page ----------
  var UI_CSS = '' +
    '#c360-app{max-width:760px;margin:24px auto 60px;padding:0 16px;font:18px/1.45 "Segoe UI",Arial,sans-serif;color:#18223a}' +
    '#c360-app h1{font:600 30px Georgia,serif;margin:0 0 4px;color:#0b1f3a}' +
    '#c360-app .sub{color:#56607a;margin:0 0 18px}' +
    '#c360-app .box{border-radius:12px;padding:18px 20px;margin-bottom:16px}' +
    '#c360-app .br{background:#0b1f3a;color:#e9eef6;border-bottom:4px solid #c9a227}' +
    '#c360-app .br h2{color:#fff;font:600 21px Georgia,serif;margin:0 0 10px}' +
    '#c360-app .other{background:#fff;border:1px solid #d9dde5}' +
    '#c360-app .other h2{font:600 19px Georgia,serif;margin:0 0 10px;color:#0b1f3a}' +
    '#c360-app .row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}' +
    '#c360-app label{display:block;font-weight:600;font-size:15px;margin-bottom:4px}' +
    '#c360-app input{font:inherit;font-size:19px;padding:9px 12px;border-radius:7px;border:1px solid #b9c3d3;width:210px;max-width:100%;text-transform:uppercase}' +
    '#c360-app button{font:inherit;font-weight:700;padding:10px 20px;border-radius:7px;border:0;background:#c9a227;color:#0b1f3a;cursor:pointer}' +
    '#c360-app button:disabled{opacity:.6;cursor:wait}' +
    '#c360-app .other button{background:#0b1f3a;color:#fff}' +
    '#c360-app .note{font-size:15px;margin:10px 0 0;opacity:.9}' +
    '#c360-app .msg{margin-top:12px;font-size:16px;min-height:1.4em}#c360-app .msg a{color:#e0b84a}#c360-app .other .msg a{color:#1f4fa3}' +
    '#c360-app .err{color:#ff9b8f}#c360-app .other .err{color:#b3261e}';

  function ui() {
    var css = document.createElement('style'); css.textContent = UI_CSS + REPORT_CSS; document.head.appendChild(css);
    var host = document.getElementById('c360-root');
    if (!host) { document.body.innerHTML = ''; host = document.createElement('div'); host.id = 'c360-root'; document.body.appendChild(host); document.body.style.background = '#f5f6f8'; document.body.style.margin = '0'; }
    document.title = 'Client 360 · Blue Ribbon';
    var params = new URLSearchParams(location.search);
    host.innerHTML = '' +
      '<div id="c360-app">' +
      '<h1>Client 360</h1><p class="sub">Type an MLS # and get a one-page listing report, ready to hand a buyer.</p>' +
      '<div class="box br"><h2>Blue Ribbon agents</h2>' +
      '<div class="row"><div><label for="c360-aid">Agent ID</label><input id="c360-aid" inputmode="numeric" autocomplete="off" placeholder="Agent ID"></div>' +
      '<div><label for="c360-mls">MLS #</label><input id="c360-mls" autocomplete="off" placeholder="WVBE2055100"></div>' +
      '<button id="c360-go">Build my Client 360</button></div>' +
      '<p class="note">Your name, phone and email go on the report, it opens here, and a copy is emailed to you. You can also pull Bright’s own Client 360 inside Bright MLS any time.</p>' +
      '<div class="msg" id="c360-msg"></div></div>' +
      '<div class="box other"><h2>Not with Blue Ribbon? Just enter the MLS #</h2>' +
      '<div class="row"><div><label for="c360-mls2">MLS #</label><input id="c360-mls2" autocomplete="off" placeholder="WVBE2055100"></div>' +
      '<button id="c360-go2">Build Client 360</button></div>' +
      '<div class="msg" id="c360-msg2"></div></div>' +
      '</div>';
    var aid = store(KEY); if (aid) $('c360-aid').value = aid;
    if (params.get('mls')) $('c360-mls').value = params.get('mls');
    $('c360-go').onclick = function () { run(true); };
    $('c360-go2').onclick = function () { run(false); };
    $('c360-mls').onkeydown = function (e) { if (e.key === 'Enter') run(true); };
    $('c360-mls2').onkeydown = function (e) { if (e.key === 'Enter') run(false); };
    libs().catch(function () {}); // warm up
  }

  function run(isAgent) {
    var msg = $(isAgent ? 'c360-msg' : 'c360-msg2');
    var btn = $(isAgent ? 'c360-go' : 'c360-go2');
    var mls = cleanMls($(isAgent ? 'c360-mls' : 'c360-mls2').value);
    var aid = isAgent ? $('c360-aid').value.replace(/[^0-9]/g, '') : '';
    if (!mls) { msg.innerHTML = '<span class="err">Type an MLS #.</span>'; return; }
    if (isAgent && !aid) { msg.innerHTML = '<span class="err">Type your Agent ID. Don’t have it? Email Compliance@BlueRibbonRealty.com.</span>'; return; }
    // open the tab now (while the click counts), fill it when the PDF is ready
    var win = window.open('', '_blank');
    if (win) { win.document.write('<p style="font:20px Arial;padding:30px">Building your Client 360…</p>'); }
    btn.disabled = true; msg.textContent = 'Building…';
    var t0 = Date.now();
    Promise.all([readListing(mls), isAgent ? readAgent(aid) : Promise.resolve(null)])
      .then(function (res) {
        var L = res[0], agent = res[1];
        if (isAgent && !agent) { msg.innerHTML = '<span class="err">That Agent ID didn’t match our roster. Building without your name.</span>'; }
        if (isAgent && agent) store(KEY, aid);
        return makePdf(L, agent).then(function (pdf) { return { L: L, agent: agent, pdf: pdf }; });
      })
      .then(function (o) {
        var name = 'Client360_' + o.L.mls + '.pdf';
        var blob = o.pdf.output('blob');
        var url = URL.createObjectURL(blob);
        if (win && !win.closed) win.location.href = url; else window.open(url, '_blank');
        var secs = ((Date.now() - t0) / 1000).toFixed(1);
        var dl = '<a href="' + url + '" download="' + name + '">Download the PDF</a>';
        msg.innerHTML = 'Done in ' + secs + ' seconds. ' + dl + '.';
        if (o.agent && o.agent.email) {
          msg.innerHTML += ' Emailing a copy to ' + esc(o.agent.email) + '…';
          var b64 = o.pdf.output('datauristring').split(',')[1];
          fetch(EMAIL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent_id: o.agent.id, mls: o.L.mls, address: o.L.addr, filename: name, pdf_base64: b64 }) })
            .then(function (r) { return r.json(); })
            .then(function (d) { msg.innerHTML = 'Done in ' + secs + ' seconds. ' + dl + '. ' + (d && d.ok ? 'Emailed to ' + esc(o.agent.email) + '.' : '<span class="err">The email didn’t go. Download it above.</span>'); })
            .catch(function () { msg.innerHTML = 'Done in ' + secs + ' seconds. ' + dl + '. <span class="err">The email didn’t go. Download it above.</span>'; });
        }
      })
      .catch(function (e) {
        if (win && !win.closed) win.close();
        msg.innerHTML = '<span class="err">' + (/not found/.test(e.message) ? 'We couldn’t find MLS # ' + esc(mls) + '. Check the number. Listings that aren’t shown on the internet won’t come up.' : 'Something went wrong. Try again in a minute.') + '</span>';
      })
      .then(function () { btn.disabled = false; });
  }

  window.C360 = { ui: ui, readListing: readListing, readAgent: readAgent, makePdf: makePdf };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ui); else ui();
})();
