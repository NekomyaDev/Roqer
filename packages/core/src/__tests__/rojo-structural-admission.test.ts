// Real disk and write lease; the Windows process observation and owner transition
// are explicit fixtures. No Studio or Rojo server is started.
import fs from 'fs';
import os from 'os';
import * as path from 'path';
import lockfile from 'proper-lockfile';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { applyStructure, type ProjectChange, type StructureContext } from '../rojo/structure.js';
import { sourceWriteLockPath } from '../rojo/file-write-lock.js';
import { sourceRevision } from '../rojo/source-revision.js';
import { stubWindowsProcessObserver } from './rojo-process-observer-fixture.js';

let directory: string;
beforeEach(() => {
  directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'roqer structural admission ')));
  jest.spyOn(os, 'homedir').mockReturnValue(path.join(directory, 'private-home'));
  stubWindowsProcessObserver();
});
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });

describe('structural admission after asynchronous write locking', () => {
  test('cancellation between operations undoes the already applied file move', async () => {
    const file = path.join(directory, 'Main.server.luau');
    const moved = path.join(directory, 'Moved.server.luau');
    const other = path.join(directory, 'Other.server.luau');
    const otherMoved = path.join(directory, 'OtherMoved.server.luau');
    fs.writeFileSync(file, 'first\n'); fs.writeFileSync(other, 'second\n');
    const cancellation = new AbortController();
    const beforeApply = () => {
      if (fs.existsSync(moved)) cancellation.abort();
      cancellation.signal.throwIfAborted();
    };
    const context: StructureContext = { root: directory, projectFile: path.join(directory, 'default.project.json'),
      ignored: async () => new Set(), sourcemap: async () => ({ name: 'Fixture', className: 'DataModel' }) };
    const change: ProjectChange = { ops: [{ kind: 'rename', from: file, to: moved }, { kind: 'rename', from: other, to: otherMoved }],
      guarded: [{ file, revision: sourceRevision('first\n') }, { file: other, revision: sourceRevision('second\n') }],
      checks: [], studio: [], created: [], removed: [], renamed: [{ from: file, to: moved }, { from: other, to: otherMoved }], instances: [] };
    await expect(applyStructure(context, change, path.join(directory, 'backup'), beforeApply)).rejects.toThrow('abort');
    expect(fs.readFileSync(file, 'utf8')).toBe('first\n');
    expect(fs.readFileSync(other, 'utf8')).toBe('second\n');
    expect(fs.existsSync(moved)).toBe(false); expect(fs.existsSync(otherMoved)).toBe(false);
    expect(fs.existsSync(sourceWriteLockPath(file))).toBe(false);
    expect(fs.existsSync(sourceWriteLockPath(other))).toBe(false);
  });

  test.each(['cancelled', 'owner-changed'] as const)('%s during locking preserves every project file', async mode => {
    const file = path.join(directory, 'Main.server.luau');
    const moved = path.join(directory, 'Moved.server.luau');
    fs.writeFileSync(file, 'source\n');
    const cancellation = new AbortController();
    let ownerChanged = false;
    const lock = lockfile.lock.bind(lockfile);
    jest.spyOn(lockfile, 'lock').mockImplementation(async (target, options) => {
      const release = await lock(target, options);
      if (mode === 'cancelled') cancellation.abort();
      else ownerChanged = true;
      return release;
    });
    const beforeApply = jest.fn(() => {
      expect(fs.existsSync(sourceWriteLockPath(file))).toBe(true);
      cancellation.signal.throwIfAborted();
      if (ownerChanged) throw new Error('The original Studio owner is unavailable');
    });
    const context: StructureContext = { root: directory, projectFile: path.join(directory, 'default.project.json'),
      ignored: async () => new Set(), sourcemap: async () => ({ name: 'Fixture', className: 'DataModel' }) };
    const change: ProjectChange = { ops: [{ kind: 'rename', from: file, to: moved }],
      guarded: [{ file, revision: sourceRevision('source\n') }], checks: [], studio: [],
      created: [], removed: [], renamed: [{ from: file, to: moved }], instances: [] };
    // Reflect forwards the optional hook without turning the pre-fix red into a type error.
    const result = Reflect.apply(applyStructure, undefined, [context, change, path.join(directory, 'backup'), beforeApply]) as Promise<unknown>;
    await expect(result).rejects.toThrow(mode === 'cancelled' ? 'abort' : 'original Studio owner');
    expect(beforeApply).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(file, 'utf8')).toBe('source\n');
    expect(fs.existsSync(moved)).toBe(false);
    expect(fs.existsSync(sourceWriteLockPath(file))).toBe(false);
  });
});
