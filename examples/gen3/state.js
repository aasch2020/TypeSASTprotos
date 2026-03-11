"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.state = void 0;
class AnalysisState {
    constructor() {
        this.currentRole = "unauth";
        this.raisedRole = null;
    }
    raise(role) {
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
    requireUnauth() {
        if (!["unauth", "user", "admin"].includes(this.currentRole)) {
            throw new Error("Requires role unauth or higher, current role is " + this.currentRole);
        }
    }
    requireUser() {
        if (!["user", "admin"].includes(this.currentRole)) {
            throw new Error("Requires role user or higher, current role is " + this.currentRole);
        }
    }
    requireAdmin() {
        if (!["admin"].includes(this.currentRole)) {
            throw new Error("Requires role admin or higher, current role is " + this.currentRole);
        }
    }
}
exports.state = new AnalysisState();
