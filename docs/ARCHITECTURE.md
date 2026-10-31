# Closr architecture

Closr is a single Next.js application. It hosts the tool API that the voice and chat agents call, the policy engine that decides what may happen, the simulated Paytm back office, and two user interfaces: the Paytm Care Console for specialists and the customer app.

## Principle

A probabilistic brain inside deterministic guardrails. The language model understands the customer and chooses which tool to call; code decides whether an action is allowed, performs it, and verifies it.

## Components

| Layer | Where | Responsibility |
|---|---|---|
| Voice channel | Bolna agent defined in `scripts/bolna-agent.mjs` | Phone calls, Sarvam Saaras v4 speech-to-text, Sarvam Bulbul v4 voice, turn-taking, tool calls over HTTPS with a shared secret |
| Chat channel | `src/lib/chat.ts`, `/api/chat/*` | In-app chat for customers who cannot or prefer not to talk; Sarvam `sarvam-105b-conversations` with OpenAI as a per-turn fallback; a per-turn reminder keeps replies in the customer's language |
| Behaviour spec | `src/lib/agent-spec.json` | One playbook and one set of tool definitions used by both channels |
| Tools | `src/lib/tools.ts`, `/api/tools/[tool]` | Lookups, disputes, flagging, cashback, loans, settlements, devices, rent refunds, offers, follow-ups, web search, claim checks, escalation |
| Policy | `src/lib/policy.ts` | Pure functions returning allow, needs approval or deny, with a checklist of rules |
| Autonomy | `movePayout` in `src/lib/tools.ts`, `/api/autonomy` | Trust dial per money workflow: L0 Shadow, L1 Approve, L2 Auto within limits, L3 Autonomous (lifts only the amount limit) |
| Store | `src/lib/db.ts`, `.data/db.json` | File-backed JSON store with atomic read-modify-write, seeded from `src/lib/seed.ts` |
| Claim checks | `src/lib/search.ts` | OpenAI web search restricted to rbi.org.in, npci.org.in, gov.in and paytm.com; a claim is supported only when an official source is cited |
| Learning | `src/lib/lessons.ts`, `/api/lessons` | Specialist coaching injected into the chat prompt every turn and into each call as a Bolna variable |
| Metrics | `src/lib/metrics.ts`, `/api/metrics` | Conversations, autonomous and verified resolutions, money returned, escalations, time to a verified fix |
| Diagnostics | `src/lib/diagnostics.ts`, `/diagnostics` | Bolna debug logs, voice activity, line details and the recording with a loudness graph |
| Interfaces | `src/components/**`, `src/app/**` | Care Console (`/`), customer app (`/customer`), Call Health (`/diagnostics`) |

## A tool call, step by step

1. The agent calls a tool, for example `refund_rent`.
2. The tool binds the caller from the call record (the dialled number or the signed-in profile), never from model input.
3. Policy evaluates the request and the result is recorded as a policy moment with its checklist.
4. The trust dial for the workflow decides: suggest only, ask a specialist, act within the limit, or act above it.
5. The action is written once per subject (idempotency), then a separate verification step re-reads the record from the source system.
6. A helpdesk ticket is opened or resolved, follow-ups are scheduled for disputes, and every step is a moment the console and the customer app render live.

## Safety and privacy

- The console, customer app, approvals and resets are served only to localhost unless a `CONSOLE_KEY` cookie is presented; cross-site POSTs are refused.
- Tool and webhook routes require their own secrets and fail closed when a secret is missing.
- Bank account changes are never made in a conversation; Closr sends a secure in-app link instead.
- Calls begin with a recording notice; transcripts are available for quality review and training.
- Closr never asks for an OTP, UPI PIN, password or card number.

## Limits of this prototype

- Back-office systems are simulations seeded with demo data behind the same tool interface a production integration would use.
- The store is a single JSON file, suited to one instance.
- Channels are voice and in-app chat; WhatsApp and email are on the roadmap.
