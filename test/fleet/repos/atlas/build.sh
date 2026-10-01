#!/bin/sh
# atlas full build: ~9 min of progress lines (ATLAS_BUILD_SECONDS overrides).
total=${ATLAS_BUILD_SECONDS:-540}
step=10
n=$(( (total + step - 1) / step ))
i=1
echo "[build] atlas: rendering $n tile batches (~${total}s)"
while [ "$i" -le "$n" ]; do
  sleep "$step"
  echo "[build] batch $i/$n done"
  i=$((i + 1))
done
echo "[build] atlas build complete"
