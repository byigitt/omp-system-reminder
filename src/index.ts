import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const FLAG_NAME = "system-reminder";
const PROJECT_FILE = ".omp/SYSTEM_REMINDER.md";
const USER_FILE = "SYSTEM_REMINDER.md";

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

function userAgentDir(): string {
	const configured = process.env.PI_CODING_AGENT_DIR?.trim();
	if (configured) {
		const expanded = expandHome(configured);
		return isAbsolute(expanded) ? expanded : join(process.cwd(), expanded);
	}

	const profile = process.env.OMP_PROFILE?.trim();
	return profile ? join(homedir(), ".omp", "profiles", profile, "agent") : join(homedir(), ".omp", "agent");
}

function readReminderFile(path: string): string | undefined {
	if (!existsSync(path)) return undefined;
	const reminder = readFileSync(path, "utf8").trim();
	return reminder || undefined;
}

function configuredReminder(pi: ExtensionAPI, cwd: string): string | undefined {
	const flag = pi.getFlag(FLAG_NAME);
	if (typeof flag === "string" && flag.trim()) return flag.trim();

	const environment = process.env.OMP_SYSTEM_REMINDER?.trim();
	if (environment) return environment;

	return readReminderFile(join(cwd, PROJECT_FILE)) ?? readReminderFile(join(userAgentDir(), USER_FILE));
}

function writeReminderFile(path: string, reminder: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${reminder.trim()}\n`, "utf8");
}

function reminderMessage(reminder: string) {
	return {
		role: "developer" as const,
		content: `<system-reminder>\n${reminder}\n</system-reminder>`,
		attribution: "user" as const,
		timestamp: Date.now(),
	};
}

export default function systemReminderExtension(pi: ExtensionAPI): void {
	let sessionReminder: string | undefined;
	let commandOverride = false;

	pi.setLabel("System Reminder");
	pi.registerFlag(FLAG_NAME, {
		description: "Instruction injected before every model call",
		type: "string",
	});

	function reload(cwd: string): void {
		if (!commandOverride) sessionReminder = configuredReminder(pi, cwd);
	}

	pi.on("session_start", async (_event, ctx) => {
		reload(ctx.cwd);
	});

	pi.on("session_switch", async (_event, ctx) => {
		commandOverride = false;
		sessionReminder = configuredReminder(pi, ctx.cwd);
	});

	pi.on("context", async event => {
		if (!sessionReminder) return;

		return {
			messages: [...event.messages, reminderMessage(sessionReminder)],
		};
	});

	pi.registerCommand("system-reminder", {
		description: "Edit, show, save, reload, or disable the per-call system reminder",
		handler: async (args, ctx) => {
			const value = args.trim();

			if (!value || value === "edit") {
				const edited = await ctx.ui.editor("Edit system reminder", sessionReminder ?? "");
				if (edited === undefined) return;

				const reminder = edited.trim();
				if (!reminder) {
					ctx.ui.notify("Empty reminder ignored; use /system-reminder off to disable it", "warning");
					return;
				}

				commandOverride = true;
				sessionReminder = reminder;
				ctx.ui.notify("System reminder updated for this session", "info");
				return;
			}

			if (value === "show") {
				ctx.ui.notify(sessionReminder ? `System reminder: ${sessionReminder}` : "System reminder is disabled", "info");
				return;
			}

			if (value === "off") {
				commandOverride = true;
				sessionReminder = undefined;
				ctx.ui.notify("System reminder disabled for this session", "info");
				return;
			}

			if (value === "reload") {
				commandOverride = false;
				sessionReminder = configuredReminder(pi, ctx.cwd);
				ctx.ui.notify(sessionReminder ? "System reminder reloaded" : "No system reminder configuration found", "info");
				return;
			}

			if (value === "save project" || value === "save global") {
				if (!sessionReminder) {
					ctx.ui.notify("There is no active system reminder to save", "warning");
					return;
				}

				const path =
					value === "save project" ? join(ctx.cwd, PROJECT_FILE) : join(userAgentDir(), USER_FILE);
				writeReminderFile(path, sessionReminder);
				ctx.ui.notify(`System reminder saved to ${path}`, "info");
				return;
			}

			commandOverride = true;
			sessionReminder = value;
			ctx.ui.notify("System reminder updated for this session", "info");
		},
	});
}
