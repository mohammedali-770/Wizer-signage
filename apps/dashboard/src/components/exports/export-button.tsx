'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';

import { getAccessToken } from '@/lib/api';
import { API_BASE_URL } from '@/lib/api-base';
import { Button, useToast } from '@/components/ui';

const BASE = API_BASE_URL;
const FORMATS: Array<{ key: string; label: string }> = [
  { key: 'CSV', label: 'CSV' },
  { key: 'XLSX', label: 'Excel' },
  { key: 'PDF', label: 'PDF (print)' },
];

/**
 * Download a tenant-scoped dataset export (Phase 10). Streams the file via an
 * authenticated fetch + blob, matching the proof-of-play export pattern.
 */
export function ExportButton({
  dataset,
  filters,
  label = 'Export',
}: {
  dataset: string;
  filters?: Record<string, string | undefined>;
  label?: string;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const download = async (format: string) => {
    setOpen(false);
    setBusy(true);
    try {
      const params = new URLSearchParams({ format });
      for (const [k, v] of Object.entries(filters ?? {})) if (v) params.set(k, v);
      const res = await fetch(`${BASE}/exports/${dataset}?${params.toString()}`, {
        headers: { authorization: `Bearer ${getAccessToken() ?? ''}` },
      });
      if (!res.ok) throw new Error('export failed');
      const blob = await res.blob();
      const ext = format === 'XLSX' ? 'xlsx' : format === 'PDF' ? 'html' : 'csv';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${dataset}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast('Export failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative inline-block">
      <Button variant="outline" onClick={() => setOpen((v) => !v)} disabled={busy}>
        <Download className="size-4" /> {busy ? 'Exporting…' : label}
      </Button>
      {open ? (
        <div className="border-border bg-card absolute end-0 z-40 mt-1 w-36 rounded-md border shadow-lg">
          {FORMATS.map((f) => (
            <button
              key={f.key}
              onClick={() => download(f.key)}
              className="hover:bg-muted block w-full px-3 py-2 text-start text-sm"
            >
              {f.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
