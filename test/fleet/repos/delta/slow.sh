#!/bin/sh
# delta shard check: ~150 s of progress (DELTA_SHARD_SECONDS overrides).
shard=${1:-shard-1}
total=${DELTA_SHARD_SECONDS:-150}
step=10
n=$(( (total + step - 1) / step ))
i=1
echo "[$shard] checking $n chunks"
while [ "$i" -le "$n" ]; do
  sleep "$step"
  echo "[$shard] chunk $i/$n ok"
  i=$((i + 1))
done
echo "[$shard] reconciled"
