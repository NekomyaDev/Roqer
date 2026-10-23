#!/usr/bin/env node

import { closeStudioProcess, studioProcessIdentityRetained } from '../scripts/studio-lifecycle.mjs';
import { McpClient, DIST, assert } from './lib/mcp-client.mjs';

async function main() {
  let client;
  let launchId;
  let processIdentity;
  let bodyError;

  try {
    client = new McpClient('wsl-process-identity-launch', {
      command: 'node',
      args: [DIST],
      startupTimeoutMs: 60000,
    });
    await client.start();
    await client.initialize();

    if (!studioProcessIdentityRetained()) {
      // Only the Windows launcher can hold Studio and prove which process it
      // started. A host that cannot has to refuse the request before anything
      // is spawned, and say what identifies a launch there instead; a launch
      // that quietly went ahead would leave a Studio nobody owns.
      console.log('\n=== process identity launch is refused where it cannot be retained ===');
      const refused = await client.rpc('tools/call', {
        name: 'manage_instance',
        arguments: {
          action: 'launch',
          source: 'baseplate',
          require_process_identity: true,
          wait_for_connection: false,
        },
      }, 120000);
      const text = refused?.content?.find((entry) => entry.type === 'text')?.text;
      assert(typeof text === 'string', `refusal carries a body (${JSON.stringify(refused)})`);
      const body = JSON.parse(text);
      assert(refused.isError === true, 'the launch is refused as a tool error');
      assert(body.error === 'process_identity_unavailable', `the refusal names the cause (${text})`);
      assert(body.launch_stage === 'pre_spawn', `the refusal comes before a spawn (${text})`);
      assert(body.process_created === false, `no Studio was started (${text})`);
      assert(
        typeof body.remediation === 'string' && body.remediation.length > 0,
        `the refusal says how a launch is identified here (${text})`,
      );
      console.log('\n✅ process identity launch refusal PASSED');
      return;
    }

    console.log('\n=== WSL process identity launch without a working directory ===');
    const launch = await client.callTool('manage_instance', {
      action: 'launch',
      source: 'baseplate',
      require_process_identity: true,
      wait_for_connection: false,
    });

    launchId = typeof launch.launch_id === 'string' && launch.launch_id
      ? launch.launch_id
      : undefined;
    const hasExactProcessIdentity = Number.isSafeInteger(launch.pid)
      && launch.pid > 0
      && typeof launch.process_started_at_file_time === 'string'
      && /^[1-9]\d*$/u.test(launch.process_started_at_file_time);
    if (hasExactProcessIdentity) {
      processIdentity = {
        processId: launch.pid,
        startedAtFileTime: launch.process_started_at_file_time,
      };
    }

    assert(!!launchId, `identity launch returned launch_id (${JSON.stringify(launch)})`);
    assert(hasExactProcessIdentity, `identity launch returned an exact process identity (${JSON.stringify(launch)})`);
    assert(
      launch.studio_working_directory === undefined,
      'identity launch preserves the omitted studio_working_directory',
    );

    const closed = await client.callTool('manage_instance', {
      action: 'close',
      launch_id: launchId,
    });
    assert(closed.close_status === 'closed', 'the suspended Studio launch is aborted by exact identity');
    console.log('\n✅ WSL process identity launch regression PASSED');
  } catch (error) {
    bodyError = error;
  } finally {
    const cleanupErrors = [];
    if (client && launchId) {
      try {
        await client.callTool('manage_instance', {
          action: 'close',
          launch_id: launchId,
        });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (processIdentity) {
      try {
        await closeStudioProcess(processIdentity);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (client) {
      try {
        await client.stop();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (bodyError && cleanupErrors.length === 0) throw bodyError;
    if (bodyError || cleanupErrors.length > 0) {
      throw new AggregateError(
        [bodyError, ...cleanupErrors].filter(Boolean),
        bodyError
          ? 'WSL process identity launch regression failed and cleanup also failed.'
          : 'WSL process identity launch regression cleanup failed.',
        bodyError ? { cause: bodyError } : undefined,
      );
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(`\n❌ WSL process identity launch regression FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
}
