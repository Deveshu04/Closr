import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import spec from "./agent-spec.json";
import * as db from "./db";
import { DEMO_PROFILES } from "./seed";
import { isToolName, runTool } from "./tools";
import type { CallRecord, Customer, ProfileKind } from "./types";

const MAX_TOOL_ROUNDS = 8;

const SUGGESTIONS: Record<ProfileKind, string[]> = {
  consumer: [
    "Money debited but not received",
    "My UPI payment failed",
    "Cashback not credited",
    "EMI deducted twice",
  ],
  merchant: [
    "Soundbox not announcing payments",
    "Settlement not received",
    "Rent charged after returning device",
  ],
};

interface ChatSession {
  /** System prompt first, then the conversation in chat-completions form, tool calls and results included. */
  messages: ChatCompletionMessageParam[];
}

// Kept on globalThis so a dev-server hot reload doesn't drop conversations mid-chat.
const sessions: Map<string, ChatSession> = ((globalThis as { closrChats?: Map<string, ChatSession> }).closrChats ??=
  new Map());

interface Brain {
  name: string;
  client: OpenAI;
  model: string;
  reasoning: OpenAI.ReasoningEffort;
}

// Sarvam's Indian-language model is the chat brain; OpenAI only steps in for a turn if Sarvam errors, so a demo
// never leaves a customer without a reply.
function brains(): Brain[] {
  const list: Brain[] = [];
  const sarvamKey = process.env.SARVAM_API_KEY;
  if (sarvamKey) {
    list.push({
      name: "sarvam",
      client: new OpenAI({
        apiKey: sarvamKey,
        baseURL: "https://api.sarvam.ai/v1",
        defaultHeaders: { "api-subscription-key": sarvamKey },
      }),
      model: process.env.SARVAM_CHAT_MODEL ?? "sarvam-105b-conversations",
      reasoning: (process.env.SARVAM_REASONING_EFFORT as OpenAI.ReasoningEffort | undefined) ?? "low",
    });
  }
  if (process.env.OPENAI_API_KEY) {
    list.push({
      name: "openai",
      client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
      model: process.env.OPENAI_CHAT_MODEL ?? "gpt-5.4-mini",
      reasoning: "none",
    });
  }
  return list;
}

const TOOLS: ChatCompletionTool[] = spec.tools.map((tool) => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(tool.parameters).map(([key, description]) => [key, { type: "string", description }]),
      ),
      required: tool.required,
    },
  },
}));

const HINGLISH_WORDS = /\b(hai|hain|nahi|nahin|mera|meri|mere|kya|kyu|paisa|paise|kar|karo|gaya|gaye|aaya|aya|raha|rahi|bhi|abhi|kal|aaj|se|mein|ko|ka|ki|ke|bol|bata|wapas)\b/i;

function languageOf(text: string): string {
  if (/[\u0900-\u097F]/.test(text)) return "Hindi in Devanagari script";
  if (HINGLISH_WORDS.test(text)) return "Hinglish written in Roman letters (for example: \"Aapka paisa safe hai\")";
  return "English";
}

// A short reminder just before each reply holds a fast model to the two rules it drifts from most: the
// customer's language and reporting every outcome. It is sent with the request, never stored in the history.
function turnReminder(customerText: string): ChatCompletionMessageParam {
  return {
    role: "system",
    content:
      `Reply in ${languageOf(customerText)}, the language of the customer's last message, even though tool results are in English. ` +
      "Cover every outcome from this turn's tool results in order, starting with whether their money is safe and how much arrived or is being returned. " +
      "Give only the last four characters of any reference or dispute number.",
  };
}

async function complete(messages: ChatCompletionMessageParam[]): Promise<OpenAI.ChatCompletionMessage> {
  let lastError: unknown = new Error("No chat model is configured: set SARVAM_API_KEY or OPENAI_API_KEY");
  for (const brain of brains()) {
    try {
      const completion = await brain.client.chat.completions.create(
        { model: brain.model, messages, tools: TOOLS, tool_choice: "auto", reasoning_effort: brain.reasoning, max_tokens: 1200 },
        { timeout: 30_000 },
      );
      const message = completion.choices[0]?.message;
      if (message) return message;
      lastError = new Error(`${brain.name} returned no message`);
    } catch (error) {
      console.warn(`[chat] ${brain.name} failed, trying the next model`, error instanceof Error ? error.message : error);
      lastError = error;
    }
  }
  throw lastError;
}

function instructionsFor(customer: Customer): string {
  const who =
    customer.kind === "merchant"
      ? `${customer.name}, who runs ${customer.business?.name ?? "a shop"} on Paytm for Business`
      : `${customer.name}, a Paytm app user`;
  return `You are Closr, Paytm's AI customer-care assistant, chatting inside the Paytm app with ${who}. They are signed in, so their identity is already verified.
Many people who choose chat are deaf or hard of hearing, or can't talk right now. Make every message effortless to read.

How you write
- Warm, plain and precise. One to three short sentences per message.
- Match the customer's language and script exactly: Hinglish typed in Roman letters ("paisa kat gaya") gets a Hinglish reply in Roman letters, Devanagari gets Devanagari, English gets English. Tool "say" lines are written in English for you to work from; always put them in the customer's language before replying.
- No markdown, no bullet lists, no emojis. Write amounts like ₹2,000 and give only the last four characters of any reference.
- Ask one question at a time.
- The app shows every action you take as a card in the chat, so don't narrate tool calls; tell them the outcome and what happens next.
- After several steps, cover every outcome that matters to them in order, starting with whether their money is safe, then what you fixed. A merchant asking about a silent Soundbox must always get check_payments first, and your reply must open with how many payments and how much arrived.

How you work
${spec.playbook.map((line) => `- ${line}`).join("\n")}

Ending
- Once the issue is resolved, ask if there is anything else. If not, thank them in one line.`;
}

function appendTranscript(call: CallRecord, speaker: "user" | "assistant", text: string): void {
  const line = `${speaker}: ${text.replace(/\s+/g, " ").trim()}\n`;
  db.updateCall(call.callRef, { transcript: `${call.transcript ?? ""}${line}` });
}

function isLive(call: CallRecord | null): boolean {
  return !!call && ["dialing", "ringing", "in_progress"].includes(call.status);
}

export function startChat(profile: ProfileKind): { sessionRef: string; reply: string; suggestions: string[] } {
  if (isLive(db.getActiveCall())) throw new Error("A call or chat is already in progress");
  const customer = db.getCustomer(DEMO_PROFILES[profile].id);
  if (!customer) throw new Error("Demo profile not found");

  const created = db.createCall(customer.phone);
  const call = db.updateCall(created.callRef, { channel: "chat", status: "in_progress", customerId: customer.id }) ?? created;
  db.recordMoment({
    callRef: call.callRef,
    kind: "call",
    title: "Chat started in the Paytm app",
    detail: customer.business ? `${customer.name} · ${customer.business.name}` : customer.name,
    status: "ok",
  });

  const firstName = customer.name.split(" ")[0];
  const reply =
    profile === "merchant"
      ? `Namaste ${firstName} ji, I'm Closr, Paytm for Business's AI assistant. Tell me what's going on at ${customer.business?.name ?? "your shop"} and I'll sort it out right here.`
      : `Namaste ${firstName} ji, I'm Closr, Paytm's AI assistant. Tell me what went wrong and I'll fix it right here in this chat.`;
  appendTranscript(call, "assistant", reply);
  sessions.set(call.callRef, {
    messages: [
      { role: "system", content: instructionsFor(customer) },
      { role: "assistant", content: reply },
    ],
  });
  return { sessionRef: call.callRef, reply, suggestions: SUGGESTIONS[profile] };
}

/** One customer message: the model may call several tools (each recorded as console moments) before it replies. */
export async function chatTurn(sessionRef: string, text: string): Promise<{ reply: string }> {
  const call = db.getCall(sessionRef);
  if (!call || call.channel !== "chat" || !isLive(call)) throw new Error("This chat has ended");
  const customer = call.customerId ? db.getCustomer(call.customerId) : null;
  if (!customer) throw new Error("Chat has no verified customer");

  // After a dev-server restart the in-memory history is gone, so the model is handed the transcript so far instead.
  const session = sessions.get(sessionRef) ?? {
    messages: [
      { role: "system", content: instructionsFor(customer) },
      ...(call.transcript ? [{ role: "user" as const, content: `Conversation so far:\n${call.transcript}` }] : []),
    ],
  };
  sessions.set(sessionRef, session);
  appendTranscript(call, "user", text);
  session.messages.push({ role: "user", content: text });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const message = await complete([...session.messages, turnReminder(text)]);
    const toolCalls = (message.tool_calls ?? []).filter((toolCall) => toolCall.type === "function");
    session.messages.push({ role: "assistant", content: message.content ?? null, ...(toolCalls.length && { tool_calls: toolCalls }) });

    if (toolCalls.length === 0) {
      const reply = message.content?.trim() || "Sorry, could you say that again?";
      appendTranscript(db.getCall(sessionRef) ?? call, "assistant", reply);
      return { reply };
    }

    for (const toolCall of toolCalls) {
      let args: Record<string, string> = {};
      try {
        args = JSON.parse(toolCall.function.arguments || "{}") as Record<string, string>;
      } catch {
        args = {};
      }
      const result = isToolName(toolCall.function.name)
        ? await runTool(toolCall.function.name, { ...args, call_ref: sessionRef }).catch(() => ({
            ok: false,
            say: "That step failed on my side.",
          }))
        : { ok: false, say: `There is no tool called ${toolCall.function.name}.` };
      session.messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) });
    }
  }

  const reply = "I've taken the steps I can for now. A Paytm specialist will review this and get back to you.";
  appendTranscript(db.getCall(sessionRef) ?? call, "assistant", reply);
  return { reply };
}

export function endChat(sessionRef: string): void {
  const call = db.getCall(sessionRef);
  sessions.delete(sessionRef);
  if (!call || !isLive(call)) return;
  const endedAt = new Date();
  db.updateCall(sessionRef, {
    status: "completed",
    endedAt: endedAt.toISOString(),
    durationSec: Math.round((endedAt.getTime() - Date.parse(call.startedAt)) / 1000),
  });
  db.recordMoment({ callRef: sessionRef, kind: "call", title: "Chat ended", status: "ok" });
}
