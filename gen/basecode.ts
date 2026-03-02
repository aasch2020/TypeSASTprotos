/**
 * @roles 0 < user < admin
 */
type Role = "admin" | "user" | "0";

type Token = {
  userId: number;
  role: Role;
};
// type Account = {
//   /** @requiresRole user */
//   updateEmail: (email: string) => void;
//   /** @requiresRole admin */
//   promoteToAdmin: () => void;
// }


class UserAccount {
  /** @requiresRole user */
  updateEmail(email: string, roleContext: user): void {
  }
  /** @requiresRole admin */
  promoteToAdmin(roleContext: admin): void {
  }
}


function verifyToken(token: string, roleContext: unauth = new unauth): Token {
  return { userId: 1, role: "user" };
}

/** @requiresRole admin */
function writeAdminDB(roleContext: admin): void { }



/** @requiresRole unauth @becomesRole user */
function auth(req: string, roleContext: unauth): boolean {
  const header = req;
  if (!header) return false;

  const token = header.replace("Bearer ", "");
  return true;
}

/** @requiresRole user @becomesRole admin */
function requireAdminRole(role: Role, roleContext: user): boolean {
  if (role === "admin") {
    return true;

  } else {
    return false;
  }
}



function adminWrite(req: string, ctx: Role, roleContext: unauth = new unauth): void {
  if (!requireAdminRole(ctx, roleContext)) {
    throw new Error("Unauthorized");
  } else {
    writeAdminDB(roleContext);
  }
}
interface UserRequestBody {
  token: string;
  email?: string;
  admin?: boolean;
  body?: Record<string, unknown>;
}


function updateUser(req: UserRequestBody, roleContext: unauth = new unauth): void {
  let account: UserAccount | undefined;
  if (auth(req.token, roleContext)) {
    account = new UserAccount();
  } else {

    if (account && req.email) {
      account.updateEmail(req.email, roleContext);
    }

    if (account && req.admin === true) {
        const roleContextRaised: admin = new admin();
      /**@raised admin */
      account.promoteToAdmin(roleContextRaised);
    }
  }
}




/* vulnerability from object */


class ConfigureableObject {
  private publicName: string;
  private imageUrl: string;
  private value: number;


  /** @requiresRole admin */
  private internalToken: string;
  /** @requiresRole admin */
  private featureFlags: string[];

  constructor() {
    this.publicName = "payments";
    this.imageUrl = "https://example.com/logo.png";
    this.value = 42;

    this.internalToken = "svc-9f83a...";
    this.featureFlags = ["can-refund", "can-settle"];
  }


  /** @requiresRole user */
  getPublicName(roleContext: user): string {
    return this.publicName;
  }

  /** @requiresRole user */
  getImageUrl(roleContext: user): string {
    return this.imageUrl;
  }

  /** @requiresRole user */
  getValue(roleContext: user): number {
    return this.value;
  }



  /** @requiresRole user */
  setPublicName(name: string, roleContext: user): void {
    this.publicName = name;
  }

  /** @requiresRole user */
  setImageUrl(url: string, roleContext: user): void {
    this.imageUrl = url;
  }

  /** @requiresRole user */
  setValue(value: number, roleContext: user): void {
    this.value = value;
  }


  /** @requiresRole admin */
  getInternalToken(roleContext: admin): string {
    return this.internalToken;
  }
  /** @requiresRole admin */
  getFeatureFlags(roleContext: admin): string[] {
    return [...this.featureFlags];
  }


  /** @requiresRole admin */
  setInternalToken(token: string, roleContext: admin): void {
    this.internalToken = token;
  }
  /** @requiresRole admin */
  addFeatureFlag(flag: string, roleContext: admin): void {
    this.featureFlags.push(flag);
  }
  /** @requiresRole admin */
  removeFeatureFlag(flag: string, roleContext: admin): void {
    this.featureFlags =
      this.featureFlags.filter(f => f !== flag);
  }



  /** @requiresRole user */
  set(roleContext: user): void { }

}




// Flag any type as unauthenticated. Auto fail here, regardless of auth. 
function applyUpdates(target: any, updates: Record<string, unknown>, roleContext: unauth = new unauth) {
  for (const [key, value] of Object.entries(updates)) {
    const setter = `set${key[0].toUpperCase()}${key.slice(1)}`;

    if (typeof target[setter] === "function") { // This is effectively call anything, auto flags.
      target[setter](value);
    }
  }
}


/* -------- 0 > User -------- */
function patch(req: UserRequestBody, res: string, roleContext: unauth = new unauth): string {
  if (auth(req.token, roleContext)) {
    return "unauthenticated";
  }

  const config = new ConfigureableObject();

  applyUpdates(config, req.body ?? {});


  return "success";
}
