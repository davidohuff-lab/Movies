"use client";

import { useState } from "react";
import Image from "next/image";

interface PosterImageProps {
  primaryUrl?: string | null;
  fallbackUrl?: string | null;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
  fill?: boolean;
  sizes?: string;
}

export function PosterImage({
  primaryUrl,
  fallbackUrl,
  alt,
  className,
  width,
  height,
  fill = false,
  sizes
}: PosterImageProps) {
  const [currentSrc, setCurrentSrc] = useState<string | null>(primaryUrl ?? fallbackUrl ?? null);
  const [usedFallback, setUsedFallback] = useState(!primaryUrl && Boolean(fallbackUrl));

  if (!currentSrc) {
    return null;
  }

  return (
    <Image
      src={currentSrc}
      alt={alt}
      className={className}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      fill={fill}
      sizes={sizes}
      unoptimized
      onError={() => {
        if (!usedFallback && fallbackUrl && fallbackUrl !== currentSrc) {
          setCurrentSrc(fallbackUrl);
          setUsedFallback(true);
          return;
        }
        setCurrentSrc(null);
      }}
    />
  );
}
