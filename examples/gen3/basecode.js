"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const state_1 = require("./state");
// type Account = {
//   /** @requiresRole user */
//   updateEmail: (email: string) => void;
//   /** @requiresRole admin */
//   promoteToAdmin: () => void;
// }
class UserAccount {
    /** @requiresRole user */
    updateEmail(email) {
        state_1.state.requireUser();
    }
    /** @requiresRole admin */
    promoteToAdmin() {
        state_1.state.requireAdmin();
    }
}
function verifyToken(token) {
    return { userId: 1, role: "user" };
}
/** @requiresRole admin */
function writeAdminDB() {
    state_1.state.requireAdmin();
}
/** @requiresRole unauth @becomesRole user */
function auth(req) {
    state_1.state.requireUnauth();
    const header = req;
    if (!header)
        return false;
    const token = header.replace("Bearer ", "");
    return true;
}
/** @requiresRole user @becomesRole admin */
function requireAdminRole(role) {
    state_1.state.requireUser();
    if (role === "admin") {
        return true;
    }
    else {
        return false;
    }
}
function adminWrite(req, ctx) {
    if (!requireAdminRole(ctx)) {
        throw new Error("Unauthorized");
    }
    else {
        writeAdminDB();
    }
}
function updateUser(req) {
    let account;
    if (auth(req.token)) {
        account = new UserAccount();
    }
    else {
        if (account && req.email) {
            account.updateEmail(req.email);
        }
        if (account && req.admin === true) {
            state_1.state.raise("admin");
            account.promoteToAdmin();
        }
    }
}
/* vulnerability from object */
class ConfigureableObject {
    constructor() {
        this.publicName = "payments";
        this.imageUrl = "https://example.com/logo.png";
        this.value = 42;
        this.internalToken = "svc-9f83a...";
        this.featureFlags = ["can-refund", "can-settle"];
    }
    /** @requiresRole user */
    getPublicName() {
        state_1.state.requireUser();
        return this.publicName;
    }
    /** @requiresRole user */
    getImageUrl() {
        state_1.state.requireUser();
        return this.imageUrl;
    }
    /** @requiresRole user */
    getValue() {
        state_1.state.requireUser();
        return this.value;
    }
    /** @requiresRole user */
    setPublicName(name) {
        state_1.state.requireUser();
        this.publicName = name;
    }
    /** @requiresRole user */
    setImageUrl(url) {
        state_1.state.requireUser();
        this.imageUrl = url;
    }
    /** @requiresRole user */
    setValue(value) {
        state_1.state.requireUser();
        this.value = value;
    }
    /** @requiresRole admin */
    getInternalToken() {
        state_1.state.requireAdmin();
        return this.internalToken;
    }
    /** @requiresRole admin */
    getFeatureFlags() {
        state_1.state.requireAdmin();
        return [...this.featureFlags];
    }
    /** @requiresRole admin */
    setInternalToken(token) {
        state_1.state.requireAdmin();
        this.internalToken = token;
    }
    /** @requiresRole admin */
    addFeatureFlag(flag) {
        state_1.state.requireAdmin();
        this.featureFlags.push(flag);
    }
    /** @requiresRole admin */
    removeFeatureFlag(flag) {
        state_1.state.requireAdmin();
        this.featureFlags =
            this.featureFlags.filter(f => f !== flag);
    }
    /** @requiresRole user */
    set() {
        state_1.state.requireUser();
    }
}
// Flag any type as unauthenticated. Auto fail here, regardless of auth. 
function applyUpdates(target, updates) {
    for (const [key, value] of Object.entries(updates)) {
        const setter = `set${key[0].toUpperCase()}${key.slice(1)}`;
        if (typeof target[setter] === "function") { // This is effectively call anything, auto flags.
            target[setter](value);
        }
    }
}
/* -------- 0 > User -------- */
function patch(req, res) {
    var _a;
    if (auth(req.token)) {
        return "unauthenticated";
    }
    const config = new ConfigureableObject();
    applyUpdates(config, (_a = req.body) !== null && _a !== void 0 ? _a : {});
    return "success";
}
