
export function initAnalysis(graph, { color, esc }) {
  const tip = d3.select("#tip");
  const fmt = (n) => n.toLocaleString();

  const overlay = document.getElementById("analysis");
  const tabBar = document.getElementById("aTabs");
  const body = document.getElementById("aBody");

  const TABS = [
    ["insights", "Insights"],
    ["similar", "Similar documents"],
    ["compare", "Compare"],
    ["cooc", "Co-occurrence"],
    ["entities", "Entities"],
    ["documents", "Documents"],
    ["quality", "Data quality"],
  ];

  let built = false;
  let docs, ents, nodeById, docIdx, docEntList, docEntSet, entDocList;

  function build() {
    docs = graph.nodes
      .filter((n) => n.type === "document")
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label));
    ents = graph.nodes.filter((n) => n.type === "entity");
    nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    docIdx = new Map(docs.map((d, i) => [d.id, i]));
    docEntList = new Map(docs.map((d) => [d.id, []]));
    entDocList = new Map();
    graph.links.forEach((l) => {
      docEntList.get(l.source).push({ id: l.target, value: l.value });
      let arr = entDocList.get(l.target);
      if (!arr) entDocList.set(l.target, (arr = []));
      arr.push({ id: l.source, value: l.value });
    });
    docEntSet = new Map(
      docs.map((d) => [d.id, new Set(docEntList.get(d.id).map((e) => e.id))]),
    );
    document.getElementById("aSummary").textContent =
      `${fmt(docs.length)} documents · ${fmt(ents.length)} entities · ` +
      `${fmt(graph.links.length)} links`;
    built = true;
  }

  const dot = (e) =>
    `<span class="dot" style="color:${color(e.entityType)}">●</span>`;

  function downloadCSV(name, header, rows) {
    const all = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob(["\uFEFF" + all], { type: "text/csv" }),
    );
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const panes = new Map();
  let active = null;

  TABS.forEach(([key, label]) => {
    const btn = document.createElement("button");
    btn.className = "a-tab";
    btn.dataset.tab = key;
    btn.textContent = label;
    btn.addEventListener("click", () => activate(key));
    tabBar.appendChild(btn);
  });

  const RENDERERS = {
    insights: renderInsights,
    similar: renderSimilar,
    compare: renderCompare,
    cooc: renderCooc,
    entities: renderEntities,
    documents: renderDocuments,
    quality: renderQuality,
  };

  function activate(key) {
    active = key;
    tabBar
      .querySelectorAll(".a-tab")
      .forEach((b) => b.classList.toggle("active", b.dataset.tab === key));
    let pane = panes.get(key);
    if (!pane) {
      pane = document.createElement("div");
      pane.className = "a-pane";
      body.appendChild(pane);
      panes.set(key, pane);
      RENDERERS[key](pane);
    }
    panes.forEach((p, k) => p.classList.toggle("hidden", k !== key));
    body.scrollTop = 0;
  }

  body.addEventListener("mousemove", (e) => {
    const t = e.target.closest("[data-tip]");
    if (t)
      tip
        .style("opacity", 1)
        .style("left", e.clientX + 12 + "px")
        .style("top", e.clientY + 12 + "px")
        .text(t.getAttribute("data-tip"));
    else tip.style("opacity", 0);
  });
  body.addEventListener("mouseleave", () => tip.style("opacity", 0));

  function renderInsights(el) {
    const totalMentions = d3.sum(ents, (e) => e.mentionCount);
    const multiDoc = ents.filter((e) => e.docCount >= 2).length;

    const byType = Array.from(
      d3.rollup(
        ents,
        (v) => ({
          distinct: v.length,
          mentions: d3.sum(v, (e) => e.mentionCount),
        }),
        (e) => e.entityType,
      ),
      ([type, v]) => ({ type, ...v }),
    ).sort((a, b) => b.distinct - a.distinct);
    const maxDistinct = d3.max(byType, (t) => t.distinct);
    const maxMentions = d3.max(byType, (t) => t.mentions);

    const topEnts = ents
      .slice()
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .slice(0, 25);
    const maxEnt = topEnts[0].mentionCount;

    const topDocs = docs
      .slice()
      .sort((a, b) => b.entityCount - a.entityCount)
      .slice(0, 15);
    const maxDoc = topDocs[0].entityCount;

    const RAMP = ["#60a5fa", "#3b82f6", "#1d4ed8", "#1e3a8a", "#172554"];
    const buckets = [
      ["1 doc", (d) => d === 1],
      ["2", (d) => d === 2],
      ["3-4", (d) => d >= 3 && d <= 4],
      ["5-9", (d) => d >= 5 && d <= 9],
      ["10+", (d) => d >= 10],
    ].map(([name, test]) => ({
      name,
      n: ents.filter((e) => test(e.docCount)).length,
    }));
    const maxBucket = d3.max(buckets, (b) => b.n);

    el.innerHTML = `
      <div class="kpis">
        <div class="tile"><div class="tlabel">Documents</div>
          <div class="tval">${fmt(docs.length)}</div></div>
        <div class="tile"><div class="tlabel">Distinct entities</div>
          <div class="tval">${fmt(ents.length)}</div></div>
        <div class="tile"><div class="tlabel">Entity mentions</div>
          <div class="tval">${fmt(totalMentions)}</div></div>
        <div class="tile"><div class="tlabel">Entities in ≥ 2 documents</div>
          <div class="tval">${fmt(multiDoc)}</div>
          <div class="tsub">${((multiDoc / ents.length) * 100).toFixed(1)}% of all entities</div></div>
      </div>
      <div class="a-grid">
        <div class="chart wide">
          <h3>Entities by type</h3>
          <div class="tdist">
            <span></span><span class="colhead">Distinct entities</span><span></span>
            <span class="colhead colhead2">Total mentions</span><span></span>
            ${byType
              .map(
                (t) => `
              <span class="hlabel" data-tip="${esc(t.type)} - ${esc(graph.meta.entityTypes[t.type] || "")}">
                <span class="dot" style="color:${color(t.type)}">●</span>${esc(t.type)}</span>
              <span class="htrack"><span class="hbar" style="width:${(t.distinct / maxDistinct) * 100}%"></span></span>
              <span class="hval">${fmt(t.distinct)}</span>
              <span class="htrack"><span class="hbar hbar2" style="width:${(t.mentions / maxMentions) * 100}%"></span></span>
              <span class="hval">${fmt(t.mentions)}</span>`,
              )
              .join("")}
          </div>
        </div>
        <div class="chart tall">
          <h3>Top 25 entities by mentions</h3>
          <div class="hchart">
            ${topEnts
              .map(
                (e) => `
              <span class="hlabel" data-tip="${esc(e.label)} (${esc(e.entityType)}) · in ${fmt(e.docCount)} document(s)">
                ${dot(e)}${esc(e.label)}</span>
              <span class="htrack"><span class="hbar" style="width:${(e.mentionCount / maxEnt) * 100}%"></span></span>
              <span class="hval">${fmt(e.mentionCount)}</span>`,
              )
              .join("")}
          </div>
        </div>
        <div class="chart">
          <h3>Top documents by distinct entities</h3>
          <div class="hchart">
            ${topDocs
              .map(
                (d) => `
              <span class="hlabel" data-tip="${esc(d.label)}">${esc(d.label)}</span>
              <span class="htrack"><span class="hbar" style="width:${(d.entityCount / maxDoc) * 100}%"></span></span>
              <span class="hval">${fmt(d.entityCount)}</span>`,
              )
              .join("")}
          </div>
        </div>
        <div class="chart">
          <h3>How widely entities spread</h3>
          <div class="spread">
            ${buckets
              .map(
                (b, i) => `
              <div class="scol" data-tip="${fmt(b.n)} entities appear in ${esc(b.name)}${b.name === "1 doc" ? "ument only" : " documents"}">
                <span class="sval">${fmt(b.n)}</span>
                <span class="sbar" style="height:${Math.max(2, Math.round((b.n / maxBucket) * 110))}px;background:${RAMP[i]}"></span>
              </div>`,
              )
              .join("")}
          </div>
          <div class="spread-names">${buckets.map((b) => `<span>${esc(b.name)}</span>`).join("")}</div>
        </div>
      </div>`;
  }

  let pairs = null;

  function computePairs() {
    const n = docs.length;
    const counts = new Map();
    for (const [, dl] of entDocList) {
      if (dl.length < 2) continue;
      const idxs = dl.map((x) => docIdx.get(x.id)).sort((a, b) => a - b);
      for (let i = 0; i < idxs.length; i++)
        for (let j = i + 1; j < idxs.length; j++) {
          const k = idxs[i] * n + idxs[j];
          counts.set(k, (counts.get(k) || 0) + 1);
        }
    }
    pairs = [];
    for (const [k, shared] of counts) {
      const a = docs[Math.floor(k / n)];
      const b = docs[k % n];
      const union =
        docEntSet.get(a.id).size + docEntSet.get(b.id).size - shared;
      pairs.push({ a, b, shared, jaccard: union ? shared / union : 0 });
    }
  }

  function renderSimilar(el) {
    if (!pairs) computePairs();
    let sortKey = "jaccard";

    el.innerHTML = `
      <table class="a-table" id="pairTable">
        <thead><tr>
          <th>Document A</th><th>Document B</th>
          <th class="num sortable" data-key="shared">Shared entities</th>
          <th class="num sortable" data-key="jaccard">Similarity</th>
        </tr></thead>
        <tbody></tbody>
      </table>`;

    const tbody = el.querySelector("tbody");

    function renderRows() {
      el.querySelectorAll("th.sortable").forEach((th) =>
        th.classList.toggle("sorted", th.dataset.key === sortKey),
      );
      const top = pairs
        .slice()
        .sort((x, y) => y[sortKey] - x[sortKey])
        .slice(0, 50);
      tbody.innerHTML = top
        .map(
          (p, i) => `
        <tr class="pair-row" data-i="${i}">
          <td class="trunc" data-tip="${esc(p.a.label)}">${esc(p.a.label)}</td>
          <td class="trunc" data-tip="${esc(p.b.label)}">${esc(p.b.label)}</td>
          <td class="num">${fmt(p.shared)}</td>
          <td class="num">${(p.jaccard * 100).toFixed(1)}%</td>
        </tr>
        <tr class="pair-detail hidden"><td colspan="4"></td></tr>`,
        )
        .join("");
      tbody.querySelectorAll(".pair-row").forEach((row) => {
        row.addEventListener("click", () => {
          const detail = row.nextElementSibling;
          if (detail.classList.toggle("hidden")) return;
          if (detail.dataset.done) return;
          detail.dataset.done = "1";
          const p = top[+row.dataset.i];
          const bSet = docEntSet.get(p.b.id);
          const bVal = new Map(
            docEntList.get(p.b.id).map((x) => [x.id, x.value]),
          );
          const shared = docEntList
            .get(p.a.id)
            .filter((x) => bSet.has(x.id))
            .map((x) => ({
              e: nodeById.get(x.id),
              va: x.value,
              vb: bVal.get(x.id),
            }))
            .sort((x, y) => y.va + y.vb - (x.va + x.vb));
          const cap = shared.slice(0, 120);
          detail.firstElementChild.innerHTML =
            cap
              .map(
                (s) =>
                  `<span class="chip" data-tip="${esc(s.e.label)} (${esc(s.e.entityType)}) · ${fmt(s.va)} in A · ${fmt(s.vb)} in B">${dot(s.e)}${esc(s.e.label)}</span>`,
              )
              .join("") +
            (shared.length > cap.length
              ? `<span class="chip more">+${fmt(shared.length - cap.length)} more</span>`
              : "");
        });
      });
    }

    el.querySelectorAll("th.sortable").forEach((th) =>
      th.addEventListener("click", () => {
        sortKey = th.dataset.key;
        renderRows();
      }),
    );
    renderRows();
  }

  function renderCompare(el, presetDocId) {
    el.innerHTML = `
      <div class="cmp-pickers">
        <select id="cmpA"></select>
        <button id="cmpSwap" title="Swap">⇄</button>
        <select id="cmpB"></select>
      </div>
      <div class="cmp-cols">
        <div class="cmp-col"><div class="cmp-head" id="cmpHeadA"></div><div id="cmpListA"></div></div>
        <div class="cmp-col shared"><div class="cmp-head" id="cmpHeadS"></div><div id="cmpListS"></div></div>
        <div class="cmp-col"><div class="cmp-head" id="cmpHeadB"></div><div id="cmpListB"></div></div>
      </div>`;

    const selA = el.querySelector("#cmpA");
    const selB = el.querySelector("#cmpB");
    docs.forEach((d) => {
      selA.add(new Option(d.label, d.id));
      selB.add(new Option(d.label, d.id));
    });
    selA.value = presetDocId || docs[0].id;
    selB.value =
      docs.find((d) => d.id !== selA.value)?.id || docs[0].id;

    const item = (e, val, tipText) =>
      `<div class="cmp-item" data-tip="${esc(tipText)}">${dot(e)}<span class="clabel">${esc(e.label)}</span><span class="cval">${fmt(val)}</span></div>`;

    function renderCols() {
      const a = selA.value,
        b = selB.value;
      const aSet = docEntSet.get(a),
        bSet = docEntSet.get(b);
      const bVal = new Map(docEntList.get(b).map((x) => [x.id, x.value]));

      const onlyA = docEntList
        .get(a)
        .filter((x) => !bSet.has(x.id))
        .sort((x, y) => y.value - x.value);
      const onlyB = docEntList
        .get(b)
        .filter((x) => !aSet.has(x.id))
        .sort((x, y) => y.value - x.value);
      const shared = docEntList
        .get(a)
        .filter((x) => bSet.has(x.id))
        .map((x) => ({ id: x.id, va: x.value, vb: bVal.get(x.id) }))
        .sort((x, y) => y.va + y.vb - (x.va + x.vb));

      const CAP = 300;
      const capNote = (arr) =>
        arr.length > CAP
          ? `<div class="cmp-more">…and ${fmt(arr.length - CAP)} more</div>`
          : "";

      el.querySelector("#cmpHeadA").textContent =
        `Only in A (${fmt(onlyA.length)})`;
      el.querySelector("#cmpHeadS").textContent =
        `Shared (${fmt(shared.length)})`;
      el.querySelector("#cmpHeadB").textContent =
        `Only in B (${fmt(onlyB.length)})`;
      el.querySelector("#cmpListA").innerHTML =
        onlyA
          .slice(0, CAP)
          .map((x) => {
            const e = nodeById.get(x.id);
            return item(e, x.value, `${e.label} (${e.entityType}) · ${x.value} mention(s)`);
          })
          .join("") + capNote(onlyA);
      el.querySelector("#cmpListS").innerHTML =
        shared
          .slice(0, CAP)
          .map((x) => {
            const e = nodeById.get(x.id);
            return item(e, x.va + x.vb, `${e.label} (${e.entityType}) · ${x.va} in A · ${x.vb} in B`);
          })
          .join("") + capNote(shared);
      el.querySelector("#cmpListB").innerHTML =
        onlyB
          .slice(0, CAP)
          .map((x) => {
            const e = nodeById.get(x.id);
            return item(e, x.value, `${e.label} (${e.entityType}) · ${x.value} mention(s)`);
          })
          .join("") + capNote(onlyB);
    }

    selA.addEventListener("change", renderCols);
    selB.addEventListener("change", renderCols);
    el.querySelector("#cmpSwap").addEventListener("click", () => {
      const t = selA.value;
      selA.value = selB.value;
      selB.value = t;
      renderCols();
    });
    renderCols();
  }

  function renderCooc(el, presetEntId) {
    el.innerHTML = `
      <input id="coocSearch" type="search" placeholder="Find an entity…" autocomplete="off" />
      <div id="coocSugg"></div>
      <div id="coocResult"></div>`;

    const input = el.querySelector("#coocSearch");
    const sugg = el.querySelector("#coocSugg");
    const result = el.querySelector("#coocResult");

    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      if (!q) {
        sugg.innerHTML = "";
        return;
      }
      const matches = ents
        .filter((e) => e.label.toLowerCase().includes(q))
        .sort(
          (a, b) =>
            b.label.toLowerCase().startsWith(q) -
              a.label.toLowerCase().startsWith(q) ||
            b.mentionCount - a.mentionCount,
        )
        .slice(0, 20);
      sugg.innerHTML = matches.length
        ? matches
            .map(
              (e) =>
                `<div class="sugg-row" data-id="${esc(e.id)}">${dot(e)}<span class="clabel">${esc(e.label)}</span><span class="cval">${esc(e.entityType)} · ${fmt(e.docCount)} doc(s)</span></div>`,
            )
            .join("")
        : `<div class="cmp-more">No entities match "${esc(input.value.trim())}".</div>`;
      sugg.querySelectorAll(".sugg-row").forEach((row) =>
        row.addEventListener("click", () => pick(row.dataset.id)),
      );
    });

    function pick(entId) {
      const e = nodeById.get(entId);
      if (!e) return;
      sugg.innerHTML = "";
      input.value = e.label;

      const dl = entDocList.get(e.id) || [];
      const cnt = new Map();
      dl.forEach(({ id }) =>
        docEntSet.get(id).forEach((eid) => {
          if (eid !== e.id) cnt.set(eid, (cnt.get(eid) || 0) + 1);
        }),
      );
      const top = Array.from(cnt, ([id, c]) => ({ e: nodeById.get(id), c }))
        .sort((x, y) => y.c - x.c || y.e.mentionCount - x.e.mentionCount)
        .slice(0, 50);

      result.innerHTML = `
        <h3 class="cooc-head">${dot(e)}${esc(e.label)}
          <span class="muted-inline">${esc(e.entityType)} · appears in ${fmt(dl.length)} document(s)</span></h3>
        <table class="a-table">
          <thead><tr><th>Co-occurring entity</th><th>Type</th>
            <th class="num">Docs together</th><th class="num">Share of its docs</th></tr></thead>
          <tbody>
            ${top
              .map(
                (r) => `
              <tr class="drill" data-id="${esc(r.e.id)}">
                <td class="trunc">${dot(r.e)}${esc(r.e.label)}</td>
                <td>${esc(r.e.entityType)}</td>
                <td class="num">${fmt(r.c)}</td>
                <td class="num">${((r.c / dl.length) * 100).toFixed(0)}%</td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>`;
      result
        .querySelectorAll(".drill")
        .forEach((row) =>
          row.addEventListener("click", () => pick(row.dataset.id)),
        );
    }

    if (presetEntId) pick(presetEntId);
    else input.focus();
    el.pick = pick;
  }

  function renderEntities(el, presetQuery) {
    const types = Array.from(new Set(ents.map((e) => e.entityType))).sort();
    el.innerHTML = `
      <div class="a-controls">
        <input id="entQ" type="search" placeholder="Filter entities…" value="${esc(presetQuery || "")}" />
        <select id="entType"><option value="">All types</option>
          ${types.map((t) => `<option>${esc(t)}</option>`).join("")}</select>
        <label class="ctl-label">In ≥
          <input id="entMinDocs" type="number" min="1" value="1" /> docs</label>
        <span class="ctl-count" id="entCount"></span>
        <button id="entCSV">Export CSV</button>
      </div>
      <table class="a-table">
        <thead><tr>
          <th class="sortable" data-key="label">Entity</th>
          <th class="sortable" data-key="entityType">Type</th>
          <th class="num sortable" data-key="docCount">Docs</th>
          <th class="num sortable" data-key="mentionCount">Mentions</th>
        </tr></thead>
        <tbody></tbody>
      </table>
      <div class="cmp-more" id="entMore"></div>`;

    const state = { key: "mentionCount", dir: -1 };
    let filtered = [];

    function refresh() {
      const q = el.querySelector("#entQ").value.trim().toLowerCase();
      const type = el.querySelector("#entType").value;
      const minDocs = Math.max(1, +el.querySelector("#entMinDocs").value || 1);
      filtered = ents.filter(
        (e) =>
          (!q || e.label.toLowerCase().includes(q)) &&
          (!type || e.entityType === type) &&
          e.docCount >= minDocs,
      );
      filtered.sort((a, b) => {
        const va = a[state.key],
          vb = b[state.key];
        return (
          state.dir *
          (typeof va === "string" ? va.localeCompare(vb) : va - vb)
        );
      });
      el.querySelectorAll("th.sortable").forEach((th) => {
        th.classList.toggle("sorted", th.dataset.key === state.key);
        th.classList.toggle(
          "asc",
          th.dataset.key === state.key && state.dir === 1,
        );
      });
      el.querySelector("#entCount").textContent =
        `${fmt(filtered.length)} of ${fmt(ents.length)}`;
      const CAP = 500;
      el.querySelector("tbody").innerHTML = filtered
        .slice(0, CAP)
        .map(
          (e) => `
        <tr><td class="trunc">${dot(e)}${esc(e.label)}</td>
          <td data-tip="${esc(e.entityTypeLabel)}">${esc(e.entityType)}</td>
          <td class="num">${fmt(e.docCount)}</td>
          <td class="num">${fmt(e.mentionCount)}</td></tr>`,
        )
        .join("");
      el.querySelector("#entMore").textContent =
        filtered.length > CAP
          ? `Showing the first ${fmt(CAP)} rows - refine the filter or export the full CSV.`
          : "";
    }

    el.querySelector("#entQ").addEventListener("input", refresh);
    el.querySelector("#entType").addEventListener("change", refresh);
    el.querySelector("#entMinDocs").addEventListener("input", refresh);
    el.querySelectorAll("th.sortable").forEach((th) =>
      th.addEventListener("click", () => {
        if (state.key === th.dataset.key) state.dir *= -1;
        else {
          state.key = th.dataset.key;
          state.dir = th.dataset.key === "label" ? 1 : -1;
        }
        refresh();
      }),
    );
    el.querySelector("#entCSV").addEventListener("click", () =>
      downloadCSV(
        "entities.csv",
        ["entity", "type", "type_label", "documents", "mentions"],
        filtered.map((e) => [
          e.label,
          e.entityType,
          e.entityTypeLabel,
          e.docCount,
          e.mentionCount,
        ]),
      ),
    );
    el.setQuery = (q) => {
      el.querySelector("#entQ").value = q;
      refresh();
    };
    refresh();
  }

  function renderDocuments(el) {
    el.innerHTML = `
      <div class="a-controls">
        <input id="docQ" type="search" placeholder="Filter documents…" />
        <span class="ctl-count" id="docCount"></span>
        <button id="docCSV">Export CSV</button>
      </div>
      <table class="a-table">
        <thead><tr>
          <th class="sortable" data-key="label">Document</th>
          <th class="sortable" data-key="format">Format</th>
          <th class="num sortable" data-key="entityCount">Distinct entities</th>
          <th class="num sortable" data-key="mentionCount">Mentions</th>
        </tr></thead>
        <tbody></tbody>
      </table>`;

    const state = { key: "entityCount", dir: -1 };
    let filtered = [];

    function refresh() {
      const q = el.querySelector("#docQ").value.trim().toLowerCase();
      filtered = docs.filter((d) => !q || d.label.toLowerCase().includes(q));
      filtered.sort((a, b) => {
        const va = a[state.key],
          vb = b[state.key];
        return (
          state.dir *
          (typeof va === "string" ? va.localeCompare(vb) : va - vb)
        );
      });
      el.querySelectorAll("th.sortable").forEach((th) => {
        th.classList.toggle("sorted", th.dataset.key === state.key);
        th.classList.toggle(
          "asc",
          th.dataset.key === state.key && state.dir === 1,
        );
      });
      el.querySelector("#docCount").textContent =
        `${fmt(filtered.length)} of ${fmt(docs.length)}`;
      el.querySelector("tbody").innerHTML = filtered
        .map(
          (d) => `
        <tr><td class="trunc" data-tip="${esc(d.label)}">${esc(d.label)}</td>
          <td>${esc(d.format.toUpperCase())}</td>
          <td class="num">${fmt(d.entityCount)}</td>
          <td class="num">${fmt(d.mentionCount)}</td></tr>`,
        )
        .join("");
    }

    el.querySelector("#docQ").addEventListener("input", refresh);
    el.querySelectorAll("th.sortable").forEach((th) =>
      th.addEventListener("click", () => {
        if (state.key === th.dataset.key) state.dir *= -1;
        else {
          state.key = th.dataset.key;
          state.dir = th.dataset.key === "label" ? 1 : -1;
        }
        refresh();
      }),
    );
    el.querySelector("#docCSV").addEventListener("click", () =>
      downloadCSV(
        "documents.csv",
        ["document", "format", "distinct_entities", "mentions"],
        filtered.map((d) => [
          d.label,
          d.format,
          d.entityCount,
          d.mentionCount,
        ]),
      ),
    );
    refresh();
  }

  function renderQuality(el) {
    const byForm = d3.group(ents, (e) => e.label.toLowerCase());
    const groups = Array.from(byForm, ([form, list]) => ({
      form,
      list: list.slice().sort((a, b) => b.mentionCount - a.mentionCount),
      types: new Set(list.map((e) => e.entityType)).size,
      mentions: d3.sum(list, (e) => e.mentionCount),
    }))
      .filter((g) => g.types > 1)
      .sort((a, b) => b.mentions - a.mentions);

    const CAP = 100;
    el.innerHTML = `
      <div class="a-controls"><button id="qCSV">Export CSV</button></div>
      <table class="a-table">
        <thead><tr><th>Surface form</th><th class="num">Types</th>
          <th class="num">Total mentions</th><th>Tagged as</th></tr></thead>
        <tbody>
          ${groups
            .slice(0, CAP)
            .map(
              (g) => `
            <tr><td class="trunc"><b>${esc(g.list[0].label)}</b></td>
              <td class="num">${g.types}</td>
              <td class="num">${fmt(g.mentions)}</td>
              <td>${g.list
                .map(
                  (e) =>
                    `<span class="chip" data-tip="${esc(e.entityTypeLabel)} · ${fmt(e.docCount)} doc(s)">${dot(e)}${esc(e.entityType)} ${fmt(e.mentionCount)}</span>`,
                )
                .join("")}</td></tr>`,
            )
            .join("")}
        </tbody>
      </table>
      <div class="cmp-more">${
        groups.length > CAP
          ? `Showing the top ${fmt(CAP)} of ${fmt(groups.length)} suspicious surface forms - export the CSV for all.`
          : `${fmt(groups.length)} suspicious surface forms.`
      }</div>`;

    el.querySelector("#qCSV").addEventListener("click", () =>
      downloadCSV(
        "suspicious-entities.csv",
        ["surface_form", "types", "total_mentions", "breakdown"],
        groups.map((g) => [
          g.list[0].label,
          g.types,
          g.mentions,
          g.list
            .map((e) => `${e.entityType}:${e.mentionCount}m/${e.docCount}d`)
            .join(" "),
        ]),
      ),
    );
  }

  function open(tab = "insights", opts = {}) {
    if (!built) build();
    overlay.classList.remove("hidden");
    if (opts.entityId) {
      const pane = panes.get("cooc");
      if (pane) pane.pick(opts.entityId);
      else {
        const p = document.createElement("div");
        p.className = "a-pane";
        body.appendChild(p);
        panes.set("cooc", p);
        renderCooc(p, opts.entityId);
      }
    }
    if (opts.docId && !panes.get("compare")) {
      const p = document.createElement("div");
      p.className = "a-pane";
      body.appendChild(p);
      panes.set("compare", p);
      renderCompare(p, opts.docId);
    } else if (opts.docId) {
      const pane = panes.get("compare");
      pane.querySelector("#cmpA").value = opts.docId;
      pane.querySelector("#cmpA").dispatchEvent(new Event("change"));
    }
    activate(tab);
    if (opts.query) {
      const pane = panes.get("entities");
      if (pane && pane.setQuery) pane.setQuery(opts.query);
    }
  }

  function close() {
    overlay.classList.add("hidden");
    tip.style("opacity", 0);
  }

  const isOpen = () => !overlay.classList.contains("hidden");

  document.getElementById("analysisClose").addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  return { open, close, isOpen };
}
