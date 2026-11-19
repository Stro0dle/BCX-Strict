import { isMatch } from "lodash-es";
import { Buffer } from "safe-buffer";
import { sha256 } from "sha.js";
import { VERSION_CHECK_BOT } from "../config";
import { ModuleInitPhase } from "../constants";
import { moduleInitPhase } from "../moduleManager";
import { BCXVersionCompare, isObject, parseBCXVersion } from "../utils";
import { BaseModule } from "./_BaseModule";
import { announceSelf } from "./chatroom";
import { sendHiddenBeep } from "./messaging";
import { BCX_setTimeout } from "../BCXContext";
import { reportManualError } from "../errorReporting";

/*
 * HardCoreClub keeps its own save, separate from the official BCX one:
 * - The official BCX data (`ExtensionSettings.BCX`, `OnlineSettings.BCX`, `BCX_<member>` and `BCX_<member>_backup`
 *   in local storage) is only ever read, never written or deleted, so the official BCX keeps working with its data untouched.
 * - When HardCoreClub has no data yet, it copies the official BCX data as its starting point
 *   and keeps a snapshot of it in local storage.
 */

export enum StorageLocations {
	/** Legacy location of the official BCX, HardCoreClub only reads it and saves to `ExtensionSettings` instead */
	OnlineSettings = 0,
	LocalStorage = 1,
	ExtensionSettings = 2,
}

/** Key of HardCoreClub's own save in `Player.ExtensionSettings` */
const HCC_EXTENSION_SETTINGS_KEY = "HardCoreClub" satisfies keyof ExtensionSettings;

const ORIGIN_OWN_EXTENSION_SETTINGS = `ExtensionSettings.${HCC_EXTENSION_SETTINGS_KEY}`;
const ORIGIN_OFFICIAL_ONLINE_SETTINGS = "official BCX (OnlineSettings.BCX)";

export let modStorage: Partial<ModStorage> = {};
let deletionPending = false;
export let firstTimeInit: boolean = false;
export let modStorageLocation: StorageLocations = StorageLocations.ExtensionSettings;

/** Set to `true` during load when the official BCX save changed since the last snapshot */
export let officialBCXSaveChanged: boolean = false;

const AUTH_STRING_MIN_SIZE = 8;
const AUTH_STRING_SIZE = 8;
/** List of past auth keys to accept and the versions they were replaced, should be in reverse order of issuing */
const ACCEPT_PAST_AUTH: readonly [string, BCXVersion][] = [
];

export function finalizeFirstTimeInit() {
	if (!firstTimeInit)
		return;
	firstTimeInit = false;
	modStorage.chatShouldDisplayFirstTimeHelp = true;
	modStorageSync();
	console.log("HardCoreClub: First time init finalized");
	announceSelf(true);
}

function getLocalStorageName(): string {
	return `HardCoreClub_${Player.MemberNumber}`;
}

function getLocalStorageNameBackup(): string {
	return `HardCoreClub_${Player.MemberNumber}_backup`;
}

/** Snapshot of the official BCX save, taken the first time HardCoreClub copied it */
function getLocalStorageNameOfficialSnapshot(): string {
	return `HardCoreClub_${Player.MemberNumber}_officialBCX`;
}

/** Official BCX local save (read only) */
function getOfficialLocalStorageName(): string {
	return `BCX_${Player.MemberNumber}`;
}

/** Official BCX local backup (read only) */
function getOfficialLocalStorageNameBackup(): string {
	return `BCX_${Player.MemberNumber}_backup`;
}

/** Clears HardCoreClub's own data. The official BCX data is never touched. */
function storageClearData() {
	// Localstorage and backup
	localStorage.removeItem(getLocalStorageName());
	localStorage.removeItem(getLocalStorageNameBackup());

	// Extension settings
	if (Player.ExtensionSettings[HCC_EXTENSION_SETTINGS_KEY] != null) {
		Player.ExtensionSettings[HCC_EXTENSION_SETTINGS_KEY] = null;
		ServerPlayerExtensionSettingsSync(HCC_EXTENSION_SETTINGS_KEY, true);
	}
}

export function switchStorageLocation(location: StorageLocations) {
	if (location !== StorageLocations.LocalStorage && location !== StorageLocations.OnlineSettings && location !== StorageLocations.ExtensionSettings) {
		throw new Error(`Unknown storage location`);
	}
	// `OnlineSettings.BCX` belongs to the official BCX
	if (location === StorageLocations.OnlineSettings) {
		console.info(`HardCoreClub: OnlineSettings storage is not used by HardCoreClub, using ExtensionSettings instead`);
		location = StorageLocations.ExtensionSettings;
	}
	if (modStorageLocation === location)
		return;
	console.info(`HardCoreClub: Switching storage location to: ${StorageLocations[location]}`);
	modStorageLocation = location;
	storageClearData();
	modStorageSync();
}

export function calculateSaveHmac(save: string, key: string): string {
	const keyBase = new sha256().update(key, "utf-8").digest();
	const blocksize = 64;

	const iPad = Buffer.allocUnsafe(blocksize);
	const oPad = Buffer.allocUnsafe(blocksize);

	for (let i = 0; i < blocksize; i++) {
		/* eslint-disable no-bitwise */
		const k = i < keyBase.length ? keyBase.readInt8(i) : 0;
		iPad.writeInt8(k ^ 0x36, i);
		oPad.writeInt8(k ^ 0x5C, i);
		/* eslint-enable no-bitwise */
	}
	const iHash = new sha256()
		.update(iPad)
		.update(save, "utf-8")
		.digest();

	const result = new sha256()
		.update(oPad)
		.update(iHash)
		.digest("base64")
		.substring(0, AUTH_STRING_SIZE);

	if (result.length !== AUTH_STRING_SIZE) {
		throw new Error("Failed to generate save HMAC");
	}
	return result;
}

let syncBatchDepth = 0;
let syncBatchPending = false;

/**
 * Runs `callback` with saving deferred: every `modStorageSync` requested meanwhile is merged into a single one, done at the end.
 *
 * Each sync serializes, compresses, verifies and uploads the whole save,
 * so operations changing many things at once (e.g. imports) must use this to avoid freezing the game and flooding the server.
 */
export function modStorageSyncBatch<T>(callback: () => T): T {
	syncBatchDepth++;
	try {
		return callback();
	} finally {
		syncBatchDepth--;
		if (syncBatchDepth === 0 && syncBatchPending) {
			syncBatchPending = false;
			modStorageSync();
		}
	}
}

export function modStorageSync() {
	if (syncBatchDepth > 0) {
		syncBatchPending = true;
		return;
	}
	if (moduleInitPhase !== ModuleInitPhase.ready && moduleInitPhase !== ModuleInitPhase.destroy)
		return;
	if (deletionPending || firstTimeInit)
		return;
	if (!Player.OnlineSettings) {
		console.error("HardCoreClub: Player OnlineSettings not defined during storage sync!");
		return;
	}

	const serializedData = LZString.compressToBase64(JSON.stringify(modStorage));

	try {
		if (typeof serializedData !== "string") {
			throw new Error("Data compression failed");
		}

		const checkParsedData = JSON.parse(LZString.decompressFromBase64(serializedData)!);
		if (!isObject(checkParsedData)) {
			throw new Error("Invalid data in storage");
		}

		if (!isMatch(modStorage, checkParsedData)) {
			console.warn("Current data:\n", modStorage, "\nSaved data:\n", checkParsedData);
			throw new Error("Saved data differs after load");
		}

		if (serializedData.includes(":")) {
			throw new Error("Saved data contains forbidden characters");
		}
	} catch (error) {
		reportManualError("Save data failed to validate!", error);
		return;
	}

	// Additional wrapping format for authenticating saves
	const formatVersion = 2;
	const authString = BCX_SAVE_AUTH ? calculateSaveHmac(serializedData, BCX_SAVE_AUTH) : "-";
	const finalSave = `${formatVersion}:${serializedData}:${authString}`;

	// HardCoreClub only writes its own locations, never the official BCX ones
	if (modStorageLocation === StorageLocations.LocalStorage) {
		localStorage.setItem(getLocalStorageName(), finalSave);
	} else if (modStorageLocation === StorageLocations.ExtensionSettings || modStorageLocation === StorageLocations.OnlineSettings) {
		Player.ExtensionSettings[HCC_EXTENSION_SETTINGS_KEY] = finalSave;
		ServerPlayerExtensionSettingsSync(HCC_EXTENSION_SETTINGS_KEY, true);
	} else {
		throw new Error(`Unknown StorageLocation`);
	}

	localStorage.setItem(getLocalStorageNameBackup(), finalSave);
}

export function clearAllData() {
	deletionPending = true;

	storageClearData();

	sendHiddenBeep("clearData", true, VERSION_CHECK_BOT, true);
	BCX_setTimeout(() => {
		window.location.reload();
	}, 2000);
}

interface SaveSource {
	save: string;
	/** Where HardCoreClub keeps saving its data after loading this save */
	location: StorageLocations;
	/** Where the save was read from, for logs and messages */
	origin: string;
	/** The save belongs to the official BCX: it is only copied, never written back */
	imported: boolean;
	/** The save comes from a local backup the user agreed to load */
	fromBackup: boolean;
}

/** Saves of older HardCoreClub versions, which were written over the official BCX data as `{ data: "..." }` */
function getLegacyHardCoreClubSave(): string | null {
	const legacy: unknown = Player.ExtensionSettings.BCX;
	return isObject(legacy) && typeof legacy.data === "string" ? legacy.data : null;
}

function readOwnSave(): SaveSource | null {
	const local = localStorage.getItem(getLocalStorageName());
	if (typeof local === "string") {
		return { save: local, location: StorageLocations.LocalStorage, origin: "local storage", imported: false, fromBackup: false };
	}

	const extension: unknown = Player.ExtensionSettings[HCC_EXTENSION_SETTINGS_KEY];
	if (typeof extension === "string") {
		return { save: extension, location: StorageLocations.ExtensionSettings, origin: ORIGIN_OWN_EXTENSION_SETTINGS, imported: false, fromBackup: false };
	}

	const legacy = getLegacyHardCoreClubSave();
	if (legacy !== null) {
		return { save: legacy, location: StorageLocations.ExtensionSettings, origin: "ExtensionSettings.BCX (older HardCoreClub version)", imported: false, fromBackup: false };
	}

	return null;
}

/** Reads the official BCX save, in the same order the official BCX loads it */
function readOfficialSave(): SaveSource | null {
	const local = localStorage.getItem(getOfficialLocalStorageName());
	if (typeof local === "string") {
		return { save: local, location: StorageLocations.LocalStorage, origin: "official BCX local storage", imported: true, fromBackup: false };
	}

	const extension: unknown = Player.ExtensionSettings.BCX;
	if (typeof extension === "string") {
		return { save: extension, location: StorageLocations.ExtensionSettings, origin: "official BCX (ExtensionSettings.BCX)", imported: true, fromBackup: false };
	}

	const online: unknown = Player.OnlineSettings?.BCX;
	if (typeof online === "string") {
		return { save: online, location: StorageLocations.ExtensionSettings, origin: ORIGIN_OFFICIAL_ONLINE_SETTINGS, imported: true, fromBackup: false };
	}

	return null;
}

function readBackup(localStorageName: string, imported: boolean, question: string): SaveSource | null {
	const backup = localStorage.getItem(localStorageName);
	if (typeof backup === "string" && confirm(question)) {
		return { save: backup, location: StorageLocations.ExtensionSettings, origin: `local backup ${localStorageName}`, imported, fromBackup: true };
	}
	return null;
}

/** Keeps a copy of the official BCX save as it was when HardCoreClub first copied it */
function saveOfficialSnapshot(source: SaveSource): void {
	const name = getLocalStorageNameOfficialSnapshot();
	try {
		if (localStorage.getItem(name) !== null) {
			console.info(`HardCoreClub: Keeping the existing snapshot of the official BCX data in local storage "${name}"`);
			return;
		}
		localStorage.setItem(name, JSON.stringify({ origin: source.origin, date: new Date().toISOString(), save: source.save }));
		console.info(`HardCoreClub: Saved a snapshot of the official BCX data in local storage "${name}"`);
	} catch (error) {
		console.warn(`HardCoreClub: Failed to save a snapshot of the official BCX data (it is still kept untouched in its original location)`, error);
	}
}

/**
 * Unpacks and validates a save
 * @returns The saved data, or `null` if the user refused to load it
 * @throws If the save is invalid
 */
function parseSave(source: SaveSource): Partial<ModStorage> | null {
	let saved = source.save;
	// Official BCX saves are signed with the official key, which HardCoreClub cannot verify. They are only copied.
	let requireAuth = !source.imported && !source.fromBackup && source.location === StorageLocations.ExtensionSettings;
	let authSuccessVersion: BCXVersion | true | null = null;
	let hasAuth = false;
	// Unpack wrapping format, if there is one
	if (/^[0-9]+:/.test(saved)) {
		const parts = saved.split(":");
		const saveVersion = Number.parseInt(parts[0], 10);
		if (saveVersion === 2) {
			if (parts.length !== 3) {
				throw new Error("Invalid save part count.");
			}
			saved = parts[1];
			if (parts[2] && parts[2] !== "-" && parts[2].length >= AUTH_STRING_MIN_SIZE) {
				hasAuth = true;
				let accept: readonly [string, BCXVersion | true][] = ACCEPT_PAST_AUTH;
				if (BCX_SAVE_AUTH) {
					accept = [[BCX_SAVE_AUTH, true], ...accept];
				}
				for (const [key, version] of accept) {
					const auth = calculateSaveHmac(saved, key);
					if (auth.startsWith(parts[2])) {
						authSuccessVersion = version;
						break;
					}
				}
			}
		} else {
			throw new Error("Unknown save version. Are you loading older version of BCX?");
		}
	}

	const parsed = JSON.parse(LZString.decompressFromBase64(saved)!);
	if (!isObject(parsed)) {
		throw new Error("Bad data");
	}
	const storage: Partial<ModStorage> = parsed;
	const saveBCXVersion: BCXVersion | null = typeof storage.version === "string" ? parseBCXVersion(storage.version) : { major: 0, minor: 0, patch: 0 };
	// We know for a fact, that all versions in online storage should be parsable. No future version will use that place
	if (source.origin === ORIGIN_OFFICIAL_ONLINE_SETTINGS && storage.version !== undefined && saveBCXVersion == null) {
		throw new Error("Failed to read save version. Did you use an unofficial fork?");
	}

	if (!source.imported) {
		// Validate that we are not loading a save that is signed by no longer valid key (relative to its version)
		if (authSuccessVersion != null && authSuccessVersion !== true && (saveBCXVersion == null || BCXVersionCompare(saveBCXVersion, authSuccessVersion) >= 0)) {
			authSuccessVersion = null;
		}
		// From version 1.1.0 saves, auth is always required
		if (saveBCXVersion != null && BCXVersionCompare(saveBCXVersion, { major: 1, minor: 1, patch: 0 }) >= 0) {
			requireAuth = true;
		}

		if (requireAuth && !!BCX_SAVE_AUTH && authSuccessVersion == null) {
			throw new Error("Failed to verify save signature. Did you use an unofficial fork?");
		}

		if (hasAuth && !BCX_SAVE_AUTH) {
			// Note to fork developers (updated 2025-08-23)
			// Please do NOT remove this warning. Instead use a different save location than `ExtensionSettings.BCX`.
			// Thank you
			// (HardCoreClub uses its own save location; official BCX saves are imported read-only above and never reach this point)
			if (!confirm("You are attempting to load an unofficial BCX version.\n" +
				"If you continue, you will not be able to return to the official version without resetting all data.\n" +
				"Are you sure you want to continue?"
			)) {
				return null;
			}
		}
	}

	return storage;
}

function detectOfficialBCXSaveChange(): void {
	const snapshotName = getLocalStorageNameOfficialSnapshot();
	const snapshotRaw = localStorage.getItem(snapshotName);
	if (snapshotRaw === null) {
		// No snapshot yet — take one now so we can compare on next load
		const officialSource = readOfficialSave();
		if (officialSource !== null) {
			saveOfficialSnapshot(officialSource);
		}
		return;
	}

	let snapshot: { save?: string } | null = null;
	try {
		snapshot = JSON.parse(snapshotRaw) as { save?: string } | null;
	} catch {
		console.warn("HardCoreClub: Could not parse official BCX snapshot");
		return;
	}
	if (!snapshot || typeof snapshot.save !== "string") return;

	const officialSource = readOfficialSave();
	if (officialSource === null) return;

	if (officialSource.save !== snapshot.save) {
		officialBCXSaveChanged = true;
		console.warn("HardCoreClub: The official BCX save has changed since the last session! The player may have used official BCX.");

		// Update the snapshot to the current state so we only warn once per change
		try {
			localStorage.setItem(snapshotName, JSON.stringify({
				origin: officialSource.origin,
				date: new Date().toISOString(),
				save: officialSource.save,
			}));
		} catch (error) {
			console.warn("HardCoreClub: Failed to update official BCX snapshot", error);
		}
	}
}

export class ModuleStorage extends BaseModule {
	/** Where the data was loaded from, `null` on first time init */
	private loadedFrom: SaveSource | null = null;

	init() {
		if (!isObject(Player.ExtensionSettings)) {
			console.error("HardCoreClub: Missing ExtensionSettings during load");
			alert("HardCoreClub: Failed to load data, please see console for more details");
			return false;
		}
		if (!isObject(Player.OnlineSettings)) {
			console.error("HardCoreClub: Missing OnlineSettings during load");
			alert("HardCoreClub: Failed to load data, please see console for more details");
			return false;
		}

		const ownExtensionSave: unknown = Player.ExtensionSettings[HCC_EXTENSION_SETTINGS_KEY];
		if (ownExtensionSave != null && typeof ownExtensionSave !== "string") {
			console.error("HardCoreClub: Unknown save data type:", ownExtensionSave);
			alert("HardCoreClub: Failed to load data, please see console for more details");
			return false;
		}

		// HardCoreClub's own data first, then the official BCX data as a starting point
		const source: SaveSource | null =
			readOwnSave() ??
			readBackup(getLocalStorageNameBackup(), false, "HardCoreClub: Error loading saved data, but found local backup.\nDo you want to load the backup?") ??
			readOfficialSave() ??
			readBackup(getOfficialLocalStorageNameBackup(), true, "HardCoreClub: Found a local backup of your official BCX data.\nDo you want to use it as the starting point of HardCoreClub?");

		if (source === null) {
			console.log("HardCoreClub: First time init");
			firstTimeInit = true;
			return true;
		}

		console.info(`HardCoreClub: Loading data from ${source.origin}`);
		modStorageLocation = source.location;
		if (source.imported) {
			saveOfficialSnapshot(source);
		}

		try {
			const storage = parseSave(source);
			if (storage === null)
				return false;
			modStorage = storage;
			this.loadedFrom = source;
		} catch (error) {
			console.error(`HardCoreClub: Error while loading saved data from ${source.origin}, full reset.`, error);
			const question = source.imported ?
				`HardCoreClub could not read your BCX data!\n` +
				`${error}\n\n` +
				`Your official BCX data is not modified.\n` +
				`Start HardCoreClub with new data?` :
				`HardCoreClub Failed to load saved data!\n` +
				`${error}\n\n` +
				`Continue anyway, resetting all data?`;
			if (confirm(question)) {
				firstTimeInit = true;
			} else {
				return false;
			}
		}

		if (source.imported && this.loadedFrom) {
			alert("HardCoreClub copied your BCX data and uses it as its starting point.\n" +
				"Your official BCX data is not modified: you can go back to the official BCX at any time and find it as it was."
			);
		}
		return true;
	}

	run() {
		// Older HardCoreClub versions saved over the official BCX data. Once the data is loaded from HardCoreClub's own location
		// (so the moved copy is safely stored on the server), remove that leftover: the official BCX cannot read it anyway.
		if (
			this.loadedFrom?.origin === ORIGIN_OWN_EXTENSION_SETTINGS &&
			getLegacyHardCoreClubSave() !== null
		) {
			console.info("HardCoreClub: Removing the save of an older HardCoreClub version from ExtensionSettings.BCX");
			Player.ExtensionSettings.BCX = null;
			ServerPlayerExtensionSettingsSync("BCX", true);
		}

		// Detect if the official BCX save changed since the last snapshot (i.e. the player used official BCX between sessions)
		if (!firstTimeInit && !this.loadedFrom?.imported) {
			detectOfficialBCXSaveChange();
		}

		modStorageSync();
	}
}
