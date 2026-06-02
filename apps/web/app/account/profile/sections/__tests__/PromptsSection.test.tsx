import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { PromptsSection } from '../PromptsSection';
import type { PromptAnswer } from '@after5/validators';

// Controlled component → a tiny stateful harness mirrors how ProfileEditor drives it.
function Harness({ initial = [], spy }: { initial?: PromptAnswer[]; spy: (v: PromptAnswer[]) => void }) {
  const [value, setValue] = useState<PromptAnswer[]>(initial);
  return (
    <PromptsSection
      prompts={PROMPTS}
      value={value}
      onChange={(next) => { setValue(next); spy(next); }}
    />
  );
}

const PROMPTS = [
  { id: 'two_truths', label: 'two truths and a lie', placeholder: 'make me guess…' },
  { id: 'green_flag', label: 'green flag energy', placeholder: 'what wins me over…' },
  { id: 'the_ick', label: "the ick i'd die on", placeholder: 'be honest…' },
  { id: 'roman_empire', label: 'my roman empire', placeholder: 'daily…' },
];

describe('PromptsSection', () => {
  it('selecting a prompt and typing an answer calls onChange with {prompt_id, answer}', () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /two truths and a lie/i }));
    const ta = screen.getByLabelText(/two truths and a lie/i);
    fireEvent.change(ta, { target: { value: 'hello there' } });
    const last = spy.mock.calls.at(-1)![0];
    expect(last).toEqual([{ prompt_id: 'two_truths', answer: 'hello there' }]);
  });

  it('enforces a max of 3 selected prompts', () => {
    const value = [
      { prompt_id: 'two_truths', answer: 'a' },
      { prompt_id: 'green_flag', answer: 'b' },
      { prompt_id: 'the_ick', answer: 'c' },
    ];
    render(<PromptsSection prompts={PROMPTS} value={value} onChange={vi.fn()} />);
    // The 4th, unselected prompt's add button should be disabled at the cap.
    const addRoman = screen.getByRole('button', { name: /my roman empire/i });
    expect(addRoman).toBeDisabled();
  });

  it('caps each answer at 200 chars', () => {
    render(<PromptsSection prompts={PROMPTS} value={[{ prompt_id: 'two_truths', answer: 'x' }]} onChange={vi.fn()} />);
    const ta = screen.getByLabelText(/two truths and a lie/i) as HTMLTextAreaElement;
    expect(ta.maxLength).toBe(200);
  });
});
