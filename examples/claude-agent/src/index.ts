#!/usr/bin/env node
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { createClaudeTools } from './tools.js';
import type { AgentCliOptions } from './types.js';

type ParsedArgValue = string | undefined;

const MODEL = 'claude-opus-5-5';

const SYSTEM_PROMPT = [
  'You are a boat-maintenance assistant for Boat Scrub Calendar.',
  'Use British English spelling and tone.',
  'For recommendations, call the tools and cite only the data they return.',
  'Never invent tide data. If data is unavailable, say so clearly and suggest checking the API configuration.',
  'Always include: the recommended scrub window, why it is suitable, your assumptions, and whether the data came from the live API or the demo fallback.',
].join(' ');

const parseArgs = (argv: string[]): AgentCliOptions => {
  const result: Record<string, ParsedArgValue> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      result[key] = 'true';
      continue;
    }
    result[key] = next;
    i += 1;
  }

  return {
    location: result.location,
    from: result.from,
    to: result.to,
    stationId: result.stationId,
    draft: result.draft ? Number(result.draft) : undefined,
    loa: result.loa ? Number(result.loa) : undefined,
    boatType: result.boatType,
    question: result.question,
  };
};

const buildPrompt = (options: AgentCliOptions): string => {
  const fallbackQuestion = 'When is the next good scrub window for my boat?';
  return [
    options.question || fallbackQuestion,
    '',
    'Context from CLI:',
    `- location: ${options.location || 'not provided'}`,
    `- from: ${options.from || 'not provided'}`,
    `- to: ${options.to || 'not provided'}`,
    `- stationId: ${options.stationId || 'not provided'}`,
    `- draft: ${Number.isFinite(options.draft) ? options.draft : 'not provided'}`,
    `- loa: ${Number.isFinite(options.loa) ? options.loa : 'not provided'}`,
    `- boatType: ${options.boatType || 'not provided'}`,
  ].join('\n');
};

const run = async () => {
  const options = parseArgs(process.argv.slice(2));
  const prompt = buildPrompt(options);

  // Credentials come from ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile.
  const client = new Anthropic();

  // The tool runner drives the request -> tool call -> result loop until Claude has no more tool calls.
  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    // Claude Opus 5.5 always thinks; effort is the control. `medium` is the model's default: set it
    // explicitly so a later default change does not alter the demo's cost or latency.
    output_config: { effort: 'medium' },
    // If a safety classifier declines the request, the API re-runs it on a fallback model in the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    tools: createClaudeTools(),
    messages: [{ role: 'user', content: prompt }],
    max_iterations: 12,
  });

  const finalMessage = await runner.runUntilDone();

  if (finalMessage.stop_reason === 'refusal') {
    const category = finalMessage.stop_details?.category ?? 'unspecified';
    console.error(`Claude declined this request (category: ${category}).`);
    process.exitCode = 1;
    return;
  }
  if (finalMessage.stop_reason === 'max_tokens') {
    console.error('Warning: the answer was cut off at max_tokens; increase it for longer summaries.');
  }

  const served = (finalMessage.usage.iterations ?? []).some((entry) => entry.type === 'fallback_message')
    ? ` (served by ${finalMessage.model} after a fallback)`
    : '';

  const answer = finalMessage.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  console.log(answer || 'No answer generated.');
  if (served) console.error(served.trim());
};

run().catch((error) => {
  if (error instanceof Anthropic.AuthenticationError) {
    console.error('Demo failed: no valid Anthropic credential. Set ANTHROPIC_API_KEY (see .env.example) or run `ant auth login`.');
  } else if (error instanceof Anthropic.RateLimitError) {
    console.error('Demo failed: rate limited by the Claude API. Wait a moment and try again.');
  } else if (error instanceof Anthropic.APIError) {
    console.error(`Demo failed: Claude API error ${error.status}: ${error.message}`);
  } else {
    console.error('Demo failed:', (error as Error).message);
  }
  process.exitCode = 1;
});
