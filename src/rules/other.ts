import { patchFunction } from "../patching";
import { BCXLoadedBeforeLogin, BCXLoginTimedata, BCX_setTimeout } from "../BCXContext";
import { ConditionsLimit } from "../constants";
import { AccessLevel, getCharacterAccessLevel } from "../modules/authority";
import { registerWhisperCommand } from "../modules/commands";
import { registerRule, RuleType } from "../modules/rules";
import { formatTimeInterval } from "../utils";
import { ChatRoomSendLocal, InfoBeep } from "../utilsClub";
import { officialBCXSaveChanged } from "../modules/storage";
import { sendHiddenBeep } from "../modules/messaging";

/**
 * Overlay type for BC's Character PermissionsItems
 */
type BCXPermissionItems = Character["PermissionItems"] & Partial<{ "BCX/GoodGirl": ItemPermissions; }>;

export function initRules_other() {
	let lastAction = Date.now();
	let afkDidTrigger = false;
	function afk_reset() {
		lastAction = Date.now();
		afkDidTrigger = false;
	}

	registerRule("other_forbid_afk", {
		name: "Forbid going afk",
		type: RuleType.Other,
		enforceable: false,
		shortDescription: "logs whenever PLAYER_NAME is inactive",
		longDescription: "This rule forbids PLAYER_NAME to go afk and logs when the allowed inactivity threshold is overstepped.",
		keywords: ["inactivity", "detect", "record"],
		triggerTexts: {
			log: "PLAYER_NAME became inactive, which was forbidden",
			announce: "",
		},
		defaultLimit: ConditionsLimit.blocked,
		dataDefinition: {
			minutesBeforeAfk: {
				type: "number",
				default: 10,
				description: "Amount of minutes, before being considered inactive:",
			},
		},
		load() {
			AfkTimerEventsList.forEach(e => document.addEventListener(e, afk_reset, true));
		},
		tick(state) {
			if (!afkDidTrigger && state.inEffect && state.customData &&
				Date.now() > lastAction + state.customData.minutesBeforeAfk * 60 * 1000
			) {
				afkDidTrigger = true;
				state.trigger();
				ChatRoomSendLocal("You broke a BCX rule by being inactive for too long. The transgression was logged.");
				return true;
			}
			return false;
		},
		unload() {
			AfkTimerEventsList.forEach(e => document.removeEventListener(e, afk_reset, true));
		},
	});

	let lastUpdate: number = 0;
	registerRule("other_track_time", {
		name: "Track rule effect time",
		type: RuleType.Other,
		enforceable: false,
		loggable: false,
		shortDescription: "counts the time this rule's trigger conditions were fulfilled",
		longDescription: "This rule shows the amount of time that PLAYER_NAME spent (online) in the club, since the rule was added, while all of the rule's trigger conditions were fulfilled. So it can for instance log the time spent in public rooms / in the club in general, or in a specific room or with some person as part of a roleplayed task or order. The currently tracked time can be inquired by whispering '!ruletime' to PLAYER_NAME. To reset the counter, remove and add the rule again.",
		keywords: ["record", "stopwatch", "timer", "online"],
		internalDataValidate: (v) => typeof v === "number",
		internalDataDefault: () => 0,
		defaultLimit: ConditionsLimit.blocked,
		dataDefinition: {
			minimumPermittedRole: {
				type: "roleSelector",
				default: AccessLevel.lover,
				description: "Minimum role able to request counted time:",
			},
		},
		init(state) {
			registerWhisperCommand("hidden", "ruletime", null, (argv, sender, respond) => {
				if (state.condition && state.customData && state.internalData !== undefined && getCharacterAccessLevel(sender) <= state.customData.minimumPermittedRole) {
					const fixup = state.inEffect ? (Date.now() - lastUpdate) : 0;
					const msg = `Since the time tracking rule was added, ${formatTimeInterval(state.internalData + fixup)} were counted, where all trigger conditions were true.`;
					respond(msg);
					return true;
				}
				return false;
			}, null, false);
		},
		load() {
			lastUpdate = Date.now();
		},
		tick(state) {
			if (state.inEffect && state.internalData !== undefined) {
				const change = Math.floor(Date.now() - lastUpdate);
				if (change >= 60_000) {
					state.internalData += change;
					lastUpdate = Date.now();
				}
			}
			return false;
		},
		stateChange(state, newState) {
			if (newState) {
				lastUpdate = Date.now();
			} else if (state.internalData !== undefined) {
				const change = Math.floor(Date.now() - lastUpdate);
				state.internalData += change;
				lastUpdate = Date.now();
			}
		},
	});

	let lastReminder = 0;
	registerRule("other_constant_reminder", {
		name: "Listen to my voice",
		type: RuleType.Other,
		loggable: false,
		enforceable: false,
		shortDescription: "regularly show configurable sentences to PLAYER_NAME",
		longDescription: "This rule reminds or tells PLAYER_NAME one of the recorded sentences at random in a settable interval. Only PLAYER_NAME can see the set message and it is only shown if in a chat room.",
		keywords: ["hear", "voices", "in", "head", "messages", "periodic"],
		defaultLimit: ConditionsLimit.limited,
		dataDefinition: {
			reminderText: {
				type: "stringList",
				default: [],
				description: "The sentences that will be shown at random:",
				Y: 296,
			},
			reminderFrequency: {
				type: "number",
				default: 15,
				description: "Frequency of a sentence being shown (in minutes):",
				Y: 715,
			},
		},
		tick(state) {
			if (state.inEffect && state.customData && state.customData.reminderText.length > 0 &&
				ServerPlayerIsInChatRoom() &&
				Date.now() > lastReminder + state.customData.reminderFrequency * 60 * 1000
			) {
				lastReminder = Date.now();
				ChatRoomSendLocal("[Voice] " + state.customData.reminderText[Math.floor(Math.random() * state.customData.reminderText.length)]);
				return true;
			}
			return false;
		},
	});

	registerRule("other_log_money", {
		name: "Log money changes",
		type: RuleType.Other,
		enforceable: false,
		shortDescription: "spending and/or getting money",
		longDescription: "This rule logs whenever money is used to buy something. It also shows how much money PLAYER_NAME currently has in the log entry. Optionally, earning money can also be logged. Note: Please be aware that this last option can potentially fill the whole behaviour log rapidly.",
		keywords: ["record", "balance", "earnings", "using", "tracking", "logging", "entry", "financial", "findom"],
		triggerTexts: {
			infoBeep: "A BCX rule has logged this financial transaction!",
			log: "PLAYER_NAME TYPE money: AMOUNT $ | new balance: BALANCE $",
			announce: "",
		},
		defaultLimit: ConditionsLimit.normal,
		dataDefinition: {
			logEarnings: {
				type: "toggle",
				default: false,
				description: "Also log getting money",
			},
		},
		internalDataValidate: (data) => typeof data === "number",
		internalDataDefault: () => -1,
		stateChange(state, newState) {
			if (!newState) {
				state.internalData = -1;
			}
		},
		tick(state) {
			if (!state.internalData || !Number.isFinite(Player.Money))
				return false;
			let returnValue = false;
			if (state.inEffect) {
				if (state.internalData < 0) {
					state.internalData = Player.Money;
				}
				if (state.internalData > Player.Money) {
					state.trigger(null, { TYPE: "spent", AMOUNT: `${state.internalData - Player.Money}`, BALANCE: `${Player.Money}` });
					returnValue = true;
				} else if (state.internalData < Player.Money && state.customData && state.customData.logEarnings) {
					state.trigger(null, { TYPE: "earned", AMOUNT: `${Player.Money - state.internalData}`, BALANCE: `${Player.Money}` });
					returnValue = true;
				}
				if (state.internalData !== Player.Money) {
					state.internalData = Player.Money;
				}
			}
			return returnValue;
		},
	});

	/* NOTE: Console restriction is now implemented as a hardcoded check in miscPatches.ts */

	const removeTrackingEntry = (permissionItems: Character["PermissionItems"]) => {
		delete (permissionItems as BCXPermissionItems)["BCX/GoodGirl"];
	};

	const hasTrackingEntry = (permissionItems: Character["PermissionItems"], token: number) => {
		return !!(permissionItems as BCXPermissionItems)["BCX/GoodGirl"]?.TypePermissions[token.toString()];
	};

	const addTrackingEntry = (permissionItems: Character["PermissionItems"], token: number) => {
		const perms = (permissionItems as BCXPermissionItems);
		perms["BCX/GoodGirl"] ??= PreferencePermissionGetDefault();
		perms["BCX/GoodGirl"].TypePermissions = { [token.toString()]: "Favorite" };
	};

	registerRule("other_track_BCX_activation", {
		name: "Track BCX activation",
		type: RuleType.Other,
		enforceable: false,
		shortDescription: "logs if PLAYER_NAME enters the club without BCX",
		longDescription: "This rule observes PLAYER_NAME, logging it as a rule violation if the club was previously entered at least once without BCX active.",
		keywords: ["record", "online", "force", "useage", "using", "login"],
		triggerTexts: {
			infoBeep: "You logged in without starting BCX beforehand!",
			log: "PLAYER_NAME logged in without starting BCX beforehand at least once",
			announce: "",
		},
		internalDataValidate: (v) => typeof v === "number",
		internalDataDefault: () => Math.floor(Math.random() * 1_000_000),
		defaultLimit: ConditionsLimit.blocked,
		load(state) {
			patchFunction("ServerUnPackItemPermissions", {
				"let asset = AssetGet(\"Female3DCG\", Group, Name);": "let asset = Group !== 'BCX' ? AssetGet(\"Female3DCG\", Group, Name) : {};",
			});

			if (state.inEffect && state.internalData !== undefined) {
				const { permissions } = ServerUnPackItemPermissions(BCXLoginTimedata, Player.GetDifficulty() >= 3);
				if (
					!BCXLoadedBeforeLogin ||
					!hasTrackingEntry(permissions, state.internalData)
				) {
					BCX_setTimeout(() => {
						state.trigger();
						state.internalData = Math.floor(Math.random() * 1_000_000);
						addTrackingEntry(Player.PermissionItems, state.internalData);
						ServerPlayerBlockItemsSync();
					}, 3_500);
				} else {
					state.internalData = Math.floor(Math.random() * 1_000_000);
					addTrackingEntry(Player.PermissionItems, state.internalData);
					ServerPlayerBlockItemsSync();
				}
			}
		},
		stateChange(state, newState) {
			if (newState) {
				state.internalData = Math.floor(Math.random() * 1_000_000);
				addTrackingEntry(Player.PermissionItems, state.internalData);
				ServerPlayerBlockItemsSync();
			} else {
				removeTrackingEntry(Player.PermissionItems);
				ServerPlayerBlockItemsSync();
			}
		},
		tick(state) {
			if (state.inEffect && state.internalData !== undefined) {
				if (!hasTrackingEntry(Player.PermissionItems, state.internalData) || Math.random() < 0.01) {
					state.internalData = Math.floor(Math.random() * 1_000_000);
					addTrackingEntry(Player.PermissionItems, state.internalData);
					ServerPlayerBlockItemsSync();
				}
			}
			return false;
		},
	});

	//#region HardCoreClub-specific rules

	let officialBCXDetectionDone = false;
	registerRule("other_detect_official_BCX_usage", {
		name: "Detect official BCX usage",
		type: RuleType.Other,
		enforceable: false,
		shortDescription: "logs if the official BCX save changed between sessions",
		longDescription: "This rule detects if PLAYER_NAME used the official BCX between HardCoreClub sessions by comparing the official BCX save data with a snapshot taken on the previous session. If the official save changed, it is logged and the controller is notified via beep.",
		keywords: ["cheat", "detect", "official", "bypass", "switching"],
		triggerTexts: {
			infoBeep: "You used the official BCX since the last HardCoreClub session!",
			log: "PLAYER_NAME used the official BCX between sessions (save data changed)",
			announce: "",
		},
		defaultLimit: ConditionsLimit.blocked,
		load(state) {
			// Detection is checked once at startup
		},
		tick(state) {
			if (!officialBCXDetectionDone && state.inEffect && officialBCXSaveChanged) {
				officialBCXDetectionDone = true;
				state.trigger();
				ChatRoomSendLocal("HardCoreClub detected that you used the official BCX since the last session. This was logged.");
				InfoBeep("Official BCX usage detected! This was logged.");
				return true;
			}
			return false;
		},
	});

	registerRule("other_lock_accepted_limits", {
		name: "Lock accepted limits",
		type: RuleType.Other,
		loggable: false,
		shortDescription: "prevents reverting limits once a rule/curse is accepted",
		longDescription: "This rule prevents PLAYER_NAME from changing the limit of any rule or curse back to 'blocked' once it has been set to 'normal' or 'limited'. Only someone with an owner role or higher can revert limits. The player's initial consent is respected, but cannot be withdrawn mid-scene.",
		keywords: ["limits", "consent", "lock", "prevent", "revert", "irrevocable"],
		defaultLimit: ConditionsLimit.blocked,
		// Implemented externally in conditions.ts ConditionsSetLimit
	});

	registerRule("other_permanent_conditions", {
		name: "Permanent rules and curses",
		type: RuleType.Other,
		loggable: false,
		shortDescription: "prevents removal of rules/curses before a set date",
		longDescription: "This rule prevents the removal of any rules and curses on PLAYER_NAME until the configured date is reached. Only the controller (owner role) can set this date. Even someone with permission to remove rules or curses cannot do so until the date has passed. The timestamp is in milliseconds (Unix epoch).",
		keywords: ["permanent", "irremovable", "timer", "date", "lock", "rules", "curses"],
		defaultLimit: ConditionsLimit.blocked,
		dataDefinition: {
			permanentUntil: {
				type: "number",
				default: 0,
				description: "Permanent until (timestamp, 0 = disabled):",
				options: { min: 0 },
			},
		},
		// Removal blocking is implemented externally in conditions.ts ConditionsRemoveCondition
		tick(state) {
			if (state.inEffect && state.customData && state.customData.permanentUntil > 0 && Date.now() >= state.customData.permanentUntil) {
				ChatRoomSendLocal("The permanent lock on rules and curses has expired.");
				return true;
			}
			return false;
		},
	});

	let lastInfractionCount = 0;
	registerRule("other_auto_escalation", {
		name: "Auto-escalate punishments",
		type: RuleType.Other,
		enforceable: false,
		shortDescription: "extends timer locks and notifies controller on each infraction",
		longDescription: "This rule monitors PLAYER_NAME's behaviour log for new infractions. Each time a new rule violation is logged, timer locks on worn items are extended by a configurable amount of minutes, and optionally a beep is sent to the controller. Each infraction makes the situation worse.",
		keywords: ["punishment", "escalation", "timer", "lock", "extend", "infraction", "penalty"],
		triggerTexts: {
			infoBeep: "An infraction was detected! Punishments have been escalated.",
			log: "PLAYER_NAME's punishments were automatically escalated due to an infraction",
			announce: "",
		},
		defaultLimit: ConditionsLimit.blocked,
		internalDataValidate: (v) => typeof v === "number",
		internalDataDefault: () => 0,
		dataDefinition: {
			timerExtensionMinutes: {
				type: "number",
				default: 30,
				description: "Minutes to add to timer locks per infraction:",
				options: { min: 1, max: 1440 },
			},
			notifyController: {
				type: "toggle",
				default: true,
				description: "Send a beep to the controller on escalation",
				Y: 480,
			},
		},
		tick(state) {
			if (!state.inEffect || !state.customData || state.internalData === undefined) return false;

			const logEntries = (Player as any)?.BCXLog;
			if (!Array.isArray(logEntries)) return false;

			const currentCount = logEntries.filter((e: any) =>
				Array.isArray(e) && (e[2] === 2 || e[2] === 3)
			).length;

			if (lastInfractionCount === 0) {
				lastInfractionCount = currentCount;
				return false;
			}

			if (currentCount > lastInfractionCount) {
				const newInfractions = currentCount - lastInfractionCount;
				lastInfractionCount = currentCount;
				const extensionMs = state.customData.timerExtensionMinutes * 60_000 * newInfractions;

				// Extend all timer locks on the player
				if (Player.Appearance) {
					for (const item of Player.Appearance) {
						const lock = InventoryGetLock(item);
						if (lock?.Property?.RemoveTimer && typeof lock.Property.RemoveTimer === "number") {
							lock.Property.RemoveTimer += extensionMs;
						}
					}
					ChatRoomCharacterUpdate(Player);
				}

				state.trigger();
				ChatRoomSendLocal(`Punishment escalated: ${state.customData.timerExtensionMinutes * newInfractions} minutes added to all timer locks.`);

				if (state.customData.notifyController && Player.Ownership?.MemberNumber) {
					sendHiddenBeep("escalation", {
						message: `${Player.Name} (${Player.MemberNumber}) had an infraction. Timer locks extended by ${state.customData.timerExtensionMinutes * newInfractions} minutes.`,
					} as any, Player.Ownership.MemberNumber, true);
				}

				return true;
			}
			return false;
		},
	});

	//#endregion
}
