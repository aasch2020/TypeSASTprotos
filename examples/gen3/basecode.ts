import { state } from "./state";
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
  updateEmail(email: string): void {
      state.requireUser();
  }
  /** @requiresRole admin */
  promoteToAdmin(): void {
      state.requireAdmin();
  }
}


function verifyToken(token: string): Token {
  return { userId: 1, role: "user" };
}

/** @requiresRole admin */
function writeAdminDB(): void {
    state.requireAdmin(); }



/** @requiresRole unauth @becomesRole user */
function auth(req: string): boolean {
    state.requireUnauth();
  const header = req;
  if (!header) return false;

  const token = header.replace("Bearer ", "");
  return true;
}

/** @requiresRole user @becomesRole admin */
function requireAdminRole(role: Role): boolean {
    state.requireUser();
  if (role === "admin") {
    return true;

  } else {
    return false;
  }
}
function adminWrite(req: string, ctx: Role): void {
  if (!requireAdminRole(ctx)) {
    throw new Error("Unauthorized");
  } else {
    writeAdminDB();
  }
}
interface UserRequestBody {
  token: string;
  email?: string;
  admin?: boolean;
  body?: Record<string, unknown>;
}


function updateUser(req: UserRequestBody): void {
  let account: UserAccount | undefined;
  if (auth(req.token)) {
    account = new UserAccount();
  } else {

    if (account && req.email) {
      account.updateEmail(req.email);
    }

    if (account && req.admin === true) {

      account.promoteToAdmin();
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
  getPublicName(): string {
      state.requireUser();
    return this.publicName;
  }

  /** @requiresRole user */
  getImageUrl(): string {
      state.requireUser();
    return this.imageUrl;
  }

  /** @requiresRole user */
  getValue(): number {
      state.requireUser();
    return this.value;
  }



  /** @requiresRole user */
  setPublicName(name: string): void {
      state.requireUser();
    this.publicName = name;
  }

  /** @requiresRole user */
  setImageUrl(url: string): void {
      state.requireUser();
    this.imageUrl = url;
  }

  /** @requiresRole user */
  setValue(value: number): void {
      state.requireUser();
    this.value = value;
  }


  /** @requiresRole admin */
  getInternalToken(): string {
      state.requireAdmin();
    return this.internalToken;
  }
  /** @requiresRole admin */
  getFeatureFlags(): string[] {
      state.requireAdmin();
    return [...this.featureFlags];
  }


  /** @requiresRole admin */
  setInternalToken(token: string): void {
      state.requireAdmin();
    this.internalToken = token;
  }
  /** @requiresRole admin */
  addFeatureFlag(flag: string): void {
      state.requireAdmin();
    this.featureFlags.push(flag);
  }
  /** @requiresRole admin */
  removeFeatureFlag(flag: string): void {
      state.requireAdmin();
    this.featureFlags =
      this.featureFlags.filter(f => f !== flag);
  }



  /** @requiresRole user */
  set(): void {
      state.requireUser(); }

}




// Flag any type as unauthenticated. Auto fail here, regardless of auth. 
function applyUpdates(target: any, updates: Record<string, unknown>) {
  for (const [key, value] of Object.entries(updates)) {
    const setter = `set${key[0].toUpperCase()}${key.slice(1)}`;

    if (typeof target[setter] === "function") { // This is effectively call anything, auto flags.
      target[setter](value);
    }
  }
}


/* -------- 0 > User -------- */
function patch(req: UserRequestBody, res: string): string {
  if (auth(req.token)) {
    return "unauthenticated";
  }

  const config = new ConfigureableObject();

  applyUpdates(config, req.body ?? {});


  return "success";
}
