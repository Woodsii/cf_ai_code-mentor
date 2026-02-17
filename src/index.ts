/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { DurableObject } from 'cloudflare:workers';

export interface Env {
	MENTOR_SESSION: DurableObjectNamespace<MentorSession>;
	AI: any;
}

// --- 1. THE WORKER (Router & UI Server) ---
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// A. Serve the UI (HTML)
		if (url.pathname === '/') {
			return new Response(HTML_UI, { headers: { 'Content-Type': 'text/html' } });
		}

		// B. Handle WebSocket Upgrade
		if (url.pathname === '/ws') {
			// Forward to the Durable Object (we use a hardcoded ID 'default' for this demo)
			const id = env.MENTOR_SESSION.idFromName('default');
			const stub = env.MENTOR_SESSION.get(id);
			return stub.fetch(request);
		}

		return new Response('Not found', { status: 404 });
	},
};

// --- 2. THE DURABLE OBJECT (State & AI) ---
export class MentorSession extends DurableObject<Env> {
	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
	}

	async fetch(request: Request) {
		const upgradeHeader = request.headers.get('Upgrade');
		if (!upgradeHeader || upgradeHeader !== 'websocket') {
			return new Response('Expected Upgrade: websocket', { status: 426 });
		}

		const { 0: client, 1: server } = new WebSocketPair();

		// Accept the websocket connection
		this.ctx.acceptWebSocket(server);

		// Listen for messages from the client (the React/HTML frontend)
		server.addEventListener('message', async (event) => {
			const userCode = event.data as string;

			// --- THE "SHADOW MENTOR" LOGIC ---
			// We only trigger AI if the code is longer than 10 chars (simple debounce)
			if (userCode.length > 10) {
				const modelName = '@cf/meta/llama-3.3-70b-instruct' as any;
				// Call Workers AI (Llama 3.3)
				const response = (await this.env.AI.run(modelName, {
					messages: [
						{ role: 'system', content: 'You are a coding mentor. Provide a 1-sentence tip based on this code.' },
						{ role: 'user', content: userCode },
					],
				})) as { response: string };

				// Send the AI tip back to the client
				server.send(`AI TIP: ${response.response}`);
			}
		});

		return new Response(null, { status: 101, webSocket: client });
	}
}

// --- 3. THE FRONTEND (Simple HTML/JS Client) ---
const HTML_UI = `
<!DOCTYPE html>
<html>
<body>
  <h1>Shadow Mentor Prototype</h1>
  <textarea id="editor" style="width: 100%; height: 200px;" placeholder="Type code here..."></textarea>
  <div id="feedback" style="background: #f0f0f0; padding: 10px; margin-top: 10px;">Waiting for input...</div>

  <script>
    const ws = new WebSocket(window.location.origin.replace("http", "ws") + "/ws");
    const editor = document.getElementById("editor");
    const feedback = document.getElementById("feedback");

    ws.onmessage = (event) => {
      feedback.innerText = event.data;
    };

    let timeout;
    editor.addEventListener("input", () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        ws.send(editor.value); // Send code to backend after user stops typing
      }, 1000);
    });
  </script>
</body>
</html>
`;
