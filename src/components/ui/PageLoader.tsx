import { Loader2 } from 'lucide-react';

export function PageLoader() {
  return (
    <div className="flex h-full min-h-[50vh] w-full flex-col items-center justify-center gap-3 text-pf-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-pf-primary" aria-hidden="true" />
      <span className="text-sm">加载中…</span>
    </div>
  );
}
