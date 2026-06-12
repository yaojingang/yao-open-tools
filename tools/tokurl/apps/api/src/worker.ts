import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { ensureClickConsumerGroup, processClickBatch } from "./services/analytics.js";
import { createRedisClient } from "./services/redis.js";

const config = loadConfig();
const { db, sql } = createDb(config.databaseUrl);
const redis = createRedisClient(config.redisUrl);
const consumerName = `worker-${process.pid}`;
let shuttingDown = false;

async function shutdown() {
  shuttingDown = true;
  redis.disconnect();
  await sql.end();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await ensureClickConsumerGroup(redis);

console.log(`TokURL analytics worker started as ${consumerName}`);

while (!shuttingDown) {
  try {
    await processClickBatch(db, redis, consumerName);
  } catch (error) {
    console.error("Failed to process click batch", error);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
