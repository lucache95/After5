import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DateCanvas } from '../DateCanvas';

vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const itin = {
  id: 'it1', title: 'Golden Hour', hook: 'two hours, one sunset',
  stops: [{ place_id: 'p1', place_name: 'Mission Hill', start_time: '18:00', duration_min: 60, estimated_cost_pp: 20 }],
  total_cost_pp: 20, total_duration_min: 60, why_it_works: 'x', vibe: ['romantic'], cover_image_url: '/x.jpg',
};

it('renders the night and the edit chips', () => {
  render(<DateCanvas itinerary={itin as never} />);
  screen.getByText('Golden Hour');
  screen.getByText('Mission Hill');
  screen.getByRole('button', { name: /title/i });
  screen.getByRole('button', { name: /image/i });
  screen.getByRole('button', { name: /stops/i });
  const publish = screen.getByRole('link', { name: /publish/i });
  expect(publish.getAttribute('href')).toBe('/nights/new?itinerary=it1');
});

it('shows a first-run hint and a quiet start over', () => {
  render(<DateCanvas itinerary={itin as never} />);
  screen.getByText(/tap any chip to make it yours/i);
  screen.getByRole('button', { name: /start over/i });
});
