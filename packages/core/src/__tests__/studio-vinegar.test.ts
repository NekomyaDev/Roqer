import path from 'path';

import {
  buildVinegarLaunchCommand,
  detectVinegarInstall,
  flatpakOverrideCommand,
  flatpakVinegarDataDir,
  parseFlatpakFilesystems,
  parseProcessStartTicks,
  parseUserDirectories,
  parseVinegarStudioProcesses,
  resolveFlatpakFilesystems,
  resolveVinegarPrefixUser,
  toVinegarStudioPath,
  vinegarCanReadPath,
  vinegarPlaceFileDir,
  type VinegarInstall,
  type VinegarUserDirectories,
} from '../studio-vinegar.js';

const HOME = '/home/dev';
const FLATPAK = '/usr/bin/flatpak';

function linuxEvidence(overrides: Record<string, unknown> = {}) {
  return {
    platform: 'linux' as NodeJS.Platform,
    home: HOME,
    flatpakCommand: FLATPAK,
    flatpakAppInstalled: true,
    flatpakAppVersion: '1.9.4',
    prefixUser: 'dev',
    ...overrides,
  };
}

const INSTALL = detectVinegarInstall(linuxEvidence()) as VinegarInstall;

const DIRECTORIES: VinegarUserDirectories = {
  home: HOME,
  documents: `${HOME}/Documents`,
  pictures: `${HOME}/Pictures`,
  download: `${HOME}/Downloads`,
  music: `${HOME}/Music`,
  videos: `${HOME}/Videos`,
  desktop: `${HOME}/Desktop`,
  publicShare: `${HOME}/Public`,
  templates: `${HOME}/Templates`,
  runtime: '/run/user/1000',
  configHome: `${HOME}/.config`,
  cacheHome: `${HOME}/.cache`,
  dataHome: `${HOME}/.local/share`,
};

// What `flatpak info --show-permissions org.vinegarhq.Vinegar` printed for
// Vinegar 1.9.4 from Flathub.
const SHOW_PERMISSIONS = [
  '[Context]',
  'shared=ipc;network;',
  'sockets=pulseaudio;wayland;x11;',
  'devices=all;',
  'features=devel;',
  'filesystems=xdg-run/app/com.discordapp.Discord:create;xdg-documents;xdg-pictures;',
  '',
  '[Environment]',
  'GST_PLUGIN_SYSTEM_PATH=/app/lib/gstreamer-1.0',
  'filesystems=not-a-filesystem-entry',
].join('\n');

describe('Vinegar discovery', () => {
  test('a Linux host with the Vinegar Flatpak can launch Studio through it', () => {
    const data = flatpakVinegarDataDir(HOME);
    const prefix = path.join(data, 'prefixes', 'studio');
    const prefixUserDir = path.join(prefix, 'drive_c', 'users', 'dev');
    expect(detectVinegarInstall(linuxEvidence())).toEqual({
      kind: 'flatpak',
      command: FLATPAK,
      commandArgs: ['run'],
      applicationId: 'org.vinegarhq.Vinegar',
      version: '1.9.4',
      dataDir: data,
      prefixDir: prefix,
      // Vinegar points the prefix's Local AppData at its own folder, and
      // Studio keeps its settings and logs there.
      appDataDir: path.join(data, 'appdata'),
      studioSettingsPath: path.join(data, 'appdata', 'Roblox', 'GlobalSettings_13.xml'),
      // Its plugins folder is the one thing Studio resolves from the Wine user
      // profile instead, which is where it actually loads a plugin from.
      prefixUserDir,
      pluginsDir: path.join(prefixUserDir, 'AppData', 'Local', 'Roblox', 'Plugins'),
      pluginsDirInPrefix: 'C:\\users\\dev\\AppData\\Local\\Roblox\\Plugins',
      versionsDir: path.join(data, 'versions'),
    });
  });

  test('without a Wine user profile there is no plugins folder, so no install', () => {
    expect(detectVinegarInstall(linuxEvidence({ prefixUser: undefined }))).toBeUndefined();
    expect(detectVinegarInstall(linuxEvidence({ prefixUser: '  ' }))).toBeUndefined();
  });

  test("the Wine user profile is read from the prefix, and named after the host user when it cannot be", () => {
    const prefix = '/data/prefixes/studio';
    const users = path.join(prefix, 'drive_c', 'users');
    expect(resolveVinegarPrefixUser(prefix, 'dev', (dir) => {
      expect(dir).toBe(users);
      return ['Public', 'dev'];
    })).toBe('dev');
    // A prefix another tool built may name its one profile anything.
    expect(resolveVinegarPrefixUser(prefix, 'dev', () => ['Public', 'steamuser'])).toBe('steamuser');
    // Nothing to read, or nothing to choose between: Wine will name the
    // profile it creates after the host user.
    expect(resolveVinegarPrefixUser(prefix, 'dev', () => [])).toBe('dev');
    expect(resolveVinegarPrefixUser(prefix, 'dev', () => ['alice', 'bob'])).toBe('dev');
  });

  test('a host that cannot run Vinegar has no install', () => {
    expect(detectVinegarInstall(linuxEvidence({ platform: 'win32' }))).toBeUndefined();
    expect(detectVinegarInstall(linuxEvidence({ platform: 'darwin' }))).toBeUndefined();
    // WSL runs the Windows Studio through interop; Vinegar must not take over,
    // whether the caller says so or only the kernel does.
    expect(detectVinegarInstall(linuxEvidence({ isWsl: true }))).toBeUndefined();
    expect(detectVinegarInstall(linuxEvidence({
      kernelVersion: 'Linux version 6.6.87.2-microsoft-standard-WSL2',
    }))).toBeUndefined();
    expect(detectVinegarInstall(linuxEvidence({
      kernelVersion: 'Linux version 6.8.0-generic',
    }))).toBeDefined();
    expect(detectVinegarInstall(linuxEvidence({ flatpakCommand: undefined }))).toBeUndefined();
    expect(detectVinegarInstall(linuxEvidence({ flatpakAppInstalled: false }))).toBeUndefined();
    expect(detectVinegarInstall(linuxEvidence({ home: '' }))).toBeUndefined();
  });

  test('Vinegar can be switched off, and its data folder relocated', () => {
    for (const enabled of ['0', 'false', 'FALSE', 'no', ' off ']) {
      expect(detectVinegarInstall(linuxEvidence({ enabled }))).toBeUndefined();
    }
    expect(detectVinegarInstall(linuxEvidence({ enabled: '1' }))).toBeDefined();

    const relocated = detectVinegarInstall(linuxEvidence({ dataDirOverride: ' /opt/vinegar ' }));
    expect(relocated?.dataDir).toBe('/opt/vinegar');
    expect(relocated?.pluginsDir).toBe(
      path.join('/opt/vinegar', 'prefixes', 'studio', 'drive_c', 'users', 'dev', 'AppData', 'Local', 'Roblox', 'Plugins'),
    );
  });

  test('generated place files go beside Vinegar in its own Flatpak data folder', () => {
    expect(vinegarPlaceFileDir(INSTALL)).toBe(
      path.join(HOME, '.var', 'app', 'org.vinegarhq.Vinegar', 'data', 'roqer-places'),
    );
  });

  test('the remediation command shares one folder for good', () => {
    expect(flatpakOverrideCommand(INSTALL, '/home/dev/My Places')).toBe(
      '/usr/bin/flatpak override --user --filesystem="/home/dev/My Places" org.vinegarhq.Vinegar',
    );
  });
});

describe('Vinegar path translation', () => {
  test("a host path becomes the Wine prefix's Z: view of it", () => {
    expect(toVinegarStudioPath('/home/dev/Documents/a.rbxl')).toBe('Z:\\home\\dev\\Documents\\a.rbxl');
    expect(toVinegarStudioPath('/home/dev/Documents/')).toBe('Z:\\home\\dev\\Documents');
    expect(toVinegarStudioPath('/home/dev/./a/../b.rbxl')).toBe('Z:\\home\\dev\\b.rbxl');
    expect(toVinegarStudioPath('/')).toBe('Z:\\');
  });

  test('a path Studio could not resolve is refused', () => {
    expect(() => toVinegarStudioPath('relative/a.rbxl')).toThrow(/absolute path/);
    expect(() => toVinegarStudioPath('/home/dev/a\0.rbxl')).toThrow(/null character/);
  });
});

describe('Vinegar sandbox reach', () => {
  test('the Flatpak filesystem entries are read from the Context section only', () => {
    expect(parseFlatpakFilesystems(SHOW_PERMISSIONS)).toEqual([
      'xdg-run/app/com.discordapp.Discord:create',
      'xdg-documents',
      'xdg-pictures',
    ]);
    expect(parseFlatpakFilesystems('[Environment]\nfilesystems=home;')).toEqual([]);
    expect(parseFlatpakFilesystems('')).toEqual([]);
  });

  test('user-dirs.dirs names the folders an xdg token resolves to', () => {
    expect(parseUserDirectories(
      [
        '# generated',
        'XDG_DOCUMENTS_DIR="$HOME/Dokumentit"',
        'XDG_PICTURES_DIR=~/Kuvat',
        'XDG_DOWNLOAD_DIR=""',
        'XDG_SOMETHING_DIR="$HOME/Else"',
        'not a setting',
      ].join('\n'),
      HOME,
    )).toEqual({ documents: `${HOME}/Dokumentit`, pictures: `${HOME}/Kuvat` });
  });

  test('entries resolve to host folders, and a withheld one is kept apart', () => {
    expect(resolveFlatpakFilesystems(
      ['home', 'xdg-documents', 'xdg-pictures:ro', 'xdg-run/app/x:create', '~/Projects', '/srv/places', '!~/Private', 'xdg-nonsense'],
      DIRECTORIES,
    )).toEqual({
      allowed: [
        HOME,
        `${HOME}/Documents`,
        `${HOME}/Pictures`,
        '/run/user/1000/app/x',
        `${HOME}/Projects`,
        '/srv/places',
      ],
      denied: [`${HOME}/Private`],
    });

    expect(resolveFlatpakFilesystems(['host'], DIRECTORIES).allowed).toEqual(['/']);
  });

  test("Studio can open a shared file, and never one outside what Vinegar can see", () => {
    const filesystem = resolveFlatpakFilesystems(parseFlatpakFilesystems(SHOW_PERMISSIONS), DIRECTORIES);

    expect(vinegarCanReadPath(`${HOME}/Documents/a.rbxl`, filesystem, INSTALL)).toBe(true);
    expect(vinegarCanReadPath(`${HOME}/Documents`, filesystem, INSTALL)).toBe(true);
    expect(vinegarCanReadPath('/tmp/a.rbxl', filesystem, INSTALL)).toBe(false);
    expect(vinegarCanReadPath(`${HOME}/Projects/a.rbxl`, filesystem, INSTALL)).toBe(false);
    // A folder whose name merely begins with a shared one is not shared.
    expect(vinegarCanReadPath(`${HOME}/Documents-old/a.rbxl`, filesystem, INSTALL)).toBe(false);
    expect(vinegarCanReadPath('a.rbxl', filesystem, INSTALL)).toBe(false);
  });

  test("Vinegar's own Flatpak data folder is always reachable", () => {
    const empty = { allowed: [], denied: [] };
    expect(vinegarCanReadPath(vinegarPlaceFileDir(INSTALL), empty, INSTALL)).toBe(true);
    expect(vinegarCanReadPath(INSTALL.pluginsDir, empty, INSTALL)).toBe(true);
    expect(vinegarCanReadPath(`${HOME}/Documents/a.rbxl`, empty, INSTALL)).toBe(false);
  });

  test('a withheld folder wins over a shared one that contains it', () => {
    const filesystem = resolveFlatpakFilesystems(['home', '!~/Documents/Secret'], DIRECTORIES);
    expect(vinegarCanReadPath(`${HOME}/Documents/a.rbxl`, filesystem)).toBe(true);
    expect(vinegarCanReadPath(`${HOME}/Documents/Secret/a.rbxl`, filesystem)).toBe(false);
  });
});

describe('Vinegar launch command', () => {
  test('Vinegar options precede the application, and Studio arguments follow it', () => {
    expect(buildVinegarLaunchCommand({
      install: INSTALL,
      studioArgs: ['--task', 'EditFile', '--localPlaceFile', 'Z:\\home\\dev\\a.rbxl'],
    })).toEqual({
      command: FLATPAK,
      args: ['run', 'org.vinegarhq.Vinegar', '--task', 'EditFile', '--localPlaceFile', 'Z:\\home\\dev\\a.rbxl'],
    });
  });

  test('an environment patch and a working directory reach Flatpak as its own options', () => {
    const launch = buildVinegarLaunchCommand({
      install: INSTALL,
      studioArgs: ['--task', 'EditFile'],
      workingDirectory: '/home/dev/work',
      environment: { set: { RBX_TEST: 'on' }, remove: ['DISPLAY'] },
    });
    expect(launch).toEqual({
      command: FLATPAK,
      args: [
        'run',
        '--unset-env=DISPLAY',
        '--env=RBX_TEST=on',
        '--cwd=/home/dev/work',
        'org.vinegarhq.Vinegar',
        '--task',
        'EditFile',
      ],
    });
    // Flatpak honours a run-time share only for the command that starts the
    // application, so a launch never grants one; what Studio may open is
    // decided beforehand against the shares the user has actually made.
    expect(launch.args.some((arg) => arg.startsWith('--filesystem'))).toBe(false);
  });
});

describe('Vinegar Studio processes', () => {
  // `pgrep -a -f RobloxStudioBeta.exe` as observed while Vinegar ran Studio:
  // the embedded browser names Studio's executable in its own arguments, so
  // matching the command line alone reports every helper as a Studio.
  const PGREP = [
    '134662 /home/dev/.var/app/org.vinegarhq.Vinegar/data/vinegar/versions/version-4f08/RobloxStudioBeta.exe --task EditFile --localPlaceFile Z:\\home\\dev\\Documents\\a.rbxl',
    '134839 C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application\\144.0\\msedgewebview2.exe --webview-exe-name=RobloxStudioBeta.exe --embedded-browser-webview=1',
    '134880 C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application\\144.0\\msedgewebview2.exe --type=gpu-process --webview-exe-name=RobloxStudioBeta.exe',
    '',
    'not-a-process-line',
  ].join('\n');

  test('only a process whose own program is Studio counts', () => {
    expect(parseVinegarStudioProcesses(PGREP, () => '914327')).toEqual([
      {
        id: 134662,
        startedAt: '914327',
        executable: '/home/dev/.var/app/org.vinegarhq.Vinegar/data/vinegar/versions/version-4f08/RobloxStudioBeta.exe',
        commandLine: '/home/dev/.var/app/org.vinegarhq.Vinegar/data/vinegar/versions/version-4f08/RobloxStudioBeta.exe --task EditFile --localPlaceFile Z:\\home\\dev\\Documents\\a.rbxl',
      },
    ]);
  });

  test('no Studio running reads as no process', () => {
    expect(parseVinegarStudioProcesses('', () => undefined)).toEqual([]);
    expect(parseVinegarStudioProcesses('0 /bad/pid/RobloxStudioBeta.exe', () => undefined)).toEqual([]);
  });

  test('a process that exited before it could be read keeps no start time', () => {
    expect(parseVinegarStudioProcesses(PGREP, () => undefined)[0].startedAt).toBeUndefined();
  });

  test('the start time is read past a program name holding spaces and parentheses', () => {
    // /proc/<pid>/stat: pid, (comm), then state onward. Field 22 is the start
    // time, which is the twentieth value after the closing parenthesis.
    const fields = ['S', '1', '1', '0', '-1', '4194304', '100', '0', '0', '0', '5', '2', '0', '0', '20', '0', '30', '0', '0', '914327'];
    expect(parseProcessStartTicks(`134662 (Roblox Studio (beta)) ${fields.join(' ')} 1234 5678`)).toBe('914327');
    expect(parseProcessStartTicks('134662 (bad)')).toBeUndefined();
    expect(parseProcessStartTicks('')).toBeUndefined();
  });
});
