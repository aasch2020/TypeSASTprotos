function verify() {
  /* Generated symbolic driver for handleRequest */
  var S$ = require("S$");
  var { state } = require("./state");
  var { handleRequest } = require("./symextests");
  var out;
  var token = S$.symbol("token", "");
  var body = S$.symbol("body", "");
  out = handleRequest(token, body);
  console.log("Symbolic output:", out);
}
verify();
