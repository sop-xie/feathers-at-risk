import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import { ORDER_NAMES, FAMILY_NAMES } from "./names.js";
import { openProfile, closeProfile, profileOpen } from "./profile.js";

// ---------- constants ----------
const SIZE = 800;   // the pack is laid out in an 800 x 800 square
const MARGIN = 200; // extra width on each side for annotations
const STATUS = {
  LC: { name: "Least concern", color: "#2fa283" },
  NT: { name: "Near threatened", color: "#e3dcbc" },
  VU: { name: "Vulnerable", color: "#f19d4c" },
  EN: { name: "Endangered", color: "#d9533f" },
  CR: { name: "Critically endangered", color: "#9b1b1b" },
  EW: { name: "Extinct in the wild", color: "#5c5c5c" },
  EX: { name: "Extinct", color: "#5c5c5c" },
};
const RANK = ["LC", "NT", "VU", "EN", "CR", "EW", "EX"];
const LIVING = ["LC", "NT", "VU", "EN", "CR"];
const THREATENED = new Set(["VU", "EN", "CR"]);
const GONE = new Set(["EW", "EX"]);

const FILTERS = {
  all: { label: null, test: () => true },
  sea: { label: "seabirds", test: (b) => b.habitat === "Sea" },
  island: { label: "island-only breeders", test: (b) => b.island === 1 },
  heavy: { label: "birds over 1 kg", test: (b) => b.mass >= 1000 },
  flightless: { label: "flightless birds", test: (b) => b.flightless === 1 },
};

// Callouts on the opening view: [order, lines(stats, share of all species)].
// Each sits just outside the outer circle, on the ray from the center through its group.
const CALLOUTS = [
  ["Passeriformes", (s, share) => [
    ["Perching birds", true], [`are ${pct(share)} of all species,`], [`but only ${pct(s.rate)} are threatened`]]],
  ["Psittaciformes", (s) => [["Parrots", true], [`about 1 in 4 threatened (${pct(s.rate)})`]]],
  ["Procellariiformes", (s) => [["Albatrosses & petrels", true], [`${pct(s.rate)} threatened`]]],
];

const pct = d3.format(".0%");
const num = d3.format(",");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function fmtMass(g) {
  if (g >= 1000) return `${d3.format(g >= 10000 ? ".0f" : ".1~f")(g / 1000)} kg`;
  return `${d3.format(g < 10 ? ".1~f" : ".0f")(g)} g`;
}

// ---------- data ----------
const birds = await d3.csv("data/birds_atlas.csv", (d) => ({
  sci: d.sci,
  name: d.name,
  order: d.order,
  family: d.family,
  status: d.status,
  possiblyExtinct: d.possibly_extinct === "1",
  flightless: +d.flightless,
  mass: +d.mass,
  hwi: +d.hwi,
  habitat: d.habitat,
  diet: d.diet,
  island: +d.island,
  clutchMin: d.clutch_min === "" ? null : +d.clutch_min,
  clutchMax: d.clutch_max === "" ? null : +d.clutch_max,
  lat: d.lat === "" ? NaN : +d.lat,
  lon: d.lon === "" ? NaN : +d.lon,
  latMin: d.lat_min === "" ? NaN : +d.lat_min,
  latMax: d.lat_max === "" ? NaN : +d.lat_max,
  range: d.range_km2 === "" ? NaN : +d.range_km2,
  beak: d.beak === "" ? NaN : +d.beak,
}));

const tree = {
  name: "All birds",
  level: "root",
  children: Array.from(d3.group(birds, (b) => b.order, (b) => b.family), ([order, families]) => ({
    name: order,
    level: "order",
    children: Array.from(families, ([family, species]) => ({
      name: family,
      level: "family",
      children: species.map((b) => ({ name: b.name, level: "species", bird: b })),
    })),
  })),
};

const root = d3.hierarchy(tree)
  .sum((d) => (d.bird ? 1 : 0))
  // Inside a family: most endangered packed first (center), least concern last (rim).
  .sort((a, b) => (a.data.bird && b.data.bird
    ? RANK.indexOf(b.data.bird.status) - RANK.indexOf(a.data.bird.status)
    : b.value - a.value));
const pack = d3.pack().size([SIZE, SIZE]).padding((n) => (n.depth === 0 ? 8 : n.depth === 1 ? 3 : 0.25));
pack(root);
// Remember where each circle is drawn, so a re-pack can animate from there.
root.each((n) => { n.drawn = [n.x, n.y, n.r]; });

const commonName = (n) =>
  n.data.level === "order" ? ORDER_NAMES[n.data.name] ?? n.data.name
    : n.data.level === "family" ? FAMILY_NAMES[n.data.name] ?? n.data.name
      : n.data.name;

// ---------- filters & stats ----------
let filterKey = "all";
const matches = (b) => FILTERS[filterKey].test(b);

const stats = (node, useFilter = true) =>
  count(node.leaves().map((l) => l.data.bird).filter((b) => !useFilter || matches(b)));
// The species in a group that do NOT match the current trait filter.
const statsRest = (node) => count(node.leaves().map((l) => l.data.bird).filter((b) => !matches(b)));
function count(list) {
  const counts = Object.fromEntries(RANK.map((s) => [s, 0]));
  list.forEach((b) => counts[b.status]++);
  const living = d3.sum(LIVING, (s) => counts[s]);
  const threat = counts.VU + counts.EN + counts.CR;
  return { counts, living, threat, gone: counts.EW + counts.EX, rate: living ? threat / living : 0 };
}
const base = stats(root, false);
const share = (n) => n.value / root.value;

// Orders and families are shaded by their share threatened, diverging around the
// all-birds average: greener = safer than average, redder = more threatened.
const SHADE_MAX = 0.6;
const SHADE_STOPS = [[0, "#1d7a60"], [base.rate, STATUS.NT.color], [0.3, STATUS.VU.color], [0.45, STATUS.EN.color], [SHADE_MAX, STATUS.CR.color]];
const shade = d3.scaleLinear(SHADE_STOPS.map((x) => x[0]), SHADE_STOPS.map((x) => x[1])).interpolate(d3.interpolateLab).clamp(true);
const shadeOf = (node) => { const s = stats(node); return s.living ? shade(s.rate) : "#c9c7c0"; };

// ---------- chart ----------
const svg = d3.select("#chart").attr("viewBox", [-MARGIN, 0, SIZE + 2 * MARGIN, SIZE]);
svg.append("rect").attr("class", "bg")
  .attr("x", -MARGIN).attr("width", SIZE + 2 * MARGIN).attr("height", SIZE)
  .on("click", () => zoomOut());

const world = svg.append("g");
const groups = root.descendants().filter((n) => n.depth > 0 && n.children);
const leaves = root.leaves();

const groupCircles = world.append("g").selectAll("circle").data(groups).join("circle")
  .attr("class", (d) => `group ${d.data.level}`)
  .attr("cx", (d) => d.x).attr("cy", (d) => d.y).attr("r", (d) => d.r);

// Extinct species are hollow gray rings (outer edge = the dot's radius).
const leafCircles = world.append("g").selectAll("circle").data(leaves).join("circle")
  .attr("class", (d) => `leaf ${d.data.bird.status.toLowerCase()}${GONE.has(d.data.bird.status) ? " gone" : ""}`)
  .attr("cx", (d) => d.x).attr("cy", (d) => d.y)
  .attr("r", (d) => (GONE.has(d.data.bird.status) ? d.r * 0.72 : d.r))
  .attr("stroke-width", (d) => (GONE.has(d.data.bird.status) ? d.r * 0.56 : null))
  .attr("fill", (d) => (GONE.has(d.data.bird.status) ? "none" : STATUS[d.data.bird.status].color))
  .style("pointer-events", "all");

const hoverRing = world.append("circle").attr("class", "ring").style("display", "none");
const selectedRing = world.append("circle").attr("class", "ring selected").style("display", "none");
const labelLayer = svg.append("g").attr("class", "labels").attr("pointer-events", "none");
const notesLayer = svg.append("g").attr("class", "notes").attr("pointer-events", "none");

let focus = root;
let view = [root.x, root.y, root.r * 2];
const toScreen = (x, y) => {
  const k = SIZE / view[2];
  return [(x - view[0]) * k + SIZE / 2, (y - view[1]) * k + SIZE / 2];
};

function zoomTo(v) {
  view = v;
  const k = SIZE / v[2];
  world.attr("transform", `translate(${SIZE / 2},${SIZE / 2}) scale(${k}) translate(${-v[0]},${-v[1]})`);
  drawLabels();
}

// Only the level in view gets detail: groups on the zoom path are open containers,
// their children are solid circles shaded by share threatened, and species dots
// appear only inside the family you've zoomed into.
const live = (d) => d.drawn[2] > 0 || d.r > 0; // not dropped by the trait filter
function showLevel() {
  const path = new Set(focus.ancestors());
  groupCircles
    .style("display", (d) => (live(d) && path.has(d.parent) ? null : "none"))
    .classed("solid", (d) => !path.has(d))
    .style("fill", (d) => (path.has(d) || !path.has(d.parent) ? null : shadeOf(d)));
  leafCircles.style("display", (d) => (live(d) && d.parent === focus ? null : "none"));
}

function drawLabels() {
  const k = SIZE / view[2];
  // Label the focus's children: orders or families, or species when they are big enough.
  const kids = focus.children ?? [];
  const called = focus === root && filterKey === "all" ? new Set(CALLOUTS.map((c) => c[0])) : new Set();
  const shown = kids.filter((d) => {
    if (called.has(d.data.name)) return false;
    const width = commonName(d).length * 7; // rough text width at 12.5px
    return d.r * k > 30 && width < d.r * k * 1.9;
  });
  const second = (d) => (d.data.bird ? STATUS[d.data.bird.status].name : `${pct(stats(d, false).rate)} threatened`);
  labelLayer.selectAll("g.label")
    .data(shown, (d) => d.data.name)
    .join((enter) => {
      const g = enter.append("g").attr("class", "label");
      g.append("text").attr("class", "l1").attr("dy", "-0.2em");
      g.append("text").attr("class", "l2").attr("dy", "1.05em");
      return g;
    })
    .attr("transform", (d) => `translate(${toScreen(d.x, d.y)})`)
    .call((g) => g.select(".l1").text((d) => commonName(d)))
    .call((g) => g.select(".l2").text(second));
}

function drawNotes() {
  notesLayer.selectAll("*").remove();
  if (focus !== root || filterKey !== "all") return;
  const [rx, ry] = toScreen(root.x, root.y);
  const R = root.r * (SIZE / view[2]);
  const placed = [];
  for (const [orderName, lines] of CALLOUTS) {
    const node = groups.find((n) => n.data.name === orderName);
    const [cx, cy] = toScreen(node.x, node.y);
    const dist = Math.hypot(cx - rx, cy - ry) || 1;
    const dx = (cx - rx) / dist;
    const dy = (cy - ry) / dist;
    const x0 = cx + dx * node.r;
    const y0 = cy + dy * node.r;
    const x1 = rx + dx * (R + 22);
    let y1 = ry + dy * (R + 22);
    const left = dx < 0;
    const text = lines(stats(node, false), share(node));
    const h = text.length * 16 + 12;
    for (const p of placed) {
      if (p.left === left && Math.abs(p.y - y1) < (p.h + h) / 2) y1 = p.y + (y1 >= p.y ? 1 : -1) * (p.h + h) / 2;
    }
    placed.push({ left, y: y1, h });
    const g = notesLayer.append("g");
    g.append("circle").attr("cx", x0).attr("cy", y0).attr("r", 2.5);
    g.append("line").attr("x1", x0).attr("y1", y0).attr("x2", x1).attr("y2", y1);
    const t = g.append("text").attr("y", y1).attr("text-anchor", left ? "end" : "start");
    text.forEach(([s, bold], i) => {
      t.append("tspan").attr("x", x1 + (left ? -6 : 6))
        .attr("dy", i ? "1.25em" : `${0.35 - (text.length - 1) * 0.625}em`)
        .attr("class", bold ? "b" : null).text(s);
    });
  }
  notesLayer.attr("opacity", 0).transition().duration(300).attr("opacity", 1);
}

function zoom(target) {
  if (!target || target === focus || target.data.bird || !target.value) return;
  focus = target;
  clearSelected();
  showLevel();
  moveCamera();
  hideTooltip();
  updateChrome();
}
// Glide the view to the focus group's (current) position.
function moveCamera() {
  notesLayer.selectAll("*").remove();
  const end = [focus.x, focus.y, focus.r * 2.05];
  svg.transition().duration(750).tween("zoom", () => {
    const i = d3.interpolateZoom(view, end);
    return (t) => zoomTo(i(t));
  }).on("end", drawNotes);
}
const zoomOut = () => focus.parent && zoom(focus.parent);

// Clicking anything zooms one level deeper toward it (orders -> families -> species).
function stepToward(d) {
  if (d === focus) return null;
  if (focus.ancestors().includes(d)) return d;
  if (d.ancestors().includes(focus)) {
    let n = d;
    while (n.parent !== focus) n = n.parent;
    return n;
  }
  return d.ancestors().find((a) => a.depth === focus.depth) ?? null;
}
const targetOf = (d) => (d.data.bird && d.parent === focus ? d : stepToward(d));

world.on("click", (event) => {
  const d = d3.select(event.target).datum();
  if (!d) return;
  if (d === focus) return zoomOut();
  const t = targetOf(d);
  if (t?.data.bird) openSpecies(t);
  else zoom(t);
});

// ---------- tooltip ----------
const stage = document.querySelector(".stage");
const tooltip = document.getElementById("tooltip");

world.on("mousemove", (event) => {
  const d = d3.select(event.target).datum();
  const t = d && targetOf(d);
  if (!t || focus.ancestors().includes(t)) return hideTooltip();
  hoverRing.style("display", null).attr("cx", t.x).attr("cy", t.y).attr("r", t.r);
  tooltip.innerHTML = t.data.bird ? speciesTip(t.data.bird) : groupTip(t);
  tooltip.hidden = false;
  const box = stage.getBoundingClientRect();
  let x = event.clientX - box.left + 16;
  let y = event.clientY - box.top + 16;
  if (x + tooltip.offsetWidth > box.width) x = event.clientX - box.left - tooltip.offsetWidth - 16;
  if (y + tooltip.offsetHeight > box.height) y = event.clientY - box.top - tooltip.offsetHeight - 16;
  tooltip.style.left = `${Math.max(0, x)}px`;
  tooltip.style.top = `${Math.max(0, y)}px`;
});
world.on("mouseleave", hideTooltip);

function hideTooltip() {
  tooltip.hidden = true;
  hoverRing.style("display", "none");
}

const dot = (s) => `<span class="dot ${GONE.has(s) ? "ring" : s.toLowerCase()}" style="background:${STATUS[s].color}"></span>`;
const statusLine = (b) => `<span class="status">${dot(b.status)}${STATUS[b.status].name}${b.possiblyExtinct ? " (possibly extinct)" : ""}</span>`;

function speciesTip(b) {
  return `<div class="t-name">${esc(b.name)}</div>
    <div class="t-latin">${esc(b.sci)}</div>
    ${statusLine(b)}
    <div class="t-line">${fmtMass(b.mass)} · ${esc(b.habitat)}${b.island ? " · breeds only on islands" : ""}</div>
    <div class="t-hint">Click for its full profile</div>`;
}

function mixBar(s) {
  const total = s.living + s.gone;
  return `<div class="mix">${RANK.filter((k) => s.counts[k]).map((k) =>
    `<span style="width:${(s.counts[k] / total) * 100}%;background:${STATUS[k].color}" title="${STATUS[k].name}"></span>`).join("")}</div>`;
}

function groupTip(node) {
  const s = stats(node, false);
  let html = `<div class="t-name">${esc(commonName(node))}</div>`;
  if (commonName(node) !== node.data.name) html += `<div class="t-latin">${esc(node.data.name)}</div>`;
  html += mixBar(s);
  html += `<div class="t-line"><strong>${s.threat}</strong> of ${num(s.living)} living species threatened (${pct(s.rate)})</div>`;
  if (s.gone) html += `<div class="t-line">${s.gone} extinct or extinct in the wild</div>`;
  if (filterKey !== "all") {
    const f = stats(node);
    html += `<div class="t-line">${f.living ? `${pct(f.rate)} of its ${FILTERS[filterKey].label} (${f.threat} of ${f.living})` : `No ${FILTERS[filterKey].label}`}</div>`;
  }
  return html + '<div class="t-hint">Click to zoom in</div>';
}

// ---------- selected species ----------
// After its pop-up closes, a ring stays on the species you opened.
function markSelected(leaf) {
  selectedRing.style("display", null).attr("cx", leaf.x).attr("cy", leaf.y).attr("r", leaf.r);
}
function clearSelected() {
  selectedRing.style("display", "none");
}

// ---------- chrome: crumbs, reset button, readout, species list ----------
const crumbs = document.getElementById("crumbs");
const resetBtn = document.getElementById("reset");
const readout = document.getElementById("readout");
const list = document.getElementById("species-list");

function updateChrome() {
  crumbs.innerHTML = "";
  if (focus !== root) {
    focus.ancestors().reverse().forEach((node, i, arr) => {
      if (i) crumbs.insertAdjacentHTML("beforeend", '<span class="sep">›</span>');
      if (i === arr.length - 1) {
        crumbs.insertAdjacentHTML("beforeend", `<strong>${esc(commonName(node))}</strong>`);
      } else {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = commonName(node);
        btn.addEventListener("click", () => zoom(node));
        crumbs.append(btn);
      }
    });
  }
  resetBtn.hidden = focus === root;
  updateReadout();
  updateList();
}
resetBtn.addEventListener("click", () => zoom(root));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (profileOpen()) leaveProfile();
  else zoomOut();
});

// ---------- species profiles: each bird has its own URL, #sp=Genus_species ----------
const bySci = new Map(leaves.map((l) => [l.data.bird.sci, l]));
function leaveProfile() {
  history.pushState(null, "", location.pathname + location.search);
  closeProfile();
}
function route() {
  const m = location.hash.match(/^#sp=(.+)$/);
  const leaf = m && bySci.get(decodeURIComponent(m[1]).replace(/_/g, " "));
  if (!leaf) return closeProfile();
  if (focus !== leaf.parent) zoom(leaf.parent); // coming back lands on its family
  markSelected(leaf);
  const dot = leafCircles.filter((d) => d === leaf).node().getBoundingClientRect();
  openProfile({
    bird: leaf.data.bird,
    relatives: leaf.parent.leaves().map((l) => l.data.bird),
    familyName: commonName(leaf.parent),
    allRate: base.rate,
    from: dot.width ? [dot.x + dot.width / 2, dot.y + dot.height / 2] : null,
  }, leaveProfile);
}
// Clicking a species dot pops its profile up over the atlas (and gives it a shareable URL).
function openSpecies(leaf) {
  hideTooltip();
  location.hash = `sp=${encodeURIComponent(leaf.data.bird.sci.replace(/ /g, "_"))}`;
}
window.addEventListener("hashchange", route);

function compare(rate, ref, refLabel) {
  if (!ref) return `while none of ${refLabel} are`;
  const ratio = rate / ref;
  if (ratio >= 1.9 && ratio < 2.15) return `about twice the rate for ${refLabel} (${pct(ref)})`;
  if (ratio >= 1.25) return `${d3.format(".1f")(ratio)} times the rate for ${refLabel} (${pct(ref)})`;
  if (ratio <= 0.8) return `below the ${pct(ref)} rate for ${refLabel}`;
  return `close to the ${pct(ref)} rate for ${refLabel}`;
}

function updateReadout() {
  const label = FILTERS[filterKey].label;
  const name = esc(commonName(focus));
  const whole = stats(focus, false);
  compareBox.classList.add("empty");
  let html;
  if (!label) {
    html = focus === root
      ? `<strong>${num(whole.threat)}</strong> of ${num(whole.living)} living species, or <strong>${pct(whole.rate)}</strong>, are threatened with extinction. Another ${whole.gone} are already extinct or survive only in captivity.`
      : `In <strong>${name}</strong>, <strong>${pct(whole.rate)}</strong> of species are threatened (${num(whole.threat)} of ${num(whole.living)}), ${compare(whole.rate, base.rate, "all birds")}.`;
  } else {
    // Trait vs everyone else in the same view: all other birds, or the rest of the family.
    const f = stats(focus);
    const r = statsRest(focus);
    const others = focus === root ? "all other birds" : "the rest";
    if (!f.living) {
      html = focus === root ? `No ${label} in the data.` : `There are no ${label} in <strong>${name}</strong>.`;
    } else {
      html = `${focus === root ? "" : `In <strong>${name}</strong>, `}<strong>${pct(f.rate)}</strong> of ${label} are threatened (${num(f.threat)} of ${num(f.living)})`;
      html += r.living ? `, vs <strong>${pct(r.rate)}</strong> of ${others} (${num(r.threat)} of ${num(r.living)}).` : `. Every species here is one of the ${label}.`;
      if (f.living && r.living) drawCompare(f, r, label, others);
    }
  }
  readout.innerHTML = html;
}

// The simple diagram under the readout: % threatened, trait vs the rest.
const compareBox = document.getElementById("compare");
function drawCompare(f, r, label, others) {
  const bar = (text, s, cls) => `<div class="cmp-row ${cls}"><span class="cmp-lab">${text}</span>
    <span class="cmp-track"><span class="cmp-fill" style="width:${s.rate * 100}%"></span></span><span class="cmp-val">${pct(s.rate)}</span></div>`;
  const where = focus === root ? "" : ` in ${esc(commonName(focus).toLowerCase())}`;
  compareBox.innerHTML = `<div class="cmp-title">Share threatened${where}</div>`
    + bar(label[0].toUpperCase() + label.slice(1), f, "on") + bar(others[0].toUpperCase() + others.slice(1), r, "");
  compareBox.classList.remove("empty");
}

function updateList() {
  if (focus.data.level !== "family") {
    list.hidden = true;
    return;
  }
  const species = focus.leaves().map((l) => l.data.bird);
  list.hidden = false;
  list.open = false;
  list.querySelector("summary").textContent =
    `List all ${species.length} species of ${commonName(focus).toLowerCase()}, by status`;
  list.querySelector(".species-list-body").innerHTML = [...RANK].reverse().map((s) => {
    const group = species.filter((b) => b.status === s);
    if (!group.length) return "";
    return `<h4>${STATUS[s].name} (${group.length})</h4><ul>${group.map((b) =>
      `<li>${dot(s)}${esc(b.name)}${b.possiblyExtinct ? " (possibly extinct)" : ""}${matches(b) ? "" : ""}</li>`).join("")}</ul>`;
  }).join("");
}

// ---------- filters ----------
const pills = document.querySelectorAll(".pills button");
function setFilter(key) {
  filterKey = key;
  pills.forEach((p) => p.setAttribute("aria-pressed", String(p.dataset.filter === key)));
  leafCircles.classed("faded", (d) => !matches(d.data.bird));
  document.getElementById("shade-title").textContent = key === "all"
    ? SHADE_TITLE : `Orders & families: share of their ${FILTERS[key].label} threatened`;
  clearSelected();
  hideTooltip();
  repack();
  // If the group in view lost all its matches, step out to the nearest group that kept some.
  while (!focus.value && focus.parent) focus = focus.parent;
  animateLayout();
  moveCamera();
  updateChrome();
}

// Re-pack with only the families that have at least one bird with the trait. A kept
// family keeps all its species (non-matching ones faded), so the within-family
// comparison stays visible; families with no match shrink away.
function repack() {
  const kept = new Set(leaves.filter((l) => matches(l.data.bird)).map((l) => l.parent));
  root.sum((d) => (d.bird ? 1 : 0)); // reset, then zero out the dropped families
  root.each((n) => { if (n.data.level === "family" && !kept.has(n)) n.each((m) => { m.value = 0; }); });
  root.eachAfter((n) => { if (n.children) n.value = d3.sum(n.children, (c) => c.value); });
  // Pack only the surviving branches (empty ones would still reserve padding),
  // then restore the full tree and park the dropped circles at their parent's center.
  const parents = root.descendants().filter((n) => n.children);
  parents.forEach((n) => { n.allKids = n.children; n.children = n.children.filter((c) => c.value > 0); });
  pack(root);
  parents.forEach((n) => { n.children = n.allKids; });
  root.each((n) => { if (!n.value) { n.x = n.parent.x; n.y = n.parent.y; n.r = 0; } });
}

// Slide what's on screen at this level to its new spot; everything hidden just jumps.
function animateLayout() {
  const path = new Set(focus.ancestors());
  const onScreen = (d) => live(d) && (d.data.bird ? d.parent === focus : path.has(d.parent));
  const put = (el, d, [x, y, r]) => {
    const gone = d.data.bird && GONE.has(d.data.bird.status);
    el.setAttribute("cx", x); el.setAttribute("cy", y); el.setAttribute("r", gone ? r * 0.72 : r);
    if (gone) el.setAttribute("stroke-width", r * 0.56);
  };
  for (const sel of [groupCircles, leafCircles]) {
    sel.filter((d) => !onScreen(d)).each(function (d) { d.drawn = [d.x, d.y, d.r]; put(this, d, d.drawn); });
  }
  const g = groupCircles.filter(onScreen);
  const l = leafCircles.filter(onScreen);
  showLevel();
  const at = (d, t) => [0, 1, 2].map((i) => d.drawn[i] + ([d.x, d.y, d.r][i] - d.drawn[i]) * t);
  let lastT = 0;
  const draw = (t) => {
    lastT = t;
    g.each(function (d) { put(this, d, at(d, t)); });
    l.each(function (d) { put(this, d, at(d, t)); });
  };
  const settle = (t) => {
    [...g.data(), ...l.data()].forEach((d) => { d.drawn = at(d, t); });
    showLevel();
  };
  world.transition("layout").duration(750).ease(d3.easeCubicInOut)
    .tween("layout", () => draw)
    .on("end", () => settle(1))
    .on("interrupt", () => settle(lastT));
}
pills.forEach((p) => p.addEventListener("click", () => setFilter(p.dataset.filter)));

document.getElementById("try-rails").addEventListener("click", () => {
  setFilter("island");
  document.querySelector(".atlas").scrollIntoView({ behavior: "smooth" });
  zoom(groups.find((n) => n.data.name === "Rallidae"));
});

// ---------- legend ----------
// Two keys: the shade of group circles, then the status colors of species dots.
const SHADE_TITLE = "Orders & families: share of species threatened";
const item = (s, label = STATUS[s].name) => `<span class="item">${dot(s)}${label}</span>`;
const at = (v) => `${(v / SHADE_MAX) * 100}%`;
const ticks = [[0, "0%"], [base.rate, `│ ${pct(base.rate)}, all birds`], [SHADE_MAX, `${pct(SHADE_MAX)}+`]];
document.getElementById("legend").innerHTML = `
  <div class="key">
    <span class="key-title" id="shade-title">${SHADE_TITLE}</span>
    <span class="ramp" style="background:linear-gradient(90deg, ${SHADE_STOPS.map(([v, c]) => `${c} ${at(v)}`).join(", ")})"></span>
    <span class="ramp-ticks">${ticks.map(([v, t]) => `<span style="left:${at(v)}">${t}</span>`).join("")}</span>
  </div>
  <div class="key">
    <span class="key-title">Species, once you open a family: Red List status</span>
    <span class="key-items">${item("LC")}${item("NT")}<span class="group"><span class="group-label">Threatened</span><span class="group-items">${item("VU")}${item("EN")}${item("CR")}</span></span>${item("EX", "Extinct")}</span>
  </div>`;

// ---------- start ----------
showLevel();
zoomTo(view);
updateChrome();
drawNotes();
route();
