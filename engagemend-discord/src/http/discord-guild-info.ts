import { env } from '../config/env.js';
export async function fetchDiscordGuildName(guildId: string): Promise<string> { const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, { headers: { Authorization: `Bot ${env.DISCORD_TOKEN}` } }); if (!response.ok) throw new Error(`Discord API respondeu ${response.status}`); return (await response.json() as { name: string }).name; }
