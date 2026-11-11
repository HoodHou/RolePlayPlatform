import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createEmptyWorld } from '@roleplay/shared';
import { AppError } from '../errors';
import { GeminiPainter } from '../images/gemini';
import { MockPainter } from '../images/mock';
import { OpenAIPainter } from '../images/openai';
import { AnthropicProvider } from './anthropic';
import { OpenAICompatProvider } from './openaiCompat';
import { OpenAIResponsesProvider } from './openaiResponses';
import type { ConversationInit, StepHandlers } from './types';

/**
 * The real providers, run against a local server that speaks each wire format.
 * No key or network needed; this pins the request shape we send and the
 * streaming responses we must understand.
 */

interface Recorded {
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}

/** Answers the nth request with the nth canned reply. */
async function fakeApi(replies: { status?: number; body: string }[]) {
  const requests: Recorded[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      requests.push({ url: req.url ?? '', headers: req.headers, body: JSON.parse(raw) });
      const reply = replies[requests.length - 1] ?? { status: 500, body: 'no reply scripted' };
      const status = reply.status ?? 200;
      res.writeHead(status, { 'Content-Type': status === 200 ? 'text/event-stream' : 'application/json' });
      res.end(reply.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, requests, close: () => server.close() };
}

function sse(events: { event?: string; data: unknown }[]): string {
  return events
    .map(({ event, data }) => {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      return `${event ? `event: ${event}\n` : ''}data: ${payload}\n\n`;
    })
    .join('');
}

const init: ConversationInit = {
  system: 'You are the game master.',
  history: [
    { role: 'user', text: '(The story begins.)' },
    { role: 'assistant', text: 'Rain falls.' },
  ],
  prompt: '<player_action>\nLook around\n</player_action>',
  tools: [
    {
      name: 'update_world',
      description: 'Set the title.',
      inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
    },
  ],
  meta: {
    locale: 'en',
    kind: 'action',
    turn: 2,
    playerText: 'Look around',
    seed: { premise: '', playerName: '', playerConcept: '' },
    world: createEmptyWorld(),
  },
};

function handlers(): StepHandlers & { deltas: string[]; toolInput: string[] } {
  const deltas: string[] = [];
  const toolInput: string[] = [];
  return {
    deltas,
    toolInput,
    onTextDelta: (delta) => void deltas.push(delta),
    onToolInput: (call, fragment) => void toolInput.push(`${call.id}/${call.name}:${fragment}`),
    onStepReset: () => void (deltas.length = toolInput.length = 0),
    signal: new AbortController().signal,
  };
}

function anthropicMessage(blocks: { start: object; deltas: object[] }[], stopReason: string): string {
  const typed = (data: { type: string }) => ({ event: data.type, data });
  return sse([
    typed({
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 4, cache_creation_input_tokens: 0 },
      },
    } as { type: string }),
    ...blocks.flatMap((block, index) => [
      typed({ type: 'content_block_start', index, content_block: block.start } as { type: string }),
      ...block.deltas.map((delta) => typed({ type: 'content_block_delta', index, delta } as { type: string })),
      typed({ type: 'content_block_stop', index } as { type: string }),
    ]),
    typed({
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 20 },
    } as { type: string }),
    typed({ type: 'message_stop' }),
  ]);
}

test('anthropic: streams text, collects tool calls, and sends results back in one message', async () => {
  const api = await fakeApi([
    {
      body: anthropicMessage(
        [
          {
            start: { type: 'text', text: '' },
            deltas: [
              { type: 'text_delta', text: 'The door ' },
              { type: 'text_delta', text: 'creaks.' },
            ],
          },
          {
            start: { type: 'tool_use', id: 'toolu_1', name: 'update_world', input: {} },
            deltas: [
              { type: 'input_json_delta', partial_json: '{"title":' },
              { type: 'input_json_delta', partial_json: '"Creak"}' },
            ],
          },
        ],
        'tool_use',
      ),
    },
    { body: anthropicMessage([{ start: { type: 'text', text: '' }, deltas: [{ type: 'text_delta', text: 'Done.' }] }], 'end_turn') },
  ]);
  try {
    const provider = new AnthropicProvider({
      apiKey: 'test-key',
      hasKey: true,
      baseUrl: api.url,
      model: 'claude-opus-5-5',
      effort: 'medium',
      maxOutputTokens: null,
    });
    const conversation = provider.startConversation(init);

    const h = handlers();
    const first = await conversation.step(h);
    assert.equal(first.text, 'The door creaks.');
    assert.deepEqual(h.deltas, ['The door ', 'creaks.']);
    assert.equal(first.stop, 'tool_use');
    assert.deepEqual(first.toolCalls, [{ id: 'toolu_1', name: 'update_world', input: { title: 'Creak' } }]);
    // Tool input is passed on as it streams, tagged with the call it belongs to.
    assert.deepEqual(h.toolInput, ['toolu_1/update_world:{"title":', 'toolu_1/update_world:"Creak"}']);
    assert.deepEqual(first.usage, { inputTokens: 14, outputTokens: 20, cachedInputTokens: 4 });

    const sent = api.requests[0]!.body;
    assert.equal(sent.model, 'claude-opus-5-5');
    assert.equal(sent.stream, true);
    assert.deepEqual(sent.output_config, { effort: 'medium' });
    assert.deepEqual(sent.system[0].cache_control, { type: 'ephemeral' });
    assert.equal(sent.tools[0].name, 'update_world');
    assert.equal(sent.messages.length, 3);
    // The last history entry carries the cache breakpoint; this turn's prompt comes after it.
    assert.deepEqual(sent.messages[1].content[0].cache_control, { type: 'ephemeral' });
    assert.equal(sent.messages[2].content, init.prompt);
    // A custom endpoint may be a proxy: no fields it might not know.
    assert.equal('fallbacks' in sent, false);
    assert.equal('eager_input_streaming' in sent.tools[0], false);

    conversation.submitToolResults([{ id: 'toolu_1', content: 'ok', isError: false }]);
    const second = await conversation.step(handlers());
    assert.equal(second.text, 'Done.');
    assert.equal(second.stop, 'end');

    const followUp = api.requests[1]!.body.messages;
    assert.equal(followUp[3].role, 'assistant');
    assert.equal(followUp[3].content[1].type, 'tool_use');
    assert.deepEqual(followUp[4], {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok', is_error: false }],
    });
  } finally {
    api.close();
  }
});

test('anthropic: a rejected key is reported as an auth failure', async () => {
  const api = await fakeApi([
    {
      status: 401,
      body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }),
    },
  ]);
  try {
    const provider = new AnthropicProvider({
      apiKey: 'bad',
      hasKey: true,
      baseUrl: api.url,
      model: 'claude-opus-5-5',
      effort: null,
      maxOutputTokens: 2000,
    });
    await assert.rejects(
      provider.startConversation(init).step(handlers()),
      (err: unknown) => err instanceof AppError && err.code === 'auth_failed',
    );
    // No effort chosen: nothing is sent, which also suits models that take no such setting.
    assert.equal('output_config' in api.requests[0]!.body, false);
    assert.equal(api.requests[0]!.body.max_tokens, 2000);
  } finally {
    api.close();
  }
});

test('openai: the Responses API carries the turn, its tool calls and the chosen effort', async () => {
  const event = (data: { type: string }) => ({ event: data.type, data });
  const functionCall = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'update_world', arguments: '{"title":"Creak"}' };
  const reasoning = { type: 'reasoning', id: 'rs_1', encrypted_content: 'opaque' };
  const api = await fakeApi([
    {
      body: sse([
        event({ type: 'response.output_item.added', item: { ...functionCall, arguments: '' } } as { type: string }),
        event({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"title":' } as { type: string }),
        event({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '"Creak"}' } as { type: string }),
        event({
          type: 'response.completed',
          response: {
            status: 'completed',
            output: [reasoning, functionCall],
            usage: { input_tokens: 40, output_tokens: 9, input_tokens_details: { cached_tokens: 30 } },
          },
        } as { type: string }),
      ]),
    },
    {
      body: sse([
        event({ type: 'response.output_text.delta', delta: 'Done.' } as { type: string }),
        event({ type: 'response.completed', response: { status: 'completed', output: [] } } as { type: string }),
      ]),
    },
  ]);
  try {
    const provider = new OpenAIResponsesProvider({
      apiKey: 'test-key',
      baseUrl: `${api.url}/v1`,
      model: 'gpt-6.1-sol',
      effort: 'low',
      maxOutputTokens: 4000,
    });
    const conversation = provider.startConversation(init);

    const h = handlers();
    const first = await conversation.step(h);
    assert.deepEqual(first.toolCalls, [{ id: 'call_1', name: 'update_world', input: { title: 'Creak' } }]);
    assert.deepEqual(h.toolInput, ['call_1/update_world:{"title":', 'call_1/update_world:"Creak"}']);
    assert.deepEqual(first.usage, { inputTokens: 40, outputTokens: 9, cachedInputTokens: 30 });

    const sent = api.requests[0]!;
    assert.equal(sent.url, '/v1/responses');
    assert.equal(sent.body.instructions, init.system);
    assert.deepEqual(sent.body.reasoning, { effort: 'low' });
    assert.equal(sent.body.max_output_tokens, 4000);
    // Nothing is kept on OpenAI's side; the turn carries its own history.
    assert.equal(sent.body.store, false);
    assert.deepEqual(sent.body.tools[0], {
      type: 'function',
      name: 'update_world',
      description: 'Set the title.',
      parameters: init.tools[0]!.inputSchema,
      strict: false,
    });

    conversation.submitToolResults([{ id: 'call_1', content: 'ok', isError: false }]);
    const second = await conversation.step(handlers());
    assert.equal(second.text, 'Done.');
    assert.equal(second.stop, 'end');
    // The model's own items, reasoning included, go back ahead of the answer to its call.
    assert.deepEqual(api.requests[1]!.body.input.slice(-3), [
      reasoning,
      functionCall,
      { type: 'function_call_output', call_id: 'call_1', output: 'ok' },
    ]);
  } finally {
    api.close();
  }
});

/** A custom endpoint with nothing optional switched on. */
const plainCompat = {
  kind: 'custom' as const,
  apiKey: null,
  baseUrl: '',
  model: 'some-model',
  effort: null,
  temperature: null,
  maxOutputTokens: null,
};

const chunk = (delta: object, finish: string | null = null) => ({
  data: { choices: [{ index: 0, delta, finish_reason: finish }] },
});

test('chat completions: thinking effort, temperature and length are sent only when chosen', async () => {
  const done = { body: sse([chunk({ content: 'Done.' }), chunk({}, 'stop'), { data: '[DONE]' }]) };
  const api = await fakeApi([done, done]);
  try {
    // Left alone, nothing optional goes out: many servers reject fields they do not know.
    await new OpenAICompatProvider({ ...plainCompat, baseUrl: api.url }).startConversation(init).step(handlers());
    const plain = api.requests[0]!.body;
    for (const field of ['reasoning_effort', 'temperature', 'max_tokens']) assert.equal(field in plain, false, field);

    await new OpenAICompatProvider({
      ...plainCompat,
      kind: 'gemini',
      baseUrl: api.url,
      effort: 'high',
      temperature: 0,
      maxOutputTokens: 3000,
    })
      .startConversation(init)
      .step(handlers());
    const tuned = api.requests[1]!.body;
    assert.equal(tuned.reasoning_effort, 'high');
    assert.equal(tuned.temperature, 0, 'a temperature of zero is a choice, not "unset"');
    assert.equal(tuned.max_tokens, 3000);
  } finally {
    api.close();
  }
});

test('chat completions: what a server attaches to a tool call is sent back with it', async () => {
  // Gemini signs its tool calls and refuses the next request if the signature is missing.
  const signature = { google: { thought_signature: 'c2lnbmVk' } };
  const api = await fakeApi([
    {
      body: sse([
        chunk({
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'update_world', arguments: '{"title":"Creak"}' }, extra_content: signature },
          ],
        }),
        chunk({}, 'tool_calls'),
        { data: '[DONE]' },
      ]),
    },
    { body: sse([chunk({ content: 'Done.' }), chunk({}, 'stop'), { data: '[DONE]' }]) },
  ]);
  try {
    const conversation = new OpenAICompatProvider({ ...plainCompat, kind: 'gemini', baseUrl: api.url }).startConversation(init);
    const first = await conversation.step(handlers());
    // No index on the call, as Gemini sends it: an id starts a new one.
    assert.deepEqual(first.toolCalls, [{ id: 'call_1', name: 'update_world', input: { title: 'Creak' } }]);

    conversation.submitToolResults([{ id: 'call_1', content: 'ok', isError: false }]);
    await conversation.step(handlers());
    assert.deepEqual(api.requests[1]!.body.messages[4].tool_calls[0].extra_content, signature);
  } finally {
    api.close();
  }
});

test('chat completions: an assistant turn goes back the way it came, whatever the server added to it', async () => {
  // Through a gateway each model family adds fields of its own, streamed in pieces like everything else.
  const api = await fakeApi([
    {
      body: sse([
        chunk({ role: 'assistant', reasoning_content: 'The lock is old. ' }),
        chunk({ reasoning_content: 'Roll for it.', provider_specific_fields: { thought_signatures: ['c2ln'] } }),
        // One block of reasoning in three pieces, told apart from the next block by its index.
        chunk({ reasoning_details: [{ type: 'reasoning.text', index: 0, text: 'The lock ' }] }),
        chunk({ reasoning_details: [{ type: 'reasoning.text', index: 0, text: 'is old.' }] }),
        chunk({ reasoning_details: [{ type: 'reasoning.text', index: 0, signature: 'U0lH' }, { type: 'reasoning.encrypted', index: 1, data: 'b3BhcXVl' }] }),
        chunk({
          tool_calls: [
            { index: 0, id: 'call_1', type: 'function', function: { name: 'roll_dice', arguments: '{"notation":' }, caller: { type: 'direct' } },
          ],
        }),
        chunk({
          tool_calls: [{ index: 0, function: { arguments: '"d20"}' }, provider_specific_fields: { thought_signature: 'bmVk' } }],
          provider_specific_fields: { thought_signatures: ['bmVk'] },
        }),
        chunk({ refusal: null }, 'tool_calls'),
        { data: '[DONE]' },
      ]),
    },
    { body: sse([chunk({ content: 'Done.' }), chunk({}, 'stop'), { data: '[DONE]' }]) },
  ]);
  try {
    const conversation = new OpenAICompatProvider({ ...plainCompat, baseUrl: api.url }).startConversation(init);
    const first = await conversation.step(handlers());
    // None of it reaches the engine.
    assert.deepEqual(first.toolCalls, [{ id: 'call_1', name: 'roll_dice', input: { notation: 'd20' } }]);

    conversation.submitToolResults([{ id: 'call_1', content: '{"total":17}', isError: false }]);
    await conversation.step(handlers());
    assert.deepEqual(api.requests[1]!.body.messages[4], {
      role: 'assistant',
      content: null,
      // Text is joined, lists run on, and nothing the server left empty is invented.
      reasoning_content: 'The lock is old. Roll for it.',
      provider_specific_fields: { thought_signatures: ['c2ln', 'bmVk'] },
      reasoning_details: [
        { type: 'reasoning.text', index: 0, text: 'The lock is old.', signature: 'U0lH' },
        { type: 'reasoning.encrypted', index: 1, data: 'b3BhcXVl' },
      ],
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'roll_dice', arguments: '{"notation":"d20"}' },
          caller: { type: 'direct' },
          provider_specific_fields: { thought_signature: 'bmVk' },
        },
      ],
    });
  } finally {
    api.close();
  }
});

test('chat completions: a custom API with no address or no model is a configuration error', () => {
  for (const missing of [{ baseUrl: '' }, { baseUrl: 'https://gateway.example/v1', model: '' }]) {
    assert.throws(
      () => new OpenAICompatProvider({ ...plainCompat, ...missing }),
      (err: unknown) => err instanceof AppError && err.code === 'not_configured',
    );
  }
});

test('chat completions: assembles streamed tool calls and replays them with their results', async () => {
  const api = await fakeApi([
    {
      body: sse([
        chunk({ role: 'assistant', content: 'The door ' }),
        chunk({ content: 'creaks.' }),
        chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'update_world', arguments: '' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '{"title":' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '"Creak"}' } }] }),
        chunk({}, 'tool_calls'),
        { data: { choices: [], usage: { prompt_tokens: 30, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 8 } } } },
        { data: '[DONE]' },
      ]),
    },
    { body: sse([chunk({ content: 'Done.' }), chunk({}, 'stop'), { data: '[DONE]' }]) },
  ]);
  try {
    const provider = new OpenAICompatProvider({ ...plainCompat, apiKey: 'test-key', baseUrl: `${api.url}/v1/` });
    const conversation = provider.startConversation(init);

    const h = handlers();
    const first = await conversation.step(h);
    assert.equal(first.text, 'The door creaks.');
    assert.deepEqual(h.deltas, ['The door ', 'creaks.']);
    assert.equal(first.stop, 'tool_use');
    assert.deepEqual(first.toolCalls, [{ id: 'call_1', name: 'update_world', input: { title: 'Creak' } }]);
    assert.deepEqual(h.toolInput, ['call_1/update_world:{"title":', 'call_1/update_world:"Creak"}']);
    assert.deepEqual(first.usage, { inputTokens: 30, outputTokens: 12, cachedInputTokens: 8 });

    const request = api.requests[0]!;
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.headers.authorization, 'Bearer test-key');
    assert.equal(request.body.model, 'some-model');
    assert.deepEqual(request.body.messages.map((m: { role: string }) => m.role), ['system', 'user', 'assistant', 'user']);
    assert.deepEqual(request.body.tools[0], {
      type: 'function',
      function: { name: 'update_world', description: 'Set the title.', parameters: init.tools[0]!.inputSchema },
    });

    conversation.submitToolResults([{ id: 'call_1', content: 'ok', isError: false }]);
    const second = await conversation.step(handlers());
    assert.equal(second.text, 'Done.');
    assert.equal(second.stop, 'end');

    const followUp = api.requests[1]!.body.messages;
    assert.deepEqual(followUp[4].tool_calls, [
      { id: 'call_1', type: 'function', function: { name: 'update_world', arguments: '{"title":"Creak"}' } },
    ]);
    assert.deepEqual(followUp[5], { role: 'tool', tool_call_id: 'call_1', content: 'ok' });
  } finally {
    api.close();
  }
});

test('chat completions: malformed tool arguments are passed on for validation, and errors are mapped', async () => {
  const api = await fakeApi([
    {
      body: sse([
        chunk({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'update_world', arguments: '{"title": oops' } }] }),
        chunk({}, 'tool_calls'),
        { data: '[DONE]' },
      ]),
    },
    { status: 429, body: '{"error":{"message":"slow down"}}' },
  ]);
  try {
    const provider = new OpenAICompatProvider({ ...plainCompat, baseUrl: api.url });
    const conversation = provider.startConversation(init);

    const first = await conversation.step(handlers());
    assert.deepEqual(first.toolCalls[0]?.input, { INVALID_JSON: '{"title": oops' });
    assert.equal(api.requests[0]!.headers.authorization, undefined);

    conversation.submitToolResults([{ id: 'call_1', content: 'bad', isError: true }]);
    await assert.rejects(
      conversation.step(handlers()),
      (err: unknown) => err instanceof AppError && err.code === 'rate_limited',
    );
  } finally {
    api.close();
  }
});

test('images: asks for a shape that fits the subject and decodes the picture', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const api = await fakeApi([
    { body: JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }) },
    { status: 400, body: JSON.stringify({ error: { code: 'moderation_blocked', message: 'blocked' } }) },
  ]);
  try {
    const painter = new OpenAIPainter({ apiKey: 'test-key', baseUrl: `${api.url}/v1`, model: 'gpt-image-2.5-flare', quality: 'low' });
    const signal = new AbortController().signal;

    const painting = await painter.paint({ prompt: 'A thin man in torn livery', subject: 'character', signal });
    assert.deepEqual(painting, { data: png, extension: 'png' });

    const request = api.requests[0]!;
    assert.equal(request.url, '/v1/images/generations');
    assert.equal(request.headers.authorization, 'Bearer test-key');
    assert.deepEqual(request.body, {
      model: 'gpt-image-2.5-flare',
      prompt: 'A thin man in torn livery',
      n: 1,
      size: '1024x1536',
      quality: 'low',
      output_format: 'webp',
      output_compression: 85,
    });

    // A picture turned down on content grounds is a refusal, not a broken provider.
    await assert.rejects(
      painter.paint({ prompt: 'Something grim', subject: 'scene', signal }),
      (err: unknown) => err instanceof AppError && err.code === 'refused',
    );
    assert.equal(api.requests[1]!.body.size, '1536x1024');
  } finally {
    api.close();
  }
});

test('images: models outside the GPT image family get the one size everything accepts', async () => {
  const api = await fakeApi([{ body: JSON.stringify({ data: [{ b64_json: 'AAAA' }] }) }]);
  try {
    const painter = new OpenAIPainter({ apiKey: null, baseUrl: api.url, model: 'some-diffusion-model', quality: 'high' });
    await painter.paint({ prompt: 'A lantern', subject: 'item', signal: new AbortController().signal });
    assert.deepEqual(api.requests[0]!.body, { model: 'some-diffusion-model', prompt: 'A lantern', n: 1, size: '1024x1024' });
  } finally {
    api.close();
  }
});

test('gemini images: calls generateContent with aspect ratio, resolution, and safety handling', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7]);
  const api = await fakeApi([
    {
      body: JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }],
      }),
    },
    {
      body: JSON.stringify({
        candidates: [{ finishReason: 'IMAGE_SAFETY', finishMessage: 'Blocked by safety settings.' }],
      }),
    },
    {
      status: 400,
      body: JSON.stringify({ error: { code: 400, message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] } }),
    },
  ]);
  try {
    const painter = new GeminiPainter({
      apiKey: 'g-key',
      baseUrl: `${api.url}/v1beta/openai/`,
      model: 'models/gemini-3.1-flash-image',
      quality: 'medium',
    });
    const signal = new AbortController().signal;

    const painting = await painter.paint({ prompt: 'Rain over a mountain gate', subject: 'scene', signal });
    assert.deepEqual(painting, { data: png, extension: 'png' });

    const request = api.requests[0]!;
    assert.equal(request.url, '/v1beta/models/gemini-3.1-flash-image:generateContent');
    assert.equal(request.headers['x-goog-api-key'], 'g-key');
    assert.equal(request.headers.authorization, undefined);
    assert.deepEqual(request.body, {
      contents: [{ parts: [{ text: 'Rain over a mountain gate' }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: '3:2', imageSize: '2K' },
      },
    });

    await assert.rejects(
      painter.paint({ prompt: 'Forbidden', subject: 'character', signal }),
      (err: unknown) => err instanceof AppError && err.code === 'refused',
    );
    assert.deepEqual(api.requests[1]!.body.generationConfig.imageConfig, { aspectRatio: '2:3', imageSize: '2K' });

    await assert.rejects(
      painter.paint({ prompt: 'A coin', subject: 'item', signal }),
      (err: unknown) => err instanceof AppError && err.code === 'auth_failed',
    );
  } finally {
    api.close();
  }
});

test('gemini images: omits explicit imageSize on Gemini 2.5 image models', async () => {
  const api = await fakeApi([
    { body: JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: 'AAAA' } }] } }] }) },
  ]);
  try {
    const painter = new GeminiPainter({
      apiKey: 'g-key',
      baseUrl: `${api.url}/v1beta`,
      model: 'gemini-2.5-flash-image',
      quality: 'high',
    });
    await painter.paint({ prompt: 'A brass compass', subject: 'item', signal: new AbortController().signal });
    assert.deepEqual(api.requests[0]!.body.generationConfig, {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: '1:1' },
    });
  } finally {
    api.close();
  }
});

test('the placeholder painter draws a valid picture of the right shape, for free', async () => {
  const painting = await new MockPainter({ delayMs: 0 }).paint({
    prompt: 'A portrait',
    subject: 'character',
    signal: new AbortController().signal,
  });
  assert.equal(painting.extension, 'svg');
  assert.match(painting.data.toString('utf8'), /^<svg [^>]*viewBox="0 0 1024 1536"/);
});

test('anthropic: keeps a stable quantized history cache breakpoint alongside the moving tail within 4 blocks', async () => {
  const okReply = () => ({
    body: anthropicMessage([{ start: { type: 'text', text: '' }, deltas: [{ type: 'text_delta', text: 'Ok.' }] }], 'end_turn'),
  });
  const api = await fakeApi([okReply(), okReply()]);
  try {
    const provider = new AnthropicProvider({
      apiKey: 'test-key',
      hasKey: true,
      baseUrl: api.url,
      model: 'claude-opus-5-5',
      effort: null,
      maxOutputTokens: null,
    });

    const eightHistory: ConversationInit['history'] = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      text: `msg-${i}`,
    }));
    await provider.startConversation({ ...init, history: eightHistory }).step(handlers());

    const tenHistory: ConversationInit['history'] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      text: `msg-${i}`,
    }));
    await provider.startConversation({ ...init, history: tenHistory }).step(handlers());

    const countCacheBlocks = (body: any): { total: number; msgIndices: number[] } => {
      let total = 0;
      const msgIndices: number[] = [];
      for (const s of body.system ?? []) if (s.cache_control) total++;
      for (const t of body.tools ?? []) if (t.cache_control) total++;
      (body.messages ?? []).forEach((m: any, idx: number) => {
        if (Array.isArray(m.content) && m.content.some((b: any) => b.cache_control)) {
          total++;
          msgIndices.push(idx);
        }
      });
      return { total, msgIndices };
    };

    const first = countCacheBlocks(api.requests[0]!.body);
    const second = countCacheBlocks(api.requests[1]!.body);
    assert.ok(first.total <= 4, `expected <= 4 cache breakpoints, got ${first.total}`);
    assert.ok(second.total <= 4, `expected <= 4 cache breakpoints, got ${second.total}`);
    assert.deepEqual(first.msgIndices, [5, 7]);
    assert.deepEqual(second.msgIndices, [5, 9]);
  } finally {
    api.close();
  }
});

test('anthropic: enables context-1m-2025-08-07 beta on 1M-capable Claude models and omits it on 200K models', async () => {
  const okReply = () => ({
    body: anthropicMessage([{ start: { type: 'text', text: '' }, deltas: [{ type: 'text_delta', text: 'Ok.' }] }], 'end_turn'),
  });
  const api = await fakeApi([okReply(), okReply(), okReply()]);
  try {
    const sonnetLong = new AnthropicProvider({
      apiKey: 'test-key',
      hasKey: true,
      baseUrl: api.url,
      model: 'claude-sonnet-4-6',
      effort: null,
      maxOutputTokens: null,
      longContext: true,
    });
    await sonnetLong.startConversation(init).step(handlers());

    const opusAutoThreshold = new AnthropicProvider({
      apiKey: 'test-key',
      hasKey: true,
      baseUrl: api.url,
      model: 'claude-opus-5-5',
      effort: null,
      maxOutputTokens: null,
    });
    await opusAutoThreshold
      .startConversation({ ...init, prompt: '长篇史料'.repeat(130_000) })
      .step(handlers());

    const haikuLong = new AnthropicProvider({
      apiKey: 'test-key',
      hasKey: true,
      baseUrl: api.url,
      model: 'claude-haiku-4-5',
      effort: null,
      maxOutputTokens: null,
      longContext: true,
    });
    await haikuLong.startConversation(init).step(handlers());

    const beta0 = String(api.requests[0]!.headers['anthropic-beta'] ?? '');
    const beta1 = String(api.requests[1]!.headers['anthropic-beta'] ?? '');
    const beta2 = String(api.requests[2]!.headers['anthropic-beta'] ?? '');

    assert.ok(beta0.includes('context-1m-2025-08-07'), `expected 1M beta on claude-sonnet-4-6, got "${beta0}"`);
    assert.ok(beta1.includes('context-1m-2025-08-07'), `expected auto 1M beta above 500k chars on claude-opus-5-5, got "${beta1}"`);
    assert.ok(!beta2.includes('context-1m-2025-08-07'), `expected no 1M beta on claude-haiku-4-5, got "${beta2}"`);
  } finally {
    api.close();
  }
});
