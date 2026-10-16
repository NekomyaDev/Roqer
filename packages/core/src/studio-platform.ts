import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';

import { getVinegarInstall } from './studio-vinegar.js';

export type StudioHostPlatform = 'windows' | 'wsl' | 'macos' | 'linux';
export type StudioProcessIdentityLauncher =
  | 'windows-retained'
  | 'wsl-windows-retained'
  | 'unavailable';

/**
 * How Roblox Studio runs on this host.
 *
 * `native` is a Studio build for the host or, under WSL, the Windows Studio
 * reached through interop. `wine-vinegar` is Studio inside Vinegar's Wine
 * prefix, the only way it runs on Linux. `unavailable` is a host with no way to
 * run Studio at all, where `manage_instance` can only report that.
 */
export type StudioRuntime = 'native' | 'wine-vinegar' | 'unavailable';

export interface StudioPlatformEvidence {
  platform: NodeJS.Platform;
  kernelVersion?: string;
  wslInterop?: string;
  wslDistroName?: string;
  windowsRootPresent?: boolean;
  wslPathPresent?: boolean;
  windowsInteropAvailable?: boolean;
  /** Whether a usable Vinegar install was found. Linux only. */
  vinegarAvailable?: boolean;
}

export interface StudioPlatformCapabilities {
  hostPlatform: StudioHostPlatform;
  isWsl: boolean;
  windowsInteropAvailable: boolean;
  studioRuntime: StudioRuntime;
  processIdentity: {
    supported: boolean;
    launcher: StudioProcessIdentityLauncher;
    reason?: string;
  };
}

const WSL_KERNEL_PATTERN = /microsoft|wsl/i;
const WINDOWS_INTEROP_PROBE_TOKEN = 'ROBLOXSTUDIO_MCP_WINDOWS_INTEROP_OK';
const WINDOWS_POWERSHELL =
  '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';

export function detectStudioPlatform(
  evidence: StudioPlatformEvidence,
): StudioPlatformCapabilities {
  if (evidence.platform === 'win32') {
    return {
      hostPlatform: 'windows',
      isWsl: false,
      windowsInteropAvailable: true,
      studioRuntime: 'native',
      processIdentity: {
        supported: true,
        launcher: 'windows-retained',
      },
    };
  }

  if (evidence.platform === 'darwin') {
    return {
      hostPlatform: 'macos',
      isWsl: false,
      windowsInteropAvailable: false,
      studioRuntime: 'native',
      processIdentity: {
        supported: false,
        launcher: 'unavailable',
        reason: 'The retained Windows Studio launcher is unavailable on macOS.',
      },
    };
  }

  const hasWslKernel =
    evidence.platform === 'linux' &&
    WSL_KERNEL_PATTERN.test(evidence.kernelVersion ?? '');
  const hasWindowsInterop =
    hasWslKernel && evidence.windowsInteropAvailable === true;

  if (hasWindowsInterop) {
    return {
      hostPlatform: 'wsl',
      isWsl: true,
      windowsInteropAvailable: true,
      studioRuntime: 'native',
      processIdentity: {
        supported: true,
        launcher: 'wsl-windows-retained',
      },
    };
  }

  // Native Linux runs Studio only through Vinegar's Wine prefix. Vinegar hands
  // each launch to its own single application instance, so no caller can hold a
  // suspended Studio and prove its exact creation identity; the launched
  // process is identified by observing the process table instead.
  const reason = hasWslKernel
    ? 'The Linux kernel has a WSL signature, but the live process cannot execute the Windows launcher.'
    : evidence.vinegarAvailable === true
      ? 'Vinegar runs Studio through Wine in a Flatpak sandbox, which cannot retain an exact process identity. The launched Studio is identified by process observation instead.'
      : 'Roblox Studio has no Linux build. Install Vinegar (https://vinegarhq.org) to run Studio on this host.';
  return {
    hostPlatform: 'linux',
    isWsl: false,
    windowsInteropAvailable: false,
    studioRuntime: !hasWslKernel && evidence.vinegarAvailable === true ? 'wine-vinegar' : 'unavailable',
    processIdentity: {
      supported: false,
      launcher: 'unavailable',
      reason,
    },
  };
}

function readKernelVersion(): string {
  if (process.platform !== 'linux') return '';
  try {
    return readFileSync('/proc/version', 'utf8');
  } catch {
    return '';
  }
}

function powershellCandidates(): string[] {
  return existsSync(WINDOWS_POWERSHELL)
    ? [WINDOWS_POWERSHELL, 'powershell.exe']
    : ['powershell.exe'];
}

function probeWindowsInterop(kernelVersion: string): boolean {
  if (process.platform !== 'linux' || !WSL_KERNEL_PATTERN.test(kernelVersion)) {
    return false;
  }

  const cwd = existsSync('/mnt/c/Windows') ? '/mnt/c/Windows' : process.cwd();
  for (const command of powershellCandidates()) {
    try {
      const output = execFileSync(
        command,
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `[Console]::Write('${WINDOWS_INTEROP_PROBE_TOKEN}')`,
        ],
        {
          cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 3000,
          killSignal: 'SIGKILL',
        },
      ).trim();
      if (output === WINDOWS_INTEROP_PROBE_TOKEN) return true;
    } catch {
      // Try the next known PowerShell path.
    }
  }
  return false;
}

let cachedStudioPlatformCapabilities: StudioPlatformCapabilities | undefined;

export function getStudioPlatformCapabilities(): StudioPlatformCapabilities {
  if (cachedStudioPlatformCapabilities) return cachedStudioPlatformCapabilities;

  const kernelVersion = readKernelVersion();
  cachedStudioPlatformCapabilities = detectStudioPlatform({
    platform: process.platform,
    kernelVersion,
    wslInterop: process.env.WSL_INTEROP,
    wslDistroName: process.env.WSL_DISTRO_NAME,
    windowsRootPresent: existsSync('/mnt/c/Windows'),
    wslPathPresent: existsSync('/usr/bin/wslpath') || existsSync('/bin/wslpath'),
    windowsInteropAvailable: probeWindowsInterop(kernelVersion),
    vinegarAvailable: getVinegarInstall() !== undefined,
  });
  return cachedStudioPlatformCapabilities;
}
