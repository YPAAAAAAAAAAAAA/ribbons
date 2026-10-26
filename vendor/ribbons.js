/* Ribbons — OKLab identity loom. Clean-room, no upstream code.
   Shipped with LICENSE.txt (MIT, copyright ypaaaaaaaaaaaaa). */
(function () {
  "use strict";

  var STORE = "ribbons-loom-v1";
  var NS = "http://www.w3.org/2000/svg";

  var state = {
    seed: "nava",
    mix: "nava",
    L: 0.6,
    C: 0.14,
    h: 5.5,
    contrast: 0.9,
    chromaAff: 0.18,
    primary: 0.52,
    segments: 5,
    variation: 2
  };

  var stage, svg, marks, seedName, seedInput, swatches, stripes;
  var mainHex, mainChip, variations, btnRandom;
  var refs = null;
  var geom = null;
  var currentPal = null;
  var phase = 0;
  var waving = false;
  var lastW = 0;
  var lastH = 0;
  var ptrs = new Map();
  var gesture = null;

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function hash32(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function linearToSrgb(c) {
    c = clamp(c, 0, 1);
    if (c <= 0.0031308) return 12.92 * c;
    return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }

  function oklabToLinear(L, a, b) {
    var l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    var m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    var s_ = L - 0.0894841775 * a - 1.291485548 * b;
    var l = l_ * l_ * l_;
    var m = m_ * m_ * m_;
    var s = s_ * s_ * s_;
    return {
      r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
    };
  }

  function inGamut(c) {
    return c.r >= -0.001 && c.r <= 1.001 && c.g >= -0.001 && c.g <= 1.001 && c.b >= -0.001 && c.b <= 1.001;
  }

  function channel(v) {
    return Math.round(clamp(linearToSrgb(v), 0, 1) * 255).toString(16).padStart(2, "0");
  }

  function encode(L, C, h) {
    var chroma = Math.max(0, C);
    var full = oklabToLinear(L, Math.cos(h) * chroma, Math.sin(h) * chroma);
    var best = chroma;
    if (!inGamut(full)) {
      var lo = 0;
      var hi = chroma;
      best = 0;
      for (var i = 0; i < 16; i++) {
        var mid = (lo + hi) / 2;
        var lin = oklabToLinear(L, Math.cos(h) * mid, Math.sin(h) * mid);
        if (inGamut(lin)) {
          best = mid;
          lo = mid;
        } else hi = mid;
      }
    }
    var out = oklabToLinear(L, Math.cos(h) * best, Math.sin(h) * best);
    return "#" + channel(out.r) + channel(out.g) + channel(out.b);
  }

  function makePalette(s) {
    var n = s.segments | 0;
    var rng = mulberry32(hash32(s.mix + "|" + s.variation + "|" + n + "|" + s.primary.toFixed(3)));
    var raw = [];
    var i;
    for (i = 0; i < n; i++) {
      var bias = i === 0 ? 0.55 + s.primary * 1.8 : 0.55;
      raw.push(bias * (0.55 + rng()));
    }
    var sum = raw.reduce(function (a, b) { return a + b; }, 0) || 1;
    var weights = raw.map(function (v) { return v / sum; });
    var wob = [];
    for (i = 0; i < n; i++) wob.push(rng() - 0.5);
    var hueSpan = 0.45 + (1 - s.chromaAff) * 1.35;
    var segs = [];
    for (i = 0; i < n; i++) {
      var t = n === 1 ? 0 : i / (n - 1) - 0.5;
      var hh = s.h + t * hueSpan + (i === 0 ? 0 : wob[i] * (1 - s.chromaAff) * 0.22);
      var L = clamp(s.L + t * s.contrast * 0.62 + (i % 2 ? 0.05 : -0.04) * s.contrast, 0.32, 0.9);
      var C = s.C * (0.72 + s.chromaAff * 0.45) * (1 - Math.abs(t) * 0.22);
      segs.push({ weight: weights[i], hex: encode(L, Math.max(0, C), hh), L: L });
    }
    return {
      segments: segs,
      main: encode(s.L, s.C, s.h),
      ink: encode(0.2, 0.03, s.h),
      mainL: s.L
    };
  }

  function shownSeed(s) {
    var t = String(s || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 24);
    return t || "nava";
  }

  function el(name, attrs) {
    var node = document.createElementNS(NS, name);
    if (attrs) {
      for (var k in attrs) node.setAttribute(k, attrs[k]);
    }
    return node;
  }

  function layoutOf(w, h) {
    var pad = 12;
    var foot = 32;
    var chipH = Math.max(54, Math.min(100, (h - foot) * 0.115));
    var chipY = h - foot - chipH;
    var top = pad + 4;
    var avail = Math.max(80, chipY - 8 - top);
    var sealD = Math.min(w - pad * 2, avail * 0.34);
    var R = sealD / 2;
    var cx = w / 2;
    var cy = top + R;
    var ribbonTop = cy + R * 0.58;
    var tilesH = Math.max(40, Math.min(avail * 0.2, chipY - ribbonTop - 36));
    var tilesY = chipY - 8 - tilesH;
    var ribbonH = Math.max(16, tilesY - 8 - ribbonTop);
    return {
      w: w,
      h: h,
      seal: { cx: cx, cy: cy, R: R },
      ribbon: { x: pad, y: ribbonTop, w: w - pad * 2, h: ribbonH },
      tiles: { x: pad, y: tilesY, w: w - pad * 2, h: tilesH },
      chips: { x: pad, y: chipY, w: w - pad * 2, h: chipH }
    };
  }

  function segmentsAngles(weights, rot) {
    var out = [];
    var a = -Math.PI / 2 + rot;
    for (var i = 0; i < weights.length; i++) {
      var span = weights[i] * Math.PI * 2;
      var g = Math.min(0.045, span * 0.16);
      var a0 = a + g;
      var a1 = a + span - g;
      out.push(a1 > a0 + 0.01 ? [a0, a1] : [a, a + span]);
      a += span;
    }
    return out;
  }

  function ringPath(cx, cy, r0, r1, a0, a1) {
    var large = a1 - a0 > Math.PI ? 1 : 0;
    var x0 = cx + Math.cos(a0) * r1;
    var y0 = cy + Math.sin(a0) * r1;
    var x1 = cx + Math.cos(a1) * r1;
    var y1 = cy + Math.sin(a1) * r1;
    var x2 = cx + Math.cos(a1) * r0;
    var y2 = cy + Math.sin(a1) * r0;
    var x3 = cx + Math.cos(a0) * r0;
    var y3 = cy + Math.sin(a0) * r0;
    return "M" + x0.toFixed(2) + " " + y0.toFixed(2) +
      " A" + r1.toFixed(2) + " " + r1.toFixed(2) + " 0 " + large + " 1 " + x1.toFixed(2) + " " + y1.toFixed(2) +
      " L" + x2.toFixed(2) + " " + y2.toFixed(2) +
      " A" + r0.toFixed(2) + " " + r0.toFixed(2) + " 0 " + large + " 0 " + x3.toFixed(2) + " " + y3.toFixed(2) + " Z";
  }

  function piePath(cx, cy, r, a0, a1) {
    var large = a1 - a0 > Math.PI ? 1 : 0;
    var x0 = cx + Math.cos(a0) * r;
    var y0 = cy + Math.sin(a0) * r;
    var x1 = cx + Math.cos(a1) * r;
    var y1 = cy + Math.sin(a1) * r;
    return "M" + cx.toFixed(2) + " " + cy.toFixed(2) +
      " L" + x0.toFixed(2) + " " + y0.toFixed(2) +
      " A" + r.toFixed(2) + " " + r.toFixed(2) + " 0 " + large + " 1 " + x1.toFixed(2) + " " + y1.toFixed(2) + " Z";
  }

  function wavyColumn(x, y, w, h, ph, amp) {
    var n = 22;
    var d = "";
    var i, t, px, py;
    for (i = 0; i <= n; i++) {
      t = i / n;
      px = x + Math.sin(t * Math.PI * 2 + ph) * amp;
      py = y + t * h;
      d += (i ? "L" : "M") + px.toFixed(1) + " " + py.toFixed(1) + " ";
    }
    for (i = n; i >= 0; i--) {
      t = i / n;
      px = x + w + Math.sin(t * Math.PI * 2 + ph) * amp;
      py = y + t * h;
      d += "L" + px.toFixed(1) + " " + py.toFixed(1) + " ";
    }
    return d + "Z";
  }

  function ribbonPaths(weights, rect, ph) {
    var gap = Math.max(4, rect.w * 0.012);
    var inner = rect.w - gap * (weights.length - 1);
    var x = rect.x;
    var out = [];
    for (var i = 0; i < weights.length; i++) {
      var colW = Math.max(2, inner * weights[i]);
      var amp = Math.min(9, colW * 0.16, rect.h * 0.03);
      out.push(wavyColumn(x, rect.y, colW, rect.h, ph + i * 0.65, amp));
      x += colW + gap;
    }
    return out;
  }

  function sliceTiles(weights, rect) {
    var gap = 4;
    var tiles = [];
    var horiz = rect.w >= rect.h;
    var x = rect.x;
    var y = rect.y;
    var rw = rect.w;
    var rh = rect.h;
    for (var k = 0; k < weights.length; k++) {
      var total = 0;
      var j;
      for (j = k; j < weights.length; j++) total += weights[j];
      total = total || 1;
      var f = weights[k] / total;
      if (horiz) {
        var tw = rw * f;
        tiles.push({ i: k, x: x + gap / 2, y: y + gap / 2, w: Math.max(0, tw - gap), h: Math.max(0, rh - gap) });
        x += tw;
        rw -= tw;
      } else {
        var th = rh * f;
        tiles.push({ i: k, x: x + gap / 2, y: y + gap / 2, w: Math.max(0, rw - gap), h: Math.max(0, th - gap) });
        y += th;
        rh -= th;
      }
      horiz = !horiz;
    }
    return tiles;
  }

  function buildSkeleton(n) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var bg = el("rect");
    var glows = [];
    var g;
    for (g = 0; g < 3; g++) {
      var glow = el("circle");
      glows.push(glow);
    }
    var gRibbon = el("g");
    var ribbons = [];
    var i;
    for (i = 0; i < n; i++) {
      var p = el("path");
      gRibbon.appendChild(p);
      ribbons.push(p);
    }
    var gTiles = el("g");
    var tiles = [];
    for (i = 0; i < n; i++) {
      var r = el("rect");
      gTiles.appendChild(r);
      tiles.push(r);
    }
    var gSeal = el("g");
    var shadow = el("ellipse");
    var pies = [];
    var arcs = [];
    for (i = 0; i < n; i++) {
      var pie = el("path");
      pies.push(pie);
    }
    for (i = 0; i < n; i++) {
      var arc = el("path");
      arcs.push(arc);
    }
    var core = el("circle");
    var ring = el("circle");
    var bead = el("circle");
    gSeal.appendChild(shadow);
    for (i = 0; i < n; i++) gSeal.appendChild(pies[i]);
    for (i = 0; i < n; i++) gSeal.appendChild(arcs[i]);
    gSeal.appendChild(core);
    gSeal.appendChild(ring);
    gSeal.appendChild(bead);
    svg.appendChild(bg);
    for (g = 0; g < glows.length; g++) svg.appendChild(glows[g]);
    svg.appendChild(gRibbon);
    svg.appendChild(gTiles);
    svg.appendChild(gSeal);
    refs = {
      n: n,
      glows: glows,
      bg: bg,
      ribbons: ribbons,
      tiles: tiles,
      pies: pies,
      arcs: arcs,
      core: core,
      bead: bead,
      ring: ring,
      shadow: shadow
    };
  }

  function updateRibbonPaths() {
    if (!geom || !refs || !currentPal) return;
    var weights = currentPal.segments.map(function (s) { return s.weight; });
    var paths = ribbonPaths(weights, geom.ribbon, phase);
    for (var i = 0; i < paths.length && i < refs.ribbons.length; i++) {
      refs.ribbons[i].setAttribute("d", paths[i]);
    }
  }

  function buildGeometry() {
    if (!geom || !refs || !currentPal) return;
    var weights = currentPal.segments.map(function (s) { return s.weight; });
    var seal = geom.seal;
    var cx = seal.cx;
    var cy = seal.cy;
    var R = seal.R;
    var glowScale = [2.15, 1.35, 0.72];
    var glowOp = ["0.16", "0.22", "0.28"];
    for (var g = 0; g < refs.glows.length; g++) {
      refs.glows[g].setAttribute("cx", cx);
      refs.glows[g].setAttribute("cy", cy);
      refs.glows[g].setAttribute("r", R * glowScale[g]);
    }
    refs._glowOp = glowOp;
    refs.bg.setAttribute("x", "0");
    refs.bg.setAttribute("y", "0");
    refs.bg.setAttribute("width", geom.w);
    refs.bg.setAttribute("height", geom.h);
    refs.shadow.setAttribute("cx", cx);
    refs.shadow.setAttribute("cy", cy + R * 0.78);
    refs.shadow.setAttribute("rx", R * 0.86);
    refs.shadow.setAttribute("ry", Math.max(8, R * 0.14));
    refs.shadow.setAttribute("fill", "#000");
    refs.shadow.setAttribute("fill-opacity", "0.28");
    var ang = segmentsAngles(weights, 0);
    var pie = segmentsAngles(weights, Math.PI / weights.length);
    var r1 = R * 0.98;
    var r0 = R * 0.7;
    var rPie = R * 0.6;
    var i;
    for (i = 0; i < weights.length; i++) {
      refs.arcs[i].setAttribute("d", ringPath(cx, cy, r0, r1, ang[i][0], ang[i][1]));
      refs.pies[i].setAttribute("d", piePath(cx, cy, rPie, pie[i][0], pie[i][1]));
    }
    refs.core.setAttribute("cx", cx);
    refs.core.setAttribute("cy", cy);
    refs.core.setAttribute("r", R * 0.28);
    refs.ring.setAttribute("cx", cx);
    refs.ring.setAttribute("cy", cy);
    refs.ring.setAttribute("r", R * 0.34);
    refs.ring.setAttribute("fill", "none");
    refs.ring.setAttribute("stroke-width", Math.max(2, R * 0.028));
    refs.bead.setAttribute("cx", cx - R * 0.09);
    refs.bead.setAttribute("cy", cy - R * 0.1);
    refs.bead.setAttribute("r", R * 0.07);
    refs.bead.setAttribute("fill", "#fff");
    refs.bead.setAttribute("fill-opacity", "0.42");
    var tileRects = sliceTiles(weights, geom.tiles);
    for (i = 0; i < tileRects.length; i++) {
      var t = tileRects[i];
      var node = refs.tiles[t.i];
      var rx = Math.min(12, t.w / 4, t.h / 4);
      node.setAttribute("x", t.x.toFixed(2));
      node.setAttribute("y", t.y.toFixed(2));
      node.setAttribute("width", Math.max(0, t.w).toFixed(2));
      node.setAttribute("height", Math.max(0, t.h).toFixed(2));
      node.setAttribute("rx", rx.toFixed(2));
    }
    updateRibbonPaths();
  }

  function paintStripes(pal) {
    if (stripes.childElementCount !== pal.segments.length) {
      stripes.textContent = "";
      for (var i = 0; i < pal.segments.length; i++) stripes.appendChild(document.createElement("i"));
    }
    var kids = stripes.children;
    for (var k = 0; k < kids.length; k++) {
      kids[k].style.flexGrow = String(pal.segments[k].weight);
      kids[k].style.background = pal.segments[k].hex;
    }
  }

  function paintSwatches(pal) {
    if (swatches.childElementCount !== pal.segments.length) {
      swatches.textContent = "";
      pal.segments.forEach(function (seg) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "swatch";
        b.addEventListener("click", function () {
          copyText(b.getAttribute("data-hex") || "", b);
        });
        swatches.appendChild(b);
      });
    }
    var kids = swatches.children;
    for (var i = 0; i < kids.length; i++) {
      kids[i].style.flexGrow = String(pal.segments[i].weight);
      kids[i].style.background = pal.segments[i].hex;
      kids[i].setAttribute("data-hex", pal.segments[i].hex);
      kids[i].setAttribute("aria-label", pal.segments[i].hex);
    }
  }

  function labelGradient(pal) {
    var stops = [];
    var acc = 0;
    for (var i = 0; i < pal.segments.length; i++) {
      var a = acc * 100;
      acc += pal.segments[i].weight;
      var b = acc * 100;
      stops.push(pal.segments[i].hex + " " + a.toFixed(1) + "% " + b.toFixed(1) + "%");
    }
    return "linear-gradient(90deg," + stops.join(",") + ")";
  }

  function applyColors() {
    currentPal = makePalette(state);
    var pal = currentPal;
    if (!refs) return;
    var i;
    for (i = 0; i < pal.segments.length; i++) {
      var hex = pal.segments[i].hex;
      if (refs.ribbons[i]) refs.ribbons[i].setAttribute("fill", hex);
      if (refs.tiles[i]) refs.tiles[i].setAttribute("fill", hex);
      if (refs.arcs[i]) refs.arcs[i].setAttribute("fill", hex);
      if (refs.pies[i]) refs.pies[i].setAttribute("fill", hex);
    }
    refs.core.setAttribute("fill", pal.main);
    var light = pal.segments[pal.segments.length - 1].hex;
    refs.ring.setAttribute("stroke", light);
    refs.bg.setAttribute("fill", pal.ink);
    for (var g = 0; g < refs.glows.length; g++) {
      refs.glows[g].setAttribute("fill", pal.main);
      refs.glows[g].setAttribute("fill-opacity", refs._glowOp[g]);
    }
    document.documentElement.style.background = pal.ink;
    document.body.style.background = pal.ink;
    stage.style.setProperty("--main", pal.main);
    stage.style.setProperty("--ink", pal.ink);
    stage.style.setProperty("--onmain", pal.mainL > 0.62 ? "#241816" : "#f7f1ea");
    for (i = 0; i < 8; i++) {
      stage.style.setProperty("--c" + i, pal.segments[i] ? pal.segments[i].hex : pal.main);
    }
    mainHex.textContent = pal.main;
    mainChip.style.background = pal.main;
    document.getElementById("mark-label").style.background = labelGradient(pal);
    seedName.textContent = shownSeed(state.seed);
    paintStripes(pal);
    paintSwatches(pal);
    markVariation();
  }

  function placeMarks() {
    if (!geom) return;
    var c = geom.chips;
    marks.style.left = c.x + "px";
    marks.style.top = c.y + "px";
    marks.style.width = c.w + "px";
    marks.style.height = c.h + "px";
    marks.style.setProperty("--mark-fs", Math.max(13, c.h * 0.28) + "px");
  }

  function paintAll() {
    var w = stage.clientWidth | 0;
    var h = stage.clientHeight | 0;
    if (w < 2 || h < 2) return false;
    lastW = w;
    lastH = h;
    geom = layoutOf(w, h);
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    currentPal = makePalette(state);
    if (!refs || refs.n !== state.segments) buildSkeleton(state.segments);
    buildGeometry();
    applyColors();
    placeMarks();
    return true;
  }

  function markVariation() {
    var buttons = variations.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      var on = Number(buttons[i].getAttribute("data-v")) === state.variation;
      buttons[i].classList.toggle("on", on);
      buttons[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function syncControls() {
    seedInput.value = state.seed;
    var contrast = document.getElementById("rng-contrast");
    var segments = document.getElementById("rng-segments");
    var chroma = document.getElementById("rng-chroma");
    var primary = document.getElementById("rng-primary");
    contrast.value = String(Math.round(state.contrast * 100));
    document.getElementById("rng-contrast-v").textContent = contrast.value;
    segments.value = String(state.segments);
    document.getElementById("rng-segments-v").textContent = String(state.segments);
    chroma.value = String(Math.round(state.chromaAff * 100));
    document.getElementById("rng-chroma-v").textContent = chroma.value;
    primary.value = String(Math.round(state.primary * 100));
    document.getElementById("rng-primary-v").textContent = primary.value;
    markVariation();
  }

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        seed: state.seed,
        mix: state.mix,
        L: state.L,
        C: state.C,
        h: state.h,
        contrast: state.contrast,
        chromaAff: state.chromaAff,
        primary: state.primary,
        segments: state.segments,
        variation: state.variation
      }));
    } catch (e) {}
  }

  function load() {
    try {
      var o = JSON.parse(localStorage.getItem(STORE) || "null");
      if (!o || typeof o !== "object") return;
      if (typeof o.seed === "string" && o.seed) state.seed = shownSeed(o.seed);
      if (typeof o.mix === "string" && o.mix) state.mix = shownSeed(o.mix);
      if (Number.isFinite(o.L)) state.L = clamp(o.L, 0.34, 0.82);
      if (Number.isFinite(o.C)) state.C = clamp(o.C, 0.02, 0.2);
      if (Number.isFinite(o.h)) state.h = o.h;
      if (Number.isFinite(o.contrast)) state.contrast = clamp(o.contrast, 0, 1);
      if (Number.isFinite(o.chromaAff)) state.chromaAff = clamp(o.chromaAff, 0, 1);
      if (Number.isFinite(o.primary)) state.primary = clamp(o.primary, 0, 1);
      if (Number.isFinite(o.segments)) state.segments = clamp(o.segments | 0, 3, 8);
      if (Number.isFinite(o.variation)) state.variation = clamp(o.variation | 0, 0, 3);
    } catch (e) {}
  }

  function derive(name) {
    var seed = shownSeed(name);
    var rng = mulberry32(hash32("derive:" + seed));
    state.seed = seed;
    state.mix = seed;
    state.L = 0.5 + rng() * 0.24;
    state.C = 0.08 + rng() * 0.08;
    state.h = rng() * Math.PI * 2;
    state.contrast = 0.45 + rng() * 0.5;
    state.chromaAff = 0.12 + rng() * 0.55;
    state.primary = 0.3 + rng() * 0.5;
    state.segments = 4 + ((rng() * 4) | 0);
    state.variation = (rng() * 4) | 0;
    seedInput.value = seed;
    syncControls();
    paintAll();
    save();
  }

  function randomIdentity() {
    var rng = mulberry32((Math.random() * 4294967296) >>> 0);
    var c = "bdfgklmnprstv";
    var v = "aeiou";
    var end = "lnr";
    function syl() {
      return c[(rng() * c.length) | 0] + v[(rng() * v.length) | 0] + (rng() < 0.55 ? end[(rng() * end.length) | 0] : "");
    }
    derive(syl() + syl());
  }

  function flash(node) {
    node.classList.remove("flash");
    void node.offsetWidth;
    node.classList.add("flash");
  }

  function copyText(text, node) {
    function done() { if (node) flash(node); }
    function fallback() {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try { document.execCommand("copy"); } catch (e) {}
      area.remove();
      done();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else fallback();
  }

  function spanDist() {
    var pts = [];
    ptrs.forEach(function (p) { pts.push(p); });
    if (pts.length < 2) return 0;
    var dx = pts[0].x - pts[1].x;
    var dy = pts[0].y - pts[1].y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    if (ptrs.size >= 2) {
      gesture = { mode: "pinch", dist: Math.max(12, spanDist()), C: state.C };
    } else {
      gesture = { mode: "drag", x: e.clientX, y: e.clientY, L: state.L, h: state.h };
    }
    e.preventDefault();
  }

  function onMove(e) {
    if (!ptrs.has(e.pointerId) || !gesture) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.mode === "pinch" && ptrs.size >= 2) {
      var d = spanDist();
      state.C = clamp(gesture.C * (d / gesture.dist), 0.02, 0.2);
    } else if (gesture.mode === "drag") {
      state.h = gesture.h + (e.clientX - gesture.x) * 0.015;
      state.L = clamp(gesture.L - (e.clientY - gesture.y) * 0.0015, 0.34, 0.82);
    }
    applyColors();
    e.preventDefault();
  }

  function onUp(e) {
    ptrs.delete(e.pointerId);
    if (ptrs.size === 0) {
      gesture = null;
      save();
      return;
    }
    if (ptrs.size === 1) {
      var p = null;
      ptrs.forEach(function (v) { p = v; });
      gesture = { mode: "drag", x: p.x, y: p.y, L: state.L, h: state.h };
    }
  }

  function bindRange(id, read) {
    var input = document.getElementById(id);
    var out = document.getElementById(id + "-v");
    input.addEventListener("input", function () {
      read(Number(input.value));
      if (out) out.textContent = input.value;
      paintAll();
      save();
    });
  }

  function bind() {
    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onUp);
    document.getElementById("btn-random").addEventListener("click", randomIdentity);
    document.getElementById("btn-seed").addEventListener("click", function () {
      derive(seedInput.value);
    });
    document.getElementById("btn-copy").addEventListener("click", function () {
      var lines = currentPal ? currentPal.segments.map(function (s) { return s.hex; }) : [];
      if (currentPal) lines.unshift(currentPal.main);
      copyText(lines.join(" "), document.getElementById("btn-copy"));
    });
    seedInput.addEventListener("input", function () {
      state.seed = shownSeed(seedInput.value);
      seedName.textContent = state.seed;
    });
    seedInput.addEventListener("change", save);
    seedInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") derive(seedInput.value);
    });
    bindRange("rng-contrast", function (v) { state.contrast = clamp(v / 100, 0, 1); });
    bindRange("rng-segments", function (v) { state.segments = clamp(v | 0, 3, 8); });
    bindRange("rng-chroma", function (v) { state.chromaAff = clamp(v / 100, 0, 1); });
    bindRange("rng-primary", function (v) { state.primary = clamp(v / 100, 0, 1); });
    variations.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("button") : null;
      if (!b) return;
      state.variation = clamp(Number(b.getAttribute("data-v")) || 0, 0, 3);
      markVariation();
      paintAll();
      save();
    });
    var panel = document.getElementById("panel");
    ["pointerdown", "pointermove", "pointerup", "touchstart", "touchmove", "wheel"].forEach(function (type) {
      panel.addEventListener(type, function (ev) { ev.stopPropagation(); });
    });
  }

  function mountToggle() {
    function ensure() {
      var host = document.getElementById("gb-ui-toggle");
      var mine = document.getElementById("loom-toggle");
      if (host) {
        if (mine) mine.remove();
        return;
      }
      if (mine) return;
      var b = document.createElement("button");
      b.id = "loom-toggle";
      b.type = "button";
      b.setAttribute("aria-label", "Show controls");
      b.setAttribute("aria-expanded", "false");
      b.textContent = "\u2699";
      b.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var on = document.documentElement.classList.toggle("gb-ui-open");
        b.setAttribute("aria-expanded", on ? "true" : "false");
      });
      document.body.appendChild(b);
    }
    ensure();
    var mo = new MutationObserver(ensure);
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  function startWave() {
    if (waving) return;
    waving = true;
    var reduce = false;
    try {
      reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {}
    function loop() {
      if (!reduce && !document.hidden) {
        phase += 0.012;
        updateRibbonPaths();
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  var sent = false;
  function signalReady() {
    if (sent) return;
    if (window.__gbSandbox && typeof window.__gbSandbox.ready === "function") {
      sent = true;
      window.__gbSandbox.ready();
      return;
    }
    requestAnimationFrame(signalReady);
  }

  function boot() {
    load();
    stage = document.getElementById("stage");
    svg = document.getElementById("loom");
    marks = document.getElementById("marks");
    seedName = document.getElementById("seed-name");
    seedInput = document.getElementById("seed-input");
    swatches = document.getElementById("swatches");
    stripes = document.getElementById("stripes");
    mainHex = document.getElementById("main-hex");
    mainChip = document.getElementById("main-chip");
    variations = document.getElementById("variations");
    btnRandom = document.getElementById("btn-random");
    syncControls();
    bind();
    mountToggle();
    function kick() {
      if (!paintAll()) {
        requestAnimationFrame(kick);
        return;
      }
      window.__loomPainted = true;
      requestAnimationFrame(function () { requestAnimationFrame(signalReady); });
      startWave();
    }
    kick();
    if (typeof ResizeObserver === "function") {
      var ro = new ResizeObserver(function () {
        var w = stage.clientWidth | 0;
        var h = stage.clientHeight | 0;
        if (w !== lastW || h !== lastH) paintAll();
      });
      ro.observe(stage);
    } else {
      window.addEventListener("resize", function () { paintAll(); });
    }
  }

  boot();
})();
