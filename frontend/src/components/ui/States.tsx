import clsx from 'clsx';
import { AlertTriangle, DatabaseZap, RefreshCw, WifiOff, Clock } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { Button } from './Button';

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded bg-slate-200', className)} />;
}

export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Carregando">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      {icon && <div className="mb-3 text-slate-300">{icon}</div>}
      <p className="font-medium text-slate-700">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

const ERROR_LOOK: Record<string, { icon: ReactNode; title: string }> = {
  OFFLINE: { icon: <WifiOff className="size-7" />, title: 'Você está offline' },
  TIMEOUT: { icon: <Clock className="size-7" />, title: 'Tempo de resposta excedido' },
  NETWORK: { icon: <DatabaseZap className="size-7" />, title: 'API indisponível' },
  DATABASE_UNAVAILABLE: { icon: <DatabaseZap className="size-7" />, title: 'Banco de dados indisponível' },
};

export function ErrorState({
  error,
  title = 'Não foi possível carregar os dados.',
  onRetry,
  compact,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const code = error instanceof ApiError ? error.code : '';
  const look = ERROR_LOOK[code];
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div
      role="alert"
      className={clsx('flex flex-col items-center text-center', compact ? 'gap-1.5 p-3' : 'gap-2 px-6 py-8')}
    >
      <div className="text-red-500">{look?.icon ?? <AlertTriangle className={compact ? 'size-5' : 'size-7'} />}</div>
      <p className="font-medium text-slate-800">{look?.title ?? title}</p>
      <p className="max-w-sm text-sm break-words text-slate-500">{message}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry} icon={<RefreshCw className="size-3.5" />} className="mt-1">
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'accent' | 'amber' | 'red' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    accent: 'bg-accent-100 text-accent-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-700',
  };
  return <span className={clsx('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>;
}
