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
			console.log(`[DO] Received input length: ${userCode.length}`); // DEBUG LOG 1

			// --- THE "CODE MENTOR" LOGIC ---
			// We only trigger AI if the code is longer than 10 chars (simple debounce)
			if (userCode.length > 10) {
				console.log(`[DO] Triggering AI...`); // DEBUG LOG 2
				const modelName = '@cf/meta/llama-3.3-70b-instruct' as any;

				try {
					// Call Workers AI (Llama 3.3)
					const response = (await this.env.AI.run(modelName, {
						messages: [
							{ role: 'system', content: 'You are a coding mentor. Provide a 1-sentence tip based on this code.' },
							{ role: 'user', content: userCode },
						],
					})) as { response: string };

					console.log(`[DO] AI Response: ${response.response.substring(0, 20)}...`); // DEBUG LOG 3
					server.send(`AI TIP: ${response.response}`);
				} catch (err) {
					console.error(`[DO] AI Error:`, err); // CRITICAL ERROR LOG
					server.send(`AI TIP: Error generating tip. Check logs.`);
				}
			} else {
				console.log(`[DO] Input too short, skipping AI.`);
			}
		});

		return new Response(null, { status: 101, webSocket: client });
	}
}

// --- 3. THE FRONTEND (Simple HTML/JS Client) ---
const HTML_UI = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Mentor | Cloudflare AI</title>
  <style>
    /* RESET & BASE */
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #1e1e1e; color: #d4d4d4; height: 100vh; overflow: hidden; display: flex; flex-direction: column; }

    /* HEADER */
    header { background: #000000; color: #f6821f; padding: 0 20px; height: 50px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #333; font-weight: 600; letter-spacing: 0.5px; }
    .status { font-size: 0.8rem; color: #666; display: flex; align-items: center; gap: 8px; }
    .status-dot { width: 8px; height: 8px; background: #666; border-radius: 50%; }
    .status.connected .status-dot { background: #00ff00; box-shadow: 0 0 5px #00ff00; }

    /* MAIN LAYOUT (2:1 Split) */
    .main-container { display: flex; flex: 1; height: calc(100vh - 50px); }
    
    /* EDITOR PANE (Flex 2) */
    .editor-pane { flex: 2; display: flex; flex-direction: column; border-right: 1px solid #333; position: relative; }
    textarea { 
      flex: 1; 
      background: #1e1e1e; 
      color: #d4d4d4; 
      border: none; 
      resize: none; 
      padding: 20px; 
      font-family: 'Menlo', 'Monaco', 'Courier New', monospace; 
      font-size: 14px; 
      line-height: 1.5; 
      outline: none;
      tab-size: 2;
    }
    /* Simple line number gutter simulation */
    textarea::placeholder { opacity: 0.5; }

    /* MENTOR SIDEBAR (Flex 1) */
    .sidebar { flex: 1; background: #252526; display: flex; flex-direction: column; }
    .sidebar-header { padding: 15px; background: #333; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px; color: #fff; border-bottom: 1px solid #1e1e1e; display: flex; align-items: center; gap: 10px; }
    .ai-badge { background: #f6821f; color: black; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: bold; }
    
    .feed { flex: 1; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 15px; }
    
    /* CHAT BUBBLES */
    .message { animation: fadeIn 0.3s ease; }
    .message.ai { background: #37373d; padding: 15px; border-radius: 8px; border-left: 4px solid #f6821f; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
    .message.ai h4 { margin: 0 0 5px 0; color: #f6821f; font-size: 0.8rem; }
    .message.ai p { margin: 0; font-size: 0.9rem; line-height: 1.4; color: #eee; }
    
    .thinking { font-style: italic; color: #888; font-size: 0.8rem; display: none; padding-left: 10px;}
    .thinking.active { display: block; }

    @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
  </style>
</head>
<body>
  <header>
    <span>Code Mentor <span style="font-weight:normal; opacity:0.7; font-size: 0.8em;">// Powered by Cloudflare Workers AI</span></span>
    <div class="status" id="statusBox">
      <div class="status-dot" id="statusDot"></div>
      <span id="statusText">Connecting...</span>
    </div>
  </header>

  <div class="main-container">
    <div class="editor-pane">
      <textarea id="editor" spellcheck="false" placeholder="// Start typing your TypeScript code here...
// The AI is watching and will provide tips on the right.

function fibonacci(n: number) {
  
}"></textarea>
    </div>

    <div class="sidebar">
      <div class="sidebar-header">
        <span>Mentor Feed</span>
        <span class="ai-badge">Llama 3.3</span>
      </div>
      <div class="feed" id="feed">
        <div class="message ai">
          <h4>SYSTEM</h4>
          <p>Ready to review. I will analyze your code whenever you pause typing.</p>
        </div>
      </div>
      <div class="thinking" id="thinking">Analyzing code structure...</div>
    </div>
  </div>

  <script>
    const ws = new WebSocket(window.location.origin.replace("http", "ws") + "/ws");
    const editor = document.getElementById("editor");
    const feed = document.getElementById("feed");
    const thinking = document.getElementById("thinking");
    const statusBox = document.getElementById("statusBox");
    const statusText = document.getElementById("statusText");

    // 1. Connection Logic
    ws.onopen = () => { 
      statusBox.classList.add("connected"); 
      statusText.innerText = "Connected to Edge"; 
    };
    ws.onclose = () => { 
      statusBox.classList.remove("connected"); 
      statusText.innerText = "Disconnected"; 
    };

    // 2. Message Handling (The AI Feedback)
    ws.onmessage = (event) => {
      thinking.classList.remove("active");
      
      const cleanMsg = event.data.replace("AI TIP: ", "");
      
      // Create a nice card for the new tip
      const msgDiv = document.createElement("div");
      msgDiv.className = "message ai";
      msgDiv.innerHTML = "<h4>SUGGESTION</h4><p>" + cleanMsg + "</p>";
      
      feed.insertBefore(msgDiv, feed.firstChild); // Newest on top
    };

    // 3. Tab Key Support (The "Editor" Feel)
    editor.addEventListener('keydown', function(e) {
      if (e.key == 'Tab') {
        e.preventDefault();
        const start = this.selectionStart;
        const end = this.selectionEnd;

        // Insert 2 spaces
        this.value = this.value.substring(0, start) + "  " + this.value.substring(end);

        // Put cursor back in right place
        this.selectionStart = this.selectionEnd = start + 2;
      }
    });

    // 4. Debounce Logic
    let timeout;
    editor.addEventListener("input", () => {
      thinking.classList.add("active");
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        if(editor.value.length > 5) {
           ws.send(editor.value); 
        } else {
           thinking.classList.remove("active");
        }
      }, 2000); // 2-second pause triggers AI
    });
  </script>
</body>
</html>
`;
