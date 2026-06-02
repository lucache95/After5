import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditableStopCard } from '../EditableStopCard';
import { CoverPicker } from '../CoverPicker';

describe('EditableStopCard', () => {
  it('edits the name + fires onPatch, and remove fires onRemove', async () => {
    const onPatch = vi.fn(); const onRemove = vi.fn();
    render(<EditableStopCard stop={{ place_id: 'p1', place_name: 'clay', start_time: '18:00', duration_min: 60, estimated_cost_pp: 20 }} index={0} onPatch={onPatch} onRemove={onRemove} />);
    const name = screen.getByLabelText(/name/i);
    fireEvent.change(name, { target: { value: 'pottery' } });
    expect(onPatch).toHaveBeenCalledWith(0, expect.objectContaining({ place_name: 'pottery' }));
    await userEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledWith(0);
  });
});

describe('CoverPicker', () => {
  it('renders stop photos and fires onPick', async () => {
    const onPick = vi.fn();
    render(<CoverPicker photos={['a.jpg', 'b.jpg']} current="a.jpg" onPick={onPick} />);
    const opts = screen.getAllByRole('button', { name: /use this cover/i });
    await userEvent.click(opts[1]);
    expect(onPick).toHaveBeenCalledWith('b.jpg');
  });
});
