import { startStdioTransport } from './protocol';
import { createMikanVaultMcpServer } from './server';

// Protect MCP stdio framing: never allow accidental console.log output to corrupt stdout JSON-RPC frames
console.log = (...args: unknown[]) => {
  console.error(...args);
};

const server = createMikanVaultMcpServer();
startStdioTransport(server);
