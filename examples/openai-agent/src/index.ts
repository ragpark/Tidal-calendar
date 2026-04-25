#!/usr/bin/env node
import 'dotenv/config';
import OpenAI from 'openai';
import { createToolHandlers, OPENAI_TOOLS } from './tools.js';
import type { AgentCliOptions } from './types.js';

type ParsedArgValue = string | undefined;

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

const formatToolError = (error: unknown): { ok: false; error: string; source: 'live_api' } => ({
  ok: false,
  source: 'live_api',
  error: `Tool call failed: ${(error as Error).message}. Check BOATSCRUB_API_BASE_URL and BOATSCRUB_API_KEY.`,
});

const run = async () => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY. Add it to your environment or .env file.');
  }

  const options = parseArgs(process.argv.slice(2));
  const prompt = buildPrompt(options);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const handlers = createToolHandlers();

  const input: any[] = [
    {
      role: 'system',
      content: [
        {
          type: 'input_text',
          text: [
            'You are a boat-maintenance assistant for Boat Scrub Calendar.',
            'Use British English spelling and tone.',
            'For recommendations, call tools and cite only returned data.',
            'Never invent tide data. If data is unavailable, say so clearly and suggest checking API configuration.',
            'Always include: recommended scrub window, why suitable, assumptions, and whether data is live API or demo fallback.',
          ].join(' '),
        },
      ],
    },
    {
      role: 'user',
      content: [{ type: 'input_text', text: prompt }],
    },
  ];

  let response = await client.responses.create({
    model: 'gpt-4.1-mini',
    input,
    tools: OPENAI_TOOLS,
  });

  while (response.output.some((item) => item.type === 'function_call')) {
    const toolOutputs: any[] = [];

    for (const item of response.output) {
      if (item.type !== 'function_call') continue;

      const toolName = item.name as keyof ReturnType<typeof createToolHandlers>;
      const handler = handlers[toolName];
      if (!handler) {
        toolOutputs.push({
          type: 'function_call_output',
          call_id: item.call_id,
          output: JSON.stringify({ ok: false, error: `Unknown tool: ${toolName}` }),
        });
        continue;
      }

      try {
        const args = item.arguments ? JSON.parse(item.arguments) : {};
        const result = await handler(args);
        toolOutputs.push({
          type: 'function_call_output',
          call_id: item.call_id,
          output: JSON.stringify(result),
        });
      } catch (error) {
        toolOutputs.push({
          type: 'function_call_output',
          call_id: item.call_id,
          output: JSON.stringify(formatToolError(error)),
        });
      }
    }

    response = await client.responses.create({
      model: 'gpt-4.1-mini',
      previous_response_id: response.id,
      input: toolOutputs,
      tools: OPENAI_TOOLS,
    });
  }

  const answer = response.output_text?.trim() || 'No answer generated.';
  console.log(answer);
};

run().catch((error) => {
  console.error('Demo failed:', (error as Error).message);
  process.exitCode = 1;
});
