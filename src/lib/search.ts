import OpenAI from "openai";

export interface WebAnswer {
  answer: string;
  sources: { title: string; url: string }[];
}

const SEARCH_TIMEOUT_MS = 9000;
const OFFICIAL_DOMAINS = ["rbi.org.in", "npci.org.in", "gov.in", "paytm.com"];

let client: OpenAI | null = null;
function openai(): OpenAI {
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

// Answers are read aloud mid-call, so they are capped hard; a search is forced so every answer has sources.
async function askWeb(instructions: string, input: string, allowedDomains?: string[]): Promise<WebAnswer> {
  const response = await openai().responses.create(
    {
      model: process.env.OPENAI_SEARCH_MODEL ?? "gpt-5.4-mini",
      tools: [
        {
          type: "web_search",
          search_context_size: "low",
          user_location: { type: "approximate", country: "IN" },
          ...(allowedDomains && { filters: { allowed_domains: allowedDomains } }),
        },
      ],
      tool_choice: "required",
      include: ["web_search_call.action.sources"],
      reasoning: { effort: "low" },
      max_output_tokens: 400,
      instructions,
      input,
    },
    { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) },
  );

  const sources = new Map<string, string>();
  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const part of item.content) {
      if (part.type !== "output_text") continue;
      for (const note of part.annotations) {
        if (note.type === "url_citation") sources.set(note.url, note.title);
      }
    }
  }
  for (const item of response.output) {
    if (item.type !== "web_search_call" || item.action.type !== "search") continue;
    for (const source of item.action.sources ?? []) {
      if (source.type === "url" && !sources.has(source.url)) sources.set(source.url, new URL(source.url).hostname);
    }
  }

  return {
    answer: response.output_text.replace(/[*_`#]+/g, "").replace(/\s+/g, " ").trim(),
    sources: [...sources].slice(0, 4).map(([url, title]) => ({ url, title })),
  };
}

export function searchWeb(query: string): Promise<WebAnswer> {
  return askWeb(
    "You help a Paytm customer-care voice agent in India answer a caller's question. " +
      "Reply in at most two short spoken sentences of plain text: no markdown, no lists, no URLs. " +
      "Prefer official Indian sources (RBI, NPCI, government, Paytm). If the web does not give a clear answer, say so plainly.",
    query,
  );
}

export type ClaimVerdict = "supported" | "not_found" | "contradicted";

export interface ClaimCheck extends WebAnswer {
  verdict: ClaimVerdict;
}

// Callers sometimes cite rules that don't exist to pressure an agent. Only official domains are searched,
// and a claim counts as supported only when one of them is actually cited.
export async function checkClaim(claim: string): Promise<ClaimCheck> {
  const { answer, sources } = await askWeb(
    "A customer on a Paytm support call cites a rule. Check it only against the official sources you can search. " +
      "Begin your reply with exactly one of SUPPORTED:, NOT_FOUND: or CONTRADICTED:, then in one or two short spoken " +
      "sentences of plain text say what the official rule actually is. Use SUPPORTED only if an official source states " +
      "this rule; if the cited article, section or deadline cannot be found, use NOT_FOUND.",
    claim,
    OFFICIAL_DOMAINS,
  );
  const match = /^\s*(SUPPORTED|NOT_FOUND|CONTRADICTED)\s*:\s*/i.exec(answer);
  const verdict = (match?.[1].toLowerCase() ?? "not_found") as ClaimVerdict;
  return {
    verdict: verdict === "supported" && sources.length === 0 ? "not_found" : verdict,
    answer: match ? answer.slice(match[0].length).trim() : answer,
    sources,
  };
}
