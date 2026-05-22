'use client';

import Image from 'next/image';
import { useCallback, useState } from 'react';

const FALLBACK_SRC = '/places/place-walk.jpg';

interface SafeCoverImageProps {
  src: string;
  alt: string;
  fill?: boolean;
  sizes?: string;
  className?: string;
  priority?: boolean;
}

export function SafeCoverImage({
  src,
  alt,
  fill,
  sizes,
  className,
  priority,
}: SafeCoverImageProps) {
  const [currentSrc, setCurrentSrc] = useState(src);
  const [showGradient, setShowGradient] = useState(false);

  const handleError = useCallback(() => {
    if (currentSrc !== FALLBACK_SRC) {
      setCurrentSrc(FALLBACK_SRC);
    } else {
      setShowGradient(true);
    }
  }, [currentSrc]);

  if (showGradient) {
    return (
      <div
        className={className}
        style={{
          background: 'linear-gradient(135deg, #F4ECDD 0%, rgba(194,85,43,0.25) 100%)',
          position: fill ? 'absolute' : 'relative',
          inset: fill ? 0 : undefined,
          width: fill ? undefined : '100%',
          height: fill ? undefined : '100%',
        }}
      />
    );
  }

  return (
    <Image
      src={currentSrc}
      alt={alt}
      fill={fill}
      sizes={sizes}
      priority={priority}
      className={className}
      onError={handleError}
    />
  );
}
