/* FCC 47 — Interactive LOSVD Explorer
 * Companion page to Lamprecht et al. (A&A).
 *
 * Dependency-free: the kinematic map and the LOSVD panel are drawn directly on
 * <canvas>, so the page is a few hundred kB in total, loads in well under a
 * second, works offline and can be archived alongside the paper.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------- constants

  var MODELS = ["FCC47_SINFONI", "FCC47_MUSE"];
  var REFF = 0.75;            // adopted NSC effective radius [arcsec] (Turner et al. 2012)
  var REFF_ERR = 0.125;
  var SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  var QUANTITIES = {
    vel:       { sym: "V",  qual: "posterior median", unit: "km s⁻¹", diverging: true,  err: "dvel" },
    velmean:   { sym: "V",  qual: "posterior mean",   unit: "km s⁻¹", diverging: true,  err: "velstd" },
    sigma:     { sym: "σ", qual: "posterior median", unit: "km s⁻¹", diverging: false, err: "dsigma" },
    sigmamean: { sym: "σ", qual: "posterior mean",   unit: "km s⁻¹", diverging: false, err: "sigmastd" },
    h3:        { sym: "h₃", qual: "", unit: "", diverging: true,  err: "dh3" },
    h4:        { sym: "h₄", qual: "", unit: "", diverging: true,  err: "dh4" },
    snr:       { sym: "S/N", qual: "effective", unit: "", diverging: false, err: null }
  };

  // Diverging (RdBu_r) and sequential (viridis) colour tables, sampled from
  // matplotlib and interpolated linearly in between.
  var CMAP_DIV = [[5,48,97],[23,82,144],[42,115,178],[73,146,193],[122,175,212],[170,203,227],[207,224,236],[230,238,244],[247,247,247],[251,234,226],[250,212,193],[244,180,150],[226,138,108],[203,94,76],[178,52,54],[141,25,49],[103,0,31]];
  var CMAP_SEQ = [[68,1,84],[72,24,106],[71,45,123],[65,67,135],[57,86,140],[49,104,142],[42,120,142],[36,136,142],[31,152,139],[33,168,132],[54,183,120],[87,197,104],[128,208,85],[175,215,61],[223,220,39],[253,231,37]];

  // ------------------------------------------------------------------- helpers

  function $(id) { return document.getElementById(id); }

  function lerpColor(table, t) {
    t = Math.max(0, Math.min(1, t));
    var x = t * (table.length - 1);
    var i = Math.min(table.length - 2, Math.floor(x));
    var f = x - i, a = table[i], b = table[i + 1];
    return [
      Math.round(a[0] + f * (b[0] - a[0])),
      Math.round(a[1] + f * (b[1] - a[1])),
      Math.round(a[2] + f * (b[2] - a[2]))
    ];
  }

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    var idx = (sorted.length - 1) * p;
    var lo = Math.floor(idx), hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  function niceTicks(min, max, target) {
    if (!(isFinite(min) && isFinite(max)) || max <= min) return [min];
    var raw = (max - min) / Math.max(2, target);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    var ticks = [], t = Math.ceil(min / step) * step;
    for (; t <= max + step * 1e-6; t += step) ticks.push(Math.abs(t) < step * 1e-6 ? 0 : t);
    return ticks;
  }

  function fmtTick(v, step) {
    var dec = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
    return v.toFixed(dec);
  }

  function fmt(v, dec) {
    return (v === null || v === undefined || !isFinite(v)) ? "—" : v.toFixed(dec);
  }

  var SUP = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴",
              5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
  function superscript(n) {
    return String(n).split("").map(function (c) { return SUP[c] || c; }).join("");
  }

  // Axis scaling: keep tick labels short by pulling a power of ten into the label.
  function axisScale(maxValue) {
    if (!(maxValue > 0)) return { factor: 1, suffix: "" };
    var e = Math.floor(Math.log(maxValue) / Math.LN10);
    if (e >= -1 && e < 4) return { factor: 1, suffix: "" };
    return { factor: Math.pow(10, e), suffix: "10" + superscript(e) + " " };
  }

  function searchIndex(edges, value) {
    if (value < edges[0] || value > edges[edges.length - 1]) return -1;
    var lo = 0, hi = edges.length - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (value < edges[mid]) hi = mid; else lo = mid;
    }
    return lo;
  }

  function download(name, mime, text) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // --------------------------------------------------------------------- state

  var DATA = {};
  var state = {
    model: "FCC47_SINFONI",
    quantity: "vel",
    bin: 0,
    locked: false,
    overlay: false,
    common: false,
    zoom: true
  };

  function ds() { return DATA[state.model]; }
  function other() { return DATA[ds().match.model]; }
  function matchedBin() { return ds().match.bin[state.bin]; }

  // Colour limits for the current quantity, optionally shared between data sets.
  function limits() {
    var q = QUANTITIES[state.quantity];
    var models = state.common ? MODELS : [state.model];
    var all = [];
    models.forEach(function (m) {
      var v = DATA[m].kin[state.quantity];
      if (v) all = all.concat(v);
    });
    all = all.filter(isFinite).sort(function (a, b) { return a - b; });
    if (q.diverging) {
      var vmax = Math.max(percentile(all.map(Math.abs).sort(function (a, b) { return a - b; }), 0.99), 1e-6);
      return { lo: -vmax, hi: vmax };
    }
    return { lo: percentile(all, 0.01), hi: percentile(all, 0.99) };
  }

  function colorFor(value, lim, diverging) {
    var t = (value - lim.lo) / (lim.hi - lim.lo || 1);
    return lerpColor(diverging ? CMAP_DIV : CMAP_SEQ, t);
  }

  // ----------------------------------------------------------------- map panel

  function mapGeometry(w, h, d) {
    var m = { l: 52, r: 104, t: 8, b: 40 };
    var xe = d.grid.xedges, ye = d.grid.yedges;
    var x0 = xe[0], x1 = xe[xe.length - 1], y0 = ye[0], y1 = ye[ye.length - 1];
    var aw = Math.max(10, w - m.l - m.r), ah = Math.max(10, h - m.t - m.b);
    var scale = Math.min(aw / (x1 - x0), ah / (y1 - y0));     // equal aspect
    var pw = scale * (x1 - x0), ph = scale * (y1 - y0);
    var px = m.l + (aw - pw) / 2, py = m.t + (ah - ph) / 2;
    return {
      x0: x0, x1: x1, y0: y0, y1: y1, px: px, py: py, pw: pw, ph: ph, m: m,
      sx: function (v) { return px + (v - x0) / (x1 - x0) * pw; },
      sy: function (v) { return py + ph - (v - y0) / (y1 - y0) * ph; },
      ix: function (cx) { return x0 + (cx - px) / pw * (x1 - x0); },
      iy: function (cy) { return y0 + (py + ph - cy) / ph * (y1 - y0); }
    };
  }

  var imageCache = {};
  function binImageCanvas(d, quantity, lim) {
    var key = d.model + "|" + quantity + "|" + lim.lo.toFixed(4) + "|" + lim.hi.toFixed(4);
    if (imageCache.key === key) return imageCache.canvas;
    var nx = d.grid.nx, ny = d.grid.ny;
    var cv = document.createElement("canvas");
    cv.width = nx; cv.height = ny;
    var ictx = cv.getContext("2d");
    var img = ictx.createImageData(nx, ny);
    var values = d.kin[quantity];
    var diverging = QUANTITIES[quantity].diverging;
    for (var row = 0; row < ny; row++) {
      for (var col = 0; col < nx; col++) {
        var b = d.grid.image[row * nx + col];
        // canvas row 0 is the top of the image = highest y
        var o = ((ny - 1 - row) * nx + col) * 4;
        if (b < 0 || !isFinite(values[b])) { img.data[o + 3] = 0; continue; }
        var c = colorFor(values[b], lim, diverging);
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
    }
    ictx.putImageData(img, 0, 0);
    imageCache = { key: key, canvas: cv };
    return cv;
  }

  function drawMap(ctx, w, h, opts) {
    opts = opts || {};
    var d = ds(), q = QUANTITIES[state.quantity], lim = limits();
    var g = mapGeometry(w, h, d);

    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    // --- binned image
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(binImageCanvas(d, state.quantity, lim), g.px, g.py, g.pw, g.ph);
    ctx.imageSmoothingEnabled = true;

    // --- frame
    ctx.strokeStyle = "#8a97aa";
    ctx.lineWidth = 1;
    ctx.strokeRect(g.px + .5, g.py + .5, g.pw - 1, g.ph - 1);

    // --- bin centres
    ctx.fillStyle = "rgba(20,30,45,.22)";
    for (var i = 0; i < d.nbins; i++) {
      ctx.beginPath();
      ctx.arc(g.sx(d.kin.xbin[i]), g.sy(d.kin.ybin[i]), 1.1, 0, 6.2832);
      ctx.fill();
    }

    // --- adopted NSC effective radius
    var rpx = REFF / (g.x1 - g.x0) * g.pw;
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.px, g.py, g.pw, g.ph);
    ctx.clip();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "rgba(15,25,40,.85)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(g.sx(0), g.sy(0), rpx, 0, 6.2832);
    ctx.stroke();
    ctx.restore();

    // --- selection + matched bin
    var b = state.bin;
    if (b !== null && b >= 0) {
      var cx = g.sx(d.kin.xbin[b]), cy = g.sy(d.kin.ybin[b]);
      var s = Math.max(7, Math.min(14, g.pw / 26));
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#0f1a28";
      ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
      ctx.strokeStyle = "rgba(255,255,255,.9)";
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - s / 2 - 1.5, cy - s / 2 - 1.5, s + 3, s + 3);

      if (state.overlay) {
        var o = other(), ob = matchedBin();
        ctx.strokeStyle = "#b4531f";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(g.sx(o.kin.xbin[ob]), g.sy(o.kin.ybin[ob]), s * 0.9, 0, 6.2832);
        ctx.stroke();
      }
    }

    // --- axes
    ctx.fillStyle = "#4a586b";
    ctx.font = "12px " + SANS;
    ctx.strokeStyle = "#8a97aa";
    ctx.lineWidth = 1;
    var xt = niceTicks(g.x0, g.x1, 5), xstep = xt.length > 1 ? xt[1] - xt[0] : 1;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    xt.forEach(function (t) {
      var x = Math.round(g.sx(t)) + .5;
      ctx.beginPath(); ctx.moveTo(x, g.py + g.ph); ctx.lineTo(x, g.py + g.ph + 5); ctx.stroke();
      ctx.fillText(fmtTick(t, xstep), x, g.py + g.ph + 8);
    });
    var yt = niceTicks(g.y0, g.y1, 5), ystep = yt.length > 1 ? yt[1] - yt[0] : 1;
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    yt.forEach(function (t) {
      var y = Math.round(g.sy(t)) + .5;
      ctx.beginPath(); ctx.moveTo(g.px - 5, y); ctx.lineTo(g.px, y); ctx.stroke();
      ctx.fillText(fmtTick(t, ystep), g.px - 8, y);
    });
    ctx.fillStyle = "#16202e";
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillText("Δx [arcsec]", g.px + g.pw / 2, g.py + g.ph + 34);
    ctx.save();
    ctx.translate(14, g.py + g.ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Δy [arcsec]", 0, 0);
    ctx.restore();

    // --- colour bar (kept clear of the right edge whatever the image aspect)
    var cbw = 13, cbh = g.ph, cby = g.py;
    var cbx = Math.min(g.px + g.pw + 22, w - 86);
    var grad = ctx.createLinearGradient(0, cby + cbh, 0, cby);
    for (var s2 = 0; s2 <= 20; s2++) {
      var c = lerpColor(q.diverging ? CMAP_DIV : CMAP_SEQ, s2 / 20);
      grad.addColorStop(s2 / 20, "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")");
    }
    ctx.fillStyle = grad;
    ctx.fillRect(cbx, cby, cbw, cbh);
    ctx.strokeStyle = "#8a97aa";
    ctx.strokeRect(cbx + .5, cby + .5, cbw - 1, cbh - 1);
    var ct = niceTicks(lim.lo, lim.hi, 5), cstep = ct.length > 1 ? ct[1] - ct[0] : 1;
    ctx.fillStyle = "#4a586b";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    var tickW = 0;
    ct.forEach(function (t) {
      var y = cby + cbh - (t - lim.lo) / (lim.hi - lim.lo) * cbh;
      ctx.beginPath(); ctx.moveTo(cbx + cbw, y); ctx.lineTo(cbx + cbw + 4, y); ctx.stroke();
      var txt = fmtTick(t, cstep);
      tickW = Math.max(tickW, ctx.measureText(txt).width);
      ctx.fillText(txt, cbx + cbw + 7, y);
    });
    ctx.save();
    ctx.fillStyle = "#16202e";
    ctx.translate(Math.min(cbx + cbw + 16 + tickW + 14, w - 6), cby + cbh / 2);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillText(q.sym + (q.unit ? " [" + q.unit + "]" : ""), 0, 0);
    ctx.restore();

    ctx.restore();
    return g;
  }

  // --------------------------------------------------------------- LOSVD panel

  // Curves of one bin, either as stored amplitudes or as a density of unit area.
  // The posterior-median LOSVD is a pointwise median and sums to slightly less
  // than one, so the unit-area form renormalises it (and its credible band, by
  // the same factor) such that the integral over velocity is exactly one.
  function curves(d, bin, density) {
    var k = 1;
    if (density) {
      var sum = 0, med = d.losvd.med[bin];
      for (var i = 0; i < med.length; i++) sum += med[i];
      k = 1 / (d.dv * (sum || 1));
    }
    return {
      v: d.losvd.v,
      med: d.losvd.med[bin].map(function (x) { return x * k; }),
      p16: d.losvd.p16[bin].map(function (x) { return x * k; }),
      p84: d.losvd.p84[bin].map(function (x) { return x * k; })
    };
  }

  function drawLosvd(ctx, w, h) {
    var d = ds(), b = state.bin;
    var density = state.overlay;                 // different dv -> compare densities
    var main = curves(d, b, density);
    var over = null, o = null, ob = null;
    if (state.overlay) {
      o = other(); ob = matchedBin();
      over = curves(o, ob, density);
    }

    var m = { l: 66, r: 14, t: 12, b: 42 };
    var pw = Math.max(10, w - m.l - m.r), ph = Math.max(10, h - m.t - m.b);

    var vlo = main.v[0], vhi = main.v[main.v.length - 1];
    if (over) { vlo = Math.min(vlo, over.v[0]); vhi = Math.max(vhi, over.v[over.v.length - 1]); }
    if (state.zoom) { vlo = Math.max(vlo, -400); vhi = Math.min(vhi, 400); }
    var ymax = 0;
    [main, over].forEach(function (c) {
      if (!c) return;
      c.p84.forEach(function (y, i) {
        if (c.v[i] >= vlo - 1 && c.v[i] <= vhi + 1 && y > ymax) ymax = y;
      });
    });
    ymax = ymax * 1.1 || 1;
    var yscale = axisScale(ymax);

    var sx = function (v) { return m.l + (v - vlo) / (vhi - vlo) * pw; };
    var sy = function (y) { return m.t + ph - (y / ymax) * ph; };

    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    // grid
    var yt = niceTicks(0, ymax, 5), ystep = yt.length > 1 ? yt[1] - yt[0] : 1;
    var xt = niceTicks(vlo, vhi, 6), xstep = xt.length > 1 ? xt[1] - xt[0] : 1;
    ctx.strokeStyle = "#eef1f6";
    ctx.lineWidth = 1;
    yt.forEach(function (t) {
      var y = Math.round(sy(t)) + .5;
      ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(m.l + pw, y); ctx.stroke();
    });
    xt.forEach(function (t) {
      var x = Math.round(sx(t)) + .5;
      ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ph); ctx.stroke();
    });

    function band(c, fill) {
      ctx.beginPath();
      c.v.forEach(function (v, i) { i ? ctx.lineTo(sx(v), sy(c.p84[i])) : ctx.moveTo(sx(v), sy(c.p84[i])); });
      for (var i = c.v.length - 1; i >= 0; i--) ctx.lineTo(sx(c.v[i]), sy(c.p16[i]));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    function line(c, stroke, width, dash) {
      ctx.save();
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      c.v.forEach(function (v, i) { i ? ctx.lineTo(sx(v), sy(c.med[i])) : ctx.moveTo(sx(v), sy(c.med[i])); });
      ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.lineJoin = "round";
      ctx.stroke();
      ctx.restore();
    }

    // everything data-driven stays inside the axes (the velocity axis may be
    // truncated to +-400 km/s)
    ctx.save();
    ctx.beginPath();
    ctx.rect(m.l, m.t, pw, ph);
    ctx.clip();

    if (over) band(over, "rgba(180,83,31,.20)");
    band(main, "rgba(76,120,168,.30)");
    if (over) line(over, "#b4531f", 1.8, [6, 3]);
    line(main, "#1f4e79", 2.1);

    // median velocity of the selected bin
    var vsel = d.kin.vel[b];
    if (isFinite(vsel) && vsel > vlo && vsel < vhi) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(31,78,121,.65)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(sx(vsel), m.t); ctx.lineTo(sx(vsel), m.t + ph);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // axes
    ctx.strokeStyle = "#8a97aa";
    ctx.lineWidth = 1;
    ctx.strokeRect(m.l + .5, m.t + .5, pw - 1, ph - 1);
    ctx.fillStyle = "#4a586b";
    ctx.font = "12px " + SANS;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    xt.forEach(function (t) {
      var x = Math.round(sx(t)) + .5;
      ctx.beginPath(); ctx.moveTo(x, m.t + ph); ctx.lineTo(x, m.t + ph + 5); ctx.stroke();
      ctx.fillText(fmtTick(t, xstep), x, m.t + ph + 8);
    });
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    yt.forEach(function (t) {
      var y = Math.round(sy(t)) + .5;
      ctx.beginPath(); ctx.moveTo(m.l - 5, y); ctx.lineTo(m.l, y); ctx.stroke();
      ctx.fillText(fmtTick(t / yscale.factor, ystep / yscale.factor), m.l - 8, y);
    });
    ctx.fillStyle = "#16202e";
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillText("Velocity [km s⁻¹]", m.l + pw / 2, m.t + ph + 34);
    ctx.save();
    ctx.translate(16, m.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(density
      ? "f(v)  [" + yscale.suffix + "(km s⁻¹)⁻¹]"
      : "LOSVD amplitude" + (yscale.suffix ? "  [" + yscale.suffix.trim() + "]" : ""), 0, 0);
    ctx.restore();

    // legend
    if (over) {
      var items = [
        { c: "#1f4e79", t: d.instrument + " bin " + b, dash: false },
        { c: "#b4531f", t: o.instrument + " bin " + ob + " (nearest, " + fmt(d.match.dist[b], 2) + "″)", dash: true }
      ];
      ctx.font = "12px " + SANS;
      var bw = 0;
      items.forEach(function (it) { bw = Math.max(bw, ctx.measureText(it.t).width); });
      bw += 40;
      var bx = m.l + pw - bw - 10, by = m.t + 10;
      ctx.fillStyle = "rgba(255,255,255,.92)";
      ctx.strokeStyle = "#dde4ed";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(bx, by, bw, 18 * items.length + 10);
      ctx.fill(); ctx.stroke();
      items.forEach(function (it, i) {
        var y = by + 14 + i * 18;
        ctx.save();
        ctx.setLineDash(it.dash ? [6, 3] : []);
        ctx.strokeStyle = it.c; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(bx + 10, y); ctx.lineTo(bx + 30, y); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = "#4a586b";
        ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(it.t, bx + 36, y);
      });
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------- render

  var mapCanvas, losvdCanvas, mapCtx, mapGeom;

  function sizedContext(canvas, ratio, minH, maxH, fixedH) {
    var cssW = canvas.parentNode.clientWidth || 600;
    var cssH = fixedH
      ? Math.round(fixedH)
      : Math.round(Math.max(minH, Math.min(maxH, cssW * ratio)));
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + "px";
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: cssW, h: cssH };
  }

  function renderReadout() {
    var d = ds(), b = state.bin, q = QUANTITIES[state.quantity];
    var x = d.kin.xbin[b], y = d.kin.ybin[b];
    var r = Math.sqrt(x * x + y * y);
    var rows = [
      ["Bin", b + " of " + d.nbins],
      ["Position", fmt(x, 3) + ", " + fmt(y, 3) + " <span class='unit'>arcsec</span>"],
      ["Radius", fmt(r, 3) + " <span class='unit'>arcsec</span>  <span class='pm'>(" + fmt(r / REFF, 2) + " R<sub>eff</sub>)</span>"],
      ["⟨V⟩", fmt(d.kin.vel[b], 1) + " <span class='pm'>± " + fmt(d.kin.dvel[b], 1) + "</span> <span class='unit'>km/s</span>"],
      ["σ", fmt(d.kin.sigma[b], 1) + " <span class='pm'>± " + fmt(d.kin.dsigma[b], 1) + "</span> <span class='unit'>km/s</span>"],
      ["h₃", fmt(d.kin.h3[b], 3) + " <span class='pm'>± " + fmt(d.kin.dh3[b], 3) + "</span>"],
      ["h₄", fmt(d.kin.h4[b], 3) + " <span class='pm'>± " + fmt(d.kin.dh4[b], 3) + "</span>"],
      ["S/N", fmt(d.kin.snr[b], 1)]
    ];
    if (state.overlay) {
      var o = other(), ob = matchedBin();
      rows.push(["Matched " + o.instrument,
        "bin " + ob + " <span class='pm'>(Δ = " + fmt(d.match.dist[b], 3) + "″)</span>"]);
    }
    $("readout").innerHTML = rows.map(function (kv) {
      return "<div><dt>" + kv[0] + "</dt><dd>" + kv[1] + "</dd></div>";
    }).join("");

    var qLabel = q.sym + (q.qual ? " (" + q.qual + ")" : "");
    $("map-title").innerHTML = ds().galaxy + " " + ds().instrument + " — " + qLabel +
      " <span class='sub'>" + (q.unit ? "[" + q.unit + "]" : "") + "</span>";
    $("losvd-title").innerHTML = "Posterior LOSVD — " + ds().instrument + " bin " + b +
      " <span class='sub'>r = " + fmt(r, 3) + "″, median and 16th–84th percentiles</span>";
  }

  function render() {
    var m = sizedContext(mapCanvas, 0.95, 320, 560);
    mapCtx = m.ctx;
    mapGeom = drawMap(m.ctx, m.w, m.h);
    // the LOSVD panel takes the height of the map so the two figures align
    var l = sizedContext(losvdCanvas, 0.70, 300, 520, m.h);
    drawLosvd(l.ctx, l.w, l.h);
    renderReadout();
  }

  function setBin(b, fromUser) {
    if (b === null || b === undefined || b < 0 || b === state.bin) return;
    state.bin = b;
    if (fromUser !== "select") $("bin").value = String(b);
    render();
  }

  // ------------------------------------------------------------------ controls

  function fillBinSelect() {
    var d = ds(), out = [];
    for (var i = 0; i < d.nbins; i++) out.push('<option value="' + i + '">Bin ' + i + "</option>");
    $("bin").innerHTML = out.join("");
    $("bin").value = String(state.bin);
  }

  function setStatus() {
    var el = $("status");
    if (state.locked) {
      el.textContent = "Bin " + state.bin + " locked — click the map again (or press Esc) to release";
      el.classList.add("locked");
    } else {
      el.textContent = "Hover the map to select a bin · click to lock";
      el.classList.remove("locked");
    }
  }

  function setModel(model) {
    if (model === state.model) return;
    var d = DATA[state.model];
    var nearest = d.match.bin[state.bin];          // keep looking at the same place
    state.model = model;
    state.bin = nearest;
    imageCache = {};
    document.querySelectorAll("[data-dataset]").forEach(function (btn) {
      btn.setAttribute("aria-checked", String(btn.dataset.dataset === model));
    });
    $("other-name").textContent = other().instrument;
    fillBinSelect();
    render();
  }

  function wire() {
    document.querySelectorAll("[data-dataset]").forEach(function (btn) {
      btn.addEventListener("click", function () { setModel(btn.dataset.dataset); });
    });
    $("quantity").addEventListener("change", function () {
      state.quantity = this.value;
      imageCache = {};
      render();
    });
    $("bin").addEventListener("change", function () {
      state.bin = parseInt(this.value, 10);
      render();
    });
    $("overlay").addEventListener("change", function () { state.overlay = this.checked; render(); });
    $("common").addEventListener("change", function () {
      state.common = this.checked; imageCache = {}; render();
    });
    $("zoom").addEventListener("change", function () { state.zoom = this.checked; render(); });

    mapCanvas.addEventListener("mousemove", function (ev) {
      var rect = mapCanvas.getBoundingClientRect();
      var cx = ev.clientX - rect.left, cy = ev.clientY - rect.top;
      var hit = binAt(cx, cy);
      showTooltip(hit, cx, cy);
      if (!state.locked && hit !== null) setBin(hit);
    });
    mapCanvas.addEventListener("mouseleave", function () { $("map-tooltip").hidden = true; });
    mapCanvas.addEventListener("click", function (ev) {
      var rect = mapCanvas.getBoundingClientRect();
      var hit = binAt(ev.clientX - rect.left, ev.clientY - rect.top);
      if (hit === null) return;
      if (state.locked && hit === state.bin) state.locked = false;
      else { setBin(hit); state.locked = true; }
      setStatus();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && state.locked) { state.locked = false; setStatus(); }
    });

    $("dl-losvd").addEventListener("click", exportLosvdCsv);
    $("dl-kin").addEventListener("click", exportKinCsv);
    $("dl-png").addEventListener("click", exportPng);

    var resizeTimer;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(render, 120);
    });
  }

  function binAt(cx, cy) {
    if (!mapGeom) return null;
    var d = ds();
    var x = mapGeom.ix(cx), y = mapGeom.iy(cy);
    var col = searchIndex(d.grid.xedges, x), row = searchIndex(d.grid.yedges, y);
    if (col < 0 || row < 0) return null;
    var b = d.grid.image[row * d.grid.nx + col];
    return b < 0 ? null : b;
  }

  function showTooltip(bin, cx, cy) {
    var tip = $("map-tooltip");
    if (bin === null) { tip.hidden = true; return; }
    var d = ds(), q = QUANTITIES[state.quantity];
    var v = d.kin[state.quantity][bin];
    tip.textContent = "bin " + bin +
      "\nx = " + fmt(d.kin.xbin[bin], 3) + "″   y = " + fmt(d.kin.ybin[bin], 3) + "″" +
      "\n" + q.sym + " = " + fmt(v, Math.abs(v) < 1 ? 3 : 1) + (q.unit ? " km/s" : "");
    tip.hidden = false;
    var wrapW = mapCanvas.parentNode.clientWidth;
    var flip = cx > wrapW - 150;
    tip.style.left = (flip ? cx - 10 : cx + 10) + "px";
    tip.style.top = cy + "px";
    tip.style.transform = flip ? "translate(-100%, -50%)" : "translate(0, -50%)";
  }

  // ------------------------------------------------------------------- exports

  // keep exported numbers readable (7 significant digits is far beyond the
  // precision of the stored posterior summaries)
  function csvNum(x) {
    if (x === "" || x === null || x === undefined || !isFinite(x)) return "";
    return String(Number(Number(x).toPrecision(7)));
  }

  function csvHeader(extra) {
    var d = ds();
    return ["# FCC 47 Interactive LOSVD Explorer",
      "# " + d.galaxy + " " + d.instrument + " (Bayes-LOSVD run " + d.run + ")",
      "# velocities relative to systemic",
      "# losvd_median/p16/p84: posterior summaries of the LOSVD amplitudes",
      "# f_density: median renormalised to unit area, int f dv = 1",
      "# dv = " + d.dv + " km/s"].concat(extra || []).join("\n") + "\n";
  }

  function exportLosvdCsv() {
    var d = ds(), b = state.bin;
    var rows = [], head = ["v_kms", "losvd_median", "losvd_p16", "losvd_p84", "f_density"];
    var c = curves(d, b, false);
    var extra = ["# bin " + b + " at x = " + fmt(d.kin.xbin[b], 3) + ", y = " + fmt(d.kin.ybin[b], 3) + " arcsec"];
    var over = null, o = null, ob = null;
    if (state.overlay) {
      o = other(); ob = matchedBin();
      over = curves(o, ob, false);
      head = head.concat(["v_kms_" + o.instrument, "losvd_median_" + o.instrument,
        "losvd_p16_" + o.instrument, "losvd_p84_" + o.instrument, "f_density_" + o.instrument]);
      extra.push("# matched " + o.instrument + " bin " + ob + " (nearest centre, " + fmt(d.match.dist[b], 3) + " arcsec)");
    }
    var cd = curves(d, b, true);
    var od = over ? curves(o, ob, true) : null;
    var n = Math.max(c.v.length, over ? over.v.length : 0);
    for (var i = 0; i < n; i++) {
      var row = i < c.v.length
        ? [c.v[i], c.med[i], c.p16[i], c.p84[i], cd.med[i]]
        : ["", "", "", "", ""];
      if (over) {
        row = row.concat(i < over.v.length
          ? [over.v[i], over.med[i], over.p16[i], over.p84[i], od.med[i]]
          : ["", "", "", "", ""]);
      }
      rows.push(row.map(csvNum).join(","));
    }
    download("FCC47_" + d.instrument + "_bin" + b + "_losvd.csv", "text/csv",
      csvHeader(extra) + head.join(",") + "\n" + rows.join("\n") + "\n");
  }

  function exportKinCsv() {
    var d = ds();
    var cols = ["xbin", "ybin", "snr", "vel", "dvel", "sigma", "dsigma", "h3", "dh3", "h4", "dh4",
      "velmean", "velstd", "sigmamean", "sigmastd"].filter(function (c) { return d.kin[c]; });
    var lines = [["bin"].concat(cols).join(",")];
    for (var i = 0; i < d.nbins; i++) {
      lines.push([i].concat(cols.map(function (c) { return csvNum(d.kin[c][i]); })).join(","));
    }
    download("FCC47_" + d.instrument + "_kinematics.csv", "text/csv",
      csvHeader() + lines.join("\n") + "\n");
  }

  function exportPng() {
    var W = 1680, H = 780, pad = 24, gap = 24;
    var scale = 2;
    var cv = document.createElement("canvas");
    cv.width = W * scale; cv.height = H * scale;
    var ctx = cv.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    var mapW = Math.round((W - 2 * pad - gap) * 0.46), plotH = H - 2 * pad - 34;
    ctx.save();
    ctx.translate(pad, pad);
    drawMap(ctx, mapW, plotH);
    ctx.restore();
    ctx.save();
    ctx.translate(pad + mapW + gap, pad);
    drawLosvd(ctx, W - 2 * pad - gap - mapW, plotH);
    ctx.restore();

    var d = ds(), b = state.bin;
    ctx.fillStyle = "#4a586b";
    ctx.font = "13px " + SANS;
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText("FCC 47 · " + d.instrument + " · Bayes-LOSVD run " + d.run +
      " · bin " + b + " at (" + fmt(d.kin.xbin[b], 3) + ", " + fmt(d.kin.ybin[b], 3) + ") arcsec" +
      " · ⟨V⟩ = " + fmt(d.kin.vel[b], 1) + " km/s, σ = " + fmt(d.kin.sigma[b], 1) + " km/s",
      pad, H - pad + 4);

    cv.toBlob(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "FCC47_" + d.instrument + "_bin" + b + "_" + state.quantity + ".png";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }, "image/png");
  }

  // ---------------------------------------------------------------------- boot

  function runsTable() {
    $("runs").innerHTML = MODELS.map(function (m) {
      var d = DATA[m];
      return "<dt>" + d.galaxy + " " + d.instrument + "</dt><dd>" + d.run +
        " · " + d.nbins + " bins · target S/N " + d.target_snr +
        " · Δv = " + d.dv + " km/s · " + d.losvd.v.length + " velocity bins</dd>";
    }).join("");
  }

  function fail(err) {
    var box = document.createElement("div");
    box.className = "error";
    box.textContent = "Could not load the data products: " + err +
      ". If you opened this file directly from disk, serve the folder over HTTP " +
      "(for example: python3 -m http.server) so the browser may read data/*.json.";
    document.querySelector("main").prepend(box);
  }

  function boot() {
    mapCanvas = $("map-canvas");
    losvdCanvas = $("losvd-canvas");
    Promise.all(MODELS.map(function (m) {
      return fetch("data/" + m + ".json").then(function (r) {
        if (!r.ok) throw new Error(m + ": HTTP " + r.status);
        return r.json();
      });
    })).then(function (loaded) {
      loaded.forEach(function (d) { DATA[d.model] = d; });
      state.bin = ds().center_bin;
      $("other-name").textContent = other().instrument;
      fillBinSelect();
      runsTable();
      wire();
      setStatus();
      render();
    }).catch(fail);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
