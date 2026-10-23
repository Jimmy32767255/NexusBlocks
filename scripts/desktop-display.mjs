#!/usr/bin/env node
// Run a GUI command (normally `tauri dev`) with a usable display environment.
//
// Tauri on Linux creates its window through GTK, which aborts with
//   Failed to initialize gtk backend!: BoolError { message: "Failed to initialize GTK" }
// when neither WAYLAND_DISPLAY nor DISPLAY points at a reachable server. That
// happens routinely when the shell is not the one that started the graphical
// session (ssh, tmux started elsewhere, a getty, or dev-env.sh having replaced
// XDG_RUNTIME_DIR), because the Wayland socket keeps living in
// $XDG_RUNTIME_DIR even though the variable was lost.
//
// This wrapper recovers the session:
//   1. reuse WAYLAND_DISPLAY / DISPLAY when they are valid;
//   2. otherwise look for wayland-<n> or X<n> sockets in the real runtime dir;
//   3. fall back to a virtual X server (xvfb-run) when no display exists at all.
//
// Usage: node ../../scripts/desktop-display.mjs <command> [args...]
// Env:   NEXUS_DESKTOP_HEADLESS=1  force the virtual-display fallback
//        NEXUS_DESKTOP_DISPLAY=wayland|wayland-1|:0  force a specific server

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const env = { ...process.env };
const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
const notes = [];

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: desktop-display.mjs <command> [args...]');
  process.exit(2);
}

const isSocket = (file) => {
  try {
    return statSync(file).isSocket();
  } catch {
    return false;
  }
};

const onPath = (bin) => {
  const dirs = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return dirs.some((dir) => {
    const candidate = path.join(dir, bin);
    return existsSync(candidate) && !statSync(candidate).isDirectory();
  });
};

// --- Wayland -----------------------------------------------------------------

const runtimeDirs = [
  env.XDG_RUNTIME_DIR,
  `/run/user/${uid}`,
  env.XDG_RUNTIME_DIR ? undefined : `/tmp/runtime-${uid}`,
].filter((dir) => typeof dir === 'string' && dir.length > 0);

const uniqueDirs = [...new Set(runtimeDirs)].filter((dir) => existsSync(dir));

/** Returns the directory holding `name` when it is a live socket. */
const findSocket = (name) =>
  uniqueDirs.find((dir) => isSocket(path.join(dir, name))) ?? null;

const listSockets = (prefix) => {
  const found = [];
  for (const dir of uniqueDirs) {
    let entries = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.startsWith(prefix) || entry.endsWith('.lock')) continue;
      const full = path.join(dir, entry);
      if (isSocket(full)) found.push({ dir, name: entry, full });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
};

const waylandCandidates = () => {
  const forced = env.NEXUS_DESKTOP_DISPLAY;
  if (forced && forced !== 'wayland') {
    // Accept either "wayland-1" or an absolute socket path.
    const full = path.isAbsolute(forced)
      ? forced
      : (findSocket(forced) ? path.join(findSocket(forced), forced) : null);
    return full ? [{ dir: path.dirname(full), name: path.basename(full), full }] : [];
  }
  if (env.WAYLAND_DISPLAY) {
    const name = env.WAYLAND_DISPLAY;
    const dir = path.isAbsolute(name) ? path.dirname(name) : findSocket(name);
    if (dir) {
      return [{ dir, name: path.basename(name), full: path.join(dir, path.basename(name)) }];
    }
    notes.push(`WAYLAND_DISPLAY=${name} does not point at a live socket; scanning instead`);
  }
  return listSockets('wayland-');
};

// --- X11 ---------------------------------------------------------------------

const xDisplaySocket = (display) => {
  const match = /^(.*?):(\d+)(?:\.\d+)?$/.exec(display ?? '');
  if (!match) return null;
  const [, host, number] = match;
  if (host && host !== 'unix') return null; // remote DISPLAY, trust it
  const candidates = [
    `/tmp/.X11-unix/X${number}`,
    ...uniqueDirs.map((dir) => path.join(dir, `X${number}`)),
  ];
  return candidates.find(isSocket) ?? null;
};

const xCandidates = () => {
  if (env.DISPLAY && xDisplaySocket(env.DISPLAY)) return [env.DISPLAY];
  if (env.DISPLAY && /^[^:]*:/.test(env.DISPLAY) && !env.DISPLAY.startsWith('unix')) {
    // Remote/forwarded display (ssh -X): nothing local to verify.
    return [env.DISPLAY];
  }
  const sockets = listSockets('X');
  return sockets.map((socket) => {
    const number = socket.name.slice(1);
    return number === '0' ? ':0' : `:${number}`;
  });
};

// --- pick a backend ----------------------------------------------------------

const forced = env.NEXUS_DESKTOP_DISPLAY;
const headless = env.NEXUS_DESKTOP_HEADLESS === '1';
let mode = 'headless';

if (!headless) {
  const wayland = waylandCandidates();
  const x11 = wayland.length === 0 ? xCandidates() : [];
  if (wayland.length > 0 && forced !== 'x11') {
    const chosen = wayland[0];
    env.XDG_RUNTIME_DIR = chosen.dir;
    env.WAYLAND_DISPLAY = chosen.name;
    mode = 'wayland';
    notes.push(`using Wayland display ${chosen.name} (${chosen.dir})`);
  } else if (x11.length > 0) {
    env.DISPLAY = x11[0];
    mode = 'x11';
    notes.push(`using X11 display ${x11[0]}`);
  }
}

if (mode !== 'headless') {
  const bus = path.join(env.XDG_RUNTIME_DIR ?? '', 'bus');
  if (!env.DBUS_SESSION_BUS_ADDRESS && isSocket(bus)) {
    env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${bus}`;
  }
  // GTK reaches the session settings daemon through the portal; keep it quiet
  // when the shell never had a session.
  env.NO_AT_BRIDGE ??= '1';
}

const [command, ...commandArgs] = args;

if (mode === 'headless') {
  if (!onPath('xvfb-run')) {
    console.error(
      [
        '[desktop] No display available: neither WAYLAND_DISPLAY nor DISPLAY is usable,',
        '[desktop] and xvfb-run is not installed.',
        '[desktop] Fix one of:',
        '[desktop]   * run this from a terminal inside your desktop session, or',
        '[desktop]   * export WAYLAND_DISPLAY=<socket> (see `ls $XDG_RUNTIME_DIR/wayland-*`), or',
        '[desktop]   * install xvfb (pacman -S xorg-server-xvfb) for a virtual display.',
      ].join('\n'),
    );
    process.exit(1);
  }
  notes.push('no display found; starting a virtual X server with xvfb-run (window is not visible)');
  env.DISPLAY = env.DISPLAY || ':99';
}

for (const note of notes) console.error(`[desktop] ${note}`);

const command_line = mode === 'headless' ? 'xvfb-run' : command;
const command_args =
  mode === 'headless'
    ? ['-a', '-s', '-screen 0 1600x1000x24', command, ...commandArgs]
    : commandArgs;

const child = spawn(command_line, command_args, {
  env,
  stdio: 'inherit',
  shell: false,
});

const forward = (signal) => {
  if (!child.killed) child.kill(signal);
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => forward(signal));
}

child.on('error', (error) => {
  console.error(`[desktop] failed to start ${command}: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(0);
  }
  process.exit(code ?? 0);
});
