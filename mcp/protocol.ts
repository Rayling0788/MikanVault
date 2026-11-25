export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpContentItem {
  type: 'text';
  text: string;
}

export interface McpToolCallResult {
  content: McpContentItem[];
  isError?: boolean;
}

export interface McpResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface McpResourceReadResult {
  contents: Array<{
    uri: string;
    mimeType: string;
    text: string;
  }>;
}

export interface McpPromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

export interface McpPromptDefinition {
  name: string;
  description: string;
  arguments?: McpPromptArgument[];
}

export interface McpPromptGetResult {
  description?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: McpContentItem;
  }>;
}

export interface McpServerConfig {
  name: string;
  version: string;
  instructions?: string;
  tools: Array<{
    definition: McpToolDefinition;
    handler: (args: Record<string, unknown>) => Promise<McpToolCallResult | unknown>;
  }>;
  resources: Array<{
    definition: McpResourceDefinition;
    reader: () => Promise<string>;
  }>;
  prompts: Array<{
    definition: McpPromptDefinition;
    render: (args: Record<string, string>) => Promise<McpPromptGetResult>;
  }>;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-03-26', '2024-11-05'] as const;

function isToolResult(val: unknown): val is McpToolCallResult {
  return (
    Boolean(val) &&
    typeof val === 'object' &&
    Array.isArray((val as McpToolCallResult).content)
  );
}

export function formatToolJson(data: unknown, isError = false): McpToolCallResult {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

export function createMcpServer(config: McpServerConfig) {
  const toolMap = new Map(config.tools.map((t) => [t.definition.name, t]));
  const resourceMap = new Map(config.resources.map((r) => [r.definition.uri, r]));
  const promptMap = new Map(config.prompts.map((p) => [p.definition.name, p]));

  async function handleJsonRpcMessage(raw: unknown): Promise<JsonRpcResponse | null> {
    if (!raw || typeof raw !== 'object') {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request' },
      };
    }

    const req = raw as Partial<JsonRpcRequest>;
    const hasId = req.id !== undefined && req.id !== null;
    const id = hasId ? (req.id as string | number) : null;

    if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      if (!hasId) return null;
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid JSON-RPC 2.0 request' },
      };
    }

    // Notifications require no response
    if (!hasId && req.method.startsWith('notifications/')) {
      return null;
    }

    const params =
      req.params && typeof req.params === 'object'
        ? (req.params as Record<string, unknown>)
        : {};

    try {
      switch (req.method) {
        case 'initialize': {
          const clientVersion =
            typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
          const negotiated = SUPPORTED_PROTOCOL_VERSIONS.includes(
            clientVersion as (typeof SUPPORTED_PROTOCOL_VERSIONS)[number],
          )
            ? clientVersion
            : SUPPORTED_PROTOCOL_VERSIONS[1];

          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: negotiated,
              capabilities: {
                tools: { listChanged: false },
                resources: { subscribe: false, listChanged: false },
                prompts: { listChanged: false },
              },
              serverInfo: {
                name: config.name,
                version: config.version,
              },
              ...(config.instructions ? { instructions: config.instructions } : {}),
            },
          };
        }

        case 'ping':
          return { jsonrpc: '2.0', id, result: {} };

        case 'tools/list':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              tools: config.tools.map((t) => t.definition),
            },
          };

        case 'tools/call': {
          const name = typeof params.name === 'string' ? params.name : '';
          const tool = toolMap.get(name);
          if (!tool) {
            return {
              jsonrpc: '2.0',
              id,
              error: { code: -32602, message: `Unknown tool: ${name}` },
            };
          }
          const args =
            params.arguments && typeof params.arguments === 'object'
              ? (params.arguments as Record<string, unknown>)
              : {};
          try {
            const output = await tool.handler(args);
            const result = isToolResult(output) ? output : formatToolJson(output);
            return { jsonrpc: '2.0', id, result };
          } catch (toolErr) {
            return {
              jsonrpc: '2.0',
              id,
              result: formatToolJson(
                {
                  ok: false,
                  error: toolErr instanceof Error ? toolErr.message : String(toolErr),
                },
                true,
              ),
            };
          }
        }

        case 'resources/list':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              resources: config.resources.map((r) => r.definition),
            },
          };

        case 'resources/read': {
          const uri = typeof params.uri === 'string' ? params.uri : '';
          const resource = resourceMap.get(uri);
          if (!resource) {
            return {
              jsonrpc: '2.0',
              id,
              error: { code: -32602, message: `Unknown resource URI: ${uri}` },
            };
          }
          const text = await resource.reader();
          const result: McpResourceReadResult = {
            contents: [
              {
                uri,
                mimeType: resource.definition.mimeType,
                text,
              },
            ],
          };
          return { jsonrpc: '2.0', id, result };
        }

        case 'prompts/list':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              prompts: config.prompts.map((p) => p.definition),
            },
          };

        case 'prompts/get': {
          const name = typeof params.name === 'string' ? params.name : '';
          const prompt = promptMap.get(name);
          if (!prompt) {
            return {
              jsonrpc: '2.0',
              id,
              error: { code: -32602, message: `Unknown prompt: ${name}` },
            };
          }
          const rawArgs =
            params.arguments && typeof params.arguments === 'object'
              ? (params.arguments as Record<string, unknown>)
              : {};
          const stringArgs: Record<string, string> = {};
          for (const [k, v] of Object.entries(rawArgs)) {
            if (typeof v === 'string') stringArgs[k] = v;
            else if (v !== undefined && v !== null) stringArgs[k] = String(v);
          }
          const result = await prompt.render(stringArgs);
          return { jsonrpc: '2.0', id, result };
        }

        default:
          if (!hasId) return null;
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${req.method}` },
          };
      }
    } catch (err) {
      if (!hasId) return null;
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : 'Internal error',
        },
      };
    }
  }

  return {
    name: config.name,
    version: config.version,
    handleJsonRpcMessage,
  };
}

export function startStdioTransport(server: ReturnType<typeof createMcpServer>): void {
  let buffer = '';
  process.stdin.setEncoding('utf-8');

  const processLine = async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      const parseErr: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      };
      process.stdout.write(`${JSON.stringify(parseErr)}\n`);
      return;
    }

    if (Array.isArray(parsed)) {
      const responses: JsonRpcResponse[] = [];
      for (const item of parsed) {
        const res = await server.handleJsonRpcMessage(item);
        if (res) responses.push(res);
      }
      if (responses.length > 0) {
        process.stdout.write(`${JSON.stringify(responses)}\n`);
      }
      return;
    }

    const response = await server.handleJsonRpcMessage(parsed);
    if (response) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  };

  let chain: Promise<void> = Promise.resolve();
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      chain = chain
        .then(() => processLine(line))
        .catch((err) => {
          process.stderr.write(
            `[mikanvault-mcp] Error processing line: ${
              err instanceof Error ? err.stack || err.message : String(err)
            }\n`,
          );
        });
    }
  });

  process.stdin.on('end', () => {
    if (buffer.trim()) {
      const tail = buffer;
      buffer = '';
      chain = chain.then(() => processLine(tail));
    }
  });
}
