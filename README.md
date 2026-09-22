# Interactive LOSVD Explorer — FCC 47

**Open the explorer in your browser:**
<https://juliala2504.github.io/FCC47-LOSVD-explorer/>

Interactive companion to **“Recovering complex non-parametric LOSVDs with
Bayes-LOSVD: The FCC 47 nuclear star cluster”** (Lamprecht et al., *Astronomy &
Astrophysics*).

The explorer shows the non-parametric line-of-sight velocity distributions
recovered for the nuclear star cluster of FCC 47 (NGC 1336) from
adaptive-optics-assisted SINFONI and MUSE integral-field spectroscopy, using
Bayes-LOSVD with a Gaussian-process prior. Move the pointer across the kinematic
map to read the posterior LOSVD of any spatial bin, and click to lock a bin.

A version that runs the analysis stack live in a Jupyter session is available at
[Interactive-LOSVD-explorer-FCC47](https://github.com/juliala2504/Interactive-LOSVD-explorer-FCC47).

## Controls

| Control | Shows |
| --- | --- |
| **Data set** | the adopted SINFONI (368 bins) or MUSE (218 bins) run |
| **Map quantity** | *V* or σ (posterior median or mean), *h*₃, *h*₄, or the effective S/N |
| **Spatial bin** | jump directly to a bin |
| **Overlay matched bin** | add the LOSVD of the spatially nearest bin of the other data set |
| **Common colour scale** | identical colour limits for both data sets |
| **Velocity axis ±400 km/s** | restrict the velocity range, as in the figures of the paper |
| **Downloads** | the displayed LOSVD and the full kinematics table as CSV, and the figure pair as PNG |

## Reading the figures

* The **left panel** shows the selected projected quantity on the
  PowerBin tessellation (Cappellari 2025) of the
  corresponding data set. The dashed circle marks the adopted NSC effective
  radius, *R*<sub>eff</sub> = 0.750″ ± 0.125″ (Turner et al. 2012); the faint
  points are the bin centres.
* The **right panel** shows the posterior LOSVD of the selected bin: the solid
  line is the posterior median, the shaded band the 16th–84th percentile credible
  interval, and the dashed vertical line the median velocity of that bin.
* **Overlaid profiles.** The two runs sample velocity differently
  (Δ*v* = 30 and 45 km s⁻¹), so when a matched bin is overlaid both LOSVDs are
  shown as probability densities normalised to unit area,
  ∫*f*(*v*) d*v* = 1. Matching selects the nearest bin centre; the separation is
  quoted in the legend.
* Velocities are relative to the systemic velocity. The quoted S/N is the
  effective S/N<sub>real</sub> measured a posteriori from the fit residuals, which
  is lower than the nominal binning target.

## Data

The `results/` directory contains the exported posterior products of the adopted
runs recorded in `bestfits.txt`:

| Data set | Run | Bins | Target S/N | Δ*v* | Velocity bins |
| --- | --- | --- | --- | --- | --- |
| FCC 47 SINFONI | `FCC47_s_cube_v9_GP` | 368 | 40 | 30 km s⁻¹ | 47 |
| FCC 47 MUSE | `FCC47_m_cube_v5_GP` | 218 | 100 | 45 km s⁻¹ | 31 |

For each data set, `*_losvd.ecsv` holds the posterior LOSVD of every bin (median,
mean, and the 2nd/16th/84th/97th percentiles), `*_kinematics.ecsv` the projected
moments derived from it, and `*_bins.ecsv` the spaxel-to-bin map. All files are
plain [ECSV](https://docs.astropy.org/en/stable/io/ascii/ecsv.html) tables.
`data/*.json` holds the same products in the form the page reads; running
`python3 tools/build_data.py` regenerates them from `results/`.

## Viewing it locally

The page reads `data/*.json`, which browsers do not allow over `file://`, so serve
the folder rather than opening `index.html` directly:

```bash
python3 -m http.server 8000     # then open http://localhost:8000/
```

## Repository contents

```text
index.html, assets/       the explorer
data/                     posterior products in the form the page reads
results/                  exported Bayes-LOSVD products (ECSV)
bestfits.txt              adopted run identifiers
tools/build_data.py       regenerates data/ from results/
```

## Citing

Please cite the paper; `CITATION.cff` holds the full reference. The method is
described in Falcón-Barroso & Martig (2021), and posterior sampling uses NumPyro
(Phan et al. 2019).

---

Julia Lamprecht — Department of Theoretical Physics and Astrophysics, Masaryk
University, and Department of Astrophysics, University of Vienna —
<lamprecht@sci.muni.cz>
