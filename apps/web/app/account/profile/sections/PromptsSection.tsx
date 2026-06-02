'use client';
// M6 editor section: Hinge-style prompts. The active prompt set comes from the DB
// (profile_prompts, hydrated server-side). A user selects up to 3, each with a
// <=200 char answer. Value shape matches profiles.prompt_answers jsonb:
// [{ prompt_id, answer }]. Tier-1 shell chrome, lowercase, >=44px targets.
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { PromptAnswer } from '@after5/validators';

export interface PromptDef {
  id: string;
  label: string;
  placeholder?: string | null;
}

const MAX_PROMPTS = 3;
const MAX_ANSWER = 200;

export function PromptsSection({
  prompts,
  value,
  onChange,
}: {
  prompts: PromptDef[];
  value: PromptAnswer[];
  onChange: (next: PromptAnswer[]) => void;
}) {
  const selectedIds = new Set(value.map((v) => v.prompt_id));
  const atCap = value.length >= MAX_PROMPTS;
  const byId = (id: string) => prompts.find((p) => p.id === id);

  function add(id: string) {
    if (atCap || selectedIds.has(id)) return;
    onChange([...value, { prompt_id: id, answer: '' }]);
  }
  function remove(id: string) {
    onChange(value.filter((v) => v.prompt_id !== id));
  }
  function setAnswer(id: string, answer: string) {
    onChange(value.map((v) => (v.prompt_id === id ? { ...v, answer } : v)));
  }

  const unselected = prompts.filter((p) => !selectedIds.has(p.id));

  return (
    <div className="space-y-4">
      <p className="font-body text-[13px] leading-relaxed text-shell-ink/60">
        pick up to three. this is what gives people something to message about.
      </p>

      {/* Selected prompts with answer fields */}
      {value.map((v) => {
        const def = byId(v.prompt_id);
        return (
          <div key={v.prompt_id} className="rounded-2xl border border-shell-ink/15 bg-white/70 p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor={`prompt-${v.prompt_id}`} className="font-body text-sm font-semibold lowercase text-shell-ink">
                {def?.label ?? v.prompt_id}
              </label>
              <button
                type="button"
                onClick={() => remove(v.prompt_id)}
                aria-label="remove prompt"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-shell-ink/50 transition hover:bg-shell-ink/10 hover:text-shell-ink"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <textarea
              id={`prompt-${v.prompt_id}`}
              value={v.answer}
              onChange={(e) => setAnswer(v.prompt_id, e.target.value)}
              maxLength={MAX_ANSWER}
              rows={2}
              placeholder={def?.placeholder ?? 'your answer…'}
              className="block w-full rounded-xl border border-shell-ink/10 bg-white/80 px-3 py-2 font-body text-[15px] text-shell-ink placeholder:text-shell-ink/35 focus:outline-none focus:ring-2 focus:ring-shell-accent/60"
            />
            <p className="mt-1 text-right font-body text-[12px] text-shell-ink/40">{v.answer.length}/{MAX_ANSWER}</p>
          </div>
        );
      })}

      {/* Pickable, unselected prompts */}
      {!atCap && unselected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {unselected.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => add(p.id)}
              disabled={atCap}
              className={cn(
                'inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 font-body text-sm lowercase transition',
                'border border-shell-ink/15 bg-white/70 text-shell-ink hover:border-shell-accent/50',
                'disabled:cursor-not-allowed disabled:opacity-40',
              )}
            >
              <Plus className="h-4 w-4 text-shell-accent" aria-hidden />
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* When at cap, still render disabled add buttons so users see what's locked */}
      {atCap && unselected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {unselected.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled
              className="inline-flex min-h-[44px] cursor-not-allowed items-center gap-1.5 rounded-full border border-shell-ink/10 bg-white/40 px-4 font-body text-sm lowercase text-shell-ink/40"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
