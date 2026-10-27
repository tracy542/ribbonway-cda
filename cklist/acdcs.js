/* ACDCS layout for every Blue Ribbon state deal checklist (/cklist/<state>/).
   Loaded after each state page's own script. It replaces render() so every state
   shows the same five stages: Agency, Contract, Diligence, Closeout, Stewardship.
   It also adds the Required column, collapsible stages that close when finished,
   and the "Generate PDF package" buttons at the top. */
(function () {
  "use strict";

  // Stage titles per side (same wording as the WV page, which was built ACDCS-first).
  const STAGES = {
    buyer: [
      "A · Agency — first meeting with the buyer",
      "C · Contract — writing each offer",
      "D · Diligence — ratified to clear to close",
      "C · Closeout — settlement",
      "S · Stewardship — after closing"
    ],
    listing: [
      "A · Agency — listing appointment",
      "C · Contract — each offer received",
      "D · Diligence — ratified to clear to close",
      "C · Closeout — settlement",
      "S · Stewardship — after closing"
    ],
    rental: [
      "A · Agency — first meeting with the client",
      "C · Contract — the lease",
      "D · Diligence — application to move-in",
      "C · Closeout — move-in and funds",
      "S · Stewardship — after move-in"
    ]
  };

  // Brokerage workflow steps the WV page already has; added to the other states so all match.
  // Each entry: [stage index, item]. Item = [name, when, source, key questions, form].
  const CDA = { label: "Open CDA", url: "https://cda.ribbonway.com" };
  const EXTRA = {
    buyer: [
      [1, ["Ratified: everyone signed, ratification date filled in, copies to buyer and listing agent", "", "Brokerage policy", null, { label: "Not a form" }]],
      [1, ["Start the CDA at cda.ribbonway.com", "Within 24 hours of ratification", "Brokerage policy", null, CDA]],
      [3, ["Submit the CDA to the broker", "", "Brokerage policy", null, CDA]],
      [4, ["Client loaded to FUB and myWeichert with the house address and a market report", "", "Brokerage policy", null, { label: "Not a form" }]],
      [4, ["TPMCO.com marketing — strongly recommend you do this for each closed buyer", "", "Brokerage policy (strongly recommended)", null, { label: "Open TPMCO", url: "https://tpmco.com" }]]
    ],
    listing: [
      [0, ["Start the CDA at cda.ribbonway.com", "Within 24 hours of the listing agreement", "Brokerage policy", null, CDA]],
      [1, ["MLS sheet in the offer package", "If missing: attach current sheet, seller signs, buyer initials", "Brokerage policy", null, { label: "From Bright MLS" }]],
      [1, ["Ratified: everyone signed, ratification date filled in, copies to seller and buyer agent", "", "Brokerage policy", null, { label: "Not a form" }]],
      [3, ["Submit the CDA to the broker", "", "Brokerage policy", null, CDA]],
      [4, ["Client loaded to FUB and myWeichert with their new address and a market report", "", "Brokerage policy", null, { label: "Not a form" }]]
    ],
    rental: [
      [1, ["Start the CDA at cda.ribbonway.com", "Within 24 hours of the signed lease", "Brokerage policy", null, CDA]],
      [3, ["Submit the CDA to the broker", "", "Brokerage policy", null, CDA]]
    ]
  };

  // Which stage an existing item belongs in (for the states that were sorted by category).
  function stageOf(name, when, side) {
    const n = name.toLowerCase(), w = (when || "").toLowerCase();
    if (/walk-through|closing disclosure|alta settlement|post-settlement|security deposit|first month/.test(n) ||
        /at closeout|before closing|after settlement/.test(w)) return 3;
    if (side === "rental") {
      return /agency agreement|affiliated business|equal housing|mls printout|tax or public record/.test(n) ? 0 : 1;
    }
    if (side === "listing") {
      if (/dual agency|dual or designated/.test(n)) return 1;
      if (/resale certificate|order for poa/.test(n)) return 2;
      return 0;
    }
    if (/brokerage agreement|buyer agency|right to represent|consumer notice|understanding whom|affiliated business|equal housing|office fee disclosure/.test(n)) return 0;
    if (/water quality|utility cost|loan financing information|earnest money|home warranty|resale documents|disclosure packet acknowledgment/.test(n)) return 2;
    return 1;
  }

  // Required column: "Yes" for every deal, "If: ..." when it only applies sometimes.
  // Timing notes ("Within 24 hours", "Before closing") are still required — they stay as a note.
  const TIMING = /^(every|before|after|within|at |once|nothing|seller may|seller provides|signed before|if missing|unless)/i;
  function required(when) {
    if (!when) return { label: "Yes", cls: "yes", note: "" };
    if (TIMING.test(when)) return { label: /^unless/i.test(when) ? "Yes, unless exempt" : "Yes", cls: "yes", note: when };
    return { label: "If: " + when, cls: "if", note: "" };
  }

  function buildStages(st, side, cty) {
    const d = DATA[st];
    if (d.workflow) return d[side].map(g => ({ title: g.title, items: g.items.slice() }));
    const src = [...(d[side] || [])];
    if (st === "MD" && d.county && d.county[cty] && d.county[cty][side]) src.push(d.county[cty][side]);
    if (side === "buyer" && typeof BROKERAGE_BUYER !== "undefined") src.push(BROKERAGE_BUYER);
    if (side === "listing" && typeof BROKERAGE_LISTING !== "undefined") src.push(BROKERAGE_LISTING);
    const out = STAGES[side].map(t => ({ title: t, items: [] }));
    const seen = new Set();
    src.forEach(g => g && g.items && g.items.forEach(it => {
      const k = it[0].toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out[stageOf(it[0], it[1], side)].items.push(it);
    }));
    (EXTRA[side] || []).forEach(([s, it]) => out[s].items.push(it));
    return out;
  }

  // Which sections are open. First unfinished stage opens; finished stages close.
  const openState = new Map();
  let current = [];

  function cellsFor(it, side) {
    const f = it[4] || null;
    const vid = it[5] || (typeof findTraining === "function" ? findTraining(it[0]) : "");
    const fl = (f && f.url) ? null : findForms(it[0], side);
    const form = fl ? fl.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join("<br>")
      : f && f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.label || "Open form")}</a>`
      : `<span class="soon">${esc((f && f.label) || "Form – link coming")}</span>`;
    const train = vid ? `<a href="${esc(vid)}" target="_blank" rel="noopener">${typeof findTraining === "function" ? "Open guide" : "Watch"}</a>`
      : `<span class="soon">Coming soon</span>`;
    return { form, train, links: fl ? fl : (f && f.url ? [{ label: f.label || "Open form", url: f.url }] : []) };
  }

  window.render = function render() {
    const st = $("state").value, cty = $("county") ? $("county").value : "";
    const d = DATA[st];
    if (!d[$("side").value]) $("side").value = $("side").options[0].value;
    const side = $("side").value;
    if ($("countyWrap")) $("countyWrap").hidden = st !== "MD";
    $("draftNote").hidden = !d.draft;
    current = buildStages(st, side, cty);

    let html = "";
    current.forEach((g, gi) => {
      const sk = `${st}|${side}|${cty}|${gi}`;
      const total = g.items.length;
      const done = g.items.filter((_, ii) => checked.has(`${sk}|${ii}`)).length;
      const complete = total > 0 && done === total;
      let open = openState.has(sk) ? openState.get(sk) : null;
      if (open === null) {
        const firstOpen = current.findIndex((x, xi) => x.items.some((_, ii) => !checked.has(`${st}|${side}|${cty}|${xi}|${ii}`)));
        open = gi === firstOpen;
      }
      html += `<details class="stage${complete ? " complete" : ""}" data-sk="${sk}" data-gi="${gi}"${open ? " open" : ""}>` +
        `<summary><span class="stitle">${esc(g.title)}</span><span class="scount">${total ? `${done} of ${total}` : "Nothing to file here yet"}</span></summary>`;
      if (total) {
        html += `<div class="thead"><span>Document</span><span>Required</span><span>Form</span><span>Training</span></div><ul>`;
        g.items.forEach((it, ii) => {
          const key = `${sk}|${ii}`, on = checked.has(key), r = required(it[1]), c = cellsFor(it, side);
          html += `<li class="${on ? "done" : ""}"><div class="row"><label>
<input type="checkbox" data-key="${key}" ${on ? "checked" : ""}>
<span><span class="name">${esc(it[0])}</span>${r.note ? `<span class="when">${esc(r.note)}</span>` : ""}<span class="src">${esc(it[2])}</span></span></label>
<div class="cell req ${r.cls}"><span class="clab">Required</span>${esc(r.label)}</div>
<div class="cell form"><span class="clab">Form</span>${c.form}</div>
<div class="cell vid"><span class="clab">Training</span>${c.train}</div></div>${it[3] ? `<details class="kq"><summary>Key questions</summary><ul>${it[3].map(q => `<li>${esc(q)}</li>`).join("")}</ul></details>` : ""}</li>`;
        });
        html += `</ul>`;
      }
      html += `</details>`;
    });
    $("lists").innerHTML = html;
    updateProgress();
    const q = new URLSearchParams({ side, ...(st === "MD" ? { county: cty } : {}) });
    history.replaceState(null, "", "?" + q.toString());
  };

  // Remember manual open/close.
  $("lists").addEventListener("toggle", e => {
    const s = e.target;
    if (s.classList && s.classList.contains("stage")) openState.set(s.dataset.sk, s.open);
  }, true);

  // When the last box in a stage is checked: close it and open the next unfinished stage.
  $("lists").addEventListener("change", e => {
    const b = e.target;
    if (!b.dataset || !b.dataset.key) return;
    const sec = b.closest("details.stage");
    const boxes = [...sec.querySelectorAll(":scope > ul > li input[type=checkbox]")];
    const done = boxes.filter(x => x.checked).length;
    sec.querySelector(".scount").textContent = `${done} of ${boxes.length}`;
    const complete = done === boxes.length;
    sec.classList.toggle("complete", complete);
    if (complete && b.checked) {
      sec.open = false;
      openState.set(sec.dataset.sk, false);
      let next = sec.nextElementSibling;
      while (next && (next.classList.contains("complete") || !next.querySelector("input"))) next = next.nextElementSibling;
      if (next) {
        next.open = true;
        openState.set(next.dataset.sk, true);
        next.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  });

  // Print shows everything.
  window.addEventListener("beforeprint", () => document.querySelectorAll("#lists details.stage").forEach(s => s.open = true));

  /* ---------- Generate PDF package ---------- */
  const PACKAGES = [
    { id: "agency", label: "Buyer Agency package", side: "buyer", stage: 0 },
    { id: "offer", label: "Offer package", side: "buyer", stage: 1 },
    { id: "listing", label: "Listing package", side: "listing", stage: 0 }
  ];

  function loadPdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    return new Promise((ok, bad) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";
      s.onload = () => ok(window.PDFLib);
      s.onerror = () => bad(new Error("Could not load the PDF tool. Check your connection and try again."));
      document.head.appendChild(s);
    });
  }

  // pdf-lib's built-in font only knows plain characters; swap the fancy ones.
  const plain = s => String(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/·/g, "-").replace(/[^\x20-\x7e]/g, "");

  async function generate(pkg) {
    const status = $("pkgStatus");
    const st = $("state").value, cty = $("county") ? $("county").value : "";
    const stages = buildStages(st, pkg.side, cty);
    const items = stages[pkg.stage].items;
    status.textContent = `Building your ${pkg.label}…`;
    try {
      const { PDFDocument, StandardFonts, rgb, PDFName, PDFString } = await loadPdfLib();
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const bold = await doc.embedFont(StandardFonts.HelveticaBold);
      const navy = rgb(0.043, 0.145, 0.251), muted = rgb(0.36, 0.42, 0.49), link = rgb(0.07, 0.23, 0.39);

      // Try to pull each form PDF. Forms on our own site come in; Google Drive forms can't be pulled from a web page, so they stay as links.
      const attach = [];
      for (const it of items) {
        const c = cellsFor(it, pkg.side);
        const local = c.links.find(l => /\.pdf($|\?)/i.test(l.url) && (l.url.startsWith("/") || l.url.startsWith(location.origin)));
        let included = false;
        if (local) {
          try {
            const bytes = await (await fetch(local.url)).arrayBuffer();
            const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
            attach.push(src);
            included = true;
          } catch (e) { /* stays a link */ }
        }
        it._pkg = { included, links: c.links, req: required(it[1]) };
      }

      // Cover sheet(s): every document in the stage, in order, with Required and where to get it.
      let page = doc.addPage([612, 792]), y = 740;
      const stateName = document.title.replace(/ Deal Checklists?/i, "");
      const ctyName = st === "MD" && $("county") ? " - " + $("county").selectedOptions[0].textContent : "";
      page.drawText(plain(pkg.label), { x: 50, y, size: 22, font: bold, color: navy }); y -= 24;
      page.drawText(plain(`${stateName}${ctyName} - ${stages[pkg.stage].title}`), { x: 50, y, size: 12, font, color: muted }); y -= 16;
      page.drawText(plain(`Weichert, Realtors - Blue Ribbon - generated ${new Date().toLocaleDateString()}`), { x: 50, y, size: 10, font, color: muted }); y -= 26;

      const wrap = (text, f, size, width) => {
        const words = plain(text).split(" "), lines = []; let line = "";
        words.forEach(w => { const t = line ? line + " " + w : w; if (f.widthOfTextAtSize(t, size) > width && line) { lines.push(line); line = w; } else line = t; });
        if (line) lines.push(line);
        return lines;
      };
      const addLink = (pg, x, yy, w, url) => {
        const abs = new URL(url, location.href).href;
        const annot = doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [x, yy - 2, x + w, yy + 10], Border: [0, 0, 0],
          A: { Type: "Action", S: "URI", URI: PDFString.of(abs) } });
        const ref = doc.context.register(annot);
        const annots = pg.node.lookup(PDFName.of("Annots"));
        if (annots) annots.push(ref); else pg.node.set(PDFName.of("Annots"), doc.context.obj([ref]));
      };

      items.forEach((it, i) => {
        const nameLines = wrap(`${i + 1}. ${it[0].replace(/^\d+\.\s*/, "")}`, bold, 11.5, 500);
        const need = 16 * nameLines.length + 34 + 14 * Math.max(1, it._pkg.links.length);
        if (y - need < 50) { page = doc.addPage([612, 792]); y = 740; }
        nameLines.forEach(l => { page.drawText(l, { x: 50, y, size: 11.5, font: bold, color: rgb(0, 0, 0) }); y -= 15; });
        page.drawText(plain(`Required: ${it._pkg.req.label}${it._pkg.req.note ? " (" + it._pkg.req.note + ")" : ""}`), { x: 62, y, size: 10, font, color: muted }); y -= 14;
        if (it._pkg.included) { page.drawText("Included in this package", { x: 62, y, size: 10, font: bold, color: rgb(0.11, 0.48, 0.24) }); y -= 14; }
        else if (it._pkg.links.length) {
          it._pkg.links.forEach(l => {
            const t = plain(`Open: ${l.label}`);
            page.drawText(t, { x: 62, y, size: 10, font, color: link });
            addLink(page, 62, y, font.widthOfTextAtSize(t, 10), l.url);
            y -= 14;
          });
        } else { page.drawText(plain(`Get it from: ${(it[4] && it[4].label) || it[2]}`), { x: 62, y, size: 10, font, color: muted }); y -= 14; }
        y -= 10;
      });

      for (const src of attach) {
        const pages = await doc.copyPages(src, src.getPageIndices());
        pages.forEach(p => doc.addPage(p));
      }

      const bytes = await doc.save();
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = plain(`${st} ${pkg.label}${ctyName}.pdf`).replace(/\s+/g, " ");
      document.body.appendChild(a); a.click(); a.remove();
      window.open(url, "_blank");
      const inc = items.filter(it => it._pkg.included).length;
      status.textContent = `${pkg.label} ready: ${items.length} documents listed in order, ${inc} form${inc === 1 ? "" : "s"} built in. The rest are listed with their link or where to get them.`;
    } catch (e) {
      status.textContent = "Couldn't build the package: " + e.message;
    }
  }

  function addPackageBar() {
    const bar = document.createElement("div");
    bar.className = "pkgbar";
    bar.innerHTML = `<span class="pkgtitle">Generate PDF package</span>` +
      PACKAGES.map(p => `<button type="button" class="primary pkg" data-pkg="${p.id}">${esc(p.label)}</button>`).join("") +
      `<span id="pkgStatus" class="pkgstatus" role="status"></span>`;
    const anchor = document.querySelector(".pickers");
    anchor.parentNode.insertBefore(bar, anchor);
    bar.addEventListener("click", e => {
      const b = e.target.closest("button.pkg");
      if (!b) return;
      const pkg = PACKAGES.find(p => p.id === b.dataset.pkg);
      if ([...$("side").options].some(o => o.value === pkg.side) && $("side").value !== pkg.side) { $("side").value = pkg.side; render(); }
      generate(pkg);
    });
  }

  function addStyles() {
    const css = `
.pkgbar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;background:var(--card);border:2px solid var(--gold);border-radius:8px;padding:12px 16px;margin:0 0 16px}
.pkgtitle{font-weight:800;color:var(--navy);font-size:18px;margin-right:4px}
.pkgbar button{font-size:17px}
.pkgstatus{flex-basis:100%;color:var(--muted);font-size:15px}
.pkgstatus:empty{display:none}
details.stage{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:0 16px;margin-bottom:14px}
details.stage > summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 0;color:var(--navy);font-size:20px;font-weight:700}
details.stage > summary::-webkit-details-marker{display:none}
details.stage > summary::before{content:"\\25B8";font-size:16px;transition:transform .15s}
details.stage[open] > summary::before{transform:rotate(90deg)}
details.stage .scount{margin-left:auto;font-size:15px;color:var(--muted);font-weight:700;white-space:nowrap}
details.stage.complete > summary .scount{color:var(--ok)}
details.stage.complete > summary .scount::before{content:"\\2713  "}
details.stage[open]{padding-bottom:6px}
.row,.thead{grid-template-columns:minmax(0,1fr) 150px 190px 120px}
.cell.req{font-weight:700}
.cell.req.yes{color:var(--ok)}
.cell.req.if{color:var(--warn)}
@media (max-width:640px){.row{grid-template-columns:1fr}.pkgbar button{flex:1 1 100%}}
@media print{.pkgbar{display:none}details.stage > summary::before{content:none}.row,.thead{grid-template-columns:minmax(0,1fr) 140px 190px}}
`;
    const s = document.createElement("style");
    s.textContent = css;
    document.head.appendChild(s);
  }

  addStyles();
  addPackageBar();
  render();
})();
