# cf_ai_code_mentor

> A real-time, stateful coding mentor powered by Cloudflare Workers, Durable Objects, and Llama 3.3.

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange?logo=cloudflare)
![Durable Objects](https://img.shields.io/badge/State-Durable%20Objects-blue?logo=cloudflare)
![AI Model](https://img.shields.io/badge/AI-Llama%203.3-green)

## Overview

**Code Mentor** is a serverless application that provides live, AI-driven feedback on your code as you type. Unlike standard chatbots, this application uses **Durable Objects** to maintain a persistent session state, meaning it remembers your code and the AI's advice even if you refresh the browser.

To solve the issue of high AI inference costs, this project implements a "Change Budget" algorithm(Sandwich Diff) that only triggers the LLM when significant logical changes are detected, rather than on every keystroke.

## Assignment Requirements

- **AI Powered:** Uses `@cf/meta/llama-3.3-70b-instruct-fp8-fast` for code analysis.
- **Real-Time Workflow:** Full WebSocket integration for instant feedback (no polling).
- **Persistent Memory:** Uses Durable Object Storage to save the user's session and the last AI tip to disk.
- **Cost Optimization:** Implements a custom heuristic that prevents "typo-fix" triggers, saving on Workers AI bills.

## How to Run

### Prerequisites

- Node.js & npm installed.
- A Cloudflare account.

### Installation & Access

If you so choose to test locally, you can run these commands:

```bash
git clone [https://github.com/YOUR_USERNAME/cf_ai_code_mentor.git](https://github.com/Woodsii/cf_ai_code_mentor.git)
cd cf_ai_code_mentor
npm install
npx wrangler dev
```

However the project is also available at [this link](https://mentor.secrethandshakernd.com)

## Limitations

This is only an MVP. If I were to continue developement, there are some glaring issues to fix, primarily prompt injection in the code block. I got llama 3.3 to generate me a poem about tinned fish through text inside of a `console.log()` call.

This is also missing a lot of functionality to make it a complete app. A backend to store user's code, a slick and responsive frontend, and I could even see some social aspect - sharing your code and AI suggestions to friends and collegues.

Just as a proof of concept and my first time exploring Cloudflare's serverless capabilities, this was still pretty cool :^)
