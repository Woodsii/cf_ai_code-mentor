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
	// We keep track of the last code we paid to analyze
	lastAnalyzedCode: string = '';
	lastTip: string = '';

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.ctx.blockConcurrencyWhile(async () => {
			this.lastAnalyzedCode = (await this.ctx.storage.get('lastCode')) || '';
			this.lastTip = (await this.ctx.storage.get('lastTip')) || '';
		});
	}

	async fetch(request: Request) {
		const upgradeHeader = request.headers.get('Upgrade');
		if (!upgradeHeader || upgradeHeader !== 'websocket') {
			return new Response('Expected Upgrade: websocket', { status: 426 });
		}

		const { 0: client, 1: server } = new WebSocketPair();
		this.ctx.acceptWebSocket(server);

		// hydrate the front end with the old code + tips
		if (this.lastAnalyzedCode) {
			server.send(`RESTORE_CODE:${this.lastAnalyzedCode}`);
		}
		if (this.lastTip) {
			server.send(`AI TIP:${this.lastTip}`);
		}

		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		const currentCode = message.toString();

		// calculate the change magnitude
		const changeMagnitude = this.calculateDiff(this.lastAnalyzedCode, currentCode);

		const CHANGE_THRESHOLD = 50;
		// man I love logging
		console.log(`[DO] Length: ${currentCode.length} | Changes: ${changeMagnitude} | Threshold: ${CHANGE_THRESHOLD}`);

		// if the change magnitude is greater than the threshold, only then do I start to burn my cloudflare resources.
		if (changeMagnitude > CHANGE_THRESHOLD) {
			console.log(`[DO] Threshold hit! Triggering AI...`);

			const modelName = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

			try {
				const response = (await this.env.AI.run(modelName, {
					messages: [
						{ role: 'system', content: 'You are a coding mentor. Provide a 1-sentence tip based on this code.' },
						{ role: 'user', content: currentCode },
					],
				})) as { response: string };

				ws.send(`AI TIP: ${response.response}`);

				// update the baseline *only* after a successful run
				this.lastAnalyzedCode = currentCode;
				this.lastTip = response.response;

				// send the baseline to the server.
				await this.ctx.storage.put('lastCode', this.lastAnalyzedCode);
				await this.ctx.storage.put('lastTip', this.lastTip);
			} catch (err) {
				console.error(`[DO] AI Error:`, err);
				ws.send(`AI TIP: Error generating tip.`);
			}
		} else {
		}
	}

	/**
	 * A fast, lightweight heuristic to count changed characters.
	 * It strips matching prefixes and suffixes and counts the "middle" difference.
	 */
	calculateDiff(oldText: string, newText: string): number {
		if (oldText === newText) return 0;
		if (!oldText) return newText.length;
		if (!newText) return oldText.length;

		let start = 0;
		let end = 0;
		const minLen = Math.min(oldText.length, newText.length);

		// 1. Scan from the start (Common Prefix)
		while (start < minLen && oldText[start] === newText[start]) {
			start++;
		}

		// 2. Scan from the end (Common Suffix), but don't overlap with start
		// We use relative indexing for the end scan
		while (end < minLen - start && oldText[oldText.length - 1 - end] === newText[newText.length - 1 - end]) {
			end++;
		}

		// 3. The "Edit" is roughly the max length of the non-matching middle parts
		const oldDiff = oldText.length - start - end;
		const newDiff = newText.length - start - end;

		return Math.max(oldDiff, newDiff);
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
      
      const data = event.data;

      // CASE A: It's the AI speaking (or a restored tip)
      if (data.startsWith("AI TIP:")) {
        const cleanMsg = data.replace("AI TIP: ", "");
        const msgDiv = document.createElement("div");
        msgDiv.className = "message ai";
        msgDiv.innerHTML = "<h4>SUGGESTION</h4><p>" + cleanMsg + "</p>";
        feed.insertBefore(msgDiv, feed.firstChild); 
      }
      
      // CASE B: It's a Code Restore command (NEW)
      else if (data.startsWith("RESTORE_CODE:")) {
        const savedCode = data.replace("RESTORE_CODE:", "");
        editor.value = savedCode;
        // Optional: Flash a status to let them know
        statusText.innerText = "Session Restored";
      }
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
