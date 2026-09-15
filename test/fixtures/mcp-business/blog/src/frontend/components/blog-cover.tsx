import { useEffect, useRef, useState } from "react";
import type { BlogLabels } from "../types/blog.js";

export default function BlogCover({ labels }: { labels: BlogLabels }) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  // SSR images can fail before hydration attaches onError; inspect the completed native element once mounted.
  useEffect(() => {
    if (image.current?.complete && image.current.naturalWidth === 0)
      setFailed(true);
  }, []);
  return failed ? (
    <span role="img" aria-label={labels.coverFallback}>
      {labels.coverFallback}
    </span>
  ) : (
    <img
      ref={image}
      src="/blog-cover.svg"
      alt={labels.cover}
      width="160"
      height="80"
      onError={() => setFailed(true)}
    />
  );
}
