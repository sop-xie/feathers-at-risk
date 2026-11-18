// Species profile pop-up, opened from the atlas (URL: #sp=Genus_species).
// Layout borrows from field guides: the photo first, then a panel with one
// headline number and the bird's traits, a zoomable range map, and a name banner.
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import * as topojson from "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm";

const STATUS = {
  LC: { name: "Least concern", color: "#2fa283" },
  NT: { name: "Near threatened", color: "#e3dcbc" },
  VU: { name: "Vulnerable", color: "#f19d4c" },
  EN: { name: "Endangered", color: "#d9533f" },
  CR: { name: "Critically endangered", color: "#9b1b1b" },
  EW: { name: "Extinct in the wild", color: "#5c5c5c" },
  EX: { name: "Extinct", color: "#5c5c5c" },
};
const LIVING = new Set(["LC", "NT", "VU", "EN", "CR"]);
const THREAT = new Set(["VU", "EN", "CR"]);
const GONE = new Set(["EW", "EX"]);
const W = 900;
const H = 600;

const pct = d3.format(".0%");
const num = d3.format(",");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtMass = (g) => (g >= 1000 ? `${d3.format(g >= 10000 ? ".0f" : ".1~f")(g / 1000)} kg` : `${d3.format(g < 10 ? ".1~f" : ".0f")(g)} g`);
const dotClass = (s) => (GONE.has(s) ? "ring" : s.toLowerCase());

const el = document.createElement("section");
el.className = "profile";
el.hidden = true;
el.setAttribute("aria-label", "Species profile");
el.innerHTML = `
 <div class="pf-dialog" role="dialog" aria-modal="true" aria-labelledby="pf-name">
  <button type="button" class="pf-close" aria-label="Close profile">×</button>
  <div class="pf-grid">
    <aside class="pf-side">
      <figure class="pf-photo"><div class="pf-img"></div><figcaption></figcaption></figure>
      <div class="pf-panel">
        <p class="pf-k">IUCN Red List, 2024</p>
        <div class="pf-status"></div>
        <div class="pf-box"></div>
        <dl class="pf-facts"></dl>
      </div>
    </aside>
    <div class="pf-map">
      <h3 class="pf-maptitle"></h3>
      <div class="pf-maplegend"></div>
      <div class="pf-mapbox">
        <svg viewBox="0 0 ${W} ${H}" role="img"></svg>
        <div class="pf-zoom" role="group" aria-label="Map zoom">
          <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
          <button type="button" data-zoom="out" aria-label="Zoom out">−</button>
          <button type="button" data-zoom="reset" aria-label="Reset map view">⟲</button>
        </div>
      </div>
      <p class="pf-maphint">Drag to pan. Pinch, Ctrl/⌘ + scroll, or the buttons to zoom.</p>
      <p class="pf-mapnote"></p>
    </div>
  </div>
  <footer class="pf-foot">
    <div><h2 class="pf-name" id="pf-name"></h2><span class="pf-sci"></span></div>
    <p class="pf-src">Data: AVONET (Tobias et al., 2022) · BIRDBASE (Şekercioğlu et al., 2025) · IUCN Red List 2024 · Sightings: GBIF.org</p>
  </footer>
 </div>`;
document.body.append(el);
const $ = (s) => el.querySelector(s);

let onBack = () => {};
$(".pf-close").addEventListener("click", () => onBack());
// A click on the dimmed backdrop (outside the dialog) closes it too.
el.addEventListener("click", (e) => { if (e.target === el) onBack(); });
const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

export const profileOpen = () => !el.hidden;
export function closeProfile() {
  if (el.hidden) return;
  el.hidden = true;
  document.documentElement.classList.remove("pf-lock");
}

// Grow the dialog out of the dot that was clicked (or the screen center).
function popFrom(from) {
  const box = $(".pf-dialog");
  const r = box.getBoundingClientRect();
  const [x, y] = from ?? [innerWidth / 2, innerHeight / 2];
  box.style.transformOrigin = `${x - r.left}px ${y - r.top}px`;
  box.animate([{ transform: "scale(.04)", opacity: 0 }, { transform: "none", opacity: 1 }],
    { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
  el.animate([{ backgroundColor: "rgba(18,18,18,0)" }, { backgroundColor: "rgba(18,18,18,.5)" }], { duration: 320 });
}

// ctx: { bird, relatives: [bird], familyName, allRate, from: [clientX, clientY] of the clicked dot }
export function openProfile(ctx, back) {
  const { bird: b, relatives, familyName, allRate, from } = ctx;
  onBack = back;
  const living = relatives.filter((r) => LIVING.has(r.status));
  const threat = living.filter((r) => THREAT.has(r.status)).length;
  const rate = living.length ? threat / living.length : 0;

  $(".pf-status").innerHTML = `<span class="big ${dotClass(b.status)}" style="background:${STATUS[b.status].color}"></span>
    <div>${STATUS[b.status].name}${b.possiblyExtinct ? "<small>flagged as possibly extinct</small>" : ""}</div>`;

  let box = `Its family, <b>${esc(familyName)}</b>
    <strong>${pct(rate)} threatened</strong>${num(threat)} of ${num(living.length)} living species, vs ${pct(allRate)} of all birds.`;
  const isl = living.filter((r) => r.island === 1);
  const main = living.filter((r) => r.island !== 1);
  if (isl.length >= 5 && main.length >= 5) {
    const r = (list) => list.filter((x) => THREAT.has(x.status)).length / list.length;
    box += `<div class="pf-split">Island-only breeders in the family: <b>${pct(r(isl))}</b> threatened, vs <b>${pct(r(main))}</b> of the rest.</div>`;
  }
  $(".pf-box").innerHTML = box;

  const clutch = b.clutchMin == null && b.clutchMax == null ? null
    : b.clutchMin === b.clutchMax || b.clutchMax == null ? `${b.clutchMin ?? b.clutchMax}`
      : `${b.clutchMin ?? "?"}–${b.clutchMax}`;
  const facts = [
    ["Body mass", fmtMass(b.mass)],
    ["Beak length", Number.isFinite(b.beak) ? `${b.beak} mm` : null],
    ["Habitat", b.habitat],
    ["Diet", b.diet],
    ["Breeds only on islands", b.island ? "Yes" : "No"],
    ["Flightless", b.flightless ? "Yes" : "No"],
    ["Eggs per clutch", clutch],
    ["Range size", Number.isFinite(b.range) ? `${num(b.range)} km²` : null],
  ].filter(([, v]) => v);
  $(".pf-facts").innerHTML = facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");

  $(".pf-name").textContent = b.name;
  $(".pf-sci").textContent = b.sci;
  const wasOpen = !el.hidden;
  el.hidden = false;
  el.scrollTop = 0;
  document.documentElement.classList.add("pf-lock");
  $(".pf-close").focus({ preventScroll: true });
  if (!wasOpen && !calm.matches) popFrom(from);

  drawMap(b);
  showPhoto(b);
}

// ---------- map ----------
// The bird's range comes from GBIF (gbif.org): a density map of every recorded
// sighting and specimen, tinted one blue so it can't be confused with the status
// colors. The map zooms; zooming in swaps in sharper GBIF tiles for the area in view.
const GBIF = "https://api.gbif.org";
const RANGE_RGB = [0.184, 0.373, 0.596]; // #2f5f98
const MAX_TILE_Z = 12;
let worldP;
let map = null; // the map currently drawn: projection, layers and tile grid

const mapSvg = d3.select(el).select(".pf-map svg");
const zoomer = d3.zoom()
  .scaleExtent([1, 24])
  // Plain scrolling keeps scrolling the pop-up; pinch (ctrl+wheel) or Ctrl/⌘+scroll zooms.
  .filter((e) => (e.type === "wheel" ? e.ctrlKey || e.metaKey : !e.button))
  .on("zoom", (e) => {
    if (!map) return;
    map.zg.attr("transform", e.transform);
    map.marker?.attr("r", 7 / e.transform.k);
  })
  .on("end", (e) => map?.range && sharpen(e.transform));
mapSvg.call(zoomer);
el.querySelectorAll(".pf-zoom button").forEach((btn) => btn.addEventListener("click", () => {
  const t = mapSvg.transition().duration(350);
  if (btn.dataset.zoom === "reset") t.call(zoomer.transform, d3.zoomIdentity);
  else t.call(zoomer.scaleBy, btn.dataset.zoom === "in" ? 2 : 0.5);
}));

async function gbifRange(b) {
  try {
    const m = await (await fetch(`${GBIF}/v1/species/match?${new URLSearchParams({ name: b.sci, class: "Aves" })}`)).json();
    if (!m.usageKey || m.rank !== "SPECIES" || !["EXACT", "FUZZY"].includes(m.matchType)) return null;
    const c = await (await fetch(`${GBIF}/v2/map/occurrence/density/capabilities.json?taxonKey=${m.usageKey}`)).json();
    return c.total ? { key: m.usageKey, ...c } : null;
  } catch {
    return null;
  }
}

async function drawMap(b) {
  map = null;
  mapSvg.selectAll("*").remove();
  mapSvg.call(zoomer.transform, d3.zoomIdentity);
  const note = $(".pf-mapnote");
  const title = $(".pf-maptitle");
  const legend = $(".pf-maplegend");
  title.textContent = "Loading the map…";
  legend.innerHTML = note.textContent = "";
  worldP ??= d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json");
  const [world, range] = await Promise.all([worldP, gbifRange(b)]);
  if ($(".pf-name").textContent !== b.name) return; // another bird was opened meanwhile

  const clampLat = (v) => Math.max(-85, Math.min(85, v));
  const hasCenter = Number.isFinite(b.lat) && Number.isFinite(b.lon);
  let frame;
  let lonC = 0; // map center longitude; ranges across the Pacific stay in one piece
  if (range) {
    // GBIF reports longitudes past 180 when a range crosses the date line (e.g. 101 to 367).
    const whole = range.maxLng - range.minLng > 300;
    const lo0 = whole ? -180 : range.minLng;
    const lo1 = whole ? 180 : range.maxLng;
    lonC = whole ? 0 : (((lo0 + lo1) / 2 + 540) % 360) - 180;
    const padLon = whole ? 0 : Math.max(10, (lo1 - lo0) * 0.15);
    const padLat = Math.max(7, (range.maxLat - range.minLat) * 0.15);
    frame = [[lo0 - padLon, clampLat(range.minLat - padLat)], [lo1 + padLon, clampLat(range.maxLat + padLat)]];
  } else if (hasCenter) {
    lonC = b.lon;
    frame = [[b.lon - 25, clampLat(b.lat - 16)], [b.lon + 25, clampLat(b.lat + 16)]];
  } else {
    title.textContent = "No map data for this species";
    return;
  }
  // Equirectangular, so GBIF's EPSG:4326 tiles line up with the drawn map.
  const proj = d3.geoEquirectangular().rotate([-lonC, 0]).fitExtent([[16, 16], [W - 16, H - 16]], { type: "MultiPoint", coordinates: frame });
  const path = d3.geoPath(proj);
  const countries = world.objects.countries;
  const [[sx0, sy0], [sx1, sy1]] = path.bounds({ type: "Sphere" });
  const vy0 = Math.max(0, sy0 - 4);
  const vy1 = Math.min(H, sy1 + 4);
  mapSvg.attr("viewBox", [0, vy0, W, vy1 - vy0])
    .attr("aria-label", `Map of where the ${b.name} ${range ? "has been recorded" : "lives"}`);
  zoomer.extent([[0, vy0], [W, vy1]]).translateExtent([[0, vy0], [W, vy1]]);

  const defs = mapSvg.append("defs");
  defs.append("clipPath").attr("id", "pf-clip").append("path").attr("d", path({ type: "Sphere" }));
  // Recolor GBIF's purple-yellow density tiles to one blue: brighter source = more records = more opaque.
  const f = defs.append("filter").attr("id", "pf-range").attr("color-interpolation-filters", "sRGB");
  f.append("feColorMatrix").attr("type", "matrix").attr("result", "tint")
    .attr("values", `0 0 0 0 ${RANGE_RGB[0]}  0 0 0 0 ${RANGE_RGB[1]}  0 0 0 0 ${RANGE_RGB[2]}  0.2 0.38 0.07 0 0.32`);
  f.append("feComposite").attr("in", "tint").attr("in2", "SourceGraphic").attr("operator", "in");

  const zg = mapSvg.append("g"); // everything that pans and zooms
  const g = zg.append("g").attr("clip-path", "url(#pf-clip)");
  g.append("path").attr("class", "pf-land").attr("d", path(topojson.feature(world, countries)));
  const pxPerDeg = (proj.scale() * Math.PI) / 180;
  map = { zg, range, proj, lonC, pxPerDeg, cx: proj([lonC, 0])[0], sx0, sx1, sy0, sy1, vy0, vy1 };
  if (range) {
    map.tiles = g.append("g").attr("filter", "url(#pf-range)");
    map.z = tileZoom(1);
    map.base = map.tiles.append("g");
    addTiles(map.base, map.z, [0, W, vy0, vy1]);
  }
  g.append("path").attr("class", "pf-borders").attr("d", path(topojson.mesh(world, countries, (x, y) => x !== y)));

  if (range) {
    title.textContent = `Where the ${b.name} has been recorded`;
    legend.innerHTML = `<span><i class="pf-ramp"></i>Fewer → more records</span>`;
    note.textContent = `Blue shading: ${num(range.total)} sightings and specimens of ${b.name} in GBIF, the Global Biodiversity Information Facility. Records follow where people go birding, so well-watched places look denser, and a few strays and captive birds can appear outside the real range.`;
  } else {
    map.marker = zg.append("circle").attr("class", "pf-center").attr("r", 7)
      .attr("transform", `translate(${proj([b.lon, b.lat])})`);
    title.textContent = `Where the ${b.name} lives`;
    legend.innerHTML = `<span><i class="pf-centerdot"></i>Center of its range</span>`;
    note.textContent = `No GBIF records found for ${b.name}, so the marker shows the center of its breeding range from AVONET.`;
  }
}

// The GBIF tile zoom whose resolution matches the map drawn at scale k.
const tileZoom = (k) => Math.max(0, Math.min(MAX_TILE_Z, Math.ceil(Math.log2((map.pxPerDeg * k * 1.5 * 180) / 512))));

// Fetch the tiles at zoom z covering [x0, x1, y0, y1] of map space. The map is a plain
// lon/lat grid shifted to lonC, so tiles are placed with straight arithmetic in
// "unwrapped" longitude (it may run past ±180 near the date line).
function addTiles(layer, z, [x0, x1, y0, y1]) {
  const m = map;
  const deg = 180 / 2 ** z;
  const hexPerTile = Math.max(16, 48 >> Math.max(0, z - 2)); // bigger hexes when zoomed in
  const lonVis0 = m.lonC + (Math.max(x0, m.sx0) - m.cx) / m.pxPerDeg;
  const lonVis1 = m.lonC + (Math.min(x1, m.sx1) - m.cx) / m.pxPerDeg;
  const latTop = Math.min(90, m.proj.invert([m.cx, Math.max(y0, m.sy0) + 0.5])[1]);
  const latBot = Math.max(-90, m.proj.invert([m.cx, Math.min(y1, m.sy1) - 0.5])[1]);
  const nx = 2 ** (z + 1);
  const t0 = Math.floor((lonVis0 + 180) / deg);
  const t1 = Math.floor((lonVis1 + 180 - 1e-9) / deg);
  const ty0 = Math.max(0, Math.floor((90 - latTop) / deg));
  const ty1 = Math.min(2 ** z - 1, Math.floor((90 - latBot - 1e-9) / deg));
  const loads = [];
  for (let t = t0; t <= t1; t++) {
    const x = ((t % nx) + nx) % nx;
    const lon = -180 + t * deg;
    for (let y = ty0; y <= ty1; y++) {
      const py0 = m.proj([m.lonC, 90 - y * deg])[1];
      const py1 = m.proj([m.lonC, 90 - (y + 1) * deg])[1];
      const img = layer.append("image").attr("preserveAspectRatio", "none")
        .attr("x", m.cx + (lon - m.lonC) * m.pxPerDeg).attr("y", py0)
        .attr("width", deg * m.pxPerDeg + 0.6 / 2 ** (z - m.z || 0)).attr("height", py1 - py0 + 0.6 / 2 ** (z - m.z || 0)) // overlap hides seams
        .attr("href", `${GBIF}/v2/map/occurrence/density/${z}/${x}/${y}@1x.png?srs=EPSG:4326&taxonKey=${m.range.key}&bin=hex&hexPerTile=${hexPerTile}&style=purpleYellow-noborder.poly`);
      loads.push(new Promise((res) => img.on("load error", res)));
    }
  }
  return Promise.all(loads);
}

// After a zoom or pan, load sharper tiles for the area in view; once they arrive,
// they replace the coarse base layer (both sit under one tint, so nothing doubles up).
async function sharpen(t) {
  const m = map;
  const z = tileZoom(t.k);
  if (z <= m.z) {
    m.tiles.selectAll(".hi").remove();
    m.base.style("display", null);
    return;
  }
  const view = [(0 - t.x) / t.k, (W - t.x) / t.k, (m.vy0 - t.y) / t.k, (m.vy1 - t.y) / t.k];
  const layer = m.tiles.append("g").attr("class", "hi").attr("data-z", z);
  await addTiles(layer, z, view);
  if (map !== m || !layer.node().isConnected) return;
  m.tiles.selectAll(".hi").filter(function () { return this !== layer.node(); }).remove();
  m.base.style("display", "none");
}

// ---------- photo (Wikipedia page image, credited from Wikimedia Commons) ----------
let photoSeq = 0;
async function showPhoto(b) {
  const seq = ++photoSeq;
  const img = $(".pf-img");
  const cap = $(".pf-photo figcaption");
  img.innerHTML = '<div class="none">Looking for a photo…</div>';
  cap.textContent = "";
  try {
    const q = new URLSearchParams({
      action: "query", titles: b.sci, prop: "pageimages|info", piprop: "thumbnail|name",
      pithumbsize: "640", inprop: "url", redirects: "1", format: "json", origin: "*",
    });
    const page = Object.values((await (await fetch(`https://en.wikipedia.org/w/api.php?${q}`)).json()).query.pages)[0];
    let meta = null;
    if (page?.pageimage && page.thumbnail) {
      const q2 = new URLSearchParams({
        action: "query", titles: `File:${page.pageimage}`, prop: "imageinfo", iiprop: "extmetadata",
        iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl", format: "json", origin: "*",
      });
      const file = Object.values((await (await fetch(`https://commons.wikimedia.org/w/api.php?${q2}`)).json()).query.pages)[0];
      meta = file?.imageinfo?.[0]?.extmetadata ?? null; // null = not on Commons, so not freely licensed
    }
    if (seq !== photoSeq) return;
    if (!meta) {
      img.innerHTML = '<div class="none">No freely licensed photo found.</div>';
      if (page?.fullurl) cap.innerHTML = `<a href="${esc(page.fullurl)}" target="_blank" rel="noopener">Read about it on Wikipedia</a>`;
      return;
    }
    const artist = new DOMParser().parseFromString(meta.Artist?.value ?? "Unknown", "text/html").body.textContent.trim();
    const license = meta.LicenseShortName?.value ?? "see file page";
    const fileUrl = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(page.pageimage)}`;
    img.innerHTML = `<img src="${esc(page.thumbnail.source)}" alt="${esc(b.name)}">`;
    cap.innerHTML = `Photo: ${esc(artist)}, ${meta.LicenseUrl ? `<a href="${esc(meta.LicenseUrl.value)}" target="_blank" rel="noopener">${esc(license)}</a>` : esc(license)},
      via <a href="${esc(fileUrl)}" target="_blank" rel="noopener">Wikimedia Commons</a>`;
  } catch {
    if (seq === photoSeq) img.innerHTML = '<div class="none">Photo unavailable offline.</div>';
  }
}
