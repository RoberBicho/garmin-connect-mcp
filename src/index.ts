import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { GarminClient } from './client';
import {
  registerActivityTools,
  registerHealthTools,
  registerTrendTools,
  registerSleepTools,
  registerBodyTools,
  registerPerformanceTools,
  registerProfileTools,
  registerRangeTools,
  registerSnapshotTools,
  registerTrainingTools,
  registerWellnessTools,
  registerChallengeTools,
  registerWriteTools,
} from './tools';

const GARMIN_EMAIL = process.env.GARMIN_EMAIL;
const GARMIN_PASSWORD = process.env.GARMIN_PASSWORD;
const MCP_API_KEY = process.env.MCP_API_KEY;
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const USE_HTTP = process.env.USE_HTTP === 'true';

if (!GARMIN_EMAIL || !GARMIN_PASSWORD) {
  console.error('Error: GARMIN_EMAIL and GARMIN_PASSWORD environment variables are required.');
  process.exit(1);
}

function createServer(): McpServer {
  const server = new McpServer({
    name: 'garmin-connect-mcp',
    version: '1.0.0',
  });

  const client = new GarminClient(GARMIN_EMAIL!, GARMIN_PASSWORD!);

  registerActivityTools(server, client);
  registerHealthTools(server, client);
  registerTrendTools(server, client);
  registerSleepTools(server, client);
  registerBodyTools(server, client);
  registerPerformanceTools(server, client);
  registerProfileTools(server, client);
  registerRangeTools(server, client);
  registerSnapshotTools(server, client);
  registerTrainingTools(server, client);
  registerWellnessTools(server, client);
  registerChallengeTools(server, client);
  registerWriteTools(server, client);

  return server;
}

async function startHttp(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.use((req: Request, res: Response, next) => {
    if (!MCP_API_KEY) {
      next();
      return;
    }
    const key = req.headers['x-api-key'];
    if (key !== MCP_API_KEY) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  });

  const sessions = new Map<string, StreamableHTTPServerTransport>();

  app.post('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      const transport = sessions.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
      }
    };

    const server = createServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    if (transport.sessionId) {
      sessions.set(transport.sessionId, transport);
    }
  });

  app.get('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session ID' });
      return;
    }
    const transport = sessions.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session ID' });
      return;
    }
    const transport = sessions.get(sessionId)!;
    await transport.handleRequest(req, res);
    sessions.delete(sessionId);
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.listen(PORT, () => {
    console.error(`Garmin Connect MCP server running on HTTP port ${PORT}`);
  });
}

async function startStdio(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Garmin Connect MCP server running on stdio');
}

async function main(): Promise<void> {
  if (USE_HTTP) {
    await startHttp();
  } else {
    await startStdio();
  }
}

main().catch((error) => {
  console.error('Fatal error starting server:', error);
  process.exit(1);
});
