import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false
    },
    mutations: { retry: false }
  }
});

export function clearSecretBoundQueryState(): void {
  queryClient.cancelQueries();
  queryClient.clear();
}
