# Cloudflare Internship Project

Bennett Woods
Model Used: Gemini 3 Pro

## Initial Prompt

I am applying for a Cloudflare internship and need to build a "Code Mentor"
prototype tonight. It is a real-time code editor where an AI (Llama 3.3)
watches what I type and gives me short, proactive tips via a WebSocket.

Please act as a Senior Cloudflare Developer and give me the code for a
"Speedrun MVP" using the Cloudflare Workers + Durable Objects + Workers AI
stack.

#### Constraints:

Architecture: Use a "Monolith Worker" approach. I do not want separate
frontend build steps (no Vite/React). The Worker should serve a raw HTML/JS
string for the UI and handle the API/WebSocket logic in the same index.ts
file.

#### Tech Stack:

- Durable Objects: To handle the WebSocket connection and state.

- Workers AI: Use @cf/meta/llama-3.3-70b-instruct to analyze the code.

- Cloudflare Workers: To route requests.

#### Output:

- Provide the exact wrangler.jsonc configuration I need to bind the Durable Object and AI.

- Provide the full, copy-pasteable code for src/index.ts that includes the Worker logic, the Durable Object class, and the HTML frontend string.

- Explain how to run it locally with npx wrangler dev.

## Tuning the Styling

I would like to have a more refined editor interface (syntax highlighting
might be a stretch, but something that allows for tabs would be nice), as
well as flex-boxing the components to its a classic 2:1 horizontal view. I
really want this to stand out!
