/**
 * @roles 0 < user < admin
 */

/** @requiresRole unauth */
export function handleRequest(token: string, body: string) {
    console.log(`Received request with token="${token}" and body="${body}"`);
    // Branch on token prefix to simulate different access levels
    let x = handleAdminRequest;

    x("xd", "yz")
    if (token.startsWith("user-")) {
        /** @raised user */

        handleAdminRequest(token, body);
        return handleUserRequest(token, body);
    } else if (token.startsWith("admin-")) {
        return handleAdminRequest(token, body);
    } else {
        console.log("Unauthenticated token, rejecting request");
        return null;
    }
}


/** @requiresRole user */
export function h3(sk: { id: number, name: string }){
    handleRequest2("st", "bd", sk.id)
}
export function handleRequest2(token: string, body: string, check: number) {
    console.log(`Received request with token="${token}" and body="${body}"`);
    // Branch on token prefix to simulate different access levels
    let x = handleAdminRequest;

    if(check){
        return
    }
    return handleUserRequest(token, body);

}

function swag() {}
/** @requiresRole user */
function handleUserRequest(token: string, body: string) {
    console.log(`Handling user request for token: ${token}`);
    if (body.includes("updateProfile")) {
        updateProfile(token, "newemail@example.com");
    } else if (body.includes("promoteSelf")) {
        /** @raised admin */
        promoteUser(token);
    } else {
        console.log("Unknown user action");
    }
}

/** @requiresRole admin */
function handleAdminRequest(token: string, body: string) {
    console.log(`Handling admin request for token: ${token}`);
    ath()
    handleRequest(token, body)
    let x = handleAdminRequest;

    x("xd", "yz")
    if (body.includes("deleteUser")) {
        deleteUser("victimUser");
    } else if (body.includes("resetSystem")) {
        resetSystem();
    } else {
        console.log("Unknown admin action");
    }
}
/** @requiresRole user */
function handle3Request(token: string, body: string) {
    console.log(`Handling admin request for token: ${token}`);
    ath()
    handleRequest(token, body)
    let x = handleAdminRequest;

    x("xd", "yz")
    if (body.includes("deleteUser")) {
        deleteUser("victimUser");
    } else if (body.includes("resetSystem")) {
        resetSystem();
    } else {
        console.log("Unknown admin action");
    }
}

/** @requiresRole user @becomesRole admin */
function ath() {
    return true
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

/** @requiresRole user */
export function processItems(items: string[]) {

    const deleted = items.map(deleteUser);
}

/** @requiresRole admin */
export function processItemsAsAdmin(items: string[]) {

    const deleted = items.map(deleteUser);

    // resetSystem() requires admin, and after ath() we become admin - should PASS
    ath();
    items.forEach(resetSystem);
}


/** @requiresRole admin */
export function runWithCallback(items: string[], cb: (s: string) => void) {
    items.forEach(cb);
}

/** @requiresRole admin */
export function triggerAliasGap(items: string[]) {

    const handlers = { delete: deleteUser };
    runWithCallback(items, handlers.delete);
}


/** @requiresRole admin */
export function hicall(num: number) {
    ath()
    if(num == 0) {
        locall("hicalled")
    } else{
        return
    }
}

export function locall(item: string) {
    if( item == "hicalled"){
        deleteUser("uname")
    }
}


export function truesymcall(){
    locall("loww")

}