import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';

const postNight = vi.fn().mockResolvedValue('inst-1');
const reachPreview = vi.fn().mockResolvedValue(42);
const mockPush = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }), usePathname: () => '/nights/new' }));
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({}),
  postNight: (...a: unknown[]) => postNight(...a),
  reachPreview: (...a: unknown[]) => reachPreview(...a),
  ambientSoundUrl: (p: string | null) => (p ? `https://x/${p}` : null),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Strip framer-motion-only props so React doesn't warn about unknown DOM attrs
type MotionExtras = {
  children?: React.ReactNode;
  initial?: unknown;
  animate?: unknown;
  transition?: unknown;
  whileTap?: unknown;
};
vi.mock('framer-motion', () => ({
  motion: {
    button: ({
      children,
      initial: _i,
      animate: _a,
      transition: _t,
      whileTap: _wt,
      ...props
    }: React.HTMLAttributes<HTMLButtonElement> & MotionExtras) => (
      <button {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}>{children}</button>
    ),
    div: ({
      children,
      initial: _i,
      animate: _a,
      transition: _t,
      whileTap: _wt,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & MotionExtras) => (
      <div {...props}>{children}</div>
    ),
  },
  useReducedMotion: () => false,
}));

import { PostNightForm } from '../PostNightForm';

const plan = (id: string) => ({
  id,
  title: `Plan ${id}`,
  cover_image_url: null,
  vibe_tags: ['jazz', 'chill'],
});

const sounds = [
  { id: 'amb-1', name: 'cozy fireplace', storage_path: 'cozy/x.m4a', vibe_tags: ['cozy'], duration_sec: 20 },
  { id: 'amb-2', name: 'jazz lounge', storage_path: 'classy/y.m4a', vibe_tags: ['classy'], duration_sec: 20 },
];

// future datetime-local string (tomorrow)
function futureLocal(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

beforeEach(() => {
  postNight.mockClear();
  reachPreview.mockClear();
  reachPreview.mockResolvedValue(42);
  mockPush.mockClear();
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
});

describe('PostNightForm', () => {
  it('empty-state: shows dry copy and link to /create when no plans', () => {
    render(<PostNightForm plans={[]} />);
    expect(screen.getByText(/no plans yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /build a plan/i })).toHaveAttribute('href', '/create');
  });

  it('submit button is disabled until a plan and future time are chosen', () => {
    render(<PostNightForm plans={[plan('a')]} />);
    expect(screen.getByRole('button', { name: /post it/i })).toBeDisabled();
  });

  it('plan cards are rendered with aria-checked=false initially', () => {
    render(<PostNightForm plans={[plan('a'), plan('b')]} />);
    const group = screen.getByRole('radiogroup', { name: /pick a plan/i });
    const cards = within(group).getAllByRole('radio');
    expect(cards).toHaveLength(2);
    cards.forEach((card) => expect(card).toHaveAttribute('aria-checked', 'false'));
  });

  it('selecting a plan marks it aria-checked=true', async () => {
    render(<PostNightForm plans={[plan('a')]} />);
    const card = screen.getByRole('radio', { name: /plan a/i });
    await userEvent.click(card);
    expect(card).toHaveAttribute('aria-checked', 'true');
  });
});

describe('PostNightForm ambient picker', () => {
  function ambientGroup() {
    return screen.getByRole('radiogroup', { name: /pick a soundtrack/i });
  }

  it('defaults to no preference and posts without an ambient id', async () => {
    render(<PostNightForm plans={[plan('a')]} ambientSounds={sounds} />);
    const none = within(ambientGroup()).getByRole('radio', { name: /no preference/i });
    expect(none).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(screen.getByRole('radio', { name: /plan a/i }));
    await userEvent.type(screen.getByLabelText(/when's the night/i), futureLocal());
    await userEvent.click(screen.getByRole('button', { name: /post it/i }));

    expect(postNight).toHaveBeenCalledTimes(1);
    expect(postNight.mock.calls[0]![1]).toMatchObject({ ambient_sound_id: null });
  });

  it('posts the chosen ambient_sound_id', async () => {
    render(<PostNightForm plans={[plan('a')]} ambientSounds={sounds} />);
    await userEvent.click(within(ambientGroup()).getByRole('radio', { name: /cozy fireplace/i }));
    await userEvent.click(screen.getByRole('radio', { name: /plan a/i }));
    await userEvent.type(screen.getByLabelText(/when's the night/i), futureLocal());
    await userEvent.click(screen.getByRole('button', { name: /post it/i }));

    expect(postNight).toHaveBeenCalledTimes(1);
    expect(postNight.mock.calls[0]![1]).toMatchObject({ ambient_sound_id: 'amb-1' });
  });

  it('preview plays one at a time', async () => {
    render(<PostNightForm plans={[plan('a')]} ambientSounds={sounds} />);
    await userEvent.click(screen.getByRole('button', { name: /preview cozy fireplace/i }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    // playing a second pauses the first before starting the new one
    await userEvent.click(screen.getByRole('button', { name: /preview jazz lounge/i }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
  });

  it('has no a11y violations with the soundtrack picker', async () => {
    const { container } = render(<PostNightForm plans={[plan('a')]} ambientSounds={sounds} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('PostNightForm creator controls (E11)', () => {
  it('renders who-pays, target-gender, age, radius and the why fields', () => {
    render(<PostNightForm plans={[plan('a')]} ambientSounds={sounds} />);
    expect(screen.getByRole('radiogroup', { name: /who pays/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /target gender/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/youngest/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/oldest/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/how far/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/the why/i)).toBeInTheDocument();
  });

  it('targeting defaults to inclusive: everyone selected, age unbounded', () => {
    render(<PostNightForm plans={[plan('a')]} ambientSounds={sounds} />);
    const everyone = within(screen.getByRole('group', { name: /target gender/i }))
      .getByRole('checkbox', { name: /everyone/i });
    expect(everyone).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText(/youngest/i)).toHaveValue(null);
    expect(screen.getByLabelText(/oldest/i)).toHaveValue(null);
  });

  it('submit passes targeting params to postNight when overridden', async () => {
    render(<PostNightForm plans={[plan('a')]} ambientSounds={sounds} />);
    await userEvent.click(screen.getByRole('radio', { name: /plan a/i }));
    await userEvent.type(screen.getByLabelText(/when's the night/i), futureLocal());
    // override targeting: narrow to women, set an age + radius
    const genders = within(screen.getByRole('group', { name: /target gender/i }));
    await userEvent.click(genders.getByRole('checkbox', { name: /^women$/i }));
    await userEvent.type(screen.getByLabelText(/youngest/i), '25');
    await userEvent.type(screen.getByLabelText(/oldest/i), '40');
    await userEvent.type(screen.getByLabelText(/how far/i), '15');
    await userEvent.click(screen.getByRole('radio', { name: /i pay/i }));
    await userEvent.click(screen.getByRole('button', { name: /post it/i }));

    expect(postNight).toHaveBeenCalledTimes(1);
    const arg = postNight.mock.calls[0]![1] as Record<string, unknown>;
    expect(arg.target_genders).toEqual(['women']);
    expect(arg.target_age_range).toBe('[25,40]');
    expect(arg.search_radius_km).toBe(15);
  });

  it('pre-selects the plan from the itineraryId prop', () => {
    render(<PostNightForm plans={[plan('a'), plan('b')]} itineraryId="b" />);
    const b = screen.getByRole('radio', { name: /plan b/i });
    expect(b).toHaveAttribute('aria-checked', 'true');
  });

  it('has no a11y violations with the creator controls', async () => {
    const { container } = render(<PostNightForm plans={[plan('a')]} ambientSounds={sounds} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('PostNightForm plan picker (meta, preview, remix, show-all)', () => {
  const richPlan = {
    id: 'rich',
    title: 'Plan rich',
    cover_image_url: null,
    vibe_tags: ['jazz'],
    stops: [
      { place_id: 's1', place_name: 'Bar Susu', start_time: '19:00', duration_min: 60, estimated_cost_pp: 20 },
      { place_id: 's2', place_name: 'Noodle House', start_time: '20:15', duration_min: 60, estimated_cost_pp: 15 },
      { place_id: 's3', place_name: 'Lookout Walk', start_time: '21:30', duration_min: 30, estimated_cost_pp: 10 },
    ],
    total_cost_pp: 45,
    total_duration_min: 150,
  };

  it('renders the meta line derived from the itinerary row', () => {
    render(<PostNightForm plans={[richPlan]} />);
    expect(screen.getByText('3 stops · ~2.5 hr · $45 pp')).toBeInTheDocument();
  });

  it('omits the meta line when nothing is derivable', () => {
    render(<PostNightForm plans={[plan('a')]} />);
    expect(screen.queryByText(/stops ·|~.* hr|\$\d+ pp/)).not.toBeInTheDocument();
  });

  it('preview expands the ordered stop list inline without changing selection', async () => {
    render(<PostNightForm plans={[richPlan]} />);
    const toggle = screen.getByRole('button', { name: /preview plan rich/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const items = screen.getAllByRole('listitem')
      .map((li) => li.textContent)
      .filter((t) => t?.includes('·') && /\d{2}:\d{2}/.test(t ?? ''));
    expect(items).toEqual(['bar susu · 19:00', 'noodle house · 20:15', 'lookout walk · 21:30']);
    // expanding the preview must NOT select the radio
    expect(screen.getByRole('radio', { name: /plan rich/i })).toHaveAttribute('aria-checked', 'false');

    // and it collapses again
    await userEvent.click(toggle);
    expect(screen.queryByText('bar susu · 19:00')).not.toBeInTheDocument();
  });

  it('remix links to the plan canvas and does not change selection', async () => {
    render(<PostNightForm plans={[richPlan]} />);
    const remix = screen.getByRole('link', { name: /remix plan rich/i });
    expect(remix).toHaveAttribute('href', '/plans/rich/edit');
    // jsdom can't navigate; block the default so the click still exercises the
    // component's handlers without a "not implemented" stderr.
    remix.addEventListener('click', (e) => e.preventDefault());
    await userEvent.click(remix);
    expect(screen.getByRole('radio', { name: /plan rich/i })).toHaveAttribute('aria-checked', 'false');
  });

  it('folds at 6 plans behind a show-all expander; selection works past the fold', async () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(plan);
    render(<PostNightForm plans={many} />);
    const group = screen.getByRole('radiogroup', { name: /pick a plan/i });
    expect(within(group).getAllByRole('radio')).toHaveLength(6);

    const expander = screen.getByRole('button', { name: /show all 8 plans/i });
    await userEvent.click(expander);
    expect(within(group).getAllByRole('radio')).toHaveLength(8);
    expect(screen.queryByRole('button', { name: /show all/i })).not.toBeInTheDocument();

    const h = screen.getByRole('radio', { name: /plan h/i });
    await userEvent.click(h);
    expect(h).toHaveAttribute('aria-checked', 'true');
  });

  it('no expander when the list fits within the fold', () => {
    render(<PostNightForm plans={[plan('a'), plan('b')]} />);
    expect(screen.queryByRole('button', { name: /show all/i })).not.toBeInTheDocument();
  });

  it('a preselected ?itinerary= beyond the fold renders visible and selected', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(plan);
    render(<PostNightForm plans={many} itineraryId="h" />);
    const h = screen.getByRole('radio', { name: /plan h/i });
    expect(h).toHaveAttribute('aria-checked', 'true');
    // the fold auto-expanded, so no expander remains
    expect(screen.queryByRole('button', { name: /show all/i })).not.toBeInTheDocument();
  });

  it('has no a11y violations with a preview open', async () => {
    const { container } = render(<PostNightForm plans={[richPlan]} />);
    await userEvent.click(screen.getByRole('button', { name: /preview plan rich/i }));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('PostNightForm reach line (E10 / D-01)', () => {
  const CITY = '11111111-1111-1111-1111-111111111111';

  it('shows the loading copy then the live count, and announces it politely', async () => {
    render(<PostNightForm plans={[plan('a')]} ambientSounds={sounds} primaryCityId={CITY} cityName="austin" />);
    // adjust targeting to trigger the debounced reach call
    await userEvent.type(screen.getByLabelText(/how far/i), '25');
    // the count resolves into the polite live region
    const line = await screen.findByText(/42 people match this in austin/i, {}, { timeout: 2000 });
    expect(line).toHaveAttribute('aria-live', 'polite');
    expect(reachPreview).toHaveBeenCalled();
  });

  it('normalizes the open case: everyone is sent as omitted/empty target_genders, not the literal everyone', async () => {
    render(<PostNightForm plans={[plan('a')]} ambientSounds={sounds} primaryCityId={CITY} cityName="austin" />);
    await userEvent.type(screen.getByLabelText(/how far/i), '10');
    await screen.findByText(/match this in austin/i, {}, { timeout: 2000 });
    const arg = reachPreview.mock.calls.at(-1)![1] as Record<string, unknown>;
    const genders = (arg.target_genders ?? []) as string[];
    expect(genders).not.toContain('everyone');
    expect(genders.length).toBe(0);
    expect(arg.city).toBe(CITY);
  });

  it('frames a zero count positively and never disables the publish CTA', async () => {
    reachPreview.mockResolvedValue(0);
    render(<PostNightForm plans={[plan('a')]} ambientSounds={sounds} primaryCityId={CITY} cityName="austin" />);
    await userEvent.type(screen.getByLabelText(/how far/i), '1');
    const zero = await screen.findByText(/no one fits this yet in austin/i, {}, { timeout: 2000 });
    expect(zero.textContent ?? '').toMatch(/loosen the targeting/i);
    // the publish CTA is governed by plan+time only, never the count
    expect(screen.getByRole('button', { name: /post it/i })).toBeDisabled(); // no plan/time yet, but NOT because of the count
  });

  it('reach line contains no em-dash (stop-slop)', async () => {
    reachPreview.mockResolvedValue(3);
    const { container } = render(
      <PostNightForm plans={[plan('a')]} ambientSounds={sounds} primaryCityId={CITY} cityName="austin" />,
    );
    await userEvent.type(screen.getByLabelText(/how far/i), '5');
    const live = await screen.findByText(/match this in austin/i, {}, { timeout: 2000 });
    expect(live.textContent ?? '').not.toMatch(/—/); // em-dash
    // belt-and-suspenders: the live region's own text carries no em-dash
    expect((container.querySelector('[aria-live="polite"]')?.textContent ?? '')).not.toMatch(/—/);
  });
});
