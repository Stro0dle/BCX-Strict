import { allowMode, ChatRoomSendLocal, InfoBeep } from "../utilsClub";
import { BaseModule } from "./_BaseModule";
import { hookFunction, patchFunction } from "../patching";
import { MiscCheat } from "../constants";
import { modStorage, modStorageSync } from "./storage";
import { GetDialogMenuButtonArray } from "./dialog";

export const cheatChangeHooks: Partial<Record<MiscCheat, (enabled: boolean) => void>> = {};

export function cheatIsEnabled(cheat: MiscCheat): boolean {
	return Array.isArray(modStorage.cheats) && modStorage.cheats.includes(cheat);
}

export function cheatSetEnabled(cheat: MiscCheat, enabled: boolean) {
	if (!Array.isArray(modStorage.cheats)) {
		console.error(`HardCoreClub: Attempt to set cheat, while not initalized`);
		return;
	}

	if (enabled) {
		if (!modStorage.cheats.includes(cheat)) {
			modStorage.cheats.push(cheat);
		}
	} else {
		modStorage.cheats = modStorage.cheats.filter(c => c !== cheat);
	}
	if (cheatChangeHooks[cheat]) {
		cheatChangeHooks[cheat](enabled);
	}
	modStorageSync();
}

export function cheatToggle(cheat: MiscCheat) {
	cheatSetEnabled(cheat, !cheatIsEnabled(cheat));
}

const MISTRESS_CHEAT_ONLY_ITEMS = ["MistressPadlock", "MistressPadlockKey", "MistressTimerPadlock"];
const PANDORA_CHEAT_ONLY_ITEMS = ["PandoraPadlock", "PandoraPadlockKey"];

const InterfaceTextAdditions: Map<string, string> = new Map();

export function AddInterfaceText(keyword: string, value: string) {
	InterfaceTextAdditions.set(keyword, value);
}

const GetImageRedirects: Map<string, string> = new Map();

export function RedirectGetImage(original: string, redirect: string) {
	GetImageRedirects.set(original, redirect);
}

/**
 * Function to handle clicks on dialog menu buttons (the buttons on top right when you click character)
 * @returns `false` if original should still be called, `true` if it should be blocked
 */
export type DialogMenuButtonClickHook = (C: Character) => boolean;

const DialogMenuButtonClickHooks: Map<string, DialogMenuButtonClickHook[]> = new Map();

export function HookDialogMenuButtonClick(button: string, fn: DialogMenuButtonClickHook) {
	let arr = DialogMenuButtonClickHooks.get(button);
	if (!arr) {
		arr = [];
		DialogMenuButtonClickHooks.set(button, arr);
	}
	if (!arr.includes(fn)) {
		arr.push(fn);
	}
}

export class ModuleMiscPatches extends BaseModule {
	load() {
		if (!Array.isArray(modStorage.cheats)) {
			modStorage.cheats = [];
		} else {
			modStorage.cheats = modStorage.cheats.filter(c => MiscCheat[c] !== undefined);
		}

		hookFunction("InterfaceTextGet", 10, (args, next) => {
			const override = InterfaceTextAdditions.get(args[0]);
			if (override !== undefined)
				return override;
			return next(args);
		});

		hookFunction("DrawGetImage", 10, (args, next) => {
			const redirect = GetImageRedirects.get(args[0]);
			if (redirect !== undefined) {
				args[0] = redirect;
			}
			return next(args);
		});

		hookFunction("DialogMenuButtonClick", 5, (args, next) => {
			// Finds the current icon
			const C = CharacterGetCurrent();
			for (let I = 0; I < GetDialogMenuButtonArray().length; I++) {
				if (MouseIn(1885 - I * 110, 15, 90, 90) && C) {
					const hooks = DialogMenuButtonClickHooks.get(GetDialogMenuButtonArray()[I]);
					if (hooks?.some(hook => hook(C)))
						return true;
				}
			}
			return next(args);
		});

		hookFunction("AsylumEntranceCanWander", 0, () => true);

		hookFunction("CheatFactor", 1, (args, next) => {
			const [CheatName, Factor] = args;

			if (CheatName === "CantLoseMistress" && cheatIsEnabled(MiscCheat.CantLoseMistress)) {
				return Factor;
			} else if (CheatName === "BlockRandomKidnap" && cheatIsEnabled(MiscCheat.BlockRandomEvents)) {
				return Factor;
			}

			return next(args);
		});

		hookFunction("PrivateRansomStart", 0, (args, next) => {
			if (cheatIsEnabled(MiscCheat.BlockRandomEvents))
				return false;

			return next(args);
		});

		hookFunction("MainHallWalk", 0, (args, next) => {
			if (cheatIsEnabled(MiscCheat.BlockRandomEvents)) {
				MainHallRandomEventOdds = 0;
			}

			return next(args);
		});

		patchFunction("LoginMistressItems", { 'LogQuery("ClubMistress", "Management")': "true" });
		hookFunction("LoginMistressItems", 0, (args, next) => {
			next(args);
			if (!cheatIsEnabled(MiscCheat.GiveMistressKey) && !LogQuery("ClubMistress", "Management")) {
				for (const item of MISTRESS_CHEAT_ONLY_ITEMS) {
					InventoryDelete(Player, item, "ItemMisc", false);
				}
			}
		});
		cheatChangeHooks[MiscCheat.GiveMistressKey] = () => {
			LoginMistressItems();
			ServerPlayerInventorySync();
		};

		patchFunction("LoginStableItems", { 'LogQuery("PonyExam", "JoinedStable") || LogQuery("TrainerExam", "JoinedStable")': "true" });

		cheatChangeHooks[MiscCheat.GivePandoraKey] = enabled => {
			for (const item of PANDORA_CHEAT_ONLY_ITEMS) {
				if (enabled) {
					InventoryAdd(Player, item, "ItemMisc", false);
				} else {
					InventoryDelete(Player, item, "ItemMisc", false);
				}
			}
			ServerPlayerInventorySync();
		};

		hookFunction("InfiltrationStealItems", 0, (args, next) => {
			next(args);
			if (cheatIsEnabled(MiscCheat.GivePandoraKey)) {
				cheatChangeHooks[MiscCheat.GivePandoraKey]!(true);
			}
		});

		// Cheats

		hookFunction("Player.CanChangeClothesOn", 1, (args, next) => (allowMode && (args[0]).IsPlayer()) || next(args));
		hookFunction("ChatRoomCanLeave", 0, (args, next) => allowMode || next(args));

		// Anti-stupid-null(s)

		hookFunction("DrawCharacter", 100, (args, next) => {
			if (args[0] != null)
				return next(args);
		});

		hookFunction("SpeechGarble", 100, (args, next) => {
			if (args[1] == null) {
				args[1] = "";
			}
			return next(args);
		});

		// fixes a bug in BC
		hookFunction("ServerPlayerIsInChatRoom", 0, (args, next) => {
			return next(args) || CurrentScreen === "GetUp";
		});

		//#region HardCoreClub: hardcoded restrictions

		// 1. DevTools detection — block keyboard shortcuts
		document.addEventListener("keydown", (e: KeyboardEvent) => {
			const isDevToolsKey = e.key === "F12" ||
				(e.ctrlKey && e.shiftKey && ["I", "i", "J", "j", "C", "c"].includes(e.key));
			if (isDevToolsKey) {
				e.preventDefault();
				e.stopPropagation();
				InfoBeep("DevTools access is blocked!");
			}
		}, true);

		// 1b. DevTools detection — periodic window size check for docked DevTools
		let devtoolsWarned = false;
		setInterval(() => {
			const widthDiff = window.outerWidth - window.innerWidth > 160;
			const heightDiff = window.outerHeight - window.innerHeight > 160;
			if ((widthDiff || heightDiff) && !devtoolsWarned) {
				devtoolsWarned = true;
				ChatRoomSendLocal("DevTools detected open! Close them immediately.");
				InfoBeep("DevTools detected! Close them immediately.");
			}
			if (!widthDiff && !heightDiff) {
				devtoolsWarned = false;
			}
		}, 10_000);

		// 2. Block difficulty changes when restrained
		hookFunction("PreferenceSubscreenDifficultyConfirm", 6, (args, next) => {
			if (Player.IsRestrained() && PreferenceDifficultyLevel !== Player.GetDifficulty()) {
				InfoBeep("You cannot change difficulty while restrained!");
				return;
			}
			return next(args);
		});

		// 3 & 4. Block profile editing, friend list, and preferences when restrained
		hookFunction("CommonSetScreen", 4, (args, next) => {
			if (Player.IsRestrained()) {
				if (args[1] === "OnlineProfile") {
					InfoBeep("You cannot edit your profile while restrained!");
					return Promise.resolve();
				}
				if (args[1] === "FriendList") {
					InfoBeep("You cannot access the friend list while restrained!");
					return Promise.resolve();
				}
				if (args[1] === "Preference") {
					InfoBeep("You cannot access settings while restrained!");
					return Promise.resolve();
				}
			}
			return next(args);
		});

		// 4b. Block extensions tab when restrained
		hookFunction("PreferenceSubscreenExtensionsLoad", 5, (args, next) => {
			if (Player.IsRestrained()) {
				InfoBeep("You cannot access extensions settings while restrained!");
				return;
			}
			return next(args);
		});

		// 4c. Block sending beep messages when restrained
		hookFunction("FriendListBeepMenuSend", 5, (args, next) => {
			if (Player.IsRestrained()) {
				InfoBeep("You cannot send messages while restrained!");
				return;
			}
			return next(args);
		});

		// 5. Struggle cooldown — block after too many attempts
		const STRUGGLE_MAX_ATTEMPTS = 3;
		const STRUGGLE_COOLDOWN_MS = 10 * 60_000;
		let struggleAttempts = 0;
		let struggleCooldownUntil = 0;

		HookDialogMenuButtonClick("Struggle", (C) => {
			if (C.ID !== 0) return false;
			if (Date.now() < struggleCooldownUntil) {
				const remaining = Math.ceil((struggleCooldownUntil - Date.now()) / 60_000);
				InfoBeep(`Struggling blocked for ${remaining} more minutes!`);
				return false;
			}
			struggleAttempts++;
			if (struggleAttempts >= STRUGGLE_MAX_ATTEMPTS) {
				struggleCooldownUntil = Date.now() + STRUGGLE_COOLDOWN_MS;
				struggleAttempts = 0;
				ChatRoomSendLocal("Too many struggle attempts! Blocked for 10 minutes.");
			}
			return false;
		});

		hookFunction("StruggleDrawStrengthProgress", 7, ((args: any[], next: (args: any[]) => any) => {
			const C = args[0] as Character | undefined;
			if (C && C.ID === 0 && Date.now() < struggleCooldownUntil) {
				args[1] = 0;
			}
			return next(args);
		}) as any);

		//#endregion
	}

	run() {
		LoginMistressItems();
		LoginStableItems();
		if (cheatIsEnabled(MiscCheat.GivePandoraKey)) {
			cheatChangeHooks[MiscCheat.GivePandoraKey]!(true);
		}
		ServerPlayerInventorySync();
	}
}
