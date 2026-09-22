# FCC 47 — Interactive LOSVD Explorer (static web version)

Interactive companion to **“Recovering complex non-parametric LOSVDs with
Bayes-LOSVD: The FCC 47 nuclear star cluster”** (Lamprecht et al., *A&A*).

**→ https://juliala2504.github.io/FCC47-LOSVD-explorer/**

Hover over the kinematic map to read the posterior line-of-sight velocity
distribution of each spatial bin; click to lock a bin. The page compares the
adopted `FCC47_SINFONI` and `FCC47_MUSE` Bayes-LOSVD products and can overlay
the spatially matched bin of the other data set.

## Why a static page

The explorer needs no server, no kernel and no third-party JavaScript: the
posterior products are shipped as JSON and both figures are drawn on `<canvas>`
by ~700 lines of vanilla JavaScript.

* ~790 kB total (≈270 kB gzipped), first render well under a second;
* every interaction is a redraw of a few thousand points — no round trip;
* nothing to keep running: it works from GitHub Pages, from a departmental web
  server, or from a local folder, and can be archived alongside the paper;
* no external CDN, so it also works offline and cannot break when a third-party
  service changes.

A Voila/Binder version of the same tool, which runs the Python analysis stack
live, is at
[`Interactive-LOSVD-explorer-FCC47`](https://github.com/juliala2504/Interactive-LOSVD-explorer-FCC47).

## Features

| Control | Meaning |
| --- | --- |
| **Data set** | adopted SINFONI (368 bins) or MUSE (218 bins) run |
| **Map quantity** | *V*, σ (posterior median or mean), *h*₃, *h*₄, effective S/N |
| **Spatial bin** | jump straight to a bin |
| **Overlay matched bin** | LOSVD of the nearest bin of the other data set, as in Fig. 4 of the paper |
| **Common colour scale** | identical colour limits for both data sets, for a like-for-like comparison |
| **Velocity axis ±400 km/s** | crop the flat wings, as in the paper figures |
| **Downloads** | the displayed LOSVD (CSV), the full kinematics table (CSV), the figure pair (PNG) |

The dashed circle marks the adopted NSC effective radius,
*R*<sub>eff</sub> = 0.750″ ± 0.125″ (Turner et al. 2012). Velocities are relative
to the systemic velocity; S/N is the effective S/N<sub>real</sub> measured a
posteriori from the fit residuals.

Because SINFONI and MUSE use different velocity sampling (Δ*v* = 30 and
45 km s⁻¹), overlaid profiles are drawn as probability densities normalised to
unit area, ∫*f*(*v*) d*v* = 1. The posterior median is a pointwise summary and
sums to slightly less than one, so it is renormalised (together with its
credible band, by the same factor) before the comparison — the same convention
as in the paper.

## Layout

```text
FCC47-LOSVD-explorer/
├── index.html
├── assets/
│   ├── app.js                  # rendering and interaction
│   └── style.css
├── data/
│   ├── FCC47_SINFONI.json      # built from results/ by tools/build_data.py
│   └── FCC47_MUSE.json
├── results/                    # the ECSV products the JSON is built from
│   ├── FCC47_SINFONI/*.ecsv
│   └── FCC47_MUSE/*.ecsv
├── bestfits.txt                # adopted run IDs
└── tools/
    ├── build_data.py           # ECSV → JSON (numpy only)
    └── test_page.py            # headless browser smoke test (playwright)
```

## Publishing

GitHub → **Settings → Pages → Build and deployment → Deploy from a branch**,
branch `main`, folder `/ (root)`. The page is then served at
`https://juliala2504.github.io/FCC47-LOSVD-explorer/`. `.nojekyll` keeps GitHub
from running Jekyll over the files.

## Local use

The page fetches `data/*.json`, which browsers refuse to do for `file://` URLs,
so serve the folder rather than double-clicking `index.html`:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

## Rebuilding the data

After re-running Bayes-LOSVD, drop the new ECSV products into `results/` and:

```bash
python3 tools/build_data.py      # writes data/FCC47_*.json
```

The build asserts that the spaxel grid is regular and reports the number of
bins, velocity bins and the median cross-match distance. Nothing else has to
change.

## Verifying the page

```bash
pip install playwright && playwright install chromium
python3 tools/test_page.py       # load time, hover, lock, exports, responsiveness
```

## Citing

If you use this explorer or the products in it, please cite the paper (see
`CITATION.cff`) and Bayes-LOSVD (Falcón-Barroso & Martig 2021).

---

Julia Lamprecht — Masaryk University & University of Vienna —
<lamprecht@sci.muni.cz>
