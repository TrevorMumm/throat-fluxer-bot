import type { Command } from "../types/command.js";

export const name: Command["name"] = "insult";

export const execute: Command["execute"] = async (
	client,
	message,
): Promise<void> => {
	try {
		const response = await fetch(
			"https://evilinsult.com/generate_insult.php?lang=en&type=json",
		);

		if (!response.ok) {
			await client.api.channels.createMessage(message.channel_id, {
				content: "Failed to fetch an insult. Try again later!",
			});
			return;
		}

		const data = (await response.json()) as { insult: string };

		await client.api.channels.createMessage(message.channel_id, {
			content: data.insult,
		});
	} catch {
		await client.api.channels.createMessage(message.channel_id, {
			content: "Something went wrong fetching an insult. Try again later!",
		});
	}
};
