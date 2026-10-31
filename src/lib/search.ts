import OpenAI from "openai";

export interface WebAnswer {
  answer: string;
  sources: { title: string; url: string }[];
}

const SEARCH_TIMEOUT_MS = 9000;

let client: OpenAI | null = null;
function openai(): OpenAI {
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export async function searchWeb(query: string): Promise<WebAnswer> {
  // The answer is read aloud mid-call, so it is capped hard and stripped of anything a voice can't say.
  const response = await openai().responses.create(
    {
      model: process.env.OPENAI_SEARCH_MODEL ?? "gpt-5.4-mini",
      tools: [
        {
          type: "web_search",
          search_context_size: "low",
          user_location: { type: "approximate", country: "IN" },
        },
      ],
      reasoning: { effort: "low" },
      max_output_tokens: 400,
      instructions:
        "You help a customer-service voice agent in India answer a caller's question. " +
        "Reply in at most two short spoken sentences of plain text: no markdown, no lists, no URLs. " +
        "Prefer official Indian sources (RBI, NPCI, government, the company itself). " +
        "If the web does not give a clear answer, say so plainly.",
      input: query,
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

  return {
    answer: response.output_text.trim(),
    sources: [...sources].slice(0, 4).map(([url, title]) => ({ url, title })),
  };
}
