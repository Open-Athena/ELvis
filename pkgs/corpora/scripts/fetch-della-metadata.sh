#!/usr/bin/env bash
# Pull task-ID ↔ material-ID mappings (and related metadata) from della into local
# `data/della/` dir, so downstream Python ETL can run without re-contacting della.
#
# Usage: pkgs/corpora/scripts/fetch-della-metadata.sh
# Assumes `ssh della` is configured in ~/.ssh/config.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../data/della"
REMOTE="della:/scratch/gpfs/ROSENGROUP/common/globus_share_OA/mp/metadata"

mkdir -p "$OUT"

# Files we need for building the manifest:
for f in \
    task_id_to_material_id.json.gz \
    material_id_to_task_ids.json.gz \
    chgcars_functional_to_task_ids.json.gz \
    MP_deprecation.json \
    ; do
    rsync -avz "$REMOTE/$f" "$OUT/"
done

echo "Pulled della metadata to $OUT"
ls -la "$OUT"
