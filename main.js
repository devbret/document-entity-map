const showLoadError = (msg) => {
  document.getElementById("setupSummary").textContent = msg;
};

if (typeof d3 === "undefined") {
  showLoadError(
    "Could not load the D3 library from the CDN. " +
      "Check your internet connection and reload.",
  );
  throw new Error("d3 is not available");
}

let graph;
try {
  graph = await d3.json("./output/graph.json");
} catch (err) {
  console.error(err);
  showLoadError(
    "Could not load output/graph.json. Run app.py to generate it, then " +
      "serve the repo root over http (e.g. python3 -m http.server) instead " +
      "of opening this file directly.",
  );
  throw err;
}

const allDocs = graph.nodes.filter((n) => n.type === "document");
const allEnts = graph.nodes.filter((n) => n.type === "entity");

const svg = d3.select("#graph");
const tip = d3.select("#tip");

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );

const color = d3
  .scaleOrdinal()
  .domain(Object.keys(graph.meta.entityTypes))
  .range([...d3.schemeCategory10, ...d3.schemeSet3]);

const entR = d3
  .scaleSqrt()
  .domain([1, d3.max(allEnts, (d) => d.mentionCount) || 1])
  .range([4, 22]);
const radius = (d) => (d.type === "document" ? 9 : entR(d.mentionCount));

let width = 0,
  height = 0;
function size() {
  const r = svg.node().getBoundingClientRect();
  width = r.width;
  height = r.height;
  svg.attr("viewBox", [0, 0, width, height]);
}

const typeCounts = Array.from(
  d3
    .rollup(
      allEnts,
      (v) => v.length,
      (d) => d.entityType,
    )
    .entries(),
).sort((a, b) => b[1] - a[1]);

d3.select("#setupSummary").text(
  `${allDocs.length.toLocaleString()} documents · ` +
    `${allEnts.length.toLocaleString()} entities across ` +
    `${typeCounts.length} types. Choose what to map.`,
);

const typeList = d3.select("#typeList");
typeCounts.forEach(([type, n]) => {
  const row = typeList
    .append("label")
    .attr("class", "type-row")
    .attr("title", `${type} - ${graph.meta.entityTypes[type]}`);
  row
    .append("input")
    .attr("type", "checkbox")
    .attr("value", type)
    .property("checked", true);
  row.append("span").attr("class", "dot").style("color", color(type)).text("●");
  row.append("span").attr("class", "tname").text(type);
  row.append("span").attr("class", "count").text(n.toLocaleString());
});

const checkboxes = () => typeList.selectAll("input").nodes();
const selectedTypes = () =>
  new Set(
    checkboxes()
      .filter((c) => c.checked)
      .map((c) => c.value),
  );
const countInput = document.getElementById("count");
const launchBtn = document.getElementById("launch");

function refreshSetup() {
  const types = selectedTypes();
  const matching = allEnts.filter((e) => types.has(e.entityType)).length;
  countInput.max = matching || 1;
  if (+countInput.value > matching) countInput.value = matching;
  d3.select("#matchInfo").text(
    types.size === 0
      ? "Select at least one entity type."
      : matching === 0
        ? "No entities of the selected types."
        : `${matching.toLocaleString()} entities match; showing the top ` +
          `${Math.min(Math.max(1, +countInput.value || 1), matching).toLocaleString()} ` +
          `by mention count.`,
  );
  launchBtn.disabled = types.size === 0 || matching === 0;
}

typeList.on("change", refreshSetup);
countInput.addEventListener("input", refreshSetup);
d3.select("#selectAll").on("click", () => {
  checkboxes().forEach((c) => (c.checked = true));
  refreshSetup();
});
d3.select("#clearAll").on("click", () => {
  checkboxes().forEach((c) => (c.checked = false));
  refreshSetup();
});
refreshSetup();

launchBtn.addEventListener("click", () => {
  const types = selectedTypes();
  const n = Math.max(1, +countInput.value || 1);
  const ents = allEnts
    .filter((e) => types.has(e.entityType))
    .sort((a, b) => b.mentionCount - a.mentionCount)
    .slice(0, n);
  const entIds = new Set(ents.map((e) => e.id));
  const links = graph.links
    .filter((l) => entIds.has(l.target))
    .map((l) => ({ source: l.source, target: l.target, value: l.value }));
  const docIds = new Set(links.map((l) => l.source));
  const docs = allDocs.filter((d) => docIds.has(d.id));

  d3.select("#setup").classed("hidden", true);
  size();
  renderGraph([...docs, ...ents], links);
});

d3.select("#settingsBtn").on("click", () =>
  d3.select("#setup").classed("hidden", false),
);

let sim, node, link, neighbors, connections, nodeById, zoomBehavior;
let hoverId = null;
let pinnedId = null;

function renderGraph(nodes, links) {
  if (sim) sim.stop();
  svg.selectAll("*").remove();
  hoverId = null;
  pinnedId = null;
  renderDetail();

  d3.select("#summary").text(
    `${nodes.filter((n) => n.type === "document").length} documents · ` +
      `${nodes.filter((n) => n.type === "entity").length} entities · ` +
      `${links.length} links shown`,
  );

  const legend = d3.select("#legend").html("");
  legend
    .append("div")
    .attr("class", "legend-row")
    .html('<span class="swatch doc-swatch"></span>Document');

  const hiddenTypes = new Set();
  function applyTypeVisibility() {
    node.style("display", (d) =>
      d.type === "entity" && hiddenTypes.has(d.entityType) ? "none" : null,
    );
    link.style("display", (d) =>
      hiddenTypes.has(d.target.entityType) ? "none" : null,
    );
  }

  Array.from(
    new Set(nodes.filter((n) => n.type === "entity").map((n) => n.entityType)),
  ).forEach((t) => {
    const row = legend.append("div").attr("class", "legend-row");
    row.append("span").attr("class", "swatch").style("background", color(t));
    row.append("span").text(t);
    row
      .append("input")
      .attr("type", "checkbox")
      .attr("class", "legend-check")
      .property("checked", true)
      .on("change", function () {
        if (this.checked) hiddenTypes.delete(t);
        else hiddenTypes.add(t);
        applyTypeVisibility();
      });
  });

  neighbors = new Map(nodes.map((n) => [n.id, new Set([n.id])]));
  connections = new Map(nodes.map((n) => [n.id, []]));
  nodeById = new Map(nodes.map((n) => [n.id, n]));
  links.forEach((l) => {
    neighbors.get(l.source).add(l.target);
    neighbors.get(l.target).add(l.source);
    connections.get(l.source).push({ id: l.target, value: l.value });
    connections.get(l.target).push({ id: l.source, value: l.value });
  });

  sim = d3
    .forceSimulation(nodes)
    .force(
      "link",
      d3
        .forceLink(links)
        .id((d) => d.id)
        .distance(160)
        .strength(0.3),
    )
    .force("charge", d3.forceManyBody().strength(-600))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force(
      "collide",
      d3.forceCollide().radius((d) => radius(d) + 10),
    );

  const root = svg.append("g");
  zoomBehavior = d3
    .zoom()
    .scaleExtent([0.2, 6])
    .on("zoom", (e) => root.attr("transform", e.transform));
  svg.call(zoomBehavior);

  link = root
    .append("g")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("class", "link");

  node = root
    .append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", "node")
    .call(
      d3
        .drag()
        .on("start", (e, d) => {
          if (!e.active) sim.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (e, d) => {
          d.fx = e.x;
          d.fy = e.y;
        })
        .on("end", (e, d) => {
          if (!e.active) sim.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }),
    );

  node.each(function (d) {
    const g = d3.select(this);
    if (d.type === "document") {
      const s = 16;
      g.append("rect")
        .attr("x", -s / 2)
        .attr("y", -s / 2)
        .attr("width", s)
        .attr("height", s)
        .attr("rx", 2)
        .attr("fill", "#333")
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.5);
    } else {
      g.append("circle")
        .attr("r", radius(d))
        .attr("fill", color(d.entityType))
        .attr("stroke", "#fff")
        .attr("stroke-width", 1);
    }
  });

  node
    .filter((d) => d.type === "document")
    .append("text")
    .attr("class", "doc-label")
    .attr("x", 11)
    .attr("y", 4)
    .text((d) => d.label);
  node
    .filter((d) => d.type === "entity")
    .append("text")
    .attr("class", "node-label")
    .attr("x", (d) => radius(d) + 3)
    .attr("y", 3)
    .text((d) => d.label);

  node
    .on("mouseover", (e, d) => {
      hoverId = d.id;
      applyHighlight();
    })
    .on("mousemove", (e, d) => {
      tip
        .style("opacity", 1)
        .style("left", e.clientX + 12 + "px")
        .style("top", e.clientY + 12 + "px")
        .html(
          d.type === "document"
            ? `<b>${esc(d.label)}</b><br>${d.format.toUpperCase()} document<br>` +
                `${d.entityCount} entities · ${d.mentionCount} mentions`
            : `<b>${esc(d.label)}</b><br>${d.entityType} - ${d.entityTypeLabel}<br>` +
                `in ${d.docCount} document(s) · ${d.mentionCount} mentions`,
        );
    })
    .on("mouseout", () => {
      tip.style("opacity", 0);
      hoverId = null;
      applyHighlight();
    })
    .on("click", (e, d) => {
      e.stopPropagation();
      setPinned(pinnedId === d.id ? null : d.id);
    });

  sim.on("tick", () => {
    link
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);
    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
  });

  applyHighlight();
}

const searchInput = document.getElementById("search");

function applyHighlight() {
  if (!node) return;
  node.classed("pinned", (d) => d.id === pinnedId);
  const focusId = hoverId || pinnedId;
  if (focusId) {
    const keep = neighbors.get(focusId);
    node.classed("faded", (d) => !keep.has(d.id));
    link.classed(
      "faded",
      (d) => !(keep.has(d.source.id) && keep.has(d.target.id)),
    );
    return;
  }
  const q = searchInput.value.trim().toLowerCase();
  const matches = (d) => d.label.toLowerCase().includes(q);
  node.classed("faded", (d) => q && !matches(d));
  link.classed("faded", (d) => q && !(matches(d.source) || matches(d.target)));
}

d3.select("#search").on("input", applyHighlight);

const detailEl = document.getElementById("detail");

function setPinned(id) {
  pinnedId = id;
  renderDetail();
  applyHighlight();
}

function renderDetail() {
  const d = pinnedId ? nodeById.get(pinnedId) : null;
  detailEl.classList.toggle("hidden", !d);
  if (!d) return;

  document.getElementById("detailTitle").textContent = d.label;
  document.getElementById("detailMeta").textContent =
    d.type === "document"
      ? `${d.format.toUpperCase()} document · ${d.mentionCount} mentions`
      : `${d.entityType} (${d.entityTypeLabel}) · ${d.mentionCount} mentions`;

  const conns = (connections.get(d.id) || [])
    .slice()
    .sort((a, b) => b.value - a.value);
  document.getElementById("detailConnHead").textContent =
    d.type === "document"
      ? `Entities shown (${conns.length} of ${d.entityCount})`
      : `Documents (${conns.length})`;

  const list = d3.select("#detailList").html("");
  conns.forEach((c) => {
    const other = nodeById.get(c.id);
    const row = list
      .append("div")
      .attr("class", "conn-row")
      .attr(
        "title",
        `${other.label} · ${c.value} mention${c.value === 1 ? "" : "s"}`,
      )
      .on("click", () => {
        setPinned(other.id);
        svg
          .transition()
          .duration(400)
          .call(zoomBehavior.translateTo, other.x, other.y);
      });
    row
      .append("span")
      .attr("class", other.type === "document" ? "swatch doc-swatch" : "swatch")
      .style(
        "background",
        other.type === "entity" ? color(other.entityType) : null,
      );
    row.append("span").attr("class", "clabel").text(other.label);
    row.append("span").attr("class", "cval").text(c.value.toLocaleString());
  });
}

d3.select("#detailClose").on("click", () => setPinned(null));
svg.on("click", () => setPinned(null));
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setPinned(null);
});

window.addEventListener("resize", () => {
  size();
  if (sim)
    sim
      .force("center", d3.forceCenter(width / 2, height / 2))
      .alpha(0.3)
      .restart();
});
