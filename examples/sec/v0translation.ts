/* --------- 0 < user < admin --------- */
type Role = "admin" | "user" | "0";


class unauth { };
class user extends unauth {
  cuser() { };
};
class admin extends user {
  cuser(): void { // Stop duck typing

  }
  cadmin() { };
};

type Token = {
  userId: number;
  role: Role;
};
type Account = {
  updateEmail: (L: user, email: string) => void;
  promoteToAdmin: (L: admin) => void;
}


class UserAccount implements Account {
  updateEmail(L: user, email: string): void {
  }
  promoteToAdmin(L: admin): void {
  }
}


function verifyToken(token: string): Token {
  return { userId: 1, role: "user" };
}

/* -------- Admin -------- */
function writeAdminDB(L: admin): void { }



/* -------- 0 > User -------- */
// Write out elevator functions, instead create two Leveled functions 
function auth0(req: string): unauth {
  return new unauth
}

function auth1(req: string): user {
  return new user;
}

/* -------- User > Admin -------- */
// Write out elevator functions, instead create two Leveled functions: explicit creation of role elevation
function requireAdminRole0(role: Role): user {
  return new user
}
function requireAdminRole1(role: Role): admin {
  return new admin
}


// Default everything takes unauth type, any branching on elevators is transpiled out to multiple functions.
function adminWrite0(L: unauth, req: string, ctx: Role): void {
  // B1 
  const L0 = requireAdminRole0(ctx);
  throw new Error("Unauthorized");

  // B2
  const   L1 = requireAdminRole1(ctx);
  writeAdminDB(L1);
}

interface UserRequestBody {
  token: string;
  email?: string;
  admin?: boolean;
  body?: Record<string, unknown>;
}

// Same as above, reasign L to leveled L' and call from there on
function updateUser(L: unauth, req: UserRequestBody): void {
  let account: Account | undefined;
  const L0 = auth0(req.token);
  const L1 = auth1(req.token);
    account = new UserAccount();


  if (account && req.email) {
    account.updateEmail(L1, req.email);
  }

  if (account && req.admin === true) {
    account.promoteToAdmin(L1); // DOES NOTE TYPE CHECK, CORRECT
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


  getPublicName(L: user): string {
    return this.publicName;
  }

  getImageUrl(L: user): string {
    return this.imageUrl;
  }

  getValue(L: user): number {
    return this.value;
  }



  setPublicName( L: user, name: string): void {
    this.publicName = name;
  }

  setImageUrl(L: user, url: string): void {
    this.imageUrl = url;
  }

  setValue(L: user, value: number): void {
    this.value = value;
  }


  /* -------- Admin -------- */
  getInternalToken(L: admin): string {
    return this.internalToken;
  }
  /* -------- Admin -------- */
  getFeatureFlags(L: admin): string[] {
    return [...this.featureFlags];
  }


  /* -------- Admin -------- */
  setInternalToken(L: admin, token: string): void {
    this.internalToken = token;
  }
  /* -------- Admin -------- */
  addFeatureFlag(L: admin, flag: string): void {
    this.featureFlags.push(flag);
  }
  /* -------- Admin -------- */
  removeFeatureFlag(L: admin, flag: string): void {
    this.featureFlags =
      this.featureFlags.filter(f => f !== flag);
  }




}







// This needs to be explicitly disallowed, as it is effectively a call to any setter, and thus any type.

// function applyUpdates(L: unauth, target: any, updates: Record<string, unknown>) {
//   for (const [key, value] of Object.entries(updates)) {
//     const setter = `set${key[0].toUpperCase()}${key.slice(1)}`;

//     if (typeof target[setter] === "function") {
//       target[setter](value);
//     }
//   }
// }

// // Calling leveld L, merge out return types to ensure full check 
// function patch(L: unauth,req: UserRequestBody, res: string): void {
//   const L0 = auth0(req.token);
//   const L1 = auth1(req.token);

//   // B1
//   const config = new ConfigureableObject();
//   // B2 
//   applyUpdates(L1, config, req.body ?? {});


// }

