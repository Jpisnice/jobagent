export interface Job {
  title: string;
  company: string;
  location: string;
  url: string;
  source: string;
  description?: string;
}

export interface SourceResult {
  jobs: Job[];
  errors: string[];
}

export interface Source {
  id: string;
  // "board" sources are single feeds; "ats" sources run once per company slug.
  kind: "board" | "ats";
  run(slugs: string[]): Promise<SourceResult>;
}
