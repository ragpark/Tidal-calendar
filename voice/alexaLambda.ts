import { IntentHandlers } from './intents/handlers.js';
import { handleAlexaRequest, verifyAlexaSignature, type AlexaEnvelope } from './adapters/alexa.js';
import { McpClient } from './services/mcpClient.js';

type LambdaEvent = {
  headers?: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
};

type LambdaResponse = {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
};

const handlers = new IntentHandlers(new McpClient(process.env.MCP_BASE_URL ?? 'http://localhost:3001'));

export async function handler(event: LambdaEvent): Promise<LambdaResponse> {
  const rawBody = decodeBody(event.body, event.isBase64Encoded);
  if (!rawBody) return jsonResponse(400, { message: 'Missing request body' });

  const normalizedHeaders = normalizeHeaders(event.headers);
  const isValid = await verifyAlexaSignature(normalizedHeaders, rawBody);
  if (!isValid) return jsonResponse(401, { message: 'Invalid Alexa signature' });

  let envelope: AlexaEnvelope;
  try {
    envelope = JSON.parse(rawBody) as AlexaEnvelope;
  } catch {
    return jsonResponse(400, { message: 'Invalid JSON body' });
  }

  const responseBody = await handleAlexaRequest(handlers, envelope);
  return jsonResponse(200, responseBody);
}

function decodeBody(body: string | null | undefined, isBase64Encoded: boolean | undefined): string {
  if (!body) return '';
  if (isBase64Encoded) return Buffer.from(body, 'base64').toString('utf8');
  return body;
}

function normalizeHeaders(headers: Record<string, string | undefined> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), value ?? ''])
  );
}

function jsonResponse(statusCode: number, payload: unknown): LambdaResponse {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  };
}
