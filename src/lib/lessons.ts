import { listLessons } from "./db";

const MAX_LESSONS_IN_PROMPT = 12;

/** The specialists' coaching as prompt lines, newest first; capped so the prompt stays small. */
export function lessonsForPrompt(): string {
  const lessons = listLessons().slice(0, MAX_LESSONS_IN_PROMPT);
  return lessons.length ? lessons.map((lesson) => `- ${lesson.text}`).join("\n") : "- None yet.";
}
