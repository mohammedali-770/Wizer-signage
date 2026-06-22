'use client';

import { ExternalLink } from 'lucide-react';

import { useApiResource } from '@/lib/use-api';
import type { ContentPreviewData, ContentType } from '@/lib/types';
import { Spinner } from '@/components/ui';

/**
 * Renders a preview for a content item by fetching its preview payload
 * (`/content/:id/preview` → signed URL for files, or the URL/text body).
 * Falls back to a safe open-link affordance when embedding isn't possible.
 */
export function ContentPreview({
  contentId,
  type,
  className,
}: {
  contentId: string;
  type: ContentType;
  className?: string;
}) {
  const { data, loading, error } = useApiResource<ContentPreviewData>(
    `/content/${contentId}/preview`,
  );

  if (loading) {
    return (
      <div
        className={`border-border bg-muted/30 flex items-center justify-center rounded-lg border p-8 ${className ?? ''}`}
      >
        <Spinner className="text-primary size-5" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div
        className={`border-border bg-muted/30 text-muted-foreground rounded-lg border p-6 text-center text-sm ${className ?? ''}`}
      >
        Preview unavailable.
      </div>
    );
  }

  const box = `overflow-hidden rounded-lg border border-border bg-black/5 ${className ?? ''}`;

  if (type === 'IMAGE' && data.url) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img src={data.url} alt="Preview" className={`max-h-[60vh] w-full object-contain ${box}`} />
    );
  }
  if (type === 'VIDEO' && data.url) {
    return <video src={data.url} controls className={`max-h-[60vh] w-full ${box}`} />;
  }
  if (type === 'PDF' && data.url) {
    return (
      <div>
        <iframe src={data.url} title="PDF preview" className={`h-[60vh] w-full ${box}`} />
        <OpenLink url={data.url} label="Open PDF in a new tab" />
      </div>
    );
  }
  if (type === 'URL' && data.url) {
    return (
      <div>
        <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          External page preview. Some sites block embedding — use “Open” if it appears blank.
        </div>
        <iframe
          src={data.url}
          title="URL preview"
          sandbox="allow-scripts allow-same-origin allow-popups"
          className={`h-[55vh] w-full ${box}`}
        />
        <OpenLink url={data.url} label="Open link in a new tab" />
      </div>
    );
  }
  if (type === 'TEXT') {
    return (
      <div
        className={`flex min-h-[200px] items-center justify-center p-8 text-center text-xl font-medium ${box}`}
      >
        {data.textBody}
      </div>
    );
  }
  return (
    <div className={`text-muted-foreground p-6 text-center text-sm ${box}`}>
      No preview available.
    </div>
  );
}

function OpenLink({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary mt-2 inline-flex items-center gap-1 text-sm hover:underline"
    >
      <ExternalLink className="size-3.5" /> {label}
    </a>
  );
}
