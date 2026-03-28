import {
  API_BASE_URL,
  API_VERSION,
  GATEWAY_INTENTS,
  GATEWAY_VERSION,
} from "./config.js";

export function assertTokenPresent(token: string | undefined): string {
  console.log("[boot] starting fluxer bot");
  if (!token) {
    console.error("Missing bot token (DISCORD_BOT_TOKEN or FLUXER_BOT_TOKEN)");
    process.exit(1);
  }
  console.log("[boot] token present");
  console.log(
    `[boot] api=${API_BASE_URL || "(discord default)"} rest_v=${API_VERSION} gw_v=${GATEWAY_VERSION} intents=${GATEWAY_INTENTS}`,
  );
  return token;
}
