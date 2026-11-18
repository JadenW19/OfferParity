"use client";

import { useState, type FormEvent } from "react";
import { AlertCircle, Loader2, Sparkles, Send } from "lucide-react";
import type { XRayReport } from "@/lib/schemas";

interface GeminiAssistantCardProps {
  report: XRayReport;
}

const SUGGESTED_PROMPTS = [
  "What is the highest-priority fix to stop wasted ad spend right now?",
  "Draft a concise Slack escalation message to our Shopify & media teams.",
  "Rewrite the ad copy so it accurately matches the live storefront state.",
] as const;

export function GeminiAssistantCard({ report }: GeminiAssistantCardProps) {
  const [prompt, setPrompt] = useState<string>("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  async function runGeminiQuery(question: string) {
    const trimmed = question.trim();
    if (trimmed.length < 3 || isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed, report }),
      });

      const body = (await response.json()) as {
        answer?: string;
        model?: string;
        error?: string;
      };

      if (!response.ok) {
        setError(body.error ?? `Gemini request failed with status ${response.status}`);
        return;
      }

      setAnswer(body.answer ?? "");
      setModelUsed(body.model ?? "gemini-4-hydrogen");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reach /api/gemini");
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runGeminiQuery(prompt);
  }

  return (
    <section
      aria-label="Remote Gemini Offer Assistant"
      className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4 sm:p-6"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-400" aria-hidden="true" />
          <h2 className="text-base font-semibold text-white">
            Remote Gemini Assistant (Optional)
          </h2>
        </div>
        <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-200">
          Server-Side · {modelUsed ?? "gemini-4-hydrogen"}
        </span>
      </div>

      <p className="mb-3 text-xs text-slate-400">
        Core X-Ray parity checks remain 100% deterministic. Query Gemini remotely on demand when
        you want remediation advice or ad-copy rewrites grounded in this report.
      </p>

      <div className="mb-3 flex flex-wrap gap-2" aria-label="Suggested Gemini prompts">
        {SUGGESTED_PROMPTS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={isLoading}
            onClick={() => {
              setPrompt(suggestion);
              void runGeminiQuery(suggestion);
            }}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-left text-xs text-slate-300 transition hover:border-violet-400/60 hover:text-white disabled:opacity-50"
          >
            {suggestion}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="gemini-query-input" className="sr-only">
          Ask Gemini about this OfferParity X-Ray report
        </label>
        <input
          id="gemini-query-input"
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask Gemini about this parity report (e.g. fastest fix for this ad set)..."
          className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/30"
        />
        <button
          type="submit"
          disabled={isLoading || prompt.trim().length < 3}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Querying...
            </>
          ) : (
            <>
              <Send className="h-4 w-4" aria-hidden="true" />
              Ask Gemini
            </>
          )}
        </button>
      </form>

      {error ? (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-950/50 px-3.5 py-2.5 text-xs text-rose-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {answer !== null ? (
        <div
          data-testid="gemini-assistant-answer"
          className="mt-3 whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950 p-3.5 text-sm leading-relaxed text-slate-200"
        >
          {answer}
        </div>
      ) : null}
    </section>
  );
}
