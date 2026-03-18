function verify() {
  /* Generated symbolic driver for handleUserRequest */
  var S$ = require("S$");
  var { state } = require("./state");
  var { handleUserRequest } = require("./symextests");
  var out;
  var token = S$.symbol("token", "");
  var body = S$.symbol("body", "");
  out = handleUserRequest(token, body);
  console.log("Symbolic output:", out);
}
verify();
