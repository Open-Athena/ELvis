#!/usr/bin/env bash
# Enumerate ElectrAI S3 prefixes and write one task-ID-per-line filelist per dataset.
# Requires AWS_PROFILE configured out of band with read access to s3://openathena/electrai/.
#
# Usage: pkgs/corpora/scripts/fetch-electrai-filelists.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../data/filelists"
mkdir -p "$OUT"

list_chgcar_ids() {
    local prefix="$1"
    aws s3 ls "$prefix" | awk '{print $4}' | grep -oE '^mp-[0-9]+' | sort -u
}

echo "Listing electrai-205 input..."
list_chgcar_ids s3://openathena/electrai/input/ > "$OUT/electrai-205-input.txt"
wc -l "$OUT/electrai-205-input.txt"

echo "Listing electrai-205 label..."
list_chgcar_ids s3://openathena/electrai/label/ > "$OUT/electrai-205-label.txt"
wc -l "$OUT/electrai-205-label.txt"

echo "Listing dataset_4 data..."
list_chgcar_ids s3://openathena/electrai/mp/chg_datasets/dataset_4/data/ > "$OUT/dataset_4-data.txt"
wc -l "$OUT/dataset_4-data.txt"

echo "Listing dataset_4 label..."
list_chgcar_ids s3://openathena/electrai/mp/chg_datasets/dataset_4/label/ > "$OUT/dataset_4-label.txt"
wc -l "$OUT/dataset_4-label.txt"

echo "Done. Filelists in $OUT"
