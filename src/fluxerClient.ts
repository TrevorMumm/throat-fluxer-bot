import { Client } from "@discordjs/core";
import { REST } from "@discordjs/rest";
import { WebSocketManager } from "@discordjs/ws";
import {
  API_BASE_URL,
  API_VERSION,
  GATEWAY_INTENTS,
  GATEWAY_VERSION,
  IS_DISCORD,
} from "./config.js";

export function createFluxerClient(token: string): {
  rest: REST;
  gateway: WebSocketManager;
  client: Client;
} {
  const restOptions: ConstructorParameters<typeof REST>[0] = {
    version: API_VERSION,
  };

  // Fluxer instances use a custom API base URL and forwarded-for header.
  // Discord instances use the default discord.js URL (discord.com/api).
  if (!IS_DISCORD && API_BASE_URL) {
    restOptions.api = API_BASE_URL;
    restOptions.headers = { "X-Forwarded-For": "127.0.0.1" };
  }

  const rest = new REST(restOptions).setToken(token);

  const gateway = new WebSocketManager({
    token,
    intents: IS_DISCORD ? GATEWAY_INTENTS : 0,
    version: GATEWAY_VERSION,
    rest,
  });

  const client = new Client({ rest, gateway });

  gateway.on("error", (error) => {
    console.error("Gateway error:", error);
  });

  return { rest, gateway, client };
}
