// Creates or updates the Closr voice agent on Bolna from this file, so the agent lives in the repo.
// Usage: node --env-file=.env.local scripts/bolna-agent.mjs <public-base-url>

import spec from "../src/lib/agent-spec.json" with { type: "json" };

const BOLNA_API = "https://api.bolna.ai";
const { BOLNA_API_KEY, BOLNA_AGENT_ID, TOOLS_SECRET, WEBHOOK_SECRET, STT } = process.env;
const baseUrl = process.argv[2]?.replace(/\/$/, "");

if (!BOLNA_API_KEY || !baseUrl) {
  console.error("Need BOLNA_API_KEY in .env.local and the public base URL as the first argument.");
  process.exit(1);
}

const SYSTEM_PROMPT = `You are Closr (say it "क्लोज़र"), a female AI assistant in Paytm customer care. You are calling {{customer_name}} ({{customer_phone}}) back because they just tapped "Request call back".
This caller is a {{customer_type}}; when you call lookup_customer, pass phone {{customer_phone}}. A consumer uses the Paytm app for UPI payments, cashback and loans. A merchant ({{business_name}}) uses Paytm for Business: QR and Soundbox collections, settlements to their bank, device rental and merchant loans.

How you speak (your words are read aloud by a Hindi voice)
- Write Hindi in Devanagari, and keep common English words in English: UPI, payment, refund, cashback, settlement, Soundbox, loan, EMI, account, team. Say Paytm as "पेटीएम".
- You are female: "बोल रही हूँ", "देख रही हूँ", "कर सकती हूँ" — never the masculine forms.
- Reply in the customer's language: Hinglish by default, pure Hindi or English if they switch.
- One or two short sentences per turn. No lists, no symbols, no emojis. Say amounts like "2,000 रुपये" and only the last four digits of any reference.
- Ask one question at a time, then stop. If they pause mid-sentence, wait for them to finish.

When they ask who you are or why you called — answer first, briefly and honestly, then return to their issue
- "कौन बोल रहा है / कहाँ से बोल रहे हो?" → "मैं क्लोज़र हूँ, पेटीएम customer care से। आपने अभी पेटीएम app में call back माँगा था, इसलिए call किया।"
- "क्या आप robot / AI हो?" → "जी, मैं पेटीएम की AI assistant हूँ। आपका काम मैं इसी call पर कर सकती हूँ, और ज़रूरत हो तो अपनी team से जोड़ दूँगी।"
- "मेरा number कहाँ से मिला?" → "आपने इसी number से call back request किया था।"
- If they say "hello?" or seem not to hear you, repeat your last line in fewer words.
- Off-topic chat gets one friendly line, then steer back.

How you work
${spec.playbook.map((line) => `- ${line}`).join("\n")}

Ending the call
- Once the issue is resolved, ask "और कुछ मदद कर सकती हूँ?". If they say no, say one short goodbye ("पेटीएम पर भरोसा करने के लिए धन्यवाद, नमस्ते।") and nothing more; never repeat the goodbye. The call then ends by itself.`;

const HANGUP_PROMPT = `Decide if this customer-care call is finished. It is finished only if the customer said goodbye, said they need nothing else (e.g. "बस", "nahi, thank you", "that's all"), or asked to end the call. A pause, a thank-you in the middle of the issue, or waiting for an approval does NOT mean the call is finished.`;

const tool = (name, description, properties, required, preCallMessage) => ({
  spec: {
    key: "custom_task",
    name,
    description,
    parameters: { type: "object", properties, required },
    ...(preCallMessage && { pre_call_message: preCallMessage }),
  },
  params: {
    url: `${baseUrl}/api/tools/${name}`,
    method: "POST",
    param: Object.fromEntries(Object.keys(properties).map((key) => [key, `%(${key})s`])),
    headers: {
      "Content-Type": "application/json",
      ...(TOOLS_SECRET && { Authorization: `Bearer ${TOOLS_SECRET}` }),
    },
    api_token: null,
  },
});

const str = (description) => ({ type: "string", description });

const TOOLS = spec.tools.map((t) =>
  tool(
    t.name,
    t.description,
    Object.fromEntries(Object.entries(t.parameters).map(([key, description]) => [key, str(description)])),
    t.required,
    t.filler,
  ),
);

const TRANSCRIBERS = {
  // Turn-taking lives in Bolna's endpointing: one second of silence, not the 700 ms that cut callers off mid-thought.
  sarvam: {
    provider: "sarvam",
    model: "saaras:v4",
    language: "hi",
    stream: true,
    endpointing: 1200,
    vad_threshold: 0.35,
    keywords: "Paytm, UPI, Soundbox, settlement, cashback, refund, EMI, loan, dispute, UTR, RBI, NPCI, Closr",
    context: "Paytm customer care call back in Hinglish. A consumer asks about a failed UPI payment, cashback or a loan EMI, or a kirana merchant asks about a silent Soundbox, a settlement or rent on a returned device.",
  },
  soniox: { provider: "soniox", model: "stt-rt-v5", language: "hi", stream: true, endpointing: 1000 },
};

const agentConfig = {
  agent_name: "Closr — Paytm care teammate",
  agent_welcome_message: "{{greeting}}",
  webhook_url: `${baseUrl}/api/bolna/webhook${WEBHOOK_SECRET ? `?key=${WEBHOOK_SECRET}` : ""}`,
  tasks: [
    {
      task_type: "conversation",
      toolchain: { execution: "parallel", pipelines: [["transcriber", "llm", "synthesizer"]] },
      tools_config: {
        input: { provider: "plivo", format: "wav" },
        output: { provider: "plivo", format: "wav" },
        transcriber: TRANSCRIBERS[STT ?? "sarvam"],
        llm_agent: {
          agent_type: "simple_llm_agent",
          agent_flow_type: "streaming",
          llm_config: {
            provider: "openai",
            family: "openai",
            model: "gpt-5.4-mini",
            reasoning_effort: "none",
            max_tokens: 220,
            temperature: 1,
          },
        },
        synthesizer: {
          provider: "sarvam",
          stream: true,
          caching: true,
          buffer_size: 150,
          audio_format: "pcm",
          provider_config: { model: "bulbul:v4-flash", voice: "Aparna (Customer)", voice_id: "aparna_hi_customer", language: "hi", speed: 1 },
        },
        api_tools: {
          tools: TOOLS.map((t) => t.spec),
          tools_params: Object.fromEntries(TOOLS.map((t) => [t.spec.name, t.params])),
        },
      },
      task_config: {
        optimize_latency: true,
        backchanneling: false,
        use_fillers: false,
        number_of_words_for_interruption: 3,
        interruption_backoff_period: 100,
        incremental_delay: 1400,
        hangup_after_silence: 60,
        call_terminate: 420,
        voicemail: false,
        check_if_user_online: false,
        trigger_user_online_message_after: 30,
        check_user_online_message: "Hello, क्या आप line पर हैं?",
        hangup_after_LLMCall: true,
        call_cancellation_prompt: HANGUP_PROMPT,
        // The agent says its own goodbye, so the hang-up itself stays silent instead of thanking the caller twice.
        call_hangup_message: "",
        interruptible_hangup_message: true,
      },
    },
  ],
};

const res = await fetch(BOLNA_AGENT_ID ? `${BOLNA_API}/v2/agent/${BOLNA_AGENT_ID}` : `${BOLNA_API}/v2/agent`, {
  method: BOLNA_AGENT_ID ? "PUT" : "POST",
  headers: { Authorization: `Bearer ${BOLNA_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ agent_config: agentConfig, agent_prompts: { task_1: { system_prompt: SYSTEM_PROMPT } } }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Bolna rejected the agent (${res.status}):`, JSON.stringify(body, null, 2));
  process.exit(1);
}
console.log(BOLNA_AGENT_ID ? `Updated agent ${BOLNA_AGENT_ID}` : `Created agent ${body.agent_id} — set BOLNA_AGENT_ID in .env.local`);
