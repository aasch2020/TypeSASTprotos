class AnalysisState {
    public currentRole: "unauth" | "user" | "admin" = "unauth";
    public raisedRole: "unauth" | "user" | "admin" | null = null;

    raise(role: "unauth" | "user" | "admin") {
        this.raisedRole = role;
        this.currentRole = role;
    }

    setUnauth() {
        this.currentRole = "unauth";
    }

    setUser() {
        this.currentRole = "user";
    }

    setAdmin() {
        this.currentRole = "admin";
    }

    requireUnauth(): void {
        if (!["unauth", "user", "admin"].includes(this.currentRole)) {
          throw new Error("Requires role unauth or higher, current role is " + this.currentRole);
        }
    }

    requireUser(): void {
        if (!["user", "admin"].includes(this.currentRole)) {
          throw new Error("Requires role user or higher, current role is " + this.currentRole);
        }
    }

    requireAdmin(): void {
        if (!["admin"].includes(this.currentRole)) {
          throw new Error("Requires role admin or higher, current role is " + this.currentRole);
        }
    }
}

export const state = new AnalysisState();
