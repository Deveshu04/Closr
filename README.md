# Closr

**Closes tickets. Closes deals. Closes the loop.**

Closr is an AI teammate for Paytm customer care. It doesn't stop at answering: it understands the customer, acts in Paytm's systems inside written policy, verifies every result against the source record, and brings in a human only when judgement is needed. Customers reach it by phone in Hinglish or by chat in the Paytm app, so deaf and hard-of-hearing customers get the same help.

Built for the Paytm Build for India AI Hackathon (Delhi), track *AI Teammates for Customer Service & Sales*, by Team KALESH.

## What it resolves

One care executive handles two kinds of customer from a single console.

| Customer | Problem | What Closr does |
|---|---|---|
| Consumer | UPI payment debited but never credited | Finds the payment, explains the RBI reversal deadline (T+1 / T+5), raises a UDIR dispute with NPCI. It never promises Paytm will pay what the bank owes. |
| Consumer | Bank says *success*, but the receiver says the money never arrived | Flags the payment as under investigation and raises a credit-not-received dispute instead of arguing that it succeeded. |
| Consumer | Cashback not credited | Checks the offer terms and credits it; above ₹500 a specialist approves in one tap. |
| Consumer | Loan EMI deducted twice | Routes the case to the lender's grievance officer with the RBI 30-day clock; Paytm cannot refund a lender's money. |
| Merchant | Soundbox stopped announcing payments | Confirms every payment that arrived, restarts the device remotely, updates firmware and plays a ₹1 test announcement. |
| Merchant | Settlement didn't reach the bank | Re-sends a settlement that failed for a technical reason and confirms the UTR. Bank details are never changed in a conversation. |
| Merchant | Rent charged after returning a device | Refunds rent charged after the pickup date and stops billing; above ₹1,000 a specialist approves. |
| Both | Issue fixed, customer satisfied | Offers at most one product that stops the problem recurring (UPI Lite after failed payments, a dual-SIM Soundbox after a silent one). The offer goes to the app; nothing is signed up or charged in the conversation, and loan offers carry their Key Fact Statement. |

Every dispute schedules a follow-up: the case closes only when the money has actually landed, and the customer gets an SMS.

## Built for trust

- **Policies as code decide, not the model.** Every money movement passes a deterministic policy check, shown to the care team as a checklist.
- **Earned autonomy, per workflow.** A trust dial sets each money workflow to L0 Shadow (Closr suggests, a specialist acts), L1 Approve (every payout waits for one tap), L2 Auto within limits, or L3 Autonomous for workflows with proven accuracy. L3 lifts only the amount limit: eligibility, duplicate protection and risk reviews still apply.
- **A teammate that learns.** Specialists coach Closr with "next time, do X"; every lesson reaches the next call and chat immediately.
- **Measurable outcomes.** The console tracks conversations, autonomous and verified resolutions, money returned, escalations and time to resolve.
- **Nothing pays twice.** Every action is idempotent per subject, so a repeated turn on a call returns the same refund or dispute.
- **Identity comes from the channel.** The customer is bound to the number Closr dialled or the signed-in app, never to what the model heard.
- **Claims are checked, not believed.** When a customer cites a rule ("RBI says 10 minutes"), Closr checks it against RBI, NPCI, government and Paytm sources only and answers with the source.
- **Every step is visible and auditable.** The console shows each lookup, policy check, action and verification as it happens. Every call and chat exports as a transcript with its action log, and the Call health view shows what the voice platform actually heard.

## How it works

```
Customer ── phone (Bolna: Sarvam STT + TTS, OpenAI) ──┐
        └── chat in the Paytm app (Sarvam 105B) ──────┤
                                                      ▼
                              Closr tools  (/api/tools/*, src/lib/tools.ts)
                                │  policy check  →  action  →  verify  →  moment
                                ▼
            UPI · disputes · rewards · loans · settlements · devices · billing
                                │
                                ▼
                 Care Console (/)  ·  customer view (/customer)  ·  Call health (/diagnostics)
```

- **Voice:** a Bolna agent with Sarvam Saaras v4 speech-to-text, Sarvam Bulbul v4 voice and an OpenAI model, calling Closr's tools over HTTPS. The agent is defined in code in `scripts/bolna-agent.mjs`.
- **Chat:** `sarvam-105b-conversations` with tool calling over the same tools, with OpenAI as a per-turn fallback.
- **One behaviour spec:** voice and chat share `src/lib/agent-spec.json`, the playbook and tool definitions, so the two channels cannot drift apart.

## Run it locally

Requires Node 22+.

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run build && npm run start
```

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Claim checks and web search, and chat fallback |
| `SARVAM_API_KEY` | Chat brain |
| `BOLNA_API_KEY`, `BOLNA_AGENT_ID` | Placing calls through Bolna |
| `TOOLS_SECRET`, `WEBHOOK_SECRET` | Shared secrets Bolna presents to Closr's tools and webhook |
| `DEMO_CUSTOMER_NAME` | Name of the demo consumer |

To create or update the voice agent, expose port 3000 (for example with `ngrok http 3000`) and run:

```bash
node --env-file=.env.local scripts/bolna-agent.mjs https://<public-url>
```

The console, customer view and Call health are served only on `localhost`; through the tunnel only the tool and webhook routes answer, each behind its own secret. Demo data lives in `.data/` and can be reset from the console menu.

## Project layout

```
src/lib/        tools, policy, store, seed data, chat engine, search and claim checks, Bolna client
src/app/api/    tools for the agent, call and chat endpoints, state, approvals, transcripts, diagnostics
src/components/ Care Console, customer app (call back and chat), moments timeline, back office
scripts/        the Bolna voice agent, defined in code
```

The back-office systems are realistic simulations seeded with demo data; in production they would be Paytm's own services behind the same tool interface.
