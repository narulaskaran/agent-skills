// Fill a saved login inside the vault process. The password, seed and current
// code never leave this function's return value; the caller redacts as well.

import { totpCode } from "./totp.mjs";

const USER_SELECTORS = ['input[autocomplete="username"]:visible', 'input[autocomplete="email"]:visible', 'input[type="email"]:visible'];

export async function fillLogin({ page, entry, hints = {}, allow, mark, settle, target }) {
	if (!allow(page.url(), entry.site)) throw new Error("refusing to log in: this page is not the saved site");
	const locate = (ref) => (target ? target(ref) : page.locator(ref).first());
	let submitted = false;
	let otpRequested = false;
	let otpFilled = false;
	try {
		let password = hints.password ? await hinted(page, locate(hints.password), "password", entry.site, allow) : await findPassword(page, entry.site, allow);
		if (!password) {
			const user = hints.user ? await hinted(page, locate(hints.user), "user", entry.site, allow) : await findUsername(page, entry.site, allow, null);
			if (!user) throw new Error("no username or password field found");
			await user.locator.fill(entry.username);
			await submit(user.frame);
			submitted = true;
			await settle();
			password = await waitForPassword(page, entry.site, allow);
			if (!password) {
				return await report(page, { submitted: true, passwordLeft: false, otpRequested: false, otpFilled: false, note: "username submitted; no password field appeared" });
			}
		}
		const user = hints.user ? await hinted(page, locate(hints.user), "user", entry.site, allow) : await findUsername(page, entry.site, allow, password);
		if (user) await user.locator.fill(entry.username).catch(() => {});
		stillOnSite(page, password.frame, entry.site, allow);
		await password.locator.fill(entry.password);
		await mark(password.locator);
		await submit(password.frame);
		submitted = true;
		await settle();
		const otp = hints.otp ? await hinted(page, locate(hints.otp), "otp", entry.site, allow) : await findOtp(page, entry.site, allow);
		if (otp) {
			otpRequested = true;
			if (!entry.totp) {
				return await report(page, { submitted, passwordLeft: await passwordVisible(page), otpRequested, otpFilled, note: "one-time code requested and none is saved" });
			}
			const code = totpCode(entry.totp);
			stillOnSite(page, otp.frame, entry.site, allow);
			await otp.locator.fill(code);
			await mark(otp.locator);
			await submit(otp.frame);
			otpFilled = true;
			await settle();
		}
		return await report(page, { submitted, passwordLeft: await passwordVisible(page), otpRequested, otpFilled });
	} finally {
		await clearSecrets(page);
	}
}

/** The page may have navigated since the fields were found. Check again right before typing a secret. */
function stillOnSite(page, frame, site, allow) {
	if (!allow(page.url(), site) || !allow(frame.url(), site)) throw new Error("refusing to log in: the page left the saved site");
}

async function report(page, { submitted, passwordLeft, otpRequested, otpFilled, note }) {
	const title = await page.title().catch(() => "");
	const lines = [
		submitted ? "filled and submitted" : "not submitted",
		note ?? "",
		`url: ${page.url()}`,
		`title: ${title}`,
		passwordLeft ? "password field still present (login may have failed)" : "no password field",
	];
	if (otpRequested && !otpFilled) lines.push("one-time code requested and none is saved");
	if (otpFilled) lines.push("one-time code submitted");
	return lines.filter(Boolean).join("\n");
}

async function hinted(page, locator, kind, site, allow) {
	const info = await elementInfo(locator);
	if (!allow(info.url, site)) throw new Error("refusing a field on a frame that is not the saved site");
	if (kind === "password" && info.type !== "password") throw new Error("password hint is not a password field");
	if (kind === "user" && (info.type === "password" || info.type === "hidden")) throw new Error("username hint is not a username field");
	if (kind === "otp" && !looksLikeOtp(info)) throw new Error("one-time-code hint does not look like a code field");
	const frame = page.frames().find((item) => item.url() === info.url) ?? page.mainFrame();
	return { locator, frame };
}

async function findPassword(page, site, allow) {
	for (const frame of page.frames()) {
		if (!allow(frame.url(), site)) continue;
		const locator = frame.locator("input[type=password]:visible");
		if (await locator.count().catch(() => 0)) return { locator: locator.first(), frame };
	}
	return null;
}

async function waitForPassword(page, site, allow) {
	const deadline = Date.now() + 8_000;
	while (Date.now() < deadline) {
		const found = await findPassword(page, site, allow);
		if (found) return found;
		await page.waitForTimeout(200);
	}
	return null;
}

async function findUsername(page, site, allow, password) {
	const frames = password ? [password.frame] : page.frames().filter((frame) => allow(frame.url(), site));
	for (const frame of frames) {
		for (const selector of USER_SELECTORS) {
			const locator = frame.locator(selector);
			if (await locator.count().catch(() => 0)) return { locator: locator.first(), frame };
		}
		if (password) {
			const form = password.locator.locator("xpath=ancestor::form[1]");
			const texts = form.locator('input[type="text"]:visible, input[type="email"]:visible, input:not([type]):visible');
			if (await texts.count().catch(() => 0)) return { locator: texts.first(), frame };
		}
		const loose = frame.locator('input[type="text"]:visible, input[type="email"]:visible, input:not([type]):visible');
		if (await loose.count().catch(() => 0)) return { locator: loose.first(), frame };
	}
	return null;
}

async function findOtp(page, site, allow) {
	for (const frame of page.frames()) {
		if (!allow(frame.url(), site)) continue;
		const locator = frame.locator("input:visible");
		const count = await locator.count().catch(() => 0);
		for (let i = 0; i < count; i++) {
			const field = locator.nth(i);
			const info = await elementInfo(field).catch(() => null);
			if (info && looksLikeOtp(info)) return { locator: field, frame };
		}
	}
	return null;
}

function looksLikeOtp(info) {
	if (info.type === "password" || info.type === "hidden" || info.type === "email") return false;
	if (info.auto === "one-time-code") return true;
	const blob = `${info.name} ${info.id} ${info.label}`;
	if (/otp|totp|2fa|mfa/.test(blob)) return true;
	const numeric = info.inputMode === "numeric" || info.type === "tel" || info.type === "number";
	return numeric && /code|verif/.test(blob);
}

async function elementInfo(locator) {
	return locator.evaluate((el) => ({
		type: (el.getAttribute("type") || "text").toLowerCase(),
		auto: (el.getAttribute("autocomplete") || "").toLowerCase(),
		name: (el.getAttribute("name") || "").toLowerCase(),
		id: (el.id || "").toLowerCase(),
		inputMode: (el.getAttribute("inputmode") || "").toLowerCase(),
		label: el.labels ? [...el.labels].map((label) => label.innerText).join(" ").toLowerCase() : "",
		url: String(el.ownerDocument.defaultView?.location?.href || ""),
	}));
}

async function submit(frame) {
	const named = frame.getByRole("button", { name: /sign in|log in|continue|next|submit|verify/i });
	if (await named.count().catch(() => 0)) {
		await named.first().click();
		return;
	}
	const button = frame.locator('button[type="submit"]:visible, input[type="submit"]:visible');
	if (await button.count().catch(() => 0)) {
		await button.first().click();
		return;
	}
	await frame.locator("input:visible").last().press("Enter");
}

async function passwordVisible(page) {
	for (const frame of page.frames()) {
		if (await frame.locator("input[type=password]:visible").count().catch(() => 0)) return true;
	}
	return false;
}

async function clearSecrets(page) {
	for (const frame of page.frames()) {
		const fields = frame.locator("[data-vault-secret], input[type=password]");
		const count = await fields.count().catch(() => 0);
		for (let i = 0; i < count; i++) {
			const field = fields.nth(i);
			await field.fill("").catch(() => {});
			await field.evaluate((el) => {
				el.value = "";
				el.removeAttribute("value");
			}).catch(() => {});
		}
	}
}
