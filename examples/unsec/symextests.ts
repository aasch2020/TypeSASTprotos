/** @requiresRole unauth */
export function handleRequest(token: string, body: string) {
    console.log(`Received request with token="${token}" and body="${body}"`);

    // Branch on token prefix to simulate different access levels
    if (token.startsWith("user-")) {
        /**  @raised user */
        void 0;
        handleUserRequest(token, body);
    } else if (token.startsWith("admin-")) {
        return handleAdminRequest(token, body);
    } else {
        console.log("Unauthenticated token, rejecting request");
        return null;
    }
}

/** @requiresRole user */
function handleUserRequest(token: string, body: string) {
    console.log(`Handling user request for token: ${token}`);

    if (body.includes("updateProfile")) {
        updateProfile(token, "newemail@example.com");
    } else if (body.includes("promoteSelf")) {
        /** @raised admin */
        void 0;
        promoteUser(token);
    } else {
        console.log("Unknown user action");
    }
}

/** @requiresRole admin */
function handleAdminRequest(token: string, body: string) {
    console.log(`Handling admin request for token: ${token}`);

    if (body.includes("deleteUser")) {
        deleteUser("victimUser");
    } else if (body.includes("resetSystem")) {
        resetSystem();
    } else {
        console.log("Unknown admin action");
    }
}

/** @requiresRole user */
export function updateProfile(userId: string, email: string) {
    console.log(`Updating profile for ${userId} to ${email}`);
}

/** @requiresRole user @raised admin */
export function promoteUser(userId: string) {
    console.log(`User ${userId} promoted to admin`);
}

/** @requiresRole admin */
export function deleteUser(userId: string) {
    console.log(`Deleting user ${userId}`);
}

/** @requiresRole admin */
export function resetSystem() {
    console.log("System reset performed");
}