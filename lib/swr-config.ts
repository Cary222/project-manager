import type { SWRConfiguration } from "swr";

export const STALE_SWR_OPTIONS: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateIfStale: false,
  keepPreviousData: true,
};
