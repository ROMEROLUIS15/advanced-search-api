#!/bin/sh
# Seed (and, when the index definition changed, migrate) before the API starts.
#
# Why here and not a platform hook: Render's pre-deploy command is available on
# paid instance types only, and this service runs on the free one. The container
# entrypoint is the one place that is guaranteed to run before the process that
# answers /health/ready, which is the deploy gate.
#
# The seed is idempotent by design: an unchanged definition costs one getMapping
# and nothing else, so a restart or a cold start is not a reindex.
set -eu

if [ "${SEED_ON_BOOT:-true}" = "true" ]; then
  echo "entrypoint: seeding before boot (SEED_ON_BOOT=${SEED_ON_BOOT:-true})"
  if node dist/seed/seed.command.js; then
    echo "entrypoint: seed finished"
  else
    status=$?
    # Deliberately NOT fatal. A non-zero seed does not mean the service cannot
    # serve: a failed migration leaves the alias on the previous version (design
    # D46), and a single invalid dataset row also exits 1. Readiness is the real
    # gate — if the index genuinely is not there, /health/ready reports down and
    # the platform fails the deploy on its own, which is the behaviour that was
    # designed for. Refusing to boot here would take the service down for a bad
    # row.
    echo "entrypoint: seed FAILED (exit ${status}) — booting anyway; /health/ready decides" >&2
  fi
else
  echo "entrypoint: SEED_ON_BOOT is not 'true', skipping the seed"
fi

# exec so the API becomes tini's direct child and keeps receiving signals.
exec node dist/main.js
