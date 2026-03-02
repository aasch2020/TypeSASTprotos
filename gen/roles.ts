/**
 * @roles unauth < user < admin
 */
function roles(roleContext: unauth = new unauth) {}

class unauth {
    cunauth(roleContext: unauth = new unauth): void {
    }
}

class user extends unauth {
    cuser(roleContext: unauth = new unauth): void {
    }
}

class admin extends user {
    cadmin(roleContext: unauth = new unauth): void {
    }
}
 