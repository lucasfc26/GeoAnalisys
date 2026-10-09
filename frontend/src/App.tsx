import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Toaster } from '@/components/ui/Toaster';
import { ApiError } from '@/lib/api';

const MapPage = lazy(() => import('@/pages/MapPage'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (count, err) => {
        // Não repete erros de validação/requisição; tenta de novo falhas transitórias.
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
        return count < 2;
      },
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-7 animate-spin text-accent-600" />
          </div>
        }
      >
        <MapPage />
      </Suspense>
      <Toaster />
    </QueryClientProvider>
  );
}
