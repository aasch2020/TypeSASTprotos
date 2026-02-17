/**
 * @roles uath < user < admin
 */
function roles(roleContext: uath = new uath) {}

class uath {
    cuath(roleContext: uath = new uath): void {
    }
}

class user extends uath {
    cuser(roleContext: uath = new uath): void {
    }
}

class admin extends user {
    cadmin(roleContext: uath = new uath): void {
    }
}
 