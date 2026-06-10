import type { Metadata } from 'next';
import { TellUsForm } from './TellUsForm';

export const metadata: Metadata = {
  title: 'tell us',
  description: 'something broke? a spot we\'re missing? a wish? send a note — read same day.',
};

export default function TellUsPage() {
  return <TellUsForm />;
}
