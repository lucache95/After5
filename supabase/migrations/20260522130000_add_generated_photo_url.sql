-- Add generated_photo_url column for AI-generated place cover images.
-- Places without a Google photo get a Gemini-generated editorial cover
-- uploaded to the `place-covers` storage bucket. This URL is the fallback
-- between photo_url (real Google photo) and the generic type-based image.
ALTER TABLE public.places
  ADD COLUMN IF NOT EXISTS generated_photo_url text;

COMMENT ON COLUMN public.places.generated_photo_url IS
  'URL of an AI-generated (Gemini) editorial cover image in the place-covers bucket. Used as fallback when photo_url is NULL.';
