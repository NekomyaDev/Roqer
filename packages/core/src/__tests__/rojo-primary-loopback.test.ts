import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { networkInterfaces } from 'os';
import { afterEach, describe, expect, test } from '@jest/globals';
import { BridgeService } from '../bridge-service.js';
import { createHttpServer, isLoopbackAddress } from '../http-server.js';
import { RobloxStudioTools } from '../tools/index.js';

const AUTH = 'fixture-only-loopback-token';

/** A non-internal IPv4 address of this machine, when it has one. */
const externalAddress = Object.values(networkInterfaces()).flat()
  .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address;

describe('private source delegation stays on this machine', () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  test('loopback peers are recognised in every socket form, and nothing else is', () => {
    for (const address of ['127.0.0.1', '127.8.9.10', '::1', '::ffff:127.0.0.1', '::FFFF:127.0.0.1']) expect(isLoopbackAddress(address)).toBe(true);
    for (const address of [undefined, '', '10.0.0.5', '192.168.1.2', '::ffff:10.0.0.5', 'fe80::1', '::', '0.0.0.0', '127.0.0.1.evil']) expect(isLoopbackAddress(address)).toBe(false);
  });

  (externalAddress ? test : test.skip)('a token holder on another interface is refused before the capability or a packet is read', async () => {
    const bridge = new BridgeService();
    const app = createHttpServer(new RobloxStudioTools(bridge), bridge, undefined, { name: 'fixture-loopback', version: '3.0.3', tools: [], pluginVariant: 'main' }, { authToken: AUTH });
    server = createServer(app);
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '0.0.0.0', resolve); });
    const { port } = server.address() as AddressInfo;
    const call = async (host: string, body?: unknown) => {
      const response = await fetch(`http://${host}:${port}/proxy-rojo`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'X-MCP-Auth': AUTH, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10_000),
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };

    expect(await call(externalAddress!)).toMatchObject({ status: 403, body: { error: 'loopback_required' } });
    expect(await call(externalAddress!, { pluginVariant: 'main' })).toMatchObject({ status: 403, body: { error: 'loopback_required' } });
    // The same server still serves a follower on this machine.
    expect(await call('127.0.0.1')).toMatchObject({ status: 200, body: { protocol: 1 } });
  });
});
