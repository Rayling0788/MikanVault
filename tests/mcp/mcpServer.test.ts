import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setDataDirForTesting, updateSettings } from '../../electron/services/configStore';
import { enqueueCloudTransferJob } from '../../electron/services/cloudService';
import { createMikanVaultMcpServer } from '../../mcp/server';

describe('MikanVault MCP Server', () => {
  let tmpDir: string;
  let localRoot: string;
  let cloudRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikanvault-mcp-test-'));
    localRoot = path.join(tmpDir, 'LocalAnime');
    cloudRoot = path.join(tmpDir, 'GoogleDrive', 'MikanVault');
    fs.mkdirSync(localRoot, { recursive: true });
    fs.mkdirSync(cloudRoot, { recursive: true });
    setDataDirForTesting(path.join(tmpDir, 'app-data'));
    updateSettings({
      downloadRootDir: localRoot,
      googleDriveEnabled: true,
      googleDriveDir: cloudRoot,
      googleDriveAutoDeleteLocal: true,
      googleDriveIncludeInLibrary: true,
      qbPassword: 'super-secret-password',
    });
  });

  afterEach(() => {
    setDataDirForTesting(null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles initialize, ping, tools/list, resources, and prompts', async () => {
    const server = createMikanVaultMcpServer();

    const initRes = await server.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
    });
    expect(initRes?.error).toBeUndefined();
    expect((initRes?.result as { protocolVersion: string }).protocolVersion).toBe('2025-03-26');

    const pingRes = await server.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'ping',
    });
    expect(pingRes?.result).toEqual({});

    const toolsRes = await server.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
    });
    const tools = (toolsRes?.result as { tools: Array<{ name: string }> }).tools;
    expect(tools).toHaveLength(16);
    expect(tools.map((t) => t.name)).toContain('cloud_upload_library');
    expect(tools.map((t) => t.name)).toContain('cloud_cancel_job');

    const listResourcesRes = await server.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'resources/list',
    });
    const resources = (listResourcesRes?.result as { resources: Array<{ uri: string }> }).resources;
    expect(resources).toHaveLength(6);

    const readSettingsRes = await server.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 5,
      method: 'resources/read',
      params: { uri: 'mikanvault://settings' },
    });
    const settingsText = (
      readSettingsRes?.result as { contents: Array<{ text: string }> }
    ).contents[0].text;
    expect(settingsText).not.toContain('super-secret-password');
    expect(settingsText).toContain('"qbPassword": "***"');

    const promptRes = await server.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 6,
      method: 'prompts/get',
      params: { name: 'offload_local_library_to_cloud', arguments: { title: '芙莉莲', delete_local: 'true' } },
    });
    expect(
      (promptRes?.result as { messages: Array<{ content: { text: string } }> }).messages[0].content
        .text,
    ).toContain('cloud_upload_library');
  });

  it('scans local library, uploads via fuzzy seriesTitle with deleteLocal, and cancels queued cloud jobs', async () => {
    const server = createMikanVaultMcpServer();
    const seriesDir = path.join(localRoot, '葬送的芙莉莲');
    const ep1 = path.join(seriesDir, '[LoliHouse] Frieren - 01.mkv');
    fs.mkdirSync(seriesDir, { recursive: true });
    fs.writeFileSync(ep1, 'frieren-mcp-payload');

    const scanRes = await server.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'library_scan', arguments: { onlyLocal: true, query: '芙莉莲' } },
    });
    const scanText = (scanRes?.result as { content: Array<{ text: string }> }).content[0].text;
    const scanData = JSON.parse(scanText);
    expect(scanData.totalSeries).toBe(1);

    const uploadRes = await server.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'cloud_upload_library',
        arguments: { seriesTitle: '芙莉莲', deleteLocal: true },
      },
    });
    const uploadText = (uploadRes?.result as { content: Array<{ text: string }> }).content[0].text;
    const uploadData = JSON.parse(uploadText);
    expect(uploadData.ok).toBe(true);
    expect(uploadData.deletedLocal).toBe(true);
    expect(fs.existsSync(ep1)).toBe(false);
    expect(fs.existsSync(path.join(cloudRoot, '葬送的芙莉莲', '[LoliHouse] Frieren - 01.mkv'))).toBe(
      true,
    );

    const queued = enqueueCloudTransferJob({
      torrentHash: '1234567890abcdef1234567890abcdef12345678',
      torrentName: 'queued-job.mkv',
      localSavePath: localRoot,
      cloudTargetDir: path.join(cloudRoot, 'Test'),
    });

    const cancelRes = await server.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: { name: 'cloud_cancel_job', arguments: { jobId: queued.id } },
    });
    const cancelData = JSON.parse(
      (cancelRes?.result as { content: Array<{ text: string }> }).content[0].text,
    );
    expect(cancelData.ok).toBe(true);
  });
});
