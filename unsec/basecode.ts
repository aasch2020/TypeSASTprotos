/* --------- 0 < user < admin --------- */
type Role = "admin" | "user" | "0";

type Token = {
  userId: number;
  role: Role;
};
type Account = {
  /* -------- User -------- */
  updateEmail: (email: string) => void;
  /* -------- Admin -------- */
  promoteToAdmin: () => void;
}


class UserAccount implements Account {
  updateEmail(email: string): void {
  }
  promoteToAdmin(): void {
  }
}


function verifyToken(token: string): Token {
  return { userId: 1, role: "user" };
}

/* -------- Admin -------- */
function writeAdminDB(): void { }



/* -------- 0 > User -------- */
function auth(req: string): boolean {
  const header = req;
  if (!header) return false;

  const token = header.replace("Bearer ", "");
  return true;
}


/* -------- User > Admin -------- */
function requireAdminRole(role: Role): boolean {
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
  let account: Account | undefined;
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


  private internalToken: string;
  private featureFlags: string[];

  constructor() {
    this.publicName = "payments";
    this.imageUrl = "https://example.com/logo.png";
    this.value = 42;

    this.internalToken = "svc-9f83a...";
    this.featureFlags = ["can-refund", "can-settle"];
  }


  getPublicName(): string {
    return this.publicName;
  }

  getImageUrl(): string {
    return this.imageUrl;
  }

  getValue(): number {
    return this.value;
  }



  setPublicName(name: string): void {
    this.publicName = name;
  }

  setImageUrl(url: string): void {
    this.imageUrl = url;
  }

  setValue(value: number): void {
    this.value = value;
  }


  /* -------- Admin -------- */
  getInternalToken(): string {
    return this.internalToken;
  }
  /* -------- Admin -------- */
  getFeatureFlags(): string[] {
    return [...this.featureFlags];
  }


  /* -------- Admin -------- */
  setInternalToken(token: string): void {
    this.internalToken = token;
  }
  /* -------- Admin -------- */
  addFeatureFlag(flag: string): void {
    this.featureFlags.push(flag);
  }
  /* -------- Admin -------- */
  removeFeatureFlag(flag: string): void {
    this.featureFlags =
      this.featureFlags.filter(f => f !== flag);
  }



  set(): void { }

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


function patch(req: UserRequestBody, res: string): string {
  if (auth(req.token)) {
    return "unauthenticated";
  }

  const config = new ConfigureableObject();

  applyUpdates(config, req.body ?? {});


  return "success";
}

