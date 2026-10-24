import { expect, test as base } from "@playwright/test";

export interface NetGuard {
  /** Any request that left localhost, blocked by the suite. */
  external: string[];
  consoleErrors: string[];
  pageErrors: string[];
  requests: string[];
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0"]);

/**
 * Every page in this suite runs with external network access blocked. The
 * acceptance criterion is not just "the app happens not to call out": an
 * external request must be impossible during a trial.
 */
export const test = base.extend<{ net: NetGuard }>({
  net: [
    async ({ page }, use) => {
      const net: NetGuard = { external: [], consoleErrors: [], pageErrors: [], requests: [] };

      await page.route("**/*", async (route) => {
        const url = route.request().url();
        net.requests.push(url);
        let hostname: string;
        try {
          hostname = new URL(url).hostname;
        } catch {
          await route.abort("blockedbyclient");
          return;
        }
        if (LOCAL_HOSTS.has(hostname)) {
          await route.continue();
          return;
        }
        net.external.push(url);
        await route.abort("blockedbyclient");
      });

      page.on("console", (message) => {
        if (message.type() === "error") net.consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => net.pageErrors.push(error.message));

      await use(net);

      expect.soft(net.external, "external network requests were attempted").toEqual([]);
      expect.soft(net.pageErrors, "uncaught page errors").toEqual([]);
    },
    { auto: true }
  ]
});

export { expect };
