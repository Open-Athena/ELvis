#!/bin/bash
# Batch-convert CHGCARs from S3 to multi-resolution Zarr stores and upload back.
#
# Usage:
#   batch-zarr-etl.sh <filelist> <s3-source-prefix> <s3-dest-prefix> [-r role] [--limit N]
# Example:
#   batch-zarr-etl.sh \
#     pkgs/corpora/data/filelists/electrai-205-label.txt \
#     s3://openathena/electrai/label/ \
#     s3://openathena/electrai/zarr/ \
#     -r label
#
# For each ID in <filelist>:
#   1. download <s3-source>/<id>.CHGCAR to tmp/zarr-etl/
#   2. run convert-to-zarr.py to produce tmp/zarr-etl/<id>-<role>.zarr/
#   3. upload to <s3-dest>/<id>-<role>.zarr/
#   4. delete local CHGCAR + zarr to keep disk usage bounded
set -euo pipefail

if [ "$#" -lt 3 ]; then
    sed -n '2,17p' "$0" >&2
    exit 1
fi

FILELIST="$1"; SRC_PREFIX="$2"; DST_PREFIX="$3"; shift 3
ROLE='label'
LIMIT=0
SKIP=0
while [ "$#" -gt 0 ]; do
    case "$1" in
        -r|--role) ROLE="$2"; shift 2 ;;
        -n|--limit) LIMIT="$2"; shift 2 ;;
        -s|--skip) SKIP="$2"; shift 2 ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done

WORK_DIR="tmp/zarr-etl"
mkdir -p "$WORK_DIR"
SCRIPT_DIR="$(dirname "$0")"
i=0
total=$(wc -l < "$FILELIST")
echo "Processing up to ${LIMIT:-all} of $total IDs (role=$ROLE) from $FILELIST" >&2

while IFS= read -r id; do
    i=$((i + 1))
    [ "$i" -le "$SKIP" ] && continue
    [ "$LIMIT" -gt 0 ] && [ "$i" -gt $((SKIP + LIMIT)) ] && break

    src="${SRC_PREFIX%/}/${id}.CHGCAR"
    chgcar="$WORK_DIR/${id}.CHGCAR"
    zarr_dir="$WORK_DIR/${id}-${ROLE}.zarr"

    echo "[$i/$total] $id" >&2
    if ! aws s3 cp "$src" "$chgcar" --quiet; then
        echo "  download failed, skipping" >&2
        continue
    fi
    if ! "$SCRIPT_DIR/convert-to-zarr.py" -o "$WORK_DIR" -f -r "$ROLE" "$chgcar" >/dev/null; then
        echo "  conversion failed, skipping" >&2
        rm -f "$chgcar"
        continue
    fi
    aws s3 sync --quiet "$zarr_dir" "${DST_PREFIX%/}/${id}-${ROLE}.zarr/"
    bytes=$(du -sk "$zarr_dir" | cut -f1)
    echo "  uploaded ${bytes} KB" >&2

    rm -f "$chgcar"
    rm -rf "$zarr_dir"
done < "$FILELIST"

echo "Done." >&2
