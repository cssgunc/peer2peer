"use client";

import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

import { ApiError } from "@/lib/api";

const isClientError = (error: unknown) =>
  error instanceof ApiError && error.status >= 400 && error.status < 500;

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          // An expired or revoked session fails every query the same way; send the user to sign in once.
          onError: (error) => {
            if (error instanceof ApiError && error.status === 401) {
              router.replace("/portal/sign-in");
            } else if (
              error instanceof ApiError &&
              error.code === "password_change_required"
            ) {
              router.replace("/portal/password");
            }
          },
        }),
        defaultOptions: {
          queries: {
            // Retrying a 4xx can't succeed and only delays the 401 redirect.
            retry: (failureCount, error) =>
              !isClientError(error) && failureCount < 3,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
