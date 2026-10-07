import type { Source } from "./types";
import { ashby, greenhouse, lever, recruitee, smartrecruiters, workable } from "./ats";
import { arbeitnow, himalayas, hnHiring, jobicy, remoteok, remotive, weworkremotely } from "./boards";

export type { Job, Source, SourceResult } from "./types";

export const sources: Record<string, Source> = Object.fromEntries(
  [remoteok, remotive, himalayas, arbeitnow, jobicy, weworkremotely, hnHiring,
   greenhouse, lever, ashby, workable, smartrecruiters, recruitee].map((s) => [s.id, s]),
);

export const sourceIds = Object.keys(sources);
