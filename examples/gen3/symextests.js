"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleRequest = handleRequest;
exports.updateProfile = updateProfile;
exports.promoteUser = promoteUser;
exports.deleteUser = deleteUser;
exports.resetSystem = resetSystem;
const state_1 = require("./state");
// webappFakeComplex.ts
/** @requiresRole unauth */
function handleRequest(token, body) {
    state_1.state.requireUnauth();
    console.log(`Received request with token="${token}" and body="${body}"`);
    // Branch on token prefix to simulate different access levels
    if (token.startsWith("user-")) {
        state_1.state.raise("user");
        return handleUserRequest(token, body);
    }
    else if (token.startsWith("admin-")) {
        state_1.state.raise("admin");
        return handleAdminRequest(token, body);
    }
    else {
        console.log("Unauthenticated token, rejecting request");
        return null;
    }
}
/** @requiresRole user */
function handleUserRequest(token, body) {
    state_1.state.requireUser();
    console.log(`Handling user request for token: ${token}`);
    if (body.includes("updateProfile")) {
        updateProfile(token, "newemail@example.com");
    }
    else if (body.includes("promoteSelf")) {
        state_1.state.raise("admin");
        promoteUser(token);
    }
    else {
        console.log("Unknown user action");
    }
}
/** @requiresRole admin */
function handleAdminRequest(token, body) {
    state_1.state.requireAdmin();
    console.log(`Handling admin request for token: ${token}`);
    if (body.includes("deleteUser")) {
        deleteUser("victimUser");
    }
    else if (body.includes("resetSystem")) {
        resetSystem();
    }
    else {
        console.log("Unknown admin action");
    }
}
/** @requiresRole user */
function updateProfile(userId, email) {
    state_1.state.requireUser();
    console.log(`Updating profile for ${userId} to ${email}`);
}
/** @requiresRole user @raised admin */
function promoteUser(userId) {
    state_1.state.requireUser();
    console.log(`User ${userId} promoted to admin`);
}
/** @requiresRole admin */
function deleteUser(userId) {
    state_1.state.requireAdmin();
    console.log(`Deleting user ${userId}`);
}
/** @requiresRole admin */
function resetSystem() {
    state_1.state.requireAdmin();
    console.log("System reset performed");
}
