import { serve } from "@hono/node-server";
import { Store } from "./store.js";
import { createBot } from "./bot.js";
import { createApp } from "./server.js";

try {
  process.loadEnvFile();
} catch {
  // no .env file: rely on the real environment
}

for (const key of ["TELEGRAM_BOT_TOKEN", "PUBLIC_BASE_URL"]) {
  if (!process.env[key]) {
    console.error(`Missing ${key}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

const baseUrl = process.env.PUBLIC_BASE_URL!.replace(/\/$/, "");
const port = Number(process.env.PORT ?? 8787);

const store = new Store();
const { bot, announceRound, notify } = createBot({ token: process.env.TELEGRAM_BOT_TOKEN!, baseUrl, store });
const app = createApp({ store, announceRound, notify });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Web on http://localhost:${info.port} (public: ${baseUrl})`);
});

if (!process.env.ATTRIBUTION_TAG) {
  console.warn("ATTRIBUTION_TAG is not set. Pay pages will refuse to send transactions until it is.");
}

await bot.start({ onStart: (me) => console.log(`Bot @${me.username} is listening`) });
