function verify() {
  /* Generated symbolic driver for updateUser */
  var S$ = require("S$");
  var { state } = require("./state");
  var { updateUser } = require("./basecode");
  var out;
  var req = S$.symbol("req", "");
  out = updateUser(req);
  console.log("Symbolic output:", out);
}
verify();
