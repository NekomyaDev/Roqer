#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import lockfile from 'proper-lockfile';

const STUDIO_PROCESS = 'RobloxStudioBeta';
const DEFAULT_MCP_PORT = Number.parseInt(process.env.ROBLOX_STUDIO_PORT ?? '58741', 10);
export const ISOLATED_STUDIO_PLUGINS_DIR_NAME = 'RsmcpIsolatedPlugins';
const STUDIO_WORKER_ROOT_NAME = 'robloxstudio-mcp-workers';

export function isWsl() {
  if (process.platform !== 'linux') return false;
  try {
    return /microsoft|wsl/i.test(readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Roblox Studio on Linux runs inside Vinegar's Wine prefix, which the MCP
 * server owns (`packages/core/src/studio-vinegar.ts`). This script reads that
 * module rather than resolving the prefix a second time, from the build the
 * live suites already require. A host with no build, or no Vinegar, keeps the
 * old behaviour: the helpers that need Studio say it cannot be found here.
 */
const vinegarCore = process.platform === 'linux' && !isWsl()
  ? await import('../packages/core/dist/studio-vinegar.js').catch(() => undefined)
  : undefined;

function vinegarInstall() {
  return vinegarCore?.getVinegarInstall();
}

/** Every Studio process Vinegar is running, as this script reports processes. */
function listVinegarStudio() {
  return (vinegarCore?.listVinegarStudioProcesses() ?? []).map((proc) => ({
    Id: proc.id,
    Path: proc.executable,
    MainWindowTitle: '',
    StartTimeUtcFileTime: proc.startedAt,
  }));
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    timeout: 30000,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function powershell(script) {
  const exe = process.platform === 'win32' ? 'powershell.exe' : 'powershell.exe';
  return run(exe, ['-NoProfile', '-Command', script], {
    cwd: isWsl() && existsSync('/mnt/c/Windows') ? '/mnt/c/Windows' : process.cwd(),
  });
}

export function windowsLocalAppData() {
  if (process.platform === 'win32') return process.env.LOCALAPPDATA;
  if (!isWsl()) return undefined;
  try {
    return run('cmd.exe', ['/c', 'echo %LOCALAPPDATA%'], {
      cwd: existsSync('/mnt/c/Windows') ? '/mnt/c/Windows' : process.cwd(),
    });
  } catch {
    return undefined;
  }
}

function toWslPath(windowsPath) {
  if (!windowsPath || process.platform === 'win32') return windowsPath;
  if (!isWsl()) return windowsPath;
  return run('wslpath', ['-u', windowsPath]);
}

function toStudioLaunchArg(arg) {
  if (!path.isAbsolute(arg) || !existsSync(arg)) return arg;
  if (isWsl()) return run('wslpath', ['-w', arg]);
  const vinegar = vinegarInstall();
  if (!vinegar) return arg;
  // Studio in the prefix sees the file as `Z:` plus its path, and only where
  // the Flatpak sandbox shares the folder it is in.
  const refusal = vinegarCore.vinegarReachRefusal(
    vinegar,
    vinegarCore.getVinegarSandboxFilesystem(vinegar),
    arg,
    'Studio would open an empty window instead of that file',
  );
  if (refusal !== undefined) throw new Error(refusal);
  return vinegarCore.toVinegarStudioPath(arg);
}

/**
 * Whether a launch on this host can hold Studio and prove its exact identity.
 *
 * Only the Windows launcher can, directly or through WSL interop; the core
 * reports the same conclusion as `processIdentity.supported`. macOS spawns
 * Studio without holding it, and Vinegar hands the launch to its own single
 * application instance, so neither can be asked for one.
 */
export function studioProcessIdentityRetained() {
  return process.platform === 'win32' || isWsl();
}

/** Where a place file has to live for Studio to open it, when that is not anywhere. */
export function studioReadablePlaceDirectory() {
  const vinegar = vinegarInstall();
  return vinegar ? vinegarCore.vinegarPlaceFileDir(vinegar) : os.tmpdir();
}

export function resolveStudioGlobalSettingsPath() {
  const vinegar = vinegarInstall();
  if (vinegar) return vinegar.studioSettingsPath;
  const localAppData = windowsLocalAppData();
  if (!localAppData) {
    throw new Error('Studio settings are available only on Windows, WSL, and Linux through Vinegar.');
  }
  return path.join(toWslPath(localAppData), 'Roblox', 'GlobalSettings_13.xml');
}

export function resolveStudioLogsDir() {
  const vinegar = vinegarInstall();
  // Vinegar points the prefix's Local AppData at its own folder, so Studio
  // writes its logs there rather than into the Wine user profile.
  if (vinegar) return path.join(vinegar.appDataDir, 'Roblox', 'logs');
  const localAppData = windowsLocalAppData();
  if (!localAppData) {
    throw new Error('Roblox Studio logs are available only on Windows, WSL, and Linux through Vinegar.');
  }
  return path.join(toWslPath(localAppData), 'Roblox', 'logs');
}

function pluginDirectorySettingPattern() {
  return /(<QDir\b[^>]*\bname="PluginsDir"[^>]*>)([\s\S]*?)(<\/QDir>)/gu;
}

export function readStudioPluginDirectorySetting(
  settingsPath = resolveStudioGlobalSettingsPath(),
) {
  if (!existsSync(settingsPath)) {
    throw new Error(
      `Roblox Studio settings were not found at ${settingsPath}. Launch and close Studio once, then retry.`,
    );
  }
  const contents = readFileSync(settingsPath, 'utf8');
  const matches = [...contents.matchAll(pluginDirectorySettingPattern())];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one Studio.PluginsDir QDir in ${settingsPath}; found ${matches.length}.`,
    );
  }
  return {
    settingsPath,
    value: matches[0][2],
    configured: matches[0][2] === ISOLATED_STUDIO_PLUGINS_DIR_NAME,
  };
}

export async function configureStudioDirectoryIsolation({
  settingsPath: requestedSettingsPath,
  relativePluginsDirectory = ISOLATED_STUDIO_PLUGINS_DIR_NAME,
  requireStudioClosed = true,
} = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(relativePluginsDirectory)) {
    throw new Error('relativePluginsDirectory must be one relative directory name.');
  }
  // A caller naming its own settings file is testing the rewrite itself, which
  // is the same work on every host. Only the host's own Studio is skipped.
  if (requestedSettingsPath === undefined && vinegarInstall()) {
    // Studio inside Vinegar reads its plugins from the Wine prefix, and the
    // prefix is per Vinegar install, not per worker: the setting that isolates
    // a folder on Windows has no second prefix to point at. The boundary here
    // is that folder itself, which `createIsolatedStudioDirectory` borrows and
    // gives back, so a suite runs the worktree plugin and the user keeps
    // theirs. One Vinegar means one suite at a time, which the worktree lease
    // already serialises.
    return {
      settingsPath: resolveStudioGlobalSettingsPath(),
      value: null,
      configured: false,
      changed: false,
      isolation: 'vinegar-prefix-plugins',
    };
  }
  const settingsPath = requestedSettingsPath ?? resolveStudioGlobalSettingsPath();
  const releaseSettingsLock = await lockfile.lock(settingsPath, {
    realpath: true,
    stale: 30000,
    retries: {
      retries: 600,
      factor: 1,
      minTimeout: 50,
      maxTimeout: 50,
    },
  });
  try {
    const current = readStudioPluginDirectorySetting(settingsPath);
    if (current.value === relativePluginsDirectory) {
      return { ...current, configured: true, changed: false };
    }
    const running = requireStudioClosed ? listStudioProcesses({ strict: true }) : [];
    if (running.length > 0) {
      throw new Error(
        `Close Roblox Studio before configuring directory isolation; running processes: ${JSON.stringify(running)}`,
      );
    }

    const contents = readFileSync(settingsPath, 'utf8');
    const updated = contents.replace(
      pluginDirectorySettingPattern(),
      (_match, open, _value, close) => `${open}${relativePluginsDirectory}${close}`,
    );
    const temporaryPath = `${settingsPath}.rsmcp-${process.pid}-${Date.now()}.tmp`;
    try {
      writeFileSync(temporaryPath, updated, {
        encoding: 'utf8',
        mode: statSync(settingsPath).mode,
      });
      renameSync(temporaryPath, settingsPath);
    } finally {
      rmSync(temporaryPath, { force: true });
    }

    const configured = readStudioPluginDirectorySetting(settingsPath);
    if (configured.value !== relativePluginsDirectory) {
      throw new Error(`Studio.PluginsDir remained ${JSON.stringify(configured.value)} after configuration.`);
    }
    return { ...configured, configured: true, changed: true };
  } finally {
    await releaseSettingsLock();
  }
}

export function createIsolatedStudioDirectory({ prefix = 'worker' } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(prefix)) {
    throw new Error('Studio worker prefix must contain only letters, numbers, dot, underscore, or dash.');
  }
  const vinegar = vinegarInstall();
  if (vinegar) return createVinegarStudioWorker(vinegar, prefix);
  const localAppData = windowsLocalAppData();
  if (!localAppData) {
    throw new Error('Studio directory isolation is supported only on Windows and WSL.');
  }
  const parent = path.join(toWslPath(localAppData), 'Temp', STUDIO_WORKER_ROOT_NAME);
  mkdirSync(parent, { recursive: true });
  const workingDirectory = mkdtempSync(path.join(parent, `${prefix}-`));
  const pluginsDirectory = path.join(workingDirectory, ISOLATED_STUDIO_PLUGINS_DIR_NAME);
  mkdirSync(pluginsDirectory);
  let cleaned = false;
  return {
    workingDirectory,
    pluginsDirectory,
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      rmSync(workingDirectory, { recursive: true, force: true });
    },
  };
}

const PLUGIN_FILE = /\.rbxmx$/iu;

/** Whether this process is holding the borrowed plugins folder right now. */
let borrowingPluginsFolder = false;

function processIsAlive(id) {
  if (!Number.isSafeInteger(id) || id < 1) return false;
  try {
    process.kill(id, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

/** Move every installed plugin file from one folder to another, newest name wins. */
function movePluginFiles(from, to) {
  if (!existsSync(from)) return [];
  const moved = [];
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (!PLUGIN_FILE.test(name)) continue;
    rmSync(path.join(to, name), { force: true });
    renameSync(path.join(from, name), path.join(to, name));
    moved.push(name);
  }
  return moved;
}

/**
 * A Studio worker inside Vinegar's own Flatpak data folder.
 *
 * The working directory has to be somewhere the sandbox can read, which the
 * host's temp folder is not.
 *
 * The plugins folder is the prefix's own, because Studio reads its plugins
 * from the prefix and there is one prefix per Vinegar install: the setting that
 * points a Windows Studio at a per-worker folder has no second prefix to point
 * at here, and Studio ignores it. So the folder is borrowed rather than
 * duplicated — whatever is installed moves aside, the suite installs the
 * worktree plugin, and `cleanup` puts the first set back.
 *
 * Borrowing is exclusive and survives a killed suite: the files wait in one
 * folder beside Vinegar with the borrower's pid, so the next worker restores
 * them if that process is gone, and refuses while it is still running. Two
 * Studios with different plugins cannot be isolated from each other on one
 * Vinegar at all, which is what the worktree lease serialises.
 */
function createVinegarStudioWorker(install, prefix) {
  const dataParent = path.dirname(install.dataDir);
  const parent = path.join(dataParent, 'roqer-workers');
  const borrowDirectory = path.join(dataParent, 'roqer-plugins-borrowed');
  const ownerFile = path.join(borrowDirectory, 'owner.json');
  const pluginsDirectory = install.pluginsDir;
  mkdirSync(parent, { recursive: true });
  mkdirSync(pluginsDirectory, { recursive: true });

  if (existsSync(ownerFile)) {
    let owner;
    try {
      owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
    } catch {
      owner = undefined;
    }
    // A second worker would take a snapshot of the folder the first emptied,
    // and give back nothing: the first worker's plugins would be lost. Two
    // workers here are a mistake, not a race to win.
    const heldHere = owner?.pid === process.pid && borrowingPluginsFolder;
    const heldElsewhere = owner?.pid !== process.pid && processIsAlive(owner?.pid);
    if (heldHere || heldElsewhere) {
      throw new Error(
        `Vinegar's Studio plugins folder ${pluginsDirectory} is already borrowed` +
        `${heldHere ? ' by this suite' : ` by a live process (pid ${owner.pid})`}. ` +
        'One Vinegar install has one plugins folder, so two Studios cannot run different ' +
        'plugins here: run these suites one at a time.',
      );
    }
    // The borrower is gone: its plugins go back before this worker takes any.
    movePluginFiles(borrowDirectory, pluginsDirectory);
    rmSync(ownerFile, { force: true });
  }

  const workingDirectory = mkdtempSync(path.join(parent, `${prefix}-`));
  mkdirSync(borrowDirectory, { recursive: true });
  const borrowed = movePluginFiles(pluginsDirectory, borrowDirectory);
  writeFileSync(
    ownerFile,
    `${JSON.stringify({ pid: process.pid, prefix, borrowed, borrowedAt: new Date().toISOString() }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  borrowingPluginsFolder = true;

  let cleaned = false;
  return {
    workingDirectory,
    pluginsDirectory,
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      // Whatever the suite installed goes, and what was borrowed comes back.
      for (const name of readdirSync(pluginsDirectory)) {
        if (PLUGIN_FILE.test(name)) rmSync(path.join(pluginsDirectory, name), { force: true });
      }
      movePluginFiles(borrowDirectory, pluginsDirectory);
      rmSync(ownerFile, { force: true });
      borrowingPluginsFolder = false;
      rmSync(workingDirectory, { recursive: true, force: true });
    },
  };
}

export function resolvePluginsDir() {
  if (process.env.MCP_PLUGINS_DIR) return process.env.MCP_PLUGINS_DIR;
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Roblox', 'Plugins');
  }
  if (isWsl()) {
    const localAppData = windowsLocalAppData();
    if (localAppData) return path.join(toWslPath(localAppData), 'Roblox', 'Plugins');
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Documents', 'Roblox', 'Plugins');
  const vinegar = vinegarInstall();
  if (vinegar) return vinegar.pluginsDir;
  return path.join(os.homedir(), 'Documents', 'Roblox', 'Plugins');
}

export function resolveStudioExe() {
  if (process.env.ROBLOX_STUDIO_EXE) return process.env.ROBLOX_STUDIO_EXE;

  if (process.platform === 'darwin') {
    return '/Applications/RobloxStudio.app/Contents/MacOS/RobloxStudio';
  }

  const vinegar = vinegarInstall();
  if (vinegar) return vinegarCore.resolveVinegarStudioExe(vinegar);

  const localAppData = windowsLocalAppData();
  const root = localAppData
    ? path.join(toWslPath(localAppData), 'Roblox', 'Versions')
    : path.join(os.homedir(), 'AppData', 'Local', 'Roblox', 'Versions');
  if (!existsSync(root)) {
    throw new Error(`Roblox Studio Versions folder not found: ${root}. Set ROBLOX_STUDIO_EXE.`);
  }

  const candidates = readdirSync(root)
    .filter((name) => name.startsWith('version-'))
    .map((name) => path.join(root, name, 'RobloxStudioBeta.exe'))
    .filter((candidate) => existsSync(candidate))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

  if (candidates.length === 0) {
    throw new Error(`RobloxStudioBeta.exe not found under ${root}. Set ROBLOX_STUDIO_EXE.`);
  }
  return candidates[0];
}

export function listStudioProcesses({ strict = false } = {}) {
  if (vinegarInstall()) {
    try {
      return listVinegarStudio();
    } catch (error) {
      if (strict) throw new Error('Unable to enumerate Roblox Studio processes.', { cause: error });
      return [];
    }
  }
  if (process.platform === 'darwin') {
    let out = '';
    try {
      out = run('pgrep', ['-fl', 'RobloxStudio']);
    } catch (error) {
      if (error?.status === 1) return [];
      if (strict) {
        throw new Error('Unable to enumerate Roblox Studio processes.', { cause: error });
      }
      return [];
    }
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [pid, ...rest] = line.trim().split(/\s+/);
        return { Id: Number(pid), Path: rest.join(' '), MainWindowTitle: '' };
      });
  }

  try {
    const out = powershell([
      "$ErrorActionPreference = 'Stop'",
      `$studio = @(); try { $studio = @(Get-Process ${STUDIO_PROCESS} -ErrorAction Stop) } catch { if ($_.FullyQualifiedErrorId -notlike "NoProcessFoundForGivenName,*") { throw } }`,
      '$studio | Select-Object Id,Path,MainWindowTitle | ConvertTo-Json -Compress',
    ].join('; '));
    if (!out) return [];
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    if (strict) {
      throw new Error('Unable to enumerate Roblox Studio processes.', { cause: error });
    }
    return [];
  }
}

/**
 * Stop one Studio under Vinegar, and only the one that was started.
 *
 * `startedAtFileTime` is the process's start time in kernel ticks on Linux,
 * read from `/proc`, where Windows reports a FILETIME. Either way it is only
 * compared for equality, which is what keeps a recycled pid from being killed
 * in place of the Studio a launch owned.
 */
function closeVinegarStudioProcess(processId, startedAtFileTime) {
  const running = listVinegarStudio().find((proc) => proc.Id === processId);
  if (!running) return 'NOT_FOUND';
  if (running.StartTimeUtcFileTime !== startedAtFileTime) return 'IDENTITY_MISMATCH';
  try {
    process.kill(processId, 'SIGTERM');
  } catch (error) {
    if (error?.code === 'ESRCH') return 'NOT_FOUND';
    throw error;
  }
  return 'STOPPED';
}

export async function closeStudioProcess({
  processId,
  startedAtFileTime,
  timeoutMs = 30000,
}) {
  if (!Number.isSafeInteger(processId) || processId < 1) {
    throw new Error('Studio processId must be a positive integer.');
  }
  if (!/^[1-9]\d*$/u.test(String(startedAtFileTime))) {
    throw new Error('Studio startedAtFileTime must be a positive FILETIME string.');
  }
  if (vinegarInstall()) {
    const result = closeVinegarStudioProcess(processId, String(startedAtFileTime));
    if (result === 'IDENTITY_MISMATCH') {
      throw new Error(`Studio process ${processId} no longer has the expected creation identity.`);
    }
    const vinegarDeadline = Date.now() + timeoutMs;
    while (Date.now() < vinegarDeadline) {
      if (!listStudioProcesses({ strict: true }).some((proc) => proc.Id === processId)) {
        return { status: result === 'STOPPED' ? 'stopped' : 'already_stopped', processId };
      }
      await delay(250);
    }
    throw new Error(`Studio process ${processId} remained alive after exact close.`);
  }
  const expected = `[long]${startedAtFileTime}`;
  const result = powershell([
    `$studio = Get-Process -Id ${processId} -ErrorAction SilentlyContinue`,
    'if ($null -eq $studio) { "NOT_FOUND"; return }',
    `$expected = ${expected}`,
    '$actual = $studio.StartTime.ToUniversalTime().ToFileTimeUtc()',
    'if ($actual -ne $expected) { "IDENTITY_MISMATCH"; return }',
    '$studio.Kill()',
    '$studio.WaitForExit()',
    '"STOPPED"',
  ].join('; '));
  if (result.includes('IDENTITY_MISMATCH')) {
    throw new Error(`Studio process ${processId} no longer has the expected creation identity.`);
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!listStudioProcesses({ strict: true }).some((process) => process.Id === processId)) {
      return { status: result.includes('STOPPED') ? 'stopped' : 'already_stopped', processId };
    }
    await delay(250);
  }
  throw new Error(`Studio process ${processId} remained alive after exact close.`);
}

export async function closeAllStudio({ requireEnv = true, timeoutMs = 30000 } = {}) {
  if (requireEnv && process.env.RSMCP_E2E_CLOSE_ALL_STUDIO !== '1') {
    throw new Error('Refusing to close Studio. Set RSMCP_E2E_CLOSE_ALL_STUDIO=1.');
  }

  if (vinegarInstall()) {
    for (const proc of listStudioProcesses()) {
      try {
        process.kill(proc.Id, 'SIGTERM');
      } catch {
        // Already gone.
      }
    }
  } else if (process.platform === 'darwin') {
    try {
      run('pkill', ['-f', 'RobloxStudio']);
    } catch {
      // No matching process.
    }
  } else {
    try {
      powershell(`Get-Process ${STUDIO_PROCESS} -ErrorAction SilentlyContinue | Stop-Process -Force`);
    } catch {
      // No matching process.
    }
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (listStudioProcesses().length === 0) return;
    await delay(500);
  }
  throw new Error(`Studio processes still running: ${JSON.stringify(listStudioProcesses())}`);
}

export function launchStudio(args = [], { workingDirectory } = {}) {
  const exe = resolveStudioExe();
  const studioArgs = args.map(toStudioLaunchArg);
  const cwd = workingDirectory ?? process.env.RSMCP_STUDIO_WORKING_DIRECTORY ??
    (isWsl() && existsSync('/mnt/c/Windows') ? '/mnt/c/Windows' : process.cwd());
  const vinegar = vinegarInstall();
  if (vinegar) {
    // Vinegar hands the arguments to its own single application instance, so
    // the process this spawns is the launcher and not Studio: its pid says
    // nothing about Studio's, and the caller identifies Studio by observing
    // the process table, as the server does.
    const launch = vinegarCore.buildVinegarLaunchCommand({
      install: vinegar,
      studioArgs,
      workingDirectory: cwd,
    });
    const launcher = spawn(launch.command, launch.args, { cwd: process.cwd(), detached: true, stdio: 'ignore' });
    launcher.unref();
    return { pid: undefined, exe, args: studioArgs, workingDirectory: cwd, launcherPid: launcher.pid };
  }
  const proc = spawn(exe, studioArgs, {
    cwd,
    detached: true,
    stdio: 'ignore',
  });
  proc.unref();
  return { pid: proc.pid, exe, args: studioArgs, workingDirectory: cwd };
}

function readHealth(port = DEFAULT_MCP_PORT) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('health timeout')));
  });
}

export async function waitConnected({ timeoutMs = 120000, variant, version } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const health = await readHealth();
      last = health;
      const instances = Array.isArray(health.instances) ? health.instances : [];
      const edit = instances.find((inst) => inst.role === 'edit');
      if (edit) {
        if (variant && edit.pluginVariant !== variant) {
          throw new Error(`Connected plugin variant ${edit.pluginVariant}, expected ${variant}`);
        }
        if (version && edit.pluginVersion !== version) {
          throw new Error(`Connected plugin version ${edit.pluginVersion}, expected ${version}`);
        }
        return health;
      }
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await delay(1000);
  }
  throw new Error(`Studio did not connect within ${timeoutMs}ms. Last health: ${JSON.stringify(last)}`);
}

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : fallback;
}

async function main() {
  const command = process.argv[2] ?? 'status';
  if (command === 'status') {
    let studioExe;
    try {
      studioExe = resolveStudioExe();
    } catch {
      studioExe = undefined;
    }
    console.log(JSON.stringify({
      processes: listStudioProcesses(),
      pluginsDir: resolvePluginsDir(),
      studioExe: studioExe && existsSync(studioExe) ? studioExe : undefined,
      pluginDirectorySetting: (() => {
        try {
          return readStudioPluginDirectorySetting();
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      })(),
    }, null, 2));
    return;
  }
  if (command === 'close-all') {
    await closeAllStudio();
    console.log(JSON.stringify({ processes: listStudioProcesses() }, null, 2));
    return;
  }
  if (command === 'configure-plugin-isolation') {
    console.log(JSON.stringify(await configureStudioDirectoryIsolation(), null, 2));
    return;
  }
  if (command === 'launch') {
    console.log(JSON.stringify(launchStudio(process.argv.slice(3)), null, 2));
    return;
  }
  if (command === 'wait-connected') {
    const timeoutMs = Number(argValue('--timeout-ms', '120000'));
    const variant = argValue('--variant', undefined);
    const version = argValue('--version', undefined);
    console.log(JSON.stringify(await waitConnected({ timeoutMs, variant, version }), null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
