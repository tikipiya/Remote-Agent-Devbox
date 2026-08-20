import { HttpIdeAccessControlClient } from "./control-client.js";
import { loadIdeProxyConfig } from "./config.js";
import { createIdeProxyServer } from "./server.js";

const config = loadIdeProxyConfig();
const server = createIdeProxyServer(config, new HttpIdeAccessControlClient(config));

const close = (): void => {
  server.close();
};
process.once("SIGINT", close);
process.once("SIGTERM", close);

server.listen(config.RAD_IDE_PROXY_PORT, config.RAD_IDE_PROXY_HOST);
