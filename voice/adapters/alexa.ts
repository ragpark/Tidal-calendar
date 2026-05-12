import { createVerify } from 'node:crypto';
import { X509Certificate } from 'node:crypto';
import { IntentHandlers } from '../intents/handlers.js';

export type AlexaEnvelope = {
  version: string;
  session?: { sessionId: string };
  request: {
    type: string;
    requestId: string;
    timestamp: string;
    intent?: { name: string; slots?: Record<string, { name: string; value?: string }> };
  };
};

export async function verifyAlexaSignature(headers: Record<string, string | string[] | undefined>, rawBody: string): Promise<boolean> {
  if (process.env.ALEXA_SKIP_SIGNATURE_VERIFY === 'true') return true;
  const certUrl = String(headers['signaturecertchainurl'] ?? '');
  const signatureB64 = String(headers.signature ?? '');
  if (!certUrl.startsWith('https://s3.amazonaws.com/echo.api/')) return false;
  if (!signatureB64) return false;

  const certPem = await fetch(certUrl).then((r) => r.text());
  const cert = new X509Certificate(certPem);
  const san = cert.subjectAltName ?? '';
  if (!san.includes('echo-api.amazon.com')) return false;

  const verifier = createVerify('RSA-SHA1');
  verifier.update(rawBody);
  verifier.end();
  return verifier.verify(certPem, Buffer.from(signatureB64, 'base64'));
}

export function mapAlexaToVoiceIntent(body: AlexaEnvelope) {
  const slots = Object.fromEntries(Object.entries(body.request.intent?.slots ?? {}).map(([k, v]) => [k, v.value]));
  const intentName = body.request.intent?.name ?? 'FallbackIntent';
  return {
    sessionId: body.session?.sessionId ?? body.request.requestId,
    intentName,
    slots,
    rawUtterance: ''
  };
}

export function mapVoiceToAlexaResponse(speechText: string, repromptText?: string, endSession = false) {
  return {
    version: '1.0',
    response: {
      outputSpeech: { type: 'SSML', ssml: `<speak>${escapeSsml(speechText)}</speak>` },
      reprompt: repromptText ? { outputSpeech: { type: 'SSML', ssml: `<speak>${escapeSsml(repromptText)}</speak>` } } : undefined,
      shouldEndSession: endSession
    }
  };
}

export async function handleAlexaRequest(handlers: IntentHandlers, body: AlexaEnvelope) {
  if (body.request.type === 'LaunchRequest') {
    return mapVoiceToAlexaResponse('Welcome. Ask for a tide summary or scrub slots.', 'Try saying: tide summary for Seattle today.');
  }
  if (body.request.type === 'SessionEndedRequest') return mapVoiceToAlexaResponse('Goodbye.', undefined, true);
  if (body.request.type === 'IntentRequest') {
    const intent = mapAlexaToVoiceIntent(body);
    if (intent.intentName === 'AMAZON.YesIntent' || intent.intentName === 'AMAZON.NoIntent') {
      const confirm = intent.intentName === 'AMAZON.YesIntent' ? 'yes' : 'no';
      const out = await handlers.handleConfirm({ sessionId: intent.sessionId, confirmation: confirm });
      return mapVoiceToAlexaResponse(out.speechText, out.repromptText, out.endSession);
    }
    const out = await handlers.handleIntent(intent as any);
    return mapVoiceToAlexaResponse(out.speechText, out.repromptText, out.endSession);
  }
  return mapVoiceToAlexaResponse('Sorry, I could not process that request.');
}

function escapeSsml(text: string) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
