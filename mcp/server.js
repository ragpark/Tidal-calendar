import 'dotenv/config';

const BASE_URL = process.env.TIDAL_API_BASE_URL || 'http://localhost:3000';
const SESSION_COOKIE_NAME = 'tc_session';

const tools = [
  {
    name: 'list_stations',
    description: 'List tidal stations from the Admiralty API via the server proxy.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional search filter forwarded to Admiralty API.' },
      },
      required: [],
    },
  },
  {
    name: 'get_station',
    description: 'Fetch station details by ID using the Admiralty proxy.',
    inputSchema: {
      type: 'object',
      properties: {
        station_id: { type: 'string', description: 'Admiralty station ID (e.g., 0240).' },
      },
      required: ['station_id'],
    },
  },
  {
    name: 'list_clubs',
    description: 'List all clubs and their scrub windows.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_profile',
    description: 'Get the authenticated user profile.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'update_profile',
    description: 'Update home port/club and maintenance reminder settings.',
    inputSchema: {
      type: 'object',
      properties: {
        homePortId: { type: 'string' },
        homePortName: { type: 'string' },
        homeClubId: { type: 'string' },
        homeClubName: { type: 'string' },
        maintenanceRemindersEnabled: { type: 'boolean' },
      },
      required: [],
    },
  },
  {
    name: 'create_club',
    description: 'Create a new club (requires club_admin role).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        capacity: { type: 'number' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_scrub_window',
    description: 'Create a new scrub window for a club.',
    inputSchema: {
      type: 'object',
      properties: {
        club_id: { type: 'string' },
        date: { type: 'string', description: 'Human-readable date label (e.g., Thu 18 Sep).' },
        lowWater: { type: 'string', description: 'Low water time (e.g., 11:42).' },
        duration: { type: 'string', description: 'Duration (e.g., 2h 20m).' },
        capacity: { type: 'number' },
      },
      required: ['club_id', 'date', 'lowWater', 'duration'],
    },
  },
  {
    name: 'book_scrub_window',
    description: 'Book a scrub window for the current user.',
    inputSchema: {
      type: 'object',
      properties: {
        club_id: { type: 'string' },
        window_id: { type: 'string' },
      },
      required: ['club_id', 'window_id'],
    },
  },
  {
    name: 'generate_tide_booklet',
    description: 'Generate a PDF tide booklet for the user home port.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

let sessionCookie = process.env.TIDAL_SESSION_COOKIE || '';

const parseSessionCookie = (setCookieHeader) => {
  if (!setCookieHeader) return '';
  const cookiePart = setCookieHeader.split(';')[0];
  if (!cookiePart.startsWith(`${SESSION_COOKIE_NAME}=`)) return '';
  return cookiePart;
};

const ensureSessionCookie = async () => {
  if (sessionCookie) return;
  const email = process.env.TIDAL_EMAIL;
  const password = process.env.TIDAL_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Authentication required. Set TIDAL_SESSION_COOKIE or TIDAL_EMAIL/TIDAL_PASSWORD for authenticated tools.',
    );
  }
  const response = await fetch(new URL('/api/auth/login', BASE_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Login failed (${response.status}): ${body}`);
  }
  const setCookieHeader = response.headers.get('set-cookie');
  const parsed = parseSessionCookie(setCookieHeader || '');
  if (!parsed) {
    throw new Error('Login response did not include a session cookie.');
  }
  sessionCookie = parsed;
};

const requestJson = async (path, { method = 'GET', body, auth = false, query } = {}) => {
  if (auth) {
    await ensureSessionCookie();
  }
  const url = new URL(path, BASE_URL);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });
  }
  const headers = { 'Content-Type': 'application/json' };
  if (sessionCookie) {
    headers.Cookie = sessionCookie;
  }
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request failed (${response.status}): ${errorText}`);
  }
  return response.json();
};

const requestBuffer = async (path, { auth = false } = {}) => {
  if (auth) {
    await ensureSessionCookie();
  }
  const url = new URL(path, BASE_URL);
  const headers = {};
  if (sessionCookie) {
    headers.Cookie = sessionCookie;
  }
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request failed (${response.status}): ${errorText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    disposition: response.headers.get('content-disposition') || '',
  };
};

const writeResponse = (message) => {
  const json = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;
  process.stdout.write(header + json);
};

const respond = (id, result) => {
  writeResponse({ jsonrpc: '2.0', id, result });
};

const respondError = (id, error) => {
  writeResponse({
    jsonrpc: '2.0',
    id,
    error: {
      code: -32000,
      message: error.message || 'Unknown error',
    },
  });
};

const handleToolCall = async (name, args) => {
  switch (name) {
    case 'list_stations': {
      const data = await requestJson('/api/Stations', {
        query: args?.query ? { query: args.query } : undefined,
      });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
    case 'get_station': {
      const data = await requestJson(`/api/Stations/${args.station_id}`);
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
    case 'list_clubs': {
      const data = await requestJson('/api/clubs');
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
    case 'get_profile': {
      const data = await requestJson('/api/profile', { auth: true });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
    case 'update_profile': {
      const data = await requestJson('/api/profile', {
        method: 'PUT',
        body: args ?? {},
        auth: true,
      });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
    case 'create_club': {
      const data = await requestJson('/api/clubs', {
        method: 'POST',
        body: { name: args.name, capacity: args.capacity },
        auth: true,
      });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
    case 'create_scrub_window': {
      const data = await requestJson(`/api/clubs/${args.club_id}/windows`, {
        method: 'POST',
        body: {
          date: args.date,
          lowWater: args.lowWater,
          duration: args.duration,
          capacity: args.capacity,
        },
        auth: true,
      });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
    case 'book_scrub_window': {
      const data = await requestJson(`/api/clubs/${args.club_id}/windows/${args.window_id}/book`, {
        method: 'POST',
        auth: true,
      });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
    case 'generate_tide_booklet': {
      const { buffer, contentType, disposition } = await requestBuffer('/api/generate-tide-booklet', {
        auth: true,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              contentType,
              disposition,
              base64: buffer.toString('base64'),
            }),
          },
        ],
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
};

const handleMessage = async (message) => {
  const { id, method, params } = message;
  if (method === 'initialize') {
    respond(id, {
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'tidal-calendar-mcp', version: '1.0.0' },
      capabilities: { tools: {} },
    });
    return;
  }
  if (method === 'tools/list') {
    respond(id, { tools });
    return;
  }
  if (method === 'tools/call') {
    try {
      const result = await handleToolCall(params?.name, params?.arguments || {});
      respond(id, result);
    } catch (error) {
      respondError(id, error);
    }
    return;
  }
  if (id !== undefined) {
    respondError(id, new Error(`Unsupported method: ${method}`));
  }
};

let buffer = '';

const processBuffer = () => {
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const messageStart = headerEnd + 4;
    if (buffer.length < messageStart + length) return;
    const payload = buffer.slice(messageStart, messageStart + length);
    buffer = buffer.slice(messageStart + length);
    try {
      const message = JSON.parse(payload);
      handleMessage(message);
    } catch (error) {
      writeResponse({
        jsonrpc: '2.0',
        error: { code: -32700, message: error.message || 'Parse error' },
      });
    }
  }
};

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  processBuffer();
});
