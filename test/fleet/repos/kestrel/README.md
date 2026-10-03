# kestrel

Tiny HTTP status service. `npm start` serves `GET /health` on :8080.

Deploys go through `./deploy.sh`. In this sandbox only `--dry-run` is
supported: it prints the plan and changes nothing.
