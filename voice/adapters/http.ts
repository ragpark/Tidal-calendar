import express from 'express';
import { randomUUID } from 'node:crypto';
import { McpClient } from '../services/mcpClient.js';
import { IntentHandlers } from '../intents/handlers.js';
import { handleAlexaRequest, verifyAlexaSignature } from './alexa.js';

export function buildApp() {
  const app = express();
  app.use('/alexa/webhook', express.text({ type: '*/*' }));
  app.use(express.json());
  const handlers = new IntentHandlers(new McpClient(process.env.MCP_BASE_URL ?? 'http://localhost:3001'));

  app.post('/voice/intent', async (req, res) => {
    const cid = randomUUID();
    console.log(JSON.stringify({ level: 'info', cid, sessionId: req.body?.sessionId, intent: req.body?.intentName }));
    res.json(await handlers.handleIntent(req.body));
  });

  app.post('/voice/confirm', async (req, res) => {
    const cid = randomUUID();
    console.log(JSON.stringify({ level: 'info', cid, sessionId: req.body?.sessionId, confirmation: req.body?.confirmation }));
    res.json(await handlers.handleConfirm(req.body));
  });

  app.post('/alexa/webhook', async (req, res) => {
    const valid = await verifyAlexaSignature(req.headers, req.body);
    if (!valid) return res.status(401).json({ message: 'Invalid Alexa signature' });
    const envelope = JSON.parse(req.body);
    const response = await handleAlexaRequest(handlers, envelope);
    return res.json(response);
  });

  return app;
}
