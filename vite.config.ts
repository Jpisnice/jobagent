import adapter from "@sveltejs/adapter-auto";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { eveSvelteKit } from "eve/sveltekit";
import { type Plugin, defineConfig } from "vite";

// `svelte-kit sync` and `svelte-check` load this config only for types. Skip eve there: it would
// boot a whole agent dev server just to exit again (and svelte-check's lowercased `c:` root breaks it).
const typegenOnly = /svelte-(kit|check)/.test(process.argv[1] ?? "");

/**
 * Starts `eve dev` for this Vite process and points eveSvelteKit() at it through EVE_BASE_URL.
 *
 * eveSvelteKit() can start eve itself, but it takes the first URL eve prints as the server's
 * address. When the agent bundle builds slowly, eve first prints a bundler warning that links to
 * https://rolldown.rs, and every /eve/v1 request is then proxied there and 404s. Reading the
 * "server listening at" line avoids that, and gives each dev server its own agent instead of one
 * shared through .eve/ that dies with whichever process started it.
 */
function eveDevServer(): Plugin {
  return {
    name: "jobagent:eve-dev-server",
    async config(_config, env) {
      if (env.command !== "serve") return;
      // Reuse a local agent server already set for this process (ours after a Vite restart, or one
      // you started yourself). Anything else, like the bad https://rolldown.rs, gets replaced.
      if (/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+/.test(process.env.EVE_BASE_URL ?? "")) return;
      const eveBin = join(dirname(createRequire(import.meta.url).resolve("eve/package.json")), "bin", "eve.js");
      const proc = spawn(process.execPath, [eveBin, "dev", "--no-ui", "--port", "0"], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const origin = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("eve dev did not report its server URL within 60s.")), 60_000);
        let seen = "";
        const onOutput = (chunk: Buffer, sink: NodeJS.WriteStream) => {
          sink.write(chunk);
          seen = (seen + chunk.toString("utf8")).slice(-4096);
          // A fresh server says "server listening at <url>". eve allows one dev server per agent, so
          // when another `npm run dev` already has one it exits and names that one; reuse it.
          const match =
            /server listening at (https?:\/\/[^\s/]+)/.exec(seen) ??
            /remote connect --url (https?:\/\/[^\s/]+)/.exec(seen);
          if (match) {
            clearTimeout(timeout);
            resolve(match[1]);
          }
        };
        proc.stdout?.on("data", (chunk: Buffer) => onOutput(chunk, process.stdout));
        proc.stderr?.on("data", (chunk: Buffer) => onOutput(chunk, process.stderr));
        proc.once("exit", (code) => {
          clearTimeout(timeout);
          reject(new Error(`eve dev exited (code ${code}) before its server started.`));
        });
      });
      // Set once per process: Vite restarts (e.g. after a config edit) reuse this agent server.
      process.env.EVE_BASE_URL = origin;
      process.once("exit", () => {
        if (!proc.killed) proc.kill();
      });
    },
  };
}

// eveSvelteKit() must come before sveltekit(): in dev it proxies /eve/v1/** to the agent, and on
// Vercel builds it adds the eve service next to the SvelteKit app.
export default defineConfig({
  plugins: [
    tailwindcss(),
    ...(typegenOnly ? [] : [eveDevServer(), eveSvelteKit()]),
    sveltekit({ adapter: adapter() }),
  ],
});
