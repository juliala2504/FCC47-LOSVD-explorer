#!/usr/bin/env python3
"""Convert the Bayes-LOSVD ECSV products into compact JSON for the web explorer.

Reads  results/<MODEL>/<MODEL>_{kinematics,bins,losvd}.ecsv
Writes data/<MODEL>.json  (one file per data set)

The JSON keeps the full numerical content needed by the explorer:
  * the spatial bin map (as pixel edges + a bin-index image)
  * the per-bin projected kinematics (V, sigma, h3, h4, S/N, ...)
  * the posterior LOSVD of every bin (median and 16th/84th percentiles)
  * the index of the nearest bin in the other data set (for the matched view)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent   # repository root
SRC = ROOT / "results"
MODELS = ("FCC47_SINFONI", "FCC47_MUSE")

# Velocity-bin width of the LOSVD grid of each run (km/s), from the paper.
DV = {"FCC47_SINFONI": 30.0, "FCC47_MUSE": 45.0}
INSTRUMENT = {"FCC47_SINFONI": "SINFONI", "FCC47_MUSE": "MUSE"}
TARGET_SNR = {"FCC47_SINFONI": 40, "FCC47_MUSE": 100}
RUN_ID = {"FCC47_SINFONI": "FCC47_s_cube_v9_GP", "FCC47_MUSE": "FCC47_m_cube_v5_GP"}

KIN_COLS = (
    "snr", "xbin", "ybin",
    "vel", "dvel", "sigma", "dsigma", "h3", "dh3", "h4", "dh4",
    "velmean", "velstd", "sigmamean", "sigmastd", "h3mean", "h4mean",
)


def read_ecsv(path: Path):
    """Minimal ECSV reader: the header is commented, the first bare line is the
    column names, everything after that is whitespace-separated numbers."""
    names = None
    rows = []
    with path.open() as fh:
        for line in fh:
            if line.startswith("#") or not line.strip():
                continue
            if names is None:
                names = line.split()
                continue
            rows.append(line.split())
    data = np.array(rows, dtype=float)
    return {name: data[:, i] for i, name in enumerate(names)}


def round_list(values, decimals):
    return [round(float(v), decimals) for v in values]


def build_grid(bins_tab, n_bins):
    """Bin-index image on the regular spaxel grid, plus the pixel edges."""
    x = bins_tab["x"].astype(float)
    y = bins_tab["y"].astype(float)
    bin_num = bins_tab["binNum"].astype(int)

    xu = np.sort(np.unique(x))
    yu = np.sort(np.unique(y))
    nx, ny = len(xu), len(yu)

    ix = np.searchsorted(xu, x)
    iy = np.searchsorted(yu, y)

    image = np.full((ny, nx), -1, dtype=int)
    ok = (bin_num >= 0) & (bin_num < n_bins)
    image[iy[ok], ix[ok]] = bin_num[ok]

    dx = float(np.median(np.diff(xu))) if nx > 1 else 1.0
    dy = float(np.median(np.diff(yu))) if ny > 1 else 1.0

    # Pixel edges (nx+1 / ny+1). The spaxel grid is regular by construction;
    # assert that so the explorer can rely on a simple lookup.
    assert nx < 2 or np.allclose(np.diff(xu), dx, atol=1e-6 + 0.01 * dx), "irregular x grid"
    assert ny < 2 or np.allclose(np.diff(yu), dy, atol=1e-6 + 0.01 * dy), "irregular y grid"
    xedges = np.concatenate([xu - 0.5 * dx, [xu[-1] + 0.5 * dx]])
    yedges = np.concatenate([yu - 0.5 * dy, [yu[-1] + 0.5 * dy]])

    return {
        "nx": nx,
        "ny": ny,
        "dx": round(dx, 6),
        "dy": round(dy, 6),
        "xedges": round_list(xedges, 5),
        "yedges": round_list(yedges, 5),
        # row-major, row 0 = lowest y
        "image": [int(v) for v in image.ravel()],
    }


def build_losvd(losvd_tab, n_bins):
    """Posterior LOSVD of every bin on the common velocity grid."""
    bin_id = losvd_tab["bin"].astype(int)
    vel = losvd_tab["vel"].astype(float)
    vgrid = np.sort(np.unique(vel))
    nv = len(vgrid)

    med = np.full((n_bins, nv), np.nan)
    p16 = np.full((n_bins, nv), np.nan)
    p84 = np.full((n_bins, nv), np.nan)

    col_med = "los" if "los" in losvd_tab else "losmean"
    iv = np.searchsorted(vgrid, vel)
    med[bin_id, iv] = losvd_tab[col_med]
    p16[bin_id, iv] = losvd_tab["los16"]
    p84[bin_id, iv] = losvd_tab["los84"]

    missing = int(np.isnan(med).any(axis=1).sum())
    if missing:
        print(f"  warning: {missing} bins have incomplete LOSVD rows", file=sys.stderr)
        med = np.nan_to_num(med)
        p16 = np.nan_to_num(p16)
        p84 = np.nan_to_num(p84)

    # LOSVD amplitudes are of order 1e-4 .. 3e-1 and sum to one over the grid;
    # 7 decimals keep >4 significant digits on the smallest relevant values.
    return {
        "v": round_list(vgrid, 2),
        "med": [round_list(row, 7) for row in med],
        "p16": [round_list(row, 7) for row in p16],
        "p84": [round_list(row, 7) for row in p84],
    }


def load_model(model: str):
    d = SRC / model
    kin = read_ecsv(d / f"{model}_kinematics.ecsv")
    bins = read_ecsv(d / f"{model}_bins.ecsv")
    losvd = read_ecsv(d / f"{model}_losvd.ecsv")
    n_bins = len(kin["bin"])

    out = {
        "model": model,
        "galaxy": "FCC47",
        "instrument": INSTRUMENT[model],
        "run": RUN_ID[model],
        "nbins": n_bins,
        "dv": DV[model],
        "target_snr": TARGET_SNR[model],
        "grid": build_grid(bins, n_bins),
        "kin": {c: round_list(kin[c], 4) for c in KIN_COLS if c in kin},
        "losvd": build_losvd(losvd, n_bins),
    }
    return out, np.column_stack([kin["xbin"], kin["ybin"]])


def main():
    out_dir = ROOT / "data"
    out_dir.mkdir(exist_ok=True)

    models = {}
    centres = {}
    for model in MODELS:
        print(f"building {model}")
        models[model], centres[model] = load_model(model)

    # Nearest bin in the other data set, for the matched SINFONI <-> MUSE view
    # (same nearest-neighbour matching as Fig. 4 of the paper, without the
    # uniqueness constraint, since only one bin is shown at a time).
    for model in MODELS:
        other = [m for m in MODELS if m != model][0]
        a, b = centres[model], centres[other]
        d2 = ((a[:, None, :] - b[None, :, :]) ** 2).sum(axis=2)
        nearest = d2.argmin(axis=1)
        models[model]["match"] = {
            "model": other,
            "bin": [int(i) for i in nearest],
            "dist": round_list(np.sqrt(d2.min(axis=1)), 4),
        }
        # central bin = closest to (0, 0)
        models[model]["center_bin"] = int(np.argmin((a ** 2).sum(axis=1)))

    for model, payload in models.items():
        path = out_dir / f"{model}.json"
        path.write_text(json.dumps(payload, separators=(",", ":")))
        print(f"  {path.name}: {path.stat().st_size / 1024:.0f} kB, "
              f"{payload['nbins']} bins, {len(payload['losvd']['v'])} velocity bins, "
              f"grid {payload['grid']['nx']}x{payload['grid']['ny']}, "
              f"median match distance "
              f"{np.median(payload['match']['dist']):.3f} arcsec")


if __name__ == "__main__":
    main()
