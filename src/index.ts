import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const FLAG_NAME = "system-reminder";
const PROJECT_CONFIG_FILE = ".omp/SYSTEM_REMINDER.json";
const USER_CONFIG_FILE = "SYSTEM_REMINDER.json";

const PRESETS: Record<string, string> = {
	"plain-language":
		"Write every response in simple, plain language. Match the user's language. Keep every fact, name, number, command, identifier, and file path accurate. Use short sentences and everyday words. Keep code blocks unchanged. Remove inflated wording, canned headings, preambles, repetition, and meta-commentary. Output only the answer.",
	tldr: "Give a short summary in simple, plain language. Keep the key facts, decisions, numbers, commands, identifiers, and file paths. Drop repetition, hedging, and secondary detail. Keep code blocks unchanged. Match the user's language. Output only the answer.",
	"explain-like-five":
		"Explain things with very simple words, short sentences, a friendly tone, and simple comparisons for difficult ideas. Keep every important fact, name, number, command, identifier, and file path accurate. Keep code blocks unchanged. Match the user's language. Output only the answer.",
};

type PersistenceScope = "project" | "global";

interface ReminderState {
	enabled: boolean;
	preset: string;
	text: string;
}

interface ConfiguredReminder {
	scope: PersistenceScope | "runtime";
	state: ReminderState;
}

function userAgentDir(): string {
	const configured = process.env.PI_CODING_AGENT_DIR?.trim();
	if (configured) {
		const expanded =
			configured === "~"
				? homedir()
				: configured.startsWith("~/")
					? join(homedir(), configured.slice(2))
					: configured;
		return isAbsolute(expanded) ? expanded : join(process.cwd(), expanded);
	}

	const profile = process.env.OMP_PROFILE?.trim();
	return profile ? join(homedir(), ".omp", "profiles", profile, "agent") : join(homedir(), ".omp", "agent");
}

function scopePath(scope: PersistenceScope, cwd: string): string {
	return scope === "project" ? join(cwd, PROJECT_CONFIG_FILE) : join(userAgentDir(), USER_CONFIG_FILE);
}

function reminderText(state: ReminderState): string {
	return state.preset === "custom" ? state.text.trim() : (PRESETS[state.preset] ?? "");
}

function readPersistedReminder(scope: PersistenceScope, cwd: string): ConfiguredReminder | undefined {
	const path = scopePath(scope, cwd);
	if (!existsSync(path)) return undefined;

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}

	if (
		!parsed ||
		typeof parsed !== "object" ||
		!("enabled" in parsed) ||
		typeof parsed.enabled !== "boolean" ||
		!("preset" in parsed) ||
		typeof parsed.preset !== "string" ||
		!("text" in parsed) ||
		typeof parsed.text !== "string" ||
		(parsed.preset !== "custom" && !(parsed.preset in PRESETS))
	) {
		return undefined;
	}

	return {
		scope,
		state: {
			enabled: parsed.enabled,
			preset: parsed.preset,
			text: parsed.text.trim(),
		},
	};
}

function configuredReminder(pi: ExtensionAPI, cwd: string): ConfiguredReminder | undefined {
	const flag = pi.getFlag(FLAG_NAME);
	if (typeof flag === "string" && flag.trim()) {
		return { scope: "runtime", state: { enabled: true, preset: "custom", text: flag.trim() } };
	}

	const environment = process.env.OMP_SYSTEM_REMINDER?.trim();
	if (environment) {
		return { scope: "runtime", state: { enabled: true, preset: "custom", text: environment } };
	}

	return readPersistedReminder("project", cwd) ?? readPersistedReminder("global", cwd);
}

function writePersistedReminder(scope: PersistenceScope, cwd: string, state: ReminderState): string {
	const path = scopePath(scope, cwd);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	return path;
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
	let activeReminder: ConfiguredReminder | undefined;

	pi.setLabel("System Reminder");
	pi.registerFlag(FLAG_NAME, {
		description: "Instruction injected before every model call",
		type: "string",
	});

	function reload(cwd: string): void {
		activeReminder = configuredReminder(pi, cwd);
	}

	function requestedScope(parts: string[]): PersistenceScope {
		const explicit = parts.find(part => part === "project" || part === "global");
		if (explicit) return explicit;
		return activeReminder?.scope === "project" ? "project" : "global";
	}

	pi.on("session_start", async (_event, ctx) => {
		reload(ctx.cwd);
	});

	pi.on("session_switch", async (_event, ctx) => {
		reload(ctx.cwd);
	});

	pi.on("context", async event => {
		const state = activeReminder?.state;
		const text = state ? reminderText(state) : "";
		if (!state?.enabled || !text) return;

		return {
			messages: [...event.messages, reminderMessage(text)],
		};
	});

	pi.registerCommand("system-reminder", {
		description: "Edit, select a preset, enable, disable, show, or reload the persistent reminder",
		handler: async (args, ctx) => {
			const value = args.trim();
			const parts = value.split(/\s+/);
			const action = parts[0];

			if (!value || action === "edit") {
				const scope = requestedScope(parts);
				const edited = await ctx.ui.editor("Edit system reminder", activeReminder ? reminderText(activeReminder.state) : "");
				if (edited === undefined) return;

				const text = edited.trim();
				if (!text) {
					ctx.ui.notify("Empty reminder ignored; use /system-reminder off to disable it", "warning");
					return;
				}

				const state = { enabled: true, preset: "custom", text };
				const path = writePersistedReminder(scope, ctx.cwd, state);
				activeReminder = { scope, state };
				ctx.ui.notify(`Custom reminder saved and enabled: ${path}`, "info");
				return;
			}

			if (action === "presets") {
				ctx.ui.notify(`Available reminder presets: ${Object.keys(PRESETS).join(", ")}`, "info");
				return;
			}

			if (action === "preset") {
				const name = parts[1];
				if (!name || !(name in PRESETS)) {
					ctx.ui.notify(`Choose a preset: ${Object.keys(PRESETS).join(", ")}`, "warning");
					return;
				}

				const scope = requestedScope(parts.slice(2));
				const state = { enabled: true, preset: name, text: "" };
				const path = writePersistedReminder(scope, ctx.cwd, state);
				activeReminder = { scope, state };
				ctx.ui.notify(`Reminder preset "${name}" saved and enabled: ${path}`, "info");
				return;
			}

			if (action === "show") {
				if (!activeReminder) {
					ctx.ui.notify("No persistent system reminder is configured", "info");
					return;
				}
				const status = activeReminder.state.enabled ? "enabled" : "disabled";
				ctx.ui.notify(
					`System reminder is ${status} (${activeReminder.scope}, ${activeReminder.state.preset}): ${reminderText(activeReminder.state)}`,
					"info",
				);
				return;
			}

			if (action === "on" || action === "off") {
				const scope = requestedScope(parts);
				const persisted = readPersistedReminder(scope, ctx.cwd)?.state;
				const state = persisted ?? activeReminder?.state ?? { enabled: false, preset: "custom", text: "" };
				if (action === "on" && !reminderText(state)) {
					ctx.ui.notify("No reminder text exists; edit or select a preset first", "warning");
					return;
				}

				const nextState = { ...state, enabled: action === "on" };
				const path = writePersistedReminder(scope, ctx.cwd, nextState);
				activeReminder = { scope, state: nextState };
				ctx.ui.notify(`System reminder ${nextState.enabled ? "enabled" : "disabled"}: ${path}`, "info");
				return;
			}

			if (action === "reload") {
				reload(ctx.cwd);
				ctx.ui.notify(activeReminder ? "System reminder reloaded" : "No system reminder configuration found", "info");
				return;
			}

			if (action === "save" && (parts[1] === "project" || parts[1] === "global")) {
				if (!activeReminder) {
					ctx.ui.notify("There is no system reminder to save", "warning");
					return;
				}

				const scope = parts[1];
				const path = writePersistedReminder(scope, ctx.cwd, activeReminder.state);
				activeReminder = { scope, state: activeReminder.state };
				ctx.ui.notify(`System reminder saved: ${path}`, "info");
				return;
			}

			const scope = activeReminder?.scope === "project" ? "project" : "global";
			const state = { enabled: true, preset: "custom", text: value };
			const path = writePersistedReminder(scope, ctx.cwd, state);
			activeReminder = { scope, state };
			ctx.ui.notify(`Custom reminder saved and enabled: ${path}`, "info");
		},
	});
}
