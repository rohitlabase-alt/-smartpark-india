import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp();

app.listen(config.port, () => {
  console.log(
    `[api] SmartPark India API listening on http://localhost:${config.port} ` +
      `(env: ${config.nodeEnv})`
  );
});