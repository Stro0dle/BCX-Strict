// ==UserScript==
// @name         BCX Strict
// @namespace    https://github.com/Stro0dle/BCX-Strict
// @version      1.1.23
// @description  A stricter fork of Bondage Club Extended (BCX) for players who want to be really stuck.
// @author       Stro0dle
// @match        https://*.bondageprojects.elementfx.com/R*/*
// @match        https://*.bondage-europe.com/R*/*
// @match        https://*.bondageeurope.com/R*/*
// @match        https://*.bondageprojects.com/R*/*
// @match        https://*.bondage-asia.com/club/R*
// @icon         https://stro0dle.github.io/BCX-Strict/resources/BCX_small.png
// @homepageURL  https://github.com/Stro0dle/BCX-Strict
// @updateURL    https://github.com/Stro0dle/BCX-Strict/raw/main/load.user.js
// @downloadURL  https://github.com/Stro0dle/BCX-Strict/raw/main/load.user.js
// @run-at       document-end
// @grant        none
// ==/UserScript==

(() => {
	"use strict";
	// Wait a little so the official BCX (if it is still installed) does not race us.
	setTimeout(() => {
		if (window.BCX_Loaded !== undefined) return;
		const script = document.createElement("script");
		script.crossOrigin = "anonymous";
		script.src = `https://stro0dle.github.io/BCX-Strict/bcx.js?${Date.now()}`;
		script.onload = () => script.remove();
		document.head.appendChild(script);
	}, 2000);
})();
