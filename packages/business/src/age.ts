// packages/business/src/age.ts
export function ageFromBirthdate(birthdate: string, at: Date = new Date()): number {
  const bd = new Date(birthdate + 'T00:00:00Z');
  let age = at.getUTCFullYear() - bd.getUTCFullYear();
  const m = at.getUTCMonth() - bd.getUTCMonth();
  if (m < 0 || (m === 0 && at.getUTCDate() < bd.getUTCDate())) age--;
  return age;
}
export const MIN_DATING_AGE = 18;
export function isAdult(birthdate: string, at: Date = new Date()): boolean {
  return ageFromBirthdate(birthdate, at) >= MIN_DATING_AGE;
}
