"""Build the slim CSV the atlas prototype loads from data/birds_merged.csv.

Keeps species with a 2024 IUCN status from Least Concern to Extinct (drops
only Data Deficient) and the columns the atlas uses. "Possibly extinct"
(CR (PE), CR (PEW)) stays Critically Endangered, with a flag. Taxonomy
(order, family) is AVONET's.

Run from the repo root:  python scripts/prepare_data.py
"""

import pandas as pd

SRC = "data/birds_merged.csv"
OUT = "data/birds_atlas.csv"

STATUS_MAP = {
    "LC": "LC", "NT": "NT", "VU": "VU", "EN": "EN",
    "CR": "CR", "CR (PE)": "CR", "CR (PEW)": "CR",
    "EW": "EW", "EX": "EX",
}

d = pd.read_csv(SRC, low_memory=False)
d["status"] = d["2024 IUCN Red List category"].map(STATUS_MAP)
d = d[d["status"].notna()].copy()
d["possibly_extinct"] = d["2024 IUCN Red List category"].isin(["CR (PE)", "CR (PEW)"]).astype(int)

slim = pd.DataFrame({
    "sci": d["Species1"],
    "name": d["English Name (BirdLife > IOC > Clements>AviList)"],
    "order": d["Order1"],
    "family": d["Family1"],
    "status": d["status"],
    "possibly_extinct": d["possibly_extinct"],
    "flightless": (d["Flightlessness"] == "Yes").astype(int),
    "mass": d["Mass"].round(1),
    "hwi": d["Hand-Wing.Index"].round(1),
    "habitat": d["Primary Habitat"],
    "diet": d["Primary Diet"],
    "island": d["ISL"].astype(int),
    "clutch_min": d["Clutch_Min"],
    "clutch_max": d["Clutch_Max"],
    # For the species profile map: AVONET range centroid and latitude limits.
    "lat": d["Centroid.Latitude"].round(2),
    "lon": d["Centroid.Longitude"].round(2),
    "lat_min": d["Min.Latitude"].round(1),
    "lat_max": d["Max.Latitude"].round(1),
    "range_km2": d["Range.Size"].round(-1),
    "beak": d["Beak.Length_Culmen"].round(1),
})

slim.to_csv(OUT, index=False)

living = slim[~slim["status"].isin(["EX", "EW"])]
threatened = living["status"].isin(["VU", "EN", "CR"])
print(f"{len(slim):,} species written to {OUT} ({len(slim) - len(living)} extinct or extinct in the wild)")
print(f"{slim['order'].nunique()} orders, {slim['family'].nunique()} families")
print(f"{threatened.sum():,} of {len(living):,} living species threatened ({threatened.mean():.1%})")
