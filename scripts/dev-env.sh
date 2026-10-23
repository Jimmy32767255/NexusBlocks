#!/usr/bin/env bash
# Point package managers at in-repo caches and runtime dirs.
# $HOME is read-only in some sandboxes, so every tool is kept self-contained
# inside the checkout. Source this file from the repository root:
#
#   source scripts/dev-env.sh
#
_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export CARGO_HOME="${CARGO_HOME:-$_repo_root/.cache/cargo}"
export npm_config_cache="${npm_config_cache:-$_repo_root/.tmp/npm-cache}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$_repo_root/.cache/cargo-target}"
# XDG_RUNTIME_DIR is where the compositor, dbus and pipewire publish their
# sockets. Only redirect it when the shell has no usable runtime dir at all,
# otherwise GUI apps (GTK/Tauri) lose contact with the running session.
if [ -z "${XDG_RUNTIME_DIR:-}" ] || [ ! -d "${XDG_RUNTIME_DIR:-}" ]; then
  export XDG_RUNTIME_DIR="$_repo_root/.cache/xdg-runtime"
fi
export XDG_STATE_HOME="$_repo_root/.cache/xdg-state"
export XDG_DATA_HOME="$_repo_root/.cache/xdg-data"
export XDG_CACHE_HOME="$_repo_root/.cache/xdg-cache"
export TMPDIR="${TMPDIR:-/tmp}"
mkdir -p "$CARGO_HOME" "$CARGO_TARGET_DIR" "$XDG_RUNTIME_DIR" "$XDG_STATE_HOME" \
  "$XDG_DATA_HOME" "$XDG_CACHE_HOME" "$npm_config_cache"
unset _repo_root
