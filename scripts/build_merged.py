"""Merge AVONET and BIRDBASE into data/birds_merged.csv, one row per species.

The join key is the BirdLife scientific name: AVONET's `Species1` against
BIRDBASE's "HBW/BirdLife International (v9.1)" column.

AVONET's BirdLife names are a few years older than BIRDBASE's. In between,
292 species changed genus or spelling, so an exact-name join silently drops
them (the kakapo is Strigops habroptila in AVONET but Strigops habroptilus in
BIRDBASE). data/species_name_fixes.csv maps each of those AVONET names to its
BIRDBASE name. Every pair was checked against the English name, the family,
and AVONET's own BirdLife-to-eBird crosswalk.

The 38 AVONET species still unmatched have no one-to-one partner. Either
BirdLife v9.1 lumps them into another species (e.g. Caracara cheriway into
Caracara plancus), or BIRDBASE lists them only under IOC names, with no IUCN
status.

Output columns: AVONET1_BirdLife's 37 columns, then BIRDBASE's 97, sorted by
Species1. Species1 keeps AVONET's name; BIRDBASE's name columns hold the
current names.

Run from the repo root (needs pandas and openpyxl):
    python scripts/build_merged.py
"""

from pathlib import Path

import pandas as pd

RAW = Path("data/raw")
FIXES = Path("data/species_name_fixes.csv")
OUT = Path("data/birds_merged.csv")
BL = "HBW/BirdLife International (v9.1)"

avonet = pd.read_excel(RAW / "AVONET_2022.xlsx", sheet_name="AVONET1_BirdLife")
birdbase = pd.read_excel(RAW / "BIRDBASE_v2025.1.xlsx", sheet_name="Data", header=1)
birdbase = birdbase[birdbase[BL].notna()]  # rows BirdLife doesn't recognise can't join
fixes = pd.read_csv(FIXES)

rename = dict(zip(fixes["avonet_species1"], fixes["birdbase_birdlife_name"]))
key = avonet["Species1"].map(lambda name: rename.get(name, name))

merged = (
    avonet.assign(_key=key)
    .merge(birdbase, left_on="_key", right_on=BL, how="inner", validate="one_to_one")
    .drop(columns="_key")
    .sort_values("Species1")
    .reset_index(drop=True)
)

unused = sorted(set(rename) - set(merged["Species1"]))
assert not unused, f"name fixes that no longer match anything: {unused}"

merged.to_csv(OUT, index=False)
print(f"{len(merged):,} species written to {OUT} "
      f"({len(rename)} via name fixes, {len(avonet) - len(merged)} AVONET species unmatched)")
