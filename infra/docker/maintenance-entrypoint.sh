#!/bin/sh
# =============================================================================
# Wizer Signage — maintenance container entrypoint
# =============================================================================
# Runs as root for ONE purpose: make the mounted /backups volume writable by the
# unprivileged "node" user, then hand off (exec) to the container command
# (crond). crond stays root and drops to "node" per job via su-exec — the
# maintenance jobs themselves NEVER run as root (see infra/docker/crontab).
#
# A freshly-created Docker named volume is owned root:root mode 0755, so the
# node user (uid/gid 1000) cannot create backups in it. We chown the mount point
# once, non-recursively, and only when it is not already node-owned — so this is
# idempotent across restarts and does NOT touch or weaken existing backup files
# (which node already owns).
# =============================================================================
set -eu

# Fixed, non-user-controlled target. Deliberately a literal (NOT read from an env
# var) so a misconfigured or hostile value can never redirect the chown at a
# broad path like /, /app, or an unresolved variable. Matches the compose mount
# `backups:/backups`.
BACKUP_DIR=/backups

# Only act on a real directory that is actually present (i.e. the volume is
# mounted). If it is missing we do nothing rather than create/chown blindly.
if [ -d "$BACKUP_DIR" ]; then
  # Non-recursive: chown the mount POINT itself only, so the node user can create
  # backups in a freshly-created (root:root) volume. Deliberately NOT `-R`: the
  # existing backup files inside keep their own ownership and permissions. This
  # is idempotent — re-chowning an already node-owned directory to node:node
  # leaves the same end state, so it is safe on every container restart. `stat`
  # is not available in the alpine base, so we do not read-then-compare; a single
  # non-recursive chown is cheaper and more portable than probing first.
  chown node:node "$BACKUP_DIR"
fi

# Hand off to crond (or whatever CMD/args were provided). exec so crond becomes
# PID 1 and receives signals directly.
exec "$@"
